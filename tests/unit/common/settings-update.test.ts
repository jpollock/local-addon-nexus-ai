import { applySettingsUpdate } from '../../../src/common/settings-update';

describe('applySettingsUpdate — permission-key gating (P0-2)', () => {
  it('rejects a dotted permission key when allowPermissionKeys is false', () => {
    const r = applySettingsUpdate(
      {},
      { key: 'remoteOperationPermissions.delete.production', value: 'true' },
      { allowPermissionKeys: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permission/i);
  });

  it('rejects a permission key delivered via patch when allowPermissionKeys is false', () => {
    const r = applySettingsUpdate(
      {},
      { patch: JSON.stringify({ wpeOperationPermissions: { delete: { production: true } } }) },
      { allowPermissionKeys: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permission/i);
  });

  it('rejects wpeSiteExceptions / remoteSiteExceptions overrides when allowPermissionKeys is false', () => {
    const r = applySettingsUpdate(
      {},
      { patch: JSON.stringify({ remoteSiteExceptions: [{ targetRef: 'ssh:x', environment: 'production', overrides: { delete: true } }] }) },
      { allowPermissionKeys: false },
    );
    expect(r.ok).toBe(false);
  });

  it('allows a permission key when allowPermissionKeys is true (the Settings-UI/IPC path)', () => {
    const r = applySettingsUpdate(
      {},
      { key: 'remoteOperationPermissions.delete.production', value: 'true' },
      { allowPermissionKeys: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.settings as any).remoteOperationPermissions.delete.production).toBe(true);
  });
});

describe('applySettingsUpdate — schema validation on every path', () => {
  it('rejects an unknown key even on the trusted path', () => {
    const r = applySettingsUpdate({}, { key: 'bogusKey', value: 'x' }, { allowPermissionKeys: true });
    expect(r.ok).toBe(false);
  });

  it('rejects a value of the wrong type (chatRetentionDays only allows 7/30/90/null)', () => {
    const r = applySettingsUpdate({}, { key: 'chatRetentionDays', value: '45' }, { allowPermissionKeys: false });
    expect(r.ok).toBe(false);
  });

  it('applies a valid benign key', () => {
    const r = applySettingsUpdate({ autoIndex: false } as any, { key: 'autoIndex', value: 'true' }, { allowPermissionKeys: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.settings as any).autoIndex).toBe(true);
  });

  it('does not punish pre-existing unknown keys when changing an unrelated valid key', () => {
    // Legacy settings may already hold keys the strict schema does not list; changing a
    // different, valid key must still succeed (only the delta is validated).
    const r = applySettingsUpdate({ someLegacyKey: 1 } as any, { key: 'autoIndex', value: 'true' }, { allowPermissionKeys: false });
    expect(r.ok).toBe(true);
  });

  it('requires either key+value or patch', () => {
    const r = applySettingsUpdate({}, {}, { allowPermissionKeys: false });
    expect(r.ok).toBe(false);
  });

  it('rejects patch that is not valid JSON', () => {
    const r = applySettingsUpdate({}, { patch: '{not json' }, { allowPermissionKeys: false });
    expect(r.ok).toBe(false);
  });
});
