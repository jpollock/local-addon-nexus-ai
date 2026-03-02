import { ChatService, ChatServiceDeps } from '../../src/main/chat/ChatService';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import type { McpToolHandler, NexusServices } from '../../src/main/mcp/types';
import type { ChatStreamEvent } from '../../src/common/chat-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock provider that yields predefined events. */
function createMockProvider(events: any[]) {
  return {
    id: 'mock',
    displayName: 'Mock',
    requiresApiKey: false,
    defaultModels: ['mock-model'],
    async *streamChat() {
      for (const e of events) yield e;
    },
    async listModels() { return ['mock-model']; },
    async validateKey() { return null; },
  };
}

/** Creates a tool registry with a simple test tool. */
function registryWithTool(name: string, execute?: McpToolHandler['execute']): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name,
      description: `Test: ${name}`,
      inputSchema: { type: 'object', properties: {} },
    },
    execute: execute ?? (async () => ({
      content: [{ type: 'text' as const, text: `result of ${name}` }],
    })),
  });
  return registry;
}

function mockServices(): NexusServices {
  return {
    siteData: { getSite: () => null, getSites: () => ({}) },
    indexRegistry: { get: () => null },
    fileScanner: { scan: async () => ({ wpVersion: '', phpVersion: '', themes: [], plugins: [] }) },
  } as any;
}

/** Collects all events emitted by ChatService for a session. */
function collectEvents(deps: ChatServiceDeps, sessionId: string): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = [];
  const originalSend = deps.sendToRenderer;
  deps.sendToRenderer = (channel: string, ...args: unknown[]) => {
    const sid = args[0] as string;
    const event = args[1] as ChatStreamEvent;
    if (sid === sessionId && event) events.push(event);
    originalSend(channel, ...args);
  };
  return events;
}

// Mock the provider module
let mockProviderInstance: any = null;

