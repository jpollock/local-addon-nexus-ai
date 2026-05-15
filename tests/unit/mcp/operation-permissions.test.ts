import {
  isOperationAllowed,
  DEFAULT_OPERATION_PERMISSIONS,
  migrateFromLegacyEnvFilter,
  getEffectiveSettings,
} from '../../../src/main/mcp/utils/operation-permissions';
import type { NexusSettings } from '../../../src/common/types';
import { STORAGE_KEYS } from '../../../src/common/constants';

describe('DEFAULT_OPERATION_PERMISSIONS', () => {
  it('allows pull on all environments', () => {
    expect(DEFAULT_OPERATION_PERMISSIONS.pull.production).toBe(true);
    expect(DEFAULT_OPERATION_PERMISSIONS.pull.staging).toBe(true);
    expect(DEFAULT_OPERATION_PERMISSIONS.pull.development).toBe(true);
  });

  it('blocks wpcli on production by default', () => {
    expect(DEFAULT_OPERATION_PERMISSIONS.wpcli.production).toBe(false);
    expect(DEFAULT_OPERATION_PERMISSIONS.wpcli.staging).toBe(true);
  });

  it('blocks push on production by default', () => {
    expect(DEFAULT_OPERATION_PERMISSIONS.push.production).toBe(false);
  });

  it('blocks delete on all environments by default', () => {
    expect(DEFAULT_OPERATION_PERMISSIONS.delete.development).toBe(false);
    expect(DEFAULT_OPERATION_PERMISSIONS.delete.staging).toBe(false);
    expect(DEFAULT_OPERATION_PERMISSIONS.delete.production).toBe(false);
  });
});

describe('isOperationAllowed', () => {
  const baseSettings: NexusSettings = { autoIndex: true, excludedSiteIds: [] };

  it('uses defaults when wpeOperationPermissions not set', () => {
    expect(isOperationAllowed('wpcli', 'staging', baseSettings)).toBe(true);
    expect(isOperationAllowed('wpcli', 'production', baseSettings)).toBe(false);
    expect(isOperationAllowed('pull', 'production', baseSettings)).toBe(true);
  });

  it('respects custom permissions', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeOperationPermissions: { wpcli: { production: true, staging: true, development: true } },
    };
    expect(isOperationAllowed('wpcli', 'production', s)).toBe(true);
  });

  it('defaults unknown environment to production (blocked for wpcli)', () => {
    expect(isOperationAllowed('wpcli', undefined, baseSettings)).toBe(false);
    expect(isOperationAllowed('wpcli', 'unknown', baseSettings)).toBe(false);
  });

  it('applies site exception — allow overrides global block', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    };
    expect(isOperationAllowed('wpcli', 'production', s, 'mystore')).toBe(true);
  });

  it('applies site exception — block overrides global allow', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeSiteExceptions: [
        { installName: 'client-site', environment: 'staging', overrides: { push: false } },
      ],
    };
    expect(isOperationAllowed('push', 'staging', s, 'client-site')).toBe(false);
  });

  it('site exception for different install does not affect other installs', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    };
    expect(isOperationAllowed('wpcli', 'production', s, 'other-install')).toBe(false);
  });

  it('no installName provided — site exceptions are ignored', () => {
    const s: NexusSettings = {
      ...baseSettings,
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    };
    expect(isOperationAllowed('wpcli', 'production', s)).toBe(false);
  });
});

