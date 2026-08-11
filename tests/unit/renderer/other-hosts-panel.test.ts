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
});

describe('OtherHostsPanel — host list', () => {
  const twoSites = [
    { alias: 'boxa', site: 'one', environment: 'production', domain: 'one.com' },
    { alias: 'boxa', site: 'two', environment: 'staging', domain: 'two.com' },
    { alias: 'boxb', site: 'solo', environment: 'production', domain: 'solo.com' },
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
