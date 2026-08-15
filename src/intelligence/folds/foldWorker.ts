/**
 * Generic fold runner: cursor-driven, idempotent consumption of the ledger.
 *
 * A fold is a pure-ish reducer from events to a view table. Cursor advance and
 * view mutation happen in one transaction, so replays and crashes are safe.
 * Ordering is per-ledger by ULID; correctness derives from observed_at inside
 * each fold, not from arrival order (architecture doc §4.5).
 */
import { Ledger } from '../ledger/ledger';
import { EventEnvelope } from '../envelope/types';

export interface Fold {
  /** Unique fold name — the cursor key. */
  name: string;
  /** Topic prefix this fold consumes, e.g. 'state.plugin.'. */
  topicPrefix: string;
  /** Apply one event to the view tables. Runs inside the batch transaction. */
  apply(event: EventEnvelope, ledger: Ledger): void;
}

export function runFold(ledger: Ledger, fold: Fold, batchSize = 500): number {
  const db = ledger.raw();
  const cursorRow = db
    .prepare(`SELECT last_event_id FROM fold_cursors WHERE fold = ?`)
    .get(fold.name) as { last_event_id: string } | undefined;

  const events = ledger.query({
    topicPrefix: fold.topicPrefix,
    afterId: cursorRow?.last_event_id,
    limit: batchSize,
  });
  if (events.length === 0) return 0;

  const tx = db.transaction((batch: EventEnvelope[]) => {
    for (const event of batch) fold.apply(event, ledger);
    db.prepare(
      `INSERT INTO fold_cursors (fold, last_event_id) VALUES (?, ?)
       ON CONFLICT(fold) DO UPDATE SET last_event_id = excluded.last_event_id`
    ).run(fold.name, batch[batch.length - 1].id);
  });
  tx(events);
  return events.length;
}

/** Drain a fold to the head of the ledger. */
export function catchUp(ledger: Ledger, fold: Fold, batchSize = 500): number {
  let total = 0;
  for (;;) {
    const n = runFold(ledger, fold, batchSize);
    total += n;
    if (n < batchSize) return total;
  }
}
