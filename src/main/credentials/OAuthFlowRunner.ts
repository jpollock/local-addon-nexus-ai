import * as http from 'http';
import * as crypto from 'crypto';
import * as net from 'net';
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

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
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
    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    return new Promise<FlowResult>((resolve) => {
      let settled = false;
      let server: http.Server | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (server) { server.close(); server = null; }
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
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
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
          .catch(() => settle({ outcome: 'cancelled' }));
      });

      server.listen(port, '127.0.0.1', () => {
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

      server.on('error', () => settle({ outcome: 'cancelled' }));
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
    });

    const res = await fetch(opts.provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
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