describe('isOperationAllowed — site exception edge cases', () => {
  const base: NexusSettings = { autoIndex: true, excludedSiteIds: [] };

  it('exception for different environment does not affect the target environment', () => {
    const s: NexusSettings = {
      ...base,
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'staging', overrides: { push: false } },
      ],
    };
    // Staging is blocked by exception, but production should still use global default (also blocked)
    expect(isOperationAllowed('push', 'staging', s, 'mystore')).toBe(false);
    // Development has no exception — falls through to global default (allowed)
    expect(isOperationAllowed('push', 'development', s, 'mystore')).toBe(true);
  });

  it('exception without the specific op key falls through to global setting', () => {
    const s: NexusSettings = {
      ...base,
      wpeSiteExceptions: [
        // Exception only overrides 'push', not 'wpcli'
        { installName: 'mystore', environment: 'production', overrides: { push: true } },
      ],
    };
    // push is allowed by exception
    expect(isOperationAllowed('push', 'production', s, 'mystore')).toBe(true);
    // wpcli has no exception — falls through to global default (blocked for production)
    expect(isOperationAllowed('wpcli', 'production', s, 'mystore')).toBe(false);
  });

  it('multiple exceptions — correct one wins per install+environment pair', () => {
    const s: NexusSettings = {
      ...base,
      wpeSiteExceptions: [
        { installName: 'site-a', environment: 'production', overrides: { wpcli: true } },
        { installName: 'site-b', environment: 'production', overrides: { wpcli: false } },
        { installName: 'site-a', environment: 'staging', overrides: { push: false } },
      ],
    };
    expect(isOperationAllowed('wpcli', 'production', s, 'site-a')).toBe(true);
    expect(isOperationAllowed('wpcli', 'production', s, 'site-b')).toBe(false);
    expect(isOperationAllowed('push', 'staging', s, 'site-a')).toBe(false);
    expect(isOperationAllowed('push', 'staging', s, 'site-b')).toBe(true); // no exception — global default
  });

  it('empty wpeSiteExceptions array does not break anything', () => {
    const s: NexusSettings = { ...base, wpeSiteExceptions: [] };
    expect(isOperationAllowed('wpcli', 'production', s, 'mystore')).toBe(false);
    expect(isOperationAllowed('push', 'staging', s, 'mystore')).toBe(true);
  });

  it('delete is always blocked regardless of site exception allowing it globally', () => {
    // delete defaults are all false — a site exception allowing push shouldn't bleed
    const s: NexusSettings = {
      ...base,
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'development', overrides: { push: true } },
      ],
    };
    // push exception doesn't affect delete
    expect(isOperationAllowed('delete', 'development', s, 'mystore')).toBe(false);
  });
});

describe('isOperationAllowed — push bucket coverage', () => {
  const base: NexusSettings = { autoIndex: true, excludedSiteIds: [] };

  it('push blocked on production by default', () => {
    expect(isOperationAllowed('push', 'production', base)).toBe(false);
  });

  it('push allowed on staging and development by default', () => {
    expect(isOperationAllowed('push', 'staging', base)).toBe(true);
    expect(isOperationAllowed('push', 'development', base)).toBe(true);
  });

  it('enabling push on production via custom permissions works', () => {
    const s: NexusSettings = {
      ...base,
      wpeOperationPermissions: { push: { production: true, staging: true, development: true } },
    };
    expect(isOperationAllowed('push', 'production', s)).toBe(true);
  });

  it('blocking push on staging via custom permissions works', () => {
    const s: NexusSettings = {
      ...base,
      wpeOperationPermissions: { push: { production: false, staging: false, development: true } },
    };
    expect(isOperationAllowed('push', 'staging', s)).toBe(false);
    expect(isOperationAllowed('push', 'development', s)).toBe(true);
  });
});

