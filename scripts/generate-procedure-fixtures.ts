/**
 * WP-32 · THE DERIVED FIXTURE GENERATOR — the design workstream's one source.
 *
 * XD-16 (fixtures come from the derivation) and pin 7 ("a checkpoint sequence
 * authored anywhere, INCLUDING in a design fixture, is a defect") together make
 * this file the only legitimate way a sketch learns what a runbook declares.
 * The rule it enforces is the one draft 1 broke: a designer reading
 * `law/runbooks/*.md` and typing the checkpoints into a prototype is
 * TRANSCRIBING, and transcription is authoring by another name — draft 1
 * authored `cp.canary` before `cp.approval`, which is writes-before-consent,
 * which is the August 2026 incident's own order.
 *
 * So: nothing here writes a checkpoint. It loads the shipped `law/` directory,
 * runs `deriveDeclaredProcedure` — the SAME function the panel renders from —
 * over every runbook, and writes the result to one JSON file. If the sketch and
 * the product disagree after this, one of them has a bug; before it, they could
 * disagree by construction and nobody would know.
 *
 * DETERMINISTIC, BY CONSTRUCTION. No clock, no randomness, no absolute paths in
 * the output, keys sorted at every level. Running it twice on an unchanged tree
 * produces a byte-identical file, which is what makes "regenerate on a version
 * bump and commit the diff" a meaningful review: every line that moves, moved
 * because a reviewed document moved.
 *
 * THE ONE FIELD WITH NO DOCUMENT BEHIND IT is `armedBy`. It is a property of the
 * arming, not of the runbook — there is no run here, so the generator supplies
 * `model-request` and says so in the output's own header rather than letting a
 * reader assume it was derived. Everything else on every line came out of the
 * document.
 *
 *   npx ts-node scripts/generate-procedure-fixtures.ts
 *   npx ts-node scripts/generate-procedure-fixtures.ts --check          # CI/no-write
 *   npx ts-node scripts/generate-procedure-fixtures.ts --out <path>     # write elsewhere
 *
 * `--out` exists so the determinism pin can run the generator twice WITHOUT
 * writing to the tracked artifact. A test that rewrites a committed file is a
 * test that can silently repair the staleness the sibling test exists to catch —
 * and it makes `npm test` mutate the working tree, which no suite may do.
 */
import * as fs from 'fs';
import * as path from 'path';

import { loadLawDirectory, RunbookRegistry } from '../src/intelligence';
import type { Runbook } from '../src/intelligence';
import {
  ATTEST_WORDS,
  checkpointBadge,
  deriveDeclaredProcedure,
} from '../src/main/intelligence-host/procedureView';

const REPO_ROOT = path.resolve(__dirname, '..');
const LAW_DIR = path.join(REPO_ROOT, 'law');
const OUT_FILE = path.join(REPO_ROOT, 'docs', 'intelligence', 'design-fixtures', 'declared-procedures.json');

/**
 * The generator's own version. Bumped when the SHAPE of the file changes, so a
 * consumer that reads it can tell a shape change from a runbook change — the
 * two look identical in a diff and mean completely different things.
 */
const FIXTURE_SHAPE_VERSION = 2;

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

function fixtureFor(runbook: Runbook): Record<string, unknown> {
  // The delivery the assembler would produce for this document. Every field is
  // read off the runbook except `armedBy` — see the header.
  const declared = deriveDeclaredProcedure({
    outcome: {
      status: 'delivered',
      capability: runbook.capability,
      runbookId: runbook.id,
      version: runbook.version,
      hash: runbook.hash,
      strictness: runbook.strictness,
      armedBy: 'model-request',
      assertFull: true,
      bodyDelivered: true,
      checkpoints: [],
      steps: runbook.steps,
      tokens: 0,
    },
    runbook,
  });
  if (!declared) throw new Error(`deriveDeclaredProcedure returned null for ${runbook.id}`);

  return {
    capability: declared.capability,
    runbookId: declared.runbookId,
    version: declared.version,
    hash: declared.hash,
    strictness: declared.strictness,
    armedBy: declared.armedBy,
    /** Strict runbooks have checkpoints; guided ones have steps. Never both. */
    checkpoints: declared.checkpoints.map((state) => ({
      id: state.id,
      attest: state.attest,
      /** The words a surface shows, in full at BOTH densities (XD-10). */
      attestWords: ATTEST_WORDS[state.attest],
      status: state.status,
      /** The ONLY field a tick may be rendered from. Never true for narrative. */
      verified: state.verified,
      unrequested: state.unrequested,
      /** null when the document marked nothing — the badge is not on every step (WP-28). */
      badge: checkpointBadge(state),
      reason: state.reason,
    })),
    steps: runbook.steps,
    /**
     * WP-41 · the checkpoint that PRODUCED the plan, and the reason its own
     * heading gave — `planCheckpointOf`'s derivation, ratified at the WP-37
     * gate. It lands here for the same reason every other line does: the
     * sketch and the product must read one document. `null` when this runbook
     * declares no consent gate, or nothing narrative before it — which is the
     * document declining to answer, not a field the generator may fill.
     */
    planCheckpoint: declared.planCheckpoint ?? null,
    /** The honest denominator: how many of these the platform can prove AT ALL. */
    verifiableCount: declared.verifiableCount,
    checkpointCount: declared.checkpoints.length,
    communication: declared.communication,
  };
}

function build(): string {
  const { documents } = loadLawDirectory(LAW_DIR);
  const registry = RunbookRegistry.build({ documents });

  const byRunbookId: Record<string, unknown> = {};
  // Sorted by id: the file's order must not depend on directory-read order.
  for (const runbook of [...registry.runbooks()].sort((a, b) => a.id.localeCompare(b.id))) {
    byRunbookId[runbook.id] = fixtureFor(runbook);
  }

  const payload = {
    $generatedBy: 'scripts/generate-procedure-fixtures.ts (WP-32)',
    $doNotEdit:
      'Generated from law/ by deriveDeclaredProcedure. Editing this file by hand is the ' +
      'defect pin 7 names: a checkpoint sequence authored anywhere, including in a design ' +
      'fixture, is a defect. Regenerate instead — npm run fixtures:procedures.',
    $shapeVersion: FIXTURE_SHAPE_VERSION,
    $notDerived:
      "armedBy is a property of the ARMING, not of the document. There is no run here, so " +
      "the generator supplies 'model-request'. Every other field on every line came out of " +
      'the reviewed document.',
    runbooks: stable(byRunbookId),
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function outFileFromArgv(): string {
  const i = process.argv.indexOf('--out');
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : OUT_FILE;
}

function main(): void {
  const next = build();
  const check = process.argv.includes('--check');
  const target = outFileFromArgv();

  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current === next) {
      console.log(`up to date: ${path.relative(REPO_ROOT, target)}`);
      return;
    }
    console.error(
      `STALE: ${path.relative(REPO_ROOT, target)} does not match the derivation.\n` +
        'A runbook changed and the design fixture did not. Run: npm run fixtures:procedures'
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, next);
  console.log(`wrote ${path.relative(REPO_ROOT, target)}`);
}

main();
