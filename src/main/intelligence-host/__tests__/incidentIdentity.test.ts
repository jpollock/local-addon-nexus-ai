/**
 * WP-56a · AN INCIDENT SITUATION IS NAMED FOR ITS SUBJECT, NOT FOR ITS REPORT.
 *
 * Ruled at WP-56's gate: *"the producer's own dedup key is `(component, fact)` —
 * it has a notion of 'the same incident' that the fold declined to use, and
 * invented a different one from the report instead of the subject.
 * `incidentKey(component, fact)` is ratified as the incident situation's
 * identity."*
 *
 * WHY IT MATTERS, in the ruling's own words: a deferral names a SITUATION id,
 * and the producer resolves an incident by writing a NEW EVENT. Under the event
 * id the deferral stayed with the event it named and the amendment arrived
 * undeferred — the user quieted a finding and the platform handed the same
 * finding straight back the moment the record changed.
 *
 * TWO THINGS THIS PACKET REPORTS AT THE GATE RATHER THAN ASSUMING:
 *
 *  1. **The anchor is load-bearing and the ruling's phrase does not name it.**
 *     `incidentKey(component, fact)` is the key of a map the producer builds
 *     PER ENTITY (`incidentHistory` takes an `entityId`), so `(component, fact)`
 *     alone is only unique inside one site. The fold is fleet-wide: every site
 *     can carry `FS-01`, which is the collision `SituationSignature` already
 *     names in its own doc comment. The identity implemented here is the
 *     producer's key INSIDE its own scope — `(entity, component, fact)` — and
 *     the second test below is what fails if the anchor is ever dropped.
 *
 *  2. **The identity cannot be adopted without adopting the producer's
 *     supersession rule with it.** The producer's history is read newest-first,
 *     first occurrence per key wins, *"a resolution supersedes the incident it
 *     closes"*. Take the key and not the rule, and an opened-then-closed finding
 *     becomes TWO rows carrying ONE id — which is worse than the event id it
 *     replaced, because a duplicate identity is not an identity. So the fold now
 *     supersedes within a subject, which closes WP-51's F3 as a consequence of
 *     this change rather than as a separate one.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { INCIDENT_TOPIC, INCIDENT_SCHEMA, SENTINEL_SYSTEM } from '../incidentProducer';
import { createSessionRegistry } from '../sessionRegistry';

const NOW = new Date('2026-08-21T08:00:00.000Z');
const SITE_A = 'ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA';
const SITE_B = 'ent_env_7QQ4KKB62XMHN2YRX5V0JTHWZZ';

let dir: string;
let core: IntelligenceCore;

function makeCore(): IntelligenceCore {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp55-identity-'));
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

/** One finding, shaped exactly as `incidentProducer` shapes it. */
function emitFinding(args: {
  entity: string;
  fact: string;
  component?: string;
  symptom?: string;
  severity?: string;
  resolved?: boolean;
  observedAt?: string;
  correlation?: string;
}): string {
  return core.emitter.emit({
    topic: INCIDENT_TOPIC,
    schema: INCIDENT_SCHEMA,
    observed_at: args.observedAt ?? '2026-08-18T22:25:24.386Z',
    entity: { environment: args.entity },
    actor: { id: 'act_security_sentinel', kind: 'agent' },
    source: { class: 'work', system: SENTINEL_SYSTEM, trust: 'emitted' },
    ...(args.correlation ? { correlation: args.correlation } : {}),
    payload: {
      ...(args.component ? { component: args.component } : {}),
      fact: args.fact,
      ...(args.symptom ? { symptom: args.symptom } : {}),
      ...(args.severity ? { severity: args.severity } : {}),
      resolved: args.resolved === true,
    },
  } as never) as unknown as string;
}

function triage() {
  return createSessionRegistry({ core, now: NOW }).triage();
}

