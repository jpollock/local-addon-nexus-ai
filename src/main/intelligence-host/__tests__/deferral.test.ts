/**
 * WP-56 · The deferral affordance — the mechanics of the cycle-two ruling.
 *
 * Every fixture is a REAL event through the real emitter into a real ledger, and
 * every deferral is written by the REAL PRODUCER (`recordDeferral`) rather than
 * by a hand-shaped payload — `sessionRegistry.test.ts`'s opening rule, which
 * matters more here than usual: this packet's central safety argument is about
 * what the producer does and does not write into the payload, and a fixture that
 * hand-built the payload would be testing the fixture's opinion of it.
 *
 * WHAT THE RULING SAYS, and each clause has a pin below:
 *
 *  - ONLY THE USER DEFERS. An agent quieting its own gate is the self-promotion
 *    power inverted.
 *  - A REASON IS RECORDED.
 *  - THE SITUATION KEEPS ITS TIER AND ITS PLACE, and lowers escalation only:
 *    out of the badge, out of the verdict's count, STILL IN THE LIST. Both
 *    halves are pinned, because either alone is the ruling half-built —
 *    present-in-waiting without absent-from-counts is a deferral that quiets
 *    nothing, and absent-from-counts without present-in-waiting is the dismissal
 *    the ruling refused.
 *  - DEFERRAL APPLIES TO THE SITUATION, NEVER TO ITS PARTS.
 *  - A DERIVABLE WAKE CONDITION returns it to full intensity when met.
 *  - THREE RECORDED ENDS: the wake fires, the user ends it early, the situation
 *    is answered.
 *
 * SHAPE #15 DISCIPLINE: `recordDeferral` is non-fatal and returns `undefined` on
 * every refusal, so a test that asserted only "the row is not deferred" would
 * pass against a producer that emitted nothing at all, for any reason or none.
 * Every case here asserts the RECORD'S EXISTENCE (the returned event id, and a
 * ledger count) before asserting what the fold made of it — and the refusal
 * cases assert the id is `undefined` AND that the ledger did not grow, which is
 * the same discipline pointed the other way.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  DEFERRAL_PAYLOAD_SOURCE,
  DEFERRAL_SYSTEM,
  OFFERABLE_WAKE_KINDS,
  RATIONALE_RECORDED_TOPIC,
  RATIONALE_RECORDED_SCHEMA,
  recordDeferral,
  recordDeferralEnded,
} from '../actionProducer';
import { INCIDENT_TOPIC, INCIDENT_SCHEMA } from '../incidentProducer';
import { provisionalEnvironmentId } from '../provisionalEntity';
import {
  createSessionRegistry,
  foldSessionRegistry,
  listVerdict,
  runCorrelationFor,
  type RunbookLookup,
  type SessionRegistryDeps,
  type Situation,
} from '../sessionRegistry';
import type { IntelligenceHealthReport } from '../health';
import type { ScopePlace } from '../procedureScope';
import { taskId as mintTaskId } from '../../../intelligence';
import type { Runbook } from '../../../intelligence';

let core: IntelligenceCore;
let dir: string;

const NOW = new Date('2026-08-21T08:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const hoursAhead = (h: number): string => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const MANIFEST_TOPIC = 'task.context.assembled';
const MANIFEST_SCHEMA = 'context.assembled/1';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-deferral-'));
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

// ---------------------------------------------------------------------------
// A run to defer — one gated approval, nothing written. Tier 2, waiting.
// ---------------------------------------------------------------------------

/**
 * THREE DISTINCT RUNBOOKS, and the reason is the registry's own documented
 * limit rather than variety for its own sake: the run key is
 * `capability@hash`, so three manifests naming ONE capability and ONE hash fold
 * into ONE session ("two chats whose runs are BOTH IN FLIGHT at the same
 * capability and the same document hash are ONE session here"). A multi-row
 * fixture built on one runbook would silently be a one-row fixture, and every
 * count below would be measuring the wrong thing.
 */
function runbookFor(capability: string, id: string, hash: string): Runbook {
  return {
    id,
    capability,
    version: '1.0.0',
    hash,
    strictness: 'strict',
    path: `runbooks/${id}.md`,
    canonicalBytes: 1024,
    steps: [],
    tools: [],
    toolScope: 'advisory',
    body: '',
    canonicalText: '',
    frontmatter: {},
    checkpoints: [
      {
        id: 'cp.approval',
        attest: 'event',
        tools: [],
        evidence: { topic: RATIONALE_RECORDED_TOPIC, decision: 'approved' },
      },
      {
        id: 'cp.apply',
        attest: 'event',
        tools: [{ name: 'wp_plugin_update' }],
        evidence: { topic: 'task.action.executed', tool: 'wp_plugin_update' },
      },
    ],
  } as unknown as Runbook;
}

const RBS = [
  runbookFor('cap.incident_remediation', 'rb.remediate', 'h-remediate-1'),
  runbookFor('cap.bulk_plugin_update', 'rb.bulk-plugin-update', 'h-bulk-1'),
  runbookFor('cap.promote_environment', 'rb.promote', 'h-promote-1'),
];
const RB = RBS[0]!;
const HASH = RB.hash;

const lookup: RunbookLookup = { byCapability: (c) => RBS.find((r) => r.capability === c) };

const SITE = provisionalEnvironmentId('bravo');
const PLACES: Record<string, ScopePlace> = { [SITE]: { host: 'wpe', kind: 'production' } };

function healthReport(): IntelligenceHealthReport {
  return { lines: [], worst: 'OK', errors: [], at: NOW.toISOString() } as unknown as IntelligenceHealthReport;
}

