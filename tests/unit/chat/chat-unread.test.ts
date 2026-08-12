/**
 * Unread chat sessions — what the collapsed panel tab's badge counts.
 *
 * "Waiting on you" is deliberately NOT derived from `updated_at`: a message the user
 * sends bumps it too, so a question you just asked would badge itself. It is derived
 * from the newest message's role plus `last_read_at`, which is what these pin.
 */
import Database from 'better-sqlite3';
import {
  createSessionTables,
  saveSession,
  countUnreadSessions,
  markSessionRead,
} from '../../../src/main/ipc/chat-sessions';
import type { ChatSession, ChatMessage } from '../../../src/common/types';

function db() {
  const d = new Database(':memory:');
  createSessionTables(d);
  return d;
}

function session(id: string, over: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    title: id,
    scopeLabel: 'All sites',
    scopeSiteIds: [],
    createdAt: 1000,
    updatedAt: 1000,
    pinned: false,
    actionCount: 0,
    expiresAt: null,
    ...over,
  };
}

function msg(sessionId: string, role: ChatMessage['role'], timestamp: number): ChatMessage {
  return { id: `${sessionId}-${role}-${timestamp}`, sessionId, role, content: 'x', timestamp };
}

describe('countUnreadSessions', () => {
  it('counts a session whose newest message is from the assistant and never read', () => {
    const d = db();
    saveSession(d, session('s1'), [msg('s1', 'user', 100), msg('s1', 'assistant', 200)]);
    expect(countUnreadSessions(d)).toBe(1);
  });

  it('does not count a session the user spoke in last — that is waiting on the assistant', () => {
    const d = db();
    saveSession(d, session('s1'), [msg('s1', 'assistant', 100), msg('s1', 'user', 200)]);
    expect(countUnreadSessions(d)).toBe(0);
  });

  it('stops counting once the session is marked read', () => {
    const d = db();
    saveSession(d, session('s1'), [msg('s1', 'user', 100), msg('s1', 'assistant', 200)]);
    markSessionRead(d, 's1', 300);
    expect(countUnreadSessions(d)).toBe(0);
  });

  it('counts again when a newer reply arrives after it was read', () => {
    const d = db();
    saveSession(d, session('s1'), [msg('s1', 'user', 100), msg('s1', 'assistant', 200)]);
    markSessionRead(d, 's1', 300);
    saveSession(d, session('s1'), [msg('s1', 'assistant', 400)]);
    expect(countUnreadSessions(d)).toBe(1);
  });

  it('ignores an empty session — nothing has been said, so nothing waits', () => {
    const d = db();
    saveSession(d, session('s1'), []);
    expect(countUnreadSessions(d)).toBe(0);
  });

  it('counts each waiting session once, not each unread message', () => {
    const d = db();
    saveSession(d, session('s1'), [msg('s1', 'user', 100), msg('s1', 'assistant', 200)]);
    saveSession(d, session('s2'), [msg('s2', 'assistant', 150), msg('s2', 'assistant', 250)]);
    saveSession(d, session('s3'), [msg('s3', 'assistant', 100), msg('s3', 'user', 300)]);
    expect(countUnreadSessions(d)).toBe(2);
  });

  it('treats a session that predates last_read_at as unread — nobody has looked since it arrived', () => {
    // The migration adds last_read_at as NULL. COALESCE turns that into 0 rather than
    // "now", so an existing conversation whose last word was the assistant's shows up
    // on first upgrade instead of being silently swallowed.
    const d = db();
    saveSession(d, session('s1'), [msg('s1', 'assistant', 200)]);
    const row = d.prepare('SELECT last_read_at FROM chat_sessions WHERE id = ?').get('s1') as any;
    expect(row.last_read_at).toBeNull();
    expect(countUnreadSessions(d)).toBe(1);
  });

  it('saveSession does not clear last_read_at — markSessionRead is the only writer', () => {
    const d = db();
    saveSession(d, session('s1'), [msg('s1', 'assistant', 200)]);
    markSessionRead(d, 's1', 300);
    // A later save that carries no reply must not mark the session unread again.
    saveSession(d, session('s1', { title: 'renamed', updatedAt: 500 }), []);
    expect(countUnreadSessions(d)).toBe(0);
  });
});
