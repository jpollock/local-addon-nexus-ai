/**
 * WP-51 item 3 · THE ARMING RECORDS ITS CAUSE — and the fold reads it back.
 *
 * The designer's Q1, ratified whole: *"The containment run folds IF AND ONLY IF
 * its arming names the incidents it answers"*, with their own sentence as the
 * doctrine — *"I'd rather have four honest rows than three where one join was
 * inferred from a timestamp."*
 *
 * Read the "only if" as the load-bearing half. A containment run and four
 * incidents about the same site, within minutes of each other, are ALREADY
 * joinable by anyone willing to infer — and inferring is precisely what this
 * layer refuses. So the join exists only where the ARMER wrote down what it was
 * answering, which is a fact it has and does not record. Third producer paying
 * the same debt: the sentinel's link, the arming's scope, and now the arming's
 * cause.
 *
 * THE SHAPE IS WP-25's. That producer records `source: abort:<task>/<abort>` —
 * a payload field naming the record an incident came out of. This is the same
 * move one field over: `cause.answers`, ids in full, on the manifest the fold
 * already reads.
 *
 * FOUR RULES THE CASES BELOW HOLD:
 *
 *  1. **An id that is not an event id is never written.** A `cause` naming
 *     something that cannot be an incident is a fabricated join wearing a real
 *     field's name, and the format gate is the only thing standing between the
 *     record and a caller's typo.
 *  2. **Absent means absent.** A turn that answers nothing carries NO `cause`
 *     key — not an empty array, which reads as "it answered, and the answer was
 *     nothing". The parity floor `ManifestScope` holds to, held to again.
 *  3. **Only a DELIVERED procedure records one.** A refused turn is not a turn
 *     of the run (`sessionRegistry`'s own rule), so it records no cause, exactly
 *     as it records no scope.
 *  4. **An id naming no incident joins nothing.** The fold attaches what it
 *     finds; it never manufactures a part for an id the ledger does not hold.
 *
 * SHAPE #15 (PARALLEL_PROTOCOL): every fold case reads its events back out of
 * the ledger and asserts they exist before asserting anything about the rows.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { CONTEXT_ASSEMBLED_TOPIC, manifestCauseFor } from '../chatAssembly';
import { INCIDENT_SCHEMA, INCIDENT_TOPIC } from '../incidentProducer';
import {
  clearArmingRequests,
  peekArmingRequests,
  procedureRequestForTurn,
  recordArmingRequest,
} from '../procedureArming';
import { createSessionRegistry, type RunbookLookup } from '../sessionRegistry';
import { taskId as mintTaskId } from '../../../intelligence';
import type { Runbook } from '../../../intelligence';
import type { ResolvedGrant } from '../capabilityGrants';

let core: IntelligenceCore;
let dir: string;

const NOW = new Date('2026-08-20T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const SITE = 'ent_site_Y64Y113T3AQXYGGSAPXMQKMQHA';

const RB: Runbook = {
  id: 'rb.incident-remediation',
  capability: 'cap.incident_remediation',
  hash: 'sha256:remediate-1',
  version: '1.0.0',
  strictness: 'strict',
  path: 'runbooks/rb.incident-remediation.md',
  canonicalBytes: 1024,
  steps: [],
  tools: [],
  toolScope: 'advisory',
  body: '',
  canonicalText: '',
  frontmatter: {},
  checkpoints: [],
} as unknown as Runbook;

const noDocument: RunbookLookup = { byCapability: () => undefined };

beforeEach(() => {
  clearArmingRequests();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp51-cause-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
});

afterEach(() => {
  clearArmingRequests();
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** One sentinel-shaped incident, standing alone on the record. */
function emitIncident(symptom: string, at = hoursAgo(9)): string {
  return core.emitter.emit({
    observed_at: at,
    topic: INCIDENT_TOPIC,
    schema: INCIDENT_SCHEMA,
    entity: { site: SITE },
    actor: { id: 'act_security_sentinel', kind: 'agent' },
    source: { class: 'work', system: 'sentinel:scan', trust: 'emitted' },
    payload: { fact: symptom, symptom, resolved: false, severity: 'critical' },
  }).id;
}

/**
 * One manifest, emitted the way `chatAssembly.emitManifest` emits it — including
 * the conditional spread, which is what the absent-key cases drive.
 */
