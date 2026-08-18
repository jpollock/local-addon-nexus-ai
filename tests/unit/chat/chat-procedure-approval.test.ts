/**
 * WP-26 · the approval card is the canary policy's producer.
 *
 * Three claims, driven through the REAL `ChatService.sendMessage` rather than
 * asserted on a private method:
 *
 *  1. **Parity.** An approval with nothing armed emits the same card it always
 *     did — no `procedure` block, no policy, nothing new on the wire.
 *  2. **The card knows where the run is standing, and the PLATFORM told it.**
 *     The `procedure` block is `procedureApprovalContext`'s output verbatim; the
 *     renderer derives no checkpoint state of its own (P7).
 *  3. **The chosen policy reaches the ledger as part of the approval**, because
 *     consent is elicited intent and the approval is the human act that elicits
 *     it. A denial carries none and is recorded as a denial — which is what
 *     `foldProcedureCursor(...).denied` reads.
 *
 * The procedure state here is established by the production emitter
 * (`notifyProcedureState`) over the real anchor runbook, not by mocking the
 * context getter: a mocked getter would pin ChatService against a fiction.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { ChatService } from '../../../src/main/chat/ChatService';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { createSessionTables } from '../../../src/main/ipc/chat-sessions';
import { initIntelligenceCore, IntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../src/main/intelligence-host/coreRegistry';
import {
  CONTEXT_ASSEMBLED_TOPIC,
  CONTEXT_ASSEMBLED_SCHEMA,
} from '../../../src/main/intelligence-host/chatAssembly';
import { RATIONALE_RECORDED_TOPIC } from '../../../src/main/intelligence-host/actionProducer';
import {
  armProcedureRun,
  foldProcedureCursor,
  registerProcedureTurn,
  runForTask,
  forgetProcedureRun,
} from '../../../src/main/intelligence-host/procedureCursor';
import {
  forgetProcedureStream,
  notifyProcedureState,
} from '../../../src/main/intelligence-host/procedureStream';
import type { NexusServices, McpToolHandler } from '../../../src/main/mcp/types';

const TASK = 'task_01J5X8K3V9Q2M7ABCDEFGHJKMN';
const SESSION = 'panel-1';
const CAPABILITY = 'cap.bulk_plugin_update';
const GATED_TOOL = 'bulk_plugin_update';
/**
 * An approval-required tool that no runbook claims. It exists here to prove the
 * parity case: the card an ordinary Tier-3/freeform approval produces is
 * unchanged by this packet.
 */
const ORDINARY_TOOL = 'wp_eval';
/**
 * WP-31 · the tool the 2026-08-18 incident actually called. Tier 2, claimed by
 * NO checkpoint, forbidden only in the runbook's prose. Exclusive scope refuses
 * it — and the refusal must NOT be the one the approval card rides.
 */
const UNCLAIMED_WRITE = 'wp_plugin_update';

const mockAssemble = jest.fn();
jest.mock('../../../src/main/intelligence-host/chatAssembly', () => {
  const actual = jest.requireActual('../../../src/main/intelligence-host/chatAssembly');
  return {
    ...actual,
    assembleForChatTurn: (...args: unknown[]) => mockAssemble(...args),
  };
});

jest.mock('../../../src/main/chat/tool-adapter', () => ({ adaptToolsForChat: () => [] }));

let mockProviderInstance: any = null;
jest.mock('../../../src/main/chat/providers/index', () => ({
  getProvider: () => mockProviderInstance,
  initializeProviders: () => {},
  listProviders: () => [],
}));

/** Yields ONE tool call on the first turn, then ends. */
function toolCallingProvider(call: { id: string; name: string; arguments: Record<string, unknown> }) {
  let turn = 0;
  return {
    id: 'mock',
    displayName: 'Mock',
    requiresApiKey: false,
    defaultModels: ['mock-model'],
    async *streamChat() {
      if (turn++ === 0) {
        yield { type: 'tool_call_end', ...call };
        yield { type: 'done', stopReason: 'tool_use' };
        return;
      }
      yield { type: 'token', text: 'done' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
    async listModels() { return ['mock-model']; },
    async validateKey() { return null; },
  };
}

let core: IntelligenceCore;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-chat-approval-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetProcedureRun(SESSION);
  forgetProcedureStream(SESSION);
  mockAssemble.mockReset().mockResolvedValue({
    taskId: TASK,
    ambientBlock: null,
    turnBlock: null,
    grants: undefined,
    procedure: null,
  });
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
  setIntelligenceCore(undefined as never);
});

