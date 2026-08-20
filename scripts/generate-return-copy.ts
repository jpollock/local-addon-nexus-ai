/**
 * WP-46 · THE RATIFIED RETURN COPY — extracted, never retyped.
 *
 * XD-26 ratified a set of exact strings for M6 (the 6c unknown-arm block, the
 * changed column's provenance line, the column heads, the door, the standing
 * approval's sentence, the accounting line's phrasing, the drift line). They
 * live in two places the designer owns and this packet does not:
 *
 *   docs/intelligence/from-designer/fixtures/scenario-return.js
 *   docs/intelligence/from-designer/from-designer-09-return-arrival.md
 *
 * A surface that RETYPES them is a second place the ratified wording can be
 * wrong, which is the XD-16 defect wearing a copy deck. So this generator reads
 * both, pulls each string by an anchor that cannot match a paraphrase, and emits
 * one TypeScript module the renderer imports. Nothing here composes prose; every
 * exported value is a substring of a designer file, or a mechanical split of one.
 *
 * THE SPLITS ARE MECHANICAL, and that is the whole reason they are here rather
 * than in the component. Three ratified sentences carry a SCENARIO value inside
 * them — "12 hours", "yesterday, 12:11", "41" — and the product must substitute
 * a derived one. Splitting the ratified sentence ON its own scenario value
 * yields a prefix and a suffix that are still verbatim designer bytes; typing
 * the template out by hand would not be. Where a split cannot be anchored on a
 * value the fixture also carries independently, it is anchored on the first
 * whitespace-delimited token, which is the count token in every case.
 *
 * DETERMINISTIC BY CONSTRUCTION: no clock, no randomness, no absolute paths.
 * Running it twice on an unchanged tree produces a byte-identical file.
 *
 *   npx ts-node scripts/generate-return-copy.ts
 *   npx ts-node scripts/generate-return-copy.ts --check       # CI/no-write
 *   npx ts-node scripts/generate-return-copy.ts --out <path>  # write elsewhere
 *
 * `--out` exists for the same reason WP-34's generator has one: PARALLEL_
 * PROTOCOL's poisoned-fixture rule. A mutation battery over this script must
 * never be able to leave its output on the tracked artifact.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_JS = path.join(
  REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'fixtures', 'scenario-return.js',
);
const SHEET_MD = path.join(
  REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'from-designer-09-return-arrival.md',
);
const OUT_FILE = path.join(
  REPO_ROOT, 'src', 'renderer', 'components', 'return', 'returnCopy.generated.ts',
);

/** The inputs actually read. Overridable by `--sheet` / `--fixture`; see `main`. */
let sheetPath = SHEET_MD;
let fixturePath = FIXTURE_JS;

/** Bumped when the SHAPE changes, so a consumer can tell that from a content change. */
const SHAPE_VERSION = 1;

// ---------------------------------------------------------------------------
// Reading the designer's two files
// ---------------------------------------------------------------------------

/**
 * The scenario fixture is a browser IIFE assigning `window.NEXUS_RETURN`.
 *
 * Run it, don't parse it: a regex over JS source would go wrong on the exact
 * thing that matters here — the file uses `’` escapes for its apostrophes,
 * and only the interpreter knows those are one character.
 */
function readScenario(): any {
  const source = fs.readFileSync(fixturePath, 'utf-8');
  const sandbox: any = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: fixturePath });
  const scenario = sandbox.window.NEXUS_RETURN;
  if (!scenario) throw new Error(`${fixturePath} did not assign window.NEXUS_RETURN`);
  return scenario;
}

/**
 * One string from the sheet, by an anchor.
 *
 * Fails loudly rather than returning an empty string: an anchor that stops
 * matching means the designer moved the sentence, and a generator that silently
 * emits `''` would ship a surface with a blank where a ratified line belongs.
 */
function fromSheet(md: string, re: RegExp, what: string): string {
  const m = md.match(re);
  if (!m || !m[1]) throw new Error(`anchor for "${what}" no longer matches ${sheetPath}`);
  return m[1].trim();
}

/** Everything up to and including the first whitespace-delimited token, removed. */
function dropCountToken(sentence: string, what: string): string {
  const m = sentence.match(/^\S+\s+([\s\S]*)$/);
  if (!m) throw new Error(`"${what}" has no count token to drop`);
  return m[1];
}

