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
const SHAPE_VERSION = 3;

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
  'incident.coalesced':
    'its headline slots ({leadFinding}, {restCount}, {memberCount}, {linkKind}) are host fields ' +
    'nothing derives yet — WP-55 adds them, and the class is emitted on the same visit',
};

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
const KNOWN_SLOTS = [
  'runNoun', 'done', 'failed', 'total', 'age', 'checkpoint', 'position',
  'awaits', 'target', 'finding', 'agentId', 'timeout', 'runbookId', 'producer',
  // WP-54 · the rule line's own tier, filled from the RANKED tier. See
  // `RULE_PREFIX` for why the number is a slot rather than literal text.
  'tier',
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
    for (const field of ['headline', 'ask', 'meta', 'rule'] as const) {
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

  return { runNoun, templates, tiers, verdict, freshness, doors, colours, reserved, accounting };
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
    for (const slot of slotsIn(value)) {
      if (!allowedSlots.includes(slot)) {
        throw new Error(
          `the ${name} block's "${key}" carries the unknown slot "{${slot}}" — ` +
          'the composer has no host field to fill it from',
        );
      }
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
  const { runNoun, templates, tiers, verdict, freshness, doors, colours, reserved, accounting } = extract();
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
