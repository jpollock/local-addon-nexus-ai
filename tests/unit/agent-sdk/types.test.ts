// tests/unit/agent-sdk/types.test.ts
import type { Finding, RemediationPlan, AgentResult, AgentLogger, AgentStateHandle } from '../../../src/main/agent-sdk/types';

describe('SDK type shapes', () => {
  it('Finding has required fields', () => {
    const f: Finding = { id: 'ABS-01', severity: 'high', title: 'Default admin exists' };
    expect(f.id).toBe('ABS-01');
    expect(f.severity).toBe('high');
  });

  it('RemediationPlan has steps array', () => {
    const p: RemediationPlan = {
      site: 'theawfulpmtest', verified: true, verdict: 'ready', steps: [],
    };
    expect(p.steps).toEqual([]);
  });

  it('AgentResult domain fields are optional', () => {
    // existing shape still works
    const r: AgentResult = {
      agentName: 'security-sentinel', startedAt: 0, finishedAt: 1,
      status: 'success',
    };
    expect(r.findings).toBeUndefined();
    expect(r.plan).toBeUndefined();
  });
});
