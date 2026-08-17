/**
 * WP-20c · the cadence, measured through the WIRED path.
 *
 * `procedureDelivery.test.ts` pins the core's decisions over fixtures. This
 * suite pins the thing a fixture cannot show: that "full body once, hash
 * afterwards" survives a REAL multi-turn session — real core, real law
 * directory, real `rb.bulk-plugin-update` (the B-03 anchor), and the real
 * session memory in `chatAssembly.ts`. The bug this exists to catch is a
 * cadence that is correct in the assembler and broken in the host, which is
 * precisely where ADR-10 says the memory has to live.
 *
 * The grant is issued against the hash the REGISTRY loaded, never a literal:
 * that is what a real grant is issued against, and a literal would decay into a
 * test that pins the day it was written.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { assembleForChatTurn, forgetChatAssemblySession } from '../chatAssembly';
import type { ProcedureDelivery, ProcedureGrantRef, ProcedureRefusal } from '../../../intelligence';
import type { NexusServices } from '../../mcp/types';

const CAPABILITY = 'cap.bulk_plugin_update';

let core: IntelligenceCore;
let dir: string;
let grant: ProcedureGrantRef;

const services = () =>
  ({ siteData: { getSite: () => null, getSites: () => ({}) } }) as never as NexusServices;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-procedure-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetChatAssemblySession('s1');

  const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
  grant = { capability: CAPABILITY, runbookId: runbook.id, runbookHash: runbook.hash };
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const turn = (over: Record<string, unknown> = {}) =>
  assembleForChatTurn({
    services: services(),
    sessionId: 's1',
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

describe('the anchor runbook across a multi-turn session', () => {
  test('turn 1 carries the whole document; turn 2 carries the hash and the cursor', async () => {
    const first = await turn(armed());
    const second = await turn(armed());

    // Turn 1: the document itself, frontmatter obligations included.
    expect((first!.procedure as ProcedureDelivery).assertFull).toBe(true);
    expect(first!.turnBlock).toContain('id: rb.bulk-plugin-update');
    expect(first!.turnBlock).toContain('- id: cp.roll-fleet');
    expect(first!.turnBlock).toContain('canary-first, backup-always sequence');

    // Turn 2: the same procedure, asserted by hash, with none of the body.
    const reassert = second!.procedure as ProcedureDelivery;
    expect(reassert.assertFull).toBe(false);
    expect(reassert.bodyDelivered).toBe(false);
    expect(second!.turnBlock).toContain('remains in effect');
    expect(second!.turnBlock).not.toContain('canary-first, backup-always sequence');
    expect(second!.turnBlock).not.toContain('- id: cp.roll-fleet');

    // …and it costs what §3 says it costs: a re-assert is an order of magnitude
    // cheaper than the ride. Both numbers measured here, neither remembered.
    const full = (first!.procedure as ProcedureDelivery).tokens;
    expect(full).toBeGreaterThan(1000); // the anchor is ~1,215 estimated tokens
    expect(reassert.tokens).toBeLessThan(full / 10);
  });

  test('the third turn still re-asserts — the memory is not one-shot', async () => {
    await turn(armed());
    await turn(armed());
    const third = await turn(armed());

    expect((third!.procedure as ProcedureDelivery).assertFull).toBe(false);
  });

  test('a cursor turns the re-assert into progress: attested, and what is next', async () => {
    // WP-20d: the cursor is DERIVED from the ledger, not supplied — an
    // attestation a caller could hand in would be a claim, which is the one
    // thing P4 says an attestation can never be. So the progress here comes
    // from a real approval event on a real earlier turn.
    const first = await turn(armed());
    // The assembler's own manifest attests cp.consult-history only when it
    // actually ran an episodic query — which needs a resolved target, and this
    // harness selects no site. So the consultation is emitted explicitly here,
    // standing in for a turn that named one. (Measured, not assumed: without
    // this the cursor correctly reports cp.consult-history unattested.)
    core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: 'task.context.assembled',
      schema: 'context.assembled/1',
      entity: {},
      actor: { id: 'act_chat_assembler', kind: 'system' },
      source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
      correlation: first!.taskId,
      payload: { task: first!.taskId, retrieval: [{ store: 'ledger', query: 'q', returned: 1 }] },
    });
    core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: 'task.rationale.recorded',
      schema: 'rationale.recorded/1',
      entity: {},
      actor: { id: 'act_local_operator', kind: 'human' },
      source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
      correlation: first!.taskId,
      payload: { tool: 'bulk_plugin_update', decision: 'approved', prompt: 'card', source: 'approval-card' },
    });

    const second = await turn(armed());

    expect(second!.turnBlock).toContain('Attested: cp.consult-history, cp.approval.');
    expect(second!.turnBlock).toContain('Next gated checkpoint: cp.backup');
    // The four the platform cannot prove are named as such, every turn.
    expect(second!.turnBlock).toContain('cannot verify cp.dry-run, cp.canary, cp.verify-canary, cp.report');
  });

  test('clearing the session re-delivers in full — a forgotten actor carries nothing', async () => {
    await turn(armed());
    forgetChatAssemblySession('s1');
    const afterClear = await turn(armed());

    expect((afterClear!.procedure as ProcedureDelivery).assertFull).toBe(true);
    expect(afterClear!.turnBlock).toContain('canary-first, backup-always sequence');
  });

  test('a turn that disarms clears the memory, so re-arming re-delivers in full', async () => {
    await turn(armed());
    const unarmed = await turn({ procedure: { grants: [grant] } });
    const rearmed = await turn(armed());

    expect(unarmed!.procedure).toBeNull();
    // The actor was told nothing this turn, so it cannot be assumed to still
    // carry the document: the next arming turn ships it whole.
    expect((rearmed!.procedure as ProcedureDelivery).assertFull).toBe(true);
  });

  test('a disarmed turn ends the RUN as well as the memory — attestations do not carry over', async () => {
    const first = await turn(armed());
    core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: 'task.rationale.recorded',
      schema: 'rationale.recorded/1',
      entity: {},
      actor: { id: 'act_local_operator', kind: 'human' },
      source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
      correlation: first!.taskId,
      payload: { tool: 'bulk_plugin_update', decision: 'approved', prompt: 'card', source: 'approval-card' },
    });

    await turn({ procedure: { grants: [grant] } }); // disarmed turn
    const rearmed = await turn(armed());

    // The approval belonged to a run the actor was told had stopped. Carrying
    // it into the next arming would let a procedure inherit consent that was
    // given for a different one.
    expect(rearmed!.turnBlock).not.toContain('Attested: cp.approval');
  });

  test('a stale pin refuses on the wired path too, naming both hashes', async () => {
    const stale = { ...grant, runbookHash: 'sha256:' + '1'.repeat(64) };
    const result = await turn({
      procedure: {
        grants: [stale],
        armed: { capability: CAPABILITY, armedBy: 'predicate' as const },
      },
    });

    const refusal = result!.procedure as ProcedureRefusal;
    expect(refusal.code).toBe('hash-mismatch');
    expect(result!.turnBlock).toContain(stale.runbookHash);
    expect(result!.turnBlock).toContain(grant.runbookHash);
    expect(result!.turnBlock).not.toContain('canary-first, backup-always sequence');
  });

  test('the manifest event records the procedure, so the ledger can answer "what did it have"', async () => {
    const first = await turn(armed());

    const [event] = core.ledger.query({ correlation: first!.taskId });
    const procedure = (event.payload as Record<string, unknown>).procedure as Record<string, unknown>;

    expect(procedure).toMatchObject({
      capability: CAPABILITY,
      runbook: 'rb.bulk-plugin-update',
      status: 'delivered',
      asserted: 'full',
      armed_by: 'predicate',
      strictness: 'strict',
      checkpoints: 8,
      attested: 0,
    });
    expect(procedure.hash).toBe(grant.runbookHash);
    // The cost of the procedure is inside the turn's budget, not beside it.
    const budget = (event.payload as Record<string, unknown>).budget as Record<string, number>;
    expect(budget.tokens_used).toBeGreaterThanOrEqual(procedure.tokens as number);
    expect(procedure.tokens as number).toBeGreaterThan(1000);
  });

  test('the second turn’s manifest says hash, not full — the audit trail states the cadence', async () => {
    await turn(armed());
    const second = await turn(armed());

    const [event] = core.ledger.query({ correlation: second!.taskId });
    const procedure = (event.payload as Record<string, unknown>).procedure as Record<string, unknown>;

    // "The actor was carrying rb.bulk-plugin-update at this hash" is provable
    // from the record without the body having been re-shipped (ADR-20's claim).
    expect(procedure.asserted).toBe('hash');
    expect(procedure.hash).toBe(grant.runbookHash);
    expect(procedure.tokens as number).toBeLessThan(200);
  });

  test('a turn with NO GRANTS is what it was before this packet', async () => {
    // Updated at WP-20b, which supplied the missing half of the seam: a caller
    // that passes no `procedure` now gets the live grant set by default
    // (`procedureRequestForTurn`), so the index rides — §3's ruled always-on
    // line. The parity floor therefore reads on the GRANTS, which is where it
    // always meant to read: no grant, no procedure text of any kind.
    const plain = await turn({ procedure: { grants: [] } });

    expect(plain!.procedure).toBeNull();
    expect(plain!.turnBlock === null || !plain!.turnBlock.includes('Procedure')).toBe(true);
  });

  test('two sessions do not share a procedure memory', async () => {
    forgetChatAssemblySession('s2');
    await turn(armed());
    const other = await assembleForChatTurn({
      services: services(),
      sessionId: 's2',
      userMessage: 'update the plugins on every staging site',
      buildingSystemPrompt: false,
      ...armed(),
    });

    expect((other!.procedure as ProcedureDelivery).assertFull).toBe(true);
    forgetChatAssemblySession('s2');
  });
});