describe('migrateFromLegacyEnvFilter', () => {
  it('returns undefined when no legacy setting exists', () => {
    expect(migrateFromLegacyEnvFilter({})).toBeUndefined();
  });

  it('returns undefined when wpeOperationPermissions already set', () => {
    const s = { wpeAllowedEnvironments: ['staging'], wpeOperationPermissions: {} };
    expect(migrateFromLegacyEnvFilter(s as any)).toBeUndefined();
  });

  it('migrates production-included to all-allowed for wpcli/push', () => {
    const s = { wpeAllowedEnvironments: ['production', 'staging', 'development'] };
    const result = migrateFromLegacyEnvFilter(s as any)!;
    expect(result.wpcli?.production).toBe(true);
    expect(result.push?.production).toBe(true);
  });

  it('migrates production-excluded to wpcli/push blocked on production', () => {
    const s = { wpeAllowedEnvironments: ['staging', 'development'] };
    const result = migrateFromLegacyEnvFilter(s as any)!;
    expect(result.wpcli?.production).toBe(false);
    expect(result.push?.production).toBe(false);
    expect(result.wpcli?.staging).toBe(true);
  });

  it('empty wpeAllowedEnvironments blocks everything for wpcli/push', () => {
    const s = { wpeAllowedEnvironments: [] as string[] };
    const result = migrateFromLegacyEnvFilter(s as any)!;
    expect(result.wpcli?.production).toBe(false);
    expect(result.wpcli?.staging).toBe(false);
    expect(result.wpcli?.development).toBe(false);
    expect(result.push?.production).toBe(false);
    expect(result.push?.staging).toBe(false);
  });

  it('staging-only legacy setting blocks dev and production for wpcli/push', () => {
    const s = { wpeAllowedEnvironments: ['staging'] };
    const result = migrateFromLegacyEnvFilter(s as any)!;
    expect(result.wpcli?.staging).toBe(true);
    expect(result.wpcli?.development).toBe(false);
    expect(result.wpcli?.production).toBe(false);
  });

  it('pull and delete are always defaulted regardless of legacy env filter', () => {
    const s = { wpeAllowedEnvironments: ['staging'] };
    const result = migrateFromLegacyEnvFilter(s as any)!;
    // pull is always allowed
    expect(result.pull?.production).toBe(true);
    expect(result.pull?.staging).toBe(true);
    // delete is always blocked
    expect(result.delete?.staging).toBe(false);
    expect(result.delete?.development).toBe(false);
  });
});

describe('getEffectiveSettings', () => {
  const makeStorage = (settings: object) => ({
    get: (key: string) => key === STORAGE_KEYS.SETTINGS ? settings : null,
  });

  it('returns empty object for null storage', () => {
    const result = getEffectiveSettings(null);
    expect(result.wpeOperationPermissions).toBeUndefined();
    expect(result.wpeSiteExceptions).toBeUndefined();
  });

  it('returns empty object for undefined storage', () => {
    const result = getEffectiveSettings(undefined);
    expect(result.wpeOperationPermissions).toBeUndefined();
  });

  it('passes through existing wpeOperationPermissions unchanged', () => {
    const perms = { wpcli: { production: true, staging: true, development: true } };
    const storage = makeStorage({ wpeOperationPermissions: perms });
    const result = getEffectiveSettings(storage);
    expect(result.wpeOperationPermissions).toEqual(perms);
  });

  it('migrates legacy wpeAllowedEnvironments when no new permissions set', () => {
    const storage = makeStorage({ wpeAllowedEnvironments: ['staging', 'development'] });
    const result = getEffectiveSettings(storage);
    expect(result.wpeOperationPermissions?.wpcli?.production).toBe(false);
    expect(result.wpeOperationPermissions?.wpcli?.staging).toBe(true);
    expect(result.wpeOperationPermissions?.push?.production).toBe(false);
  });

  it('new permissions take precedence over legacy when both present', () => {
    const perms = { wpcli: { production: true, staging: true, development: true } };
    const storage = makeStorage({
      wpeAllowedEnvironments: ['staging'], // would block production if migrated
      wpeOperationPermissions: perms,
    });
    const result = getEffectiveSettings(storage);
    // Migration skipped — new permissions win
    expect(result.wpeOperationPermissions?.wpcli?.production).toBe(true);
  });

  it('passes through wpeSiteExceptions unchanged', () => {
    const exceptions = [
      { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
    ];
    const storage = makeStorage({ wpeSiteExceptions: exceptions });
    const result = getEffectiveSettings(storage);
    expect(result.wpeSiteExceptions).toEqual(exceptions);
  });

  it('combined: migrated permissions + site exceptions both present', () => {
    const exceptions = [
      { installName: 'mystore', environment: 'production', overrides: { push: true } },
    ];
    const storage = makeStorage({
      wpeAllowedEnvironments: ['staging', 'development'],
      wpeSiteExceptions: exceptions,
    });
    const result = getEffectiveSettings(storage);
    // Migrated: production blocked for wpcli/push globally
    expect(result.wpeOperationPermissions?.push?.production).toBe(false);
    // But exception still threads through
    expect(result.wpeSiteExceptions).toEqual(exceptions);
    // And together they produce the right result
    expect(isOperationAllowed('push', 'production', result, 'mystore')).toBe(true);
    expect(isOperationAllowed('push', 'production', result, 'other')).toBe(false);
  });
});
