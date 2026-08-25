import { AgentWorkspaceSettings } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';
import { AgentCard } from '../../../src/renderer/components/agents/AgentCard';
import { agentStore, AgentStatus } from '../../../src/renderer/components/agents/AgentStore';

/**
 * An agent whose manifest declares no cron trigger cannot be put on a schedule — by anyone, ever.
 * `AgentScheduler.register()` returns at `if (cronTriggers.length === 0)` before scheduling
 * anything, and `effectiveCadenceExpression` refuses to let a stored cadence conjure a schedule
 * that was never built.
 *
 * `cronExpression` is a PROP here, so these cases are about the rule, not about any one agent.
 * security-sentinel is used as the id only because it is the agent with entries in EVENT_CATALOG
 * — it was the agent in this state, and the answer to that was to give it a real cron trigger
 * (`agents/security-sentinel/agent.js`), not to restore controls that could not have worked.
 *
 * Two surfaces got that wrong in opposite directions, so they are tested together: Settings
 * OFFERED the controls (a live toggle and a cadence picker that wrote `scheduleEnabled`,
 * `cadence` and `cadenceSetAt` to disk, where nothing downstream can read them, while the label
 * beside them kept reading "Not scheduled" however many times it was clicked), and the hub card
 * READ the toggle alone, printing "Not scheduled" under the heading "Schedule" — permanently,
 * because the control that could have cleared the stale flag is now gone.
 */

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function flattenText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (node?.props?.children !== undefined) return flattenText(node.props.children);
  return '';
}

const findByType = (node: any, name: string): any[] => {
  if (!node || typeof node !== 'object') return [];
  const hits = node.type && (node.type.name === name || node.type === name) ? [node] : [];
  const kids = node.props?.children;
  const arr = Array.isArray(kids) ? kids : kids ? [kids] : [];
  return arr.reduce((acc: any[], k: any) => acc.concat(findByType(k, name)), hits);
};

function makeSettings(props: Partial<any> = {}) {
  const instance: any = new AgentWorkspaceSettings({
    agentId: 'security-sentinel', electron: undefined, ...props,
  });
  spySetState(instance);
  instance.state.scopeSites = [];
  instance.state.settings = {
    ...instance.state.settings,
    // The stale flag a no-cron agent can still be carrying, written before the toggle was
    // withdrawn. Every assertion below holds with it set — that is the point.
    scheduleEnabled: true,
    scope: { siteIds: [] },
  };
  return instance;
}

describe('AgentWorkspaceSettings — the schedule row for an agent that declares no timer', () => {
  beforeEach(() => {
    agentStore.setState({ agentSettings: {}, autonomyById: {}, pendingBySource: {} } as any);
  });

  it('states why there is no schedule instead of offering controls that cannot make one', () => {
    const rendered = makeSettings({ cronExpression: null }).render();
    const text = flattenText(rendered);
    expect(text).toContain('Not on a schedule — this agent declares no timer');
    // Not merely "no cadence button": the toggle beside it wrote `scheduleEnabled` to disk too.
    expect(text).not.toContain('On a schedule');
    expect(text).not.toContain('Not scheduled');
  });

  it('removes the schedule toggle rather than disabling it', () => {
    // Counted as a difference, because this page has other toggles (events, transcripts) and an
    // absolute count would pin those instead. The schedule row contributes exactly one switch,
    // and a no-cron agent must contribute none: a disabled control still tells the user a
    // setting exists here, and this one wrote `scheduleEnabled` to disk for nobody to read.
    const without = findByType(makeSettings({ cronExpression: null }).render(), 'ToggleSwitch');
    const with_ = findByType(makeSettings({ cronExpression: '0 3 * * *' }).render(), 'ToggleSwitch');
    expect(with_.length).toBe(without.length + 1);
  });

  it('names the triggers it does have, so the sentence is not a dead end', () => {
    // security-sentinel subscribes to two events, so Run Now is not the only way it ever fires.
    expect(flattenText(makeSettings({ cronExpression: null }).render()))
      .toContain('It runs on the events below');
    // An agent with neither a cron nor an event catalog gets the honest narrower sentence.
    expect(flattenText(makeSettings({ agentId: 'no-triggers-at-all', cronExpression: null }).render()))
      .toContain('It runs only when you press Run now');
  });

  it('withholds the site-scope block too, which would answer a question the row above denies', () => {
    // `scheduleEnabled` is true and the agent is site-scoped: before the fix that was enough to
    // render "which sites the schedule may touch" directly beneath "this agent declares no timer".
    const text = flattenText(makeSettings({ cronExpression: null, siteScoped: true }).render());
    expect(text).not.toContain('SITES IN SCOPE');
  });

  it('still gives both controls to an agent that does have a manifest cron', () => {
    const rendered = makeSettings({ cronExpression: '0 3 * * *' }).render();
    const text = flattenText(rendered);
    expect(text).toContain('On a schedule');
    // And the button reads the schedule that actually runs, not the seeded */15 nobody picked.
    expect(text).toContain('Daily at 03:00');
    expect(text).not.toContain('Every 15 minutes');
    expect(text).not.toContain('Not on a schedule');
  });

  it('lets a cadence the user really picked win the label', () => {
    const instance = makeSettings({ cronExpression: '0 3 * * *' });
    instance.state.settings = { ...instance.state.settings, cadence: '0 * * * *', cadenceSetAt: 1 };
    expect(flattenText(instance.render())).toContain('Hourly');
  });
});

