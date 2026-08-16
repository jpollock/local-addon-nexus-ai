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

function persist(
  db: Database.Database,
  sessionId: string,
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>,
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
      timestamp: 1000 + i,
    })) as ChatMessage[],
  );
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
