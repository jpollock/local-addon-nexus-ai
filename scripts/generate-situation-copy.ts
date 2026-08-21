/**
 * WP-48 · THE RATIFIED SITUATION HEADLINES — extracted, never retyped.
 *
 * The Now implementation route (`from-designer-10-now-implementation.md`) and
 * the owner's ratification of 2026-08-20 fixed a sentence set for the Now list:
 * five guarded templates, the run-noun column (Controlled Vocabulary v1.4), the
 * list verdict, and the freshness replacement. They live in ONE file the
 * designer owns and this packet does not:
 *
 *   docs/intelligence/from-designer/fixtures/situation-headlines.js
 *
 * A composer that RETYPES them is a second place the ratified wording can be
 * wrong — the same defect `generate-return-copy.ts` exists to prevent, one
 * surface over. So this generator runs that file, validates its shape, and
 * emits one TypeScript module `sessionRegistry` imports. Nothing here composes
 * prose: every exported string is a value the designer's file assigned.
 *
 * WHAT THIS GENERATOR REFUSES TO EMIT, loudly, rather than shipping a hole:
 *
 *  - a file that does not assign `window.NEXUS_HEADLINES`
 *  - a template set that is not exactly the five ratified ids, in order
 *  - a template missing any of its seven fields
 *  - **a template carrying a slot this product cannot fill.** `KNOWN_SLOTS` is
 *    the fixture's own "Slots are host fields that already exist, named
 *    exactly" list. A designer who adds `{newField}` gets a build failure here
 *    rather than a row that renders the six literal characters `{newField}` to
 *    a customer — which is the blank-where-a-sentence-belongs failure in its
 *    substitution form.
 *
 * DETERMINISTIC BY CONSTRUCTION: no clock, no randomness, no absolute paths.
 * Running it twice on an unchanged tree produces a byte-identical file.
 *
 *   npx ts-node scripts/generate-situation-copy.ts
 *   npx ts-node scripts/generate-situation-copy.ts --check       # CI/no-write
 *   npx ts-node scripts/generate-situation-copy.ts --out <path>  # write elsewhere
 *
 * `--out` exists for PARALLEL_PROTOCOL's poisoned-fixture rule (WP-32): a
 * mutation battery over this script must never be able to leave its output on
 * the tracked artifact. `--fixture` overrides the INPUT, for the tests that
 * drive the refusals above — a guard nothing can reach is a guard nothing can
 * check.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { controlLabel } from './control-label';

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_JS = path.join(
  REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'fixtures', 'situation-headlines.js',
);
const OUT_FILE = path.join(
  REPO_ROOT, 'src', 'main', 'intelligence-host', 'situationCopy.generated.ts',
);

/** The input actually read. Overridable by `--fixture`; see `main`. */
let fixturePath = FIXTURE_JS;

/** Bumped when the SHAPE changes, so a consumer can tell that from a content change. */
const SHAPE_VERSION = 4;

/**
 * The five ratified ids, in the fixture's own order.
 *
 * WHY THE ORDER IS CHECKED, stated correctly after a mutation battery
 * falsified the first answer. This comment used to claim the order was
 * load-bearing because `nothing-written` and `mid-procedure` overlap on
 * `done === 0 && failed === 0`. They do not: one requires `total === 0` and
 * the other `total > 0`, which are disjoint. Brute-forcing the guards over
 * their whole input domain finds ZERO inputs satisfying two of the five, so
 * first-match and last-match select identically and the battery's reordering
 * mutation SURVIVED — correctly.
 *
 * The order is still refused when it changes, for the reason that actually
 * applies: this array is the ratified ARTIFACT, and a reordered set is a
 * change to ratified copy. It must reach a human rather than regenerate
 * silently. `situationHeadlines.test.ts` pins the exclusivity itself, so if a
 * future template ever does overlap another, that test fails and says so
 * instead of leaving the order quietly load-bearing.
 */
const RATIFIED_IDS = [
  'run.waiting.nothing-written',
  'run.waiting.mid-procedure',
  'run.waiting.part-changed',
  'incident.no-run',
  // WP-55 · `incident.coalesced` LEAVES THE DEFERRAL AND JOINS THE SET. Its four
  // host fields (`{leadFinding}`, `{restCount}`, `{memberCount}`, `{linkKind}`)
  // are derived in the fold now, so the condition its deferral stated has ended
  // — and `assertDeferralsStillHold` below is what makes that a build failure
  // rather than a thing someone had to remember.
  'incident.coalesced',
  'agent.stuck',
] as const;

/**
 * WP-54's merge · CLASSES THE FIXTURE DECLARES AND THE PRODUCT CANNOT YET FILL.
 *
 * The designer's cycle-seven sheet is AHEAD of the product, deliberately: it
 * draws `incident.coalesced`, whose headline reads *"{target} has {leadFinding},
 * and {restCount} more findings"*. Those are host fields nothing derives yet.
 *
 * The generator's whole purpose is that a template carrying a slot this product
 * cannot fill is a BUILD FAILURE rather than a rendered `{leadFinding}`, and it
 * fired on exactly that when this merge first ran it. Refusing the whole
 * artifact would be the wrong answer to the right refusal, though — it would
 * make a designer unable to draw ahead of the build, which is what a design
 * sheet is FOR.
 *
 * So a class named here is SKIPPED, and skipped LOUDLY: the run prints which
 * class it did not emit and why, so the omission is a line in the build output
 * rather than a silence. Nothing unfillable reaches the module, nothing
 * ratified is deleted, and a class that appears in the fixture WITHOUT being
 * declared here still fails the build — a new class must reach a human.
 *
 * `incident.coalesced` leaves this list on the visit that gives it its host
 * fields, which is WP-55's — the same visit that reconciles the composer.
 */
/**
 * WP-51's CARRIED CONDITION, MECHANISED — the ruled amendments, asserted.
 *
 * **THE FAILURE THIS EXISTS TO PREVENT HAS ALREADY HAPPENED ONCE.** Two ruled
 * guard amendments — WP-48's `&& gate === null` on class 1, and WP-50's removal
 * of `total` from class 2 — were silently REVERTED when the designer's
 * cycle-seven sheet replaced this fixture wholesale. Nothing caught it: the
 * generator checked the ids, the fields and the slots, and had no opinion about
 * a guard's CONTENT, so a ruling adjudicated at two separate gates was undone
 * by a file copy and shipped to the base.
 *
 * A ruling recorded only in WORK_PACKETS is a ruling that survives exactly as
 * long as the next person's memory. This is the same rule as the packet's own:
 * **an instrument that cannot fail is not an instrument.** `:check` fails
 * closed on a stale artifact; this makes it fail closed on a REVERTED RULING
 * too, which is the half that was missing.
 *
 * Each entry names the class, the substring that must be present or absent, and
 * the gate that ruled it. Adding one is how a future amendment stops being
 * undoable by a paste.
 */
