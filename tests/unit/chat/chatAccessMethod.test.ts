/**
 * P5 prerequisite (charter §P5.1) — chat is labeled 'chat', not 'mcp'.
 *
 * ChatService passed 'mcp' to ToolRegistry.call, making the chat surface
 * indistinguishable from external MCP clients (Claude Code, etc.) in every
 * sink that records access method — telemetry's access_method, the audit
 * trail's _accessMethod, metrics. Production usage data cannot size a chat
 * tool budget until the chat surface is separable; this starts that clock.
 *
 * Ledger attribution (actionProducer.actorFor) deliberately keeps mapping
 * both 'chat' and 'mcp' to act_chat_agent — splitting external MCP into its
 * own actor id changes event provenance and deserves its own packet.
 */
import { ChatService } from '../../../src/main/chat/ChatService';

function makeHarness() {
  const calls: any[] = [];
  const registry = {
    list: () => [{
      name: 'probe_tool',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      isAvailable: () => true,
    }],
    call: jest.fn(async (...args: any[]) => {
      calls.push(args);
      return { content: [{ type: 'text', text: 'ok' }] };
    }),
  };
  const svc = new (ChatService as any)({
    registry,
    services: {},
    sendToRenderer: jest.fn(),
  });
  return { svc, registry, calls };
}

it("executes chat tool calls with accessMethod 'chat', never 'mcp'", async () => {
  const { svc, calls } = makeHarness();

  let iteration = 0;
  const fakeProvider = {
    id: 'anthropic',
    async *streamChat() {
      iteration++;
      if (iteration === 1) {
        yield { type: 'tool_call_start', id: 't1', name: 'probe_tool' };
        yield { type: 'tool_call_end', id: 't1', name: 'probe_tool', arguments: {} };
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'token', text: 'done' };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    },
  };
  const providers = require('../../../src/main/chat/providers/index');
  jest.spyOn(providers, 'getProvider').mockReturnValue(fakeProvider);

  const session = {
    id: 's1',
    messages: [{ id: '1', role: 'user', content: 'hi' }],
    abortController: new AbortController(),
    pendingApprovals: new Map(),
  };
  await (svc as any).runAgentLoop(session, 'anthropic', { model: 'm' }, undefined, undefined, null);

  expect(calls.length).toBeGreaterThan(0);
  for (const args of calls) {
    expect(args[3]).toBe('chat');
  }
  jest.restoreAllMocks();
});
