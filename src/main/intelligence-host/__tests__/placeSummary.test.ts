/**
 * WP-52 · ITEM 4 — CARD 1'S CONTRADICTION, MEASURED FIRST AND THEN FIXED.
 *
 * The architect, reading the owner's live build: the oldest gateless run renders
 * the DERIVED fallback — guard 1 declined — yet its own meta line asserted
 * **"no targets on record"**, a KNOWN-EMPTY claim from a row the guard treated
 * as UNKNOWN. Exactly one of two things could be true, and the packet forbade
 * fixing anything before measuring which:
 *
 *   (a) `total` is `null` → the fallback meta asserts knowledge the platform
 *       lacks, and the WORDING is the defect;
 *   (b) `total` is `0` → guard 1 should have fired and did not, and the
 *       COMPOSER is the defect.
 *
 * MEASURED on the owner's real ledger, 2026-08-21, row
 * `sess_task_01M09M7ZHVS6XM58VA9G8TWPFH`:
 *
 *     SessionRow.targetSet : null      <- the ARMED set, UNKNOWN
 *     places.total         : 0         <- the OUTCOME set, empty
 *     places.summary       : "no targets on record"
 *
 * **(a).** The composer is correct — guard 1 requires `total === 0` and `null`
 * is not `0`. The defect is that `summarisePlaces` spoke about "targets on
 * record" when its subject is the set of targets with an OUTCOME. WP-48's name
 * collision in a third form: not a binding this time, a sentence.
 *
 * The fix is that an empty place set reports NO PLACE CLAUSE. This file pins
 * both that and the branches that must not move — a summary that returned `''`
 * for everything would satisfy the first assertion and destroy the field.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { manifestScopeFor, CONTEXT_ASSEMBLED_TOPIC } from '../chatAssembly';
import { ACTION_EXECUTED_TOPIC, ACTION_EXECUTED_SCHEMA, OUTCOME_RECORDED_TOPIC, OUTCOME_RECORDED_SCHEMA } from '../actionProducer';
import { createSessionRegistry, type RunbookLookup } from '../sessionRegistry';
import { metaLine } from '../../../renderer/components/return/arrivalModel';
import { taskId as mintTaskId } from '../../../intelligence';
import type { Runbook } from '../../../intelligence';
import type { ScopePlace } from '../procedureScope';

let core: IntelligenceCore;
let dir: string;

const NOW = new Date('2026-08-21T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const SITE_A = 'ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA';
const SITE_B = 'ent_env_ABTVYVS8GFP2CCAVW0XA8GK4C4';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp52-'));
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

const RB: Runbook = {
  id: 'rb.bulk-plugin-update',
  capability: 'cap.bulk_plugin_update',
  hash: 'sha256:bulk-1',
  version: '1.0.0', strictness: 'strict', path: 'runbooks/rb.bulk-plugin-update.md',
  canonicalBytes: 1024, steps: [], tools: [], toolScope: 'advisory', body: '', canonicalText: '', frontmatter: {},
  checkpoints: [
    { id: 'cp.consult-history', attest: 'manifest', evidence: { topic: CONTEXT_ASSEMBLED_TOPIC }, tools: [] },
    { id: 'cp.roll-fleet', attest: 'event', evidence: { topic: ACTION_EXECUTED_TOPIC, tool: 'bulk_plugin_update' }, tools: [{ name: 'bulk_plugin_update' }] },
  ],
} as unknown as Runbook;

const lookup: RunbookLookup = { byCapability: (c: string) => (c === RB.capability ? RB : undefined) };
const noDocument: RunbookLookup = { byCapability: () => undefined };

/** Every target is WP Engine production, so the summary has a place to name. */
const describePlace = (): ScopePlace => ({ host: 'wpe', kind: 'production' });

function emitManifest(args: { taskId: string; observedAt: string; targets?: number }): void {
  core.emitter.emit({
    observed_at: args.observedAt,
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: 'context.assembled/1',
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: args.taskId,
    payload: {
      task: args.taskId,
      procedure: { capability: RB.capability, runbook: RB.id, hash: RB.hash, status: 'delivered' },
      retrieval: [],
      ...(args.targets === undefined
        ? {}
        : {
            scope: manifestScopeFor({
              capability: RB.capability, runbookId: RB.id,
              runnable: Array.from({ length: args.targets }, (_, i) => ({ siteId: `site-${i}`, siteName: `S${i}`, place: { host: 'local' } })),
              barred: [], excluded: [], places: ['local'],
              from: { surface: 'comparator', comparatorId: 'c1', filter: 'all' },
              opensRun: args.targets > 0,
            } as never),
          }),
    },
  });
}

function emitAct(args: { taskId: string; observedAt: string; targets: string[] }): void {
  const action = core.emitter.emit({
    observed_at: args.observedAt,
    topic: ACTION_EXECUTED_TOPIC,
    schema: ACTION_EXECUTED_SCHEMA,
    entity: { environment: args.targets[0] },
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'tool:registry', trust: 'emitted' },
    correlation: args.taskId,
    payload: { tool: 'bulk_plugin_update', tier: 2, dispatch: 'registry', targets: args.targets.length, targets_resolved: args.targets.length },
  });
  for (const t of args.targets) {
    core.emitter.emit({
      observed_at: args.observedAt,
      topic: OUTCOME_RECORDED_TOPIC,
      schema: OUTCOME_RECORDED_SCHEMA,
      entity: { environment: t },
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'tool:registry', trust: 'emitted' },
      correlation: args.taskId,
      causation: action.id,
      payload: { tool: 'bulk_plugin_update', result: 'success', result_scope: 'call' },
    });
  }
}

