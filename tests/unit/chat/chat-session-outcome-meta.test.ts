/**
 * fixes-082526 · board D — outcomeMeta rides the session record.
 *
 * The derived meta line ("rb.bulk-plugin-update · 2 of 2 verified") is a fact
 * about a finished run; the sessions list renders it under the title. It must
 * survive the save→list round trip, and the column must arrive on databases
 * that predate it — same ALTER TABLE discipline as `incomplete` and
 * `last_read_at` above it in createSessionTables.
 */
import Database from 'better-sqlite3';
import { createSessionTables, saveSession, listSessions } from '../../../src/main/ipc/chat-sessions';
import type { ChatSession } from '../../../src/common/types';

function freshDb() {
  const d = new Database(':memory:');
  createSessionTables(d);
  return d;
}

function session(id: string, over: Partial<ChatSession> = {}): ChatSession {
  return {
    id, title: id, scopeLabel: 'All sites', scopeSiteIds: [],
    createdAt: 1000, updatedAt: 1000, pinned: false, actionCount: 0, expiresAt: null,
    ...over,
  };
}

describe('outcomeMeta persistence', () => {
  it('round-trips save → list', () => {
    const d = freshDb();
    saveSession(d, session('s1', { outcomeMeta: 'rb.bulk-plugin-update · 2 of 2 verified' }), []);
    expect(listSessions(d)[0].outcomeMeta).toBe('rb.bulk-plugin-update · 2 of 2 verified');
  });

  it('absent stays null — never an empty string pretending to be an outcome', () => {
    const d = freshDb();
    saveSession(d, session('s1'), []);
    expect(listSessions(d)[0].outcomeMeta ?? null).toBeNull();
  });

  it('a database that predates the column gains it on the next createSessionTables', () => {
    const d = new Database(':memory:');
    // The pre-board-D schema, verbatim minus the new column.
    d.exec(`CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, scope_label TEXT NOT NULL,
      scope_site_ids TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0, action_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER, last_read_at INTEGER
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, tool_calls TEXT, segments TEXT,
      timestamp INTEGER NOT NULL, incomplete INTEGER
    );`);
    d.prepare(`INSERT INTO chat_sessions (id,title,scope_label,scope_site_ids,created_at,updated_at)
      VALUES ('old','Old','All sites','[]',1,1)`).run();

    createSessionTables(d); // the upgrade path
    saveSession(d, session('new', { outcomeMeta: 'no run armed' }), []);

    const byId = Object.fromEntries(listSessions(d).map((s) => [s.id, s]));
    expect(byId.new.outcomeMeta).toBe('no run armed');
    expect(byId.old.outcomeMeta ?? null).toBeNull(); // the old row is not backfilled with a guess
  });
});
