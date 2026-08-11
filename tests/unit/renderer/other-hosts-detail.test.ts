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
    electron: over.electron ?? { ipcRenderer: { invoke: jest.fn().mockResolvedValue({ success: true, hosts: [] }) } },
    ...over,
  });
  spySetState(i);
  i.mounted = true; // componentDidMount is not called in tests
  return i;
};

describe('host detail', () => {
  const hosts = [{ alias: 'boxa', site: 'one', environment: 'production', domain: 'one.com', wpPath: '/home/u/one' }];

  it('renders the three capability states, with wpcli gated rather than allowed', () => {
    const i = inst({ externalHosts: hosts });
    i.setState({ screen: { name: 'detail', alias: 'boxa' } });
    const t = JSON.stringify(serializeTree(i.render()));
    expect(t).toContain('Install or update things');
    expect(t).toContain('If you allow it under What agents may do');
    expect(t).toContain('WP Engine only');
  });

  it('attributes the connection limit to Nexus, never to the server', () => {
    const i = inst({ externalHosts: hosts });
    i.setState({ screen: { name: 'detail', alias: 'boxa' } });
    const t = JSON.stringify(serializeTree(i.render()));
    expect(t).toContain('a fixed limit on our side, not something read from your server');
  });

  it('Check it now re-probes only this host', async () => {
    const i = inst({ externalHosts: hosts });
    const gql = jest.fn().mockResolvedValue({ installs: [] });
    i.runProbe = gql;
    await i.checkItNow('boxa');
    expect(gql).toHaveBeenCalledTimes(1);
    expect(gql.mock.calls[0][0]).toBe('boxa');
  });

  it('Check it now surfaces a newly-discovered install without disturbing followed sites', async () => {
    const i = inst({ externalHosts: hosts });
    i.runProbe = jest.fn().mockResolvedValue({ installs: ['/home/u/one', '/home/u/brand-new'] });
    await i.checkItNow('boxa');
    expect(i.state.discovered['boxa']).toContain('/home/u/brand-new');
    expect(i.state.discovered['boxa']).not.toContain('/home/u/one');
    // the followed site is untouched
    expect(i.state.hosts).toEqual(hosts);
  });

  it('the root-mode control persists through SET_EXTERNAL_HOST_ROOT_MODE', async () => {
    const invoke = jest.fn().mockResolvedValue({ success: true });
    const i = inst({ externalHosts: hosts, electron: { ipcRenderer: { invoke } } });
    await i.setRootMode('boxa', true);
    const call = invoke.mock.calls.find((c: any[]) => String(c[0]).includes('root-mode'));
    expect(call).toBeTruthy();
    expect(call.slice(1)).toEqual(['boxa', true]);
  });
});
