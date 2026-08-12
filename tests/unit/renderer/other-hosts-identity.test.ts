import { OtherHostsPanel } from '../../../src/renderer/components/settings/OtherHostsPanel';
import { serializeTree } from './helpers/serializeTree';

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
  return i;
};

describe('OtherHostsPanel — identity changed screen', () => {
  it('shows both fingerprints and the approval date', () => {
    const i = inst({ externalHosts: [{ alias: 'boxa', site: 'one', environment: 'production', domain: 'one.com', wpPath: '/home/u/one' }] });
    i.setState({
      screen: { name: 'identityChanged', alias: 'boxa' },
      identity: { boxa: { approved: 'SHA256:OLD', current: 'SHA256:NEW', approvedAt: '2026-01-04' } },
    });
    const t = JSON.stringify(serializeTree(i.render()));
    expect(t).toContain('SHA256:OLD');
    expect(t).toContain('SHA256:NEW');
    expect(t).toContain('2026-01-04');
  });

  it('names and rejects the reasoning people actually use', () => {
    const i = inst({ externalHosts: [{ alias: 'boxa', site: 'one', environment: 'production', domain: 'one.com', wpPath: '/home/u/one' }] });
    i.setState({ screen: { name: 'identityChanged', alias: 'boxa' }, identity: { boxa: { approved: 'a', current: 'b', approvedAt: 'x' } } });
    expect(JSON.stringify(serializeTree(i.render())))
      .toContain('a site seeming fine is exactly what an impersonation looks like');
  });

  it('approves only on an explicit click, with the fingerprint the host is offering', async () => {
    // Not auto-accept: nothing here trusts a key without the human pressing this, and
    // the value sent is the fingerprint on screen, never one inferred or remembered.
    const invoke = jest.fn().mockResolvedValue({ success: true });
    const i = inst({ electron: { ipcRenderer: { invoke } } });
    i.mounted = true;
    i.reload = jest.fn().mockResolvedValue(undefined);
    i.setState({
      screen: { name: 'identityChanged', alias: 'boxa' },
      identity: { boxa: { approved: 'SHA256:OLD', current: 'SHA256:NEW', approvedAt: 'x' } },
    });

    await i.acceptIdentity('boxa');

    const trusted = invoke.mock.calls.find((c: any[]) => String(c[0]).includes('trust-external-host-key'));
    expect(trusted).toBeTruthy();
    expect(trusted.slice(1)).toEqual(['boxa', 'SHA256:NEW']);
    // Approved hosts go back to their detail screen rather than sitting on the warning.
    expect(i.state.screen).toEqual({ name: 'detail', alias: 'boxa' });
  });

  it('refuses to approve when there is no fingerprint to approve', async () => {
    // Guards against sending undefined to the trust channel if the probe never returned
    // a key — approving "nothing" would be worse than refusing.
    const invoke = jest.fn();
    const i = inst({ electron: { ipcRenderer: { invoke } } });
    i.mounted = true;
    i.setState({ screen: { name: 'identityChanged', alias: 'boxa' }, identity: {} });

    await i.acceptIdentity('boxa');

    expect(invoke).not.toHaveBeenCalled();
    expect(i.state.identityError).toBeTruthy();
  });

  it('surfaces a failed approval instead of pretending it worked', async () => {
    const invoke = jest.fn().mockResolvedValue({ success: false, error: 'known_hosts is read-only' });
    const i = inst({ electron: { ipcRenderer: { invoke } } });
    i.mounted = true;
    i.setState({
      screen: { name: 'identityChanged', alias: 'boxa' },
      identity: { boxa: { approved: 'a', current: 'b', approvedAt: 'x' } },
    });

    await i.acceptIdentity('boxa');

    expect(i.state.identityError).toContain('read-only');
    // Still on the warning screen — a failed approval must not look like success.
    expect(i.state.screen).toEqual({ name: 'identityChanged', alias: 'boxa' });
  });
});