const RULED_AMENDMENTS: ReadonlyArray<{
  id: string;
  field: 'guard';
  mustContain?: string;
  mustNotContain?: string;
  ruledAt: string;
  why: string;
}> = [
  {
    id: 'run.waiting.nothing-written',
    field: 'guard',
    mustContain: 'gate === null',
    ruledAt: 'WP-48 gate, 2026-08-20',
    why: 'a row STANDING AT A GATE can never be "cannot start", whatever any count says — '
      + 'measured on the live fleet, where one such row received this class\'s ask and it was false about it',
  },
  {
    id: 'run.waiting.mid-procedure',
    field: 'guard',
    mustNotContain: 'total',
    ruledAt: 'WP-50 gate, 2026-08-21',
    why: 'neither of this class\'s sentences reads {total}, and the clause withheld the designer\'s '
      + 'own row from the sheet that drew it — a guard may condition only on facts its sentence claims',
  },
];

const DEFERRED_IDS: Readonly<Record<string, string>> = {
  // EMPTY, AND THAT IS THE POINT. `incident.coalesced` was the one entry; WP-55
  // derived its four host fields and deleted it. The mechanism that FORCED the
  // deletion is `assertDeferralsStillHold` below — not a reader remembering.
};

/**
 * WP-55 · VACUOUS SHAPE #17, CLOSED — the guard that reads its own exception.
 *
 * `RATIFIED_IDS` is compared against `ids.filter(id => !(id in DEFERRED_IDS))`.
 * The deferral is SUBTRACTED before the guard reads it, so the guard cannot see
 * the class it is deferring: the day the host fields arrived, forgetting to
 * delete the entry would have left the build green with the class missing from
 * the screen it was drawn for. That is registered as shape #17 —
 * *a guard that subtracts its own exception before reading* — and this is it
 * closed.
 *
 * **A DEFERRAL STATES A CONDITION UNDER WHICH IT ENDS. THIS PROBES THAT
 * CONDITION.** Every entry in `DEFERRED_IDS` is deferred for exactly one reason:
 * the class carries a slot this product cannot fill. `KNOWN_SLOTS` is the
 * registry of slots it CAN fill. So the condition is mechanically checkable —
 * if every slot the deferred class carries is now known, the deferral has
 * expired and the class must be emitted. Refusing to emit it is then a hole in
 * the screen, and this throws instead.
 *
 * SKIPPING LOUDLY IS NOT FAILING CLOSED. The `process.stdout.write` that
 * announces a skip is a courtesy to whoever is watching a build; it is not an
 * instrument, because nothing reads it and nothing fails on it.
 *
 * EXPORTED so it can be driven in BOTH directions without constructing a broken
 * fixture: a deferral whose condition still holds passes, and a deferral whose
 * condition has ended throws. A guard nothing can reach is a guard nothing can
 * check — this packet's own rule, turned on the packet.
 */
export function assertDeferralsStillHold(
  deferred: Readonly<Record<string, string>>,
  templates: ReadonlyArray<Record<string, unknown>>,
  knownSlots: readonly string[],
): void {
  for (const [id, why] of Object.entries(deferred)) {
    const template = templates.find((t) => t && t.id === id);
    if (!template) continue; // declared and absent — the skip announcement covers it
    const slots = new Set<string>();
    for (const value of Object.values(template)) {
      if (typeof value !== 'string') continue;
      for (const slot of slotsIn(value)) slots.add(slot);
    }
    const unfillable = [...slots].filter((slot) => !knownSlots.includes(slot));
    if (unfillable.length > 0) continue; // the condition still holds
    throw new Error(
      `THE DEFERRAL OF "${id}" HAS EXPIRED and the class is still not emitted. ` +
      `It was deferred because: ${why}. Every slot it carries is now a host field ` +
      'the composer can fill, so the condition that justified the deferral has ended — ' +
      `delete the "${id}" entry from DEFERRED_IDS and add it to RATIFIED_IDS in the ` +
      'fixture\'s own order. A deferral that outlives its own condition is a class ' +
      'the designer drew and the product silently refuses to render.',
    );
  }
}

/**
 * Every STRING field a template must carry. A missing one is a hole, not a
 * default.
 *
 * **`chip` LEFT THIS LIST AT WP-54's MERGE, and it left the fixture too.** The
 * Waiting chip was cut as the designer's own template error — chip-presence told
 * the user which of OUR code paths ran — and the cycle-seven sheet carries no
 * `chip` on any class. A field no ratified template declares is not an optional
 * field; it is a field that no longer exists, and requiring it here would refuse
 * the designer's own artifact. `SituationTemplate.chip` survives as `''` so the
 * composer and every consumer are unchanged.
 */
const TEMPLATE_FIELDS = ['id', 'guard', 'headline', 'ask', 'state', 'meta', 'rule', 'door'] as const;

/**
 * WP-55 · FIELDS ONLY SOME CLASSES CARRY, emitted as `''` where absent.
 *
 * `incident.coalesced` is the first class with a SECOND headline and a
 * disclosure, and both are class-specific facts rather than universal ones: a
 * fallback headline exists because that class's lead can be genuinely
 * underivable (no member carries a severity, so no member can lead), and a
 * disclosure exists because that class is the only one with parts to disclose.
 *
 * REQUIRING them of every class would refuse the designer's own artifact, and
 * defaulting a MISSING one on a class that should carry it would be the
 * blank-where-a-sentence-belongs defect. `''` is the honest emission: the
 * consumer branches on presence, and the fixture is what decides presence.
 *
 * The two disclosure strings are CONTROLS and take the class rule — no terminal
 * full stop — for the same reason every door does.
 */
const OPTIONAL_TEMPLATE_FIELDS = ['headlineFallback', 'disclosure', 'disclosureOpen'] as const;

/** The optional fields that are CONTROL LABELS, and so take `controlLabel`. */
const CONTROL_TEMPLATE_FIELDS: readonly string[] = ['disclosure', 'disclosureOpen'];

/**
 * WP-54 · THE TIER IS ONE FACT, DECLARED ONCE, AND THE RULE LINE READS IT.
 *
 * The architect's first finding: the fixture's `incident.no-run` printed
 * "Tier 1 · nothing is holding it back but you" while the fold ranked the same
 * row at tier 2 — the rule LINE and the RANK were two facts from two sources,
 * so every waiting row landed at 2, `rankSituations` fell through to `since`,
 * and the list degenerated to age order on the owner's real fleet.
 *
 * The fixture now declares `tier` as a NUMBER and writes the rule line with a
 * `{tier}` SLOT. The composer fills that slot from the tier the row was RANKED
 * at, and the ranker reads the declared number, so the displayed tier and the
 * sort key are the same value by construction rather than by agreement. This
 * function is the third guard on that: a template whose rule line does not
 * OPEN with its own tier slot is refused here, at build time, because a rule
 * line carrying a literal "Tier 2" would silently reintroduce the divergence
 * the slot exists to remove.
 */