function deps(overrides: SessionRegistryDeps = {}): SessionRegistryDeps {
  return {
    core,
    now: NOW,
    runbooks: lookup,
    describePlace: (id) => PLACES[id],
    health: healthReport(),
    ...overrides,
  };
}

/**
 * One waiting run at a consent gate. `which` picks the runbook, and a distinct
 * runbook is what makes it a distinct SESSION — see `RBS`.
 */
function armWaitingRun(observedAt = hoursAgo(70), which = 0): { taskId: string; situationId: string } {
  // The MANIFEST alone is the input. `foldSessionRegistry` never consults
  // `procedureCursor`'s in-memory run map — that is WP-30's acceptance
  // criterion, and arming here would quietly test a path the fold does not use.
  const rb = RBS[which]!;
  const task = mintTaskId();
  core.emitter.emit({
    observed_at: observedAt,
    topic: MANIFEST_TOPIC,
    schema: MANIFEST_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: task,
    payload: {
      task,
      procedure: { capability: rb.capability, runbook: rb.id, hash: rb.hash, status: 'delivered' },
      retrieval: [],
    },
  });
  return { taskId: task, situationId: `sess_${task}` };
}

function triage(overrides: SessionRegistryDeps = {}) {
  return createSessionRegistry(deps(overrides)).triage();
}

function waitingRow(situationId: string, overrides: SessionRegistryDeps = {}): Situation {
  const row = triage(overrides).waiting.find((s) => s.id === situationId);
  if (!row) throw new Error(`no waiting row for ${situationId}`);
  return row;
}

/** Every rationale event in the ledger — the shape-#15 existence check. */
function rationaleCount(): number {
  return core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 1000 }).length;
}

// ===========================================================================

describe('the record — what a deferral writes, and what it must never write', () => {
  it('writes one rationale event carrying the reason, the situation and the wake', () => {
    const { taskId, situationId } = armWaitingRun();
    expect(rationaleCount()).toBe(0);

    const at = hoursAhead(48);
    const id = recordDeferral({
      situationId,
      taskId,
      reason: 'waiting on the payment gateway vendor',
      // A TIME wake: the only kind offerable today, per the gate's ruling.
      wake: { kind: 'time', at },
    });

    expect(typeof id).toBe('string');
    expect(rationaleCount()).toBe(1);

    const event = core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 10 })[0]!;
    expect(event.id).toBe(id);
    expect(event.topic).toBe(RATIONALE_RECORDED_TOPIC);
    expect(event.schema).toBe(RATIONALE_RECORDED_SCHEMA);
    // Recorded ON THE RUN — cycle two's own words, and the join every other
    // run-scoped fact in this ledger uses.
    expect(event.correlation).toBe(taskId);
    expect(event.source.system).toBe(DEFERRAL_SYSTEM);
    expect(event.source.trust).toBe('elicited');
    expect(event.actor.kind).toBe('human');
    expect(event.payload).toMatchObject({
      source: DEFERRAL_PAYLOAD_SOURCE,
      act: 'defer',
      situation: situationId,
      reason: 'waiting on the payment gateway vendor',
      wake: { kind: 'time', at },
    });
  });

  /**
   * THE SAFETY PIN OF THE WHOLE PACKET, and it is an ABSENCE assertion, so it is
   * written the way an absence must be: `toStrictEqual`-grade explicitness
   * rather than a `toMatchObject` that cannot see an extra key.
   *
   * A `decision` key would put this event into `foldProcedureCursor`'s legacy
   * lane, where it would OVERWRITE a standing legacy approval for its tool — a
   * deferral silently revoking consent — or, with a checkpoint, into the bound
   * lane, where any non-wanted decision is pushed to `denied` and a denial is an
   * abort. `deferralIsNotConsent.test.ts` drives both consequences; this pins
   * the cause.
   */
  it('writes NO `decision` key and NO `checkpoint` key — a deferral is not a consent decision', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'not this week' });

    const event = core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 10 })[0]!;
    const payload = event.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['act', 'reason', 'situation', 'source', 'wake']);
    expect('decision' in payload).toBe(false);
    expect('checkpoint' in payload).toBe(false);
  });

  it('masks a credential-shaped reason rather than writing it to a never-deleted ledger', () => {
    const { taskId, situationId } = armWaitingRun();
    const id = recordDeferral({
      situationId,
      taskId,
      reason: 'blocked until they rotate sk-abc123def456ghi789jkl',
    });
    expect(typeof id).toBe('string');

    const payload = core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 10 })[0]!
      .payload as Record<string, unknown>;
    expect(String(payload.reason)).not.toContain('sk-abc123def456ghi789jkl');
    // The sentence survives; only the credential-shaped run does not.
    expect(String(payload.reason)).toContain('blocked until they rotate');
  });

  it.each([
    ['an empty reason', { reason: '' }],
    ['a whitespace-only reason', { reason: '   ' }],
    ['a time wake that is not a date', { reason: 'later', wake: { kind: 'time', at: 'soon' } }],
    ['a record wake naming nothing', { reason: 'later', wake: { kind: 'record', from: '' } }],
    ['a wake of an unknown kind', { reason: 'later', wake: { kind: 'vibes' } }],
    ['no situation', { reason: 'later', situationId: '' }],
  ])('REFUSES %s, and writes nothing at all', (_label, patch) => {
    const { taskId, situationId } = armWaitingRun();
    const before = rationaleCount();

    const id = recordDeferral({
      situationId,
      taskId,
      reason: 'a good reason',
      ...(patch as object),
    } as Parameters<typeof recordDeferral>[0]);

    // Both halves. `undefined` alone would pass against a producer that emitted
    // the event and then failed to return its id.
    expect(id).toBeUndefined();
    expect(rationaleCount()).toBe(before);
  });

  /**
   * RULED AT THE GATE: the surface does not offer a wake condition the platform
   * cannot fire. Until a producer supplies `wakeFired`, the offer is TIME or
   * UNCONDITIONED, and the producer is the fail-closed half — the promise is
   * never written rather than written and silently never kept.
   */
  it('REFUSES a `record` wake — the platform cannot fire it, so it is not offered', () => {
    const { taskId, situationId } = armWaitingRun();
    const before = rationaleCount();
    expect(
      recordDeferral({ situationId, taskId, reason: 'waiting on the vendor', wake: { kind: 'record', from: 'incident-closed' } })
    ).toBeUndefined();
    expect(rationaleCount()).toBe(before);
  });

  it('accepts the two kinds that ARE offerable — time, and unconditioned', () => {
    const a = armWaitingRun(hoursAgo(70), 0);
    const b = armWaitingRun(hoursAgo(60), 1);
    expect(
      typeof recordDeferral({ situationId: a.situationId, taskId: a.taskId, reason: 'monday', wake: { kind: 'time', at: hoursAhead(48) } })
    ).toBe('string');
    expect(
      typeof recordDeferral({ situationId: b.situationId, taskId: b.taskId, reason: 'until I come back' })
    ).toBe('string');
    expect(triage().counts).toMatchObject({ needsYou: 0, deferred: 2 });
  });

  it('the offer list is the ONE list both the guard and the picker read', () => {
    // A picker built from this constant and a guard built from this constant
    // cannot disagree. Pinned so the day `record` becomes offerable, exactly one
    // edit makes it so.
    expect([...OFFERABLE_WAKE_KINDS]).toEqual(['time']);
    expect((OFFERABLE_WAKE_KINDS as readonly string[]).includes('record')).toBe(false);
  });

  it('refuses a deferral from a non-human actor — the self-promotion power inverted', () => {
    const { taskId, situationId } = armWaitingRun();
    const before = rationaleCount();
    const original = core.identity!.actor;
    core.identity!.actor = () => ({ id: 'act_chat_agent', kind: 'agent' });
    try {
      expect(recordDeferral({ situationId, taskId, reason: 'I will get to this later' })).toBeUndefined();
      expect(rationaleCount()).toBe(before);
    } finally {
      core.identity!.actor = original;
    }
  });
});