/**
 * Put the session's stream memory where a strict run standing at its approval
 * checkpoint would put it — through the production emitter, over the real
 * `rb.bulk-plugin-update` the registry loaded.
 */
function armAtApproval(): void {
  const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
  armProcedureRun({
    sessionId: SESSION,
    capability: CAPABILITY,
    runbookId: runbook.id,
    runbookHash: runbook.hash,
  });
  registerProcedureTurn({ sessionId: SESSION, taskId: TASK });

  // The assembler's own episodic retrieval is what attests cp.consult-history.
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: CONTEXT_ASSEMBLED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: TASK,
    payload: {
      task: TASK,
      retrieval: [{ store: 'ledger', query: 'entity=x topic=episodic.*', returned: 0 }],
    },
  });

  notifyProcedureState({
    sessionId: SESSION,
    outcome: {
      status: 'delivered',
      capability: CAPABILITY,
      runbookId: runbook.id,
      version: runbook.version,
      hash: runbook.hash,
      strictness: 'strict',
      armedBy: 'predicate',
      assertFull: true,
      bodyDelivered: true,
      checkpoints: runbook.checkpoints.map((c) => ({ id: c.id, attest: c.attest, attested: false })),
      steps: [],
      tokens: 900,
    },
    runbook,
    run: runForTask(TASK),
    ledger: core.ledger,
  });
}

interface Harness {
  service: ChatService;
  events: Array<Record<string, unknown>>;
  /** Tool names whose handler actually ran — a refusal never reaches one. */
  executed: string[];
}

/** `decide` is called with the approval event; return the decision to send back. */
function harness(decide?: (event: any) => { approved: boolean; canaryPolicy?: string }): Harness {
  const executed: string[] = [];
  const db = new Database(':memory:');
  createSessionTables(db);

  const registry = new ToolRegistry();
  for (const name of [GATED_TOOL, ORDINARY_TOOL, UNCLAIMED_WRITE]) {
    registry.register({
      definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
      execute: async () => {
        executed.push(name);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    } as unknown as McpToolHandler);
  }

  const services = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    indexRegistry: { get: () => null, listAll: () => [] },
    fileScanner: { scan: async () => ({ wpVersion: '', phpVersion: '', themes: [], plugins: [] }) },
    graphService: { getDb: () => db },
  } as unknown as NexusServices;

  const events: Array<Record<string, unknown>> = [];
  let service!: ChatService;
  service = new ChatService({
    registry,
    services,
    sendToRenderer: (_channel: string, ...args: unknown[]) => {
      const sessionId = args[0] as string;
      const event = args[1] as any;
      events.push(event);
      if (event?.type === 'tool_call_approval_needed' && decide) {
        const decision = decide(event);
        setImmediate(() =>
          service.resolveApproval(sessionId, event.id, decision.approved, decision.canaryPolicy as never)
        );
      }
    },
  });
  return { service, events, executed };
}

const send = (service: ChatService) =>
  service.sendMessage(SESSION, 'update the plugins', { providerId: 'mock', model: 'mock-model' });

const rationales = () => core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 20 });

// ---------------------------------------------------------------------------

describe('parity — nothing armed', () => {
  test('the approval card is exactly the card it was: no procedure block', async () => {
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: ORDINARY_TOOL, arguments: { code: 'x' } });
    const { service, events } = harness(() => ({ approved: true }));

    await send(service);

    const card = events.find((e) => e.type === 'tool_call_approval_needed')!;
    expect(card).toBeDefined();
    expect(card).not.toHaveProperty('procedure');
  });

  test('and the approval it records carries no canary policy', async () => {
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: ORDINARY_TOOL, arguments: { code: 'x' } });
    const { service } = harness(() => ({ approved: true }));

    await send(service);

    const [rationale] = rationales();
    expect(rationale.payload as Record<string, unknown>).not.toHaveProperty('canary_policy');
  });
});

