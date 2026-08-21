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
const SHAPE_VERSION = 1;

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

/** Every field a template must carry. A missing one is a hole, not a default. */
const TEMPLATE_FIELDS = ['id', 'guard', 'headline', 'ask', 'chip', 'state', 'meta', 'rule'] as const;

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
  verdict: { allUnwritten: string; someChanged: string };
  freshness: { now: string; then: string };
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
    for (const field of ['headline', 'ask', 'meta'] as const) {
      for (const slot of slotsIn(template[field])) {
        if (!(KNOWN_SLOTS as readonly string[]).includes(slot)) {
          throw new Error(
            `template "${template.id}" field "${field}" carries the unknown slot "{${slot}}" — ` +
            'the composer has no host field to fill it from',
          );
        }
      }
    }
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

  return { runNoun, templates, verdict, freshness };
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

/** JSON string escaping, then single quotes, to match the repo's lint rules. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function emit(): string {
  const { runNoun, templates, verdict, freshness } = extract();
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
    '   * `Situation.tierReason` on a derived one. */',
    '  rule: string;',
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
  );
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
