import * as os from 'os';
import * as path from 'path';
import { buildAgentContext } from '../../../src/main/agent-runtime/buildAgentContext';

const makeAgent = () => ({
  name: 'test-agent',
  version: '1.0.0',
  triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
  run: async () => {},
});

const makeStubs = () => ({
  toolRegistry: { list: jest.fn().mockReturnValue([]), call: jest.fn() } as any,
  services: {} as any,
  stateStore: { buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {}, isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() }) } as any,
  resolvedProvider: { provider: 'anthropic', apiKey: '', model: 'claude-3-haiku', useLocalGateway: false } as any,
  logDir: path.join(os.tmpdir(), 'nexus-test-logs'),
});

describe('buildAgentContext', () => {
  it('returns a ctx with log, state, tools, ai, autonomy', () => {
    const { ctx, agentLog, accFindings, accSites } = buildAgentContext({
      agent: makeAgent(),
      ...makeStubs(),
    });
    expect(ctx.log).toBeDefined();
    expect(ctx.state).toBeDefined();
    expect(ctx.tools).toBeDefined();
    expect(ctx.ai).toBeDefined();
    expect(ctx.autonomy).toBe('ask'); // default when cache is empty
    expect(agentLog).toBe(ctx.log);
    expect(Array.isArray(accFindings)).toBe(true);
    expect(accSites).toEqual({});
  });

  it('log.finding pushes to accFindings', () => {
    const { ctx, accFindings } = buildAgentContext({ agent: makeAgent(), ...makeStubs() });
    ctx.log.finding({ id: 'T-01', severity: 'high', title: 'test', site: 's' });
    expect(accFindings).toHaveLength(1);
    expect(accFindings[0].id).toBe('T-01');
  });

  it('log.siteStatus updates accSites', () => {
    const { ctx, accSites } = buildAgentContext({ agent: makeAgent(), ...makeStubs() });
    ctx.log.siteStatus('my-site', 'clean');
    expect(accSites['my-site'].status).toBe('clean');
  });
});
