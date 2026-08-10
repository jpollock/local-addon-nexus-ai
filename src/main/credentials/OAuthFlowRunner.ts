import * as http from 'http';
import * as crypto from 'crypto';
import { shell } from 'electron';
import type { ProviderConfig } from './ProviderRegistry';
import type { FlowResult } from './types';

const FLOW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export class OAuthFlowRunner {
  private cancelFn: (() => void) | null = null;

  async run(
    provider: ProviderConfig,
    scopes: string[],
    emitState: (patch: Record<string, unknown>) => void,
  ): Promise<FlowResult> {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = generateState();

    return new Promise<FlowResult>((resolve) => {
      let settled = false;
      let server: http.Server | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let redirectUri = '';

      const cleanup = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (server) { server.closeAllConnections?.(); server.close(); server = null; }
        this.cancelFn = null;
      };

      const settle = (result: FlowResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        emitState({ credentialFlowStatus: null });
        resolve(result);
      };

      this.cancelFn = () => settle({ outcome: 'cancelled' });

      timer = setTimeout(() => settle({ outcome: 'cancelled' }), FLOW_TIMEOUT_MS);

      server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', redirectUri || 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }

        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');

        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          '<html><body><p>You can close this tab and return to Local.</p></body></html>',
        );

        if (returnedState !== state) {
          console.warn('[OAuthFlowRunner] state mismatch — possible CSRF');
          settle({ outcome: 'state_mismatch' });
          return;
        }

        if (!code) {
          settle({ outcome: 'cancelled' });
          return;
        }

        // Exchange code for tokens
        this.exchangeCode({ provider, code, verifier, redirectUri })
          .then(tokens => settle({ outcome: 'success', ...tokens }))
          .catch((e: Error) => {
            // Previously collapsed into 'cancelled', which discarded the only evidence of what
            // went wrong AND made a completed consent look like the user backing out.
            console.error('[OAuthFlowRunner] token exchange failed:', e?.message ?? e);
            settle({ outcome: 'error', message: e?.message ?? 'Token exchange failed' });
          });
      });

      server.listen(0, '127.0.0.1', () => {
        const { port } = server!.address() as import('net').AddressInfo;
        redirectUri = `http://127.0.0.1:${port}/callback`;

        const params = new URLSearchParams({
          response_type: 'code',
          client_id: provider.clientId,
          redirect_uri: redirectUri,
          scope: scopes.join(' '),
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
        });

        const authUrl = `${provider.authorizationEndpoint}?${params.toString()}`;
        emitState({ credentialFlowStatus: 'waiting' });
        shell.openExternal(authUrl).catch(() => settle({ outcome: 'cancelled' }));
      });

      server.on('error', (e: Error) => settle({ outcome: 'error', message: `Callback server failed: ${e?.message ?? e}` }));
    });
  }

  cancel(): void {
    this.cancelFn?.();
  }

  private async exchangeCode(opts: {
    provider: ProviderConfig;
    code: string;
    verifier: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scopes: string[]; accountLabel: string }> {
    const body = new URLSearchParams({
      code: opts.code,
      client_id: opts.provider.clientId,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: opts.verifier,
      // Desktop/installed apps require client_secret in the token exchange
      ...(opts.provider.clientSecret ? { client_secret: opts.provider.clientSecret } : {}),
    });

    const res = await fetch(opts.provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      // Google's status code alone is useless here — every failure is a 400, and the body is what
      // names it: `invalid_client` (wrong or missing client_secret), `invalid_grant` (code reused
      // or expired), `redirect_uri_mismatch`. Those are three unrelated fixes, so the body has to
      // survive into the message.
      let detail = '';
      try {
        const body = await res.text();
        const parsed = JSON.parse(body) as { error?: string; error_description?: string };
        detail = parsed.error
          ? ` — ${parsed.error}${parsed.error_description ? `: ${parsed.error_description}` : ''}`
          : ` — ${body.slice(0, 200)}`;
      } catch { /* body unreadable; the status is all we have */ }
      throw new Error(`Token exchange failed: ${res.status}${detail}`);
    }
    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    if (!data.access_token || !data.refresh_token) {
      throw new Error('Token exchange response missing required fields');
    }

    // Fetch account email for display
    let accountLabel = 'Google account';
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (infoRes.ok) {
        const info = await infoRes.json() as { email?: string };
        if (info.email) accountLabel = info.email;
      }
    } catch { /* non-fatal */ }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scopes: data.scope ? data.scope.split(' ') : [],
      accountLabel,
    };
  }
}
