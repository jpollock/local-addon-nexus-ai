import { runStore } from '../../../src/renderer/components/agents/RunStore';

describe('RunStore runIds', () => {
  beforeEach(() => {
    runStore.dismissRun();
  });

  it('carries runIds from completeRun payload into the run', () => {
    runStore.startRun({ runId: 'run-123', agentId: 'test-agent', agentName: 'Test Agent', siteNames: ['site-a', 'site-b'] });
    runStore.completeRun({
      runId: 'run-123',
      runIds: ['r_abc123', 'r_def456'],
      doneCount: 2,
      failedCount: 0,
      findingsSites: [],
    });

    const run = runStore.getState().currentRun;
    expect(run).toBeTruthy();
    expect(run!.runIds).toEqual(['r_abc123', 'r_def456']);
  });

  it('accepts an empty runIds array when no runs produced an id', () => {
    runStore.startRun({ runId: 'run-456', agentId: 'test-agent', agentName: 'Test Agent', siteNames: ['site-x'] });
    runStore.completeRun({
      runId: 'run-456',
      runIds: [],
      doneCount: 0,
      failedCount: 1,
      findingsSites: [],
    });

    const run = runStore.getState().currentRun;
    expect(run).toBeTruthy();
    expect(run!.runIds).toEqual([]);
  });

  it('accepts undefined runIds for backward compat with old AGENT_RUN_COMPLETE payloads', () => {
    runStore.startRun({ runId: 'run-789', agentId: 'test-agent', agentName: 'Test Agent', siteNames: ['site-y'] });
    runStore.completeRun({
      runId: 'run-789',
      doneCount: 1,
      failedCount: 0,
      findingsSites: [],
    });

    const run = runStore.getState().currentRun;
    expect(run).toBeTruthy();
    expect(run!.runIds).toBeUndefined();
  });
});
