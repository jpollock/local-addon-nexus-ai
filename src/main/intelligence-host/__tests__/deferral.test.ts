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

    const id = recordDeferral({
      situationId,
      taskId,
      reason: 'waiting on the payment gateway vendor',
      wake: { kind: 'record', from: 'incident-closed' },
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
      wake: { kind: 'record', from: 'incident-closed' },
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
    expect(before.counts).toEqual({ needsYou: 1, deferred: 0 });

    expect(typeof recordDeferral({ situationId, taskId, reason: 'vendor is looking at it' })).toBe('string');

    const after = triage();
    // PRESENT IN WAITING. Leaving the list is a dismissal by another name.
    expect(after.waiting.map((s) => s.id)).toContain(situationId);
    expect(after.waiting).toHaveLength(before.waiting.length);
    // ABSENT FROM counts.needsYou. The badge is escalation; a badge that kept
    // counting it would mean the deferral deferred nothing.
    expect(after.counts).toEqual({ needsYou: 0, deferred: 1 });
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
    expect(view.counts).toEqual({ needsYou: 1, deferred: 2 });
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
    expect(view.counts).toEqual({ needsYou: 1, deferred: 0 });
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
    expect(triage().counts).toEqual({ needsYou: 1, deferred: 0 });
  });
});

// ===========================================================================

