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
});
