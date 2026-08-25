/**
 * WP-59 · An agent run assembles its own context — driven end to end.
 *
 * The unit suites either side of this one mock what they do not own:
 * `agentAssembly.test.ts` hands `assembleForAgentRun` a fake frame and a fake
 * assembler, and `AgentRunner.taskframe.test.ts` mocks the frame module whole.
 * Both are correct and NEITHER covers the wiring — which is the half that was
 * missing in the first place. **Measured at this packet's announce: 36
 * `task.context.assembled` manifests on the owner's ledger, all 36 the chat
 * assembler's, zero from an agent.** Nothing was broken; nothing was called.
 *
 * So this suite mocks nothing on the path. A real `AgentRunner`, a real
 * `openAgentTask`, the real `assemble()`, a real emitter and a real ledger on
 * disk. What it pins:
 *
 *   1. the bundle reaches the AGENT, on `ctx.contextBundle`;
 *   2. the manifest reaches the LEDGER, attributed to the agent rather than to
 *      chat, and correlated to the run's own task id;
 *   3. the manifest lands AFTER the assignment it explains — the bracket
 *      precedes what it describes, WP-51's ordering rule;
 *   4. **a quiet successful run still writes nothing at all.** That is the
 *      arithmetic WP-57's lazy frame was bought for (`auth-probe` runs every
 *      two minutes = 720 runs/day; a manifest per run would have put back
 *      the 1,440 events/day the laziness removed). Assembly happens on every
 *      run because it only reads; its RECORD rides the frame's realness test.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { AgentRunner } from '../../../src/main/agent-runtime/AgentRunner';
import { defineAgent, cron } from '../../../src/main/agent-sdk';
import type { AgentContext } from '../../../src/main/agent-sdk/types';
import type { ResolvedAIProvider } from '../../../src/main/ai/getAIProvider';
import { initIntelligenceCore, IntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../src/main/intelligence-host/coreRegistry';
import {
  AGENT_ASSEMBLER_SYSTEM,
  AGENT_SURFACE,
  CONTEXT_ASSEMBLED_TOPIC,
} from '../../../src/main/intelligence-host/agentAssembly';
import {
  RUN_ASSIGNED_TOPIC,
  RUN_COMPLETED_TOPIC,
} from '../../../src/main/intelligence-host/agentTaskFrame';

const resolvedProvider: ResolvedAIProvider = {
  provider: 'ollama', model: 'llama3.2', apiKey: '', useLocalGateway: false, isAvailable: false,
};

let core: IntelligenceCore;
let dir: string;
const persisted: any[] = [];

beforeEach(() => {
  persisted.length = 0;
  // Module-scoped, so it must be reset here or a later assertion reads an
  // earlier test's calls — green for the wrong run.
  calls.length = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp59-runner-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const calls: string[] = [];

function makeRunner() {
  const stateStore = {
    buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {} }),
    recordRun: jest.fn((r: any) => { persisted.push({ ...r }); }),
    attachTaskId: jest.fn(),
  };
  const toolRegistry = {
    call: jest.fn(async (name: string) => {
      calls.push(name);
      return { isError: false, content: [{ type: 'text', text: '{}' }] };
    }),
  };
  return new AgentRunner(stateStore as any, toolRegistry as any, {} as any, resolvedProvider);
}

/** Every task-plane event this run wrote, oldest first — order is an assertion here. */
function taskEvents(): any[] {
  return core.ledger.query({ topicPrefix: 'task.', order: 'asc', limit: 100 }) as any[];
}

