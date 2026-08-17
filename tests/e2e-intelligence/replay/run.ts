/**
 * WP-18 · Real-ledger replay (TESTING_STRATEGY.md layer 6).
 *
 *   npx ts-node tests/e2e-intelligence/replay/run.ts
 *
 * Rebuilds every WIRED fold from event 0 against a copy of the developer's own
 * ledger — the messiest fixture this project will ever have — and asserts the
 * invariants the architecture claims: append-only and monotonic, drift events
 * well-formed, twin counts inside stated bounds, and the big one, twins are a
 * MATERIALIZED VIEW: fold the same ledger again and the same facts come out.
 * That determinism claim has lived in ADR prose since M1 and has never been
 * tested against real data.
 *
 * Manual / pre-release, never in `npm test`: it reads a file that exists only
 * on a machine that has actually run the addon.
 *
 * ── Two safety properties, both structural ────────────────────────────────
 *
 * 1. THE LIVE LEDGER IS NEVER OPENED FOR WRITING. The only handle on it is a
 *    `readonly: true` connection used for one `VACUUM INTO`, which writes the
 *    destination and never the source. Everything after that touches copies in
 *    a temp directory. The live file is not even a fallback path.
 *
 * 2. THE FOLD LIST IS NOT MAINTAINED HERE. `initIntelligenceCore` is booted on
 *    the temp directory and its `core.folds` is what runs — the same list the
 *    health surface measures lag against. A fold added to bootstrap is replayed
 *    the same day; a hand-copied list here would rot silently and the replay
 *    would certify a fold it never ran.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { nativeModuleRemedy } from '../../intelligence-evals/nativeModule';
import {
  checkDriftEvent,
  checkMonotonicIds,
  checkTwinCounts,
  checkTwinRow,
  diffTwinSets,
  DRIFT_TOPIC,
  TwinRow,
} from './invariants';
import { liveLedgerPath } from './paths';
import { formatReplayReport, replayPassed, ReplayResult } from './report';

/** Exit code for "the replay could not run" — distinct from a failed replay. */
const CANNOT_RUN_EXIT_CODE = 2;

function banner(title: string, body: string[]): string {
  const rule = '='.repeat(78);
  return ['', rule, `⛔  ${title}`, rule, ...body, rule, ''].join('\n');
}

function cannotRun(title: string, body: string[]): never {
  console.error(banner(title, body));
  process.exit(CANNOT_RUN_EXIT_CODE);
}

