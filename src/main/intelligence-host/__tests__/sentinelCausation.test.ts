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
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { INCIDENT_TOPIC, INCIDENT_SCHEMA } from '../incidentProducer';
import { createSessionRegistry } from '../sessionRegistry';

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