const RULE_PREFIX = 'Tier {tier} · ';

/**
 * The literal tier a designer writes at the head of a rule line, and the
 * NORMALISATION that turns it into the slot.
 *
 * **WP-54's MERGE CHANGED WHERE THIS IS ENFORCED, and the change matters.** The
 * packet required the FIXTURE to carry `Tier {tier} · …`. The designer's
 * cycle-seven sheet instead writes the tier twice — as readable prose at the
 * head of the rule line AND as a numeric `tier` field — which is the two-sources
 * shape the packet exists to remove, arriving as data rather than as code.
 *
 * Editing the designer's prose to insert a brace would be a packet rewriting
 * ratified copy. So the generator MECHANISES the property instead: it asserts
 * the literal and the field agree, and emits the rule with the number replaced
 * by its slot. The fixture keeps the designer's own sentence, the module carries
 * one source, and a fixture whose two tiers disagree fails the build rather than
 * shipping a card that prints a tier nothing sorted by.
 */
const RULE_TIER = /^Tier (\d) · /;

/** The slots each non-template block may carry. Unfillable braces fail the build. */
const DOOR_SLOTS = ['checkpoint', 'target', 'agentId'] as const;
const ACCOUNTING_SLOTS = ['count'] as const;

/** Every door the fixture declares, and the one way back. */
const DOOR_KEYS = ['runAtGate', 'run', 'incident', 'agent', 'backToNow'] as const;

// --- WP-55 · the four blocks the cycle-seven sheet drew and nothing read ----

/** §5 · GROUPING, which is NOT coalescing. See `GROUP` in the fixture. */
const GROUP_KEYS = ['guard', 'label', 'limit'] as const;
const GROUP_SLOTS = ['memberCount', 'target'] as const;

/** §6 · the deferred state. Keeps its tier, keeps its place, lowers escalation. */
const DEFERRED_BLOCK_KEYS = ['rule', 'recorded', 'wake', 'endDoor'] as const;
const DEFERRED_BLOCK_SLOTS = ['tier', 'deferredAge', 'reason', 'wakeLabel'] as const;

/** §7 · the header. `awayGuard` and `accounting` are PROSE ABOUT the copy, not copy. */
const HEADER_KEYS = ['away'] as const;
const HEADER_SLOTS = ['age'] as const;

/**
 * The reserved row's own heading and its two lines.
 *
 * **`oldestAge` IS DELIBERATELY ABSENT FROM THIS LIST, and its absence is the
 * refusal.** See `DEFERRED_BLOCK_ENTRIES`.
 */
const HEALTH_KEYS = ['headingLoud', 'loud', 'quiet'] as const;
const HEALTH_SLOTS = ['darkCount', 'checkCount'] as const;

/**
 * WP-55 · BLOCK KEYS DECLARED AND NOT EMITTED, by name and reason — the
 * `DEFERRED_IDS` mechanism, one level down, and probed by the same rule.
 *
 * **`HEALTH.loud` reads `{oldestAge}` AND NO PRODUCER SUPPLIES IT.** Measured
 * rather than assumed: `reserved.dark` is built from health lines whose verdict
 * is `DARK`, and there are exactly four places `health.ts` writes that verdict —
 * `core` ("not started"), `producer:*` ("nothing yet"), `mirror` ("unavailable")
 * and `entities` ("unavailable"). **Not one of them carries a timestamp**, and
 * the producer lines cannot even reach the reserved row (`countsTowardWorst:
 * false` filters them out). A DARK line is one that has NEVER reported, so there
 * is no duration to put after it — which is the identical finding the ACCOUNTING
 * block already ruled on, in the designer's own words: *"a DARK producer is one
 * that has NEVER reported, so there is no duration to put after it, and the
 * designer's 'in 9 hours' would have to be invented."*
 *
 * So the sentence is REFUSED rather than filled. This is the designer's open
 * late-versus-dark question, and blocking it at the contract is what converts it
 * from an opinion into a fact: the answer is not "which reads better", it is
 * "the record does not hold an age for a thing that never reported". A LATE
 * producer does have one (`STALE`, with `last seen …`), and if the line is meant
 * to be about late rather than dark then it needs `staleCount` and a different
 * sentence — which is a decision for the designer, not a value for this file.
 *
 * `{darkCount}` and `{checkCount}` were checked the same way and both EXIST:
 * `ReservedRow.dark.length` and `ReservedRow.checkCount`. The second is derived
 * in this packet (the count of health lines that count toward the verdict); it
 * was not a producer that had to be invented, only one that had to be exposed.
 */
const DEFERRED_BLOCK_ENTRIES: Readonly<Record<string, string>> = {
  'health.loud':
    'it reads {oldestAge}, and no producer supplies one — every DARK health line means ' +
    '"has never reported", so it carries no timestamp and the duration would have to be invented',
};
/** Every colour. `tier4` is deliberately absent: tier 4 takes no stripe. */
const COLOUR_KEYS = ['tier1', 'tier2', 'tier3', 'link'] as const;
const RESERVED_KEYS = ['head', 'quiet'] as const;
const ACCOUNTING_KEYS = ['changed', 'dark'] as const;

/**
 * The fixture's own slot list, from its header comment, plus `runbookId` and
 * `producer` — which the templates' `meta` fields use and the header's list
 * omits (it enumerates the slots the HEADLINES take).
 *
 * This is the closed set the composer can fill. See the header for why a slot
 * outside it is a build failure rather than a rendered brace.
 */
export const KNOWN_SLOTS = [
  'runNoun', 'done', 'failed', 'total', 'age', 'checkpoint', 'position',
  'awaits', 'target', 'finding', 'agentId', 'timeout', 'runbookId', 'producer',
  // WP-54 · the rule line's own tier, filled from the RANKED tier. See
  // `RULE_PREFIX` for why the number is a slot rather than literal text.
  'tier',
  // WP-55 · THE COALESCED CLASS'S FOUR, derived in the fold and nowhere else.
  //
  //   leadFinding  the highest-severity member's subject line
  //   restCount    memberCount - 1
  //   memberCount  how many FINDINGS the situation folded — see
  //                `Situation.memberCount`; a finding opened and later amended
  //                is one finding with a history, not two
  //   linkKind     the record link that justified the fold, as a LABEL. The
  //                field on the contract stays the record noun (`correlation`);
  //                what is filled here is the word a person reads. See the fold.
  'leadFinding', 'restCount', 'memberCount', 'linkKind',
] as const;

/**
 * The LIST verdict's slots, which are a different set — it is a sentence about
 * the whole list and takes none of a row's fields. Validated separately for the
 * same reason the row slots are: an unfillable brace must fail the build, not
 * reach a customer as literal text.
 */
const VERDICT_SLOTS = ['needsYou', 'changedRuns'] as const;