// ---------------------------------------------------------------------------
// 1 · the measurement, re-created as a pin
// ---------------------------------------------------------------------------

describe('card 1 — the row whose meta contradicted the guard that produced it', () => {
  test('THE MEASUREMENT · targetSet is null while places.total is 0 — two different facts', () => {
    const t = mintTaskId();
    emitManifest({ taskId: t, observedAt: hoursAgo(80) }); // no scope key: an 80h-old manifest

    const registry = createSessionRegistry({ core, now: NOW, runbooks: noDocument, describePlace });
    const [row] = registry.sessions();
    expect(row).toBeDefined();                       // shape #15

    // This is the whole of the measurement, and it is why (a) and not (b):
    expect(row.targetSet).toBeNull();                // the ARMED set: UNKNOWN
    expect(row.places.total).toBe(0);                // the OUTCOME set: empty
    // …so guard 1 was RIGHT to decline. `total === 0` is false for null.
    const [situation] = registry.triage().waiting;
    expect(situation.headlineTemplate).toBeNull();
  });

  test('THE FIX · an empty place set reports NO PLACE CLAUSE, so the card asserts nothing about targets', () => {
    const t = mintTaskId();
    emitManifest({ taskId: t, observedAt: hoursAgo(80) });

    const [situation] = createSessionRegistry({ core, now: NOW, runbooks: noDocument, describePlace }).triage().waiting;
    expect(situation.places.summary).toBe('');

    // AND THE CARD IS MEASURED, not just the field: the meta line is what the
    // reader sees, and it must no longer carry the claim.
    const line = metaLine(situation, NOW);
    expect(line).not.toContain('no targets on record');
    expect(line).not.toContain('targets');
    // It still says everything it honestly can.
    expect(line).toContain('80h');
    // WP-54 · ITEM 14 — THE IDENTIFIER MOVED, AND IT MOVED BECAUSE IT WAS ON
    // THE CARD TWICE. This used to assert the runbook id on the META line; on a
    // DERIVED card the headline is `runSummary(row)`, which names the runbook
    // too, so both derived rows on the owner's real fleet printed
    // `rb.bulk-plugin-update` twice each. The card still names it exactly once —
    // which is the pin now, over the whole card rather than over one line.
    const card = `${situation.headline} ${line}`;
    expect(card.split('rb.bulk-plugin-update')).toHaveLength(2);
  });

  test('THE DOUBLE WRONG · a run with a KNOWN target set of 5 and nothing written says nothing about places either', () => {
    // The case where the old wording was wrong twice over: five targets ARE on
    // record, and the line said there were none. `places` never spoke for the
    // arming, and now it does not speak at all when it has no members.
    const t = mintTaskId();
    emitManifest({ taskId: t, observedAt: hoursAgo(6), targets: 5 });

    const registry = createSessionRegistry({ core, now: NOW, runbooks: lookup, describePlace });
    const [row] = registry.sessions();
    expect(row.targetSet).toBe(5);
    expect(row.places.total).toBe(0);
    expect(row.places.summary).toBe('');
    expect(metaLine(registry.triage().waiting[0], NOW)).not.toContain('no targets on record');
  });
});

// ---------------------------------------------------------------------------
// 2 · the branches that must NOT move
// ---------------------------------------------------------------------------

describe('the place summary still speaks when it has members — the field is not deleted', () => {
  test('a run with outcomes names the place and the count', () => {
    const t = mintTaskId();
    emitManifest({ taskId: t, observedAt: hoursAgo(5), targets: 2 });
    emitAct({ taskId: t, observedAt: hoursAgo(4), targets: [SITE_A, SITE_B] });

    const [row] = createSessionRegistry({ core, now: NOW, runbooks: lookup, describePlace }).sessions();
    expect(row.places.total).toBe(2);
    expect(row.places.summary).toBe('touches production on 2 of 2');
    expect(row.places.highest).toBe('wpe_production');
  });

  /**
   * WP-54 · ITEM 4 REVERSED THIS PIN, and the reversal is recorded rather than
   * the pin being deleted.
   *
   * It read: *a target nothing can place is UNRESOLVED, and still says so rather
   * than saying nothing* — and the sentence it asserted was "nothing on record
   * names where the target is". The architect's second finding measured that
   * sentence on the live build and it was FALSE: four incident cards carried it
   * while the duplicate inbox card six inches below each of them printed
   * `theawfulpm-test`, and the ledger's own `site.core` twin holds that name for
   * that very entity. The platform had the name and was claiming it did not.
   *
   * The clause is deleted rather than reworded. `unresolved` is still counted
   * and still on the contract — the FACT survives, and this test still asserts
   * `total` — but a row does not narrate our ignorance of where a target lives,
   * and the incident composer now resolves what the target is CALLED.
   */
  test('a target nothing can place is UNRESOLVED, and the row says nothing about it', () => {
    const t = mintTaskId();
    emitManifest({ taskId: t, observedAt: hoursAgo(5), targets: 1 });
    emitAct({ taskId: t, observedAt: hoursAgo(4), targets: [SITE_A] });

    const [row] = createSessionRegistry({ core, now: NOW, runbooks: lookup }).sessions();
    expect(row.places.total).toBe(1);
    expect(row.places.summary).toBe('');
  });
});