/**
 * Split a ratified sentence around the SPAN its scenario moment occupies.
 *
 * The fixture's `when` is `yesterday, 12:11` and the sentence says `yesterday at
 * 12:11` — the same moment, punctuated for prose. So the span is located from
 * the moment's own PARTS rather than from its formatted whole: first part's
 * index to last part's end. Nothing about the sentence is assumed beyond the
 * parts appearing in order, and a sentence that stops containing them throws
 * rather than emitting a template with the moment baked in.
 */
function splitAroundMoment(
  sentence: string,
  parts: readonly string[],
  what: string,
): { before: string; after: string } {
  let cursor = 0;
  let start = -1;
  let end = -1;
  for (const part of parts) {
    const at = sentence.indexOf(part, cursor);
    if (at < 0) throw new Error(`"${what}" does not contain the moment part "${part}"`);
    if (start < 0) start = at;
    end = at + part.length;
    cursor = end;
  }
  return { before: sentence.slice(0, start), after: sentence.slice(end) };
}

// ---------------------------------------------------------------------------
// The extraction
// ---------------------------------------------------------------------------

interface Extracted {
  [key: string]: string;
}

function extract(): { values: Extracted; separator: string } {
  const s = readScenario();
  const md = fs.readFileSync(sheetPath, 'utf-8');

  // --- 6c · the unknown arm. Four strings, verbatim, no substitution. -------
  const unknownArm = s.unknownArm;

  // --- the two column heads and the reserved head --------------------------
  const waitingHead = fromSheet(md, /^\*\*(Waiting on you)\*\*$/m, 'the waiting column head');
  const changedHead = fromSheet(md, /^\*\*(Changed while you were away)\*\*/m, 'the changed column head');

  // --- the door, and the changed column's provenance line -------------------
  const door = fromSheet(md, /Door: \*([^*]+)\*/, 'the waiting row door');
  const filed = fromSheet(md, /Beneath it: "([^"]+)"/, 'the changed column provenance line');

  // --- the away headline: "You were away 12 hours" --------------------------
  // Split on the digits so the unit stays the designer's word, not ours.
  const awayMatch = String(s.away).match(/^([\s\S]*?)(\d+)\s+(\S+)([\s\S]*)$/);
  if (!awayMatch) throw new Error('the away headline carries no number to substitute');

  // --- the accounting line: three segments, each "<count> <phrase>" ---------
  const separator = ' · ';
  const segments = String(s.accounting).split(separator);
  if (segments.length !== 3) {
    throw new Error(`the accounting line split into ${segments.length} segments, expected 3`);
  }

  // --- the standing approval, split on the moment the fixture carries -------
  const standing = splitAroundMoment(
    String(s.session.gaveBefore.text),
    String(s.session.gaveBefore.when).split(', '),
    'the standing approval sentence',
  );

  // --- the waiting row's gate line, split into its connectives ------------
  // 'Waiting at cp.approval — 3 of 8 in remediate'. Every word of it is the
  // designer's; every value in it is the registry's `PendingGate`.
  const gateSample = String(s.waiting[1].gate);
  const gateMatch = gateSample.match(/^([\s\S]*?)cp\.\S+( [^\d]+ )(\d+)( of )(\d+)( in )/);
  if (!gateMatch) throw new Error(`the gate line "${gateSample}" no longer parses into its parts`);

  // --- the re-entry's two block heads, and the opened line's prefix --------
  const standingHead = fromSheet(md, /\*\*(The standing approval)\*\*/, 'the standing approval block head');
  const gateHead = fromSheet(md, /\*\*(The gate now)\*\*/, 'the gate block head');
  const openedMatch = String(s.session.opened).match(/^(\S+\s+)/);
  if (!openedMatch) throw new Error('the opened line has no prefix token');

  // --- the drift line: a counted first sentence, then a verbatim remainder --
  const driftParts = String(s.drift).split('. ');
  if (driftParts.length < 2) throw new Error('the drift line has no sentence boundary to split on');
  const driftCounted = dropCountToken(`${driftParts[0]}.`, 'the drift line');
  const driftRest = driftParts.slice(1).join('. ');

  return {
    separator,
    values: {
      UNKNOWN_ARM_LEAD: String(unknownArm.lead),
      UNKNOWN_ARM_BODY: String(unknownArm.body),
      UNKNOWN_ARM_DOOR: String(unknownArm.door),
      UNKNOWN_ARM_OFFER: String(unknownArm.offer),

      WAITING_HEAD: waitingHead,
      CHANGED_HEAD: changedHead,
      RESERVED_HEAD: String(s.reserved.rule),

      ROW_DOOR: door,
      FILED_BEFORE_YOU_ARRIVED: filed,

      AWAY_PREFIX: awayMatch[1],
      AWAY_UNIT: awayMatch[3],
      AWAY_SUFFIX: awayMatch[4],

      ACCOUNTING_NEEDS_YOU: dropCountToken(segments[0], 'the accounting line, segment 1'),
      ACCOUNTING_CHANGED: dropCountToken(segments[1], 'the accounting line, segment 2'),
      ACCOUNTING_DARK: dropCountToken(segments[2], 'the accounting line, segment 3'),

      STANDING_APPROVAL_PREFIX: standing.before,
      STANDING_APPROVAL_SUFFIX: standing.after,

      RESUMED: String(s.session.resumed),

      GATE_PREFIX: gateMatch[1],
      GATE_POSITION_SEP: gateMatch[2],
      GATE_OF: gateMatch[4],
      GATE_IN: gateMatch[6],

      PARTS_CHIP: dropCountToken(String(s.waiting[0].parts), 'the situation parts chip'),

      REENTRY_STANDING_HEAD: standingHead,
      REENTRY_GATE_HEAD: gateHead,
      OPENED_PREFIX: openedMatch[1],

      DRIFT_COUNTED: driftCounted,
      DRIFT_REST: driftRest,
    },
  };
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

