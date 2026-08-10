export interface ProviderConfig {
  id: 'google';
  displayName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  clientId: string;
  /** Required for Desktop/installed OAuth apps (Google "installed" credential type). */
  clientSecret?: string;
  supportsIncrementalAuth: boolean;
  scopeMetadata: Record<string, { label: string; description: string }>;
}

const GOOGLE_SCOPE_METADATA: ProviderConfig['scopeMetadata'] = {
  'https://www.googleapis.com/auth/webmasters.readonly': {
    label: 'Search Console (read-only)',
    description: 'Read search performance data for your verified sites in Google Search Console',
  },
  'https://www.googleapis.com/auth/analytics.readonly': {
    label: 'Analytics (read-only)',
    description: 'Read Google Analytics data for your properties',
  },
};

export class ProviderRegistry {
  get(id: string): ProviderConfig | null {
    if (id !== 'google') return null;
    // Desktop app client ID — not a secret (PKCE is the security model).
    // Replace REPLACE_WITH_GOOGLE_CLIENT_ID with the real value from
    // console.cloud.google.com → Credentials → OAuth client ID (Desktop app).
    // Override with NEXUS_GOOGLE_CLIENT_ID env var in CI or dev.
    const clientId = process.env.NEXUS_GOOGLE_CLIENT_ID ?? '212814026888-33d0prd4fskmltivp0kanvr1ninnresu.apps.googleusercontent.com';
    if (clientId === 'REPLACE_WITH_GOOGLE_CLIENT_ID') return null;
    const clientSecret = process.env.NEXUS_GOOGLE_CLIENT_SECRET;
    return {
      id: 'google',
      displayName: 'Google',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      supportsIncrementalAuth: true,
      scopeMetadata: GOOGLE_SCOPE_METADATA,
    };
  }

  /**
   * Why a provider cannot be used, or null when it can.
   *
   * Kept separate from `get()` on purpose: the UI still needs the config to explain itself, and a
   * connect flow needs to refuse *before* opening a browser. Sending someone through Google's
   * consent screen when the exchange cannot possibly succeed spends their attention on a dead end
   * and ends with a 400 they had no way to anticipate — which is exactly what happened here.
   */
  configurationError(id: string): string | null {
    const cfg = this.get(id);
    if (!cfg) return `${id} is not a configured provider.`;
    if (!cfg.clientId || cfg.clientId === 'REPLACE_WITH_GOOGLE_CLIENT_ID') {
      return 'No OAuth client id — set NEXUS_GOOGLE_CLIENT_ID.';
    }
    // Google requires client_secret in the code exchange for BOTH "Desktop app" and "Web
    // application" client types. PKCE does not replace it. Without one, every exchange returns
    // 400 invalid_request: client_secret is missing.
    if (!cfg.clientSecret) {
      return 'No OAuth client secret — set NEXUS_GOOGLE_CLIENT_SECRET. Google rejects the token exchange without it, even with PKCE.';
    }
    return null;
  }

  /**
   * Usable, not merely present. This used to be `get(id) !== null`, which stopped meaning anything
   * once a real client id was committed as the fallback: the gate read "enabled" on every machine,
   * including ones that could never complete a sign-in.
   */
  isEnabled(id: string): boolean {
    return this.configurationError(id) === null;
  }

  list(): ProviderConfig[] {
    const google = this.get('google');
    return google ? [google] : [];
  }
}