describe('WP-59 · the agent run assembles, and the record proves it', () => {
  it('hands the bundle to the agent and writes ONE agent-attributed manifest', async () => {
    let seen: AgentContext | undefined;
    const agent = defineAgent({
      name: 'security-sentinel',
      version: '1.0.0',
      description: 'Scan installs for compromise indicators.',
      triggers: [cron('0 7 * * 1')],
      run: async (ctx) => {
        seen = ctx;
        // Makes the run REAL, so the frame flushes and the deferred manifest
        // drains. A quiet run is the next test.
        ctx.log.finding({ id: 'f1', severity: 'high', title: 'one' });
      },
    });

    const result = await makeRunner().run(agent, undefined, { trigger: 'cron' });
    expect(result.status).toBe('success');

    // 1 · the agent got it.
    expect(seen?.contextBundle).toBeDefined();
    expect(seen?.contextBundle?.manifest?.task).toBe(seen?.task?.id);

    // 2 · the ledger got it, exactly once, as the AGENT.
    const manifests = taskEvents().filter((e) => e.topic === CONTEXT_ASSEMBLED_TOPIC);
    expect(manifests).toHaveLength(1);
    const m = manifests[0];
    expect(m.actor.id).toBe('act_security_sentinel');
    expect(m.actor.kind).toBe('agent');
    // Not `act_chat_assembler`/`system`, which is the copy-paste this producer
    // exists to avoid: it would leave "what did the agent know" unanswered
    // while looking answered.
    expect(m.source.system).toBe(AGENT_ASSEMBLER_SYSTEM);
    expect(m.correlation).toBe(result.taskId);
    expect(m.payload.surface).toBe(AGENT_SURFACE);
    expect(m.payload.actor).toBe('act_security_sentinel');
    expect(m.payload.actor_autonomy).toBe('autonomous'); // ADR-7, derived from `cron`
    // The ASSEMBLY's own moment, carried out of the manifest rather than
    // stamped when the deferred write finally ran.
    expect(m.observed_at).toBe(m.payload.assembled_at);
    // A cron run has no target, and empty is the honest answer.
    expect(m.entity).toEqual({});

    // 3 · after the assignment, before the completion.
    const order = taskEvents().map((e) => e.topic);
    expect(order.indexOf(RUN_ASSIGNED_TOPIC)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(CONTEXT_ASSEMBLED_TOPIC)).toBeGreaterThan(order.indexOf(RUN_ASSIGNED_TOPIC));
    expect(order.indexOf(RUN_COMPLETED_TOPIC)).toBeGreaterThan(order.indexOf(CONTEXT_ASSEMBLED_TOPIC));
  });

  it('assembles for a QUIET run too — and records nothing for it', async () => {
    let seen: AgentContext | undefined;
    const agent = defineAgent({
      name: 'auth-probe',
      version: '1.0.0',
      triggers: [cron('*/2 * * * *')],
      run: async (ctx) => { seen = ctx; },
    });

    const result = await makeRunner().run(agent, undefined, { trigger: 'cron' });

    expect(result.status).toBe('success');
    // The agent was still given its context — assembly reads, it does not write.
    expect(seen?.contextBundle).toBeDefined();
    // And the 720-runs-a-day agent wrote nothing. Both halves matter: an
    // assertion on the manifest topic alone would pass against a frame that
    // had flushed for some other reason.
    expect(taskEvents()).toHaveLength(0);
    expect(result.taskId).toBeUndefined();
  });
});

/**
 * WP-59 · the other half of R3 — a REFUSAL binds, driven end to end.
 *
 * The suites above pin the two derivations: `agentAssembly.test.ts` pins what
 * `refusalBind` returns, `NexusToolProvider.refusal.test.ts` pins what the tool
 * gate does with it. Neither proves the wire between them exists — the exact
 * shape of gap this packet opened with (36 manifests, zero from an agent,
 * nothing broken and nothing called).
 *
 * So this drives the real thing, and the fail-closed input is real too: the
 * core's law registry is removed, so `assemble()` refuses an autonomous actor
 * with no policy set under ADR-7 rather than being handed a hand-built bundle.
 *
 * **Measured before it was written:** the test core normally assembles with a
 * real policy set (`pol.ops-default+…`, 10 constraints, `asserted: full`), so
 * `failClosed` is false and the tests above are not accidentally bound. A
 * refusal is genuinely exceptional, which is why making a bound run REAL does
 * not put back the 1,440-events/day the lazy frame removed.
 */
describe('WP-59 · a fail-closed assembly binds the real run', () => {
  it('refuses the act, keeps the read, and leaves the reason on the ledger', async () => {
    // No policy set. ADR-7: for an AUTONOMOUS actor that is a refusal, not a
    // degradation — which is the whole point of deriving autonomy from the
    // trigger rather than from the caller's preference.
    (core as any).law = undefined;

    let read: unknown;
    let refusal: Error | undefined;
    let bundleWasFailClosed: boolean | undefined;

    const agent = defineAgent({
      name: 'security-sentinel',
      version: '1.0.0',
      description: 'Scan installs for compromise indicators.',
      triggers: [cron('0 7 * * 1')],
      tools: ['nexus_list_sites', 'wp_plugin_update'],
      run: async (ctx) => {
        bundleWasFailClosed = ctx.contextBundle?.failClosed;
        read = await ctx.tools.invoke('nexus_list_sites', {});
        refusal = await ctx.tools
          .invoke('wp_plugin_update', { site: 's', plugin: 'akismet' })
          .then(() => undefined, (e: Error) => e);
      },
    });

    const result = await makeRunner().run(agent, undefined, { trigger: 'cron' });

    // The assembler really refused — not a hand-built bundle standing in for one.
    expect(bundleWasFailClosed).toBe(true);

    // The read went through to the registry; the act did not.
    expect(read).toBeDefined();
    expect(calls).toEqual(['nexus_list_sites']);
    expect(refusal?.message).toContain('assembled fail-closed');
    expect(refusal?.message).toContain('no operating policy set');

    // And the episode is FINDABLE. A bound run is not a quiet run: the refusal
    // flushed the frame, so the assignment and the manifest that says
    // `fail_closed` both landed, in that order.
    const events = taskEvents();
    const order = events.map((e) => e.topic);
    expect(order.indexOf(RUN_ASSIGNED_TOPIC)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(CONTEXT_ASSEMBLED_TOPIC))
      .toBeGreaterThan(order.indexOf(RUN_ASSIGNED_TOPIC));

    const manifest = events.find((e) => e.topic === CONTEXT_ASSEMBLED_TOPIC);
    expect(manifest.payload.fail_closed).toBe(true);
    expect(manifest.actor.id).toBe('act_security_sentinel');
    expect(manifest.correlation).toBe(result.taskId);
  });
});
