/**
 * WP-57 Task 6 · a dispatched contributed tool names its CONTRIBUTING agent.
 *
 * Chokepoint two reaches neither `ToolRegistry.call` nor its audit write, so
 * without this every contributed-tool act was attributed to the collapsed
 * `act_agent_runtime`. The contributing agent is the one whose code ran.
 *
 * The taskId is PASSED THROUGH and never minted here — ruling request 2 is
 * unruled, and minting one would answer it by accident.
 */
const recorded: any[] = [];
jest.mock('../../../src/main/intelligence-host/actionProducer', () => ({
  recordGatedAction: (r: any) => { recorded.push(r); },
}));
jest.mock('../../../src/main/intelligence-host/sequenceGuard', () => ({
  checkCheckpointSequence: () => null,
}));
jest.mock('../../../src/main/ipc-handlers', () => ({
  getAgentSetting: () => true,
  getAgentSettings: () => ({}),
  getAgentAutonomy: () => 'auto',
}));

import { AgentDispatcher } from '../../../src/main/agent-runtime/AgentDispatcher';

describe('WP-57 · AgentDispatcher actor', () => {
  beforeEach(() => { recorded.length = 0; });

  function dispatcher(tier: number) {
    const contributed = {
      get: () => ({ agentName: 'log-processor', toolName: 'get_log_aggregates', permissionTier: tier, executionMode: 'function' }),
    };
    const d = new AgentDispatcher(
      contributed as never,
      { call: jest.fn() } as never,
      {} as never,
      '/tmp/nonexistent-agents',
      { provider: 'ollama', model: 'm', apiKey: '' } as never,
      { buildHandle: () => ({}) } as never,
    );
    return d;
  }

  it('names the contributing agent as the actor, in the round-tripping format', async () => {
    await dispatcher(2).dispatch('log-processor', 'get_log_aggregates', { site: 's' }, { id: 'task_CALLER' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].actor).toEqual({ id: 'act_log_processor', kind: 'agent' });
  });

  it('passes the caller task through and never mints one', async () => {
    await dispatcher(2).dispatch('log-processor', 'get_log_aggregates', {}, { id: 'task_CALLER' });
    expect(recorded[0].taskId).toBe('task_CALLER');

    recorded.length = 0;
    // No caller task ⇒ none recorded. Ruling request 2 is unruled; minting one
    // here would decide it silently.
    await dispatcher(2).dispatch('log-processor', 'get_log_aggregates', {});
    expect(recorded[0].taskId).toBeUndefined();
  });
});
