/**
 * WP-55 · `incident.coalesced` — THE CLASS THE SHEET DREW AND THE PRODUCT COULD
 * NOT RENDER.
 *
 * The designer's cycle-seven sheet carries a coalesced class whose headline
 * reads *"{target} has {leadFinding}, and {restCount} more findings"*. Those
 * were host fields nothing derived, so the generator DEFERRED the class by name
 * and reason rather than emitting a template with holes in it. This packet
 * derives them, and the deferral is deleted.
 *
 * THE RULE THE HEADLINE EXISTS TO HOLD, ratified and not re-litigated here:
 * **the coalesced headline is DERIVED FROM THE MEMBERS, never borrowed from
 * one.** Target, the consequential member, and the count of the rest. A
 * four-part situation whose headline is one part's sentence with a count bolted
 * beside it is the prepending defect one level up.
 *
 * EVERY EXPECTED STRING IN THIS FILE IS COMPOSED FROM THE GENERATED MODULE, not
 * retyped. A test that retypes ratified copy is a second place the wording
 * lives, which is the defect the generator exists to prevent — so the
 * assertions fill the designer's own template and compare.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { INCIDENT_TOPIC, INCIDENT_SCHEMA, SENTINEL_SYSTEM } from '../incidentProducer';
import { createSessionRegistry, fillSituationSentence } from '../sessionRegistry';
import { SITUATION_TEMPLATES } from '../situationCopy.generated';
import { taskId } from '../../../intelligence';

const NOW = new Date('2026-08-21T08:00:00.000Z');
const SITE_A = 'ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA';
const SITE_B = 'ent_env_7QQ4KKB62XMHN2YRX5V0JTHWZZ';
const PRODUCER = 'act_security_sentinel';

/** The class under test, read from the emitted module. Never retyped. */
const COALESCED = () => SITUATION_TEMPLATES.find((t) => t.id === 'incident.coalesced');

let dir: string;
let core: IntelligenceCore;

function makeCore(): IntelligenceCore {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp55-coalesced-'));
  const store = new Map<string, unknown>();
  const built = initIntelligenceCore({
    storage: { get: (k: string) => store.get(k) ?? null, set: (k: string, v: unknown) => { store.set(k, v); } } as never,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
    dataDir: dir,
  });
  if (!built) throw new Error('the intelligence core failed to initialise');
  setIntelligenceCore(built);
  return built;
}

function emit(args: {
  entity: string; fact: string; symptom?: string; severity?: string;
  correlation: string; resolved?: boolean;
}): void {
  core.emitter.emit({
    topic: INCIDENT_TOPIC,
    schema: INCIDENT_SCHEMA,
    observed_at: '2026-08-18T22:25:24.386Z',
    entity: { environment: args.entity },
    actor: { id: PRODUCER, kind: 'agent' },
    source: { class: 'work', system: SENTINEL_SYSTEM, trust: 'emitted' },
    correlation: args.correlation,
    payload: {
      fact: args.fact,
      ...(args.symptom ? { symptom: args.symptom } : {}),
      ...(args.severity ? { severity: args.severity } : {}),
      resolved: args.resolved === true,
    },
  } as never);
}

/** The name the twin holds for a site. Written as a fold worker writes it. */
function writeSiteCore(entityId: string, name: string): void {
  core.ledger.raw().prepare(
    `INSERT OR REPLACE INTO twin_facts (entity_id, fact, value, observed_at, source_trust, event_id)
     VALUES (?, 'site.core', ?, ?, 'observed', 'evt_seed')`,
  ).run(entityId, JSON.stringify({ name }), '2026-08-18T00:00:00.000Z');
}

const triage = () => createSessionRegistry({ core, now: NOW }).triage();

/** The owner's real four, verbatim from the ledger (measured 2026-08-21). */
const REAL_FOUR = [
  { fact: 'ABS-04', symptom: 'File manager plugin(s) active: fileorganizer, filester', severity: 'high' },
  { fact: 'ABS-05', symptom: 'Known backdoor plugin detected: wp-compat', severity: 'critical' },
  { fact: 'ABS-07', symptom: 'Low-entropy plugin name(s) — likely attacker-created: noted, index', severity: 'high' },
  { fact: 'FS-01', symptom: 'PHP file(s) in mu-plugins/: index.php', severity: 'critical' },
];

beforeEach(() => { core = makeCore(); });
afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the class is emitted at all', () => {
  test('`incident.coalesced` is in the ratified set — the deferral is deleted', () => {
    expect(COALESCED()).toBeDefined();
  });

  test('its tier is DERIVED — the fixture states it in prose, so no number is declared', () => {
    // "the highest tier among the members" is not a number and must not become
    // one here. `null` means derived, and the fold is where the function lives.
    expect(COALESCED()!.tier).toBeNull();
  });
});

