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

  isEnabled(id: string): boolean {
    return this.get(id) !== null;
  }

  list(): ProviderConfig[] {
    const google = this.get('google');
    return google ? [google] : [];
  }
}
