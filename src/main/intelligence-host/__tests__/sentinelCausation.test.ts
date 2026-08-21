/**
 * WP-48a · THE SENTINEL'S CAUSAL LINK — ESCALATED, NOT ROUTED AROUND, and the
 * measurement pinned so the escalation cannot rot.
 *
 * The packet, verbatim: "the sentinel records the causal link it already knows.
 * The run id it writes into `payload.source` is recorded as proper causation on
 * `incident.opened`." WP-48's ruling added the expectation: "The day it does,
 * the four become one row of parts BY THE EXISTING RULES."
 *
 * **IT CANNOT BE WRITTEN THERE, AND THAT IS FINDING 1.** The envelope validator
 * refuses the value's FORMAT on both link fields, and the refusal is a hard
 * `ZodError` at `Emitter.emit` — not a soft degrade a producer could work
 * around. A sentinel run id is `r_msz8afwx00` (measured on the owner's real
 * ledger, 2026-08-20; it is `AgentRunner`'s `run_id`), and:
 *
 *   `causation`   must match `evt_<ULID>` — an EVENT id. A run is not an event,
 *                 and the sentinel run emits no event of its own to point at.
 *   `correlation` must match `task_<ULID>` — a TaskId. A sentinel scan mints
 *                 none; nothing in the runtime gives an agent run a TaskId.
 *
 * **AND THE COALESCER WOULD NOT GROUP THEM ANYWAY — FINDING 2.** The fold
 * attaches an incident to a session by `correlation → session taskId`, and files
 * everything else as an orphan, ONE SITUATION EACH. There is no rule anywhere
 * that groups orphans by a shared link. So "the four become one row of parts by
 * the existing rules" does not hold even if a link could be written: the rules
 * that exist coalesce incidents INTO A SESSION, and a sentinel scan is not one.
 *
 * The packet's own instruction is "the coalescing rule READS RECORD LINKS ONLY —
 * that stays law; you change the producer, never the coalescer", and its
 * escalation list names "any change to coalescing rules" — so grouping orphans
 * is the architect's call, and this packet does not make it.
 *
 * NOTHING IS LAUNDERED IN THE MEANTIME. The tempting fix — pointing findings 2..4
 * at finding 1's event id — would record SIBLINGS as a causal chain, which is
 * the data laundering `observed_at`/`recorded_at` is protected against one field
 * over. The four real incidents stay four rows, honestly, and each still states
 * its own limit.
 *
 * THIS IS A PIN, NOT A NOTE. Each test asserts a property of SHIPPED code. The
 * day the envelope widens or the coalescer gains an orphan rule, one of these
 * goes red and says WP-48a is buildable now.
 *
 * ---------------------------------------------------------------------------
 * WP-51 · THAT DAY CAME, AND THE PIN'S OWN TRIPWIRE DID NOT FIRE. Recorded here
 * because it is a finding about this file, not a note about the packet.
 *
 * The ruling (WP-50 gate, §7) minted the scan a TaskId and gave the coalescer
 * an orphan-grouping rule — both halves the header above said were the
 * architect's call. **Not one case below went red**, and the reason is exact:
 * every probe here reaches for `causation`, because before a TaskId existed
 * that was the only link a scan had to offer. The ruling produced a
 * `correlation`. A tripwire that watches the wrong field is silent in the one
 * event it was set for, which is a stronger version of WP-46's finding: a pin
 * over an input the change cannot produce is decoration.
 *
 * So the cases below are kept EXACTLY as they were — every one of them is still
 * true, and two of them are now the load-bearing statement that the four
 * historical incidents did not move — and the post-ruling behaviour is pinned
 * beneath them, in the same file, over the same four real findings.
 *
 * WHAT DID NOT CHANGE, and it is the packet's own instruction: **the four
 * existing incidents stay four rows.** The record is append-only; a `correlation`
 * exists only on events written after the producer learned to mint one, and
 * nothing backfills. Their stated limit — "the record does not link them" —
 * remains true OF THEM, forever.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { INCIDENT_TOPIC, INCIDENT_SCHEMA, recordSentinelIncidents } from '../incidentProducer';
import { createSessionRegistry } from '../sessionRegistry';
import type { NexusServices } from '../../mcp/types';

let core: IntelligenceCore;
let dir: string;

const NOW = new Date('2026-08-20T12:00:00.000Z');

/** The owner's real sentinel run id, as `payload.source` carries it. */
const REAL_RUN_ID = 'r_msz8afwx00';
const SITE = 'ent_site_Y64Y113T3AQXYGGSAPXMQKMQHA';
const ENV = 'ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA';