// ===========================================================================

describe('the fold — present in waiting, absent from counts.needsYou', () => {
  it('BOTH HALVES: the deferred situation stays in the list and leaves the badge', () => {
    const { taskId, situationId } = armWaitingRun();

    const before = triage();
    expect(before.waiting.map((s) => s.id)).toContain(situationId);
    expect(before.counts).toMatchObject({ needsYou: 1, deferred: 0 });

    expect(typeof recordDeferral({ situationId, taskId, reason: 'vendor is looking at it' })).toBe('string');

    const after = triage();
    // PRESENT IN WAITING. Leaving the list is a dismissal by another name.
    expect(after.waiting.map((s) => s.id)).toContain(situationId);
    expect(after.waiting).toHaveLength(before.waiting.length);
    // ABSENT FROM counts.needsYou. The badge is escalation; a badge that kept
    // counting it would mean the deferral deferred nothing.
    expect(after.counts).toMatchObject({ needsYou: 0, deferred: 1 });
    expect(after.waiting.find((s) => s.id === situationId)!.deferral).toMatchObject({
      reason: 'vendor is looking at it',
      wake: null,
    });
  });

  it('keeps the tier, the tierReason, the place set and the rule line untouched', () => {
    const { taskId, situationId } = armWaitingRun();
    const before = waitingRow(situationId);

    recordDeferral({ situationId, taskId, reason: 'not this week', wake: { kind: 'time', at: hoursAhead(48) } });
    const after = waitingRow(situationId);

    expect(after.tier).toBe(before.tier);
    expect(after.tierReason).toBe(before.tierReason);
    expect(after.places).toEqual(before.places);
    expect(after.rule).toBe(before.rule);
    expect(after.headline).toBe(before.headline);
    expect(after.ask).toBe(before.ask);
    expect(after.headlineTemplate).toBe(before.headlineTemplate);

    // THE CHANGE CURSOR ADVANCES, AND THAT IS CORRECT RATHER THAN A LEAK. The
    // deferral is recorded ON THE RUN (`correlation: taskId`), so it is one of
    // the run's own events and `lastEventId` moves — which is exactly what a
    // consumer polling `changedSince` needs, because the row DID change. A
    // deferral invisible to the delta would leave a badge stale until the next
    // full read. `lastActivityAt` moves with it, for the same reason.
    expect(after.lastEventId > before.lastEventId).toBe(true);

    // Everything else is byte-identical: the ONLY additions are the deferral
    // itself and the two cursor fields that record it happened.
    const strip = (s: Situation) => ({ ...s, deferral: undefined, lastEventId: '' });
    expect(strip(after)).toEqual(strip(before));
  });

  it('holds the arithmetic that makes the pair auditable: needsYou + deferred === waiting.length', () => {
    const a = armWaitingRun(hoursAgo(70), 0);
    const b = armWaitingRun(hoursAgo(60), 1);
    const c = armWaitingRun(hoursAgo(50), 2);
    expect(triage().waiting).toHaveLength(3);

    recordDeferral({ situationId: a.situationId, taskId: a.taskId, reason: 'one' });
    recordDeferral({ situationId: c.situationId, taskId: c.taskId, reason: 'three' });

    const view = triage();
    expect(view.counts).toMatchObject({ needsYou: 1, deferred: 2 });
    expect(view.counts.needsYou + view.counts.deferred).toBe(view.waiting.length);
    expect(view.waiting.map((s) => s.id)).toEqual(expect.arrayContaining([a.situationId, b.situationId, c.situationId]));
  });

  it('drops the deferral from the verdict — the sentence counts the badge\'s set, not the list\'s', () => {
    const a = armWaitingRun(hoursAgo(70), 0);
    armWaitingRun(hoursAgo(60), 1);
    expect(triage().verdict).toContain('2 things need you');

    recordDeferral({ situationId: a.situationId, taskId: a.taskId, reason: 'later' });

    const view = triage();
    expect(view.verdict).toContain('1 things need you');
    expect(view.waiting).toHaveLength(2);
    expect(view.counts.needsYou).toBe(1);
    // Driven directly too, because `listVerdict` is exported and a caller could
    // reach it with a list this fold never produces.
    expect(listVerdict(view.waiting)).toBe(view.verdict);
    expect(listVerdict(view.waiting.filter((s) => s.deferral))).toBe('');
  });

  it('carries the deferral onto the snapshot and the change set, not only the triage', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'vendor' });

    const registry = createSessionRegistry(deps());
    expect(registry.snapshot().situations.find((s) => s.id === situationId)!.deferral).toBeDefined();
    expect(registry.changedSince().situations.find((s) => s.id === situationId)!.deferral).toBeDefined();
  });

  it('states the wake source honestly on the snapshot — the record arm has no producer', () => {
    expect(foldSessionRegistry(deps()).wakeSource).toContain('NOTHING SUPPLIES ONE');
  });
});

