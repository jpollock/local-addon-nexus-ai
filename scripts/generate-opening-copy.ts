/**
 * WP-49 · THE PANEL'S OPENING STATE AND THE NOW SCREEN'S CHROME — extracted,
 * never retyped.
 *
 * The third member of the situation-headlines generator family
 * (`generate-situation-copy.ts`, `generate-return-copy.ts`). Where those two
 * extract the ROW's sentences, this one extracts the strings item 4 and item 5
 * of the addon audit put around them: the docked panel's opening asks, the
 * scope line beneath its composer, the Nothing-needed-of-you section head, and
 * the two in-place answers the Inbox cards give up when they collapse onto the
 * rows.
 *
 * The source is ONE file the designer owns and this packet does not:
 *
 *   docs/intelligence/from-designer/from-designer-11-now-screen.md
 *
 * Every exported value below is a substring of that file, or a mechanical split
 * of one on a value the specimen carries. Nothing here composes prose. A
 * sentence this generator cannot extract is NOT quietly written here — it is
 * authored in `openingAsksModel.ts`'s `AUTHORED` object, where a gate report can
 * pull every one of them out mechanically, which is the copy discipline's own
 * rule (`arrivalModel.ts`).
 *
 * WHAT IT REFUSES TO EMIT, loudly, rather than shipping a hole:
 *
 *  - a sheet whose §5 no longer carries three opening-ask bullets
 *  - a sheet whose scope line no longer carries its two emphasised spans
 *  - an ask specimen that no longer contains the value the template splits on
 *  - any anchor that stops matching at all
 *
 * `fromSheet` throws on a miss for `generate-return-copy.ts`'s reason: a
 * generator that silently emitted `''` would ship a surface with a blank where a
 * ratified line belongs, and the blank is invisible in review.
 *
 * DETERMINISTIC BY CONSTRUCTION: no clock, no randomness, no absolute paths.
 * Running it twice on an unchanged tree produces a byte-identical file.
 *
 *   npx ts-node scripts/generate-opening-copy.ts
 *   npx ts-node scripts/generate-opening-copy.ts --check       # CI/no-write
 *   npx ts-node scripts/generate-opening-copy.ts --out <path>  # write elsewhere
 *   npx ts-node scripts/generate-opening-copy.ts --sheet <path>
 *
 * `--out` exists for PARALLEL_PROTOCOL's poisoned-fixture rule (WP-32): a
 * mutation battery over this script must never be able to leave its output on
 * the tracked artifact. `--sheet` overrides the INPUT, for the tests that drive
 * the refusals above — a guard nothing can reach is a guard nothing can check.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SHEET_MD = path.join(
  REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'from-designer-11-now-screen.md',
);
const OUT_FILE = path.join(
  REPO_ROOT, 'src', 'renderer', 'components', 'DockedPanel', 'openingCopy.generated.ts',
);

/** The input actually read. Overridable by `--sheet`; see `main`. */
let sheetPath = SHEET_MD;

/** Bumped when the SHAPE changes, so a consumer can tell that from a content change. */
const SHAPE_VERSION = 1;

/**
 * The one ask specimen that TEMPLATES MECHANICALLY, and the value it splits on.
 *
 * §5 gives three opening asks. Only this one carries a value the query contract
 * can supply — `cp.backup` is a `PendingGate.checkpointId`, which every
 * `Situation` with a gate holds — so only this one becomes a template made of
 * the designer's own bytes. The other two name a run noun and a site that
 * `Situation` does not carry (see `openingAsksModel.ts` for the measurement and
 * the escalation), so generalising them is AUTHORING and is done where authored
 * copy is declared, not silently here.
 *
 * The class id is `situation-headlines.js`'s own, so the ask and the headline
 * that selected the row are keyed by the same name.
 */
const TEMPLATED_ASK = {
  classId: 'run.waiting.mid-procedure',
  /** The specimen's own checkpoint id — the span the split removes. */
  specimenValue: 'cp.backup',
  slot: 'checkpoint',
} as const;

// ---------------------------------------------------------------------------
// Reading the designer's sheet
// ---------------------------------------------------------------------------

/**
 * One string from the sheet, by an anchor.
 *
 * Fails loudly rather than returning an empty string, for the reason
 * `generate-return-copy.ts` gives at the same function: an anchor that stops
 * matching means the designer moved the sentence, and the alternative to
 * throwing is a blank on a customer's screen.
 */
function fromSheet(md: string, re: RegExp, what: string): string {
  const m = md.match(re);
  if (!m || !m[1]) throw new Error(`anchor for "${what}" no longer matches ${sheetPath}`);
  return m[1].trim();
}