// ---------------------------------------------------------------------------
// Reading the designer's file
// ---------------------------------------------------------------------------

/**
 * The fixture is a browser IIFE assigning `window.NEXUS_HEADLINES`.
 *
 * Run it, don't parse it — the same reason `generate-return-copy.ts` gives: the
 * file uses `’` escapes for its apostrophes and only the interpreter knows
 * those are one character.
 */
function readHeadlines(): Record<string, unknown> {
  const source = fs.readFileSync(fixturePath, 'utf-8');
  const sandbox: Record<string, unknown> = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: fixturePath });
  const headlines = (sandbox.window as Record<string, unknown>).NEXUS_HEADLINES;
  if (!headlines || typeof headlines !== 'object') {
    throw new Error(`${fixturePath} did not assign window.NEXUS_HEADLINES`);
  }
  return headlines as Record<string, unknown>;
}

/** Every `{slot}` a string carries, in order of appearance. */
function slotsIn(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]);
}

function requireString(source: Record<string, unknown>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw new Error(`${what} is missing "${key}"`);
  return value;
}

// ---------------------------------------------------------------------------
// The extraction
// ---------------------------------------------------------------------------

interface Template { [field: string]: string }

interface Extracted {
  runNoun: Record<string, string>;
  templates: Template[];
  /** `null` where the fixture declares the tier in prose — see the extractor. */
  tiers: Record<string, number | null>;
  verdict: { allUnwritten: string; someChanged: string };
  freshness: { now: string; then: string };
  doors: Record<string, string>;
  colours: Record<string, string>;
  reserved: Record<string, string>;
  accounting: Record<string, string>;
  /** WP-55 · the four blocks the cycle-seven sheet drew and nothing read. */
  group: Record<string, string>;
  deferred: Record<string, string>;
  header: Record<string, string>;
  health: Record<string, string>;
}


