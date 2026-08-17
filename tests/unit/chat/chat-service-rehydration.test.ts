/**
 * Rehydrated Docked Panel sessions must still carry the system prompt.
 *
 * The renderer persists user/assistant text only (`PanelChat.persistSession`
 * filters `m.role !== 'system'`), so `ChatService.sendMessage`'s restore branch
 * used to hand the provider a message array with NO system message at all — no
 * fleet context, no tool doctrine, and no UNTRUSTED_DATA_DIRECTIVE, which is the
 * prompt-injection defense. Reopening an old session is an ordinary user action,
 * so that was a live gap on the most common resumption path in the product.
 *
 * The prompt is REBUILT on restore, never persisted: a stored prompt goes stale
 * (fleet context is current-state), and rebuilding is what keeps a restored
 * session equivalent to a fresh one.
 */
import Database from 'better-sqlite3';
import { ChatService, ChatServiceDeps } from '../../../src/main/chat/ChatService';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { createSessionTables, saveSession } from '../../../src/main/ipc/chat-sessions';
import { UNTRUSTED_DATA_DIRECTIVE } from '../../../src/main/mcp/pii';
import type { NexusServices } from '../../../src/main/mcp/types';
import type { ChatSession, ChatMessage } from '../../../src/common/types';

// ---------------------------------------------------------------------------
// Harness — a provider that records exactly what it was handed
// ---------------------------------------------------------------------------

let mockProviderInstance: any = null;

jest.mock('../../../src/main/chat/providers/index', () => ({
  getProvider: () => mockProviderInstance,
  initializeProviders: () => {},
  listProviders: () => [],
}));

/** The message array the provider received on the last turn. */
let seenMessages: Array<{ role: string; content: string }> = [];

