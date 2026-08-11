import { AgentRunModal } from '../../../src/renderer/components/agents/AgentRunModal';
import { IPC_CHANNELS } from '../../../src/common/constants';
import type { ScopeSite } from '../../../src/renderer/components/agents/fetchScopeSites';

const SITES: ScopeSite[] = [
  { id: 'p1', name: 'prod-one', environment: 'production', platform: 'WP Engine' },
  { id: 's1', name: 'stage-one', environment: 'staging', platform: 'WP Engine' },
  { id: 'l1', name: 'local-one', environment: 'local', platform: 'Local' },
];

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function makeModal(overrides: Partial<any> = {}) {
  const onRun = jest.fn();
  const onCancel = jest.fn();
  const electron = {
    ipcRenderer: {
      invoke: jest.fn(() => Promise.resolve({ ok: true })),
    },
  };
  const instance: any = new AgentRunModal({
    agentName: 'Security Sentinel',
    agentId: 'security-sentinel',
    electron,
    supportsFullRun: false,
    allowsProduction: overrides.allowsProduction ?? true,
    effect: overrides.effect ?? 'writes',
    scheduleScope: overrides.scheduleScope,
    siteScoped: overrides.siteScoped ?? true,
    onCancel,
    onRun,
  });
  spySetState(instance);
  instance.state.sites = overrides.sites ?? SITES;
  return { instance, onRun, onCancel, electron };
}

describe('AgentRunModal — prefill from schedule scope', () => {
  it('prefills the run-local selection with the schedule scope exactly', () => {
    const { instance } = makeModal({ scheduleScope: { siteIds: ['s1', 'l1'] } });
    expect(instance['initialSelection'](SITES)).toEqual(new Set(['s1', 'l1']));
  });

  it('falls back to non-production sites when no schedule scope has ever been saved', () => {
    const { instance } = makeModal({ scheduleScope: undefined });
    expect(instance['initialSelection'](SITES)).toEqual(new Set(['s1', 'l1']));
  });

  it('excludes policy-locked production sites from the prefill even if the saved schedule scope includes them', () => {
    const { instance } = makeModal({ scheduleScope: { siteIds: ['p1', 's1'] }, allowsProduction: false });
    expect(instance['initialSelection'](SITES)).toEqual(new Set(['s1']));
  });
});

describe('AgentRunModal — delta vs schedule scope', () => {
  it('reports unmodified when the run-local selection matches the schedule scope exactly', () => {
    const { instance } = makeModal({ scheduleScope: { siteIds: ['s1', 'l1'] } });
    instance.state.selection = new Set(['s1', 'l1']);
    expect(instance['getDelta']()).toEqual({ added: 0, removed: 0, modified: false });
  });

  it('counts added and removed sites correctly when the selection diverges', () => {
    const { instance } = makeModal({ scheduleScope: { siteIds: ['s1', 'l1'] } });
    instance.state.selection = new Set(['s1', 'p1']); // dropped l1, added p1
    expect(instance['getDelta']()).toEqual({ added: 1, removed: 1, modified: true });
  });

  it('"Reset to schedule scope" restores the prefill exactly, discarding local edits', () => {
    const { instance } = makeModal({ scheduleScope: { siteIds: ['s1'] } });
    instance.state.selection = new Set(['p1', 'l1']); // edited away from the schedule scope
    instance['resetToScheduleScope']();
    expect(instance.state.selection).toEqual(new Set(['s1']));
  });
});

/** Flattens a React.createElement tree's text content into one string — good enough to assert a
 * sentence appears somewhere in render() output without a real DOM. */
function flattenText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (node?.props?.children !== undefined) return flattenText(node.props.children);
  return '';
}

describe('AgentRunModal — production warning (v2 escalation)', () => {
  it('shows the agent-derived warning sentence in the footer when production is selected', () => {
    const { instance } = makeModal({ effect: 'readonly' });
    instance.state.loading = false;
    instance.state.selection = new Set(['p1', 's1']);
    const tree = instance.render();
    expect(flattenText(tree)).toContain('1 live production site will be scanned.');
  });

  it('uses "modified" for a writing agent instead of "scanned"', () => {
    const { instance } = makeModal({ effect: 'writes' });
    instance.state.loading = false;
    instance.state.selection = new Set(['p1']);
    const tree = instance.render();
    expect(flattenText(tree)).toContain('will be modified.');
  });

  it('does not show a production warning when no production site is selected', () => {
    const { instance } = makeModal();
    instance.state.loading = false;
    instance.state.selection = new Set(['s1', 'l1']);
    const tree = instance.render();
    expect(flattenText(tree)).not.toContain('live production site');
  });
});

describe('AgentRunModal — run', () => {
  it('sends site NAMES (not IDs) to AGENT_RUN_NOW, matching the existing IPC contract', async () => {
    const { instance, electron, onRun } = makeModal({ scheduleScope: { siteIds: ['s1', 'l1'] } });
    instance.state.selection = new Set(['s1', 'l1']);

    await instance['handleRun']();

    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_RUN_NOW, {
      agentId: 'security-sentinel',
      siteNames: expect.arrayContaining(['stage-one', 'local-one']),
      fullRun: false,
    });
    expect(onRun).toHaveBeenCalled();
  });

  it('does not double-run when already running', async () => {
    const { instance, electron } = makeModal();
    instance.state.isRunning = true;
    await instance['handleRun']();
    expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled();
  });
});