// ===========================================================================

/**
 * `runCorrelationFor` — the turn a deferral is recorded ON.
 *
 * FOUND BY THE EXHIBIT, not by review. Driving the real ledger showed the
 * deferral landing with NO `correlation`, because a surface holding a
 * `Situation` has a situation id and no turn id: `taskIds` lives on
 * `SessionRow`, which the triage view does not hand over. "Recorded on the run"
 * was unsatisfiable from the only shape the caller has.
 */
describe('recorded ON THE RUN — resolving the correlation a Situation cannot supply', () => {
  it('resolves a session situation to its NEWEST turn', () => {
    const first = mintTaskId();
    // Two turns of ONE run: same capability, same hash, so they fold together.
    for (const task of [first, mintTaskId()]) {
      core.emitter.emit({
        observed_at: hoursAgo(task === first ? 70 : 20),
        topic: MANIFEST_TOPIC,
        schema: MANIFEST_SCHEMA,
        entity: {},
        actor: { id: 'act_chat_assembler', kind: 'system' },
        source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
        correlation: task,
        payload: {
          task,
          procedure: { capability: RB.capability, runbook: RB.id, hash: HASH, status: 'delivered' },
          retrieval: [],
        },
      });
    }
    const row = createSessionRegistry(deps()).sessions()[0]!;
    expect(row.taskIds).toHaveLength(2);

    // The NEWEST, not the first. The first turn is the session's IDENTITY; the
    // deferral is a statement about the moment the user is looking at.
    expect(runCorrelationFor(row.id, deps())).toBe(row.taskIds[1]);
    expect(runCorrelationFor(row.id, deps())).not.toBe(row.taskIds[0]);
  });

  it('returns undefined for a situation that is no session — the held incident path', () => {
    armWaitingRun();
    expect(runCorrelationFor('evt_not_a_session', deps())).toBeUndefined();
  });

  it('the resolved correlation makes the record joinable back to the run', () => {
    const { situationId } = armWaitingRun();
    const taskId = runCorrelationFor(situationId, deps());
    expect(typeof taskId).toBe('string');

    const id = recordDeferral({ situationId, taskId, reason: 'vendor' })!;
    // The join the correlation buys: read the run's events, find the deferral.
    const runEventIds = core.ledger.query({ correlation: taskId!, limit: 100 }).map((e) => e.id);
    expect(runEventIds).toContain(id);
  });
});

// ===========================================================================