/** JSON string escaping, then single quotes, to match the repo's lint rules. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function emit(): string {
  const { values, separator } = extract();
  const keys = Object.keys(values).sort();
  const lines: string[] = [
    '/**',
    ' * GENERATED — DO NOT EDIT. `npm run fixtures:return-copy`.',
    ' *',
    ' * WP-46 · the ratified M6 copy (XD-26), extracted verbatim from the designer\'s',
    ' * own files by `scripts/generate-return-copy.ts`. Every string below is a',
    ' * substring of one of these two, or a mechanical split of one:',
    ' *',
    ' *   docs/intelligence/from-designer/fixtures/scenario-return.js',
    ' *   docs/intelligence/from-designer/from-designer-09-return-arrival.md',
    ' *',
    ' * Editing this file by hand is the defect the generator exists to prevent: it',
    ' * would make the surface a SECOND place the ratified wording lives, free to',
    ' * drift from the sheet that ratified it. `npm run fixtures:return-copy:check`',
    ' * fails closed on a stale copy.',
    ' *',
    ' * The `_PREFIX`/`_SUFFIX` pairs are ratified sentences split on the SCENARIO',
    ' * value they carry ("12 hours", "yesterday, 12:11", "41"), so the product can',
    ' * substitute a derived one without any of the designer\'s words being retyped.',
    ' */',
    '',
    `export const RETURN_COPY_SHAPE_VERSION = ${SHAPE_VERSION};`,
    '',
    '/** The vocabulary\'s own separator, as the accounting line uses it. */',
    `export const SEP = ${literal(separator)};`,
    '',
    'export const RETURN_COPY = {',
  ];
  for (const key of keys) lines.push(`  ${key}: ${literal(values[key])},`);
  lines.push('} as const;', '');
  return lines.join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const outAt = argv.indexOf('--out');
  const out = outAt >= 0 ? path.resolve(argv[outAt + 1]) : OUT_FILE;

  // `--sheet` / `--fixture` override the INPUTS. They exist for one caller: the
  // test that drives an anchor MISS. `fromSheet` throws rather than emitting a
  // blank when the designer moves a ratified line, and that guard is
  // unreachable while both files are intact — so the test hands the generator a
  // copy with the anchor removed and asserts it exits loudly. A guard nothing
  // can reach is a guard nothing can check.
  const sheetAt = argv.indexOf('--sheet');
  const fixtureAt = argv.indexOf('--fixture');
  if (sheetAt >= 0) sheetPath = path.resolve(argv[sheetAt + 1]);
  if (fixtureAt >= 0) fixturePath = path.resolve(argv[fixtureAt + 1]);

  const next = emit();

  if (check) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf-8') : '';
    if (current !== next) {
      process.stderr.write(
        `${path.relative(REPO_ROOT, out)} is STALE — run \`npm run fixtures:return-copy\`.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${path.relative(REPO_ROOT, out)} is up to date.\n`);
    return;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, next, 'utf-8');
  process.stdout.write(`wrote ${path.relative(REPO_ROOT, out)} (${next.length} bytes)\n`);
}

if (require.main === module) main();
