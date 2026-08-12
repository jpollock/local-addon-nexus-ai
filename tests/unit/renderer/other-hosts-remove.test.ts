import { OtherHostsPanel } from '../../../src/renderer/components/settings/OtherHostsPanel';
import { serializeTree } from './helpers/serializeTree';

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  // Serialized trees have children as a direct property, not in props
  const children = node.children ?? node.props?.children;
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

describe('remove host confirmation', () => {
  it('states what disappears, that the server is untouched, and that it is re-addable — in that order', () => {
    const i = inst({ externalHosts: [{ alias: 'boxa', site: 'one', environment: 'production', domain: 'one.com', wpPath: '/home/u/one' }] });
    i.setState({ screen: { name: 'remove', alias: 'boxa' } });
    const t = JSON.stringify(serializeTree(i.render()));
    const disappear = t.indexOf('disappear from your sites list');
    const untouched = t.indexOf('The server is not touched');
    const readd = t.indexOf('add it again later');
    expect(disappear).toBeGreaterThan(-1);
    expect(untouched).toBeGreaterThan(disappear);
    expect(readd).toBeGreaterThan(untouched);
  });

  it('names the real followed-site count, not a placeholder', () => {
    const i = inst({ externalHosts: [
      { alias: 'boxa', site: 'one', environment: 'production', domain: 'a', wpPath: '/home/u/one' },
      { alias: 'boxa', site: 'two', environment: 'staging', domain: 'b', wpPath: '/home/u/two' },
    ] });
    i.setState({ screen: { name: 'remove', alias: 'boxa' } });
    expect(JSON.stringify(serializeTree(i.render()))).toContain('2');
  });

  it('confirms with the full verb, never OK', () => {
    const i = inst();
    i.setState({ screen: { name: 'remove', alias: 'boxa' } });
    const t = JSON.stringify(serializeTree(i.render()));
    expect(t).toContain('Remove host');
    expect(t).not.toContain('">OK<"');
  });

  it('requires no typed confirmation — removal is reversible by re-adding', () => {
    const i = inst();
    i.setState({ screen: { name: 'remove', alias: 'boxa' } });
    const inputs = findAll(serializeTree(i.render()), (n: any) => n.type === 'input');
    expect(inputs).toHaveLength(0);
  });

  it('Cancel is a real focusable element (button), not a div with autoFocus', () => {
    const i = inst();
    i.setState({ screen: { name: 'remove', alias: 'boxa' } });
    const tree = serializeTree(i.render());

    const cancelButtons = findAll(tree, (n: any) =>
      n.type === 'button' && n.children === 'Cancel'
    );
    expect(cancelButtons).toHaveLength(1);
    expect(cancelButtons[0].props.autoFocus).toBe(true);
  });
});