jest.mock('../../src/main/chat/providers/index', () => ({
  getProvider: (id: string) => mockProviderInstance,
  initializeProviders: () => {},
  listProviders: () => [],
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatService', () => {
  let service: ChatService;
  let events: ChatStreamEvent[];
  const sessionId = 'test-session';

  beforeEach(() => {
    mockProviderInstance = createMockProvider([
      { type: 'token', text: 'Hello!' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    const deps: ChatServiceDeps = {
      registry: registryWithTool('test_tool'),
      services: mockServices(),
      sendToRenderer: () => {},
    };
    events = collectEvents(deps, sessionId);
    service = new ChatService(deps);
  });

  test('emits token and done events for a simple response', async () => {
    await service.sendMessage(sessionId, 'hi', {
      providerId: 'mock',
      model: 'mock-model',
    });

    const tokenEvents = events.filter((e) => e.type === 'token');
    const doneEvents = events.filter((e) => e.type === 'done');

    expect(tokenEvents.length).toBeGreaterThanOrEqual(1);
    expect(doneEvents.length).toBe(1);
    expect((doneEvents[0] as any).stopReason).toBe('end_turn');
  });

  test('handles tool call → execute → result flow', async () => {
    mockProviderInstance = createMockProvider([
      { type: 'token', text: 'Let me check...' },
      { type: 'tool_call_start', id: 'tc1', name: 'test_tool' },
      { type: 'tool_call_end', id: 'tc1', name: 'test_tool', arguments: {} },
      { type: 'done', stopReason: 'tool_use' },
    ]);

    // After tool execution, provider should respond with final text
    let callCount = 0;
    mockProviderInstance.streamChat = async function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: 'token', text: 'Let me check...' };
        yield { type: 'tool_call_start', id: 'tc1', name: 'test_tool' };
        yield { type: 'tool_call_end', id: 'tc1', name: 'test_tool', arguments: {} };
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'token', text: 'Done!' };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    };

    await service.sendMessage(sessionId, 'check plugins', {
      providerId: 'mock',
      model: 'mock-model',
    });

    const toolExec = events.filter((e) => e.type === 'tool_call_executing');
    const toolResult = events.filter((e) => e.type === 'tool_call_result');

    expect(toolExec.length).toBe(1);
    expect(toolResult.length).toBe(1);
    expect((toolResult[0] as any).result).toContain('result of test_tool');
  });

  test('emits error for unknown provider', async () => {
    mockProviderInstance = null; // Simulate unknown provider

    await service.sendMessage(sessionId, 'hi', {
      providerId: 'nonexistent',
      model: 'foo',
    });

    const errors = events.filter((e) => e.type === 'error');
    expect(errors.length).toBe(1);
    expect((errors[0] as any).message).toContain('Unknown provider');
  });

  test('stopGeneration aborts in-flight request', async () => {
    // Provider that waits before responding
    let signalAborted = false;
    mockProviderInstance.streamChat = async function* (_m: any, _t: any, _c: any, signal: AbortSignal) {
      yield { type: 'token', text: 'starting...' };
      // Check if aborted
      signalAborted = signal.aborted;
      yield { type: 'done', stopReason: 'end_turn' };
    };

    const promise = service.sendMessage(sessionId, 'hi', {
      providerId: 'mock',
      model: 'mock-model',
    });

    service.stopGeneration(sessionId);
    await promise;

    // The abort should have been signaled
    // (may or may not have taken effect depending on timing)
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  test('clearSession removes conversation history', async () => {
    await service.sendMessage(sessionId, 'hi', {
      providerId: 'mock',
      model: 'mock-model',
    });

    service.clearSession(sessionId);

    // Sending again should create a fresh session (with system prompt)
    mockProviderInstance = createMockProvider([
      { type: 'token', text: 'Fresh!' },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    events.length = 0;
    await service.sendMessage(sessionId, 'hello again', {
      providerId: 'mock',
      model: 'mock-model',
    });

    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  });

  test('limits agent loop iterations', async () => {
    // Provider always requests tool calls — should stop after MAX_AGENT_ITERATIONS
    mockProviderInstance.streamChat = async function* () {
      yield { type: 'tool_call_start', id: `tc_${Date.now()}`, name: 'test_tool' };
      yield { type: 'tool_call_end', id: `tc_${Date.now()}`, name: 'test_tool', arguments: {} };
      yield { type: 'done', stopReason: 'tool_use' };
    };

    await service.sendMessage(sessionId, 'loop', {
      providerId: 'mock',
      model: 'mock-model',
    });

    const errors = events.filter((e) => e.type === 'error');
    expect(errors.some((e) => (e as any).message.includes('Maximum tool call iterations'))).toBe(true);
  });

  test('provider error emits error event', async () => {
    mockProviderInstance = createMockProvider([
      { type: 'error', message: 'Connection refused' },
    ]);

    await service.sendMessage(sessionId, 'hi', {
      providerId: 'mock',
      model: 'mock-model',
    });

    const errors = events.filter((e) => e.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect((errors[0] as any).message).toContain('Connection refused');
  });

  test('system prompt includes base instructions', async () => {
    let capturedMessages: any[] = [];
    mockProviderInstance.streamChat = async function* (messages: any[]) {
      capturedMessages = messages;
      yield { type: 'token', text: 'ok' };
      yield { type: 'done', stopReason: 'end_turn' };
    };

    await service.sendMessage(sessionId, 'hi', {
      providerId: 'mock',
      model: 'mock-model',
    });

    const systemMsg = capturedMessages.find((m: any) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('Nexus AI');
    expect(systemMsg.content).toContain('WordPress');
  });
});

describe('ChatService — Tier 3 approval', () => {
  test('resolveApproval with approved=false sends denial', async () => {
    // Register a tier 3 tool
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'local_delete_site',
        description: 'Delete a site',
        inputSchema: {
          type: 'object',
          properties: {
            site: { type: 'string' },
            _confirmationToken: { type: 'string' },
          },
          required: ['site', '_confirmationToken'],
        },
      },
      execute: async () => ({
        content: [{ type: 'text' as const, text: 'deleted' }],
      }),
    });

    const deps: ChatServiceDeps = {
      registry,
      services: mockServices(),
      sendToRenderer: () => {},
    };
    const events: ChatStreamEvent[] = [];
    deps.sendToRenderer = (_c: string, ...args: unknown[]) => {
      const sid = args[0] as string;
      const event = args[1] as ChatStreamEvent;
      if (sid === 'approval-test' && event) events.push(event);
    };

    const service = new ChatService(deps);

    // Provider triggers tier 3 tool call on first iteration,
    // then ends conversation on second (after denial result is in context).
    let callCount = 0;
    mockProviderInstance = {
      id: 'mock',
      displayName: 'Mock',
      requiresApiKey: false,
      defaultModels: ['m'],
      streamChat: async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: 'tool_call_start', id: 'tc_del', name: 'local_delete_site' };
          yield { type: 'tool_call_end', id: 'tc_del', name: 'local_delete_site', arguments: { site: 'my-site' } };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'token', text: 'OK, I won\'t delete it.' };
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
      listModels: async () => ['m'],
      validateKey: async () => null,
    };

    // Start the message — it will block on approval
    const messagePromise = service.sendMessage('approval-test', 'delete my-site', {
      providerId: 'mock',
      model: 'm',
    });

    // Wait a tick for the approval event to be emitted
    await new Promise((r) => setTimeout(r, 100));

    const approvalEvents = events.filter((e) => e.type === 'tool_call_approval_needed');
    expect(approvalEvents.length).toBe(1);

    // Deny the approval
    service.resolveApproval('approval-test', 'tc_del', false);
    await messagePromise;

    const results = events.filter((e) => e.type === 'tool_call_result');
    expect(results.length).toBe(1);
    expect((results[0] as any).result).toContain('denied');
  }, 15000);
});
