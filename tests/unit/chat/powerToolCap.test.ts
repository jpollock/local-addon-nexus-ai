/**
 * fixes-082526 · workstream 1c, CLOSED 2026-08-26 — Power sends the FULL toolset.
 *
 * History, so the cap never comes back on vibes: chat-on-Power 400'd
 * 2026-08-25 ("request is incompatible with the selected model") and commit
 * 502d3554 bounded the toolset to 128 on the hypothesis that Vertex-fronted
 * routes cap tools per request. Three live probes then killed every version
 * of that hypothesis (spike-power-aisdk-live.mjs, spike-power-real-tools-probe.mjs,
 * spike-power-matrix-probe.mjs, owner's key, 2026-08-25/26):
 *   - 200 dummy tools: accepted (count exonerated)
 *   - all 207 real schemas, 145,928B: accepted (content and bytes exonerated)
 *   - the exact chat shape (stream, max_tokens 8192, ~9KB system prompt) on
 *     sonnet-4-5 AND sonnet-5: accepted (shape and model exonerated)
 * The route was fixed upstream; the cap's premise is measured-gone. If Power
 * ever regresses, the failure is the actionable "incompatible with the
 * selected model" sentence (powerModelError.test.ts) — loud, not a silent
 * 79-tool amputation that made the model deny capabilities it had.
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

it('sends Power the FULL toolset — no cap, no dropped tail', async () => {
  const sent = await toolsSentFor('power', 207);
  expect(sent).toHaveLength(207);
  expect(sent[0].name).toBe('tool_0');
  expect(sent[206].name).toBe('tool_206');
});

it('does not warn about dropping tools — there is nothing dropped to name', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await toolsSentFor('power', 207);
  expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).not.toMatch(/tool cap|dropped/);
});

it('does not bound any other provider', async () => {
  const sent = await toolsSentFor('anthropic', 190);
  expect(sent).toHaveLength(190);
});

it('leaves a small toolset alone on Power too', async () => {
  const sent = await toolsSentFor('power', 5);
  expect(sent).toHaveLength(5);
});
