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
      expires_at   INTEGER
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      tool_calls  TEXT,
      segments    TEXT,
      timestamp   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
  `);
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
  };
}

export function listSessions(db: Database.Database): ChatSession[] {
  const rows = db.prepare(`
    SELECT * FROM chat_sessions ORDER BY pinned DESC, updated_at DESC
  `).all();
  return rows.map(rowToSession);
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
      (id, title, scope_label, scope_site_ids, created_at, updated_at, pinned, action_count, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      scope_label = excluded.scope_label,
      scope_site_ids = excluded.scope_site_ids,
      updated_at = excluded.updated_at,
      pinned = excluded.pinned,
      action_count = excluded.action_count,
      expires_at = excluded.expires_at
  `);

  const upsertMessage = db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, tool_calls, segments, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      tool_calls = excluded.tool_calls,
      segments = excluded.segments
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
      );
    }
  });
  tx();
}

export function deleteSession(db: Database.Database, sessionId: string): void {
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
}

export function pruneSessions(db: Database.Database, nowMs: number = Date.now()): void {
  db.prepare(
    'DELETE FROM chat_sessions WHERE pinned = 0 AND expires_at IS NOT NULL AND expires_at < ?',
  ).run(nowMs);
}
