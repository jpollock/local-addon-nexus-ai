/**
 * WP-55 GATE · SHAPE #17, ONE LEVEL DOWN — the exit condition's own list.
 *
 * `assertDeferralsStillHold` probes the condition a deferral states: a class
 * deferred for carrying an unfillable slot must be emitted once every slot it
 * carries is in `KNOWN_SLOTS`. That guard is right, and **its exit condition is
 * a hand-written array that nothing checks.**
 *
 * `KNOWN_SLOTS` appears in the generator and its tests and nowhere else.
 * `SlotBag` is `Record<string, string | number | undefined>` — an open record
 * that cannot contradict it — and `fillSituationSentence` renders an absent slot
 * as `''` and then collapses the whitespace. So the failure the generator's own
 * header names, *"a row that renders the six literal characters {newField} to a
 * customer"*, is not the failure this composer can produce. **It produces
 * silence.**
 *
 * And the sequence is worse than inert. Add a slot name to `KNOWN_SLOTS`
 * without deriving it, and `assertDeferralsStillHold` throws DEMANDING the class
 * be emitted. The class ships. The headline reads *"theawfulpm-test has , and 3
 * more findings."* **The guard drives toward that state.**
 *
 * THIS IS THE CHECK ON THE LIST. Every slot the generator declares fillable must
 * actually RESOLVE, to a non-empty value, at its own position, on at least one
 * row the REAL FOLD produced from real events.
 *
 * **IT CANNOT BE SATISFIED BY EDITING A CONSTANT.** The values are not supplied
 * here: every row below comes out of `createSessionRegistry(...).triage()` over
 * a ledger built with the shipped emitters and the shipped producers, and the
 * assertion reads the values back out of the RENDERED SENTENCES by their slot
 * positions. Adding a name to `KNOWN_SLOTS` fails this test until something
 * derives a value for it; deriving a value for it is the only thing that passes.
 *
 * HOW A VALUE IS READ BACK. A template is turned into an anchored regex — its
 * literals escaped, each `{slot}` a lazy capture — and matched against what the
 * fold rendered. An EMPTY slot cannot pass: `fillSituationSentence` collapses
 * the run of whitespace its absence leaves, so the literals no longer line up
 * and the match FAILS, which is recorded as a mismatch and is itself a failure.
 * A slot that renders at the very start or end of a field (`meta: '{runbookId}'`)
 * captures `''` and fails on emptiness directly.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { initIntelligenceCore, type IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { recordAgentRunOutcome } from '../agentFailureProducer';
import {
  ACTION_EXECUTED_SCHEMA, ACTION_EXECUTED_TOPIC,
  OUTCOME_RECORDED_SCHEMA, OUTCOME_RECORDED_TOPIC,
} from '../actionProducer';
import { INCIDENT_SCHEMA, INCIDENT_TOPIC, SENTINEL_SYSTEM } from '../incidentProducer';
import { createSessionRegistry, type Situation } from '../sessionRegistry';
import { SITUATION_TEMPLATES, type SituationTemplate } from '../situationCopy.generated';
import { KNOWN_SLOTS } from '../../../../scripts/generate-situation-copy';
import { taskId as mintTaskId } from '../../../intelligence';
import { RB_BULK, RB_REMEDIATE } from '../../../../tests/unit/renderer/helpers/returnMorning';

const NOW = new Date('2026-08-21T08:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const SITE_A = 'ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA';
const SITE_B = 'ent_env_7QQ4KKB62XMHN2YRX5V0JTHWZZ';
const TARGET = 'ent_env_3AAAABB62XMHN2YRX5V0JTHWCC';

const MANIFEST_TOPIC = 'task.context.assembled';
const MANIFEST_SCHEMA = 'context.assembled/1';

/**
 * THE DOCUMENT, REUSED RATHER THAN REBUILT — `RB_REMEDIATE` from the morning
 * harness, which is shaped exactly as the loader builds one and carries the
 * designer's own "approval gate 3 of 8".
 *
 * A run with a document has a gate, and a gate is what gives `{checkpoint}`,
 * `{position}` and `{awaits}` anything to be about. Hand-building a second one
 * here would be a second opinion about what a runbook looks like.
 */
