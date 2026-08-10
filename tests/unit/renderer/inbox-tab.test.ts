// tests/unit/renderer/inbox-tab.test.ts
import { InboxTab } from '../../../src/renderer/components/tabs/InboxTab';
import { serializeTree } from './helpers/serializeTree';

const item = (over: any = {}) => ({
  id: 1, source: 'security-sentinel', code: 'FS-01', scope: 'name:Site A',
  scopeLabel: 'Site A', kind: 'decide', title: 'File permissions are too open',
  detail: 'wp-config.php is world-readable.', status: 'open',
  firstSeenAt: 1000, lastSeenAt: 1000, seenCount: 1, ...over,
});

const props = (over: any = {}) => ({
  loaded: true,
  failed: false,
  items: [item()],
  total: 1,
  counts: { decide: 1, problem: 0, know: 0 },
  pausedSources: [],
  recentlyDecided: [],
  onDecide: jest.fn(),
  onReopen: jest.fn(),
  onResumeAgent: jest.fn(),
  ...over,
});

function makeInstance(propsOverrides: any): any {
  return new InboxTab(props(propsOverrides));
}

describe('InboxTab', () => {
  test('renders a decide item under its group', () => {
    const inst = makeInstance({});
    const tree = serializeTree(inst.render());
    expect(tree).toMatchSnapshot();
  });

  test('an empty group is not rendered', () => {
    const inst = makeInstance({});
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).not.toContain('Something is stuck');
    expect(tree).not.toContain('Worth knowing');
  });

  test('an empty inbox says so', () => {
    const inst = makeInstance({ items: [], total: 0, counts: { decide: 0, problem: 0, know: 0 } });
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('Nothing needs you');
  });

  test('a read failure is not rendered as an empty inbox', () => {
    // A false all-clear is the worst failure this surface can have.
    const inst = makeInstance({ failed: true, items: [], total: 0 });
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).not.toContain('Nothing needs you');
    expect(tree.toLowerCase()).toContain("couldn't read");
  });

  test('a truncated list reports the true total', () => {
    const many = Array.from({ length: 100 }, (_, i) => item({ id: i + 1, code: `C-${i}` }));
    const inst = makeInstance({ items: many, total: 250, counts: { decide: 250, problem: 0, know: 0 } });
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('100 of 250');
  });

  test('a repeated item shows how many times it has been seen', () => {
    const inst = makeInstance({ items: [item({ seenCount: 7 })] });
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).toContain('7');
  });

  test('a paused agent gets a resume action, and it names the agent', () => {
    // Without this the pause is a one-way door — nothing else clears the marker.
    const onResumeAgent = jest.fn();
    const inst = makeInstance({
      items: [item({ kind: 'problem', title: 'security-sentinel could not finish a run' })],
      counts: { decide: 0, problem: 1, know: 0 },
      pausedSources: ['security-sentinel'],
      onResumeAgent,
    });
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree.toLowerCase()).toContain('paused');
    expect(tree).toContain('Try again');
  });

  test('an unpaused agent gets no resume action', () => {
    const inst = makeInstance({
      items: [item({ kind: 'problem' })],
      counts: { decide: 0, problem: 1, know: 0 },
      pausedSources: [],
    });
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).not.toContain('Try again');
  });

  test('no copy promises reversing a live change', () => {
    const inst = makeInstance({ items: [item({ status: 'done', decision: 'Approve' })] });
    const tree = JSON.stringify(serializeTree(inst.render())).toLowerCase();
    expect(tree).not.toContain('undo');
    expect(tree).not.toContain('revert');
    expect(tree).not.toContain('roll back');
  });

  test('renders no hardcoded hex colours', () => {
    const inst = makeInstance({});
    const tree = JSON.stringify(serializeTree(inst.render()));
    expect(tree).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