async function main(): Promise<void> {
  // ── ABI preflight ───────────────────────────────────────────────────────
  // This opens real SQLite under system Node. A tree last used to load the
  // addon in Local is built for Electron and fails deep inside the first
  // `require` with a stack trace naming a NODE_MODULE_VERSION nobody connects
  // to `npm run pretest`. Shared with the evals harness — one remedy, one
  // wording, one place to fix it (WP-13c).
  const remedy = nativeModuleRemedy();
  if (remedy) cannotRun('REAL-LEDGER REPLAY COULD NOT RUN', ['', remedy, '']);

  const source = liveLedgerPath(os.platform(), os.homedir());
  if (!fs.existsSync(source)) {
    cannotRun('REAL-LEDGER REPLAY COULD NOT RUN', [
      '',
      'No ledger to replay:',
      '',
      `  ${source}`,
      '',
      'The ledger is created the first time the addon starts. Run Local with the',
      'Nexus AI addon at least once, then try again.',
      '',
    ]);
  }

  // Imported lazily: both pull better-sqlite3 transitively, and the ABI
  // preflight above must be the thing that reports a wrong-ABI tree.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const { initIntelligenceCore } = require('../../../src/main/intelligence-host/bootstrap');
  const { catchUp } = require('../../../src/intelligence');

  const started = Date.now();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ledger-replay-'));
  const pristinePath = path.join(workDir, 'pristine.db');
  const replayDir = path.join(workDir, 'replay');
  fs.mkdirSync(replayDir, { recursive: true });
  const replayPath = path.join(replayDir, 'ledger.db');

  console.log(`Copying ${source}`);
  console.log(`      -> ${workDir}`);

  // VACUUM INTO from a READONLY connection: it writes the destination only,
  // and it captures the WAL contents, which a plain file copy would miss while
  // Local is running.
  {
    const src = new Database(source, { readonly: true });
    try {
      src.exec(`VACUUM INTO '${pristinePath.replace(/'/g, "''")}'`);
      src.exec(`VACUUM INTO '${replayPath.replace(/'/g, "''")}'`);
    } finally {
      src.close();
    }
  }

  const problems: ReplayResult['problems'] = {
    monotonic: [],
    drift: [],
    twinRows: [],
    counts: [],
    diff: { identical: true, missing: [], extra: [], differing: [] },
  };

  let events = 0;
  let stateObservations = 0;
  let driftEvents = 0;
  let liveTwins: TwinRow[] = [];
  let replayedTwins: TwinRow[] = [];
  let entities = 0;
  let foldNames: string[] = [];

  try {
    // ── What production materialised, read from the untouched copy ─────────
    const pristine = new Database(pristinePath, { readonly: true });
    try {
      liveTwins = pristine.prepare(`SELECT * FROM twin_facts`).all() as TwinRow[];

      const ids = pristine
        .prepare(`SELECT id FROM events ORDER BY id ASC`)
        .all()
        .map((r: { id: string }) => r.id);
      events = ids.length;
      problems.monotonic = checkMonotonicIds(ids);

      // The events the state fold can extract a fact from — the denominator
      // for the twin-count bound. Drift events share the `state.` prefix and
      // are deliberately NOT among them (the fold skips them).
      stateObservations = (
        pristine
          .prepare(
            `SELECT COUNT(*) AS n FROM events
              WHERE topic LIKE 'state.%' AND topic != ?`
          )
          .get(DRIFT_TOPIC) as { n: number }
      ).n;

      for (const row of pristine
        .prepare(`SELECT * FROM events WHERE topic = ?`)
        .all(DRIFT_TOPIC) as Array<Record<string, string>>) {
        driftEvents++;
        problems.drift.push(...checkDriftEvent(inflate(row)));
      }
    } finally {
      pristine.close();
    }

    // ── Replay: same wiring production uses, on the copy ───────────────────
    const core = initIntelligenceCore({
      storage: memoryStorage(),
      logger: quietLogger(),
      dataDir: replayDir,
    });
    if (!core) throw new Error('initIntelligenceCore returned undefined on the copied ledger');

    foldNames = core.folds.map((f: { name: string }) => f.name);

    try {
      const db = core.ledger.raw();
      // Rebuild FROM EVENT 0: drop what production folded and every cursor, so
      // nothing below is inherited rather than recomputed.
      db.exec(`DELETE FROM twin_facts; DELETE FROM fold_cursors;`);

      for (const fold of core.folds) catchUp(core.ledger, fold);

      replayedTwins = db.prepare(`SELECT * FROM twin_facts`).all() as TwinRow[];
      entities = new Set(replayedTwins.map((r) => r.entity_id)).size;

      for (const row of replayedTwins) problems.twinRows.push(...checkTwinRow(row));
      problems.counts = checkTwinCounts({
        twins: replayedTwins.length,
        stateObservations,
        entities,
      });
      problems.diff = diffTwinSets(liveTwins, replayedTwins);
    } finally {
      core.close();
    }
  } catch (err) {
    problems.threw = (err as Error)?.stack ?? String(err);
  }

  const result: ReplayResult = {
    ledgerPath: pristinePath,
    events,
    stateObservations,
    driftEvents,
    liveTwins: liveTwins.length,
    replayedTwins: replayedTwins.length,
    entities,
    foldNames,
    durationMs: Date.now() - started,
    problems,
  };

  console.log(formatReplayReport(result));
  console.log(`Copies left in place for inspection: ${workDir}`);
  process.exit(replayPassed(result) ? 0 : 1);
}

/** Row → envelope-shaped object, for the drift checks. */
function inflate(row: Record<string, string>): Record<string, unknown> {
  const json = (v: string | null | undefined) => {
    if (v == null) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  return {
    ...row,
    entity: json(row.entity),
    actor: json(row.actor),
    source: json(row.source),
    access: json(row.access),
    payload: json(row.payload),
    causation: row.causation ?? undefined,
  };
}

/**
 * Storage for the replay's core. In memory on purpose: booting the real core
 * writes a satellite id and an init-state marker, and those markers belong to
 * the running installation (CLAUDE.md's storage-marker rule). A replay must
 * leave the developer's own state exactly as it found it.
 */
function memoryStorage(): { get(key: string): unknown; set(key: string, value: unknown): void } {
  const map = new Map<string, unknown>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
  };
}

function quietLogger(): { info(m: string): void; warn(m: string): void; error(m: string): void } {
  return {
    info: () => undefined,
    warn: (m) => console.warn(`  [core] ${m}`),
    // Never swallowed: a non-fatal init failure inside the replay is a finding.
    error: (m) => console.error(`  [core] ${m}`),
  };
}

main().catch((err) => {
  console.error(banner('REAL-LEDGER REPLAY CRASHED', ['', String((err as Error)?.stack ?? err), '']));
  process.exit(1);
});