describe('only the user defers — the fold is the authoritative gate', () => {
  /**
   * The producer refuses a non-human actor, so this writes the event through the
   * RAW EMITTER to reach the fold's own gate — which is the one that matters. A
   * rule enforced only at the write is a rule that holds until someone writes
   * past it, and this test IS someone writing past it.
   */
  it('ignores a correctly-shaped deferral record whose actor is an agent', () => {
    const { taskId, situationId } = armWaitingRun();
    const id = core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'intent', system: DEFERRAL_SYSTEM, trust: 'elicited' },
      correlation: taskId,
      payload: {
        source: DEFERRAL_PAYLOAD_SOURCE,
        act: 'defer',
        situation: situationId,
        reason: 'I am busy with something else',
        wake: null,
      },
    }).id;

    // The event EXISTS — shape #15. The fold declining it is the assertion.
    expect(rationaleCount()).toBe(1);
    expect(core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 10 })[0]!.id).toBe(id);

    const view = triage();
    expect(view.waiting.find((s) => s.id === situationId)!.deferral).toBeUndefined();
    expect(view.counts).toMatchObject({ needsYou: 1, deferred: 0 });
  });

  /**
   * WP-46's SERIES-GUARD RULE, and the battery found it: the fold's own
   * `if (!record.reason) continue` sits BEHIND a producer that already refuses
   * an empty reason, so no test written through `recordDeferral` can ever reach
   * it — the mutation survived while every screen behaved correctly. The pin
   * has to drive the inner guard directly, across the input domain the current
   * caller cannot supply.
   */
  it('ignores a reasonless deferral even when one reaches the ledger — a dismissal by another name', () => {
    const { taskId, situationId } = armWaitingRun();
    core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_local_operator', kind: 'human' },
      source: { class: 'intent', system: DEFERRAL_SYSTEM, trust: 'elicited' },
      correlation: taskId,
      payload: { source: DEFERRAL_PAYLOAD_SOURCE, act: 'defer', situation: situationId, reason: '', wake: null },
    });
    expect(rationaleCount()).toBe(1); // the subject exists

    const view = triage();
    expect(view.waiting.find((s) => s.id === situationId)!.deferral).toBeUndefined();
    expect(view.counts).toMatchObject({ needsYou: 1, deferred: 0 });
  });

  it('ignores a reasonless deferral that would otherwise SUPERSEDE a good one', () => {
    const { taskId, situationId } = armWaitingRun();
    const good = recordDeferral({ situationId, taskId, reason: 'a real reason' })!;
    expect(triage().counts).toMatchObject({ needsYou: 0, deferred: 1 });

    // A later reasonless record must neither quiet nor UNQUIET: it is not a
    // deferral, so it cannot overwrite the standing one either.
    core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_local_operator', kind: 'human' },
      source: { class: 'intent', system: DEFERRAL_SYSTEM, trust: 'elicited' },
      correlation: taskId,
      payload: { source: DEFERRAL_PAYLOAD_SOURCE, act: 'defer', situation: situationId, reason: '   ', wake: null },
    });
    expect(rationaleCount()).toBe(2);

    const view = triage();
    expect(view.counts).toMatchObject({ needsYou: 0, deferred: 1 });
    expect(view.waiting.find((s) => s.id === situationId)!.deferral).toMatchObject({
      eventId: good,
      reason: 'a real reason',
    });
  });

  it('ignores a system actor too — the gate is `human`, not `not-agent`', () => {
    const { taskId, situationId } = armWaitingRun();
    core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_scheduler', kind: 'system' },
      source: { class: 'intent', system: DEFERRAL_SYSTEM, trust: 'elicited' },
      correlation: taskId,
      payload: { source: DEFERRAL_PAYLOAD_SOURCE, act: 'defer', situation: situationId, reason: 'quiet', wake: null },
    });
    expect(rationaleCount()).toBe(1);
    expect(triage().counts).toMatchObject({ needsYou: 1, deferred: 0 });
  });
});

// ===========================================================================

describe('deferral applies to the situation, never to its parts (XD-28)', () => {
  /**
   * THE FIRST VERSION OF THIS TEST WAS VACUOUS, AND THE BATTERY CAUGHT IT.
   *
   * It read `row.parts[0]`, which for a session situation is the synthetic
   * `kind: 'run'` part — and that part HAS NO `eventId`. So the record named
   * the fallback string `sess_…#part0`, which is not a part id either, and the
   * mutation that widens the lookup to part ids SURVIVED: the test was
   * asserting that an id belonging to nothing defers nothing, which is true
   * against the bug as well as against the fix.
   *
   * The honest witness needs a part carrying a REAL event id that is NOT the
   * situation's own, so a failed outcome is emitted first to produce one.
   * `feedback_vacuous_guard_shapes`, met in the wild: the assertion ran, the
   * subject was absent.
   */
  it('a record naming a PART\'s event id defers nothing — the situation goes on escalating', () => {
    const { taskId, situationId } = armWaitingRun();

    // A failed act, so the situation has an OUTCOME part with its own event id.
    const action = core.emitter.emit({
      observed_at: hoursAgo(2),
      topic: 'task.action.executed',
      schema: 'action.executed/1',
      entity: { environment: SITE },
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
      correlation: taskId,
      payload: { tool: 'wp_plugin_update', tier: 2, dispatch: 'registry', access_method: 'mcp', targets: 1, targets_resolved: 1, args: {} },
    });
    core.emitter.emit({
      observed_at: hoursAgo(2),
      topic: 'task.outcome.recorded',
      schema: 'outcome.recorded/1',
      entity: { environment: SITE },
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
      correlation: taskId,
      causation: action.id,
      payload: { tool: 'wp_plugin_update', result: 'failure', result_scope: 'call', error: 'boom' },
    });

    const row = waitingRow(situationId);
    const part = row.parts.find((p) => p.kind === 'outcome' && p.eventId);
    // THE SUBJECT EXISTS. Without this the test is the vacuous one again.
    expect(part).toBeDefined();
    expect(part!.eventId).toBeTruthy();
    expect(part!.eventId).not.toBe(situationId);

    // Written through the raw emitter: the producer takes whatever id it is
    // given, so the refusal has to be the FOLD's, and the fold's refusal is that
    // it looks up situation ids and a part is not one.
    core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_local_operator', kind: 'human' },
      source: { class: 'intent', system: DEFERRAL_SYSTEM, trust: 'elicited' },
      correlation: taskId,
      payload: {
        source: DEFERRAL_PAYLOAD_SOURCE,
        act: 'defer',
        situation: part!.eventId,
        reason: 'just this one finding',
        wake: null,
      },
    });
    expect(rationaleCount()).toBe(1);

    const view = triage();
    expect(view.waiting.find((s) => s.id === situationId)!.deferral).toBeUndefined();
    expect(view.counts).toMatchObject({ needsYou: 1, deferred: 0 });
  });

  it('deferring the situation leaves every part exactly as it was — no part carries a deferral', () => {
    const { taskId, situationId } = armWaitingRun();
    const before = waitingRow(situationId).parts;

    recordDeferral({ situationId, taskId, reason: 'all of it, not some of it' });

    const after = waitingRow(situationId).parts;
    expect(after).toEqual(before);
    // There is nowhere on a part to put one, which is how the rule is enforced
    // rather than remembered. If this ever fails, a field was added.
    for (const part of after) expect(Object.keys(part)).not.toContain('deferral');
  });
});