function extract(): Extracted {
  const h = readHeadlines();

  // --- the run-noun column (Controlled Vocabulary v1.4) --------------------
  const rawNoun = h.runNoun;
  if (!rawNoun || typeof rawNoun !== 'object') throw new Error('the fixture carries no runNoun column');
  const runNoun: Record<string, string> = {};
  for (const [capability, noun] of Object.entries(rawNoun as Record<string, unknown>)) {
    if (typeof noun !== 'string' || noun === '') {
      throw new Error(`the run noun for "${capability}" is not a string`);
    }
    runNoun[capability] = noun;
  }
  if (Object.keys(runNoun).length === 0) throw new Error('the runNoun column is empty');

  // --- the five templates, by id, in order ---------------------------------
  const rawTemplates = h.templates;
  if (!Array.isArray(rawTemplates)) throw new Error('the fixture carries no templates array');
  const ids = rawTemplates.map((t: Record<string, unknown>) => String((t && t.id) ?? ''));
  // Every ratified id present, IN ORDER, ignoring deferred classes interleaved
  // among them — the order is still the ratified artifact's and a reordered set
  // must reach a human, but a class the sheet draws ahead of the build does not
  // move the ones around it.
  const emitted = ids.filter((id) => !(id in DEFERRED_IDS));
  if (emitted.length !== RATIFIED_IDS.length || RATIFIED_IDS.some((id, i) => emitted[i] !== id)) {
    throw new Error(
      `the ratified template set changed — expected [${RATIFIED_IDS.join(', ')}], read [${emitted.join(', ')}]`,
    );
  }
  for (const [id, why] of Object.entries(DEFERRED_IDS)) {
    if (!ids.includes(id)) continue;
    process.stdout.write(`  deferred: "${id}" is declared and NOT emitted — ${why}\n`);
  }
  // WP-55 · shape #17, closed. The line above ANNOUNCES a skip; this REFUSES a
  // deferral that has outlived the condition it stated. See the function.
  assertDeferralsStillHold(DEFERRED_IDS, rawTemplates as Array<Record<string, unknown>>, KNOWN_SLOTS);

  // The ruled amendments, checked against the fixture as READ. See
  // `RULED_AMENDMENTS`: this is the check whose absence let two adjudicated
  // rulings be undone by a file copy.
  for (const rule of RULED_AMENDMENTS) {
    const template = (rawTemplates as Array<Record<string, unknown>>).find((t) => t && t.id === rule.id);
    if (!template) {
      throw new Error(
        `the ruled amendment for "${rule.id}" (${rule.ruledAt}) names a class the fixture no longer carries`,
      );
    }
    const value = String(template[rule.field] ?? '');
    if (rule.mustContain && !value.includes(rule.mustContain)) {
      throw new Error(
        `RULED AMENDMENT REVERTED — "${rule.id}" ${rule.field} no longer contains ` +
        `"${rule.mustContain}" (ruled at ${rule.ruledAt}): ${rule.why}`,
      );
    }
    if (rule.mustNotContain && value.includes(rule.mustNotContain)) {
      throw new Error(
        `RULED AMENDMENT REVERTED — "${rule.id}" ${rule.field} contains ` +
        `"${rule.mustNotContain}" again (ruled at ${rule.ruledAt}): ${rule.why}`,
      );
    }
  }

  const templates: Template[] = [];
  const tiers: Record<string, number | null> = {};
  for (const raw of rawTemplates as Array<Record<string, unknown>>) {
    if (String(raw.id ?? '') in DEFERRED_IDS) continue;
    const template: Template = {};
    for (const field of TEMPLATE_FIELDS) {
      const value = raw[field];
      // `chip` and `state` are legitimately empty on some classes — a template
      // whose chip is '' is one that carries no badge, which is a ratified
      // decision, not a missing field. Empty is allowed; absent is not.
      if (typeof value !== 'string') throw new Error(`template "${String(raw.id)}" is missing "${field}"`);
      template[field] = value;
    }
    // The optional fields, when the class declares them. A value that is
    // present must be a STRING — a class carrying `disclosure: 4` is a fixture
    // error, not an absent field — and absence emits `''`.
    for (const field of OPTIONAL_TEMPLATE_FIELDS) {
      const value = raw[field];
      if (value === undefined) { template[field] = ''; continue; }
      if (typeof value !== 'string') {
        throw new Error(`template "${String(raw.id)}" declares "${field}" as something other than a string`);
      }
      template[field] = CONTROL_TEMPLATE_FIELDS.includes(field) ? controlLabel(value) : value;
    }
    for (const field of ['headline', 'ask', 'meta', 'rule', ...OPTIONAL_TEMPLATE_FIELDS] as const) {
      for (const slot of slotsIn(template[field])) {
        if (!(KNOWN_SLOTS as readonly string[]).includes(slot)) {
          throw new Error(
            `template "${template.id}" field "${field}" carries the unknown slot "{${slot}}" — ` +
            'the composer has no host field to fill it from',
          );
        }
      }
    }

    // WP-54 · THE TIER IS ONE FACT, and this is where two become one.
    //
    // The designer's sheet writes the tier TWICE — as prose at the head of the
    // rule line and as a numeric field beside it. Both are ratified and neither
    // is edited here; what happens instead is a normalisation with an agreement
    // check, so the emitted module carries one source and the fixture keeps the
    // designer's own sentence.
    //
    // THREE OUTCOMES, and the third is the interesting one:
    //
    //  - a numeric tier whose rule line agrees → emitted with the number
    //    replaced by its `{tier}` slot, filled at compose time from the tier the
    //    row was RANKED at;
    //  - a numeric tier whose rule line DISAGREES → build failure, because a
    //    card would print a tier nothing sorted by, which is the defect measured
    //    on the owner's fleet;
    //  - a tier the fixture states in PROSE (`incident.coalesced`: *"the highest
    //    tier among the members"*) → emitted as `null`, meaning DERIVED. Its
    //    rule line is still slot-ified, so it prints whatever the fold ranked
    //    it at; there is simply no declaration to check that against, and
    //    inventing one would be the fabrication this file exists to refuse.
    const declared = raw.tier;
    const written = RULE_TIER.exec(template.rule);
    if (!written && !template.rule.startsWith(RULE_PREFIX)) {
      throw new Error(
        `template "${template.id}" rule line names no tier — expected "Tier N · …" or "${RULE_PREFIX}…"`,
      );
    }
    if (typeof declared === 'number') {
      if (!Number.isInteger(declared) || declared < 1 || declared > 4) {
        throw new Error(
          `template "${template.id}" declares tier ${String(declared)}, which the comparator cannot hold`,
        );
      }
      if (written && Number(written[1]) !== declared) {
        throw new Error(
          `template "${template.id}" declares tier ${declared} and its rule line prints ` +
          `Tier ${written[1]} — one rule, two sources, which is the defect this check exists to catch`,
        );
      }
      tiers[template.id] = declared;
    } else if (typeof declared === 'string' && declared.trim() !== '') {
      // A prose declaration is a DERIVED tier. Recorded as null rather than
      // refused: the fixture is telling the truth about a class whose tier is a
      // function of its members, and the fold is where that function lives.
      tiers[template.id] = null;
    } else {
      throw new Error(
        `template "${template.id}" declares no tier at all — the ranker has nothing to read`,
      );
    }
    // The rule line, normalised onto the slot. Idempotent: a line already
    // written with the slot passes through untouched.
    template.rule = written ? template.rule.replace(RULE_TIER, RULE_PREFIX) : template.rule;
    // Every door is a CONTROL, so every door passes the class rule.
    template.door = controlLabel(template.door);
    templates.push(template);
  }

  // --- the list verdict, and the freshness replacement ---------------------
  const rawVerdict = h.verdict;
  if (!rawVerdict || typeof rawVerdict !== 'object') throw new Error('the fixture carries no list verdict');
  const verdict = {
    allUnwritten: requireString(rawVerdict as Record<string, unknown>, 'allUnwritten', 'the list verdict'),
    someChanged: requireString(rawVerdict as Record<string, unknown>, 'someChanged', 'the list verdict'),
  };
  for (const [arm, sentence] of Object.entries(verdict)) {
    for (const slot of slotsIn(sentence)) {
      if (!(VERDICT_SLOTS as readonly string[]).includes(slot)) {
        throw new Error(
          `the list verdict's "${arm}" arm carries the unknown slot "{${slot}}" — ` +
          'the composer has no count to fill it from',
        );
      }
    }
  }

  const rawFreshness = h.freshness;
  if (!rawFreshness || typeof rawFreshness !== 'object') throw new Error('the fixture carries no freshness block');
  // WP-54's merge · `then` IS OPTIONAL NOW, and its absence changes nothing
  // rendered. The designer's cycle-seven sheet dropped it; `driftLine` composes
  // its second sentence from `RETURN_COPY.DRIFT_REST` (the RETURN generator's
  // copy of the same ratified sentence) and never read this one. What `then`
  // was actually for is the cross-generator AGREEMENT PIN — two extractors,
  // one sentence — so its absence costs that pin its anchor and nothing else.
  // Emitted as `''` rather than defaulted from the other generator: inventing a
  // value here would make this file the second source it exists to prevent.
  const thenValue = (rawFreshness as Record<string, unknown>).then;
  const freshness = {
    now: requireString(rawFreshness as Record<string, unknown>, 'now', 'the freshness block'),
    then: typeof thenValue === 'string' ? thenValue : '',
  };

  // --- WP-54's four blocks -------------------------------------------------
  //
  // Each is read the same way and refused the same way: the block must exist,
  // every key it is required to carry must be a string, and any `{slot}` in it
  // must be one the composer can fill. A block that is silently short is a hole
  // where a sentence belongs, which is the failure this whole generator exists
  // to make impossible.
  const doors = readBlock(h, 'doors', DOOR_KEYS, DOOR_SLOTS);
  // Every door is a CONTROL, so every door passes the class rule. See
  // `controlLabel`: the period the row door shipped with was appended by an
  // extraction, and this is the appender's counterpart on this generator.
  for (const key of Object.keys(doors)) doors[key] = controlLabel(doors[key]);

  const colours = readBlock(h, 'colours', COLOUR_KEYS, []);
  for (const [key, value] of Object.entries(colours)) {
    if (!/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(value)) {
      throw new Error(`the colour "${key}" is not an rgb() triple — read "${value}"`);
    }
  }

  const reserved = readBlock(h, 'reserved', RESERVED_KEYS, []);
  const accounting = readBlock(h, 'accounting', ACCOUNTING_KEYS, ACCOUNTING_SLOTS);

  // --- WP-55's four blocks -------------------------------------------------
  const group = readBlock(h, 'group', GROUP_KEYS, GROUP_SLOTS);
  const deferred = readBlock(h, 'deferred', DEFERRED_BLOCK_KEYS, DEFERRED_BLOCK_SLOTS);
  // `endDoor` is a CONTROL and takes the class rule, like every door.
  deferred.endDoor = controlLabel(deferred.endDoor);
  const header = readBlock(h, 'header', HEADER_KEYS, HEADER_SLOTS);
  const health = readBlock(h, 'health', HEALTH_KEYS, HEALTH_SLOTS);

  // WP-55 · DOOR_RULE IS LAW, NOT COPY — so it is mechanised as ASSERTIONS.
  //
  // Every value in that block is a sentence ABOUT the doors ("a door says where
  // it goes", "action blue rgb(0,107,214) — never brand green") rather than a
  // string any surface renders. Emitting them would put prose in a copy module
  // that nothing could ever print; checking them is what the block is actually
  // for, and it makes a ruling undoable-by-paste in the same way
  // `RULED_AMENDMENTS` does.
  assertDoorRule(h, colours, templates);

  return {
    runNoun, templates, tiers, verdict, freshness, doors, colours, reserved, accounting,
    group, deferred, header, health,
  };
}