/** The four findings the owner's real scan produced, in its own words. */
const FINDINGS = [
  { fact: 'ABS-04', symptom: 'File manager plugin(s) active: fileorganizer, filester', severity: 'high' },
  { fact: 'ABS-05', symptom: 'Known backdoor plugin detected: wp-compat', severity: 'critical' },
  { fact: 'ABS-07', symptom: 'Low-entropy plugin name(s) — likely attacker-created: noted, index', severity: 'high' },
  { fact: 'FS-01', symptom: 'PHP file(s) in mu-plugins/: index.php', severity: 'critical' },
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp48a-'));
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

function emitFinding(f: (typeof FINDINGS)[number], link: Record<string, string> = {}): string {
  return core.emitter.emit({
    observed_at: '2026-08-18T22:25:24.386Z',
    topic: INCIDENT_TOPIC,
    schema: INCIDENT_SCHEMA,
    entity: { site: SITE, environment: ENV },
    actor: { id: 'act_security_sentinel', kind: 'agent' },
    source: { class: 'work', system: 'sentinel:scan', trust: 'emitted' },
    ...link,
    payload: { ...f, resolved: false, source: `sentinel:${REAL_RUN_ID}` },
  }).id;
}

describe('WP-48a finding 1 · the run id cannot be written to either link field', () => {
  test('`causation` refuses it — the field is an EVENT id, and a run is not an event', () => {
    expect(() => emitFinding(FINDINGS[0], { causation: REAL_RUN_ID })).toThrow();
    // …and the refusal is about the FORMAT, so no producer can talk it round.
    expect(() => emitFinding(FINDINGS[0], { causation: `evt_${REAL_RUN_ID}` })).toThrow();
  });

  test('`correlation` refuses it too — the field is a TaskId, and a scan mints none', () => {
    expect(() => emitFinding(FINDINGS[0], { correlation: REAL_RUN_ID })).toThrow();
    expect(() => emitFinding(FINDINGS[0], { correlation: `task_${REAL_RUN_ID}` })).toThrow();
  });

  test('the id the sentinel DOES record is on the payload, and it is the only place it fits', () => {
    const id = emitFinding(FINDINGS[0]);
    const [event] = core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 10, order: 'desc' });
    expect(event.id).toBe(id);                                   // shape #15
    expect((event.payload as Record<string, unknown>).source).toBe(`sentinel:${REAL_RUN_ID}`);
    // The link fields are empty, exactly as WP-48 measured on the real ledger.
    expect(event.correlation).toBeUndefined();
    expect(event.causation).toBeUndefined();
  });
});

