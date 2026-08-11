import * as React from 'react';
import { PermissionsSection } from '../../../src/renderer/components/settings/PermissionsSection';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  const children = node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) findAll(k, pred, out);
  return out;
}

function textOf(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  const children = node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  return kids.map(textOf).join('');
}

function serializeTree(node: any): any {
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'string') {
    const { children, ...rest } = node.props || {};
    const kids = Array.isArray(children) ? children : children !== undefined ? [children] : [];
    return { type: node.type, props: rest, children: kids.map(serializeTree) };
  }
  if (Array.isArray(node)) return node.map(serializeTree);
  return node;
}

const tree = (over: any = {}) => {
  const defaults = {
    permissions: {},
    exceptions: [],
    wpeInstalls: [],
    externalHosts: [],
    wpeAccounts: [],
    onSave: jest.fn(),
  };
  // Destructure nested objects out of override to avoid clobbering merged defaults
  const { permissions: pOver, ...restOver } = over;
  const merged = {
    ...defaults,
    ...restOver,
    permissions: { ...defaults.permissions, ...pOver },
  };
  return new (PermissionsSection as any)(merged).render();
};

// ── Basic Shape Tests ────────────────────────────────────────────────────────

describe('PermissionsSection', () => {
  test('is a 4×3 grid — reading is not a row', () => {
    const t = JSON.stringify(serializeTree(tree()));
    for (const row of [
      'Copy a site down to this Mac',
      'Install or update things',
      'Push local changes up',
      'Delete or promote an environment',
    ]) {
      expect(t).toContain(row);
    }
    expect(t).not.toContain('Read what is installed');
  });

  test('reading is stated above the grid instead', () => {
    expect(textOf(tree())).toContain('Reading a site is always allowed');
  });

  test('cells read Allowed or Blocked and nothing else', () => {
    const t = textOf(tree());
    expect(t).toContain('Allowed');
    expect(t).toContain('Blocked');
  });

  test('the dead legacy setting is not surfaced', () => {
    // wpeAllowedEnvironments has zero callers outside its own test file.
    expect(textOf(tree())).not.toContain('wpeAllowedEnvironments');
  });

  test('no hardcoded brand colour', () => {
    expect(JSON.stringify(serializeTree(tree())).toLowerCase()).not.toContain('0ecad4');
  });

  test('scope badges appear on grid rows', () => {
    const t = textOf(tree());
    expect(t).toContain('WPE only');
    expect(t).toContain('WPE + SSH');
  });

  // ── Grid Interactivity ─────────────────────────────────────────────────────

  test('each cell is clickable and invokes onSave with the updated permissions', () => {
    const onSave = jest.fn();
    const permissions = {
      remoteOperationPermissions: {
        pull: { development: true, staging: true, production: false },
        wpcli: { development: true, staging: false, production: false },
      },
    };
    const instance: any = new (PermissionsSection as any)({
      permissions,
      exceptions: [],
      wpeInstalls: [],
      externalHosts: [],
      wpeAccounts: [],
      onSave,
    });
    const rendered = instance.render();

    // Find all buttons with "Allowed" or "Blocked" text
    const buttons = findAll(rendered, (n) => {
      const txt = textOf(n);
      return (txt === 'Allowed' || txt === 'Blocked') && n.props?.onClick;
    });

    expect(buttons.length).toBeGreaterThan(0);

    // Click the first "Blocked" button (production pull) and verify it toggles to true
    const blockedButton = buttons.find((b) => textOf(b) === 'Blocked');
    expect(blockedButton).toBeDefined();
    blockedButton!.props.onClick();

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedPerms = onSave.mock.calls[0][0];
    expect(savedPerms).toHaveProperty('remoteOperationPermissions');
    // The production pull should now be true (was false)
    expect(savedPerms.remoteOperationPermissions.pull.production).toBe(true);
  });

  // ── Account Scope Filter ───────────────────────────────────────────────────

  test('account scope filter renders when wpeAccounts is non-empty', () => {
    const t = textOf(tree({
      wpeAccounts: [
        { id: 'acc-1', name: 'Acme Corp', nickname: 'Acme' },
      ],
    }));
    expect(t).toContain('Account scope');
    expect(t).toContain('Acme');
  });

  test('account chips are clickable and invoke onSave with wpeAccountFilter', () => {
    const onSave = jest.fn();
    const instance: any = new (PermissionsSection as any)({
      permissions: { wpeAccountFilter: ['acc-1', 'acc-2'] }, // Both included initially
      exceptions: [],
      wpeInstalls: [],
      externalHosts: [],
      wpeAccounts: [
        { id: 'acc-1', name: 'Acme Corp', nickname: 'Acme' },
        { id: 'acc-2', name: 'Beta Inc' },
      ],
      onSave,
    });
    const rendered = instance.render();

    // Find the Acme chip (should be included/checked)
    const chips = findAll(rendered, (n) => {
      const t = textOf(n);
      return t.includes('Acme') && n.props?.onClick;
    });

    expect(chips.length).toBeGreaterThan(0);

    // Click it to exclude acc-1
    chips[0].props.onClick();

    expect(onSave).toHaveBeenCalledTimes(1);
    const update = onSave.mock.calls[0][0];
    expect(update).toHaveProperty('wpeAccountFilter');
    expect(Array.isArray(update.wpeAccountFilter)).toBe(true);
    // acc-1 should be removed, acc-2 should remain
    expect(update.wpeAccountFilter).toEqual(['acc-2']);
    expect(update.wpeAccountFilter).not.toContain('acc-1');
  });

  // ── Exception Display & Editing ────────────────────────────────────────────

  test('shows WPE and external site exceptions', () => {
    const t = textOf(tree({
      exceptions: [
        { targetRef: 'wpe:mystore', environment: 'production', overrides: { pull: false } },
        { targetRef: 'ssh:myhost/site', environment: 'staging', overrides: { wpcli: true } },
      ],
    }));
    expect(t).toContain('mystore');
    expect(t).toContain('myhost/site');
  });

  test('+ Add site exception button exists', () => {
    const instance: any = new (PermissionsSection as any)({
      permissions: {},
      exceptions: [],
      wpeInstalls: [],
      externalHosts: [],
      wpeAccounts: [],
      onSave: jest.fn(),
    });

    const rendered = instance.render();
    const addButtons = findAll(rendered, (n) => textOf(n) === '+ Add site exception' && n.props?.onClick);
    expect(addButtons.length).toBeGreaterThan(0);
  });

  test('exception picker shows both WPE installs and external hosts with group labels and kind badges', () => {
    const instance: any = new (PermissionsSection as any)({
      permissions: {},
      exceptions: [],
      wpeInstalls: [
        { installName: 'store1', environment: 'production', primaryDomain: 'store1.com' },
      ],
      externalHosts: [
        { alias: 'host1', site: 'site1', environment: 'staging', domain: 'host1.com' },
      ],
      wpeAccounts: [],
      onSave: jest.fn(),
    });

    // Open the picker by setting state directly (React 16 doesn't allow setState on unmounted components)
    instance.state = {
      ...instance.state,
      addingException: {
        operation: 'wpcli',
        targetRef: '',
        environment: 'production',
        allowing: false,
      },
    };

    const rendered = instance.render();
    const t = textOf(rendered);

    // Group labels
    expect(t).toContain('WP Engine installs');
    expect(t).toContain('External SSH hosts');

    // Targets
    expect(t).toContain('store1');
    expect(t).toContain('host1/site1');

    // Kind badges
    expect(t).toContain('wpe');
    expect(t).toContain('ssh');
  });

  test('exception picker has operation selector with all four grid operations', () => {
    const instance: any = new (PermissionsSection as any)({
      permissions: {},
      exceptions: [],
      wpeInstalls: [],
      externalHosts: [],
      wpeAccounts: [],
      onSave: jest.fn(),
    });

    // Open picker
    instance.state = {
      ...instance.state,
      addingException: {
        operation: '',
        targetRef: '',
        environment: 'production',
        allowing: false,
      },
    };

    const rendered = instance.render();
    const t = textOf(rendered);

    // Operation selector should show all grid row labels
    expect(t).toContain('Operation:');
    expect(t).toContain('Copy a site down to this Mac');
    expect(t).toContain('Install or update things');
    expect(t).toContain('Push local changes up');
    expect(t).toContain('Delete or promote an environment');
  });

  test('exception picker Save button is disabled until both target and operation are selected', () => {
    const instance: any = new (PermissionsSection as any)({
      permissions: {},
      exceptions: [],
      wpeInstalls: [
        { installName: 'store1', environment: 'production', primaryDomain: 'store1.com' },
      ],
      externalHosts: [],
      wpeAccounts: [],
      onSave: jest.fn(),
    });

    // Open picker with target but no operation
    instance.state = {
      ...instance.state,
      addingException: {
        operation: '' as any,
        targetRef: 'wpe:store1',
        environment: 'production',
        allowing: false,
      },
    };

    const rendered = instance.render();

    // Find the Save button
    const saveButtons = findAll(rendered, (n) => textOf(n) === 'Save' && n.props?.onClick);
    expect(saveButtons.length).toBeGreaterThan(0);
    // Should be disabled
    expect(saveButtons[0].props.disabled).toBe(true);
  });

  test('can create an exception for delete operation', () => {
    const onSave = jest.fn();
    const instance: any = new (PermissionsSection as any)({
      permissions: {},
      exceptions: [],
      wpeInstalls: [
        { installName: 'prod-store', environment: 'production', primaryDomain: 'prodstore.com' },
      ],
      externalHosts: [],
      wpeAccounts: [],
      onSave,
    });

    // Open picker and select delete operation + target
    instance.state = {
      ...instance.state,
      addingException: {
        operation: 'delete',
        targetRef: 'wpe:prod-store',
        environment: 'production',
        allowing: false,
      },
    };

    const rendered = instance.render();

    // Find the Save button
    const saveButtons = findAll(rendered, (n) => textOf(n) === 'Save' && n.props?.onClick);
    expect(saveButtons.length).toBeGreaterThan(0);

    // Should be enabled
    expect(saveButtons[0].props.disabled).toBe(false);

    // Click it
    saveButtons[0].props.onClick();

    expect(onSave).toHaveBeenCalledTimes(1);
    const update = onSave.mock.calls[0][0];
    expect(update).toHaveProperty('remoteSiteExceptions');
    expect(update.remoteSiteExceptions.length).toBe(1);
    expect(update.remoteSiteExceptions[0].targetRef).toBe('wpe:prod-store');
    // CRITICAL: the override must be for delete, not wpcli
    expect(update.remoteSiteExceptions[0].overrides).toHaveProperty('delete');
    expect(update.remoteSiteExceptions[0].overrides.delete).toBe(false);
  });

  test('remove exception button exists and is wired', () => {
    const onSave = jest.fn();
    const instance: any = new (PermissionsSection as any)({
      permissions: {},
      exceptions: [
        { targetRef: 'wpe:mystore', environment: 'production', overrides: { pull: false } },
      ],
      wpeInstalls: [],
      externalHosts: [],
      wpeAccounts: [],
      onSave,
    });
    const rendered = instance.render();

    // Find the × button
    const removeButtons = findAll(rendered, (n) => textOf(n) === '×' && n.props?.onClick);
    expect(removeButtons.length).toBeGreaterThan(0);

    // Click it
    removeButtons[0].props.onClick({ stopPropagation: jest.fn() });

    expect(onSave).toHaveBeenCalled();
  });

  // ── Re-homed Regression Guards from Task 5 ─────────────────────────────────

  test('Guard #7: falls back to the deprecated wpeSiteExceptions for display when remoteSiteExceptions is absent', () => {
    const permissions = {
      wpeSiteExceptions: [
        { installName: 'legacy-store', environment: 'production', overrides: { wpcli: false } },
      ],
    };
    const t = textOf(tree({ permissions }));
    expect(t).toContain('legacy-store');
  });

  test('Guard #8: prefers remoteSiteExceptions over the deprecated key when both are present', () => {
    const permissions = {
      wpeSiteExceptions: [
        { installName: 'old', environment: 'production', overrides: { wpcli: false } },
      ],
      remoteSiteExceptions: [
        { targetRef: 'wpe:new', environment: 'production', overrides: { wpcli: false } },
      ],
    };
    const t = textOf(tree({ permissions }));
    expect(t).toContain('new');
    expect(t).not.toContain('old');
  });

  test('Guard #9: removing a legacy user\'s last exception clears wpeSiteExceptions too, so the fallback cannot resurrect it', () => {
    const onSave = jest.fn();
    const permissions = {
      wpeSiteExceptions: [
        { installName: 'legacy-store', environment: 'production', overrides: { wpcli: false } },
      ],
    };
    const instance: any = new (PermissionsSection as any)({
      permissions,
      exceptions: [],
      wpeInstalls: [],
      externalHosts: [],
      wpeAccounts: [],
      onSave,
    });
    const rendered = instance.render();

    // Find and click the remove button
    const removeButtons = findAll(rendered, (n) => textOf(n) === '×' && n.props?.onClick);
    expect(removeButtons.length).toBeGreaterThan(0);
    removeButtons[0].props.onClick({ stopPropagation: jest.fn() });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteSiteExceptions: [],
        wpeSiteExceptions: [],
      }),
    );
  });

  test('Guard #10: removing one of two legacy exceptions does NOT clear wpeSiteExceptions, since the array is still non-empty', () => {
    const onSave = jest.fn();
    const permissions = {
      wpeSiteExceptions: [
        { installName: 'legacy-store', environment: 'production', overrides: { wpcli: false } },
        { installName: 'other-store', environment: 'production', overrides: { wpcli: false } },
      ],
    };
    const instance: any = new (PermissionsSection as any)({
      permissions,
      exceptions: [],
      wpeInstalls: [],
      externalHosts: [],
      wpeAccounts: [],
      onSave,
    });
    const rendered = instance.render();

    // Find and click the first remove button
    const removeButtons = findAll(rendered, (n) => textOf(n) === '×' && n.props?.onClick);
    expect(removeButtons.length).toBeGreaterThan(0);
    removeButtons[0].props.onClick({ stopPropagation: jest.fn() });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteSiteExceptions: [
          { targetRef: 'wpe:other-store', environment: 'production', overrides: { wpcli: false } },
        ],
      }),
    );
    // wpeSiteExceptions should NOT be in the call — it's only cleared when the last one is removed
  });
});