// ===========================================================================

describe('three recorded ends, and each returns full escalation', () => {
  it('END 1 — a TIME wake that has fired returns the row to the badge', () => {
    const { taskId, situationId } = armWaitingRun();
    // Recorded with a wake two hours out, then read from a clock past it.
    expect(
      typeof recordDeferral({ situationId, taskId, reason: 'not before Monday', wake: { kind: 'time', at: hoursAhead(2) } })
    ).toBe('string');

    // Before the condition fires: quiet.
    expect(triage().counts).toMatchObject({ needsYou: 0, deferred: 1 });

    // After: loud again, from the SAME record — nothing was written to wake it.
    const woken = triage({ now: new Date(NOW.getTime() + 3 * 3_600_000) });
    expect(woken.counts).toMatchObject({ needsYou: 1, deferred: 0 });
    expect(woken.waiting.find((s) => s.id === situationId)!.deferral).toBeUndefined();
  });

  it('a time wake exactly AT the boundary has fired — the row is loud at its own moment', () => {
    const { taskId, situationId } = armWaitingRun();
    const at = hoursAhead(2);
    recordDeferral({ situationId, taskId, reason: 'monday', wake: { kind: 'time', at } });

    const atBoundary = triage({ now: new Date(Date.parse(at)) });
    expect(atBoundary.counts).toMatchObject({ needsYou: 1, deferred: 0 });
    const justBefore = triage({ now: new Date(Date.parse(at) - 1) });
    expect(justBefore.counts).toMatchObject({ needsYou: 0, deferred: 1 });
  });

  /**
   * RAW-EMITTED, and the reason is the gate's own ruling.
   *
   * `recordDeferral` now REFUSES a `record` wake — the surface does not offer a
   * wake condition the platform cannot fire — so the producer can no longer
   * write one. The FOLD still implements it in full, because the rule is ruled
   * and dropping the mechanism would be silently not implementing it. Driving
   * the fold therefore means writing the record directly, which is WP-46's rule
   * again: pin the guarded builder across the domain its current callers cannot
   * supply.
   */
  function emitRecordWakeDeferral(taskId: string, situationId: string, from: string): void {
    core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_local_operator', kind: 'human' },
      source: { class: 'intent', system: DEFERRAL_SYSTEM, trust: 'elicited' },
      correlation: taskId,
      payload: {
        source: DEFERRAL_PAYLOAD_SOURCE,
        act: 'defer',
        situation: situationId,
        reason: 'waiting on the containment run',
        wake: { kind: 'record', from },
      },
    });
  }

  it('END 1 — a RECORD wake fires only when the port says so, and never by default', () => {
    const { taskId, situationId } = armWaitingRun();
    emitRecordWakeDeferral(taskId, situationId, 'containment-finished');
    expect(rationaleCount()).toBe(1); // the subject exists

    // No port: it has NOT fired. Honest, not a guess in either direction.
    expect(triage().counts).toMatchObject({ needsYou: 0, deferred: 1 });

    // A port that says no.
    expect(triage({ wakeFired: () => false }).counts).toMatchObject({ needsYou: 0, deferred: 1 });

    // A port that says yes, and is asked about the right condition.
    const seen: string[] = [];
    const fired = triage({
      wakeFired: ({ wake }) => {
        seen.push(wake.from);
        return true;
      },
    });
    expect(seen).toEqual(['containment-finished']);
    expect(fired.counts).toMatchObject({ needsYou: 1, deferred: 0 });
  });

  it('a throwing wake port costs the wake, not the row', () => {
    const { taskId, situationId } = armWaitingRun();
    emitRecordWakeDeferral(taskId, situationId, 'x');
    expect(rationaleCount()).toBe(1);
    const view = triage({
      wakeFired: () => {
        throw new Error('port exploded');
      },
    });
    expect(view.waiting.map((s) => s.id)).toContain(situationId);
    expect(view.counts).toMatchObject({ needsYou: 0, deferred: 1 });
  });

  it('an UNCONDITIONED deferral never wakes — permitted, and it is not a dismissal', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'stay quiet until I come back' });

    const farFuture = triage({ now: new Date(NOW.getTime() + 365 * 24 * 3_600_000), wakeFired: () => true });
    // Still deferred a year later, and STILL IN THE LIST at its own tier.
    expect(farFuture.counts).toMatchObject({ needsYou: 0, deferred: 1 });
    expect(farFuture.waiting.map((s) => s.id)).toContain(situationId);
    expect(farFuture.waiting.find((s) => s.id === situationId)!.tier).toBe(2);
  });

  it('END 2 — the user ends it early, superseding rather than mutating', () => {
    const { taskId, situationId } = armWaitingRun();
    const deferralId = recordDeferral({ situationId, taskId, reason: 'vendor' })!;
    expect(triage().counts).toMatchObject({ needsYou: 0, deferred: 1 });

    const endId = recordDeferralEnded({ situationId, taskId, supersedes: deferralId });
    expect(typeof endId).toBe('string');

    // BOTH events stay in the ledger. Superseding never mutating: the record of
    // the deferral having been made is not erased by its ending.
    expect(rationaleCount()).toBe(2);
    const end = core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 10 }).find((e) => e.id === endId)!;
    expect(end.causation).toBe(deferralId);
    expect(end.payload).toMatchObject({ act: 'end', situation: situationId, supersedes: deferralId });

    expect(triage().counts).toMatchObject({ needsYou: 1, deferred: 0 });
  });

  it('refuses an end that supersedes nothing, and writes nothing', () => {
    const { taskId, situationId } = armWaitingRun();
    const before = rationaleCount();
    expect(recordDeferralEnded({ situationId, taskId, supersedes: '' })).toBeUndefined();
    expect(rationaleCount()).toBe(before);
  });

  it('a LATER deferral re-defers after an early end — the sheet\'s "Defer again"', () => {
    const { taskId, situationId } = armWaitingRun();
    const first = recordDeferral({ situationId, taskId, reason: 'first' })!;
    recordDeferralEnded({ situationId, taskId, supersedes: first });
    expect(triage().counts).toMatchObject({ needsYou: 1, deferred: 0 });

    const second = recordDeferral({ situationId, taskId, reason: 'second, with feeling' });
    expect(typeof second).toBe('string');

    const view = triage();
    expect(view.counts).toMatchObject({ needsYou: 0, deferred: 1 });
    // The STANDING deferral is the latest one, not the first.
    expect(view.waiting.find((s) => s.id === situationId)!.deferral).toMatchObject({
      eventId: second,
      reason: 'second, with feeling',
    });
  });

  it('END 3 — a situation that is answered carries no deferral into the changed column', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'not yet' });
    expect(triage().counts).toMatchObject({ needsYou: 0, deferred: 1 });

    // Answer it: attest both checkpoints, which moves the row to `changed`.
    core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_local_operator', kind: 'human' },
      source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
      correlation: taskId,
      payload: { tool: 'wp_plugin_update', decision: 'approved', prompt: 'card', source: 'approval-card', checkpoint: 'cp.approval' },
    });
    const action = core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: 'task.action.executed',
      schema: 'action.executed/1',
      entity: { environment: SITE },
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
      correlation: taskId,
      payload: { tool: 'wp_plugin_update', tier: 2, dispatch: 'registry', access_method: 'mcp', targets: 1, targets_resolved: 1, args: {} },
    });
    core.emitter.emit({
      observed_at: hoursAgo(1),
      topic: 'task.outcome.recorded',
      schema: 'outcome.recorded/1',
      entity: { environment: SITE },
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
      correlation: taskId,
      causation: action.id,
      payload: { tool: 'wp_plugin_update', result: 'success', result_scope: 'call' },
    });

    const view = triage();
    const row = view.changed.find((s) => s.id === situationId);
    expect(row).toBeDefined();
    expect(row!.deferral).toBeUndefined();
    expect(view.waiting.find((s) => s.id === situationId)).toBeUndefined();
    // The deferral record is still in the ledger — the row left by being
    // answered, which is the only exit the ruling permits.
    expect(rationaleCount()).toBe(2);
  });
});

