/**
 * WP-57 · The run frame at the AgentRunner chokepoint.
 *
 * What earns its keep here is the BRACKET and the NON-FATALITY:
 *
 *   - A frame that opens must close, on every exit — success, thrown error,
 *     and timeout. An unclosed bracket is the "why did this agent not finish?"
 *     case the whole mechanism exists to answer, and it is the exact defect
 *     `run.start`/`run.end` were moved inside the try to fix.
 *   - The frame's outcome is the RUN's outcome, carried, never recomposed.
 *   - A frame that cannot open costs the frame and nothing else: the agent
 *     still runs, still records, still returns.
 *   - `close()` sits BEFORE the two producer taps, because WP-51's own rule is
 *     that the act is "recorded before the findings it explains".
 */
import { AgentRunner } from '../../../src/main/agent-runtime/AgentRunner';
import { defineAgent, cron } from '../../../src/main/agent-sdk';
import type { ResolvedAIProvider } from '../../../src/main/ai/getAIProvider';

const opened: any[] = [];
const closed: any[] = [];
let openReturnsUndefined = false;
let frameDidEmit: boolean | undefined;

jest.mock('../../../src/main/intelligence-host/agentTaskFrame', () => ({
  agentActorId: (n: string) => `act_agent_${n}`,
  openAgentTask: (o: any) => {
    opened.push(o);
    if (openReturnsUndefined) return undefined;
    return {
      id: 'task_TEST',
      actor: { id: `act_agent_${o.agentName}`, kind: 'agent' },
      autonomy: o.trigger === 'manual' ? 'interactive' : 'autonomous',
      noteGatedAct: jest.fn(),
      correlationId: () => 'task_TEST',
      didEmit: () => (frameDidEmit !== undefined ? frameDidEmit : closed.length > 0),
      close: (c: any) => closed.push(c),
    };
  },
}));

const resolvedProvider: ResolvedAIProvider = {
  provider: 'ollama', model: 'llama3.2', apiKey: '', useLocalGateway: false, isAvailable: false,
};

function makeRunner() {
  const stateStore = {
    buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {} }),
    recordRun: jest.fn(),
  };
  const toolRegistry = { call: jest.fn() };
  return new AgentRunner(stateStore as any, toolRegistry as any, {} as any, resolvedProvider);
}

describe('WP-57 · AgentRunner run frame', () => {
  beforeEach(() => { opened.length = 0; closed.length = 0; openReturnsUndefined = false; frameDidEmit = undefined; });

  it('opens with the caller-stated trigger and closes with the run outcome', async () => {
    const agent = defineAgent({
      name: 'seo-insights', version: '1.0.0', triggers: [cron('* * * * *')],
      run: async () => undefined,
    });

    const result = await makeRunner().run(agent, undefined, { trigger: 'cron' });

    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ agentName: 'seo-insights', trigger: 'cron' });
    expect(opened[0].startedAt).toEqual(expect.any(Number));
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ status: 'success', finishedAt: result.finishedAt });
    // didEmit() is true once close() ran in this stub, so the id surfaces.
    expect(result.taskId).toBe('task_TEST');
  });

  it('closes the frame when the agent throws', async () => {
    const agent = defineAgent({
      name: 'a', version: '1.0.0', triggers: [cron('* * * * *')],
      run: async () => { throw new Error('boom'); },
    });

    const result = await makeRunner().run(agent, undefined, { trigger: 'cron' });

    expect(result.status).toBe('error');
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('closes the frame when the agent times out', async () => {
    const agent = defineAgent({
      name: 'a', version: '1.0.0', triggers: [cron('* * * * *')], timeoutMs: 20,
      run: () => new Promise(() => { /* never resolves */ }),
    });

    const result = await makeRunner().run(agent, undefined, { trigger: 'cron' });

    expect(result.status).toBe('timeout');
    // The bracket closes on EVERY exit, including the one where the agent
    // never returned. An unclosed frame here is the defect the event log's
    // run.start/run.end placement was already fixed for.
    expect(closed).toHaveLength(1);
    expect(closed[0].status).toBe('timeout');
  });

  it('carries the trigger through so autonomy is derived, not assumed', async () => {
    const agent = defineAgent({
      name: 'a', version: '1.0.0', triggers: [cron('* * * * *')], run: async () => undefined,
    });

    await makeRunner().run(agent, undefined, { trigger: 'manual', logFileName: 'run-1.log' });
    expect(opened[0].trigger).toBe('manual');

    await makeRunner().run(agent, undefined, { trigger: 'cron' });
    expect(opened[1].trigger).toBe('cron');
  });

  it('still runs, records and returns when the frame cannot open', async () => {
    openReturnsUndefined = true;
    const runFn = jest.fn().mockResolvedValue(undefined);
    const agent = defineAgent({
      name: 'a', version: '1.0.0', triggers: [cron('* * * * *')], run: runFn,
    });

    const result = await makeRunner().run(agent, undefined, { trigger: 'cron' });

    expect(runFn).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.taskId).toBeUndefined();
    expect(closed).toHaveLength(0);
  });

  it('withholds taskId when the frame wrote nothing — no id that names no events', async () => {
    // The lazy frame emits nothing for a quiet successful run. Recording its
    // id in agent_runs anyway would store a correlation naming no events —
    // the fabricated join the ledger's id rules refuse.
    frameDidEmit = false;
    const agent = defineAgent({
      name: 'auth-probe', version: '1.0.0', triggers: [cron('*/2 * * * *')], run: async () => undefined,
    });

    const result = await makeRunner().run(agent, undefined, { trigger: 'cron' });

    expect(result.status).toBe('success');
    expect(closed).toHaveLength(1);       // close() is still called
    expect(result.taskId).toBeUndefined(); // but no id is surfaced
  });

  it('reports the findings count it actually produced', async () => {
    const agent = defineAgent({
      name: 'a', version: '1.0.0', triggers: [cron('* * * * *')],
      run: async (ctx) => {
        ctx.log.finding({ id: 'f1', severity: 'high', title: 'one' });
        ctx.log.finding({ id: 'f2', severity: 'low', title: 'two' });
      },
    });

    await makeRunner().run(agent, undefined, { trigger: 'cron' });

    expect(closed[0].findings).toBe(2);
  });
});
