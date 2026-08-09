import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventLog } from '../../../src/main/logging/eventLog';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-runner-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const combined = () => fs.readFileSync(path.join(root, 'nexus-2026-08-09.log'), 'utf-8');
const AT = () => new Date('2026-08-09T10:00:00Z');

function makeRunner(agentRun: (ctx?: any) => Promise<any>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AgentRunner } = require('../../../src/main/agent-runtime/AgentRunner');
  const recorded: any[] = [];
  const stateStore = {
    buildHandle: () => ({ get: () => undefined, set: () => {} }),
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
});
