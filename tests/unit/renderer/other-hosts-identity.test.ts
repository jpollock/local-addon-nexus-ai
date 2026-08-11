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

  it('never approves the key itself — accept only routes to Local', () => {
    const invoke = jest.fn();
    const i = inst({ electron: { ipcRenderer: { invoke } } });
    i.setState({ screen: { name: 'identityChanged', alias: 'boxa' }, identity: { boxa: { approved: 'a', current: 'b', approvedAt: 'x' } } });
    i.acceptIdentity('boxa');
    const trusted = invoke.mock.calls.find((c: any[]) => String(c[0]).includes('trust-external-host-key'));
    expect(trusted).toBeFalsy();
  });
});
