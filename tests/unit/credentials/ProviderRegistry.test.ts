import { ProviderRegistry } from '../../../src/main/credentials/ProviderRegistry';

describe('ProviderRegistry', () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('isEnabled returns false when NEXUS_GOOGLE_CLIENT_ID is unset', () => {
    process.env = { ...OLD_ENV };
    delete process.env.NEXUS_GOOGLE_CLIENT_ID;
    const reg = new ProviderRegistry();
    expect(reg.isEnabled('google')).toBe(false);
  });

  it('isEnabled returns true when NEXUS_GOOGLE_CLIENT_ID is set', () => {
    process.env = { ...OLD_ENV, NEXUS_GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com' };
    const reg = new ProviderRegistry();
    expect(reg.isEnabled('google')).toBe(true);
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