/**
 * WP-55 · `DOOR_RULE`, MECHANISED. Ratified as law, so asserted rather than
 * emitted.
 *
 * The block's four values are statements ABOUT doors, not strings a surface
 * renders — so the honest way to "site DOOR_RULE as ratified" is to make each
 * one a build-time check. Each is the same kind of instrument as
 * `RULED_AMENDMENTS`: a ruling that would otherwise survive exactly as long as
 * the next person's memory.
 *
 *  - `noTerminalPunctuation` — already enforced for the CLASS by
 *    `controlLabel`; here the fixture's own declaration of it is checked, so a
 *    designer who set it false would fail the build rather than silently
 *    disagree with the code.
 *  - `color` — the door's colour is asserted to name `COLOURS.link`'s actual
 *    value. Two places state this colour and this is what pins them together;
 *    "action blue" drifting to brand green is precisely the failure the rule
 *    names.
 *  - `everyRowHasOne` — every ratified class declares a `door`. A class without
 *    one is a row with nowhere to go, which the rule forbids by name.
 */
function assertDoorRule(
  headlines: Record<string, unknown>,
  colours: Record<string, string>,
  templates: readonly Template[],
): void {
  const raw = headlines.doorRule;
  if (!raw || typeof raw !== 'object') throw new Error('the fixture carries no doorRule block');
  const rule = raw as Record<string, unknown>;

  if (rule.noTerminalPunctuation !== true) {
    throw new Error(
      'DOOR_RULE REVERSED — the fixture no longer declares `noTerminalPunctuation: true`. ' +
      'A control takes no terminal full stop; the period that shipped on the row door was ' +
      'APPENDED by an extraction, which is why the rule belongs to the class and not to a string.',
    );
  }
  const colour = String(rule.color ?? '');
  if (!colour.includes(colours.link)) {
    throw new Error(
      `DOOR_RULE DISAGREES WITH THE PALETTE — the door's colour is stated as "${colour}" ` +
      `and the link colour is "${colours.link}". A door is a link and reads as one; brand green ` +
      'is the product\'s own mark, not a destination.',
    );
  }
  for (const template of templates) {
    if (template.door === '') {
      throw new Error(
        `DOOR_RULE BROKEN — the class "${template.id}" declares no door. ` +
        `${String(rule.everyRowHasOne ?? 'every row has one')}`,
      );
    }
  }
}

/**
 * One named block of the fixture, with its keys required and its slots closed.
 *
 * `allowedSlots` is the CLOSED set for this block — a brace outside it is a
 * build failure, not a rendered `{newField}`. `[]` means the block's strings
 * take no substitution at all, which is itself an assertion worth failing on.
 */