describe('a strict run standing at its approval checkpoint', () => {
  test('the card fires for a TIER-2 tool the runbook gates — without it the run deadlocks', async () => {
    // `bulk_plugin_update` is Tier 2: nothing in `requiresHumanApproval` has
    // ever shown a card for it. The runbook declares cp.approval as the
    // checkpoint a human decision attests, and the sequence guard refuses the
    // tool until it is attested — so with no card there is no producer for that
    // decision and the anchor capability is refused forever.
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });
    const { service, events } = harness(() => ({ approved: true }));

    await send(service);

    expect(events.some((e) => e.type === 'tool_call_approval_needed')).toBe(true);
  });

  test('the card carries the plan reference the platform derived', async () => {
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });
    const { service, events } = harness(() => ({ approved: true }));

    await send(service);

    const card = events.find((e) => e.type === 'tool_call_approval_needed')! as any;
    expect(card.procedure).toEqual({
      runbookId: 'rb.bulk-plugin-update',
      // 1.1.0 since WP-28 authored the `unrequested:` marks on the document.
      version: '1.1.0',
      strictness: 'strict',
      checkpointId: 'cp.approval',
      offersCanaryPolicy: true,
      unverifiablePrecedent: { checkpointId: 'cp.dry-run', reason: 'show what would change' },
    });
  });

  test('the chosen policy is recorded ON the approval', async () => {
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });
    const { service } = harness(() => ({ approved: true, canaryPolicy: 'continue-if-clean' }));

    await send(service);

    const [rationale] = rationales();
    expect((rationale.payload as Record<string, unknown>).decision).toBe('approved');
    expect((rationale.payload as Record<string, unknown>).canary_policy).toBe('continue-if-clean');
  });

  test('choosing nothing records nothing — the default stays a default', async () => {
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });
    const { service } = harness(() => ({ approved: true }));

    await send(service);

    const [rationale] = rationales();
    expect(rationale.payload as Record<string, unknown>).not.toHaveProperty('canary_policy');
  });

  test('the card text does not repeat the reference the styled block already shows', async () => {
    // WP-28 finding 2. The card renders the runbook, its version and the
    // checkpoint from `procedure` as its own styled block; the warning line
    // beneath it used to open with the identical sentence, so the reference
    // appeared twice on one card. The block is the single place it belongs.
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });
    const { service, events } = harness(() => ({ approved: true }));

    await send(service);

    const card = events.find((e) => e.type === 'tool_call_approval_needed')! as any;
    expect(card.warning).not.toContain('rb.bulk-plugin-update');
    expect(card.warning).not.toContain('marked strict');
    expect(card.warning).not.toContain('cp.approval');
    // Still a card with something to say — dropping the duplicate must not
    // leave the warning line empty.
    expect(String(card.warning).length).toBeGreaterThan(0);
  });

  test('the recorded prompt names the runbook the human was shown', async () => {
    // `prompt` is "the card the human was shown", verbatim — the WHOLE card,
    // including the styled reference block, which is why WP-28 dropped the
    // duplicate from the warning LINE and not from the recorded text. A prompt
    // that omitted the reference would make the ledger's own claim about itself
    // untrue, and would leave a rationale event that cannot say which document
    // the decision was taken under.
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });
    const { service } = harness(() => ({ approved: true }));

    await send(service);

    const [rationale] = rationales();
    expect((rationale.payload as Record<string, unknown>).prompt).toContain('rb.bulk-plugin-update');
    expect((rationale.payload as Record<string, unknown>).prompt).toContain('cp.approval');
  });

  test('DENY is final: recorded as a denial, and the fold reports it', async () => {
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });
    const { service } = harness(() => ({ approved: false, canaryPolicy: 'continue-if-clean' }));

    await send(service);

    const [rationale] = rationales();
    expect((rationale.payload as Record<string, unknown>).decision).toBe('denied');
    expect(rationale.payload as Record<string, unknown>).not.toHaveProperty('canary_policy');

    // The M4 query. A denial the fold cannot see is a denial the gateway will
    // walk straight past on the next turn.
    const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
    const cursor = foldProcedureCursor(runForTask(TASK)!, runbook.checkpoints, core.ledger);
    expect(cursor.denied).toContain('cp.approval');
  });
});