const status = (over: Partial<AgentStatus> = {}): AgentStatus => ({
  name: 'security-sentinel',
  version: '1.0.0',
  description: null,
  cronExpression: null,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunDurationMs: null,
  lastRunError: null,
  supportsFullRun: false,
  allowsProduction: true,
  effect: 'writes',
  producesApprovals: false,
  producesReports: false,
  siteScoped: true,
  ...over,
});

/** The value printed above a named mini-stat label — 'Schedule' and 'Last status' both exist. */
function statValue(node: any, label: string): string | null {
  if (!node || typeof node !== 'object') return null;
  const kids = node.props?.children;
  const arr = Array.isArray(kids) ? kids : kids ? [kids] : [];
  if (arr.length === 2 && arr[1]?.props?.children === label) return flattenText(arr[0]);
  for (const k of arr) {
    const hit = statValue(k, label);
    if (hit !== null) return hit;
  }
  return null;
}

describe('AgentCard — the Schedule mini-stat for an agent that declares no timer', () => {
  const seed = (settings: any) => agentStore.setState({
    agentSettings: { 'security-sentinel': settings }, pendingBySource: {},
  } as any);

  afterEach(() => agentStore.setState({ agentSettings: {}, pendingBySource: {} } as any));

  it('prints nothing rather than "Not scheduled" when the flag is stale', () => {
    // Reading `scheduleEnabled` alone put a promise of a schedule under the word Schedule, on an
    // agent that has none and no longer has a control to clear the flag with.
    seed({ enabled: true, scheduleEnabled: true, cadence: '*/15 * * * *', cadenceSetAt: 1, eventsEnabled: false, subscribedEvents: {}, scope: { siteIds: [] } });
    const rendered = new (AgentCard as any)({ status: status(), onSelect: () => {} }).render();
    expect(statValue(rendered, 'Schedule')).toBe('—');
    expect(flattenText(rendered)).not.toContain('Not scheduled');
    // The neighbouring stat is unaffected — '—' there is its own, separate honest answer.
    expect(statValue(rendered, 'Last status')).toBe('—');
  });

  it('prints the real schedule when there is one', () => {
    seed({ enabled: true, scheduleEnabled: true, eventsEnabled: false, subscribedEvents: {}, scope: { siteIds: [] } });
    const rendered = new (AgentCard as any)({
      status: status({ cronExpression: '0 3 * * *' }), onSelect: () => {},
    }).render();
    expect(statValue(rendered, 'Schedule')).toBe('Daily at');
  });

  it('prints nothing when a schedulable agent has its schedule switched off', () => {
    seed({ enabled: true, scheduleEnabled: false, eventsEnabled: false, subscribedEvents: {}, scope: { siteIds: [] } });
    const rendered = new (AgentCard as any)({
      status: status({ cronExpression: '0 3 * * *' }), onSelect: () => {},
    }).render();
    expect(statValue(rendered, 'Schedule')).toBe('—');
  });
});
