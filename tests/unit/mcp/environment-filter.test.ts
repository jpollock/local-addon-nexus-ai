import { isWpeEnvironmentAllowed, DEFAULT_WPE_ALLOWED_ENVIRONMENTS, checkWpeInstallEnvironmentAccess, checkKnownEnvironmentAccess } from '../../../src/main/mcp/utils/environment-filter';

describe('DEFAULT_WPE_ALLOWED_ENVIRONMENTS', () => {
  it('excludes production', () => {
    expect(DEFAULT_WPE_ALLOWED_ENVIRONMENTS).not.toContain('production');
  });

  it('includes staging and development', () => {
    expect(DEFAULT_WPE_ALLOWED_ENVIRONMENTS).toContain('staging');
    expect(DEFAULT_WPE_ALLOWED_ENVIRONMENTS).toContain('development');
  });
});

describe('isWpeEnvironmentAllowed', () => {
  it('allows staging when using default (no setting)', () => {
    expect(isWpeEnvironmentAllowed('staging', {})).toBe(true);
  });

  it('allows development when using default', () => {
    expect(isWpeEnvironmentAllowed('development', {})).toBe(true);
  });

  it('blocks production when using default', () => {
    expect(isWpeEnvironmentAllowed('production', {})).toBe(false);
  });

  it('blocks undefined environment (defaults to production)', () => {
    expect(isWpeEnvironmentAllowed(undefined, {})).toBe(false);
  });

  it('allows production when explicitly enabled', () => {
    expect(isWpeEnvironmentAllowed('production', {
      wpeAllowedEnvironments: ['production', 'staging', 'development'],
    })).toBe(true);
  });

  it('blocks staging when only production is allowed', () => {
    expect(isWpeEnvironmentAllowed('staging', {
      wpeAllowedEnvironments: ['production'],
    })).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isWpeEnvironmentAllowed('Production', {})).toBe(false);
    expect(isWpeEnvironmentAllowed('Staging', {})).toBe(true);
  });

  it('blocks when wpeAllowedEnvironments is empty array', () => {
    expect(isWpeEnvironmentAllowed('staging', { wpeAllowedEnvironments: [] })).toBe(false);
  });
});

describe('checkWpeInstallEnvironmentAccess', () => {
  const makeStorage = (settings: object, installs: any[]) => ({
    get: (key: string) => {
      if (key === 'nexus-ai_settings') return settings;
      if (key === 'nexus-ai_wpe_install_cache') return { installs };
      return null;
    },
  });

  it('returns null for staging install with default settings', () => {
    const storage = makeStorage({}, [{ installName: 'mysite', environment: 'staging' }]);
    expect(checkWpeInstallEnvironmentAccess('mysite', storage)).toBeNull();
  });

  it('returns error string for production install with default settings', () => {
    const storage = makeStorage({}, [{ installName: 'mysite', environment: 'production' }]);
    const result = checkWpeInstallEnvironmentAccess('mysite', storage);
    expect(result).toContain('production');
    expect(result).toContain('Nexus Preferences');
  });

  it('returns null for production when production is allowed', () => {
    const storage = makeStorage(
      { wpeAllowedEnvironments: ['production', 'staging', 'development'] },
      [{ installName: 'mysite', environment: 'production' }],
    );
    expect(checkWpeInstallEnvironmentAccess('mysite', storage)).toBeNull();
  });

  it('defaults to production (blocked) when install not in cache', () => {
    const storage = makeStorage({}, []);
    const result = checkWpeInstallEnvironmentAccess('unknown-install', storage);
    expect(result).not.toBeNull();
    expect(result).toContain('production');
  });
});

describe('checkKnownEnvironmentAccess', () => {
  const makeStorage = (settings: object) => ({
    get: (key: string): unknown => key === 'nexus-ai_settings' ? settings : null,
  });

  it('returns null for staging with default settings', () => {
    expect(checkKnownEnvironmentAccess('staging', makeStorage({}))).toBeNull();
  });

  it('returns null for development with default settings', () => {
    expect(checkKnownEnvironmentAccess('development', makeStorage({}))).toBeNull();
  });

  it('returns error string for production with default settings', () => {
    const result = checkKnownEnvironmentAccess('production', makeStorage({}));
    expect(result).not.toBeNull();
    expect(result).toContain('production');
    expect(result).toContain('Nexus Preferences');
  });

  it('returns null for production when production is explicitly allowed', () => {
    const result = checkKnownEnvironmentAccess(
      'production',
      makeStorage({ wpeAllowedEnvironments: ['production', 'staging', 'development'] }),
    );
    expect(result).toBeNull();
  });

  it('returns error for undefined environment (defaults to production)', () => {
    const result = checkKnownEnvironmentAccess(undefined, makeStorage({}));
    expect(result).not.toBeNull();
    expect(result).toContain('production');
  });

  it('accepts null registryStorage and blocks production', () => {
    const result = checkKnownEnvironmentAccess('production', null);
    expect(result).not.toBeNull();
  });
});