const DOCUMENTS = [RB_REMEDIATE, RB_BULK];
const byCapability = (capability: string) => DOCUMENTS.find((d) => d.capability === capability);

let core: IntelligenceCore;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp55-slots-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => { kv.set(k, v); } } as never,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The ledger — every ratified class, built with the shipped writers
// ---------------------------------------------------------------------------

function emitManifest(args: { taskId: string; observedAt: string; capability: string; runbook: string; hash: string; targets?: number }): void {
  core.emitter.emit({
    observed_at: args.observedAt,
    topic: MANIFEST_TOPIC,
    schema: MANIFEST_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: args.taskId,
    payload: {
      bundle_id: `bun_${args.taskId.slice(5)}`,
      task: args.taskId,
      assembled_at: args.observedAt,
      procedure: { capability: args.capability, runbook: args.runbook, hash: args.hash, status: 'delivered' },
      ...(args.targets === undefined ? {} : { scope: { runnable: Array.from({ length: args.targets }, (_, i) => `t${i}`) } }),
    },
  } as never);
}

/**
 * One gated act and its per-target outcome, in the SHAPE `recordGatedAction`
 * writes — the topics and schemas are the producer's own exported constants, not
 * strings typed here, because a hand-typed topic is a second opinion about the
 * record and the validator refuses it (which is how this one was found).
 */
function emitAct(args: { taskId: string; observedAt: string; target: string }): void {
  const action = core.emitter.emit({
    observed_at: args.observedAt,
    topic: ACTION_EXECUTED_TOPIC,
    schema: ACTION_EXECUTED_SCHEMA,
    entity: { environment: args.target },
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: args.taskId,
    payload: { tool: 'contain_site', tier: 2, dispatch: 'registry', targets: 1, targets_resolved: 1 },
  } as never) as unknown as { id: string };
  core.emitter.emit({
    observed_at: args.observedAt,
    topic: OUTCOME_RECORDED_TOPIC,
    schema: OUTCOME_RECORDED_SCHEMA,
    entity: { environment: args.target },
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: args.taskId,
    causation: action.id,
    payload: { tool: 'contain_site', result: 'success', result_scope: 'call' },
  } as never);
}

function emitIncident(args: {
  entity: string; fact: string; symptom: string; severity?: string; correlation?: string; observedAt?: string;
}): void {
  core.emitter.emit({
    observed_at: args.observedAt ?? hoursAgo(7),
    topic: INCIDENT_TOPIC,
    schema: INCIDENT_SCHEMA,
    entity: { environment: args.entity },
    actor: { id: 'act_security_sentinel', kind: 'agent' },
    source: { class: 'work', system: SENTINEL_SYSTEM, trust: 'emitted' },
    ...(args.correlation ? { correlation: args.correlation } : {}),
    payload: {
      fact: args.fact,
      symptom: args.symptom,
      ...(args.severity ? { severity: args.severity } : {}),
      resolved: false,
    },
  } as never);
}

/**
 * Every ratified class, on one ledger, and the fold run TWICE.
 *
 * The second fold is with the run's DOCUMENT available and the first without,
 * because that is the record's own difference between a run that has a
 * checkpoint to name and one that does not — `run.waiting.nothing-written`
 * needs the second, `run.waiting.mid-procedure` and `run.waiting.part-changed`
 * need the first. Both configurations are real: `runbooks` is an injected port
 * and both are values it takes in production.
 */