function emitManifest(args: {
  taskId: string;
  observedAt: string;
  status?: 'delivered' | 'refused';
  cause?: ReturnType<typeof manifestCauseFor>;
  /**
   * The run key is `capability@hash`, so a second run needs a second hash —
   * without one, two manifests are two TURNS OF ONE RUN and a case about two
   * runs disagreeing proves nothing. A battery survivor is how this was found:
   * the precedence mutation could not be killed because both sides of the
   * disagreement were the same session.
   */
  hash?: string;
}): string {
  return core.emitter.emit({
    observed_at: args.observedAt,
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: 'context.assembled/1',
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: args.taskId,
    payload: {
      task: args.taskId,
      procedure: {
        capability: RB.capability,
        runbook: RB.id,
        hash: args.hash ?? RB.hash,
        status: args.status ?? 'delivered',
      },
      retrieval: [],
      ...(args.cause ? { cause: args.cause } : {}),
    },
  }).id;
}

const grant = (): ResolvedGrant[] => [
  {
    capability: RB.capability,
    runbookId: RB.id,
    runbookHash: RB.hash,
    strictness: 'strict',
    scope: { environments: ['local'] },
    source: 'shipped',
  } as never,
];

// ---------------------------------------------------------------------------
// 1 · the carrier — what the arming keeps, and what it refuses to keep
// ---------------------------------------------------------------------------

describe('the arming queue carries the incidents an arming answers', () => {
  test('the ids ride on the request, in the order they were given', () => {
    const a = 'evt_01M0BFNDD6XS21X8HTEMGY4NQV';
    const b = 'evt_01M0BFNDD6XS21X8HTEMGY4NQW';
    recordArmingRequest(RB.capability, new Date(), undefined, [a, b]);
    const [request] = peekArmingRequests();
    expect(request).toBeDefined();
    expect(request.answers).toEqual([a, b]);
  });

  test('a request that answers nothing carries NO `answers` key', () => {
    // Parity: everything predating this packet must be byte-identical, and a
    // present-`undefined` is not byte-identical to a missing key.
    recordArmingRequest(RB.capability);
    const [request] = peekArmingRequests();
    expect(request).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(request, 'answers')).toBe(false);
  });

  test('AN ID THAT IS NOT AN EVENT ID IS DROPPED — a join is never written for a value that cannot be one', () => {
    recordArmingRequest(RB.capability, new Date(), undefined, [
      'evt_01M0BFNDD6XS21X8HTEMGY4NQV',
      'r_msz8afwx00',                 // a RUN id — WP-48a's own finding, one field over
      'task_01M0BFNDD6XS21X8HTEMGY4NQV', // a TaskId is not an incident
      'ent_site_Y64Y113T3AQXYGGSAPXMQKMQHA',
      '',
      'evt_not-a-ulid',
    ]);
    const [request] = peekArmingRequests();
    expect(request.answers).toEqual(['evt_01M0BFNDD6XS21X8HTEMGY4NQV']);
  });

  test('an arming whose ids are ALL unusable carries no key at all, rather than an empty answer', () => {
    recordArmingRequest(RB.capability, new Date(), undefined, ['r_msz8afwx00', 'nonsense']);
    const [request] = peekArmingRequests();
    expect(Object.prototype.hasOwnProperty.call(request, 'answers')).toBe(false);
  });

  test('the same incident named twice is one answer', () => {
    const a = 'evt_01M0BFNDD6XS21X8HTEMGY4NQV';
    recordArmingRequest(RB.capability, new Date(), undefined, [a, a]);
    expect(peekArmingRequests()[0].answers).toEqual([a]);
  });
});

// ---------------------------------------------------------------------------
// 2 · the turn — the cause rides out on the arming that carried it
// ---------------------------------------------------------------------------

