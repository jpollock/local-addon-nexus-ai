import { collectSystemHealth, SystemHealthDeps } from '../../../src/main/health/collectSystemHealth';

/** A deps object where every gatherer succeeds and every input is `ok`. */
function healthyDeps(overrides: Partial<SystemHealthDeps> = {}): SystemHealthDeps {
  return {
    getAgents: async () => [{ id: 'security-sentinel', lastRunStatus: 'success', lastRunAt: Date.now() }],
    getSyncAges: () => [{ id: 'site-1', lastSyncAt: Date.now(), refreshEnabled: true }],
    getCredentialStates: async () => [{ name: 'wpe', ok: true }],
    getEventStats: async () => ({ failed: 0, pending: 0 }),
    ...overrides,
  };
}

/** A gatherer stand-in that throws, simulating an unreadable source. */
function throwing(value: unknown = new Error('boom')): () => never {
  return () => {
    throw value;
  };
}

describe('collectSystemHealth', () => {
  test('all four gatherers succeeding rolls up to ok', async () => {
    const result = await collectSystemHealth(healthyDeps());
    expect(result.overall).toBe('ok');
    expect(result.inputs.agentRuns.state).toBe('ok');
    expect(result.inputs.syncStaleness.state).toBe('ok');
    expect(result.inputs.credentials.state).toBe('ok');
    expect(result.inputs.eventQueue.state).toBe('ok');
  });

  describe('a throwing gatherer becomes unknown for that input alone', () => {
    test('getAgents throwing -> agentRuns unknown, others still report their real state', async () => {
      const deps = healthyDeps({ getAgents: throwing() });
      const result = await collectSystemHealth(deps);

      expect(result.inputs.agentRuns).toEqual({
        state: 'unknown',
        reason: 'Could not read agent run status',
      });
      expect(result.inputs.syncStaleness.state).toBe('ok');
      expect(result.inputs.credentials.state).toBe('ok');
      expect(result.inputs.eventQueue.state).toBe('ok');
    });

    test('getSyncAges throwing -> syncStaleness unknown, others still report their real state', async () => {
      const deps = healthyDeps({ getSyncAges: throwing() });
      const result = await collectSystemHealth(deps);

      expect(result.inputs.syncStaleness).toEqual({
        state: 'unknown',
        reason: 'Could not read sync freshness',
      });
      expect(result.inputs.agentRuns.state).toBe('ok');
      expect(result.inputs.credentials.state).toBe('ok');
      expect(result.inputs.eventQueue.state).toBe('ok');
    });

    test('getCredentialStates throwing -> credentials unknown, others still report their real state', async () => {
      const deps = healthyDeps({ getCredentialStates: throwing() });
      const result = await collectSystemHealth(deps);

      expect(result.inputs.credentials).toEqual({
        state: 'unknown',
        reason: 'Could not read credential status',
      });
      expect(result.inputs.agentRuns.state).toBe('ok');
      expect(result.inputs.syncStaleness.state).toBe('ok');
      expect(result.inputs.eventQueue.state).toBe('ok');
    });

    test('getEventStats throwing -> eventQueue unknown, others still report their real state', async () => {
      const deps = healthyDeps({ getEventStats: throwing() });
      const result = await collectSystemHealth(deps);

      expect(result.inputs.eventQueue).toEqual({
        state: 'unknown',
        reason: 'Could not read site event queue',
      });
      expect(result.inputs.agentRuns.state).toBe('ok');
      expect(result.inputs.syncStaleness.state).toBe('ok');
      expect(result.inputs.credentials.state).toBe('ok');
    });
  });

  test('a throwing gatherer does not prevent the others from reporting a non-ok state', async () => {
    // agentRuns and getEventStats throw; syncStaleness and credentials have real problems.
    // If one broken gatherer could take down the others, these real problems would be lost.
    const deps = healthyDeps({
      getAgents: throwing(),
      getEventStats: throwing(),
      getSyncAges: () => [{ id: 'site-1', lastSyncAt: null, refreshEnabled: true }],
      getCredentialStates: async () => [{ name: 'wpe', ok: false }],
    });
    const result = await collectSystemHealth(deps);

    expect(result.inputs.agentRuns.state).toBe('unknown');
    expect(result.inputs.eventQueue.state).toBe('unknown');
    expect(result.inputs.syncStaleness).toEqual({
      state: 'degraded',
      reason: '1 sites have never been checked',
    });
    expect(result.inputs.credentials).toEqual({
      state: 'failing',
      reason: 'wpe needs reconnecting',
    });
  });

  describe('syncStaleness respects refreshEnabled — a disabled scheduler is not a failure', () => {
    test('all sites refresh-disabled -> unknown, reason names refresh being off (not degraded)', async () => {
      const deps = healthyDeps({
        getSyncAges: () => [
          { id: 'site-1', lastSyncAt: null, refreshEnabled: false },
          { id: 'site-2', lastSyncAt: Date.now() - 30 * 24 * 60 * 60 * 1000, refreshEnabled: false },
        ],
      });
      const result = await collectSystemHealth(deps);

      expect(result.inputs.syncStaleness.state).toBe('unknown');
      expect(result.inputs.syncStaleness.state).not.toBe('degraded');
      expect(result.inputs.syncStaleness.reason).toMatch(/refresh/i);
      expect(result.inputs.syncStaleness.reason).toMatch(/off|disabled/i);
    });

    test('a mix of refresh-disabled stale sites and one refresh-enabled fresh site -> not degraded', async () => {
      const deps = healthyDeps({
        getSyncAges: () => [
          // These would both read as stale/never-checked if refreshEnabled were ignored.
          { id: 'disabled-never', lastSyncAt: null, refreshEnabled: false },
          { id: 'disabled-stale', lastSyncAt: Date.now() - 30 * 24 * 60 * 60 * 1000, refreshEnabled: false },
          { id: 'enabled-fresh', lastSyncAt: Date.now(), refreshEnabled: true },
        ],
      });
      const result = await collectSystemHealth(deps);

      expect(result.inputs.syncStaleness).toEqual({ state: 'ok', reason: null });
    });

    test('a refresh-enabled site with lastSyncAt: null is still degraded (fix does not over-correct into silence)', async () => {
      const deps = healthyDeps({
        getSyncAges: () => [
          { id: 'enabled-never', lastSyncAt: null, refreshEnabled: true },
        ],
      });
      const result = await collectSystemHealth(deps);

      expect(result.inputs.syncStaleness).toEqual({
        state: 'degraded',
        reason: '1 sites have never been checked',
      });
    });
  });

  describe('no gatherer failure ever yields ok', () => {
    const failureModes: Array<[string, unknown]> = [
      ['throws an Error', new Error('network unreachable')],
      ['throws a string', 'nope'],
      ['throws undefined', undefined],
      ['rejects (async gatherer)', 'rejected'],
    ];

    for (const [label, value] of failureModes) {
      test(`getAgents ${label} -> never ok`, async () => {
        const getAgents = label.startsWith('rejects')
          ? async (): Promise<never> => { throw value; }
          : throwing(value);
        const result = await collectSystemHealth(healthyDeps({ getAgents: getAgents as SystemHealthDeps['getAgents'] }));
        expect(result.inputs.agentRuns.state).not.toBe('ok');
        expect(result.inputs.agentRuns.state).toBe('unknown');
      });
    }
  });

  test('overall reflects a broken signal: one throwing gatherer drags the whole pill off green', async () => {
    const deps = healthyDeps({ getCredentialStates: throwing() });
    const result = await collectSystemHealth(deps);
    expect(result.overall).toBe('unknown');
  });

  test('every gatherer throwing at once still returns a well-formed SystemHealth, all four unknown', async () => {
    const deps: SystemHealthDeps = {
      getAgents: throwing(),
      getSyncAges: throwing(),
      getCredentialStates: throwing(),
      getEventStats: throwing(),
    };
    const result = await collectSystemHealth(deps);

    expect(result.overall).toBe('unknown');
    expect(result.inputs.agentRuns.state).toBe('unknown');
    expect(result.inputs.syncStaleness.state).toBe('unknown');
    expect(result.inputs.credentials.state).toBe('unknown');
    expect(result.inputs.eventQueue.state).toBe('unknown');
  });

  test('an injected now() is used to evaluate staleness deterministically', async () => {
    const fixedNow = 1_000_000_000_000;
    const deps = healthyDeps({
      now: () => fixedNow,
      getSyncAges: () => [{ id: 'site-1', lastSyncAt: fixedNow - 25 * 60 * 60 * 1000, refreshEnabled: true }], // 25h old
    });
    const result = await collectSystemHealth(deps);
    expect(result.inputs.syncStaleness).toEqual({
      state: 'degraded',
      reason: '1 sites not checked in over a day',
    });
  });
});