describe('WP-48a finding 2 · the existing rules do not coalesce orphans, however they are linked', () => {
  test('the four real findings are FOUR situations, and each states its own limit', () => {
    const ids = FINDINGS.map((f) => emitFinding(f));
    expect(core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 10, order: 'desc' })).toHaveLength(4);

    const triage = createSessionRegistry({ core, now: NOW, runbooks: { byCapability: () => undefined } }).triage();
    expect(triage.waiting).toHaveLength(4);
    expect(triage.waiting.map((s) => s.id).sort()).toEqual([...ids].sort());
    for (const situation of triage.waiting) {
      expect(situation.kind).toBe('incident');
      expect(situation.parts).toHaveLength(1);
      // The row's stated limit — the designer drew it, and it remains TRUE for
      // these four whatever WP-48a lands, because the record is append-only and
      // rewriting history is escalation-grade.
      expect(situation.tierReason).toContain('no run linked to it');
    }
  });

  test('A SHARED CAUSAL LINK STILL PRODUCES FOUR ROWS — so a producer change alone cannot close this', () => {
    // The strongest available link: every sibling pointing at the FIRST
    // finding's event, which is the only `evt_<ULID>` a scan has to offer.
    // (Recording siblings as a causal chain would be laundering, which is why
    // this is a probe and not the implementation.)
    const first = emitFinding(FINDINGS[0]);
    for (const f of FINDINGS.slice(1)) emitFinding(f, { causation: first });
    expect(core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 10, order: 'desc' })).toHaveLength(4);

    const triage = createSessionRegistry({ core, now: NOW, runbooks: { byCapability: () => undefined } }).triage();
    // FOUR. The fold groups incidents into SESSIONS by correlation and files
    // the rest as orphans one apiece; nothing reads `causation` between two
    // orphans. This is the escalation, driven rather than asserted.
    expect(triage.waiting).toHaveLength(4);
    expect(triage.waiting.every((s) => s.parts.length === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WP-51 · the ruling, landed — the link is real, and only then does it group
// ---------------------------------------------------------------------------

/**
 * The ordering the reversal turned on, in the architect's words: *"the instinct
 * is right and the order is the thing — WP-51 mints the scan's TaskId so the
 * link becomes REAL, and only then is coalescing legitimate rather than
 * laundering."*
 *
 * These cases drive the SHIPPED producer into the SHIPPED fold. Nothing here
 * hand-writes a correlation onto a finding: the whole claim is that the producer
 * now knows one, so a test that supplied it would prove the fold and nothing
 * else.
 */
describe('WP-51 · a newly produced sibling set coalesces; the historical four do not', () => {
  /** Local's site store, as `entityRefsFor` reads it. */
  const services = {
    siteData: {
      getSite: (id: string) => ({ id, name: 'The Awful PM Test', domain: 'awful.local' }),
      getSites: () => ({ 'awful-pm-test': { id: 'awful-pm-test', name: 'The Awful PM Test', domain: 'awful.local' } }),
    },
  } as unknown as NexusServices;

  /** The same four findings, through the real producer this time. */
  function scan(runId: string, findings = FINDINGS) {
    return recordSentinelIncidents(
      {
        agentId: 'security-sentinel',
        runId,
        observedAt: '2026-08-20T09:00:00.000Z',
        // WP-57 · the run frame supplies this in production; a unit test with
        // no AgentRunner supplies it directly. One correlation per run.
        correlationId: () => 'task_01J5X8K3V9Q2M7SCNA0',
        sites: {
          'awful-pm-test': {
            status: 'escalated',
            findings: findings.map((f) => ({ id: f.fact, severity: f.severity, title: f.symptom })),
          },
        },
      },
      { services, core },
    );
  }

  const triageOf = () =>
    createSessionRegistry({ core, now: NOW, runbooks: { byCapability: () => undefined } }).triage();

  test('four findings from ONE scan are ONE situation with four parts', () => {
    expect(scan('r_new_scan')).toBe(4);
    const events = core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 10, order: 'desc' });
    expect(events).toHaveLength(4);                              // shape #15
    // The link is a RECORD link, written by the producer, naming an act that
    // exists — not a payload field the coalescer reached into.
    const link = events[0].correlation;
    expect(link).toMatch(/^task_[0-9A-HJKMNP-TV-Z]{16,26}$/);
    expect(events.every((e) => e.correlation === link)).toBe(true);
    // WP-57 · the act this link names is the RUN FRAME's `task.run.assigned`,
    // produced by `agentTaskFrame` at the AgentRunner chokepoint — not by this
    // producer, and so not present in a unit test that has no runner. That the
    // frame writes it before handing the correlation out is pinned in
    // `agentTaskFrame.test.ts` ("a gated act makes the run real, and the
    // bracket precedes it"); what THIS test owns is that the producer stamps
    // one link on every member, which the two assertions above check.

    const waiting = triageOf().waiting;
    expect(waiting).toHaveLength(1);
    const [situation] = waiting;
    expect(situation.kind).toBe('incident');
    expect(situation.parts).toHaveLength(4);
    expect(situation.parts.every((p) => p.kind === 'incident')).toBe(true);
    // Every member is a part, by its own event id — a part with no event id is
    // a claim (tear 2).
    expect(new Set(situation.parts.map((p) => p.eventId)).size).toBe(4);
    expect(situation.memberCount).toBe(4);
    expect(situation.linkKind).toBe('correlation');
    // The situation's id is the LINK, not one member's event id: a row named
    // after one of its four parts would say that part is the situation.
    expect(situation.id).toBe(link);
  });

  test('each part names its OWN finding — four parts saying four things', () => {
    scan('r_new_scan');
    const [situation] = triageOf().waiting;
    const summaries = situation.parts.map((p) => p.summary);
    expect(new Set(summaries).size).toBe(4);
    for (const f of FINDINGS) expect(summaries.some((line) => line.includes(f.symptom))).toBe(true);
  });

  test('THE EXHIBIT · the historical four stay four rows BESIDE the new one — five, not eight', () => {
    // The four the owner's real ledger holds: no correlation, one payload origin.
    const historical = FINDINGS.map((f) => emitFinding(f));
    // …and one new sweep through the shipped producer.
    expect(scan('r_new_scan')).toBe(4);
    expect(core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 20, order: 'desc' })).toHaveLength(8);

    const waiting = triageOf().waiting;
    expect(waiting).toHaveLength(5);

    const separate = waiting.filter((s) => s.parts.length === 1);
    const coalesced = waiting.filter((s) => s.parts.length > 1);
    expect(separate).toHaveLength(4);
    expect(coalesced).toHaveLength(1);

    // The four that stayed separate are the four the record does not link, by
    // id — not "four rows of some kind".
    expect(separate.map((s) => s.id).sort()).toEqual([...historical].sort());
    for (const situation of separate) {
      expect(situation.memberCount).toBe(1);
      expect(situation.linkKind).toBeNull();
      // Their stated limit, unchanged and still true of them.
      expect(situation.tierReason).toContain('no run linked to it');
    }
    expect(coalesced[0].memberCount).toBe(4);
    expect(coalesced[0].linkKind).toBe('correlation');
  });

  test('a scan that recorded ONE finding is a situation of one, not a group of one', () => {
    expect(scan('r_single', [FINDINGS[1]])).toBe(1);
    const [situation] = triageOf().waiting;
    expect(situation.parts).toHaveLength(1);
    expect(situation.memberCount).toBe(1);
    // It HAS a correlation; it is not coalesced, because there is nothing to
    // coalesce with. `linkKind` names the link that justified a FOLD, and no
    // fold happened here.
    expect(situation.linkKind).toBeNull();
    expect(situation.headlineTemplate).toBe('incident.no-run');
  });

  test('two scans are two situations — the group is the link, never the producer', () => {
    scan('r_scan_a', [FINDINGS[0], FINDINGS[1]]);
    // A different site, so the durable dedup does not swallow the second sweep.
    recordSentinelIncidents(
      {
        agentId: 'security-sentinel',
        runId: 'r_scan_b',
        observedAt: '2026-08-20T10:00:00.000Z',
        correlationId: () => 'task_01J5X8K3V9Q2M7SCNB0',
        sites: {
          'other-site': {
            status: 'escalated',
            findings: [FINDINGS[2], FINDINGS[3]].map((f) => ({ id: f.fact, severity: f.severity, title: f.symptom })),
          },
        },
      },
      {
        services: {
          siteData: {
            getSite: (id: string) => ({ id, name: id, domain: `${id}.local` }),
            getSites: () => ({ 'other-site': { id: 'other-site', name: 'other-site', domain: 'other.local' } }),
          },
        } as unknown as NexusServices,
        core,
      },
    );

    const waiting = triageOf().waiting;
    expect(waiting).toHaveLength(2);
    expect(waiting.every((s) => s.parts.length === 2)).toBe(true);
    // Two situations, two distinct links. Same actor, same topic, same
    // producer — none of which is a link.
    expect(new Set(waiting.map((s) => s.id)).size).toBe(2);
  });

  test('the coalesced row takes the DERIVED sentence — the ratified class is WP-55\'s to draw', () => {
    scan('r_new_scan');
    const [situation] = triageOf().waiting;
    // `incident.no-run`'s headline is ONE member's sentence ("{finding} on
    // {target}"), and Q3's ratified guard is that a coalesced row "can never be
    // one member's sentence with a parts chip bolted on". So the fold reports
    // no template rather than borrowing that one, and the sheet's
    // `incident.coalesced` lands with WP-55.
    expect(situation.headlineTemplate).toBeNull();
    for (const f of FINDINGS) expect(situation.headline).not.toContain(f.symptom);
    // …and it is derived from ALL FOUR, not from one of them: the count is the
    // whole of what a coalesced row can honestly say before the ratified class
    // arrives, so it is asserted exactly rather than as "not empty". A verdict
    // composed over one member would still avoid that member's symptom and
    // still read as a sentence — and would say "1".
    expect(situation.headline).toBe('4 open incidents from one scan');
    // A derived row carries no ask and no chip — `derivedCopy`'s own shape.
    expect(situation.ask).toBe('');
  });

  test('a member the record CLOSED does not make the situation closed', () => {
    scan('r_new_scan');
    // The next sweep finds nothing and skipped nothing: the producer closes all
    // four, and the closures carry the CLOSING scan's task.
    recordSentinelIncidents(
      {
        agentId: 'security-sentinel',
        runId: 'r_clean',
        correlationId: () => 'task_01J5X8K3V9Q2M7CNN00',
        observedAt: '2026-08-20T11:00:00.000Z',
        sites: { 'awful-pm-test': { status: 'clean', findings: [], notChecked: [] } },
      },
      { services, core },
    );
    const triage = triageOf();
    // TWO groups: the four openings, and the four closures that superseded
    // them — each set shares its own scan's task, and the fold groups by that.
    //
    // **THE OPENINGS STILL RENDER AS WAITING, AND THAT IS A PRE-EXISTING
    // DEFECT THIS PACKET DID NOT INTRODUCE AND DOES NOT FIX.** The fold reads
    // each event's OWN `resolved` field and never supersedes an opening event
    // with the amendment that closed it — so a resolved incident has always
    // kept its open row, one row per event, with or without coalescing.
    // Measured on the owner's real ledger: no resolution exists there, so
    // nothing on the live screen is affected. Reported at the gate rather than
    // folded in; the mid-task scope rule is why, and the fix belongs with
    // whoever owns supersession.
    expect(triage.waiting.map((s) => s.parts.length)).toEqual([4]);
    expect(triage.changed.map((s) => s.parts.length)).toEqual([4]);
    // What this case DOES pin: the closures group by the closing scan's task,
    // so the amendment set is one row rather than four.
    expect(triage.changed[0].memberCount).toBe(4);
    expect(triage.changed[0].linkKind).toBe('correlation');
  });
});