// ── Legacy read-fallback ─────────────────────────────────────────────────────
//
// `operation-permissions.ts` falls back to `wpeOperationPermissions` whenever
// `remoteOperationPermissions` is empty. The grid must read the same way, or it
// shows the user a state the gate disagrees with — and the first click then
// overwrites their whole stored configuration with OPERATION_DEFAULTS.

describe('PermissionsSection — legacy wpeOperationPermissions fallback', () => {
  const legacyOnly = {
    wpeOperationPermissions: {
      delete: { development: true, staging: true, production: true },
      wpcli: { development: true, staging: false, production: false },
    },
  };

  const cellFor = (rendered: any, op: string, env: string) => {
    const hits = findAll(rendered, (n) => n.key === `${op}-${env}` && !!n.props?.onClick);
    expect(hits).toHaveLength(1);
    return hits[0];
  };

  test('the grid renders the legacy value, not OPERATION_DEFAULTS', () => {
    // delete/production defaults to Blocked; this user has it stored as allowed
    // and isOperationAllowed() honours that. The grid said "Blocked".
    const rendered = tree({ permissions: legacyOnly });
    expect(textOf(cellFor(rendered, 'delete', 'production'))).toBe('Allowed');
    expect(textOf(cellFor(rendered, 'wpcli', 'staging'))).toBe('Blocked');
  });

  test('the first click carries every legacy operation forward, discarding nothing', () => {
    const onSave = jest.fn();
    const rendered = tree({ permissions: legacyOnly, onSave });
    // Toggle an operation the legacy config does NOT mention.
    cellFor(rendered, 'push', 'production').props.onClick();

    expect(onSave).toHaveBeenCalledTimes(1);
    const written = onSave.mock.calls[0][0].remoteOperationPermissions;
    // The clicked cell flipped …
    expect(written.push.production).toBe(true);
    // … and the untouched legacy operations survived verbatim.
    expect(written.delete).toEqual({ development: true, staging: true, production: true });
    expect(written.wpcli).toEqual({ development: true, staging: false, production: false });
  });

  test('a click on a legacy operation flips only that cell', () => {
    const onSave = jest.fn();
    const rendered = tree({ permissions: legacyOnly, onSave });
    cellFor(rendered, 'delete', 'production').props.onClick();

    const written = onSave.mock.calls[0][0].remoteOperationPermissions;
    expect(written.delete).toEqual({ development: true, staging: true, production: false });
    expect(written.wpcli).toEqual({ development: true, staging: false, production: false });
  });

  test('remoteOperationPermissions wins when both are present', () => {
    const rendered = tree({
      permissions: {
        ...legacyOnly,
        remoteOperationPermissions: { delete: { development: false, staging: false, production: false } },
      },
    });
    expect(textOf(cellFor(rendered, 'delete', 'production'))).toBe('Blocked');
  });

  test('an EMPTY remoteOperationPermissions object does not shadow the legacy key', () => {
    // The backend's own condition is `Object.keys(...).length`, not presence.
    const rendered = tree({ permissions: { ...legacyOnly, remoteOperationPermissions: {} } });
    expect(textOf(cellFor(rendered, 'delete', 'production'))).toBe('Allowed');
  });
});
