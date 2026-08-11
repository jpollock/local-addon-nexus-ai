import { agentStore, AgentStatus } from '../../../src/renderer/components/agents/AgentStore';

const status = (name: string): AgentStatus => ({
  name,
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
});

/**
 * The `agentStatus` query returns agents in directory-scan order, which is neither stable nor
 * meaningful — the hub grid reshuffled between loads. Sorting lives in the store so every
 * consumer of `statuses` inherits it and a new surface cannot forget.
 */
describe('agentStore.setStatuses', () => {
  afterEach(() => agentStore.setStatuses([]));

  it('sorts by name regardless of the order the query returned', () => {
    // The real shape observed from the registry: neither alphabetical nor insertion-stable.
    agentStore.setStatuses(
      ['auth-probe', 'web-analytics', 'log-processor', 'security-sentinel', 'seo-insights'].map(status),
    );
    expect(agentStore.getState().statuses.map(s => s.name)).toEqual([
      'auth-probe', 'log-processor', 'security-sentinel', 'seo-insights', 'web-analytics',
    ]);
  });

  it('gives the same order whatever order it is handed', () => {
    const names = ['zeta-agent', 'alpha-agent', 'Mid-Agent'];
    agentStore.setStatuses(names.map(status));
    const first = agentStore.getState().statuses.map(s => s.name);

    agentStore.setStatuses([...names].reverse().map(status));
    expect(agentStore.getState().statuses.map(s => s.name)).toEqual(first);
  });

  it('does not mutate the array it was given', () => {
    const input = ['zeta', 'alpha'].map(status);
    agentStore.setStatuses(input);
    expect(input.map(s => s.name)).toEqual(['zeta', 'alpha']);
  });

  it('handles an empty list', () => {
    agentStore.setStatuses([]);
    expect(agentStore.getState().statuses).toEqual([]);
  });
});