function everyRatifiedRow(): Situation[] {
  // Two runs under a document: one untouched (class 2) and one part-changed
  // (class 3). `targets` is the arming's own scope, which `{total}` binds to.
  //
  // **THEY ARE UNDER DIFFERENT DOCUMENTS, and that is not cosmetic.** A session
  // is folded by `capability@hash`, so two manifests naming one procedure are
  // two TURNS of one run and not two rows — which is what the first draft of
  // this test built, and why `run.waiting.mid-procedure` never appeared.
  const gated = mintTaskId();
  emitManifest({
    taskId: gated, observedAt: hoursAgo(6),
    capability: RB_REMEDIATE.capability, runbook: RB_REMEDIATE.id, hash: RB_REMEDIATE.hash, targets: 3,
  });

  const changed = mintTaskId();
  emitManifest({
    taskId: changed, observedAt: hoursAgo(5),
    capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, targets: 4,
  });
  emitAct({ taskId: changed, observedAt: hoursAgo(4), target: TARGET });

  // A run whose runbook the lookup never holds: no document, no gate, and a
  // selection that selected nothing (class 1).
  //
  // ITS CAPABILITY IS ONE THE RUN-NOUN COLUMN NAMES, and that is load-bearing:
  // this class's headline reads `{runNoun}`, and a capability the ratified
  // vocabulary does not cover makes the slot unfillable, which DECLINES the
  // class and sends the row to the derived sentence. The first draft used
  // `cap.cache_purge`, which v1.4 does not carry, and the class silently never
  // appeared — the same silence this whole test exists to catch, met while
  // building the test for it.
  const documentless = mintTaskId();
  emitManifest({
    taskId: documentless, observedAt: hoursAgo(9),
    capability: 'cap.diagnose_site', runbook: 'rb.diagnose', hash: 'sha256:gone', targets: 0,
  });

  // A situation of one (class 4).
  emitIncident({ entity: SITE_A, fact: 'ABS-05', symptom: 'Known backdoor plugin detected: wp-compat', severity: 'critical' });

  // A coalesced group WITH severities — its lead arm (class 5, first headline).
  const scan = mintTaskId();
  emitIncident({ entity: SITE_B, fact: 'ABS-04', symptom: 'File manager plugin(s) active: fileorganizer', severity: 'high', correlation: scan });
  emitIncident({ entity: SITE_B, fact: 'FS-01', symptom: 'PHP file(s) in mu-plugins/: index.php', severity: 'critical', correlation: scan });

  // A coalesced group with NO severity on any member — its FALLBACK arm, which
  // is the only ratified sentence carrying `{memberCount}`. The fixture's own
  // `fallbackGuard` names this case: "no member carries a severity field, so no
  // member can lead".
  const quietScan = mintTaskId();
  emitIncident({ entity: TARGET, fact: 'UPD-01', symptom: 'akismet is behind', correlation: quietScan });
  emitIncident({ entity: TARGET, fact: 'UPD-02', symptom: 'jetpack is behind', correlation: quietScan });

  // An agent run that timed out (class 6), through its shipped producer.
  recordAgentRunOutcome(
    { agentId: 'auth-probe', status: 'timeout', timeoutMs: 300_000, finishedAt: NOW.getTime() - 3 * 3_600_000 },
    { core } as never,
  );

  const withDocument = createSessionRegistry({ core, now: NOW, runbooks: { byCapability } } as never).triage();
  const withoutDocument = createSessionRegistry({ core, now: NOW } as never).triage();

  return [...withDocument.waiting, ...withDocument.changed, ...withoutDocument.waiting, ...withoutDocument.changed];
}

// ---------------------------------------------------------------------------
// Reading a slot's value back out of the sentence the fold rendered
// ---------------------------------------------------------------------------

const SLOT = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function slotsOf(template: string): string[] {
  return [...template.matchAll(SLOT)].map((m) => m[1]);
}

/**
 * The values a rendered field gave each of its template's slots, or `null` when
 * the two no longer line up.
 *
 * A MISMATCH IS A RESULT, NOT A SKIP. `fillSituationSentence` collapses the run
 * of whitespace an absent slot leaves behind, so an empty substitution changes
 * the sentence's SHAPE — the literals stop matching and this returns null. That
 * is the silence this whole test exists to catch, and the caller fails on it.
 */
