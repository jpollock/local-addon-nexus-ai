import {
  isOperationAllowed,
  DEFAULT_OPERATION_PERMISSIONS,
  migrateFromLegacyEnvFilter,
} from '../../../src/main/mcp/utils/operation-permissions';
import type { NexusSettings } from '../../../src/common/types';

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
});
