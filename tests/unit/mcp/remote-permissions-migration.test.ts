import {
  migrateWpePermissionSettings,
  isOperationAllowed,
} from '../../../src/main/mcp/utils/operation-permissions';

describe('migrateWpePermissionSettings', () => {
  it('carries operation permissions across unchanged', () => {
    const out = migrateWpePermissionSettings({
      wpeOperationPermissions: { wpcli: { development: false, staging: true, production: false } },
    } as any);
    expect(out.remoteOperationPermissions).toEqual({
      wpcli: { development: false, staging: true, production: false },
    });
  });

  it('rewrites installName exceptions to wpe: target refs', () => {
    const out = migrateWpePermissionSettings({
      wpeSiteExceptions: [
        { installName: 'mystore', environment: 'production', overrides: { wpcli: true } },
      ],
    } as any);
    expect(out.remoteSiteExceptions).toEqual([
      { targetRef: 'wpe:mystore', environment: 'production', overrides: { wpcli: true } },
    ]);
  });

  it('returns nothing when already migrated — must not clobber new settings', () => {
    const out = migrateWpePermissionSettings({
      remoteOperationPermissions: { wpcli: { development: true, staging: true, production: true } },
      wpeOperationPermissions: { wpcli: { development: false, staging: false, production: false } },
    } as any);
    expect(out.remoteOperationPermissions).toBeUndefined();
  });

  it('returns nothing when there is nothing to migrate', () => {
    expect(migrateWpePermissionSettings({} as any)).toEqual({});
  });
});

describe('isOperationAllowed — empty-array fallback regression', () => {
  it('an empty remoteSiteExceptions does NOT suppress a populated wpeSiteExceptions', () => {
    const settings = {
      remoteSiteExceptions: [],
      wpeSiteExceptions: [
        { installName: 'acme', environment: 'production', overrides: { wpcli: true } },
      ],
    } as any;
    expect(isOperationAllowed('wpcli', 'production', settings, 'wpe:acme')).toBe(true);
  });

  it('an empty remoteOperationPermissions does NOT suppress a populated wpeOperationPermissions', () => {
    const settings = {
      remoteOperationPermissions: {},
      wpeOperationPermissions: { wpcli: { development: true, staging: true, production: true } },
    } as any;
    expect(isOperationAllowed('wpcli', 'production', settings)).toBe(true);
  });
});

describe('isOperationAllowed with target refs', () => {
  const settings = {
    remoteOperationPermissions: { wpcli: { development: true, staging: true, production: false } },
    remoteSiteExceptions: [
      { targetRef: 'ssh:acme-prod', environment: 'production', overrides: { wpcli: true } },
    ],
  } as any;

  it('applies the per-environment default', () => {
    expect(isOperationAllowed('wpcli', 'production', settings, 'wpe:other')).toBe(false);
  });

  it('lets an ssh: exception override for an external host', () => {
    expect(isOperationAllowed('wpcli', 'production', settings, 'ssh:acme-prod')).toBe(true);
  });

  it('does not apply an exception to a different target', () => {
    expect(isOperationAllowed('wpcli', 'production', settings, 'ssh:other-host')).toBe(false);
  });
});
