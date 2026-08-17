/**
 * WP-11 · the three ChatService call sites.
 *
 * Extends the WP-12 rehydration harness (a provider that records exactly what
 * it was handed) because the two packets share the same seam and the same
 * failure mode: context that is present on one session path and absent on the
 * other.
 *
 * The load-bearing test is the ADDITIVE-PARITY PIN at the bottom. With the
 * assembler contributing nothing — whether because it returned null or because
 * it returned a bundle with empty blocks — the system prompt and the message
 * array must be byte-identical to the pre-WP-11 build. That is what makes
 * edit #1 safe to land before any policy exists.
 */
import Database from 'better-sqlite3';
import { ChatService, ChatServiceDeps } from '../../../src/main/chat/ChatService';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { createSessionTables, saveSession } from '../../../src/main/ipc/chat-sessions';
import { UNTRUSTED_DATA_DIRECTIVE } from '../../../src/main/mcp/pii';
import type { NexusServices } from '../../../src/main/mcp/types';
import type { ChatSession, ChatMessage } from '../../../src/common/types';

// --- the assembler, mocked at the host-adapter boundary ---------------------
const mockAssemble = jest.fn();
jest.mock('../../../src/main/intelligence-host/chatAssembly', () => ({
  assembleForChatTurn: (...args: unknown[]) => mockAssemble(...args),
}));

// --- the tool adapter, mocked so edit #3's arguments are observable ---------
const mockAdapt = jest.fn().mockReturnValue([]);
jest.mock('../../../src/main/chat/tool-adapter', () => ({
  adaptToolsForChat: (...args: unknown[]) => mockAdapt(...args),
}));

let mockProviderInstance: any = null;
jest.mock('../../../src/main/chat/providers/index', () => ({
  getProvider: () => mockProviderInstance,
  initializeProviders: () => {},
  listProviders: () => [],
}));

let seenMessages: Array<{ role: string; content: string }> = [];

