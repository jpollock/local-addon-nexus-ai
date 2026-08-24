/**
 * WP-54 · ITEM 4 — THE TARGET IS RESOLVED TO WHAT IT IS CALLED.
 *
 * THE DEFECT, AS THE ARCHITECT READ IT OFF THE LIVE BUILD: four incident cards
 * read *"… on `ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA`, and nothing is fixing it"*
 * with the meta line *"nothing on record names where the target is"* — while the
 * DUPLICATE inbox card six inches below each of them rendered the same finding
 * as *"theawfulpm-test · security-sentinel"*. **The platform had the name and was
 * claiming it did not.** Same family as WP-52's "no targets on record": a
 * sentence about the record's knowledge, written from the wrong side of a join.
 *
 * WHERE THE NAME LIVES, measured on a copy of the owner's real ledger
 * (2026-08-21): the `site.core` twin fact on that very entity carries
 * `{"name":"theawfulpm-test","domain":"theawfulpm-test.local",…}`. So the join
 * is one read inside the layer — no host service, no `services.siteData`, no new
 * reach across the extraction seam.
 *
 * THE FALLBACK IS THE ID, and that is the second half of the item: an entity the
 * record does not name is cited in full, which is the property the refusals and
 * the Govern matrix already hold to. A fabricated name would be worse than an
 * id, and an EMPTY target would be worse than both — the headline's `{target}`
 * slot would leave a hole where the site belongs.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { INCIDENT_TOPIC, INCIDENT_SCHEMA, SENTINEL_SYSTEM } from '../incidentProducer';
import { createSessionRegistry } from '../sessionRegistry';
import { SITUATION_TEMPLATES } from '../situationCopy.generated';

const NOW = new Date('2026-08-21T08:00:00.000Z');
const ENV = 'ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA';

let dir: string;
let core: IntelligenceCore;

function makeCore(): IntelligenceCore {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp54-target-'));
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

/** One open sentinel finding, shaped exactly as the producer shapes it. */
function emitFinding(resolved = false): void {
  core.emitter.emit({
    topic: INCIDENT_TOPIC,
    schema: INCIDENT_SCHEMA,
    observed_at: '2026-08-18T22:25:24.386Z',
    entity: { environment: ENV },
    actor: { id: 'act_security_sentinel', kind: 'agent' },
    // The producer's own provenance, verbatim: an incident is a record OF WORK
    // the platform did, not a live reading of the site.
    source: { class: 'work', system: SENTINEL_SYSTEM, trust: 'emitted' },
    payload: {
      fact: 'ABS-05',
      symptom: 'Known backdoor plugin detected: wp-compat',
      severity: 'critical',
      resolved,
    },
  } as never);
}

/**
 * The twin the fold would have materialised, written directly.
 *
 * A test may write the materialised view because that is what a fold worker
 * does; what nothing may do is write `events`, and this does not. The row is a
 * verbatim copy of the shape measured on the owner's ledger.
 */
function writeSiteCore(entityId: string, value: unknown): void {
  core.ledger
    .raw()
    .prepare(
      `INSERT OR REPLACE INTO twin_facts (entity_id, fact, value, observed_at, source_trust, event_id)
       VALUES (?, 'site.core', ?, ?, 'observed', 'evt_seed')`,
    )
    .run(entityId, JSON.stringify(value), '2026-08-18T00:00:00.000Z');
}

