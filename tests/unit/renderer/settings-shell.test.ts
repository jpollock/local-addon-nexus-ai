import { SettingsShell } from '../../../src/renderer/components/settings/SettingsShell';
import { serializeTree } from './helpers/serializeTree';

const shell = (state: any = {}) => {
  const c: any = new (SettingsShell as any)({ electron: { ipcRenderer: { invoke: jest.fn() } } });
  c.state = { ...c.state, loading: false, settings: {}, ...state };
  return JSON.stringify(serializeTree(c.render()));
};

describe('SettingsShell', () => {
  test('renders all five section names in the nav', () => {
    const t = shell();
    for (const name of [
      'Connections', 'Chat', 'Background work', 'What agents may do', 'Advanced',
    ]) expect(t).toContain(name);
  });

  test('the footer names the one surviving native panel', () => {
    // Not "There is no second settings page" — host-key approval is IPC-only
    // by design and must stay reachable only through Local itself. Stating the exception is
    // the acceptance test; overclaiming is not.
    const t = shell();
    expect(t).toContain('Local itself');
    expect(t).toContain('private channel');
    expect(t).not.toContain('There is no second settings page');
  });

  test('no hardcoded brand colour — #0ECAD4 is 2.02:1 on white', () => {
    expect(shell().toLowerCase()).not.toContain('0ecad4');
  });

  test('the Background work nav note comes from derived, never a literal', () => {
    // With real fleet counts and job run data, derived is computed and the
    // Background work nav note renders derived.navNote. Without them, derived
    // is null and the note is also null. A hardcoded '3 of 5 on' would pass
    // against null state but fail here.
    const t = shell({
      fleetCounts: { wpe: 10, external: 2, local: 5 },
      jobRunData: {
        wpeRefresh: { averageMs: 1200, lastRunAt: Date.now() },
        wpeSync: { averageMs: 800, lastRunAt: Date.now() },
        localContentIndex: { averageMs: null, lastRunAt: null },
      },
      settings: {
        wpeRefreshAutoEnabled: true,
        wpeSyncAutoEnabled: true,
        localContentIndexAutoEnabled: false,
      },
    });
    // derived.navNote for this config is '2 of 6 on' (6 switchable jobs, 2 enabled)
    expect(t).toContain('2 of 6 on');
  });
});

describe('SettingsShell — the panel nav note agrees with the gate that runs', () => {
  // `dockedPanelEnabled` is absent from DEFAULT_SETTINGS. The real gate
  // (src/renderer/index.tsx DockedPanelGate) and ChatSection's own toggle both
  // read `!== false`, so absent means ON. Truthiness put "panel off" in the nav
  // beside a ticked toggle and a running panel on every fresh install.
  test('absent means on', () => {
    expect(shell({ settings: {} })).toContain('panel on');
  });

  test('explicit true means on', () => {
    expect(shell({ settings: { dockedPanelEnabled: true } })).toContain('panel on');
  });

  test('only an explicit false means off', () => {
    const t = shell({ settings: { dockedPanelEnabled: false } });
    expect(t).toContain('panel off');
    expect(t).not.toContain('panel on');
  });
});

describe('SettingsShell — a failed save is not left on screen', () => {
  // UPDATE_SETTINGS never rejects: its handler catches everything and resolves
  // with `{ ...current, _error }`. A `.catch()` therefore never fires, and the
  // optimistic value stayed on screen asserting a change that never reached
  // disk — for every setting in the product.
  const mkShell = (invoke: jest.Mock, settings: any = { autoIndex: true }) => {
    const c: any = new (SettingsShell as any)({ electron: { ipcRenderer: { invoke } } });
    c.state = { ...c.state, loading: false, settings };
    c.mounted = true;
    c.setState = (patch: any) => {
      Object.assign(c.state, typeof patch === 'function' ? patch(c.state) : patch);
    };
    return c;
  };

  test('a resolved `_error` rolls the optimistic value back and toasts', async () => {
    const showToast = jest.fn();
    (global as any).window = { showToast };
    const invoke = jest.fn().mockResolvedValue({ autoIndex: true, _error: 'Unrecognized key(s)' });
    const c = mkShell(invoke, { autoIndex: true });

    c.saveSetting({ autoIndex: false });
    expect(c.state.settings.autoIndex).toBe(false); // optimistic
    await Promise.resolve(); await Promise.resolve();
    expect(c.state.settings.autoIndex).toBe(true);  // rolled back
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Unrecognized key(s)'), 'error',
    );
    delete (global as any).window;
  });

  test('a successful save keeps the optimistic value', async () => {
    (global as any).window = { showToast: jest.fn() };
    const invoke = jest.fn().mockResolvedValue({ autoIndex: false });
    const c = mkShell(invoke, { autoIndex: true });
    c.saveSetting({ autoIndex: false });
    await Promise.resolve(); await Promise.resolve();
    expect(c.state.settings.autoIndex).toBe(false);
    expect((global as any).window.showToast).not.toHaveBeenCalled();
    delete (global as any).window;
  });

  test('a rollback restores only the failed keys, not a concurrent save', async () => {
    (global as any).window = { showToast: jest.fn() };
    const invoke = jest.fn().mockResolvedValue({ _error: 'boom' });
    const c = mkShell(invoke, { autoIndex: true, chatRetentionDays: 30 });

    c.saveSetting({ autoIndex: false });
    // A different setting lands successfully while the first is in flight.
    Object.assign(c.state.settings, { chatRetentionDays: 7 });
    await Promise.resolve(); await Promise.resolve();

    expect(c.state.settings.autoIndex).toBe(true);        // rolled back
    expect(c.state.settings.chatRetentionDays).toBe(7);   // untouched
    delete (global as any).window;
  });

  test('a genuinely rejected invoke also rolls back', async () => {
    (global as any).window = { showToast: jest.fn() };
    const invoke = jest.fn().mockRejectedValue(new Error('no handler'));
    const c = mkShell(invoke, { autoIndex: true });
    c.saveSetting({ autoIndex: false });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(c.state.settings.autoIndex).toBe(true);
    delete (global as any).window;
  });
});
