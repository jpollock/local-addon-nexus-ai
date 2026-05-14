import { isWpeEnvironmentAllowed, DEFAULT_WPE_ALLOWED_ENVIRONMENTS } from '../../../src/main/mcp/utils/environment-filter';

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
