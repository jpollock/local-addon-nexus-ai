import type Database from 'better-sqlite3';
import type { ChatSession, ChatMessage } from '../../common/types';

export function createSessionTables(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      scope_label  TEXT NOT NULL,
      scope_site_ids TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      pinned       INTEGER NOT NULL DEFAULT 0,
      action_count INTEGER NOT NULL DEFAULT 0,
      expires_at   INTEGER,
      -- When the user last looked at this session. Unread is derived from this
      -- and the newest message's role, never from updated_at: a user's own
      -- message bumps updated_at too, which would mark a session you just typed
      -- in as waiting on you.
      last_read_at INTEGER,
      -- Board D: the outcome-at-a-glance line ("rb.x · 2 of 2 verified").
      -- Derived at save time; NULL on sessions that predate it or armed nothing... see saveSession.
      outcome_meta TEXT
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      tool_calls  TEXT,
      segments    TEXT,
      timestamp   INTEGER NOT NULL,
      incomplete  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
  `);
  // Migration: add incomplete column to existing tables
  try {
    const tableInfo = db.pragma('table_info(chat_messages)') as Array<{ name: string }>;
    const hasIncomplete = tableInfo.some((col) => col.name === 'incomplete');
    if (!hasIncomplete) {
      db.exec('ALTER TABLE chat_messages ADD COLUMN incomplete INTEGER');
    }
  } catch (e) {
    // Table doesn't exist yet; creation above will include the column
  }
  // Migration: add last_read_at to sessions that predate the unread badge.
  // NULL means never read, which COALESCE turns into 0 — so an existing session
  // whose last message is from the assistant reads as unread on first upgrade.
  // That is the honest answer: nobody has looked at it since it arrived.
  try {
    const tableInfo = db.pragma('table_info(chat_sessions)') as Array<{ name: string }>;
    if (!tableInfo.some((col) => col.name === 'last_read_at')) {
      db.exec('ALTER TABLE chat_sessions ADD COLUMN last_read_at INTEGER');
    }
  } catch (e) {
    // Table doesn't exist yet; creation above will include the column
  }
  // Migration: outcome_meta (board D). Existing rows stay NULL — an outcome
  // nobody derived is not backfilled with a guess.
  try {
    const tableInfo = db.pragma('table_info(chat_sessions)') as Array<{ name: string }>;
    if (!tableInfo.some((col) => col.name === 'outcome_meta')) {
      db.exec('ALTER TABLE chat_sessions ADD COLUMN outcome_meta TEXT');
    }
  } catch (e) {
    // Table doesn't exist yet; creation above will include the column
  }
}

function rowToSession(row: any): ChatSession {
  return {
    id: row.id,
    title: row.title,
    scopeLabel: row.scope_label,
    scopeSiteIds: JSON.parse(row.scope_site_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: row.pinned === 1,
    actionCount: row.action_count,
    expiresAt: row.expires_at ?? null,
    lastReadAt: row.last_read_at ?? null,
    outcomeMeta: row.outcome_meta ?? null,
  };
}

function rowToMessage(row: any): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    segments: row.segments ? JSON.parse(row.segments) : undefined,
    timestamp: row.timestamp,
    incomplete: row.incomplete === 1 ? true : undefined,
  };
}

export function listSessions(db: Database.Database): ChatSession[] {
  const rows = db.prepare(`
    SELECT * FROM chat_sessions ORDER BY pinned DESC, updated_at DESC
  `).all();
  return rows.map(rowToSession);
}

/**
 * How many sessions are waiting on the user.
 *
 * A session counts when its NEWEST message is from the assistant and arrived
 * after the user last looked. Both halves matter: without the role check a
 * question you just asked would count as waiting on you, and without the
 * timestamp check a session would stay badged forever until you replied to it.
 *
 * Deliberately not derived from `updated_at` — that moves when the user sends,
 * too, so it cannot distinguish "they answered" from "I typed".
 */
export function countUnreadSessions(db: Database.Database): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS n
    FROM chat_sessions s
    JOIN (
      SELECT session_id, role, timestamp,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp DESC) AS rn
      FROM chat_messages
    ) m ON m.session_id = s.id AND m.rn = 1
    WHERE m.role = 'assistant'
      AND m.timestamp > COALESCE(s.last_read_at, 0)
  `).get() as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Stamp a session as seen. Called when it is opened, and when its stream ends while open. */
export function markSessionRead(db: Database.Database, sessionId: string, now: number = Date.now()): void {
  db.prepare('UPDATE chat_sessions SET last_read_at = ? WHERE id = ?').run(now, sessionId);
}

export function getSession(
  db: Database.Database,
  sessionId: string,
): { session: ChatSession; messages: ChatMessage[] } | null {
  const sessRow = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
  if (!sessRow) return null;
  const msgRows = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
  return { session: rowToSession(sessRow), messages: msgRows.map(rowToMessage) };
}

export function saveSession(
  db: Database.Database,
  session: ChatSession,
  messages: ChatMessage[],
): void {
  const upsertSession = db.prepare(`
    INSERT INTO chat_sessions
      (id, title, scope_label, scope_site_ids, created_at, updated_at, pinned, action_count, expires_at, outcome_meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      scope_label = excluded.scope_label,
      scope_site_ids = excluded.scope_site_ids,
      updated_at = excluded.updated_at,
      pinned = excluded.pinned,
      action_count = excluded.action_count,
      expires_at = excluded.expires_at,
      outcome_meta = excluded.outcome_meta
  `);

  const upsertMessage = db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, tool_calls, segments, timestamp, incomplete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      tool_calls = excluded.tool_calls,
      segments = excluded.segments,
      incomplete = excluded.incomplete
  `);

  const tx = db.transaction(() => {
    upsertSession.run(
      session.id,
      session.title,
      session.scopeLabel,
      JSON.stringify(session.scopeSiteIds),
      session.createdAt,
      session.updatedAt,
      session.pinned ? 1 : 0,
      session.actionCount,
      session.expiresAt ?? null,
      session.outcomeMeta ?? null,
    );
    for (const msg of messages) {
      upsertMessage.run(
        msg.id,
        msg.sessionId,
        msg.role,
        msg.content,
        msg.toolCalls != null ? JSON.stringify(msg.toolCalls) : null,
        msg.segments != null ? JSON.stringify(msg.segments) : null,
        msg.timestamp,
        msg.incomplete === true ? 1 : null,
      );
    }
  });
  tx();
}

export function deleteSession(db: Database.Database, sessionId: string): void {
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
}

export function deleteAllSessions(db: Database.Database): void {
  db.prepare('DELETE FROM chat_sessions').run();
}

export function pruneSessions(db: Database.Database, nowMs: number = Date.now()): void {
  db.prepare(
    'DELETE FROM chat_sessions WHERE pinned = 0 AND expires_at IS NOT NULL AND expires_at < ?',
  ).run(nowMs);
}