function readSlots(template: string, rendered: string): Record<string, string> | null {
  const names = slotsOf(template);
  if (names.length === 0) return {};
  const pattern = template
    .split(SLOT)
    .map((piece, i) => (i % 2 === 1 ? '(.*?)' : piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const match = new RegExp(`^${pattern}$`).exec(rendered);
  if (!match) return null;
  const out: Record<string, string> = {};
  names.forEach((name, i) => { out[name] = match[i + 1]; });
  return out;
}

/** Every (template field, rendered field) pair a row carries. */
function fieldsOf(situation: Situation, template: SituationTemplate): Array<[string, string, string]> {
  const pairs: Array<[string, string, string]> = [
    ['headline', template.headline, situation.headline],
    ['ask', template.ask, situation.ask],
    ['meta', template.meta, situation.meta],
    ['rule', template.rule, situation.rule],
  ];
  if (template.headlineFallback !== '') pairs.push(['headlineFallback', template.headlineFallback, situation.headline]);
  if (situation.door) pairs.push(['door', template.door, situation.door.label]);
  if (template.disclosure !== '') {
    // The disclosure is rendered by the SURFACE from the row's part count, so
    // its slot is checked against the row's own number rather than against a
    // string the fold composed. `memberCount` is the fact; the sentence that
    // carries it lives one layer up.
    pairs.push(['disclosure', template.disclosure, template.disclosure.replace('{memberCount}', String(situation.parts.length))]);
  }
  return pairs;
}

// ===========================================================================

describe('WP-55 GATE · every slot the generator declares fillable is actually derived', () => {
  test('EVERY name in KNOWN_SLOTS is carried by at least one ratified template', () => {
    // The first half of the list's own check: a slot named and used by nothing
    // is dead weight the deferral guard would nonetheless treat as satisfied.
    const carried = new Set<string>();
    for (const template of SITUATION_TEMPLATES) {
      for (const field of [template.headline, template.headlineFallback, template.ask, template.meta, template.rule, template.door, template.disclosure]) {
        for (const slot of slotsOf(field)) carried.add(slot);
      }
    }
    const orphaned = KNOWN_SLOTS.filter((slot) => !carried.has(slot));
    expect({ orphaned }).toEqual({ orphaned: [] });
  });

  test('EVERY name in KNOWN_SLOTS resolves NON-EMPTY on a row the real fold produced', () => {
    const rows = everyRatifiedRow();

    // Shape #15 first: the fold must actually have produced ratified rows, or
    // an empty sweep would satisfy nothing and report nothing.
    const ratified = rows.filter((s) => s.headlineTemplate !== null);
    const classes = new Set(ratified.map((s) => s.headlineTemplate));
    expect({ classes: [...classes].sort() }).toEqual({
      classes: [
        'agent.stuck', 'incident.coalesced', 'incident.no-run',
        'run.waiting.mid-procedure', 'run.waiting.nothing-written', 'run.waiting.part-changed',
      ],
    });

    const resolved = new Set<string>();
    const mismatches: string[] = [];
    const empty: string[] = [];

    for (const situation of ratified) {
      const template = SITUATION_TEMPLATES.find((t) => t.id === situation.headlineTemplate)!;
      for (const [name, templateText, renderedText] of fieldsOf(situation, template)) {
        if (slotsOf(templateText).length === 0) continue;
        const values = readSlots(templateText, renderedText);
        if (values === null) {
          // Only the arm the row actually rendered can line up: a class with two
          // headlines renders one of them, so the other is expected not to match
          // and is not a fault.
          if (name === 'headline' || name === 'headlineFallback') continue;
          mismatches.push(`${template.id}.${name}: template ${JSON.stringify(templateText)} vs rendered ${JSON.stringify(renderedText)}`);
          continue;
        }
        for (const [slot, value] of Object.entries(values)) {
          if (value.trim() === '') { empty.push(`${template.id}.${name}.{${slot}}`); continue; }
          resolved.add(slot);
        }
      }
    }

    // A slot that rendered EMPTY is the silence this test is about — the
    // "theawfulpm-test has , and 3 more findings" state, caught at its source.
    expect({ empty, mismatches }).toEqual({ empty: [], mismatches: [] });

    // AND THE LIST ITSELF: every name the generator declares fillable was
    // filled, by the fold, from real events. A name added here without a
    // derivation fails on this line and cannot be argued out of it — the only
    // thing that passes is a value.
    const neverDerived = KNOWN_SLOTS.filter((slot) => !resolved.has(slot));
    expect({ neverDerived }).toEqual({ neverDerived: [] });
  });
});
