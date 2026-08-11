import { ProviderRegistry } from '../../../src/main/credentials/ProviderRegistry';

describe('ProviderRegistry', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  // Each case states the whole environment it means, rather than deleting one variable and
  // trusting whatever else is present. Jest reuses a worker process across files, so a sibling
  // suite that sets NEXUS_GOOGLE_CLIENT_SECRET leaks into the `process.env` this file captures —
  // which is exactly how this assertion silently started passing for the wrong reason.
  it('isEnabled is false with nothing configured', () => {
    process.env = { ...OLD_ENV };
    delete process.env.NEXUS_GOOGLE_CLIENT_ID;
    delete process.env.NEXUS_GOOGLE_CLIENT_SECRET;
    const reg = new ProviderRegistry();
    expect(reg.isEnabled('google')).toBe(false);
    // The client id has a working fallback committed in source, so the secret is what's missing.
    expect(reg.configurationError('google')).toContain('NEXUS_GOOGLE_CLIENT_SECRET');
  });

  it('isEnabled is false with a client id but no secret', () => {
    process.env = { ...OLD_ENV, NEXUS_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com' };
    delete process.env.NEXUS_GOOGLE_CLIENT_SECRET;
    const reg = new ProviderRegistry();
    expect(reg.isEnabled('google')).toBe(false);
    // The exact live failure: Google answers `400 invalid_request: client_secret is missing`
    // after the user has already consented, and the refresh grant fails the same way an hour in.
    expect(reg.configurationError('google')).toContain('NEXUS_GOOGLE_CLIENT_SECRET');
  });

  it('isEnabled is true only when both the id and the secret are present', () => {
    process.env = {
      ...OLD_ENV,
      NEXUS_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      NEXUS_GOOGLE_CLIENT_SECRET: 'test-secret',
    };
    const reg = new ProviderRegistry();
    expect(reg.isEnabled('google')).toBe(true);
    expect(reg.configurationError('google')).toBeNull();
  });

  it('reports an unknown provider rather than pretending it is configured', () => {
    const reg = new ProviderRegistry();
    expect(reg.isEnabled('dropbox')).toBe(false);
    expect(reg.configurationError('dropbox')).toContain('not a configured provider');
  });

  it('get returns provider config with clientId from env', () => {
    process.env = { ...OLD_ENV, NEXUS_GOOGLE_CLIENT_ID: 'my-client-id' };
    const reg = new ProviderRegistry();
    const cfg = reg.get('google');
    expect(cfg).not.toBeNull();
    expect(cfg!.clientId).toBe('my-client-id');
    expect(cfg!.id).toBe('google');
    expect(cfg!.authorizationEndpoint).toContain('accounts.google.com');
  });

  it('get returns null for unknown provider', () => {
    const reg = new ProviderRegistry();
    expect(reg.get('github' as any)).toBeNull();
  });

  it('scopeMetadata has entry for webmasters.readonly', () => {
    process.env = { ...OLD_ENV, NEXUS_GOOGLE_CLIENT_ID: 'x' };
    const reg = new ProviderRegistry();
    const cfg = reg.get('google')!;
    expect(cfg.scopeMetadata['https://www.googleapis.com/auth/webmasters.readonly']).toBeDefined();
    expect(cfg.scopeMetadata['https://www.googleapis.com/auth/webmasters.readonly'].label).toBeTruthy();
  });
});