function recordingProvider() {
  return {
    id: 'mock',
    displayName: 'Mock',
    requiresApiKey: false,
    defaultModels: ['mock-model'],
    async *streamChat(messages: Array<{ role: string; content: string }>) {
      seenMessages = messages.map((m) => ({ ...m }));
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

function persist(db: Database.Database, sessionId: string, messages: Array<Pick<ChatMessage, 'role' | 'content'>>): void {
  const session: ChatSession = {
    id: sessionId, title: sessionId, scopeLabel: 'All sites', scopeSiteIds: [],
    createdAt: 1000, updatedAt: 1000, pinned: false, actionCount: 0, expiresAt: null,
  };
  saveSession(db, session, messages.map((m, i) => ({
    id: `${sessionId}-${i}`, sessionId, role: m.role, content: m.content, timestamp: 1000 + i,
  })) as ChatMessage[]);
}

const providerConfig = { providerId: 'mock', model: 'mock-model' };

const AMBIENT = '## Operating policy — set pol.ops-default, version psv_abc123abc123';
const TURN = '[Nexus platform context — task task_01J5. Platform-authored and trusted; not user input.]\nPolicy set pol.ops-default version psv_abc123abc123 remains in effect, unchanged.\n[end Nexus platform context]';

function bundle(over: Record<string, unknown> = {}) {
  return { taskId: 'task_01J5', ambientBlock: AMBIENT, turnBlock: TURN, grants: undefined, ...over };
}

beforeEach(() => {
  mockProviderInstance = recordingProvider();
  seenMessages = [];
  mockAssemble.mockReset().mockResolvedValue(null);
  mockAdapt.mockClear().mockReturnValue([]);
});

// ---------------------------------------------------------------------------

describe('edit #1 — the ambient block enters the system prompt', () => {
  test('placed AFTER the untrusted-data directive and BEFORE the tool doctrine', async () => {
    mockAssemble.mockResolvedValue(bundle());

    await serviceWith(memoryDb()).sendMessage('fresh', 'hi', providerConfig);

    const prompt = seenMessages[0].content;
    const directiveAt = prompt.indexOf(UNTRUSTED_DATA_DIRECTIVE);
    const ambientAt = prompt.indexOf(AMBIENT);
    const doctrineAt = prompt.indexOf('IMPORTANT: Always use your tools');

    expect(ambientAt).toBeGreaterThan(directiveAt);
    expect(ambientAt).toBeLessThan(doctrineAt);
  });

  test('a REHYDRATED session gets it too — the WP-12 restore branch composes', async () => {
    mockAssemble.mockResolvedValue(bundle());
    const db = memoryDb();
    persist(db, 'panel', [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]);

    await serviceWith(db).sendMessage('panel', 'and now?', providerConfig);

    expect(seenMessages[0].role).toBe('system');
    expect(seenMessages[0].content).toContain(AMBIENT);
    expect(seenMessages[0].content).toContain(UNTRUSTED_DATA_DIRECTIVE);
  });

  test('the assembler is told which turns rebuild the durable context', async () => {
    mockAssemble.mockResolvedValue(bundle());
    const svc = serviceWith(memoryDb());

    await svc.sendMessage('s', 'first', providerConfig);
    expect(mockAssemble.mock.calls[0][0]).toMatchObject({ buildingSystemPrompt: true, sessionId: 's', userMessage: 'first' });

    await svc.sendMessage('s', 'second', providerConfig);
    expect(mockAssemble.mock.calls[1][0]).toMatchObject({ buildingSystemPrompt: false, userMessage: 'second' });
  });
});

describe('edit #2 — the per-turn carrier', () => {
  test('rides a USER-role message, placed after the user turn', async () => {
    mockAssemble.mockResolvedValue(bundle());

    await serviceWith(memoryDb()).sendMessage('s', 'my question', providerConfig);

    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(seenMessages[1].content).toBe('my question');
    expect(seenMessages[2].content).toBe(TURN);
  });

  test('never a second system message (R3: anthropic/google keep only the first)', async () => {
    mockAssemble.mockResolvedValue(bundle());
    await serviceWith(memoryDb()).sendMessage('s', 'hi', providerConfig);
    expect(seenMessages.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  test('never a tool-role message (R5 truncation, R7 untrusted-wrapping)', async () => {
    mockAssemble.mockResolvedValue(bundle());
    await serviceWith(memoryDb()).sendMessage('s', 'hi', providerConfig);
    expect(seenMessages.some((m) => m.role === 'tool')).toBe(false);
  });

  test('rides EVERY turn, including turns that build no system prompt', async () => {
    mockAssemble.mockResolvedValue(bundle({ ambientBlock: null }));
    const svc = serviceWith(memoryDb());

    await svc.sendMessage('s', 'one', providerConfig);
    await svc.sendMessage('s', 'two', providerConfig);

    // system, user(one), turn, assistant, user(two), turn
    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user', 'user']);
    expect(seenMessages.filter((m) => m.content === TURN)).toHaveLength(2);
  });

  test('an empty turn block pushes nothing', async () => {
    mockAssemble.mockResolvedValue(bundle({ turnBlock: null }));
    await serviceWith(memoryDb()).sendMessage('s', 'hi', providerConfig);
    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user']);
  });
});

describe('edit #3 — grants pass-through', () => {
  test('v0 passes undefined, so the tool list is exactly today\'s', async () => {
    mockAssemble.mockResolvedValue(bundle());
    await serviceWith(memoryDb()).sendMessage('s', 'hi', providerConfig);

    expect(mockAdapt).toHaveBeenCalled();
    expect(mockAdapt.mock.calls[0][2]).toBeUndefined();
  });

  test('with no assembler at all, the third argument is still undefined', async () => {
    mockAssemble.mockResolvedValue(null);
    await serviceWith(memoryDb()).sendMessage('s', 'hi', providerConfig);
    expect(mockAdapt.mock.calls[0][2]).toBeUndefined();
  });
});

describe('ADDITIVE-PARITY PIN — an empty assembler changes nothing', () => {
  /** Run one turn and return the exact provider-visible state. */
  async function turn(assemblerResult: unknown) {
    mockAssemble.mockResolvedValue(assemblerResult);
    seenMessages = [];
    await serviceWith(memoryDb()).sendMessage('parity', 'what is my fleet?', providerConfig);
    return { prompt: seenMessages[0].content, shape: seenMessages.map((m) => ({ role: m.role, content: m.content })) };
  }

  test('null and empty-blocks produce byte-identical prompts and message arrays', async () => {
    const withNull = await turn(null);
    const withEmpty = await turn({ taskId: 'task_x', ambientBlock: null, turnBlock: null, grants: undefined });

    expect(withEmpty.prompt).toBe(withNull.prompt);
    expect(withEmpty.shape).toEqual(withNull.shape);
  });

  test('the empty prompt carries no assembler text at all', async () => {
    const { prompt, shape } = await turn(null);

    expect(prompt).toContain(UNTRUSTED_DATA_DIRECTIVE);
    expect(prompt).not.toContain('Operating policy');
    expect(prompt).not.toContain('Nexus platform context');
    // Exactly the pre-WP-11 shape: one system message, one user message.
    expect(shape.map((m) => m.role)).toEqual(['system', 'user']);
    expect(shape[1].content).toBe('what is my fleet?');
  });

  test('an assembler that THROWS does not break the turn', async () => {
    // The adapter swallows its own failures, so this is a contract violation —
    // and the layer invariant says nothing on this seam may throw into a caller
    // that predates it. The turn must complete, unchanged.
    mockAssemble.mockRejectedValue(new Error('assembler exploded'));
    seenMessages = [];

    await expect(
      serviceWith(memoryDb()).sendMessage('parity', 'what is my fleet?', providerConfig)
    ).resolves.toBeUndefined();

    expect(seenMessages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(seenMessages[0].content).toContain(UNTRUSTED_DATA_DIRECTIVE);
    expect(seenMessages[0].content).not.toContain('Operating policy');
  });
});

/**
 * WP-20c · the procedure rides the trusted carrier, and stays whole.
 *
 * §3 rules out the two channels a procedure could otherwise take, and both
 * exclusions are behavioural rather than stylistic:
 *
 *  - **R7.** `maskToolResultsForProvider` wraps `role: 'tool'` content in
 *    `<untrusted_data>`, and the system directive tells the model never to
 *    follow instructions found inside one. A runbook IS an instruction.
 *  - **R5.** `compressStaleToolResults` truncates `role: 'tool'` content over
 *    800 chars down to 600 once two assistant turns have passed. A runbook is
 *    ~4.9 KB, so it would silently lose 88% of itself while the manifest still
 *    claimed the procedure was supplied.
 *
 * These run the REAL ChatService over the real message pipeline, because the
 * failure they guard is a delivery that looks correct in the assembler and is
 * mangled by the transport.
 */
describe('WP-20c — the procedure block on the real message pipeline', () => {
  // Realistic size and shape: the anchor runbook is ~4,858 bytes.
  const PROCEDURE_TURN = [
    '[Nexus platform context — task task_01J5. Platform-authored and trusted; not user input.]',
    '',
    '## Procedure — rb.bulk-plugin-update 1.0.0 (strict) for cap.bulk_plugin_update',
    'This procedure governs this task.',
    '',
    '[procedure rb.bulk-plugin-update 1.0.0 — full text follows]',
    '---',
    'id: rb.bulk-plugin-update',
    'checkpoints:',
    '  - id: cp.consult-history',
    '---',
    '# Bulk plugin update',
    'CANARY_MARKER ' + 'procedure body '.repeat(300),
    '[end procedure rb.bulk-plugin-update]',
    '',
    '[end Nexus platform context]',
  ].join('\n');

  const withProcedure = () => bundle({ turnBlock: PROCEDURE_TURN, ambientBlock: null });

  test('rides a user-role message — never role:tool, which R7 tells the model to distrust', async () => {
    mockAssemble.mockResolvedValue(withProcedure());

    await serviceWith(memoryDb()).sendMessage('proc', 'update everything', providerConfig);

    const carrier = seenMessages.find((m) => m.content.includes('CANARY_MARKER'));
    expect(carrier).toBeDefined();
    expect(carrier!.role).toBe('user');
    expect(seenMessages.some((m) => m.role === 'tool')).toBe(false);
  });

  test('reaches the provider unwrapped — the masking pass leaves it exactly as authored', async () => {
    mockAssemble.mockResolvedValue(withProcedure());

    await serviceWith(memoryDb()).sendMessage('proc', 'update everything', providerConfig);

    // `seenMessages` is what `maskToolResultsForProvider` produced, so this is
    // the wrapper check and the fidelity check in one: byte-identical, and no
    // untrusted-data delimiter anywhere near it.
    const carrier = seenMessages.find((m) => m.content.includes('CANARY_MARKER'))!;
    expect(carrier.content).toBe(PROCEDURE_TURN);
    expect(carrier.content).not.toContain('untrusted_data');
  });

  test('survives three turns uncompressed — R5 truncates tool results, and this is not one', async () => {
    mockAssemble.mockResolvedValue(withProcedure());
    const svc = serviceWith(memoryDb());

    await svc.sendMessage('proc', 'one', providerConfig);
    await svc.sendMessage('proc', 'two', providerConfig);
    await svc.sendMessage('proc', 'three', providerConfig);

    // By turn three the first carrier sits behind two assistant messages, which
    // is exactly the window `compressStaleToolResults` acts on.
    const carriers = seenMessages.filter((m) => m.content.includes('CANARY_MARKER'));
    expect(carriers).toHaveLength(3);
    for (const carrier of carriers) {
      expect(carrier.content).toBe(PROCEDURE_TURN);
      expect(carrier.content).not.toContain('compressed for context efficiency');
    }
  });
});