/**
 * §5's three opening-ask bullets, in the sheet's own order.
 *
 * Anchored on the sentence that introduces them rather than on "any bullet
 * list", so a bullet list added elsewhere in §5 cannot be read as the asks.
 */
function askSpecimens(md: string): string[] {
  const block = md.match(/Three opening asks[^\n]*\n\n((?:- [^\n]+\n)+)/);
  if (!block) throw new Error(`§5's three opening asks no longer parse in ${sheetPath}`);
  const asks = block[1]
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
  if (asks.length !== 3) {
    throw new Error(`§5 carries ${asks.length} opening ask(s), expected 3`);
  }
  return asks;
}

/**
 * Split ONE specimen around the value it carries, into a `{slot}` template.
 *
 * The result is still verbatim designer bytes on both sides of the brace, which
 * is the property that makes this extraction rather than authorship — the same
 * move `generate-return-copy.ts` makes with `splitAroundMoment` and
 * `dropCountToken`.
 *
 * EXPORTED SO ITS OWN GUARD IS REACHABLE. `extract` checks that some §5 bullet
 * carries the value before calling this, so the throw below cannot be driven
 * through the CLI at all — and a mutation that replaced it with `return
 * specimen` (shipping the specimen with no slot, naming a checkpoint that is not
 * on the row) SURVIVED the first battery for exactly that reason. The guard
 * stays — belt and braces in a generator is cheap — and it is pinned directly
 * instead of being decoration (WP-46).
 */
export function templateFrom(specimen: string, value: string, slot: string, what: string): string {
  const at = specimen.indexOf(value);
  if (at < 0) throw new Error(`"${what}" no longer contains the value "${value}" it splits on`);
  return `${specimen.slice(0, at)}{${slot}}${specimen.slice(at + value.length)}`;
}

// ---------------------------------------------------------------------------
// The extraction
// ---------------------------------------------------------------------------

interface Extracted {
  invitation: string;
  askTemplates: Record<string, string>;
  scope: { lead: string; fleet: string; action: string; separator: string };
  nothingNeededHead: string;
  approve: string;
  notNow: string;
}

