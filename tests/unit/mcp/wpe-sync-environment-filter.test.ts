import { isWpeEnvironmentAllowed } from '../../../src/main/mcp/utils/environment-filter';

/**
 * Verifies the environment filter logic that WPESyncService applies.
 * Tests realistic install data filtering patterns.
 */
describe('WPESyncService environment filter (via isWpeEnvironmentAllowed)', () => {
  const makeInstall = (env: string) => ({ install_name: `test-${env}`, environment: env });

  describe('default settings (production excluded)', () => {
    const settings = {};

    it('includes staging installs', () => {
      expect(isWpeEnvironmentAllowed(makeInstall('staging').environment, settings)).toBe(true);
    });

    it('includes development installs', () => {
      expect(isWpeEnvironmentAllowed(makeInstall('development').environment, settings)).toBe(true);
    });

    it('excludes production installs', () => {
      expect(isWpeEnvironmentAllowed(makeInstall('production').environment, settings)).toBe(false);
    });

    it('simulates filtering an install list', () => {
      const installs = [
        makeInstall('production'),
        makeInstall('staging'),
        makeInstall('development'),
        makeInstall('production'),
      ];
      const filtered = installs.filter((i) => isWpeEnvironmentAllowed(i.environment, settings));
      expect(filtered).toHaveLength(2);
      expect(filtered.every((i) => i.environment !== 'production')).toBe(true);
    });
  });

  describe('production enabled', () => {
    const settings: Pick<any, 'wpeAllowedEnvironments'> = {
      wpeAllowedEnvironments: ['production', 'staging', 'development'],
    };

    it('includes all environment types', () => {
      const installs = [
        makeInstall('production'),
        makeInstall('staging'),
        makeInstall('development'),
      ];
      const filtered = installs.filter((i) => isWpeEnvironmentAllowed(i.environment, settings));
      expect(filtered).toHaveLength(3);
    });
  });

  describe('staging only', () => {
    const settings: Pick<any, 'wpeAllowedEnvironments'> = {
      wpeAllowedEnvironments: ['staging'],
    };

    it('includes only staging', () => {
      expect(isWpeEnvironmentAllowed('staging', settings)).toBe(true);
      expect(isWpeEnvironmentAllowed('development', settings)).toBe(false);
      expect(isWpeEnvironmentAllowed('production', settings)).toBe(false);
    });
  });
});
