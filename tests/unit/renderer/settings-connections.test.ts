/**
 * ConnectionsSection: Grouped by what each thing gets you.
 *
 * NOTE ON SERIALIZATION. These call `new Component(props).render()` rather than
 * `serializeTree(createElement(Component, props))` — the latter serializes to
 * the props bag and makes every assertion vacuous. See sites-tab.test.ts.
 */
import { ConnectionsSection } from '../../../src/renderer/components/settings/ConnectionsSection';
import { serializeTree } from './helpers/serializeTree';

const tree = (over: any = {}) => {
  const { settings, wpeAccounts, externalHosts, ...rest } = over;
  return JSON.stringify(serializeTree(
    new (ConnectionsSection as any)({
      settings: { aiProvider: 'anthropic', useLocalGateway: false, ...settings },
      wpeAccounts: wpeAccounts ?? [],
      externalHosts: externalHosts ?? [],
      onSave: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn() } },
      ...rest,
    }).render()));
};

describe('ConnectionsSection', () => {
  test('renders the three group headings', () => {
    const t = tree();
    expect(t).toContain('Where your sites are');
    expect(t).toContain('How Nexus answers you');
    expect(t).toContain('What else Nexus can do');
  });

  test('says what the S3 credential unlocks, not its product name', () => {
    const t = tree();
    expect(t).toContain('Reading access logs');
    expect(t).not.toContain('AWS S3 credentials');
  });

  test('the gateway is nested under the provider, not a peer', () => {
    expect(tree()).toContain('Let WordPress sites use it too');
  });

  test('no hardcoded brand colour', () => {
    expect(tree().toLowerCase()).not.toContain('0ecad4');
  });
});
