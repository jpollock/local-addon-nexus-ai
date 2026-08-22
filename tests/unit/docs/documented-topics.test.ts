/**
 * WP-65 · The documented event-topic set, pinned to the topics source emits.
 *
 * ── The defect this exists for ──────────────────────────────────────────────
 * `architecture.md` §4.2 has listed the topic taxonomy since the layer was
 * designed. Measured 2026-08-22, it disagreed with the code in BOTH directions
 * — nine topics documented with no producer, seven emitted and undocumented —
 * and nothing anywhere could notice. A list of event types in a document goes
 * out of date silently; that silence, not the drift, is what this file removes.
 *
 * ── Which pattern this follows ──────────────────────────────────────────────
 * Both of the repo's existing doc-anchored checks, one per side:
 *
 *   · SOURCE side — WP-61's tool-name sweep (`tests/unit/mcp/
 *     tool-remedy-references.test.ts`): a TypeScript-PARSER walk, not a regex,
 *     so comments and identifiers are structurally excluded. This matters here
 *     more than it did there: `comparatorRead.ts:78-82` names eight topics in a
 *     docblock, and a regex sweep would count a note to a maintainer as a
 *     producer.
 *
 *   · DOCUMENT side — WP-58's collision floor (`tests/unit/mcp/
 *     collision-decline.test.ts`): the list is HAND-WRITTEN in the document and
 *     parsed back out, never generated. WP-58 anchored a constant to prose;
 *     this anchors prose to a scan. Same property: the two move in one commit
 *     or neither.
 *
 * ── The three vacuous shapes this check could have had, and what stops each ─
 * 1. BOTH SIDES EMPTY. A parser that finds nothing in the document, or a scan
 *    that finds nothing in source, compares two empty sets and passes. Floors
 *    are asserted on BOTH sides before anything is compared — see
 *    `both sides are non-empty`.
 * 2. COMPARING A LIST TO ITSELF. If the documented list were generated from the
 *    scan the check could never fail. Nothing generates `digital-twin-data.md`,
 *    and `the test carries no copy of the list` asserts mechanically that the
 *    list was not pasted in here either — the only topic literals allowed in
 *    this file are the positive control and the fixture allowance.
 * 3. A SCAN THAT CANNOT REACH THE EMITTERS. A walk over the wrong root, or a
 *    node matcher that matches nothing, reports "no topics in source" and every
 *    documented topic looks unbuilt. `the scan reaches real producers` is the
 *    positive control: `state.plugin.observed` is emitted from three known
 *    files and the scan must find all three, by name.
 */
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const DOC_PATH = path.join(REPO_ROOT, 'docs/digital-twin-data.md');

/** `<type>.<subject>.<verb>` — the taxonomy's own grammar (architecture.md §4.2). */
const TOPIC_GRAMMAR = /^[a-z][a-zA-Z_]*\.[a-zA-Z_]+\.[a-zA-Z_]+$/;

// ---------------------------------------------------------------------------
// The allowance — topic-shaped strings in source that are NOT topics
// ---------------------------------------------------------------------------

/**
 * Strings the scan finds in a `topic:` position that no producer emits. Each
 * needs a reason, and two guards below stop this from becoming a silencer:
 * every entry must still be FOUND by the scan (so it cannot go stale), and no
 * entry may also appear in the document's emitted table (so it cannot mask a
 * real check).
 *
 * WP-65's premise was that `site.status.observed` is "emitted from six sites"
 * and breaks §4.2's first-segment rule. It is emitted from none. Its six
 * occurrences are this fixture, a comment in `comparatorRead.ts:82` saying the
 * producer "has never existed", and four test fixtures. The rule is not
 * violated; a fixture names a producer nobody wrote.
 */
const FIXTURE_TOPICS: Record<string, string> = {
  'site.status.observed':
    'renderer/components/DockedPanel/scopeModel.ts — inside FIXTURE_SELECTION, which says so in '
    + 'its own docblock. Nothing records a site as halted; comparatorRead.ts:78-91 reads '
    + 'halted-ness from nowhere for exactly that reason. Delete this entry the day a producer '
    + 'exists — and then decide whether the topic or §4.2\'s first-segment rule is wrong.',
};

/**
 * The positive control (shape #3). `state.plugin.observed` is emitted from
 * these three files; a scan that cannot see all three cannot see producers,
 * and every "documented but unbuilt" verdict it produced would be an artifact.
 */