describe('an approver that answers inside the emit call', () => {
  test('does not hang the turn — the pending approval is registered before the card goes out', async () => {
    // `emit` runs synchronously into `sendToRenderer`. A headless approver —
    // the eval sitting harness is one — answers there and then. Registering the
    // pending approval AFTER emitting meant that answer resolved nothing and
    // the await never returned; production only escaped it because a real
    // renderer replies over IPC on a later tick.
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });

    const db = new Database(':memory:');
    createSessionTables(db);
    const registry = new ToolRegistry();
    registry.register({
      definition: { name: GATED_TOOL, description: GATED_TOOL, inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    } as unknown as McpToolHandler);

    let service!: ChatService;
    service = new ChatService({
      registry,
      services: {
        siteData: { getSite: () => null, getSites: () => ({}) },
        indexRegistry: { get: () => null, listAll: () => [] },
        fileScanner: { scan: async () => ({ wpVersion: '', phpVersion: '', themes: [], plugins: [] }) },
        graphService: { getDb: () => db },
      } as unknown as NexusServices,
      sendToRenderer: (_channel: string, ...args: unknown[]) => {
        const event = args[1] as any;
        // SYNCHRONOUS, deliberately — no setImmediate.
        if (event?.type === 'tool_call_approval_needed') {
          service.resolveApproval(args[0] as string, event.id, true);
        }
      },
    });

    await expect(
      Promise.race([
        send(service).then(() => 'returned'),
        new Promise((r) => setTimeout(() => r('hung'), 2000)),
      ])
    ).resolves.toBe('returned');
  });
});

describe('the stream reaches the renderer', () => {
  test('a procedure event emitted host-side arrives on the chat stream', async () => {
    const { events } = harness();
    // Constructing the service registers the sink; the emitter is the seam.
    armAtApproval();

    const armedEvent = events.find((e) => e.type === 'procedure_armed') as any;
    expect(armedEvent).toBeDefined();
    expect(armedEvent.procedure.runbookId).toBe('rb.bulk-plugin-update');
  });
});


/**
 * WP-31 · the approval card must not become the exclusive-scope refusal's escape
 * hatch.
 *
 * `gatedOnApproval` fires when the sequence guard is refusing THIS call on
 * exactly the checkpoint an approval would attest. Exclusive scope refuses an
 * unclaimed write and names the CURRENT checkpoint — which, for a run standing
 * where the incident's run stood, is `cp.approval`. Left alone, the card would
 * have offered a human the chance to bless `wp_plugin_update` itself: consent
 * for the substitution, harvested by the mechanism built to prevent it.
 */
describe('WP-31 — an exclusive-scope refusal never raises the approval card', () => {
  test('the unclaimed write is refused, no card is shown, and the handler never runs', async () => {
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: UNCLAIMED_WRITE, arguments: { site: 's', plugin: 'p' } });
    const { service, events, executed } = harness(() => ({ approved: true }));

    await send(service);

    expect(events.some((e) => e.type === 'tool_call_approval_needed')).toBe(false);
    expect(executed).not.toContain(UNCLAIMED_WRITE);
    // And nothing was recorded as a decision: a refusal is not an act, and it
    // is certainly not consent.
    expect(rationales()).toHaveLength(0);
  });

  test('the tool the runbook DOES gate still raises the card — the two refusals stay apart', async () => {
    armAtApproval();
    mockProviderInstance = toolCallingProvider({ id: 'c1', name: GATED_TOOL, arguments: {} });
    const { service, events } = harness(() => ({ approved: true }));

    await send(service);

    expect(events.some((e) => e.type === 'tool_call_approval_needed')).toBe(true);
  });
});
