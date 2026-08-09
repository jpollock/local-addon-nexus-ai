import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAgentContext } from '../../../src/main/agent-runtime/buildAgentContext';
import { EventLog } from '../../../src/main/logging/eventLog';
import { initializeProviders } from '../../../src/main/chat/providers';

beforeAll(() => { initializeProviders(); });

const makeAgent = () => ({
  name: 'test-agent', version: '1.0.0',
  triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
  run: async () => {},
});

const makeStubs = () => ({
  toolRegistry: { list: jest.fn().mockReturnValue([]), call: jest.fn() } as any,
  services: {} as any,
  stateStore: { buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {}, isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() }) } as any,
  resolvedProvider: { provider: 'anthropic', apiKey: '', model: 'claude-3-haiku', useLocalGateway: false } as any,
});

let root: string; let logDir: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ctxlog-'));
  logDir = path.join(root, 'legacy');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function build(runId = 'r_test1') {
  const eventLog = new EventLog({ root, minLevel: 'DEBUG', now: () => new Date('2026-08-09T10:00:00Z') });
  const { ctx } = buildAgentContext({
    agent: makeAgent() as any, logDir, eventLog, runId, ...makeStubs(),
  } as any);
  return { ctx, file: path.join(root, 'agents', 'test-agent-2026-08-09.log') };
}

describe('ctx.log → EventLog', () => {
  it('stamps every line with the agent and run id without the agent supplying them', () => {
    const { ctx, file } = build();
    ctx.log.info('scanning');
    expect(fs.readFileSync(file, 'utf-8')).toContain('test-agent run=r_test1  scanning');
  });

  it('emits phase and finding as vocabulary events, not prose', () => {
    const { ctx, file } = build();
    ctx.log.phase('scan', 'acfprod');
    ctx.log.finding({ id: 'FS-02', severity: 'high', title: 'unexpected file', site: 'acfprod' } as any);
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toContain('phase name=scan detail=acfprod');
    expect(out).toContain('finding sev=high id=FS-02 site=acfprod  unexpected file');
  });

  it('records a mutation with before and after', () => {
    // The whole point of the "it changed something I didn't expect" case: the log answers it
    // directly rather than leaving it to be inferred from an intent line.
    const { ctx, file } = build();
    ctx.log.mutation({ op: 'wp_plugin_update', target: 'acfprod', before: 'acf 6.8.5', after: 'acf 6.8.6', ok: true });
    expect(fs.readFileSync(file, 'utf-8'))
      .toContain('mutation op=wp_plugin_update target=acfprod before="acf 6.8.5" after="acf 6.8.6" ok=true');
  });

  it('honours the level on the FILE, not just the console', () => {
    // ctx.log.debug() previously appended unconditionally, which is why the level knob meant
    // nothing in practice.
    const eventLog = new EventLog({ root, minLevel: 'INFO', now: () => new Date('2026-08-09T10:00:00Z') });
    const { ctx } = buildAgentContext({
      agent: makeAgent() as any, logDir, eventLog, runId: 'r_x', ...makeStubs(),
    } as any);
    ctx.log.debug('noisy');
    ctx.log.info('kept');
    const out = fs.readFileSync(path.join(root, 'agents', 'test-agent-2026-08-09.log'), 'utf-8');
    expect(out).not.toContain('noisy');
    expect(out).toContain('kept');
  });

  it('still accumulates findings for AgentResult', () => {
    // Routing logs to a new destination must not break the accumulators that populate
    // AgentResult.findings — the Approvals tab and the run record both read them.
    const eventLog = new EventLog({ root, minLevel: 'DEBUG', now: () => new Date('2026-08-09T10:00:00Z') });
    const built = buildAgentContext({
      agent: makeAgent() as any, logDir, eventLog, runId: 'r_acc', ...makeStubs(),
    } as any);
    built.ctx.log.finding({ id: 'A', severity: 'low', title: 't' } as any);
    expect(built.accFindings).toHaveLength(1);
    expect(built.accFindings[0].id).toBe('A');
  });

  it('emits warn() with WARN level to the event log', () => {
    const { ctx, file } = build();
    ctx.log.warn('warning message');
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toMatch(/WARN.*test-agent.*warning message/);
  });

  it('emits error() with ERROR level to the event log', () => {
    const { ctx, file } = build();
    ctx.log.error('error message');
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toMatch(/ERROR.*test-agent.*error message/);
  });

  it('emits action() with action event name and result/duration fields', () => {
    const { ctx, file } = build();
    ctx.log.action({ label: 'cleanup', result: 'ok', durationMs: 1500 });
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toContain('action action=cleanup result=ok dur=1500');
    // Verify it is NOT tagged as 'phase' — this test catches silent reversion to phase
    expect(out).not.toMatch(/phase.*action=cleanup/);
  });

  it('emits siteStatus() with site event name and status fields', () => {
    const { ctx, file } = build();
    ctx.log.siteStatus('mysite', 'clean');
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toContain('site site=mysite status=clean');
    // Verify it is NOT tagged as 'phase' — this test catches silent reversion to phase
    expect(out).not.toMatch(/phase.*site=mysite/);
  });

  it('records a mutation with ok: false as WARN level', () => {
    const { ctx, file } = build();
    ctx.log.mutation({ op: 'wp_plugin_update', target: 'failedsite', before: 'old 1.0', after: 'new 2.0', ok: false });
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toMatch(/WARN.*mutation/);
    expect(out).toContain('ok=false');
  });

  it('writes DEBUG level to file when minLevel is DEBUG', () => {
    // Positive assertion: DEBUG appears when the level is set to DEBUG
    const eventLog = new EventLog({ root, minLevel: 'DEBUG', now: () => new Date('2026-08-09T10:00:00Z') });
    const { ctx } = buildAgentContext({
      agent: makeAgent() as any, logDir, eventLog, runId: 'r_debug', ...makeStubs(),
    } as any);
    ctx.log.debug('debug message');
    const out = fs.readFileSync(path.join(root, 'agents', 'test-agent-2026-08-09.log'), 'utf-8');
    expect(out).toContain('debug message');
  });

  it('omits site key from finding when site is not provided', () => {
    // Confirms formatLine handles undefined fields correctly: no bare site= in output
    const { ctx, file } = build();
    ctx.log.finding({ id: 'NO-SITE', severity: 'low', title: 'issue without site' } as any);
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toContain('finding sev=low id=NO-SITE');
    expect(out).not.toContain('site=');
  });
});