function extract(): Extracted {
  const md = fs.readFileSync(sheetPath, 'utf-8');

  // --- the panel's invitation ---------------------------------------------
  //
  // §5's blockquote is the VERDICT followed by an invitation. Only the second
  // half is taken: the first half is a paraphrase of §1's list verdict, and the
  // product composes that one ONCE in `sessionRegistry` (WP-48). Two
  // compositions of one sentence is a drift channel, so the panel reads the
  // fold's `TriageView.verdict` and this supplies only the sentence that
  // follows it.
  const invitation = fromSheet(md, /^> [^\n]*?\.\s+(Ask about [^\n]+)$/m, 'the panel invitation');

  // --- the three opening asks; one of them templates ------------------------
  const specimens = askSpecimens(md);
  const specimen = specimens.find((s) => s.includes(TEMPLATED_ASK.specimenValue));
  if (!specimen) {
    throw new Error(
      `no §5 opening ask carries "${TEMPLATED_ASK.specimenValue}" — the one mechanically ` +
      'templatable ask is gone, and the rest are authored elsewhere by design',
    );
  }
  const askTemplates: Record<string, string> = {
    [TEMPLATED_ASK.classId]: templateFrom(
      specimen, TEMPLATED_ASK.specimenValue, TEMPLATED_ASK.slot, 'the mid-procedure opening ask',
    ),
  };

  // --- the scope line, from its own emphasis marks --------------------------
  //
  // The designer wrote it as `**Asking about** *the whole fleet* · *Choose a
  // site*.` The markup is doing real work and is read rather than flattened:
  // the bold span is the LEAD, the first emphasised span is the SCOPE VALUE
  // (which a site name replaces), and the second is the ACTION beside it.
  const scopeMatch = md.match(
    /Below the composer, the scope line: \*\*([^*]+)\*\* \*([^*]+)\*( · )\*([^*]+)\*/,
  );
  if (!scopeMatch) throw new Error(`§5's scope line no longer parses in ${sheetPath}`);

  // --- §2's section head, and §3's two in-place answers ---------------------
  const nothingNeededHead = fromSheet(md, /^\*\*(Nothing needed of you)\*\* sits below/m, 'the nothing-needed head');
  const answers = md.match(/the Inbox's \*([^*]+)\* and \*([^*]+)\*, in place/);
  if (!answers) throw new Error(`§3's two in-place answers no longer parse in ${sheetPath}`);

  return {
    invitation,
    askTemplates,
    scope: {
      lead: scopeMatch[1].trim(),
      fleet: scopeMatch[2].trim(),
      action: scopeMatch[4].trim(),
      separator: scopeMatch[3],
    },
    nothingNeededHead,
    approve: answers[1].trim(),
    notNow: answers[2].trim(),
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
  const c = extract();
  const lines: string[] = [
    '/**',
    ' * GENERATED — DO NOT EDIT. `npm run fixtures:opening-copy`.',
    ' *',
    ' * WP-49 · the Now screen\'s chrome and the docked panel\'s opening state,',
    ' * extracted verbatim from the designer\'s own sheet by',
    ' * `scripts/generate-opening-copy.ts`:',
    ' *',
    ' *   docs/intelligence/from-designer/from-designer-11-now-screen.md',
    ' *',
    ' * Editing this file by hand is the defect the generator exists to prevent: it',
    ' * would make the surface a SECOND place the ratified wording lives, free to',
    ' * drift from the sheet that ratified it. `npm run fixtures:opening-copy:check`',
    ' * fails closed on a stale copy.',
    ' *',
    ' * `{slot}` braces are HOST FIELD NAMES, filled by `fillSituationSentence` from',
    ' * values the fold already derived — the same filler the row headlines use, so a',
    ' * slot cannot mean one thing in a headline and another in an ask.',
    ' */',
    '',
    `export const OPENING_COPY_SHAPE_VERSION = ${SHAPE_VERSION};`,
    '',
    '/**',
    ' * The sentence that FOLLOWS the opening line in §5\'s blockquote.',
    ' *',
    ' * The opening line itself is `TriageView.verdict` — composed once in',
    ' * `sessionRegistry` (WP-48) and read here, never recomposed. §5\'s blockquote',
    ' * paraphrases that verdict before inviting the question; only the invitation',
    ' * is extracted, so the panel and the list cannot say the count differently.',
    ' */',
    `export const PANEL_INVITATION = ${literal(c.invitation)};`,
    '',
    '/**',
    ' * THE OPENING ASKS THE SHEET SUPPLIES, keyed by the situation class that',
    ' * selects them — `situation-headlines.js`\'s own ids.',
    ' *',
    ' * ONE ENTRY, and the count is the finding rather than an oversight. §5 gives',
    ' * three asks; two of them name a run noun and a site that `Situation` does not',
    ' * carry, so they cannot be filled from the query contract and cannot be split',
    ' * into templates out of the designer\'s own bytes. Those two are AUTHORED, in',
    ' * `openingAsksModel.ts`, where every authored sentence on this surface is',
    ' * declared in one gate-extractable place.',
    ' */',
    'export const OPENING_ASKS: Readonly<Record<string, string>> = {',
  ];
  for (const classId of Object.keys(c.askTemplates).sort()) {
    lines.push(`  ${literal(classId)}: ${literal(c.askTemplates[classId])},`);
  }
  lines.push(
    '};',
    '',
    '/**',
    ' * The scope line beneath the composer, in the three spans the designer marked.',
    ' *',
    ' * "A question with no stated subject is the panel\'s most common failure, and',
    ' * stating it is cheaper than asking." `FLEET` is the SCOPE VALUE — the span a',
    ' * site name replaces when one is pinned — and `ACTION` is the control beside',
    ' * it. Splitting on the sheet\'s own emphasis marks is what keeps all three',
    ' * verbatim.',
    ' */',
    'export const SCOPE_LINE = {',
    `  LEAD: ${literal(c.scope.lead)},`,
    `  FLEET: ${literal(c.scope.fleet)},`,
    `  ACTION: ${literal(c.scope.action)},`,
    `  SEP: ${literal(c.scope.separator)},`,
    '} as const;',
    '',
    '/**',
    ' * The Now screen\'s own chrome.',
    ' *',
    ' * `NOTHING_NEEDED_HEAD` is §2\'s section — "a section, not a footnote" (§3) —',
    ' * and the two answers are the Inbox cards\' own, which §3 moves onto the rows',
    ' * in place. They are extracted rather than retyped for the same reason every',
    ' * other string here is: a hand-typed button label is a second place the',
    ' * vocabulary lives.',
    ' */',
    'export const NOW_COPY = {',
    `  NOTHING_NEEDED_HEAD: ${literal(c.nothingNeededHead)},`,
    `  APPROVE: ${literal(c.approve)},`,
    `  NOT_NOW: ${literal(c.notNow)},`,
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

  const sheetAt = argv.indexOf('--sheet');
  if (sheetAt >= 0) sheetPath = path.resolve(argv[sheetAt + 1]);

  const next = emit();

  if (check) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf-8') : '';
    if (current !== next) {
      process.stderr.write(
        `${path.relative(REPO_ROOT, out)} is STALE — run \`npm run fixtures:opening-copy\`.\n`,
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
