import { AgentRunner } from '../../../src/main/agent-runtime/AgentRunner';
import type { AgentDefinition } from '../../../src/main/agent-sdk/types';

function makeMinimalRunner(): AgentRunner {
  const mockRegistry = {} as any;
  const mockStateStore = {
    buildHandle: () => ({
      get: () => undefined, set: () => {}, delete: () => {}, scratch: {},
      isCoolingDown: () => false, setCooldown: () => {},
    }),
    recordRun: () => {},
    getLastRun: () => undefined,
  } as any;
  const mockServices = {} as any;
  const mockProvider = { provider: 'anthropic', apiKey: 'test', model: 'claude-sonnet-5', useLocalGateway: false } as any;
  return new AgentRunner(mockStateStore, mockRegistry, mockServices, mockProvider);
}

describe('AgentRunner structured log events', () => {
  it('accumulates log.finding() calls into AgentResult.findings', async () => {
    const runner = makeMinimalRunner();
    const agent: AgentDefinition = {
      name: 'test-agent', version: '1.0.0',
      triggers: [],
      run: async ({ log }) => {
        log.finding({ id: 'ABS-01', severity: 'high', title: 'Test finding', site: 'mysite' });
        log.finding({ id: 'ABS-02', severity: 'critical', title: 'Critical finding', site: 'mysite' });
      },
    };
    const result = await runner.run(agent);
    expect(result.findings).toHaveLength(2);
    expect(result.findings![0].id).toBe('ABS-01');
    expect(result.findings![1].severity).toBe('critical');
  });

  it('accumulates log.siteStatus() into AgentResult.sites', async () => {
    const runner = makeMinimalRunner();
    const agent: AgentDefinition = {
      name: 'test-agent', version: '1.0.0', triggers: [],
      run: async ({ log }) => {
        log.siteStatus('site-a', 'clean');
        log.siteStatus('site-b', 'findings');
      },
    };
    const result = await runner.run(agent);
    expect(result.sites?.['site-a']?.status).toBe('clean');
    expect(result.sites?.['site-b']?.status).toBe('findings');
  });

  it('carries agent return value into AgentResult', async () => {
    const runner = makeMinimalRunner();
    const agent: AgentDefinition = {
      name: 'test-agent', version: '1.0.0', triggers: [],
      run: async () => ({
        verdict: 'plan_ready' as const,
        sites: {},
        findings: [],
        plan: { site: 'mysite', verified: true, verdict: 'ready' as const, steps: [] },
      }),
    };
    const result = await runner.run(agent);
    expect(result.verdict).toBe('plan_ready');
    expect(result.plan?.site).toBe('mysite');
  });
});
