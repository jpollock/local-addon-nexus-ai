export interface ProviderConfig {
  id: 'google';
  displayName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  clientId: string;
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
    const clientId = process.env.NEXUS_GOOGLE_CLIENT_ID;
    if (!clientId) return null;
    return {
      id: 'google',
      displayName: 'Google',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
      clientId,
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