describe('the honoured arming, and only it, hands its cause to the turn', () => {
  const runbooks = {
    byCapability: (c: string) => (c === RB.capability ? RB : undefined),
    runbooks: () => [RB],
  } as never;

  test('a model-requested arming carries the incidents it answers into the turn', () => {
    const a = 'evt_01M0BFNDD6XS21X8HTEMGY4NQV';
    recordArmingRequest(RB.capability, new Date(), undefined, [a]);
    const turn = procedureRequestForTurn({ runbooks, userMessage: 'contain it', grants: grant() });
    expect(turn?.request.armed?.armedBy).toBe('model-request');
    expect(turn?.answers).toEqual([a]);
  });

  test('an arming that answered nothing hands the turn no key', () => {
    recordArmingRequest(RB.capability);
    const turn = procedureRequestForTurn({ runbooks, userMessage: 'x', grants: grant() });
    expect(turn?.request.armed?.armedBy).toBe('model-request');
    expect(Object.prototype.hasOwnProperty.call(turn!, 'answers')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3 · the derivation
// ---------------------------------------------------------------------------

describe('manifestCauseFor — one derivation', () => {
  test('ids become the cause', () => {
    expect(manifestCauseFor(['evt_01M0BFNDD6XS21X8HTEMGY4NQV'])).toEqual({
      answers: ['evt_01M0BFNDD6XS21X8HTEMGY4NQV'],
    });
  });

  test('nothing answered is UNDEFINED, not an empty cause', () => {
    // The opposite reading from `manifestScopeFor`, and deliberately so: an
    // arming that selected nothing KNOWS its target set is empty, which is a
    // fact. An arming that answers nothing is not answering — there is no
    // empty-set fact to record, and `cause: { answers: [] }` would assert a
    // containment run that answers nothing in particular.
    expect(manifestCauseFor(undefined)).toBeUndefined();
    expect(manifestCauseFor([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4 · the fold — the join the record now supports
// ---------------------------------------------------------------------------

describe('the fold joins a run to the incidents its arming named', () => {
  test('FOUR INCIDENTS AND THE RUN ANSWERING THEM ARE ONE ROW — not four rows and a run', () => {
    const incidents = [
      emitIncident('Known backdoor plugin detected: wp-compat'),
      emitIncident('PHP file(s) in mu-plugins/: index.php'),
      emitIncident('File manager plugin(s) active: fileorganizer'),
      emitIncident('Low-entropy plugin name(s): noted, index'),
    ];
    const task = mintTaskId();
    const manifestId = emitManifest({
      taskId: task,
      observedAt: hoursAgo(8),
      cause: manifestCauseFor(incidents),
    });

    // shape #15 — the events exist, and the manifest really carries the ids.
    expect(core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 20 })).toHaveLength(4);
    const manifest = core.ledger.get(manifestId);
    expect(manifest).toBeDefined();
    expect((manifest!.payload as { cause?: { answers: string[] } }).cause?.answers).toEqual(incidents);

    const triage = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    expect(triage.waiting).toHaveLength(1);
    const [situation] = triage.waiting;
    expect(situation.kind).toBe('session');
    // The run, and the four incidents it answers, as its parts.
    const parts = situation.parts.filter((p) => p.kind === 'incident');
    expect(parts.map((p) => p.eventId).sort()).toEqual([...incidents].sort());
  });

  test('WITHOUT the cause the same events are FIVE rows — so the join is the record, not the timestamps', () => {
    // The other half of the measurement, and the designer's sentence made
    // executable: same site, same minutes, same everything except the one fact
    // the armer wrote down.
    for (const symptom of ['a', 'b', 'c', 'd']) emitIncident(symptom);
    emitManifest({ taskId: mintTaskId(), observedAt: hoursAgo(8) });

    const triage = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    expect(triage.waiting).toHaveLength(5);
    expect(triage.waiting.filter((s) => s.kind === 'incident')).toHaveLength(4);
  });

  test('A GROUP RE-DERIVES OVER WHAT IS LEFT: naming SOME members splits it, naming all dissolves it', () => {
    // The arithmetic behind the merge report's 8 -> 3, pinned rather than
    // described. Coalescing is a fold over the ORPHAN set: an incident a run
    // answers is no longer an orphan, so it leaves the group — the group does
    // not "move into" the run, it re-derives without that member.
    const scan = mintTaskId();
    const sibling = (symptom: string) =>
      core.emitter.emit({
        observed_at: hoursAgo(9),
        topic: INCIDENT_TOPIC,
        schema: INCIDENT_SCHEMA,
        entity: { site: SITE },
        actor: { id: 'act_security_sentinel', kind: 'agent' },
        source: { class: 'work', system: 'sentinel:scan', trust: 'emitted' },
        correlation: scan,
        payload: { fact: symptom, symptom, resolved: false, severity: 'critical' },
      }).id;
    const members = ['a', 'b', 'c', 'd'].map(sibling);
    expect(core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 20 })).toHaveLength(4);

    // TWO of the four named by the arming.
    emitManifest({
      taskId: mintTaskId(),
      observedAt: hoursAgo(8),
      cause: manifestCauseFor(members.slice(0, 2)),
    });

    const triage = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    // Two rows: the run carrying the two it answers, and the group of the two
    // it does not.
    expect(triage.waiting).toHaveLength(2);
    const run = triage.waiting.find((s) => s.kind === 'session')!;
    const group = triage.waiting.find((s) => s.kind === 'incident')!;
    expect(run.parts.filter((p) => p.kind === 'incident').map((p) => p.eventId).sort())
      .toEqual(members.slice(0, 2).sort());
    expect(group.memberCount).toBe(2);
    expect(group.linkKind).toBe('correlation');
    expect(group.parts.map((p) => p.eventId).sort()).toEqual(members.slice(2).sort());
  });

  test('naming THREE of four leaves a situation of ONE, not a group of one', () => {
    // The tail of the same rule, and the reason `memberCount`/`linkKind` are
    // set together: the remainder is one incident, so nothing was folded and
    // the row says so.
    const scan = mintTaskId();
    const members = ['a', 'b', 'c', 'd'].map((symptom) =>
      core.emitter.emit({
        observed_at: hoursAgo(9),
        topic: INCIDENT_TOPIC,
        schema: INCIDENT_SCHEMA,
        entity: { site: SITE },
        actor: { id: 'act_security_sentinel', kind: 'agent' },
        source: { class: 'work', system: 'sentinel:scan', trust: 'emitted' },
        correlation: scan,
        payload: { fact: symptom, symptom, resolved: false, severity: 'critical' },
      }).id,
    );
    emitManifest({
      taskId: mintTaskId(),
      observedAt: hoursAgo(8),
      cause: manifestCauseFor(members.slice(0, 3)),
    });

    const triage = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    expect(triage.waiting).toHaveLength(2);
    const remainder = triage.waiting.find((s) => s.kind === 'incident')!;
    expect(remainder.id).toBe(members[3]);          // the EVENT id, not the link
    expect(remainder.memberCount).toBe(1);
    expect(remainder.linkKind).toBeNull();
    expect(remainder.headlineTemplate).toBe('incident.no-run');
  });

  test('naming ALL of a group dissolves the row — five rows leave the list, not four', () => {
    // The exhibit's own step, in miniature: the coalesced ROW does not fold
    // into the run. Every member leaves the orphan set individually and the
    // group ceases to exist, which is why 8 - 5 = 3 rather than 8 - 4.
    const scan = mintTaskId();
    const members = ['a', 'b', 'c', 'd'].map((symptom) =>
      core.emitter.emit({
        observed_at: hoursAgo(9),
        topic: INCIDENT_TOPIC,
        schema: INCIDENT_SCHEMA,
        entity: { site: SITE },
        actor: { id: 'act_security_sentinel', kind: 'agent' },
        source: { class: 'work', system: 'sentinel:scan', trust: 'emitted' },
        correlation: scan,
        payload: { fact: symptom, symptom, resolved: false, severity: 'critical' },
      }).id,
    );
    const before = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    expect(before.waiting).toHaveLength(1);                    // the group, alone
    expect(before.waiting[0].id).toBe(scan);

    emitManifest({ taskId: mintTaskId(), observedAt: hoursAgo(8), cause: manifestCauseFor(members) });

    const after = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    expect(after.waiting).toHaveLength(1);
    expect(after.waiting[0].kind).toBe('session');
    // No row carries the link as its id any more: the group is gone, not moved.
    expect(after.waiting.some((s) => s.id === scan)).toBe(false);
    expect(after.waiting[0].parts.filter((p) => p.kind === 'incident')).toHaveLength(4);
  });

  test('a REFUSED turn records no cause, so it joins nothing', () => {
    const incident = emitIncident('Known backdoor plugin detected: wp-compat');
    emitManifest({
      taskId: mintTaskId(),
      observedAt: hoursAgo(8),
      status: 'refused',
      cause: manifestCauseFor([incident]),
    });

    // A refused turn is not a turn of the run at all, so there is no session for
    // anything to join — the incident stands alone, as it did before.
    const triage = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    expect(triage.waiting).toHaveLength(1);
    expect(triage.waiting[0].kind).toBe('incident');
  });

  test('an id naming no incident joins NOTHING — no part is manufactured for it', () => {
    const real = emitIncident('Known backdoor plugin detected: wp-compat');
    const ghost = 'evt_01M0BFNDD6XS21X8HTEMGY4NQZ';
    emitManifest({
      taskId: mintTaskId(),
      observedAt: hoursAgo(8),
      cause: manifestCauseFor([real, ghost]),
    });

    const triage = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    expect(triage.waiting).toHaveLength(1);
    const parts = triage.waiting[0].parts.filter((p) => p.kind === 'incident');
    expect(parts).toHaveLength(1);
    expect(parts[0].eventId).toBe(real);
  });

  test('a run that answered across TWO turns keeps both — a later arming never drops an earlier one', () => {
    const first = emitIncident('Known backdoor plugin detected: wp-compat');
    const second = emitIncident('PHP file(s) in mu-plugins/: index.php');
    // One session, two turns, each arming naming a different incident. The run
    // answers both; taking only the newest turn's list would silently drop what
    // the earlier turn recorded, and nothing on the row would say a part had gone.
    const taskA = mintTaskId();
    const taskB = mintTaskId();
    emitManifest({ taskId: taskA, observedAt: hoursAgo(8), cause: manifestCauseFor([first]) });
    emitManifest({ taskId: taskB, observedAt: hoursAgo(7), cause: manifestCauseFor([second]) });

    expect(core.ledger.query({ topicPrefix: CONTEXT_ASSEMBLED_TOPIC, limit: 10 })).toHaveLength(2);

    const triage = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).triage();
    expect(triage.waiting).toHaveLength(1);
    const parts = triage.waiting[0].parts.filter((p) => p.kind === 'incident');
    expect(parts.map((p) => p.eventId).sort()).toEqual([first, second].sort());
  });

  test('an incident already correlated into its own run keeps that run — the answer never steals it', () => {
    // An abort incident belongs to the run that PRODUCED it. A later containment
    // arming naming it must not move it out of its producing run's situation:
    // "which run produced this" outranks "which run answers it", and both are
    // record links.
    const producing = mintTaskId();
    emitManifest({ taskId: producing, observedAt: hoursAgo(20) });
    const incident = core.emitter.emit({
      observed_at: hoursAgo(19),
      topic: INCIDENT_TOPIC,
      schema: INCIDENT_SCHEMA,
      entity: { site: SITE },
      actor: { id: 'act_chat_assembler', kind: 'system' },
      source: { class: 'work', system: 'procedure:abort', trust: 'emitted' },
      correlation: producing,
      payload: { fact: 'ab.backup', symptom: 'cp.backup failed', resolved: false, source: 'abort:x/ab.backup' },
    }).id;

    // A DIFFERENT run — different document hash, so this is genuinely a second
    // session and not a later turn of the first.
    const answering = mintTaskId();
    emitManifest({
      taskId: answering,
      observedAt: hoursAgo(8),
      hash: 'sha256:remediate-2',
      cause: manifestCauseFor([incident]),
    });

    const snapshot = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).snapshot();
    expect(snapshot.sessions).toHaveLength(2);                      // two runs, not two turns
    const owner = snapshot.situations.find((s) => s.parts.some((p) => p.eventId === incident));
    expect(owner).toBeDefined();
    expect(owner!.sessionId).toBe(`sess_${producing}`);
    // …and the answering run does NOT also carry it: one incident, one row.
    const answeringRow = snapshot.situations.find((s) => s.sessionId === `sess_${answering}`);
    expect(answeringRow?.parts.some((p) => p.eventId === incident)).toBe(false);
  });

  test('TWO runs claiming one incident: the EARLIER claim holds, and the incident is in one row only', () => {
    // Two runs, each armed in answer to the same incident. The record carries
    // two claims and they disagree about which run answers it; the earlier one
    // was already true when the later was written, so it stands — and the
    // incident appears in exactly one row either way, because a part in two
    // situations is one thing the platform says is two.
    const incident = emitIncident('Known backdoor plugin detected: wp-compat');
    const first = mintTaskId();
    const second = mintTaskId();
    emitManifest({ taskId: first, observedAt: hoursAgo(9), cause: manifestCauseFor([incident]) });
    emitManifest({
      taskId: second,
      observedAt: hoursAgo(8),
      hash: 'sha256:remediate-2',
      cause: manifestCauseFor([incident]),
    });

    const snapshot = createSessionRegistry({ core, now: NOW, runbooks: noDocument }).snapshot();
    expect(snapshot.sessions).toHaveLength(2);
    const carrying = snapshot.situations.filter((s) => s.parts.some((p) => p.eventId === incident));
    expect(carrying).toHaveLength(1);
    expect(carrying[0].sessionId).toBe(`sess_${first}`);
  });
});