// ===========================================================================

// ===========================================================================

/**
 * THE INCIDENT PATH IS HELD, AND THIS IS THE MEASUREMENT RATHER THAN A GUESS.
 *
 * Cycle two records a deferral ON THE RUN. An orphan incident has no run — and
 * the designer's coalesced sheet draws Defer on an incident row. The gap was
 * ruled to WP-56's gate: build the run path, hold the incident path, present
 * what record shape an incident-scoped deferral would need.
 *
 * These tests were the presentation. They pinned TODAY'S behaviour so the day
 * someone built the incident path they would go red and say what had to change.
 *
 * **WP-55 IS THAT DAY, AND THEY WENT RED EXACTLY AS DESIGNED.** WP-56a was
 * approved at WP-56's gate on the strength of FINDING 3 below; the fold now
 * names an incident situation for its SUBJECT — `(entity, component, fact)`,
 * the producer's own dedup key — so the two findings that measured the defect
 * are rewritten here to measure the fix. FINDING 2 is unchanged and still
 * holds: a deferral on an orphan incident still joins to no run, because the
 * incident still has none.
 */
describe('MEASURED AND HELD — what an incident-scoped deferral would need', () => {
  function emitOrphanIncident(fact: string, resolved: boolean): string {
    return core.emitter.emit({
      observed_at: hoursAgo(resolved ? 1 : 6),
      topic: INCIDENT_TOPIC,
      schema: INCIDENT_SCHEMA,
      entity: { environment: SITE },
      actor: { id: 'act_security_sentinel', kind: 'agent' },
      source: { class: 'work', system: 'agent:security-sentinel', trust: 'emitted' },
      payload: {
        component: 'site',
        fact,
        symptom: 'Known backdoor plugin detected: wp-compat',
        severity: 'critical',
        resolved,
        ...(resolved ? { resolved_at: hoursAgo(1) } : {}),
      },
    }).id;
  }

  /**
   * The subject, in the producer's own key, scoped by the anchor its history map
   * is keyed on. Written out here rather than read back off the row, so the test
   * asserts the identity instead of agreeing with whatever the fold produced.
   */
  const subjectId = (fact: string) => `${SITE}|site|${fact}`;

  it('FINDING 1 — the fold is NOT the blocker: it already attaches a deferral to an incident row', () => {
    // WP-56a: the row is found by its SUBJECT, not by the event that reported
    // it. The event id is deliberately not used here any more.
    emitOrphanIncident('backdoor:wp-compat', false);
    const row = triage().waiting.find((s) => s.id === subjectId('backdoor:wp-compat'));
    expect(row).toBeDefined();
    expect(row!.kind).toBe('incident');

    // No `taskId` — an orphan incident has no run to be recorded on.
    const id = recordDeferral({ situationId: subjectId('backdoor:wp-compat'), reason: 'client is rebuilding the site' });
    expect(typeof id).toBe('string');

    const after = triage();
    expect(after.waiting.find((s) => s.id === subjectId('backdoor:wp-compat'))!.deferral).toBeDefined();
    expect(after.counts).toMatchObject({ needsYou: 0, deferred: 1 });
  });

  it('FINDING 2 — the record carries NO correlation, so it joins to no run', () => {
    emitOrphanIncident('backdoor:wp-compat', false);
    const id = recordDeferral({ situationId: subjectId('backdoor:wp-compat'), reason: 'client is rebuilding' })!;

    const event = core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 10 }).find((e) => e.id === id)!;
    // THE HELD PART, stated as a fact rather than a worry: "recorded on the run"
    // is unsatisfiable here. Nothing can ask "what did the user defer during
    // this run", and no `runEvents` read will ever return it.
    expect(event.correlation).toBeUndefined();
  });

  /**
   * FINDING 3 — THE ONE THAT DECIDED THE SHAPE, NOW MEASURING ITS FIX (WP-56a).
   *
   * WHAT THIS TEST USED TO PIN, kept because the finding is the reason the fix
   * exists: an orphan incident's situation id was the INCIDENT EVENT'S OWN ID
   * (`situationOfIncident`: `id: incident.id`). The producer resolves an
   * incident by writing a NEW event carrying `resolved: true` — superseding,
   * never mutating — and dedups on `incidentKey(component, fact)`, which is its
   * real identity. So the id a deferral named was the id of ONE EVENT in a
   * chain, not the id of the thing, and **the deferral did not follow the
   * incident across its own amendment**: a user who quieted a finding got it
   * back in the badge, under a different id, the moment the record changed.
   *
   * WP-56a took the producer's key. Two consequences, both driven below, and
   * the second is not optional: the id survives the amendment, AND the two
   * events fold onto ONE row — because taking the key without the supersession
   * rule that rides with it would have given two rows one id, which is worse
   * than the event id it replaced.
   */
  it('FINDING 3, FIXED — the deferral survives the incident\'s own amendment', () => {
    const openId = emitOrphanIncident('backdoor:wp-compat', false);
    const subject = subjectId('backdoor:wp-compat');
    expect(subject).not.toBe(openId);

    recordDeferral({ situationId: subject, reason: 'client is rebuilding' });
    expect(triage().counts).toMatchObject({ needsYou: 0, deferred: 1 });

    // The producer's resolution: a NEW event, same component and fact.
    const resolvedId = emitOrphanIncident('backdoor:wp-compat', true);
    expect(resolvedId).not.toBe(openId);

    const after = triage();
    const rows = [...after.waiting, ...after.changed].filter((s) => s.kind === 'incident');

    // ONE row, not two. The amendment superseded the opening rather than
    // standing beside it forever — WP-51's F3, closed by this identity.
    expect(rows.map((s) => s.id)).toEqual([subject]);
    // It is the AMENDED state that is rendered, and it is ANSWERED — which is
    // end 3 of the three ratified ways a deferral ends, so the row correctly
    // carries none. Under the old id this was two rows: a deferred open one
    // that never went away, and a closed one beside it.
    expect(after.waiting.filter((s) => s.kind === 'incident')).toHaveLength(0);
    expect(rows[0].column).toBe('changed');
    expect(rows[0].deferral).toBeUndefined();

    // AND THE SHARP HALF — the recurrence. The producer reopens a finding by
    // writing another unresolved event, and THIS is the case the ruling
    // described: under the event id it came back with a NEW id the deferral did
    // not name, so a user who quieted it found it in the badge again. Under the
    // subject it comes back as itself, and the standing deferral still covers it.
    emitOrphanIncident('backdoor:wp-compat', false);
    const reopened = triage();
    expect(reopened.waiting.filter((s) => s.kind === 'incident').map((s) => s.id)).toEqual([subject]);
    expect(reopened.waiting.find((s) => s.id === subject)!.deferral).toBeDefined();
    expect(reopened.counts).toMatchObject({ needsYou: 0, deferred: 1 });
  });
});