describe('deferral applies to the situation, never to its parts (XD-28)', () => {
  it('a record naming a PART\'s event id defers nothing — the situation goes on escalating', () => {
    const { taskId, situationId } = armWaitingRun();
    const row = waitingRow(situationId);
    // A real part of a real situation, with a real id the record could name.
    const part = row.parts[0]!;
    expect(row.parts.length).toBeGreaterThan(0);

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
        situation: part.eventId ?? `${situationId}#part0`,
        reason: 'just this one finding',
        wake: null,
      },
    });
    expect(rationaleCount()).toBe(1);

    const view = triage();
    expect(view.waiting.find((s) => s.id === situationId)!.deferral).toBeUndefined();
    expect(view.counts).toEqual({ needsYou: 1, deferred: 0 });
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
    expect(triage().counts).toEqual({ needsYou: 0, deferred: 1 });

    // After: loud again, from the SAME record — nothing was written to wake it.
    const woken = triage({ now: new Date(NOW.getTime() + 3 * 3_600_000) });
    expect(woken.counts).toEqual({ needsYou: 1, deferred: 0 });
    expect(woken.waiting.find((s) => s.id === situationId)!.deferral).toBeUndefined();
  });

  it('a time wake exactly AT the boundary has fired — the row is loud at its own moment', () => {
    const { taskId, situationId } = armWaitingRun();
    const at = hoursAhead(2);
    recordDeferral({ situationId, taskId, reason: 'monday', wake: { kind: 'time', at } });

    const atBoundary = triage({ now: new Date(Date.parse(at)) });
    expect(atBoundary.counts).toEqual({ needsYou: 1, deferred: 0 });
    const justBefore = triage({ now: new Date(Date.parse(at) - 1) });
    expect(justBefore.counts).toEqual({ needsYou: 0, deferred: 1 });
  });

  it('END 1 — a RECORD wake fires only when the port says so, and never by default', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({
      situationId,
      taskId,
      reason: 'waiting on the containment run',
      wake: { kind: 'record', from: 'containment-finished' },
    });

    // No port: it has NOT fired. Honest, not a guess in either direction.
    expect(triage().counts).toEqual({ needsYou: 0, deferred: 1 });

    // A port that says no.
    expect(triage({ wakeFired: () => false }).counts).toEqual({ needsYou: 0, deferred: 1 });

    // A port that says yes, and is asked about the right condition.
    const seen: string[] = [];
    const fired = triage({
      wakeFired: ({ wake }) => {
        seen.push(wake.from);
        return true;
      },
    });
    expect(seen).toEqual(['containment-finished']);
    expect(fired.counts).toEqual({ needsYou: 1, deferred: 0 });
  });

  it('a throwing wake port costs the wake, not the row', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'later', wake: { kind: 'record', from: 'x' } });
    const view = triage({
      wakeFired: () => {
        throw new Error('port exploded');
      },
    });
    expect(view.waiting.map((s) => s.id)).toContain(situationId);
    expect(view.counts).toEqual({ needsYou: 0, deferred: 1 });
  });

  it('an UNCONDITIONED deferral never wakes — permitted, and it is not a dismissal', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'stay quiet until I come back' });

    const farFuture = triage({ now: new Date(NOW.getTime() + 365 * 24 * 3_600_000), wakeFired: () => true });
    // Still deferred a year later, and STILL IN THE LIST at its own tier.
    expect(farFuture.counts).toEqual({ needsYou: 0, deferred: 1 });
    expect(farFuture.waiting.map((s) => s.id)).toContain(situationId);
    expect(farFuture.waiting.find((s) => s.id === situationId)!.tier).toBe(2);
  });

  it('END 2 — the user ends it early, superseding rather than mutating', () => {
    const { taskId, situationId } = armWaitingRun();
    const deferralId = recordDeferral({ situationId, taskId, reason: 'vendor' })!;
    expect(triage().counts).toEqual({ needsYou: 0, deferred: 1 });

    const endId = recordDeferralEnded({ situationId, taskId, supersedes: deferralId });
    expect(typeof endId).toBe('string');

    // BOTH events stay in the ledger. Superseding never mutating: the record of
    // the deferral having been made is not erased by its ending.
    expect(rationaleCount()).toBe(2);
    const end = core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 10 }).find((e) => e.id === endId)!;
    expect(end.causation).toBe(deferralId);
    expect(end.payload).toMatchObject({ act: 'end', situation: situationId, supersedes: deferralId });

    expect(triage().counts).toEqual({ needsYou: 1, deferred: 0 });
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
    expect(triage().counts).toEqual({ needsYou: 1, deferred: 0 });

    const second = recordDeferral({ situationId, taskId, reason: 'second, with feeling' });
    expect(typeof second).toBe('string');

    const view = triage();
    expect(view.counts).toEqual({ needsYou: 0, deferred: 1 });
    // The STANDING deferral is the latest one, not the first.
    expect(view.waiting.find((s) => s.id === situationId)!.deferral).toMatchObject({
      eventId: second,
      reason: 'second, with feeling',
    });
  });

  it('END 3 — a situation that is answered carries no deferral into the changed column', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'not yet' });
    expect(triage().counts).toEqual({ needsYou: 0, deferred: 1 });

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
 * These tests are the presentation. They pin TODAY'S behaviour so the day
 * someone builds the incident path they go red and say what has to change.
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

  it('FINDING 1 — the fold is NOT the blocker: it already attaches a deferral to an incident row', () => {
    const incidentId = emitOrphanIncident('backdoor:wp-compat', false);
    const row = triage().waiting.find((s) => s.id === incidentId);
    expect(row).toBeDefined();
    expect(row!.kind).toBe('incident');

    // No `taskId` — an orphan incident has no run to be recorded on.
    const id = recordDeferral({ situationId: incidentId, reason: 'client is rebuilding the site' });
    expect(typeof id).toBe('string');

    const after = triage();
    expect(after.waiting.find((s) => s.id === incidentId)!.deferral).toBeDefined();
    expect(after.counts).toEqual({ needsYou: 0, deferred: 1 });
  });

  it('FINDING 2 — the record carries NO correlation, so it joins to no run', () => {
    const incidentId = emitOrphanIncident('backdoor:wp-compat', false);
    const id = recordDeferral({ situationId: incidentId, reason: 'client is rebuilding' })!;

    const event = core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 10 }).find((e) => e.id === id)!;
    // THE HELD PART, stated as a fact rather than a worry: "recorded on the run"
    // is unsatisfiable here. Nothing can ask "what did the user defer during
    // this run", and no `runEvents` read will ever return it.
    expect(event.correlation).toBeUndefined();
  });

  /**
   * FINDING 3 — AND IT IS THE ONE THAT DECIDES THE SHAPE.
   *
   * An orphan incident's situation id is the INCIDENT EVENT'S OWN ID
   * (`situationOfIncident`: `id: incident.id`). But the incident producer
   * resolves an incident by writing a NEW event carrying `resolved: true`
   * (`incidentProducer.ts:39`) — superseding, never mutating — and it dedups on
   * `incidentKey(component, fact)`, which is its real identity.
   *
   * So the id a deferral would name is the id of ONE EVENT in a chain, not the
   * id of the thing. The deferral does not follow the incident across its own
   * amendment.
   *
   * **An incident-scoped deferral therefore needs a STABLE SUBJECT, and the
   * record already has one it is not using:** `incidentKey(component, fact)`,
   * the producer's own dedup key. Naming the event id is the same class of
   * error as keying a run on a turn instead of on `capability@hash`.
   */
  it('FINDING 3 — the situation id is an EVENT id, and it does not survive the incident\'s own amendment', () => {
    const openId = emitOrphanIncident('backdoor:wp-compat', false);
    recordDeferral({ situationId: openId, reason: 'client is rebuilding' });
    expect(triage().counts).toEqual({ needsYou: 0, deferred: 1 });

    // The producer's resolution: a NEW event, same component and fact.
    const resolvedId = emitOrphanIncident('backdoor:wp-compat', true);
    expect(resolvedId).not.toBe(openId);

    const after = triage();
    const openRow = [...after.waiting, ...after.changed].find((s) => s.id === openId);
    const resolvedRow = [...after.waiting, ...after.changed].find((s) => s.id === resolvedId);

    // Two situations from one incident — the open event and its amendment. That
    // is today's fold, measured, not proposed.
    expect(openRow).toBeDefined();
    expect(resolvedRow).toBeDefined();
    // The deferral stayed with the EVENT it named, and the amendment arrived
    // undeferred. A user who quieted this incident sees it back in the badge
    // under a different id the moment it is amended.
    expect(openRow!.deferral).toBeDefined();
    expect(resolvedRow!.deferral).toBeUndefined();
  });
});

// ===========================================================================

describe('non-fatal by construction', () => {
  it('an unreadable ledger costs the quieting, never the list', () => {
    const { taskId, situationId } = armWaitingRun();
    recordDeferral({ situationId, taskId, reason: 'vendor' });
    expect(triage().counts).toEqual({ needsYou: 0, deferred: 1 });

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
      expect(view.counts).toEqual({ needsYou: 1, deferred: 0 });
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
