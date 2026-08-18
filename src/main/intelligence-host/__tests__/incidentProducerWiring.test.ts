/**
 * WP-25 · the incident producer, measured through the WIRED paths.
 *
 * `incidentProducer.test.ts` pins the producer's own rules against a core it
 * builds itself. This suite pins the thing that file cannot show, and the thing
 * that has actually gone wrong on this branch before: **a producer nothing
 * calls.** `services.operationAuditLog` was declared and never assigned, and no
 * audit file was ever created on any machine; WP-20e shipped stream shapes
 * nothing emitted. The failure mode is a green unit suite over dead code.
 *
 * So both taps are driven through the real seam:
 *   - the sentinel tap through a real `AgentRunner.run()`;
 *   - the abort tap through a real `assembleForChatTurn`, real law directory,
 *     real `rb.bulk-plugin-update`.
 *
 * The parity cases come first: an ordinary agent run and an ordinary chat turn
 * must record NOTHING, and must be the run and the turn they were before this
 * packet.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { assembleForChatTurn, forgetChatAssemblySession } from '../chatAssembly';
import { forgetProcedureStream, setProcedureStreamSink } from '../procedureStream';
import { environmentEntityId, siteEntityId } from '../provisionalEntity';
import { INCIDENT_TOPIC, SENTINEL_AGENT_ID } from '../incidentProducer';
import { AgentRunner } from '../../agent-runtime/AgentRunner';
import type { AgentDefinition } from '../../agent-sdk/types';
import type { ProcedureGrantRef } from '../../../intelligence';
import type { NexusServices } from '../../mcp/types';

const CAPABILITY = 'cap.bulk_plugin_update';
const SITE = { id: 'site_alpha', name: 'alpha', domain: 'alpha.local' };

let core: IntelligenceCore;
let dir: string;
let grant: ProcedureGrantRef;

const services = () =>
  ({
    siteData: {
      getSite: (id: string) => (id === SITE.id ? SITE : null),
      getSites: () => ({ [SITE.id]: SITE }),
    },
  }) as never as NexusServices;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-incident-wire-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetChatAssemblySession('s1');
  forgetProcedureStream('s1');
  setProcedureStreamSink(null);
  const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
  grant = { capability: CAPABILITY, runbookId: runbook.id, runbookHash: runbook.hash };
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function incidents() {
  return core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 100 });
}

// ---------------------------------------------------------------------------
// The sentinel tap, through AgentRunner
// ---------------------------------------------------------------------------

function runnerFor(): AgentRunner {
  const stateStore = {
    buildHandle: () => ({
      get: () => undefined,
      set: () => {},
      delete: () => {},
      scratch: {},
      isCoolingDown: () => false,
      setCooldown: () => {},
    }),
    recordRun: () => {},
    getLastRun: () => undefined,
    getRunHistory: () => [],
  } as never;
  const provider = {
    provider: 'anthropic',
    apiKey: 'test',
    model: 'claude-sonnet-5',
    useLocalGateway: false,
  } as never;
  return new AgentRunner(stateStore, {} as never, services(), provider);
}

function scanAgent(name: string, severity: string): AgentDefinition {
  return {
    name,
    version: '1.0.0',
    triggers: [],
    run: async () => ({
      verdict: 'findings' as const,
      findings: [],
      sites: {
        [SITE.name]: {
          status: 'escalated',
          findings: [
            { id: 'FS-02', severity: severity as never, title: 'Webshell in wp-content/uploads', site: SITE.name },
          ],
        },
      },
    }),
  };
}

describe('the sentinel tap, through a real agent run', () => {
  test('a completed sentinel sweep leaves an incident in the ledger', async () => {
    const result = await runnerFor().run(scanAgent(SENTINEL_AGENT_ID, 'critical'));
    expect(result.status).toBe('success');

    const events = incidents();
    expect(events).toHaveLength(1);
    expect(events[0].entity.site).toBe(siteEntityId(core.entities, SITE.id));
    expect(events[0].payload.fact).toBe('FS-02');
    // The run's OWN clock, carried through the chokepoint — not the fold's.
    expect(events[0].observed_at).toBe(new Date(result.finishedAt).toISOString());
    expect(events[0].payload.source).toBe(`sentinel:${result.runId}`);
  });

  test('parity — another agent finding the same thing records nothing', async () => {
    const result = await runnerFor().run(scanAgent('seo-insights', 'critical'));
    expect(result.status).toBe('success');
    expect(result.sites?.[SITE.name]?.findings).toHaveLength(1);
    expect(incidents()).toHaveLength(0);
  });

  test('parity — a run with no core is the run it always was', async () => {
    setIntelligenceCore(undefined as never);
    const result = await runnerFor().run(scanAgent(SENTINEL_AGENT_ID, 'critical'));
    expect(result.status).toBe('success');
    expect(result.sites?.[SITE.name]?.status).toBe('escalated');
  });
});

// ---------------------------------------------------------------------------
// The abort tap, through a real chat turn
// ---------------------------------------------------------------------------

const turn = (over: Record<string, unknown> = {}) =>
  assembleForChatTurn({
    services: services(),
    sessionId: 's1',
    siteId: SITE.id,
    userMessage: 'update the plugins on every staging site',
    buildingSystemPrompt: false,
    ...over,
  });

const armed = () => ({
  procedure: { grants: [grant], armed: { capability: CAPABILITY, armedBy: 'predicate' as const } },
});

/** One failed gated call inside this run's turn, as the gateway records it. */
function failedBackup(taskId: string, at: string): void {
  const entity = {
    environment: environmentEntityId(core.entities, SITE.id),
    site: siteEntityId(core.entities, SITE.id),
  };
  const action = core.emitter.emit({
    observed_at: at,
    topic: 'task.action.executed',
    schema: 'action.executed/1',
    entity,
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: taskId,
    payload: { tool: 'wpe_backup_and_verify', tier: 3, dispatch: 'registry' },
  });
  core.emitter.emit({
    observed_at: at,
    topic: 'task.outcome.recorded',
    schema: 'outcome.recorded/1',
    entity,
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: taskId,
    causation: action.id,
    payload: { tool: 'wpe_backup_and_verify', result: 'failure', result_scope: 'call' },
  });
}

describe('the abort tap, through the real chat seam', () => {
  test('parity — a turn with nothing armed records no incident', async () => {
    const result = await turn();
    expect(result).not.toBeNull();
    expect(incidents()).toHaveLength(0);
  });

  test('a halted run records its abort, and the NEXT turn carries it', async () => {
    const first = await turn(armed());
    expect(first).not.toBeNull();
    failedBackup(first!.taskId, '2026-07-04T10:00:00.000Z');

    // The turn on which the platform folds the halt.
    const second = await turn(armed());
    expect(second).not.toBeNull();
    const events = incidents();
    expect(events).toHaveLength(1);
    expect(events[0].payload.fact).toBe('ab.backup-failed');
    expect(events[0].observed_at).toBe('2026-07-04T10:00:00.000Z');

    // …and the turn after that RETRIEVES it — the loop the packet exists for:
    // the run that halted is the history the next run consults.
    const third = await turn(armed());
    expect(third!.turnBlock).toContain(INCIDENT_TOPIC);
    expect(third!.turnBlock).toContain('cp.backup failure or unverifiable backup');
  });

  test('the halt is recorded once, however many turns the session runs', async () => {
    const first = await turn(armed());
    failedBackup(first!.taskId, '2026-07-04T10:00:00.000Z');
    for (let i = 0; i < 4; i++) await turn(armed());
    expect(incidents()).toHaveLength(1);
  });
});