beforeEach(() => { core = makeCore(); });
afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the incident headline names the site', () => {
  test('THE FIX · the twin supplies the name, and the card says it', () => {
    writeSiteCore(ENV, { name: 'theawfulpm-test', domain: 'theawfulpm-test.local' });
    emitFinding();

    const [row] = createSessionRegistry({ core, now: NOW }).triage().waiting;

    expect(row.headline).toBe(
      'Known backdoor plugin detected: wp-compat on theawfulpm-test, and nothing is fixing it',
    );
    // The entity id is nowhere on the card — it was the whole headline before.
    expect(row.headline).not.toContain('ent_env_');
    // …and the meta line no longer contradicts it.
    expect(row.places.summary).toBe('');
  });

  test('THE FALLBACK · an entity the record does not name is cited in full', () => {
    // No twin at all. Nothing is invented, nothing is left blank.
    emitFinding();

    const [row] = createSessionRegistry({ core, now: NOW }).triage().waiting;
    expect(row.headline).toContain(ENV);
    expect(row.headline).toBe(
      `Known backdoor plugin detected: wp-compat on ${ENV}, and nothing is fixing it`,
    );
  });

  test('a twin with no usable name falls back too — never a blank where a site belongs', () => {
    for (const value of [{ domain: 'x.local' }, { name: '' }, { name: 42 }, 'not json at all']) {
      const fresh = `${ENV}${String(value).length}`;
      writeSiteCore(fresh, value);
    }
    writeSiteCore(ENV, { domain: 'theawfulpm-test.local' }); // a twin, no name
    emitFinding();

    const [row] = createSessionRegistry({ core, now: NOW }).triage().waiting;
    expect(row.headline).toContain(ENV);
  });

  test('the DOOR and the SIGNATURE take the resolved name too — one derivation, three uses', () => {
    writeSiteCore(ENV, { name: 'theawfulpm-test' });
    emitFinding();

    const [row] = createSessionRegistry({ core, now: NOW }).triage().waiting;
    expect(row.door).toEqual({
      label: 'Open theawfulpm-test',
      kind: 'site',
      target: 'theawfulpm-test',
    });
    // The Inbox stores the site by NAME (`scope: 'name:theawfulpm-test'`), so a
    // signature carrying the id could never match the card it duplicates — which
    // is why item 4 is a dependency of item 1 rather than a cosmetic fix.
    // WP-55 · A SET OF ONE. The field became a set so a coalesced row can hold
    // one identity per member; a situation of one still holds exactly one, and
    // the identity itself is unchanged.
    expect(row.signatures).toMatchObject([{
      producer: 'security-sentinel',
      fact: 'ABS-05',
      target: 'theawfulpm-test',
    }]);
  });

  test('an injected resolver wins over the twin — the seam is real, not decoration', () => {
    writeSiteCore(ENV, { name: 'theawfulpm-test' });
    emitFinding();

    const [row] = createSessionRegistry({ core, now: NOW, nameOf: () => 'injected-name' }).triage().waiting;
    expect(row.headline).toContain('injected-name');
  });

  test('a resolver that THROWS costs the name, never the row', () => {
    emitFinding();
    const [row] = createSessionRegistry({
      core,
      now: NOW,
      nameOf: () => { throw new Error('twin exploded'); },
    }).triage().waiting;

    expect(row).toBeDefined();
    expect(row.headline).toContain(ENV);
  });
});

// ---------------------------------------------------------------------------
// WP-54 · ITEM 2 — the class's declared tier IS the fold's rank
// ---------------------------------------------------------------------------

describe('the ratified class ranks the row', () => {
  /**
   * BATTERY SURVIVOR M01, and the pin that was missing.
   *
   * The agreement pin in `tierAgreement.test.ts` asserts that the tier a card
   * DISPLAYS is the tier it was SORTED BY — and a `rankableTier` that ignored
   * the class entirely SURVIVED it, because the rule line's `{tier}` slot is
   * filled from the ranked tier: display and rank still agreed, and both were
   * wrong. Agreement is necessary and not sufficient. This is the other half:
   * the number they agree on is the one the ratified class declares.
   */
  test('an open orphan incident ranks at the class\'s OWN tier, not at the fold\'s default', () => {
    writeSiteCore(ENV, { name: 'theawfulpm-test' });
    emitFinding();

    const [row] = createSessionRegistry({ core, now: NOW }).triage().waiting;
    const declared = SITUATION_TEMPLATES.filter((t) => t.id === 'incident.no-run')[0];

    expect(row.headlineTemplate).toBe('incident.no-run');
    expect(row.tier).toBe(declared.tier);
    expect(row.tier).toBe(1);
    // …and the rule line names that same number, from the same value.
    expect(row.rule).toBe('Tier 1 · nothing is holding it back but you');
  });

  /**
   * BATTERY SURVIVORS M04 AND M21 — the closed incident, which no test had.
   *
   * A resolved incident is a thing that CHANGED, not a thing that needs you. It
   * ranks at 4, it is filed in the changed column, it takes NO ratified sentence
   * (the templates select rows of the Now list), and it gets NO door — the
   * changed column is read with no interaction and no question asked, and a
   * finished thing belongs to the Record, which already exists.
   */
  test('a CLOSED incident is filed, ranked 4, unsentenced and doorless', () => {
    writeSiteCore(ENV, { name: 'theawfulpm-test' });
    emitFinding(true);

    const triage = createSessionRegistry({ core, now: NOW }).triage();
    expect(triage.waiting).toHaveLength(0);
    expect(triage.changed).toHaveLength(1);

    const [row] = triage.changed;
    expect(row.tier).toBe(4);
    expect(row.door).toBeNull();
    // The ratified `incident.no-run` guard reads `runId === null` and says
    // nothing about resolution, so a template selected for every column would
    // hand a CLOSED incident "…and nothing is fixing it" — and, now that the
    // class declares its tier, tier 1 at the top of the list of things needing
    // a person.
    expect(row.headlineTemplate).toBeNull();
    expect(row.headline).toContain('incident closed');
    expect(row.rule).toBe('the incident is recorded closed; nothing is waiting on you');
  });
});
