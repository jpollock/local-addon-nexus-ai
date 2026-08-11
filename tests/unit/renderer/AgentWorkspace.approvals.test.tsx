import {
  AgentWorkspace,
  eventSeverity,
  formatDayLabel,
  groupApprovalsByDay,
} from '../../../src/renderer/components/agents/AgentWorkspace';
import type { ActivityEvent } from '../../../src/renderer/components/agents/AgentStore';
import { agentStore } from '../../../src/renderer/components/agents/AgentStore';

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: overrides.id ?? 'e1',
    agentId: 'security-sentinel',
    day: overrides.day ?? 'today',
    time: '19:12',
    type: 'Alert',
    status: 'review',
    text: 'finding',
    sub: 'suspicious-admin — new admin user created',
    siteName: 'acflikebutton',
    ...overrides,
  };
}

describe('eventSeverity — collapses the 5-level Finding scale to 3 display tiers', () => {
  it('maps critical and high findings to HIGH', () => {
    expect(eventSeverity(makeEvent({ findings: [{ id: 'f1', severity: 'critical', title: 't' }] }))).toBe('high');
    expect(eventSeverity(makeEvent({ findings: [{ id: 'f1', severity: 'high', title: 't' }] }))).toBe('high');
  });

  it('maps medium findings to MED', () => {
    expect(eventSeverity(makeEvent({ findings: [{ id: 'f1', severity: 'medium', title: 't' }] }))).toBe('medium');
  });

  it('maps low and info findings to LOW', () => {
    expect(eventSeverity(makeEvent({ findings: [{ id: 'f1', severity: 'low', title: 't' }] }))).toBe('low');
    expect(eventSeverity(makeEvent({ findings: [{ id: 'f1', severity: 'info', title: 't' }] }))).toBe('low');
  });

  it('uses the HIGHEST severity when an event carries multiple findings', () => {
    const event = makeEvent({
      findings: [
        { id: 'f1', severity: 'low', title: 't' },
        { id: 'f2', severity: 'critical', title: 't' },
        { id: 'f3', severity: 'medium', title: 't' },
      ],
    });
    expect(eventSeverity(event)).toBe('high');
  });

  it('falls back to medium when an event has no structured findings (a real gap, not a claim of low risk)', () => {
    expect(eventSeverity(makeEvent({ findings: undefined }))).toBe('medium');
    expect(eventSeverity(makeEvent({ findings: [] }))).toBe('medium');
  });
});

describe('formatDayLabel', () => {
  it('renders known day keys as friendly labels', () => {
    expect(formatDayLabel('today')).toBe('Today');
    expect(formatDayLabel('yest')).toBe('Yesterday');
  });

  it('passes through any other day key unchanged', () => {
    expect(formatDayLabel('Jul 20')).toBe('Jul 20');
  });
});

describe('groupApprovalsByDay', () => {
  it('groups events by day key, preserving first-seen order', () => {
    const events = [
      makeEvent({ id: 'a', day: 'today' }),
      makeEvent({ id: 'b', day: 'yest' }),
      makeEvent({ id: 'c', day: 'today' }),
    ];
    const groups = groupApprovalsByDay(events);
    expect(groups.map(([day]) => day)).toEqual(['today', 'yest']);
    expect(groups[0][1].map(e => e.id)).toEqual(['a', 'c']);
    expect(groups[1][1].map(e => e.id)).toEqual(['b']);
  });

  it('returns an empty array for no events', () => {
    expect(groupApprovalsByDay([])).toEqual([]);
  });
});

describe('AgentWorkspace — Approvals bulk actions', () => {
  function makeWorkspace() {
    const instance: any = new AgentWorkspace({
      agentId: 'security-sentinel',
      onBack: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn(() => Promise.resolve(null)) } },
      onReviewEvent: jest.fn(),
    });
    jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
      const update = typeof updater === 'function' ? updater(this.state) : updater;
      Object.assign(this.state, update);
    });
    return instance;
  }

  beforeEach(() => {
    agentStore.setState({ activityEvents: [] });
  });

  it('toggling a single approval adds/removes it from the selection', () => {
    const instance = makeWorkspace();
    instance['toggleApprovalSelection']('a');
    expect(instance.state.selectedApprovals).toEqual(new Set(['a']));
    instance['toggleApprovalSelection']('a');
    expect(instance.state.selectedApprovals).toEqual(new Set());
  });

  it('dismissing a single approval marks it dismissed in the store and drops it from the selection', () => {
    agentStore.setState({ activityEvents: [makeEvent({ id: 'a' }), makeEvent({ id: 'b' })] });
    const instance = makeWorkspace();
    instance.state.selectedApprovals = new Set(['a', 'b']);

    instance['dismissApproval']('a');

    const events = agentStore.getState().activityEvents;
    expect(events.find(e => e.id === 'a')?.status).toBe('dismissed');
    expect(events.find(e => e.id === 'b')?.status).toBe('review');
    expect(instance.state.selectedApprovals).toEqual(new Set(['b']));
  });

  it('bulk-dismissing selected approvals marks all of them dismissed and clears the selection', () => {
    agentStore.setState({ activityEvents: [makeEvent({ id: 'a' }), makeEvent({ id: 'b' }), makeEvent({ id: 'c' })] });
    const instance = makeWorkspace();
    instance.state.selectedApprovals = new Set(['a', 'c']);

    instance['dismissSelectedApprovals']();

    const events = agentStore.getState().activityEvents;
    expect(events.find(e => e.id === 'a')?.status).toBe('dismissed');
    expect(events.find(e => e.id === 'b')?.status).toBe('review');
    expect(events.find(e => e.id === 'c')?.status).toBe('dismissed');
    expect(instance.state.selectedApprovals).toEqual(new Set());
  });
});