function readBlock(
  headlines: Record<string, unknown>,
  name: string,
  keys: readonly string[],
  allowedSlots: readonly string[],
): Record<string, string> {
  const raw = headlines[name];
  if (!raw || typeof raw !== 'object') throw new Error(`the fixture carries no ${name} block`);
  const source = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = requireString(source, key, `the ${name} block`);
    const unfillable = slotsIn(value).filter((slot) => !allowedSlots.includes(slot));

    // WP-55 · A KEY MAY BE DEFERRED, by name and reason, exactly as a CLASS may
    // — and it is probed by the same rule. A deferred key is emitted as `''`,
    // so a consumer branches on presence and never renders a hole; and if every
    // slot it carries becomes fillable, the deferral has expired and the build
    // refuses rather than quietly keeping the sentence out of the product.
    const deferral = DEFERRED_BLOCK_ENTRIES[`${name}.${key}`];
    if (deferral !== undefined) {
      if (unfillable.length === 0) {
        throw new Error(
          `THE DEFERRAL OF "${name}.${key}" HAS EXPIRED and the sentence is still not emitted. ` +
          `It was deferred because: ${deferral}. Every slot it carries is now fillable, so the ` +
          `condition that justified the deferral has ended — delete the "${name}.${key}" entry ` +
          'from DEFERRED_BLOCK_ENTRIES. A deferral that outlives its own condition is a sentence ' +
          'the designer wrote and the product silently refuses to render.',
        );
      }
      process.stdout.write(
        `  deferred: "${name}.${key}" is declared and NOT emitted — ${deferral} ` +
        `(unfillable: ${unfillable.map((slot) => `{${slot}}`).join(', ')})\n`,
      );
      out[key] = '';
      continue;
    }

    if (unfillable.length > 0) {
      throw new Error(
        `the ${name} block's "${key}" carries the unknown slot "{${unfillable[0]}}" — ` +
        'the composer has no host field to fill it from',
      );
    }
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

/** JSON string escaping, then single quotes, to match the repo's lint rules. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function emit(): string {
  const {
    runNoun, templates, tiers, verdict, freshness, doors, colours, reserved, accounting,
    group, deferred, header, health,
  } = extract();
  const lines: string[] = [
    '/**',
    ' * GENERATED — DO NOT EDIT. `npm run fixtures:situation-copy`.',
    ' *',
    ' * WP-48 · the ratified Now sentence set, extracted verbatim from the designer\'s',
    ' * own file by `scripts/generate-situation-copy.ts`:',
    ' *',
    ' *   docs/intelligence/from-designer/fixtures/situation-headlines.js',
    ' *',
    ' * Editing this file by hand is the defect the generator exists to prevent: it',
    ' * would make the composer a SECOND place the ratified wording lives, free to',
    ' * drift from the file that ratified it. `npm run fixtures:situation-copy:check`',
    ' * fails closed on a stale copy.',
    ' *',
    ' * `{slot}` braces are HOST FIELD NAMES, filled by `sessionRegistry`\'s composer',
    ' * from values the fold already derived. Nothing in this file computes anything,',
    ' * which is the property that makes it copy rather than logic.',
    ' */',
    '',
    `export const SITUATION_COPY_SHAPE_VERSION = ${SHAPE_VERSION};`,
    '',
    '/**',
    ' * Controlled Vocabulary v1.4 — the run-noun column.',
    ' *',
    ' * A second column on the capability rows v1.3 ratified as LABELS: same',
    ' * referent, subject form. "Update plugins across sites" names an act and does',
    ' * not nominalise into a headline\'s subject; "A plugin update run" does.',
    ' */',
    'export const RUN_NOUN: Readonly<Record<string, string>> = {',
  ];
  for (const capability of Object.keys(runNoun).sort()) {
    lines.push(`  ${literal(capability)}: ${literal(runNoun[capability])},`);
  }
  lines.push(
    '};',
    '',
    '/** One ratified class: the guard that selects it, and every field it renders. */',
    'export interface SituationTemplate {',
    '  /** The class, as the designer names it. Reported on the row it composed. */',
    '  id: string;',
    '  /**',
    '   * The selecting condition, in the designer\'s own words.',
    '   *',
    '   * Carried as TEXT, never evaluated in production — a composer that ran a',
    '   * string from a file would be a code-execution surface in the main process.',
    '   * `situationHeadlines.test.ts` evaluates each of these over a shared case',
    '   * table and asserts the TypeScript selector agrees, which is this repo\'s',
    '   * established way of pinning two copies of one rule together',
    '   * (`resolveAgentCron`/`effectiveCadenceExpression`, `localDay`).',
    '   */',
    '  guard: string;',
    '  /** The verdict. World state first. */',
    '  headline: string;',
    '  /**',
    '   * WP-55 · THE SECOND HEADLINE, or empty where the class declares none.',
    '   *',
    '   * `incident.coalesced` is the only class with one, and its fixture states',
    '   * the guard beside it: *"no member carries a severity field, so no member',
    '   * can lead"*. A coalesced row whose members carry no severity has no',
    '   * consequential member to name, and this is what it says instead — the',
    '   * count and the target, which are facts it does hold. It is NOT a',
    '   * fallback for an unfillable `{target}`: both arms read `{target}`, so a',
    '   * group spanning two sites falls all the way through to the derived',
    '   * sentence, which is the honest answer for a row with no one place.',
    '   */',
    '  headlineFallback: string;',
    '  /**',
    '   * WP-55 · THE PARTS DISCLOSURE, closed and open, or empty.',
    '   *',
    '   * A part is a LINE INSIDE THE CARD — no stripe, no chip, no ask, no gate.',
    '   * Closed by default and opening IN PLACE rather than through the door,',
    '   * because someone checking whether a verdict is true should not have to',
    '   * leave the list to do it. Both are controls and carry no terminal',
    '   * period, enforced for the class by `controlLabel`.',
    '   */',
    '  disclosure: string;',
    '  disclosureOpen: string;',
    '  /** What is being asked of the reader, and what stopping costs. */',
    '  ask: string;',
    '  /**',
    '   * ONE WORD, or empty. A badge never carries a sentence.',
    '   *',
    '   * ALWAYS EMPTY SINCE WP-54: the Waiting chip was cut as the designer\'s own',
    '   * template error — chip-presence told the user which of OUR code paths ran —',
    '   * and the cycle-seven sheet carries no chip on any class. The field survives',
    '   * so every consumer is unchanged; a class that wants a badge again declares',
    '   * one in the fixture and this stops being a constant.',
    '   */',
    '  chip: string;',
    '  /**',
    '   * THE ROW\'S DOOR, and it names where it goes.',
    '   *',
    '   * "Open where you are needed" was ratified and failed its first contact with',
    '   * a person. `{slot}` braces are filled by the same composer that fills a',
    '   * headline\'s, and no door carries a terminal full stop — enforced for the',
    '   * class in `scripts/control-label.ts`, because the period that shipped was',
    '   * APPENDED by an extraction rather than written by anyone.',
    '   */',
    '  door: string;',
    '  /** A status phrase for the meta line, or empty. */',
    '  state: string;',
    '  /** The meta line\'s identifier slot. */',
    '  meta: string;',
    '  /** The tier and why, in the designer\'s words. See the composer for why the',
    '   * rendered rule line reads this on a ratified card (WP-52 item 3) and',
    '   * `Situation.tierReason` on a derived one. The tier itself is the `{tier}`',
    '   * SLOT, filled from the tier the row was RANKED at — see `tier` below. */',
    '  rule: string;',
    '  /**',
    '   * WP-54 · THE CONSEQUENCE TIER THIS CLASS RANKS AT, declared once.',
    '   *',
    '   * The ranker reads this and the rule line renders the ranked value into its',
    '   * own `{tier}` slot, so the tier a card DISPLAYS is the tier it was SORTED',
    '   * BY — not by agreement between two derivations, but because there is one',
    '   * number. The generator refuses a template whose rule line does not open',
    '   * with that slot, which is what stops a literal tier creeping back in.',
    '   */',
    '  tier: number | null;',
    '}',
    '',
    '/**',
    ' * The five classes, IN THE FIXTURE\'S OWN ORDER.',
    ' *',
    ' * Selection is first-match, but the five guards are MUTUALLY EXCLUSIVE — no',
    ' * input satisfies two, which `situationHeadlines.test.ts` proves by brute',
    ' * force over the whole domain rather than by inspection. So the order does',
    ' * not change which sentence a row gets. The generator refuses to emit a',
    ' * reordered set anyway, because this array is the ratified artifact and a',
    ' * change to it must reach a human rather than regenerate in silence.',
    ' */',
    'export const SITUATION_TEMPLATES: readonly SituationTemplate[] = [',
  );
  for (const template of templates) {
    lines.push('  {');
    for (const field of TEMPLATE_FIELDS) lines.push(`    ${field}: ${literal(template[field])},`);
    for (const field of OPTIONAL_TEMPLATE_FIELDS) lines.push(`    ${field}: ${literal(template[field])},`);
    // See `SituationTemplate.chip`: no ratified class declares one any more.
    lines.push(`    chip: ${literal('')},`);
    lines.push(`    tier: ${tiers[template.id] === null ? 'null' : String(tiers[template.id])},`);
    lines.push('  },');
  }
  lines.push(
    '];',
    '',
    '/**',
    ' * The list verdict — one sentence about the whole list, which no single row',
    ' * can say. Derived from the same rows the columns render, so it structurally',
    ' * cannot disagree with them.',
    ' */',
    'export const LIST_VERDICT = {',
    `  allUnwritten: ${literal(verdict.allUnwritten)},`,
    `  someChanged: ${literal(verdict.someChanged)},`,
    '} as const;',
    '',
    '/**',
    ' * The freshness line. `now` replaces the packet-authored paragraph that',
    ' * explained the pipeline to a customer; `then` is the designer\'s existing',
    ' * second sentence, which follows it unchanged.',
    ' */',
    'export const FRESHNESS = {',
    `  now: ${literal(freshness.now)},`,
    `  then: ${literal(freshness.then)},`,
    '} as const;',
    '',
    '/**',
    ' * WP-54 · THE DOORS. Every row has one, and every one names where it goes.',
    ' *',
    ' * "Open where you are needed" was ratified and failed its first contact with',
    ' * a person. These name the destination from a fact the row already carries,',
    ' * so a reader knows what the click costs before making it. `{slot}` braces',
    ' * are filled by the same composer that fills a headline\'s.',
    ' *',
    ' * NONE CARRIES A TERMINAL FULL STOP, and that is enforced in the generator',
    ' * for the class rather than checked for these five: the period that shipped',
    ' * was APPENDED by an extraction, so a door added tomorrow would have taken',
    ' * one too.',
    ' */',
    'export const DOORS = {',
  );
  for (const key of DOOR_KEYS) lines.push(`  ${key}: ${literal(doors[key])},`);
  lines.push(
    '} as const;',
    '',
    '/**',
    ' * WP-54 · THE SEVERITY STRIPE\'S COLOURS, and the door\'s.',
    ' *',
    ' * Three pixels on a row\'s left edge: red at tier 1, orange at tier 2, grey at',
    ' * tier 3. **There is no tier-4 colour and that is the ratified encoding** —',
    ' * tier 4 takes no stripe, because the section it renders in already says what',
    ' * it is. The guard that rides with the stripe: it encodes TIER and must never',
    ' * drift into a severity scale.',
    ' *',
    ' * `link` is the door\'s colour. A door is a link; brand green is the product\'s',
    ' * own mark and not a destination.',
    ' */',
    'export const COLOURS = {',
  );
  for (const key of COLOUR_KEYS) lines.push(`  ${key}: ${literal(colours[key])},`);
  lines.push(
    '} as const;',
    '',
    '/**',
    ' * WP-54 · THE RESERVED ROW, IN THE USER\'S WORDS.',
    ' *',
    ' * "Reserved · the record\'s own health" was our noun for a thing the user',
    ' * recognises as "is the platform watching my sites". The row\'s purpose is',
    ' * untouched — XD-23\'s guaranteed seat, one row, unable to grow or be',
    ' * scrolled away — and only its name and its good-news line changed.',
    ' */',
    'export const RESERVED = {',
  );
  for (const key of RESERVED_KEYS) lines.push(`  ${key}: ${literal(reserved[key])},`);
  lines.push(
    '} as const;',
    '',
    '/**',
    ' * WP-54 · THE ACCOUNTING CLAUSES, each rendered only when its count is real.',
    ' *',
    ' * The needs-you count is NOT here: it is the verdict\'s, stated once. A zero',
    ' * is never enumerated — "0 checks dark" was contradicted two lines below by',
    ' * the reserved row saying nothing was dark.',
    ' */',
    'export const ACCOUNTING = {',
  );
  for (const key of ACCOUNTING_KEYS) lines.push(`  ${key}: ${literal(accounting[key])},`);
  lines.push(
    '} as const;',
    '',
    '/**',
    ' * WP-55 · GROUPING — XD-28, AND IT IS NOT COALESCING.',
    ' *',
    ' * A shared field is a fact; a shared cause is a verdict. Where the record',
    ' * does not link the members they stay SEPARATE ROWS under a label, and the',
    ' * label states the limit.',
    ' *',
    ' * **THE LABEL IS NOT A CARD: no border, no fill, no stripe, no door.** That',
    ' * is the whole visual difference and it must read without the words —',
    ' * coalescing produces one bordered object, grouping produces several under a',
    ' * caption. `guard` is carried as TEXT, like a template\'s, so the rule the',
    ' * surface implements and the rule the designer wrote stay one sentence.',
    ' */',
    'export const GROUP = {',
  );
  for (const key of GROUP_KEYS) lines.push(`  ${key}: ${literal(group[key])},`);
  lines.push(
    '} as const;',
    '',
    '/**',
    ' * WP-55 · THE DEFERRED STATE. Cycle two, ratified.',
    ' *',
    ' * Keeps its tier, keeps its place, lowers escalation ONLY. It does not leave',
    ' * the list — leaving is a dismissal by another name. Dimmed, out of the',
    ' * badge, reason and wake condition on the row.',
    ' *',
    ' * `rule` REPLACES the class\'s rule line while a deferral stands, and it',
    ' * carries the same `{tier}` slot for the same reason: the tier a card shows',
    ' * is the tier it was sorted by, and a deferral changes neither.',
    ' *',
    ' * `endDoor` is a control and carries no terminal period.',
    ' */',
    'export const DEFERRED = {',
  );
  for (const key of DEFERRED_BLOCK_KEYS) lines.push(`  ${key}: ${literal(deferred[key])},`);
  lines.push(
    '} as const;',
    '',
    '/**',
    ' * WP-55 · THE HEADER. An absence of zero is not an absence.',
    ' *',
    ' * `away` renders only when the gap is an hour or more; otherwise the header',
    ' * is the product name alone. The fixture\'s `awayGuard` and `accounting`',
    ' * keys are PROSE ABOUT this copy rather than copy, so they are not emitted —',
    ' * the guard is implemented in the surface and the accounting rule is already',
    ' * enforced by `ACCOUNTING`\'s own clauses.',
    ' */',
    'export const HEADER = {',
  );
  for (const key of HEADER_KEYS) lines.push(`  ${key}: ${literal(header[key])},`);
  lines.push(
    '} as const;',
    '',
    '/**',
    ' * WP-55 · THE RESERVED ROW\'S HEADING AND ITS TWO LINES.',
    ' *',
    ' * **`loud` IS EMPTY, AND THAT IS A REFUSAL RATHER THAN AN OMISSION.** The',
    ' * designer\'s sentence reads "{darkCount} checks haven\'t reported in',
    ' * {oldestAge}", and no producer supplies an `{oldestAge}`: every DARK health',
    ' * line means "has never reported" and therefore carries no timestamp, so the',
    ' * duration would have to be invented. The generator names the refusal and',
    ' * its reason in its build output, and it will FAIL the build if the slot',
    ' * ever becomes fillable and the sentence is still withheld.',
    ' *',
    ' * A consumer must branch on the empty string and use its own derived line —',
    ' * `ReservedRow.headline`, which states the count and stops.',
    ' */',
    'export const HEALTH = {',
  );
  for (const key of HEALTH_KEYS) lines.push(`  ${key}: ${literal(health[key])},`);
  lines.push('} as const;', '');
  return lines.join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const outAt = argv.indexOf('--out');
  const out = outAt >= 0 ? path.resolve(argv[outAt + 1]) : OUT_FILE;

  const fixtureAt = argv.indexOf('--fixture');
  if (fixtureAt >= 0) fixturePath = path.resolve(argv[fixtureAt + 1]);

  const next = emit();

  if (check) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf-8') : '';
    if (current !== next) {
      process.stderr.write(
        `${path.relative(REPO_ROOT, out)} is STALE — run \`npm run fixtures:situation-copy\`.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${path.relative(REPO_ROOT, out)} is up to date.\n`);
    return;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, next, 'utf-8');
  // WP-50: `next.length` is UTF-16 CODE UNITS, not bytes — this line said
  // "bytes" and printed characters, and the copy modules are full of em dashes
  // and `§`, so the two differ by 18 on this one file alone. A receipt-printing
  // tool that names the wrong unit produces a wrong receipt every time someone
  // pastes it, and one already reached the record (WP-48's gate report).
  // "Arithmetic in one named unit" applies to the tool as well as the report.
  process.stdout.write(
    `wrote ${path.relative(REPO_ROOT, out)} (${Buffer.byteLength(next, 'utf-8')} bytes)\n`,
  );
}

if (require.main === module) main();
