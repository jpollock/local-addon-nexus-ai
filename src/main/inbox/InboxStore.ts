import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import type { InboxItem, InboxItemInput, InboxKind, InboxStatus } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inbox_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT    NOT NULL,
  code          TEXT    NOT NULL,
  scope         TEXT    NOT NULL,
  scope_label   TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  detail        TEXT,
  evidence      TEXT,
  severity      TEXT,
  status        TEXT    NOT NULL DEFAULT 'open',
  decision      TEXT,
  decided_at    INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  seen_count    INTEGER NOT NULL DEFAULT 1,
  payload       TEXT,
  UNIQUE (source, code, scope)
);
CREATE INDEX IF NOT EXISTS idx_inbox_open
  ON inbox_items (status, kind, last_seen_at DESC);
`;

/** Default page size. No caller may request an unbounded list. */
export const INBOX_PAGE_SIZE = 100;

/**
 * Strip the parts of an error message that vary between otherwise-identical
 * failures, so the same fault hashes to the same code every time.
 *
 * This is load-bearing, not cosmetic. `failureCode` used to hash the raw
 * message, and real messages carry ports, temp paths, request ids and
 * timestamps — so every occurrence of one recurring fault minted a NEW
 * permanent row, and `shouldAutoPause`'s "three identical messages" test could
 * never fire, so the agent kept running and kept minting. That is the single
 * input that falsifies this design's claim to be volume-agnostic.
 *
 * Deliberately conservative: it removes things that are never the identity of a
 * fault, and leaves everything else alone. Over-normalising is the opposite
 * failure — two genuinely different bugs collapsing into one row.
 */
export function normalizeFailureMessage(message: string): string {
  return message
    // ISO-8601 timestamps
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<ts>')
    // UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    // hex addresses and long hex runs (checksums, object ids)
    .replace(/\b0x[0-9a-f]+\b/gi, '<addr>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    // absolute POSIX paths, including the temp dirs that change per run
    .replace(/(?:\/[\w.@-]+){2,}\/?/g, '<path>')
    // :port
    .replace(/:\d{2,5}\b/g, ':<port>')
    // any remaining multi-digit run (line numbers, byte counts, retry counts)
    .replace(/\b\d{2,}\b/g, '<n>')
    .trim();
}

/**
 * Stable code for a failure, whose message is free text rather than a check id.
 *
 * The message is normalised first (see above) and bounded before hashing — an
 * unbounded message is both a hashing cost and, far more often, a stack trace
 * whose tail is pure noise.
 */
export function failureCode(message: string): string {
  const normalized = normalizeFailureMessage(message).slice(0, 500);
  return 'fail:' + createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function encodePayload(payload: unknown): string | null {
  if (payload === undefined) return null;
  try {
    return JSON.stringify(payload);
  } catch {
    // A cyclic or otherwise unserializable payload must not cost us the item.
    return null;
  }
}

interface Row {
  id: number; source: string; code: string; scope: string; scope_label: string;
  kind: string; title: string; detail: string | null; evidence: string | null;
  severity: string | null; status: string; decision: string | null;
  decided_at: number | null; first_seen_at: number; last_seen_at: number;
  seen_count: number; payload: string | null;
}

export function toItem(r: Row): InboxItem {
  let payload: unknown;
  if (r.payload) { try { payload = JSON.parse(r.payload); } catch { payload = undefined; } }
  return {
    id: r.id,
    source: r.source,
    code: r.code,
    scope: r.scope,
    scopeLabel: r.scope_label,
    kind: r.kind as InboxKind,
    title: r.title,
    detail: r.detail ?? undefined,
    evidence: r.evidence ?? undefined,
    severity: r.severity ?? undefined,
    status: r.status as InboxStatus,
    decision: r.decision ?? undefined,
    decidedAt: r.decided_at ?? undefined,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    seenCount: r.seen_count,
    payload,
  };
}

export class InboxStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  /**
   * Record a sighting. A re-report of the same (source, code, scope) UPDATES.
   *
   * `status`, `decision`, `decided_at` and `first_seen_at` are deliberately
   * absent from the DO UPDATE SET. That omission is the load-bearing line in
   * this file: it is what makes a user's decision survive the next sweep.
   * Without it every sweep un-dismisses everything.
   */
  record(input: InboxItemInput, now: number = Date.now()): void {
    this.db.prepare(`
      INSERT INTO inbox_items
        (source, code, scope, scope_label, kind, title, detail, evidence,
         severity, first_seen_at, last_seen_at, seen_count, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(source, code, scope) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        seen_count   = inbox_items.seen_count + 1,
        scope_label  = excluded.scope_label,
        kind         = excluded.kind,
        title        = excluded.title,
        detail       = excluded.detail,
        evidence     = excluded.evidence,
        severity     = excluded.severity,
        payload      = excluded.payload
    `).run(
      input.source, input.code, input.scope, input.scopeLabel, input.kind,
      input.title, input.detail ?? null, input.evidence ?? null,
      input.severity ?? null, now, now,
      encodePayload(input.payload),
    );
  }

  /** Open items, newest sighting first, bounded. `total` is the full open count. */
  listOpen(limit: number = INBOX_PAGE_SIZE): { items: InboxItem[]; total: number } {
    const rows = this.db.prepare(`
      SELECT * FROM inbox_items WHERE status = 'open'
      ORDER BY last_seen_at DESC, id DESC LIMIT ?
    `).all(limit) as Row[];
    const total = (this.db.prepare(
      `SELECT COUNT(*) AS n FROM inbox_items WHERE status = 'open'`,
    ).get() as { n: number }).n;
    return { items: rows.map(toItem), total };
  }

  /** Recently decided items (dismissed or done), newest decision first, bounded. */
  listRecentlyDecided(limit: number = 20): InboxItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM inbox_items WHERE status != 'open'
      ORDER BY decided_at DESC, id DESC LIMIT ?
    `).all(limit) as Row[];
    return rows.map(toItem);
  }

  /** Record the user's decision. Survives every later re-report. */
  decide(
    id: number,
    decision: string,
    status: 'dismissed' | 'done',
    now: number = Date.now(),
  ): void {
    this.db.prepare(`
      UPDATE inbox_items SET status = ?, decision = ?, decided_at = ? WHERE id = ?
    `).run(status, decision, now, id);
  }

  /**
   * Return a decided item to the queue.
   *
   * This reverses the DECISION, not the change the decision caused. Reversing a
   * live change is the staging-and-revert problem this spec deliberately does
   * not solve — no copy on this surface may imply otherwise.
   */
  reopen(id: number, _now: number = Date.now()): void {
    this.db.prepare(`
      UPDATE inbox_items SET status = 'open', decision = NULL, decided_at = NULL
      WHERE id = ?
    `).run(id);
  }

  /** Every item regardless of status, bounded. Diagnostics and tests. */
  listAll(limit: number = INBOX_PAGE_SIZE): InboxItem[] {
    return (this.db.prepare(`
      SELECT * FROM inbox_items ORDER BY last_seen_at DESC, id DESC LIMIT ?
    `).all(limit) as Row[]).map(toItem);
  }

  /** Open counts per group. Always carries all three keys, zero included. */
  countsByKind(): Record<InboxKind, number> {
    const out: Record<InboxKind, number> = { decide: 0, problem: 0, know: 0 };
    const rows = this.db.prepare(`
      SELECT kind, COUNT(*) AS n FROM inbox_items WHERE status = 'open' GROUP BY kind
    `).all() as Array<{ kind: string; n: number }>;
    for (const r of rows) {
      if (r.kind in out) out[r.kind as InboxKind] = r.n;
    }
    return out;
  }

  /** Open counts per agent — the single source for per-agent pending badges. */
  pendingBySource(): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT source, COUNT(*) AS n FROM inbox_items WHERE status = 'open' GROUP BY source
    `).all() as Array<{ source: string; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.source] = r.n;
    return out;
  }

  /**
   * Forget decided items that have not recurred, and cap runaway growth.
   *
   * Two rules, and the split between them matters:
   *
   * 1. **Decided AND not seen for `maxAgeDays`.** Both halves are required. An
   *    item that is still being re-reported keeps its `last_seen_at` fresh and
   *    is never pruned however old the decision is — dropping it would let the
   *    next sweep resurrect it as `open`, silently undoing a dismissal, which
   *    is the one property this store exists to guarantee. Only a decided
   *    problem that has genuinely stopped happening is forgotten.
   *
   * 2. **A per-source cap on OPEN items**, oldest first. This is the backstop
   *    for the failure that `normalizeFailureMessage` is meant to prevent: if
   *    some fault still manages to mint a fresh code every run, the table stops
   *    growing without bound rather than degrading the whole surface. It should
   *    never fire in normal operation — `log()` it if it does, because it means
   *    the normaliser has a hole.
   */
  prune(maxAgeDays = 90, maxOpenPerSource = 500, now: number = Date.now()): number {
    const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

    const aged = this.db.prepare(`
      DELETE FROM inbox_items WHERE status != 'open' AND last_seen_at < ?
    `).run(cutoff).changes;

    const capped = this.db.prepare(`
      DELETE FROM inbox_items WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY source ORDER BY last_seen_at DESC, id DESC
          ) AS rn
          FROM inbox_items WHERE status = 'open'
        ) WHERE rn > ?
      )
    `).run(maxOpenPerSource).changes;

    return aged + capped;
  }
}