describe('AgentWorkspace — renderApprovalsTab() smoke tests', () => {
  function makeWorkspace() {
    const instance: any = new AgentWorkspace({
      agentId: 'security-sentinel',
      onBack: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn(() => Promise.resolve(null)) } },
      onReviewEvent: jest.fn(),
    });
    return instance;
  }

  beforeEach(() => {
    agentStore.setState({ activityEvents: [] });
  });

  it('renders the empty state without throwing', () => {
    const instance = makeWorkspace();
    expect(() => instance['renderApprovalsTab']()).not.toThrow();
  });

  it('renders populated approvals — with and without a selection, with and without a known environment', () => {
    agentStore.setState({
      activityEvents: [
        makeEvent({ id: 'a', siteName: 'known-site', findings: [{ id: 'f1', severity: 'critical', title: 't' }] }),
        makeEvent({ id: 'b', siteName: undefined, findings: undefined }),
      ],
    });
    const instance = makeWorkspace();
    expect(() => instance['renderApprovalsTab']()).not.toThrow();

    instance.state.selectedApprovals = new Set(['a']);
    expect(() => instance['renderApprovalsTab']()).not.toThrow();
  });
});

describe('AgentWorkspace — Approvals tab visibility follows producesApprovals', () => {
  function makeWorkspace(producesApprovals: boolean | undefined) {
    const instance: any = new AgentWorkspace({
      agentId: 'log-processor',
      onBack: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn(() => Promise.resolve(null)) } },
      onReviewEvent: jest.fn(),
    });
    instance.state.status = producesApprovals === undefined ? null : { producesApprovals };
    return instance;
  }

  function flattenText(node: any): string {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flattenText).join(' ');
    if (node?.props?.children !== undefined) return flattenText(node.props.children);
    return '';
  }

  it('hides the Approvals tab when the agent declares producesApprovals: false', () => {
    const instance = makeWorkspace(false);
    expect(flattenText(instance['renderTabBar']())).not.toContain('Approvals');
  });

  it('shows the Approvals tab when the agent declares producesApprovals: true', () => {
    const instance = makeWorkspace(true);
    expect(flattenText(instance['renderTabBar']())).toContain('Approvals');
  });

  it('shows the Approvals tab while status is still loading, to avoid a flash on mount', () => {
    const instance = makeWorkspace(undefined);
    expect(flattenText(instance['renderTabBar']())).toContain('Approvals');
  });
});

describe('AgentWorkspace — header Autonomy line follows producesApprovals', () => {
  function makeWorkspace(producesApprovals: boolean | undefined) {
    const instance: any = new AgentWorkspace({
      agentId: 'log-processor',
      onBack: jest.fn(),
      electron: { ipcRenderer: { invoke: jest.fn(() => Promise.resolve(null)) } },
      onReviewEvent: jest.fn(),
    });
    instance.state.status = producesApprovals === undefined ? null : { producesApprovals };
    return instance;
  }

  function flattenText(node: any): string {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flattenText).join(' ');
    if (node?.props?.children !== undefined) return flattenText(node.props.children);
    return '';
  }

  it('hides the sandbox/remediation copy when producesApprovals is false — it never applies to this agent', () => {
    const instance = makeWorkspace(false);
    const text = flattenText(instance['renderHeader']());
    expect(text).not.toContain('sandbox');
    expect(text).not.toContain('production approval');
  });

  it('shows the autonomy line when producesApprovals is true', () => {
    const instance = makeWorkspace(true);
    expect(flattenText(instance['renderHeader']())).toContain('Investigates on its own');
  });

  it('shows the autonomy line while status is still loading, to avoid a flash', () => {
    const instance = makeWorkspace(undefined);
    expect(flattenText(instance['renderHeader']())).toContain('Investigates on its own');
  });
});