function recordingProvider() {
  return {
    id: 'mock',
    displayName: 'Mock',
    requiresApiKey: false,
    defaultModels: ['mock-model'],
    async *streamChat(messages: Array<{ role: string; content: string }>) {
      seenMessages = messages;
      yield { type: 'token', text: 'ok' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
    async listModels() { return ['mock-model']; },
    async validateKey() { return null; },
  };
}

function memoryDb() {
  const d = new Database(':memory:');
  createSessionTables(d);
  return d;
}

function mockServices(db?: Database.Database): NexusServices {
  return {
    siteData: { getSite: () => null, getSites: () => ({}) },
    indexRegistry: { get: () => null, listAll: () => [] },
    fileScanner: { scan: async () => ({ wpVersion: '', phpVersion: '', themes: [], plugins: [] }) },
    ...(db ? { graphService: { getDb: () => db } } : {}),
  } as any;
}

function serviceWith(db?: Database.Database): ChatService {
  const deps: ChatServiceDeps = {
    registry: new ToolRegistry(),
    services: mockServices(db),
    sendToRenderer: () => {},
  };
  return new ChatService(deps);
}

/**
 * A persisted row as the renderer writes it. `incomplete` and `timestamp` are
 * optional so the four original cases keep their exact shape (timestamps
 * derived from position); the ported cases below need both.
 */
type PersistedRow = Pick<ChatMessage, 'role' | 'content'> &
  Partial<Pick<ChatMessage, 'incomplete' | 'timestamp'>>;

function persist(
  db: Database.Database,
  sessionId: string,
  messages: PersistedRow[],
): void {
  const session: ChatSession = {
    id: sessionId,
    title: sessionId,
    scopeLabel: 'All sites',
    scopeSiteIds: [],
    createdAt: 1000,
    updatedAt: 1000,
    pinned: false,
    actionCount: 0,
    expiresAt: null,
  };
  saveSession(
    db,
    session,
    messages.map((m, i) => ({
      id: `${sessionId}-${i}`,
      sessionId,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp ?? 1000 + i,
      incomplete: m.incomplete,
    })) as ChatMessage[],
  );
}

/** What the provider was handed, minus the rebuilt system prompt. */
function restoredHistory() {
  return seenMessages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
}

const providerConfig = { providerId: 'mock', model: 'mock-model' };

function systemMessages() {
  return seenMessages.filter((m) => m.role === 'system');
}

beforeEach(() => {
  mockProviderInstance = recordingProvider();
  seenMessages = [];
});

// ---------------------------------------------------------------------------

describe('ChatService — rehydrated sessions keep the system prompt', () => {
  test('a session restored from persisted history is given a freshly built system prompt', async () => {
    const db = memoryDb();
    persist(db, 'panel-session', [
      { role: 'user', content: 'which sites are outdated?' },
      { role: 'assistant', content: 'Let me check.' },
    ]);

    await serviceWith(db).sendMessage('panel-session', 'and now?', providerConfig);

    expect(seenMessages[0].role).toBe('system');
    expect(seenMessages[0].content).toContain(UNTRUSTED_DATA_DIRECTIVE);

    // The restored history still follows it, in order, with the new turn last.
    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(seenMessages[1].content).toBe('which sites are outdated?');
    expect(seenMessages[3].content).toBe('and now?');
  });

  test('a legacy session that persisted a system row does not end up with two', async () => {
    const db = memoryDb();
    persist(db, 'legacy-session', [
      { role: 'system', content: 'STALE PROMPT FROM AN OLDER BUILD' },
      { role: 'user', content: 'hello' },
    ]);

    await serviceWith(db).sendMessage('legacy-session', 'again', providerConfig);

    expect(systemMessages()).toHaveLength(1);
    expect(seenMessages[0].role).toBe('system');
    expect(seenMessages[0].content).toContain(UNTRUSTED_DATA_DIRECTIVE);
    expect(seenMessages.map((m) => m.content)).not.toContain('STALE PROMPT FROM AN OLDER BUILD');
  });

  test('a fresh session still gets exactly one system message', async () => {
    const db = memoryDb(); // present but holds nothing for this session

    await serviceWith(db).sendMessage('brand-new', 'hi', providerConfig);

    expect(systemMessages()).toHaveLength(1);
    expect(seenMessages[0].role).toBe('system');
    expect(seenMessages[0].content).toContain(UNTRUSTED_DATA_DIRECTIVE);
    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  test('the never-persisted path (ChatTab: no session store at all) is unaffected', async () => {
    // ChatTab never calls CHAT_SESSION_SAVE, so nothing is ever restored for it.
    await serviceWith(undefined).sendMessage('chat-tab-session', 'hi', providerConfig);

    expect(systemMessages()).toHaveLength(1);
    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(seenMessages[0].content).toContain(UNTRUSTED_DATA_DIRECTIVE);
  });
});

// ---------------------------------------------------------------------------
// WP-12b · ported from tests/unit/chat/chat-service-history.test.ts (deleted).
//
// That file declared its OWN `reconstructHistory` and imported nothing from
// `src/`, so it passed unchanged through both the WP-12 restore bug and its
// fix — the proof of vacuity. Each semantic it pinned is re-pinned below
// against the real `ChatService.sendMessage` restore branch, or waived:
//
//   S1/S2  user + assistant rows map to role+content pairs  → ported
//   S3     persisted system rows are KEPT                   → WAIVED: inverted
//          by production. The renderer never writes one and the restore branch
//          drops any that exists (WP-12, adjudicated load-bearing); the
//          opposite direction is pinned by "a legacy session that persisted a
//          system row does not end up with two", above.
//   S4     output order follows input order                 → ported, sharpened
//          to timestamp order (the copy could only see array order)
//   S5     `streaming` messages are filtered                → ported, retranslated:
//          `streaming` is a renderer-only field that does not exist on
//          ChatMessage or in `chat_messages`. `persistSession` maps it to
//          `incomplete`, which is what the restore branch actually filters.
//          The copy's fixture conflated it with empty content; both halves are
//          pinned separately below.
//   S6     roles outside {user,assistant,system} are filtered → ported
//          defensively (see the case's own note: unreachable through the typed
//          writer, reachable through the TEXT column)
//   S7     empty input → empty history                       → ported as an
//          observable; see the case's note on why no mutation distinguishes it.
// ---------------------------------------------------------------------------

describe('ChatService — what the restore path admits from persisted history', () => {
  test('[ported S1/S2] user and assistant rows reach the provider as role+content pairs', async () => {
    const db = memoryDb();
    persist(db, 'multi-turn', [
      { role: 'user', content: 'which sites are outdated?' },
      { role: 'assistant', content: 'Three of them.' },
      { role: 'user', content: 'which ones?' },
      { role: 'assistant', content: 'alpha, beta, gamma.' },
    ]);

    await serviceWith(db).sendMessage('multi-turn', 'update them', providerConfig);

    expect(restoredHistory()).toEqual([
      { role: 'user', content: 'which sites are outdated?' },
      { role: 'assistant', content: 'Three of them.' },
      { role: 'user', content: 'which ones?' },
      { role: 'assistant', content: 'alpha, beta, gamma.' },
      { role: 'user', content: 'update them' },
    ]);
  });

  test('[ported S4] history is restored in timestamp order, not insertion order', async () => {
    // The copy mapped an in-memory array, so it could only ever pin "same order
    // out as in". The real path reads rows back through `getSession`, whose
    // ORDER BY is the only thing keeping a reopened conversation coherent.
    const db = memoryDb();
    persist(db, 'out-of-order', [
      { role: 'assistant', content: 'second', timestamp: 2000 },
      { role: 'user', content: 'first', timestamp: 1000 },
      { role: 'assistant', content: 'third', timestamp: 3000 },
    ]);

    await serviceWith(db).sendMessage('out-of-order', 'next', providerConfig);

    expect(restoredHistory().map((m) => m.content)).toEqual(['first', 'second', 'third', 'next']);
  });

  test('[ported S5] a mid-stream (incomplete) assistant row is not restored', async () => {
    // The reachable shape: the panel is closed while a response is streaming.
    // `persistSession` writes the partial text with `incomplete: true` — with
    // NON-empty content, so this case isolates the incomplete filter from the
    // empty-content filter the copy's fixture conflated it with.
    const db = memoryDb();
    persist(db, 'interrupted', [
      { role: 'user', content: 'explain the fleet' },
      { role: 'assistant', content: 'Sure — the fleet is', incomplete: true },
      { role: 'user', content: 'still there?' },
    ]);

    await serviceWith(db).sendMessage('interrupted', 'hello?', providerConfig);

    expect(restoredHistory()).toEqual([
      { role: 'user', content: 'explain the fleet' },
      { role: 'user', content: 'still there?' },
      { role: 'user', content: 'hello?' },
    ]);
  });

  test('[ported S5, second half] an empty-content row is not restored', async () => {
    // `persistSession` drops empty ASSISTANT messages only, so an empty user
    // row does reach the table. Anthropic rejects a message whose text block is
    // empty, which would fail the whole turn — not just lose a line.
    const db = memoryDb();
    persist(db, 'empty-row', [
      { role: 'user', content: '' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'a real question' },
    ]);

    await serviceWith(db).sendMessage('empty-row', 'and another', providerConfig);

    expect(restoredHistory()).toEqual([
      { role: 'user', content: 'a real question' },
      { role: 'user', content: 'and another' },
    ]);
  });

  test('[ported S6] a row whose role is neither user nor assistant is dropped', async () => {
    // Unreachable through the typed writer — `ChatMessage.role` is
    // 'user'|'assistant'|'system'. Reachable through the table: `role` is a
    // TEXT column and `getSession` does not validate it, so a row written by
    // any other build reaches this filter, and an unpaired `tool` message is
    // rejected outright by Anthropic. The copy pinned this with a whitelist;
    // this pins it through the handler.
    const db = memoryDb();
    persist(db, 'foreign-role', [
      { role: 'user', content: 'run the scan' },
      { role: 'tool' as ChatMessage['role'], content: '{"result":"ok"}' },
      { role: 'assistant', content: 'Scan complete.' },
    ]);

    await serviceWith(db).sendMessage('foreign-role', 'thanks', providerConfig);

    expect(restoredHistory()).toEqual([
      { role: 'user', content: 'run the scan' },
      { role: 'assistant', content: 'Scan complete.' },
      { role: 'user', content: 'thanks' },
    ]);
  });

  test('[ported S7] a persisted session holding no message rows starts clean', async () => {
    // The copy asserted `reconstructHistory([]) === []`. Through the handler
    // the two branches CONVERGE on this input — `messages.length > 0` sends it
    // to the fresh-session branch, which builds the same prompt the restore
    // branch would — so no mutation of that gate can distinguish them. Pinned
    // as an observable (a stored-but-empty session behaves like a new one),
    // not as a branch pin; see the WP-12b notes in WORK_PACKETS.md.
    const db = memoryDb();
    persist(db, 'empty-session', []);

    await serviceWith(db).sendMessage('empty-session', 'first words', providerConfig);

    expect(systemMessages()).toHaveLength(1);
    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(restoredHistory()).toEqual([{ role: 'user', content: 'first words' }]);
  });
});
