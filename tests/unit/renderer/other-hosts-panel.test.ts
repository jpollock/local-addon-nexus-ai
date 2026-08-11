import { OtherHostsPanel } from '../../../src/renderer/components/settings/OtherHostsPanel';
import { serializeTree } from './helpers/serializeTree';

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  const children = node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) findAll(k, pred, out);
  return out;
}

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

const inst = (over: any = {}) => {
  const i = new (OtherHostsPanel as any)({
    externalHosts: over.externalHosts ?? [],
    electron: { ipcRenderer: { invoke: jest.fn().mockResolvedValue({ success: true, hosts: [] }) } },
    ...over,
  });
  // state.hosts is seeded from the prop in the field initialiser; componentDidMount
  // is never called in these tests, so nothing overwrites it.
  return i;
};

const text = (over: any = {}) => JSON.stringify(serializeTree(inst(over).render()));

describe('OtherHostsPanel — empty state', () => {
  it('states what it can do before asking for any credentials', () => {
    const t = text();
    expect(t).toContain('Read what is installed');
    expect(t).toContain('answer questions in chat');
  });

  it('states the limits in the same breath, not after connecting', () => {
    const t = text();
    expect(t).toContain('those are WP Engine only');
    expect(t).toContain("Backups and staging stay with your host's own tools");
  });

  it('offers a way to add a host', () => {
    expect(text()).toContain('Add a host');
  });

  it('couples the cannot column to externalHostCapabilities() — drift on a capability becoming available fails here', () => {
    const { externalHostCapabilities } = require('../../../src/renderer/components/settings/hostCapabilities');
    const capabilities = externalHostCapabilities();
    const unavailable = capabilities.filter((c: any) => c.state === 'unavailable');
    const allowed = capabilities.filter((c: any) => c.state === 'allowed' || c.state === 'gated');
    const t = text();

    // "Cannot" column must list every unavailable capability's label
    for (const cap of unavailable) {
      expect(t).toContain(cap.label);
    }

    // "Can do" column must represent every allowed/gated capability by label or evident equivalent.
    // The test is one-directional: it catches drift when a capability becomes available.
    // The prose is allowed to name things the permission model does not represent.
    for (const cap of allowed) {
      const id = cap.id;
      const labelLower = cap.label.toLowerCase();
      const tLower = t.toLowerCase();

      // Each capability must be represented by its label or an evident equivalent.
      // "Read what is installed, and make it searchable" is represented by
      // "read what is installed · index page and post text so they are searchable"
      if (id === 'read') {
        expect(tLower).toContain('read what is installed');
        expect(tLower).toContain('searchable');
      } else if (id === 'wpcli') {
        // "Install or update things" appears as "install or update things, if you allow it"
        expect(tLower).toContain('install or update things');
      } else {
        // Fallback: exact label match (case-insensitive)
        expect(tLower).toContain(labelLower);
      }
    }
  });
});

describe('OtherHostsPanel — host list', () => {
  const twoSites = [
    { alias: 'boxa', site: 'one', environment: 'production', domain: 'one.com', wpPath: '/home/u/one' },
    { alias: 'boxa', site: 'two', environment: 'staging', domain: 'two.com', wpPath: '/home/u/two' },
    { alias: 'boxb', site: 'solo', environment: 'production', domain: 'solo.com', wpPath: '/home/u/solo' },
  ];

  it('groups sites under one row per host, not one row per site', () => {
    const rows = inst({ externalHosts: twoSites }).hostRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.alias === 'boxa').siteCount).toBe(2);
  });

  it('keeps a host listed when it has zero followed sites', () => {
    const i = inst({ externalHosts: [] });
    i.state.sshConfigHosts = [{ alias: 'empty-host', hostname: 'h', user: 'u', port: '22', alreadyRegistered: true }];
    expect(i.hostRows().find((r: any) => r.alias === 'empty-host')).toBeTruthy();
  });

  it('shows the resolved connection string, marked as coming from ssh config', () => {
    const i = inst({ externalHosts: twoSites });
    i.state.sshConfigHosts = [{ alias: 'boxa', hostname: '10.0.0.5', user: 'deploy', port: '2222', alreadyRegistered: true }];
    expect(i.hostRows().find((r: any) => r.alias === 'boxa').connection)
      .toBe('deploy@10.0.0.5:2222 · from ~/.ssh/config');
  });

  it('reports connection unknown rather than inventing one when the alias is gone from ssh config', () => {
    const i = inst({ externalHosts: twoSites });
    i.state.sshConfigHosts = [];
    const row = i.hostRows().find((r: any) => r.alias === 'boxa');
    expect(row.connection).toBeNull();
    expect(row.configured).toBe(false);
  });
});

describe('OtherHostsPanel — add screen', () => {
  it('Add a host opens the wizard as the add screen', () => {
    const i = inst();
    spySetState(i);
    i.setState({ screen: { name: 'add' } });
    const t = JSON.stringify(serializeTree(i.render()));
    expect(t).toContain('ExternalHostAddWizard');
  });

  it('closing the wizard returns to the list', () => {
    const i = inst();
    spySetState(i);
    i.setState({ screen: { name: 'add' } });
    i.closeAdd();
    expect(i.state.screen).toEqual({ name: 'list' });
  });

  it('completing the wizard reloads the host list', () => {
    const i = inst();
    spySetState(i);
    i.reload = jest.fn().mockResolvedValue(undefined);
    i.setState({ screen: { name: 'add' } });
    i.completeAdd('newbox');
    expect(i.reload).toHaveBeenCalled();
    expect(i.state.screen).toEqual({ name: 'list' });
  });
});