beforeEach(() => { core = makeCore(); });
afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('WP-56a · the situation id is the subject', () => {
  test('THE FIX · an orphan incident is named for (entity, component, fact), never for its event', () => {
    emitFinding({ entity: SITE_A, fact: 'ABS-05', symptom: 'Known backdoor plugin detected' });

    const [row] = triage().waiting;

    // The subject, in the producer's own separator, scoped by the anchor the
    // producer's own history map is keyed on.
    expect(row.id).toBe(`${SITE_A}|site|ABS-05`);
    // And it is NOT the event — the fact this ruling is about.
    expect(row.id).not.toMatch(/^evt_/);
  });

  test('THE ANCHOR IS LOAD-BEARING · one fact on two sites is two situations', () => {
    // `FS-01` on every site is the collision `SituationSignature` names. A key of
    // `(component, fact)` alone would give these one id and fold two different
    // sites' findings into one row.
    emitFinding({ entity: SITE_A, fact: 'FS-01', symptom: 'File permissions are wrong' });
    emitFinding({ entity: SITE_B, fact: 'FS-01', symptom: 'File permissions are wrong' });

    const ids = triage().waiting.map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(expect.arrayContaining([`${SITE_A}|site|FS-01`, `${SITE_B}|site|FS-01`]));
  });

  test('THE COMPONENT IS LOAD-BEARING · two components, one fact, one site', () => {
    emitFinding({ entity: SITE_A, fact: 'UPD-01', component: 'akismet', symptom: 'akismet is behind' });
    emitFinding({ entity: SITE_A, fact: 'UPD-01', component: 'jetpack', symptom: 'jetpack is behind' });

    const ids = triage().waiting.map((s) => s.id).sort();
    expect(ids).toEqual([`${SITE_A}|akismet|UPD-01`, `${SITE_A}|jetpack|UPD-01`]);
  });

  test('SUPERSESSION · an opened-then-closed finding is ONE row, closed, under ONE id', () => {
    // The producer's own rule, adopted with its key: newest first, first
    // occurrence per key wins. Without it the identity is a duplicate.
    emitFinding({
      entity: SITE_A, fact: 'ABS-05', symptom: 'Known backdoor plugin detected',
      observedAt: '2026-08-18T22:25:24.386Z',
    });
    emitFinding({
      entity: SITE_A, fact: 'ABS-05', symptom: 'Known backdoor plugin detected',
      observedAt: '2026-08-19T09:00:00.000Z', resolved: true,
    });

    const view = triage();
    // WP-51's F3, closed as a consequence: this used to be an open row that
    // never went away PLUS a closed row beside it.
    expect(view.waiting.map((s) => s.id)).toEqual([]);
    expect(view.changed.map((s) => s.id)).toEqual([`${SITE_A}|site|ABS-05`]);
  });

  test('THE DEFERRAL SURVIVES THE AMENDMENT — the whole reason for the ruling', () => {
    // Stated as an identity rather than driven through the deferral producer:
    // the id a deferral names is the id the amended row still carries.
    emitFinding({ entity: SITE_A, fact: 'ABS-05', symptom: 'Known backdoor plugin detected' });
    const before = triage().waiting[0].id;

    emitFinding({
      entity: SITE_A, fact: 'ABS-05', symptom: 'Known backdoor plugin detected',
      observedAt: '2026-08-19T09:00:00.000Z', resolved: true,
    });
    const after = triage().changed[0].id;

    expect(after).toBe(before);
  });

  test('A RECORD THAT CANNOT NAME ITS SUBJECT falls back to the event, and says so by shape', () => {
    // No `fact` at all. Nothing is invented: the row keeps the only identity the
    // record can supply, which is the event that reported it.
    core.emitter.emit({
      topic: INCIDENT_TOPIC,
      schema: INCIDENT_SCHEMA,
      observed_at: '2026-08-18T22:25:24.386Z',
      entity: { environment: SITE_A },
      actor: { id: 'act_security_sentinel', kind: 'agent' },
      source: { class: 'work', system: SENTINEL_SYSTEM, trust: 'emitted' },
      payload: { symptom: 'something is wrong', resolved: false },
    } as never);

    const [row] = triage().waiting;
    expect(row.id).toMatch(/^evt_/);
  });
});
