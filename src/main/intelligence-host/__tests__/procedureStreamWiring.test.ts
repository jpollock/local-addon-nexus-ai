/**
 * WP-26 · the stream, measured through the WIRED path.
 *
 * `procedureStream.test.ts` pins the emitter's own rules over a fixture
 * runbook. This suite pins the thing a fixture cannot show: that the seam which
 * FOLDS the cursor is the seam that emits — real core, real law directory, real
 * `rb.bulk-plugin-update`, real `assembleForChatTurn`. The failure it exists to
 * catch is an emitter that is correct in isolation and never called, which is
 * exactly the shape WP-20e left behind on purpose ("nothing emits them").
 *
 * The parity case is first, because it is the one that must hold for every user
 * who has armed nothing: a chat turn produces ZERO emissions and is otherwise
 * the turn it was before this packet.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { assembleForChatTurn, forgetChatAssemblySession } from '../chatAssembly';
import { recordApprovalRationale } from '../actionProducer';
import {
  forgetProcedureStream,
  procedureApprovalContext,
  setProcedureStreamSink,
  ProcedureStreamEvent,
} from '../procedureStream';
import { foldProcedureCursor, runForTask } from '../procedureCursor';
import type { ProcedureGrantRef } from '../../../intelligence';
import type { NexusServices } from '../../mcp/types';

const CAPABILITY = 'cap.bulk_plugin_update';

let core: IntelligenceCore;
let dir: string;
let grant: ProcedureGrantRef;
let emitted: Array<{ sessionId: string; event: ProcedureStreamEvent }>;

/**
 * A real selected site, because `cp.consult-history` attests from the
 * assembler's OWN episodic retrieval and the episodic plane only runs when the
 * turn has a target. A serviceless turn assembles `retrieval: []`, which
 * attests nothing — correctly: the supply side is what a manifest attestation
 * claims, and no query ran.
 */
const SITE = { id: 'site_alpha', name: 'alpha', domain: 'alpha.local' };

const services = () =>
  ({
    siteData: {
      getSite: (id: string) => (id === SITE.id ? SITE : null),
      getSites: () => ({ [SITE.id]: SITE }),
    },
  }) as never as NexusServices;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-stream-wire-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetChatAssemblySession('s1');
  forgetProcedureStream('s1');
  emitted = [];
  setProcedureStreamSink((sessionId, event) => emitted.push({ sessionId, event }));

  const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
  grant = { capability: CAPABILITY, runbookId: runbook.id, runbookHash: runbook.hash };
});

