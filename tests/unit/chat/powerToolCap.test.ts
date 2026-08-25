/**
 * fixes-082526 · workstream 1c — chat-on-Power sends a bounded toolset.
 *
 * Chat 400'd on EVERY Power model ("request is incompatible with the selected
 * model") while the agent path — one tool, same adapter — works. The one
 * structural difference is the tools array: the full registry is ~190
 * schemas, and Vertex-fronted routes (Power's `-maas` catalog ids) cap tools
 * at 128. No log has ever shown a successful full-registry Power chat: a
 * never-worked path, not a regression.
 *
 * The bound is deliberate and LOUD (no-silent-caps rule): registration order
 * kept, the dropped tail counted in the log.
 */
import { ChatService } from '../../../src/main/chat/ChatService';

function makeService(toolCount: number) {
  const defs = Array.from({ length: toolCount }, (_, i) => ({
    name: `tool_${i}`,
    description: 'd',
    inputSchema: { type: 'object', properties: {} },
    isAvailable: () => true,
  }));
  const registry = { list: () => defs } as any;
  const svc = new (ChatService as any)({
    registry,
    services: {},
    sendToRenderer: jest.fn(),
  });
  return svc;
}

/** Capture the tools array the provider is handed. */
async function toolsSentFor(providerId: string, toolCount: number): Promise<any[]> {
  const svc = makeService(toolCount);
  let captured: any[] = [];
  const fakeProvider = {
    id: providerId,
    async *streamChat(_m: any, tools: any[]) {
      captured = tools;
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
  const providers = require('../../../src/main/chat/providers/index');
  jest.spyOn(providers, 'getProvider').mockReturnValue(fakeProvider);

  const session = {
    id: 's1',
    messages: [{ id: '1', role: 'user', content: 'hi' }],
    abortController: new AbortController(),
    toolCallCount: 0,
  };
  await (svc as any).runAgentLoop(session, providerId, { model: 'm' }, undefined, undefined, null);
  return captured;
}

afterEach(() => jest.restoreAllMocks());

it('caps Power at 128 tools, keeping registration order', async () => {
  const sent = await toolsSentFor('power', 190);
  expect(sent).toHaveLength(128);
  expect(sent[0].name).toBe('tool_0');
  expect(sent[127].name).toBe('tool_127');
});

it('says what it dropped — the cap is never silent', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await toolsSentFor('power', 190);
  expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/128 of 190 tools.*62 dropped/);
});

it('does not bound any other provider', async () => {
  const sent = await toolsSentFor('anthropic', 190);
  expect(sent).toHaveLength(190);
});

it('leaves a small toolset alone on Power too', async () => {
  const sent = await toolsSentFor('power', 5);
  expect(sent).toHaveLength(5);
});