const CONTROL_TOPIC = 'state.plugin.observed';
const CONTROL_FILES = [
  'main/intelligence-host/graphBackfill.ts',
  'main/intelligence-host/graphServiceTap.ts',
  'main/mcp/modules/fleet/verify-site-live.ts',
];

/** Floors. Well under the measured 18/27 so ordinary churn does not trip them. */
const MIN_SOURCE_TOPICS = 15;
const MIN_DOCUMENTED_TOPICS = 25;
const MIN_PRODUCER_FILES = 8;

// ---------------------------------------------------------------------------
// The source side — a parser walk, so a docblock is never a producer
// ---------------------------------------------------------------------------

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(p, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Every topic string named as the TOPIC of an event, mapped to the files that
 * name it. Two syntactic positions, and only these two:
 *
 *   · the initializer of a property called `topic` — every string literal in
 *     the subtree, so `topic: cond ? 'a' : 'b'` (syncProducer.ts:141) yields
 *     both branches rather than neither;
 *   · a `const NAME_TOPIC = '...'` declaration, which is how the nine
 *     intelligence-host producers spell theirs.
 *
 * Object KEYS are deliberately excluded: `stateTwinFold.ts` keys a handler map
 * by topic, and a fold is a consumer. A consumer proves a topic is READ, not
 * that anything writes it.
 */
export function scanSourceTopics(root: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const record = (topic: string, file: string) => {
    if (!TOPIC_GRAMMAR.test(topic)) return;
    if (!found.has(topic)) found.set(topic, new Set());
    found.get(topic)!.add(path.relative(root, file).split(path.sep).join('/'));
  };

  for (const file of sourceFiles(root)) {
    const sf = ts.createSourceFile(
      file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(sf).replace(/['"]/g, '') === 'topic') {
        const collect = (n: ts.Node): void => {
          if (ts.isStringLiteralLike(n)) record(n.text, file);
          ts.forEachChild(n, collect);
        };
        collect(node.initializer);
      }
      if (
        ts.isVariableDeclaration(node)
        && /_TOPIC$/.test(node.name.getText(sf))
        && node.initializer
        && ts.isStringLiteralLike(node.initializer)
      ) {
        record(node.initializer.text, file);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

// ---------------------------------------------------------------------------
// The document side — hand-written, parsed back out, never generated
// ---------------------------------------------------------------------------

function sectionBetween(text: string, startHeading: string, endHeading: string): string {
  const start = text.indexOf(startHeading);
  if (start === -1) throw new Error(`${DOC_PATH} no longer contains the heading "${startHeading}"`);
  const end = text.indexOf(endHeading, start);
  if (end === -1) throw new Error(`${DOC_PATH} no longer contains the heading "${endHeading}"`);
  return text.slice(start + startHeading.length, end);
}

/** Rows of a markdown table, as arrays of trimmed cells, header and rule dropped. */
function tableRows(section: string): string[][] {
  return section
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => cells.length >= 2 && !/^-+$/.test(cells[0].replace(/[\s:]/g, '')))
    .filter((cells) => /^`[^`]+`$/.test(cells[0]));
}

const firstBacktick = (cell: string): string => cell.replace(/^`/, '').replace(/`$/, '');

export interface DocumentedTopics {
  /** topic → the producer path the document cites, `src/`-relative. */
  emitted: Map<string, string>;
  /** topic → the reason the document gives for there being no producer. */
  designed: Map<string, string>;
}

export function parseDocumentedTopics(docText: string): DocumentedTopics {
  const emitted = new Map<string, string>();
  for (const cells of tableRows(sectionBetween(docText, '### 5.1 Topics the code emits', '### 5.2 '))) {
    emitted.set(firstBacktick(cells[0]), firstBacktick(cells[1]).replace(/^src\//, ''));
  }
  const designed = new Map<string, string>();
  for (const cells of tableRows(sectionBetween(docText, '### 5.2 Topics §4.2 names and nothing emits', '### 5.3 '))) {
    designed.set(firstBacktick(cells[0]), cells[1]);
  }
  return { emitted, designed };
}

// ---------------------------------------------------------------------------

const docText = fs.readFileSync(DOC_PATH, 'utf8');
const documented = parseDocumentedTopics(docText);
const scanned = scanSourceTopics(SRC_ROOT);
const scannedTopics = new Set(scanned.keys());
const emittedByScan = new Set([...scannedTopics].filter((t) => !(t in FIXTURE_TOPICS)));

const sorted = (s: Iterable<string>) => [...s].sort();

describe('WP-65 — the documented event-topic set is pinned to source', () => {
  // ── Guards against the vacuous shapes, asserted BEFORE anything is compared ──

  it('both sides are non-empty (vacuous shape #1)', () => {
    expect(documented.emitted.size + documented.designed.size)
      .toBeGreaterThanOrEqual(MIN_DOCUMENTED_TOPICS);
    expect(scannedTopics.size).toBeGreaterThanOrEqual(MIN_SOURCE_TOPICS);

    const producerFiles = new Set<string>();
    for (const [topic, files] of scanned) {
      if (topic in FIXTURE_TOPICS) continue;
      files.forEach((f) => producerFiles.add(f));
    }
    expect(producerFiles.size).toBeGreaterThanOrEqual(MIN_PRODUCER_FILES);
  });

  it('the scan reaches real producers (vacuous shape #3 — the positive control)', () => {
    const files = scanned.get(CONTROL_TOPIC);
    expect(files).toBeDefined();
    for (const expected of CONTROL_FILES) {
      expect(sorted(files!)).toContain(expected);
    }
  });

  it('the test carries no copy of the list (vacuous shape #2)', () => {
    // A list pasted in here could be compared to itself. The document is the
    // hand-written side; this file may name only the control and the allowance.
    const self = fs.readFileSync(__filename, 'utf8');
    const literals = new Set(
      (self.match(/(?<![\w.])[a-z][a-zA-Z_]*\.[a-zA-Z_]+\.[a-zA-Z_]+(?![\w.])/g) ?? [])
        .filter((m) => TOPIC_GRAMMAR.test(m))
        .filter((m) => documented.emitted.has(m) || documented.designed.has(m) || scannedTopics.has(m)),
    );
    expect(sorted(literals)).toEqual(sorted([CONTROL_TOPIC, ...Object.keys(FIXTURE_TOPICS)]));
  });

  // ── The comparison ────────────────────────────────────────────────────────

  it('every topic source emits is documented as emitted, and vice versa', () => {
    expect(sorted(documented.emitted.keys())).toEqual(sorted(emittedByScan));
  });

  it('each documented producer path is a file the scan found naming that topic', () => {
    for (const [topic, citedPath] of documented.emitted) {
      const files = scanned.get(topic);
      expect(files && sorted(files)).toContain(citedPath);
      expect(fs.existsSync(path.join(SRC_ROOT, citedPath))).toBe(true);
    }
  });

  /**
   * The deferral-guard shape (`scripts/generate-situation-copy.ts`
   * `assertDeferralsStillHold`): an allowance states a condition under which it
   * ends, and the check probes THAT CONDITION rather than trusting the entry.
   * A documented topic is allowed to have no producer only while it has none.
   */
  it('no "designed, no producer" topic has quietly gained a producer', () => {
    for (const [topic, why] of documented.designed) {
      if (!scannedTopics.has(topic)) continue;
      throw new Error(
        `THE ALLOWANCE FOR "${topic}" HAS EXPIRED. docs/digital-twin-data.md §5.2 lists it as `
        + `designed with no producer, because: ${why}. It is now named in `
        + `${sorted(scanned.get(topic)!).join(', ')}. Move its row from §5.2 to §5.1 with the `
        + 'producer path. An allowance that outlives its own condition is a producer the '
        + 'document says does not exist.',
      );
    }
  });

  it('no topic is in both documented tables', () => {
    const both = sorted(documented.emitted.keys()).filter((t) => documented.designed.has(t));
    expect(both).toEqual([]);
  });

  // ── The allowance cannot go stale, and cannot mask a real check ───────────

  it('every fixture allowance is still found by the scan', () => {
    for (const topic of Object.keys(FIXTURE_TOPICS)) {
      expect(sorted(scannedTopics)).toContain(topic);
    }
  });

  it('no fixture allowance is also a documented producer', () => {
    for (const topic of Object.keys(FIXTURE_TOPICS)) {
      expect(documented.emitted.has(topic)).toBe(false);
      expect(documented.designed.has(topic)).toBe(false);
    }
  });
});