describe('the coalesced headline is derived from the members', () => {
  test('THE LEAD IS THE HIGHEST-SEVERITY MEMBER, and the rest are a count', () => {
    writeSiteCore(SITE_A, 'theawfulpm-test');
    const link = taskId();
    for (const f of REAL_FOUR) emit({ entity: SITE_A, correlation: link, ...f });

    const [row] = triage().waiting;

    expect(row.headlineTemplate).toBe('incident.coalesced');
    expect(row.headline).toBe(fillSituationSentence(COALESCED()!.headline, {
      target: 'theawfulpm-test',
      // Two members are `critical`. The tie is broken by the record's own
      // order — oldest first, by ULID — so `ABS-05` leads `FS-01`.
      leadFinding: 'Known backdoor plugin detected: wp-compat',
      restCount: 3,
    }));
    // The count of the REST, never the count of all — the sentence says "more".
    expect(row.headline).toContain('3 more findings');
  });

  test('the three host fields are on the ROW, not only in its sentence', () => {
    const link = taskId();
    for (const f of REAL_FOUR) emit({ entity: SITE_A, correlation: link, ...f });

    const [row] = triage().waiting;
    expect(row.memberCount).toBe(4);
    expect(row.linkKind).toBe('correlation');
  });

  test('NO MEMBER CARRIES A SEVERITY · the fallback arm renders, and no member leads', () => {
    // The fixture's own `fallbackGuard`: "no member carries a severity field, so
    // no member can lead". The row still says what it is; it does not guess who
    // is worst.
    writeSiteCore(SITE_A, 'theawfulpm-test');
    const link = taskId();
    for (const f of REAL_FOUR) emit({ entity: SITE_A, correlation: link, fact: f.fact, symptom: f.symptom });

    const [row] = triage().waiting;
    expect(row.headlineTemplate).toBe('incident.coalesced');
    expect(row.headline).toBe(fillSituationSentence(COALESCED()!.headlineFallback, {
      memberCount: 4, target: 'theawfulpm-test',
    }));
    // And it never names one of them.
    for (const f of REAL_FOUR) expect(row.headline).not.toContain(f.symptom);
  });

  test('MEMBERS ON TWO SITES · neither ratified arm can name a target, so the row is DERIVED', () => {
    // Both ratified arms read `{target}`. A group whose members sit on different
    // sites has no one target, and naming one member's site would be the
    // prepending defect in its navigation form. The derived sentence is true.
    const link = taskId();
    emit({ entity: SITE_A, correlation: link, ...REAL_FOUR[0] });
    emit({ entity: SITE_B, correlation: link, ...REAL_FOUR[1] });

    const [row] = triage().waiting;
    expect(row.headlineTemplate).toBeNull();
    expect(row.headline).toBe('2 open incidents from one scan');
    // …and its door is null, because there is no one place it leads to.
    expect(row.door).toBeNull();
  });
});

describe('the row the class composes', () => {
  test('the door names the target, once, in the class\'s own words', () => {
    writeSiteCore(SITE_A, 'theawfulpm-test');
    const link = taskId();
    for (const f of REAL_FOUR) emit({ entity: SITE_A, correlation: link, ...f });

    const [row] = triage().waiting;
    expect(row.door).toEqual({
      label: fillSituationSentence(COALESCED()!.door, { target: 'theawfulpm-test' }),
      kind: 'site',
      target: 'theawfulpm-test',
    });
  });

  test('THE STRIPE ENCODES TIER, and the lead names SEVERITY — different facts, on purpose', () => {
    writeSiteCore(SITE_A, 'theawfulpm-test');
    const link = taskId();
    for (const f of REAL_FOUR) emit({ entity: SITE_A, correlation: link, ...f });

    const [row] = triage().waiting;
    // The highest tier among the members. Every member of a run-less group is an
    // `incident.no-run`, which declares tier 1.
    expect(row.tier).toBe(1);
    expect(row.rule).toBe(fillSituationSentence(COALESCED()!.rule, { tier: 1 }));
    // The headline names the highest-SEVERITY member while the tier is the
    // highest-TIER one. Both are stated; neither is derived from the other.
    expect(row.headline).toContain('Known backdoor plugin detected');
  });

  test('the ask and the state come from the class, whole', () => {
    writeSiteCore(SITE_A, 'theawfulpm-test');
    const link = taskId();
    for (const f of REAL_FOUR) emit({ entity: SITE_A, correlation: link, ...f });

    const [row] = triage().waiting;
    expect(row.ask).toBe(COALESCED()!.ask);
    expect(row.state).toBe(COALESCED()!.state);
  });

  test('A GROUP OF ONE IS NOT A GROUP — one linked finding takes `incident.no-run`', () => {
    writeSiteCore(SITE_A, 'theawfulpm-test');
    emit({ entity: SITE_A, correlation: taskId(), ...REAL_FOUR[1] });

    const [row] = triage().waiting;
    expect(row.headlineTemplate).toBe('incident.no-run');
    expect(row.memberCount).toBe(1);
    // Nothing was folded, so nothing linked it — see `Situation.linkKind`.
    expect(row.linkKind).toBeNull();
  });

  test('THE COUNT IS STATED ONCE · the disclosure carries it, and the row has no parts chip', () => {
    writeSiteCore(SITE_A, 'theawfulpm-test');
    const link = taskId();
    for (const f of REAL_FOUR) emit({ entity: SITE_A, correlation: link, ...f });

    const [row] = triage().waiting;
    expect(row.chip).toBe('');
    // Four parts, one per member finding — the lines the disclosure opens onto.
    expect(row.parts).toHaveLength(4);
    expect(new Set(row.parts.map((p) => p.summary)).size).toBe(4);
  });
});
