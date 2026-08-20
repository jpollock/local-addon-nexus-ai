/**
 * WP-49 · XD-27 RIDER 1 — the measurement, pinned so the escalation cannot rot.
 *
 * The rider asks for an in-flight run that needs nobody to sit in
 * `Nothing needed of you` as one line with its door, and to promote itself into
 * the list when it stalls or reaches a gate. The launch instruction was explicit
 * about how to build it: "Drive that promotion in a test through real emitters —
 * it is the consequence order working, not a new mechanism."
 *
 * IT CANNOT BE DRIVEN, AND THAT IS THE FINDING. The starting state has no
 * representation in the query contract, which this file establishes against the
 * REAL registry over a REAL ledger rather than by reading the fold. Three
 * findings, one test each:
 *
 *  1. a session the registry can place against a document ALWAYS has a gate —
 *     the "in flight, needing nothing" state has no shape;
 *  2. `PendingGate.awaits === 'evidence'` is not "needs nobody": the morning's
 *     HALTED run carries it, and so does the designer's own class-2 row
 *     ("waiting on evidence from you"). One value, two opposite meanings, and
 *     `Situation` carries no `status` to separate them;
 *  3. the one gateless waiting session is `documentUnavailable` — XD-26's 6c,
 *     where the platform names its own limit — and `Situation` does not carry
 *     that field either, so a surface cannot even recognise it in order to
 *     refuse it.
 *
 * WHAT MAKES THIS A PIN RATHER THAN A NOTE. Each test asserts a property of the
 * SHIPPED fold, not of a decision this packet made. The day the contract gains
 * the fact — a `status` on `Situation`, or a `needsNobody` the fold derives —
 * finding 1 or 3 goes red, and the failure message says the rider is buildable
 * now. An escalation recorded only in prose would still be sitting in a document
 * nobody re-reads.
 *
 * SHAPE #15: every test asserts the fixture's events exist (via
 * `assertGoldenShape` / an explicit `sessions()` length) before asserting
 * anything about what the fold made of them. A fold over an empty ledger would
 * satisfy every "no session has X" assertion below vacuously.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { initIntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../src/main/intelligence-host/coreRegistry';
import { createSessionRegistry } from '../../../src/main/intelligence-host/sessionRegistry';
import { taskId as mintTaskId } from '../../../src/intelligence';
import { assertGoldenShape, buildMorning, NOW, type Morning } from './helpers/returnMorning';

let morning: Morning;

beforeEach(() => { morning = buildMorning(); });
afterEach(() => { morning.close(); });

describe('XD-27 rider 1 — the state it describes has no shape in the fold', () => {
  test('finding 1 · every placed session is either complete or standing at a gate', () => {
    assertGoldenShape(morning);
    const rows = morning.registry().sessions();
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      if (row.documentUnavailable) continue; // finding 3's shape, tested below
      // `deriveGate` takes the first checkpoint whose state is `active`. A run
      // with none is a run whose every checkpoint is attested or narrative,
      // which `deriveStatus` calls complete. So there is no third state for an
      // "in flight, needing nothing" row to occupy.
      const placed = row.status === 'complete' || row.gate !== undefined;
      expect({ runbook: row.runbookId, status: row.status, placed }).toEqual({
        runbook: row.runbookId, status: row.status, placed: true,
      });
    }
  });

  test('finding 2 · awaits "evidence" is carried by a HALTED run, so it cannot mean "needs nobody"', () => {
    assertGoldenShape(morning);
    const rows = morning.registry().sessions();

    const evidenceGated = rows.filter((r) => r.gate?.awaits === 'evidence');
    // The morning HAS such a row — otherwise this test would pass over an empty
    // set and prove nothing, which is shape #15 at the assertion level.
    expect(evidenceGated.length).toBeGreaterThan(0);

    // …and it is halted, not running. A predicate that read `awaits` as "the
    // run is working" would file a halted run under Nothing-needed-of-you.
    expect(evidenceGated.map((r) => r.status)).toContain('halted');

    // The separating fact exists on `SessionRow` and NOT on `Situation`, which
    // is what the surface receives. This is the contract gap, asserted.
    const situation = morning
      .triage()
      .waiting.find((s) => s.sessionId === evidenceGated[0].id);
    expect(situation).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(situation as object, 'status')).toBe(false);
  });

  test('finding 3 · the one gateless waiting session is 6c, and the surface cannot recognise it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp49-rider1-'));
    const kv = new Map<string, unknown>();
    const core = initIntelligenceCore({
      storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
      logger: { info: () => {}, error: () => {} },
      dataDir: dir,
    })!;
    setIntelligenceCore(core);

    try {
      // A run armed under a document this registry does not hold — the only way
      // to produce a non-complete session with no gate.
      const task = mintTaskId();
      core.emitter.emit({
        observed_at: new Date(NOW.getTime() - 4 * 3_600_000).toISOString(),
        topic: 'task.context.assembled',
        schema: 'context.assembled/1',
        entity: {},
        actor: { id: 'act_chat_assembler', kind: 'system' },
        source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
        correlation: task,
        payload: {
          task,
          procedure: {
            capability: 'cap.bulk_plugin_update',
            runbook: 'rb.bulk-plugin-update',
            hash: 'sha256:a-document-this-registry-does-not-hold',
            status: 'delivered',
          },
          retrieval: [],
        },
      });

      const registry = createSessionRegistry({ core, now: NOW, runbooks: { byCapability: () => undefined } });
      const rows = registry.sessions();
      expect(rows).toHaveLength(1);            // shape #15 — the event landed

      const [row] = rows;
      expect(row.gate).toBeUndefined();
      expect(row.status).not.toBe('complete');
      // It is 6c: the arm cannot be established. Filing this under "nothing
      // needed of you" would be the platform deciding that a run it cannot
      // place needs no one.
      expect(row.documentUnavailable).toBe(true);

      const triage = registry.triage();
      expect(triage.waiting).toHaveLength(1);
      const [situation] = triage.waiting;
      expect(situation.gate).toBeUndefined();
      // AND THE SURFACE CANNOT SEE THE DIFFERENCE. `documentUnavailable` is a
      // `SessionRow` field; the `Situation` the surface receives does not carry
      // it, so a renderer cannot tell this row from the in-flight row the rider
      // describes — which is why nothing is filtered out of the list.
      expect(Object.prototype.hasOwnProperty.call(situation, 'documentUnavailable')).toBe(false);
    } finally {
      core.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
