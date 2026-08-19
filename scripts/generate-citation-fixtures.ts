/**
 * WP-34 · THE CITATION ADHERENCE FIXTURE — derived, never typed.
 *
 * `from-designer-07-corroboration-render.md` §4a is a table of six spans in
 * three states, drawn against ADR-24 before this convention had a syntax. The
 * designer built that table for this diff, so this generator lines up against
 * it rather than inventing its own cases: the CLAIMS are the designer's own
 * sentences, the MARKERS are this packet's convention, and every STATE in the
 * output comes out of `resolveCitations` — the same function the eval sheet
 * judges with and the M5 render will draw from (ADR-24 P5).
 *
 * The XD-16 discipline WP-32 established, applied here: nothing in the output
 * is authored. A state typed by hand into a design fixture is a claim about the
 * platform that the platform never made, and the sketch and the product could
 * then disagree by construction with nobody the wiser.
 *
 * TWO FIELDS HAVE NO PLATFORM BEHIND THEM, and the output says so in its own
 * header rather than letting a reader assume otherwise: the event ids
 * (`evt_9c41` and friends) and their topics (`incident.opened`) are the
 * designer's illustrative ones. Real ledger ids are `evt_<ULID>` — 26 Crockford
 * characters — and real topics come from the closed vocabulary
 * (`episodic.incident.recorded`, `task.action.executed`). They are kept
 * verbatim so the fixture can be read beside the sheet it answers; the join
 * treats every id as opaque, so nothing about the derivation depends on it.
 *
 * DETERMINISTIC BY CONSTRUCTION: no clock, no randomness, no absolute paths,
 * keys sorted at every level. Running it twice on an unchanged tree produces a
 * byte-identical file.
 *
 *   npx ts-node scripts/generate-citation-fixtures.ts
 *   npx ts-node scripts/generate-citation-fixtures.ts --check       # CI/no-write
 *   npx ts-node scripts/generate-citation-fixtures.ts --out <path>  # write elsewhere
 *
 * `--out` exists so the determinism pin can run this twice WITHOUT writing to
 * the tracked artifact — PARALLEL_PROTOCOL's poisoned-fixture rule, which cost
 * WP-32 a full run when a mutated generator left its output on disk.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  resolveCitations,
  tallyCitations,
  CitationSupply,
} from '../src/intelligence/citation/resolve';

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(
  REPO_ROOT,
  'docs',
  'intelligence',
  'design-fixtures',
  'citation-spans.json'
);

/** Bumped when the SHAPE changes, so a consumer can tell that from a content change. */
const FIXTURE_SHAPE_VERSION = 1;

/**
 * The task's supply — P1's universe for the sheet's scenario.
 *
 * `evt_8e90` is DELIBERATELY ABSENT. It is the designer's third row: a citation
 * of a record nobody supplied, which the render draws as the loudest state on
 * the surface. A supply that contained it would quietly turn the sheet's
 * sharpest case into a quiet link.
 */
const SUPPLY: CitationSupply = {
  events: [
    { id: 'evt_9c41', topic: 'incident.opened', trust: 'emitted' },
    { id: 'evt_8f21', topic: 'task.action.executed', trust: 'emitted' },
  ],
  toolCalls: [
    { name: 'wpe_backup_and_verify', index: 1 },
    { name: 'wpe_backup_and_verify', index: 2 },
  ],
  carrierLines: [{ key: 'freshness' }, { key: 'retrieved' }],
};

/**
 * The reply, span by span — the designer's six claims in the designer's order.
 *
 * The sentences are theirs, verbatim from §4a. The markers are this packet's,
 * and they are the ONLY authored thing here: what each marker then MEANS is
 * derived below, not asserted.
 */
const SPANS: { claim: string; marker: string }[] = [
  {
    claim: 'Checkout has been returning 500s on Charlie since 02:14 this morning.',
    marker: '[[cite:evt_9c41]]',
  },
  {
    claim: 'The WooCommerce update landed at 02:07, seven minutes before the first error.',
    marker: '[[cite:evt_8f21]]',
  },
  {
    claim: 'payment-gateway-x was updated on the same site forty minutes earlier.',
    marker: '[[cite:evt_8e90]]',
  },
  {
    claim:
      'Both sites that broke on a WooCommerce update before were running that same gateway version.',
    marker: '[[cite:none]]',
  },
  {
    claim:
      'That points at the gateway rather than at WooCommerce itself, but I have not proved it.',
    // Legitimately uncited: hedged inference, not a specific. The convention
    // says glue carries nothing, and the render draws nothing.
    marker: '',
  },
  {
    claim:
      'The backup taken before the update is verified and fourteen minutes older than the failure.',
    marker: '[[cite:tool:wpe_backup_and_verify#2]]',
  },
];

/** The reply as the model would emit it — markers trailing each claim. */
export const FIXTURE_REPLY = SPANS.map((s) =>
  s.marker ? `${s.claim} ${s.marker}` : s.claim
).join('\n\n');

/** Recursively sort object keys so the output is diffable and stable. */
function stable<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stable) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

export function buildFixture(): Record<string, unknown> {
  const resolutions = resolveCitations(FIXTURE_REPLY, SUPPLY);

  // Walk the spans and the resolutions together. A span with no marker has no
  // resolution, which is the point of the fifth row: uncited glue is not a
  // state the join reports, it is the absence of one.
  let cursor = 0;
  const spans = SPANS.map((span) => {
    if (!span.marker) {
      return {
        claim: span.claim,
        marker: null,
        state: null,
        note: 'no marker — hedged inference, legitimately uncited (ADR-24 P3)',
      };
    }
    const r = resolutions[cursor++];
    const base = { claim: span.claim, marker: span.marker, state: r.state };
    if (r.state === 'cited-and-resolves') return { ...base, record: r.record };
    if (r.state === 'cited-but-unresolvable') return { ...base, reason: r.reason };
    return base;
  });

  return stable({
    $generatedBy: 'scripts/generate-citation-fixtures.ts (WP-34)',
    $doNotEdit:
      'Every `state`, `record` and `reason` below is the output of resolveCitations() — the ' +
      'production join the eval sheet and the M5 render share. Editing this file by hand ' +
      'authors a platform answer the platform never gave. Regenerate instead — npm run fixtures:citations.',
    $shapeVersion: FIXTURE_SHAPE_VERSION,
    $notDerived:
      'The event ids and their topics are the DESIGNER\'S illustrative ones from ' +
      'from-designer-07-corroboration-render.md §4a, kept verbatim so this fixture reads beside ' +
      'that sheet. Real ledger ids are evt_<ULID> and real topics come from the closed vocabulary ' +
      '(episodic.incident.recorded, task.action.executed). The join treats every id as opaque, so ' +
      'nothing derived here depends on their shape.',
    $answers: 'from-designer-07-corroboration-render.md §4a — six spans, three states',
    reply: FIXTURE_REPLY,
    supply: SUPPLY,
    spans,
    tally: tallyCitations(resolutions),
  });
}

function render(): string {
  return `${JSON.stringify(buildFixture(), null, 2)}\n`;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : OUT_FILE;
  const text = render();

  if (argv.includes('--check')) {
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    if (current !== text) {
      process.stderr.write(
        `${path.relative(REPO_ROOT, outFile)} is stale — run: npm run fixtures:citations\n`
      );
      process.exit(1);
    }
    process.stdout.write(`${path.relative(REPO_ROOT, outFile)} is current\n`);
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text, 'utf8');
  process.stdout.write(`wrote ${path.relative(REPO_ROOT, outFile)}\n`);
}
