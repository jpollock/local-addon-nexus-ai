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
    // by design and must stay in Local's Preferences. Stating the exception is
    // the acceptance test; overclaiming is not.
    const t = shell();
    expect(t).toContain('Local → Preferences → Nexus AI');
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
