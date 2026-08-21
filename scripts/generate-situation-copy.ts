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
const SHAPE_VERSION = 2;

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

/** Every STRING field a template must carry. A missing one is a hole, not a default. */
const TEMPLATE_FIELDS = ['id', 'guard', 'headline', 'ask', 'chip', 'state', 'meta', 'rule'] as const;

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
  tiers: Record<string, number>;
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
  const ids = rawTemplates.map((t: Record<string, unknown>) => t && t.id);
  if (ids.length !== RATIFIED_IDS.length || RATIFIED_IDS.some((id, i) => ids[i] !== id)) {
    throw new Error(
      `the ratified template set changed — expected [${RATIFIED_IDS.join(', ')}], read [${ids.join(', ')}]`,
    );
  }

  const templates: Template[] = [];
  const tiers: Record<string, number> = {};
  for (const raw of rawTemplates as Array<Record<string, unknown>>) {
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

    // WP-54 · the tier, declared as a number and OPENING its own rule line.
    // Two refusals, and they are the same refusal read from both ends: a
    // template with no declared tier has nothing for the ranker to read, and a
    // rule line that does not open with `Tier {tier} · ` is a rule line free to
    // print a tier the row was not sorted by — which is the defect measured on
    // the owner's fleet, where four Tier-1 findings rendered below a Tier-2
    // backup step because the number in the copy and the number in the
    // comparator were two facts.
    const tier = raw.tier;
    if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 1 || tier > 4) {
      throw new Error(
        `template "${template.id}" declares no integer tier in 1..4 — the ranker has nothing to read`,
      );
    }
    if (!template.rule.startsWith(RULE_PREFIX)) {
      throw new Error(
        `template "${template.id}" rule line does not open with "${RULE_PREFIX}" — ` +
        'a literal tier in the rule line is a second source for the tier',
      );
    }
    tiers[template.id] = tier;
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
  const freshness = {
    now: requireString(rawFreshness as Record<string, unknown>, 'now', 'the freshness block'),
    then: requireString(rawFreshness as Record<string, unknown>, 'then', 'the freshness block'),
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
    '  /** ONE WORD, or empty. A badge never carries a sentence. */',
    '  chip: string;',
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
    '  tier: number;',
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
    lines.push(`    tier: ${tiers[template.id]},`);
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