// ===========================================================================

describe('non-fatal by construction', () => {
  it('an unreadable ledger costs the quieting, never the list', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'vendor' });
    expect(triage().counts).toMatchObject({ needsYou: 0, deferred: 1 });

    const realQuery = core.ledger.query.bind(core.ledger);
    (core.ledger as { query: unknown }).query = (opts: { topicPrefix?: string }) => {
      if (opts.topicPrefix === RATIONALE_RECORDED_TOPIC) throw new Error('ledger fault');
      return realQuery(opts as never);
    };
    try {
      const view = triage();
      // The row survives, loud. Degrading toward "escalating" is the safe
      // direction: a fault must never silently quiet something.
      expect(view.waiting.map((s) => s.id)).toContain(situationId);
      expect(view.counts).toMatchObject({ needsYou: 1, deferred: 0 });
    } finally {
      (core.ledger as { query: unknown }).query = realQuery;
    }
  });

  it('records nothing and throws nothing when there is no core', () => {
    setIntelligenceCore(null as never);
    try {
      expect(recordDeferral({ situationId: 's', reason: 'r' })).toBeUndefined();
      expect(recordDeferralEnded({ situationId: 's', supersedes: 'e' })).toBeUndefined();
    } finally {
      setIntelligenceCore(core);
    }
  });
});
