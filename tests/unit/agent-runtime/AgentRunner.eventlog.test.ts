import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-runner-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const AT = () => new Date('2026-08-09T10:00:00Z');
// The file is named for the LOCAL day (see eventLog.ts `localDay`), so derive it rather than
// hardcoding this instant's UTC rendering — the two differ in most timezones.
const day = () => AT().toLocaleDateString('en-CA');
const combined = () => fs.readFileSync(path.join(root, `nexus-${day()}.log`), 'utf-8');

function makeRunner(agentRun: (ctx?: any) => Promise<any>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AgentRunner } = require('../../../src/main/agent-runtime/AgentRunner');
  const recorded: any[] = [];
  const stateStore = {
    buildHandle: () => ({
      get: () => undefined, set: () => {}, delete: () => {}, scratch: {},
      isCoolingDown: () => false, setCooldown: () => {},
    }),
    recordRun: (r: any) => recorded.push(r),
  };
  // Real signature: (stateStore, toolRegistry, services, resolvedProvider, dbManager?, eventLog?)
  const runner = new AgentRunner(
    stateStore as any, {} as any, {} as any, {} as any, undefined,
    new EventLog({ root, minLevel: 'DEBUG', now: AT }),
  );
  const agent = {
    name: 'test-agent', version: '1.0.0',
    triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
    run: agentRun,
  };
  return { runner, agent, recorded };
}

describe('AgentRunner run correlation', () => {
  it('brackets every run with run.start and run.end', async () => {
    const { runner, agent } = makeRunner(async () => {});
    await runner.run(agent as any);
    const out = combined();
    expect(out).toMatch(/test-agent run=r_[0-9a-z]+ run\.start/);
    expect(out).toMatch(/test-agent run=r_[0-9a-z]+ run\.end status=success/);
  });

  it('uses ONE id for the whole run, so a grep reassembles it', async () => {
    const { runner, agent } = makeRunner(async function (ctx: any) { ctx.log.info('working'); });
    await runner.run(agent as any);
    const ids = [...combined().matchAll(/run=(r_[0-9a-z]+)/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(1);
    expect(ids.length).toBeGreaterThanOrEqual(3); // start, the agent's own line, end
  });

  it('returns the run id and records it', async () => {
    const { runner, agent, recorded } = makeRunner(async () => {});
    const result = await runner.run(agent as any);
    expect(result.runId).toMatch(/^r_/);
    expect(recorded[0].runId).toBe(result.runId);
  });

  it('emits run.end with the failure when the agent throws', async () => {
    const { runner, agent } = makeRunner(async () => { throw new Error('kaboom'); });
    await runner.run(agent as any);
    expect(combined()).toMatch(/run\.end status=error .*kaboom/);
  });

  it('correlates a SCHEDULED run, not only Run Now', async () => {
    // Only AGENT_RUN_NOW ever passed logFileName, so unattended runs had no isolated record at
    // all. The run id must not depend on which caller started the run.
    const { runner, agent } = makeRunner(async () => {});
    await runner.run(agent as any);              // no options — the scheduler's call shape
    expect(combined()).toMatch(/run\.start trigger=cron/);
  });

  describe('explicit trigger — caller-stated, not inferred', () => {
    // AGENT_RUN_NOW (ipc-handlers.ts) passes BOTH a scoped `event` (to target one site) AND a
    // `logFileName`. Inferring from either alone mislabelled it (as 'event', since event is
    // checked first) and made 'manual' unreachable from that caller. Each of these proves the
    // explicit `trigger` option wins over what inference from event/logFileName would have
    // produced, in every direction.

    it('labels trigger=manual even when an event is present (AGENT_RUN_NOW shape)', async () => {
      const { runner, agent } = makeRunner(async () => {});
      const event = {
        namespace: 'wpe', type: 'sync.completed', key: 'wpe:sync.completed',
        siteId: 'mysite', payload: {}, createdAt: Date.now(),
      };
      // Inference alone would read `event` truthy and label this 'event' — explicit wins.
      await runner.run(agent as any, event as any, { trigger: 'manual' });
      expect(combined()).toMatch(/run\.start trigger=manual/);
      expect(combined()).not.toMatch(/trigger=event/);
    });

    it('labels trigger=cron even when logFileName is present', async () => {
      // Inference alone would read logFileName and label this 'manual' — explicit wins.
      const { runner, agent } = makeRunner(async () => {});
      await runner.run(agent as any, undefined, { logFileName: 'run-1.log', trigger: 'cron' });
      expect(combined()).toMatch(/run\.start trigger=cron/);
      expect(combined()).not.toMatch(/trigger=manual/);
    });

    it('labels trigger=event even with no event object and no logFileName', async () => {
      // Inference alone (no event, no logFileName) would default to 'cron' — explicit wins.
      const { runner, agent } = makeRunner(async () => {});
      await runner.run(agent as any, undefined, { trigger: 'event' });
      expect(combined()).toMatch(/run\.start trigger=event/);
      expect(combined()).not.toMatch(/trigger=cron/);
    });
  });

  it('brackets a context-construction failure too — run.start and run.end share one id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AgentRunner } = require('../../../src/main/agent-runtime/AgentRunner');
    const stateStore = {
      buildHandle: () => ({
        get: () => undefined, set: () => {}, delete: () => {}, scratch: {},
        isCoolingDown: () => false, setCooldown: () => {},
      }),
      recordRun: () => {},
    };
    // resolvedProvider undefined is a real dependency-injection failure that makes
    // buildAgentContext throw synchronously (it dereferences resolvedProvider.provider with no
    // guard) — not a mock hack. This is what a misconfigured caller looks like: run() must still
    // close the bracket it opened rather than leaving a dangling run.start with no run.end.
    const runner = new AgentRunner(
      stateStore as any, {} as any, {} as any, undefined as any, undefined,
      new EventLog({ root, minLevel: 'DEBUG', now: AT }),
    );
    const agent = {
      name: 'test-agent', version: '1.0.0',
      triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
      run: async () => {},
    };
    await runner.run(agent as any);
    const out = combined();
    const ids = [...out.matchAll(/run=(r_[0-9a-z]+)/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(1);
    expect(out).toMatch(/run\.start/);
    expect(out).toMatch(/run\.end status=error/);
  });
});
