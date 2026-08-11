import Database from 'better-sqlite3';
import {
  createSessionTables,
  listSessions,
  getSession,
  saveSession,
  deleteSession,
  deleteAllSessions,
  pruneSessions,
} from '../../../src/main/ipc/chat-sessions';
import type { ChatSession, ChatMessage } from '../../../src/common/types';

function makeDb() {
  const db = new Database(':memory:');
  createSessionTables(db);
  return db;
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'sess-1',
    title: 'Test session',
    scopeLabel: 'All sites',
    scopeSiteIds: ['site-a'],
    createdAt: 1000,
    updatedAt: 2000,
    pinned: false,
    actionCount: 0,
    expiresAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    role: 'user',
    content: 'Hello',
    timestamp: 1500,
    ...overrides,
  };
}

describe('createSessionTables', () => {
  it('creates tables without error', () => {
    const db = new Database(':memory:');
    expect(() => createSessionTables(db)).not.toThrow();
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    createSessionTables(db);
    expect(() => createSessionTables(db)).not.toThrow();
  });
});

describe('saveSession + listSessions', () => {
  it('persists a session and returns it in list', () => {
    const db = makeDb();
    const sess = makeSession();
    saveSession(db, sess, []);
    const list = listSessions(db);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sess-1');
    expect(list[0].scopeSiteIds).toEqual(['site-a']);
  });

  it('returns pinned sessions first', () => {
    const db = makeDb();
    saveSession(db, makeSession({ id: 'a', updatedAt: 100, pinned: false }), []);
    saveSession(db, makeSession({ id: 'b', updatedAt: 200, pinned: true }), []);
    const list = listSessions(db);
    expect(list[0].id).toBe('b');
    expect(list[1].id).toBe('a');
  });

  it('upserts a session on second save', () => {
    const db = makeDb();
    const sess = makeSession({ title: 'Original' });
    saveSession(db, sess, []);
    saveSession(db, { ...sess, title: 'Updated' }, []);
    const list = listSessions(db);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Updated');
  });
});

describe('getSession', () => {
  it('returns session with messages', () => {
    const db = makeDb();
    const sess = makeSession();
    const msg = makeMessage();
    saveSession(db, sess, [msg]);
    const result = getSession(db, 'sess-1');
    expect(result?.session.id).toBe('sess-1');
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0].content).toBe('Hello');
  });

  it('returns null for unknown session', () => {
    const db = makeDb();
    expect(getSession(db, 'missing')).toBeNull();
  });
});

describe('deleteSession', () => {
  it('removes session and cascades to messages', () => {
    const db = makeDb();
    saveSession(db, makeSession(), [makeMessage()]);
    deleteSession(db, 'sess-1');
    expect(getSession(db, 'sess-1')).toBeNull();
    const msgCount = (db.prepare('SELECT COUNT(*) as n FROM chat_messages WHERE session_id = ?').get('sess-1') as any).n;
    expect(msgCount).toBe(0);
  });
});

describe('deleteAllSessions', () => {
  it('deletes all sessions and their messages via CASCADE', () => {
    const db = makeDb();
    const msg1: ChatMessage = {
      id: 'msg-1',
      sessionId: 'sess-1',
      role: 'user',
      content: 'Hello',
      timestamp: 1000,
    };
    const msg2: ChatMessage = {
      id: 'msg-2',
      sessionId: 'sess-2',
      role: 'assistant',
      content: 'Hi',
      timestamp: 2000,
    };

    saveSession(db, makeSession({ id: 'sess-1', pinned: false }), [msg1]);
    saveSession(db, makeSession({ id: 'sess-2', pinned: false }), [msg2]);

    // Verify both sessions and messages exist
    expect(listSessions(db)).toHaveLength(2);
    const msgCount = (db.prepare('SELECT COUNT(*) as n FROM chat_messages').get() as any).n;
    expect(msgCount).toBe(2);

    // Delete all
    deleteAllSessions(db);

    // Both sessions and messages should be gone
    expect(listSessions(db)).toHaveLength(0);
    const msgCountAfter = (db.prepare('SELECT COUNT(*) as n FROM chat_messages').get() as any).n;
    expect(msgCountAfter).toBe(0);
  });

  it('deletes pinned sessions (unlike pruneSessions)', () => {
    const db = makeDb();
    saveSession(db, makeSession({ id: 'pinned', pinned: true }), []);
    saveSession(db, makeSession({ id: 'unpinned', pinned: false }), []);

    deleteAllSessions(db);

    // Both should be deleted
    expect(listSessions(db)).toHaveLength(0);
  });

  it('is a no-op when no sessions exist', () => {
    const db = makeDb();
    expect(() => deleteAllSessions(db)).not.toThrow();
    expect(listSessions(db)).toHaveLength(0);
  });
});

describe('pruneSessions', () => {
  it('deletes expired non-pinned sessions', () => {
    const db = makeDb();
    const now = Date.now();
    saveSession(db, makeSession({ id: 'expired', expiresAt: now - 1000, pinned: false }), []);
    saveSession(db, makeSession({ id: 'live', expiresAt: now + 100000, pinned: false }), []);
    saveSession(db, makeSession({ id: 'pinned', expiresAt: now - 1000, pinned: true }), []);
    pruneSessions(db, now);
    const list = listSessions(db);
    const ids = list.map((s) => s.id);
    expect(ids).not.toContain('expired');
    expect(ids).toContain('live');
    expect(ids).toContain('pinned');
  });
});