afterEach(() => {
  setProcedureStreamSink(null);
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const turn = (over: Record<string, unknown> = {}) =>
  assembleForChatTurn({
    services: services(),
    sessionId: 's1',
    siteId: SITE.id,
    userMessage: 'update the plugins on every staging site',
    buildingSystemPrompt: false,
    ...over,
  });

const armed = (over: Record<string, unknown> = {}) => ({
  procedure: {
    grants: [grant],
    armed: { capability: CAPABILITY, armedBy: 'predicate' as const },
    ...over,
  },
});

const types = () => emitted.map((e) => e.event.type);

describe('parity — a chat turn with nothing armed', () => {
  test('emits nothing at all', async () => {
    const result = await turn();
    expect(result).not.toBeNull();
    expect(emitted).toEqual([]);
  });

  test('and still has no approval context to offer a card', async () => {
    await turn();
    expect(procedureApprovalContext('s1')).toBeNull();
  });
});

describe('the armed run, through the real assembler', () => {
  test('turn 1 emits the declaration; a turn that changes nothing emits nothing', async () => {
    await turn(armed());
    expect(types()).toEqual(['procedure_armed']);

    const event = emitted[0].event;
    if (event.type !== 'procedure_armed') throw new Error('wrong event');
    expect(event.procedure.runbookId).toBe('rb.bulk-plugin-update');
    expect(event.procedure.strictness).toBe('strict');
    // The anchor's four provable checkpoints of eight — the honest denominator,
    // read off the document the registry actually loaded, not a literal.
    expect(event.procedure.checkpoints).toHaveLength(8);
    expect(event.procedure.verifiableCount).toBe(4);

    // THE ARMING TURN ALREADY STANDS AT cp.approval, and this is the assertion
    // the packet turned on. `cp.consult-history` attests from the manifest THIS
    // turn wrote; the stream folds after it, so the declaration a surface
    // receives is the one the sequence guard will enforce against — not the
    // older view the model's own carrier carries. A stream folding upstream
    // would announce cp.consult-history as the active step on the very turn the
    // gate is already demanding the approval.
    const rail = Object.fromEntries(event.procedure.checkpoints.map((c) => [c.id, c.status]));
    expect(rail['cp.consult-history']).toBe('attested');
    expect(rail['cp.approval']).toBe('active');

    emitted = [];
    await turn(armed());
    expect(emitted).toEqual([]);
  });

  test('an approval recorded between turns emits ONE checkpoint_changed', async () => {
    const first = await turn(armed());
    emitted = [];

    recordApprovalRationale({
      toolName: 'bulk_plugin_update',
      args: {},
      cardText: 'Updates plugins on 3 sites.',
      decision: 'approved',
      taskId: first!.taskId,
    });

    await turn(armed());
    expect(types()).toEqual(['checkpoint_changed']);
    const event = emitted[0].event;
    if (event.type !== 'checkpoint_changed') throw new Error('wrong event');
    expect(event.changed.map((c) => c.id)).toContain('cp.approval');
    const approval = event.changed.find((c) => c.id === 'cp.approval')!;
    expect(approval.status).toBe('attested');
  });

  test('a denial emits the abort, and the fold still reports the denial — M4 can see it', async () => {
    const first = await turn(armed());
    emitted = [];

    recordApprovalRationale({
      toolName: 'bulk_plugin_update',
      args: {},
      cardText: 'Updates plugins on 3 sites.',
      decision: 'denied',
      taskId: first!.taskId,
    });

    await turn(armed());
    expect(types()).toContain('procedure_aborted');

    // c.denial-is-final has TWO halves and only one of them is the notice. The
    // run must NOT be forgotten by the abort: forgetting it would empty the
    // cursor, the guard would stop refusing, and the denial the user made would
    // become invisible to the query that proves it was honoured.
    const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
    const run = runForTask(first!.taskId)!;
    expect(run).toBeDefined();
    const cursor = foldProcedureCursor(run, runbook.checkpoints, core.ledger);
    expect(cursor.denied).toContain('cp.approval');
    expect(cursor.attested).not.toContain('cp.approval');
  });
});

describe('session lifetime', () => {
  test('re-arms in full after the session is forgotten', async () => {
    await turn(armed());
    expect(types()).toEqual(['procedure_armed']);

    // A cleared chat, a deleted session. The cursor's run is dropped, so the
    // stream's memory of what it has announced must go with it — diffing the
    // next run against a run that no longer exists would announce a rail whose
    // declaration the surface was never given.
    forgetChatAssemblySession('s1');
    emitted = [];

    await turn(armed());
    expect(types()).toEqual(['procedure_armed']);
  });
});

describe('the approval context the card is emitted with', () => {
  test('a strict run standing at its approval checkpoint offers the canary policy', async () => {
    // ONE turn. cp.consult-history attests from the assembler's OWN episodic
    // retrieval on this turn, and the card fires on this turn too — a context
    // that needed a second turn would be absent for every single-turn run.
    await turn(armed());

    expect(procedureApprovalContext('s1')).toEqual({
      runbookId: 'rb.bulk-plugin-update',
      // 1.1.0 since WP-28 authored `unrequested:` on the shipped document. This
      // context is read from the real law/ directory, so the version moves with it.
      version: '1.1.0',
      strictness: 'strict',
      checkpointId: 'cp.approval',
      offersCanaryPolicy: true,
      // The real document's own authored reason, read off its body.
      unverifiablePrecedent: { checkpointId: 'cp.dry-run', reason: 'show what would change' },
    });
  });

  test('once the approval is attested the card has nothing left to offer', async () => {
    const first = await turn(armed());
    recordApprovalRationale({
      toolName: 'bulk_plugin_update',
      args: {},
      cardText: 'card',
      decision: 'approved',
      taskId: first!.taskId,
    });
    await turn(armed());

    expect(procedureApprovalContext('s1')).toBeNull();
  });
});
