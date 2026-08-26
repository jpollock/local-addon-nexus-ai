/**
 * Rebuild the twin view from the ledger — the ADR-1/§4.3 claim, exercisable.
 *
 * "The twin is rebuildable from the ledger at any time — a cache by
 * construction" was asserted from the first draft and, until this module,
 * could not be DONE by any shipped code: the mechanism lived in a manual
 * replay harness (tests/e2e-intelligence/replay) that runs on a copy, on one
 * machine, when someone remembers. A property that cannot be exercised is a
 * belief, not a property.
 *
 * Mechanics, in order:
 *   1. one transaction wipes `twin_facts` and `fold_cursors` — the view and
 *      the folds' memory of it go together, or a stale cursor would make the
 *      replay silently partial;
 *   2. every fold catches up from event zero. Each batch is transactional in
 *      `runFold`, so a crash mid-rebuild leaves real cursors behind and a
 *      re-run completes the job — the same idempotence the folds already
 *      guarantee for ordinary consumption.
 *
 * What this deliberately does NOT touch: `events` (the source of truth),
 * `entities`/aliases/links (the entity graph is not a fold output), and any
 * store outside the ledger file.
 */
import { Ledger } from '../ledger/ledger';
import { Fold, catchUp } from './foldWorker';

export interface RebuildResult {
  /** Fold-consumable events replayed (sum over folds' own counts). */
  eventsReplayed: number;
  twinsBefore: number;
  twinsAfter: number;
  /** The folds that ran, in order — so a caller can see none went missing. */
  folds: string[];
}

export function rebuildTwins(ledger: Ledger, folds: Fold[]): RebuildResult {
  const db = ledger.raw();

  const twinsBefore = (db.prepare('SELECT COUNT(*) AS n FROM twin_facts').get() as { n: number }).n;

  db.transaction(() => {
    db.prepare('DELETE FROM twin_facts').run();
    db.prepare('DELETE FROM fold_cursors').run();
  })();

  let eventsReplayed = 0;
  for (const fold of folds) {
    eventsReplayed += catchUp(ledger, fold);
  }

  const twinsAfter = (db.prepare('SELECT COUNT(*) AS n FROM twin_facts').get() as { n: number }).n;

  return { eventsReplayed, twinsBefore, twinsAfter, folds: folds.map((f) => f.name) };
}
