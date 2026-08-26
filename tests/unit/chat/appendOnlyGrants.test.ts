/**
 * P5 stage 3 · append-only grants (charter; tool-context design review Fig. 2).
 *
 * The rule that reconciles two constraints that individually break things:
 * recomputing the grant set per iteration re-tokenizes the prefix up to 25×
 * a turn, while freezing it breaks the escape hatch — a model that discovers
 * a tool through search_tools but doesn't hold the grant cannot call it,
 * ever, because providers only accept calls to declared tools. Append-only:
 * compute once at turn start, stable order, and when search_tools surfaces
 * a missing tool, append it to the END on the next iteration. One cache
 * invalidation per discovery, only on turns that search.
 *
 * This is also what makes P2's disclosure TRUE: the prompt tells the model
 * to "call search_tools before concluding a capability is unavailable" —
 * without append, that instruction points at tools the model can never call.
 */
import { adaptToolsForChat } from '../../../src/main/chat/tool-adapter';
import { ChatService } from '../../../src/main/chat/ChatService';

function makeRegistry(names: string[], callImpl?: (name: string) => string) {
  return {
    list: () => names.map((name) => ({
      name,
      description: `${name} description`,
      inputSchema: { type: 'object', properties: {} },
      isAvailable: () => true,
    })),
    call: jest.fn(async (name: string) => ({
      content: [{ type: 'text', text: callImpl ? callImpl(name) : 'ok' }],
    })),
  } as any;
}

// ── grants order is the array order — appends land LAST ─────────────────────

describe('adaptToolsForChat · grants ordering', () => {
  it('returns granted tools in GRANTS order, not registry order', () => {
    const registry = makeRegistry(['alpha', 'beta', 'gamma']);
    const tools = adaptToolsForChat(registry, {} as any, ['gamma', 'alpha']);
    expect(tools.map((t) => t.name)).toEqual(['gamma', 'alpha']);
  });

  it('an appended grant lands at the end — the stable-prefix property', () => {
    const registry = makeRegistry(['alpha', 'beta', 'gamma']);
    const before = adaptToolsForChat(registry, {} as any, ['gamma', 'alpha']);
    const after = adaptToolsForChat(registry, {} as any, ['gamma', 'alpha', 'beta']);
    // the prior array is a strict prefix of the new one
    expect(after.map((t) => t.name).slice(0, before.length)).toEqual(before.map((t) => t.name));
    expect(after[after.length - 1].name).toBe('beta');
  });

  it('a grant naming a tool the registry lacks is dropped, not sent', () => {
    const registry = makeRegistry(['alpha']);
    const tools = adaptToolsForChat(registry, {} as any, ['alpha', 'ghost_tool']);
    expect(tools.map((t) => t.name)).toEqual(['alpha']);
  });
});

// ── the live loop: discovery appends, nothing shrinks ───────────────────────

describe('runAgentLoop · append-only across iterations', () => {
  function harness(grants: string[] | undefined) {
    const registry = makeRegistry(
      ['alpha', 'hidden_tool', 'search_tools', 'beta'],
      (name) => name === 'search_tools'
        ? 'Top matches:\n- hidden_tool: hidden_tool description'
        : 'ok',
    );
    const svc = new (ChatService as any)({ registry, services: {}, sendToRenderer: jest.fn() });

    const toolsPerIteration: string[][] = [];
    let iteration = 0;
    const fakeProvider = {
      id: 'anthropic',
      async *streamChat(_messages: any, tools: any[]) {
        toolsPerIteration.push(tools.map((t) => t.name));
        iteration++;
        if (iteration === 1) {
          yield { type: 'tool_call_start', id: 't1', name: 'search_tools' };
          yield { type: 'tool_call_end', id: 't1', name: 'search_tools', arguments: { query: 'hidden' } };
          yield { type: 'done', stopReason: 'tool_use' };
        } else if (iteration === 2) {
          yield { type: 'tool_call_start', id: 't2', name: 'hidden_tool' };
          yield { type: 'tool_call_end', id: 't2', name: 'hidden_tool', arguments: {} };
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
      messages: [{ role: 'user', content: 'find the hidden thing' }],
      abortController: new AbortController(),
      pendingApprovals: new Map(),
    };
    return { svc, session, toolsPerIteration, registry };
  }

  afterEach(() => jest.restoreAllMocks());

  it('a tool surfaced by search_tools is appended and callable next iteration', async () => {
    const { svc, session, toolsPerIteration, registry } = harness(['alpha']);
    await (svc as any).runAgentLoop(session, 'anthropic', { model: 'm' }, ['alpha'], undefined, null);

    // iteration 1: the granted set (search_tools hoisted by P2a)
    expect(toolsPerIteration[0]).toEqual(['search_tools', 'alpha']);
    // iteration 2: hidden_tool APPENDED at the end — prior order untouched
    expect(toolsPerIteration[1]).toEqual(['search_tools', 'alpha', 'hidden_tool']);
    // and the model's call to it actually executed
    const calledNames = (registry.call as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(calledNames).toContain('hidden_tool');
  });

  it('the tool array never shrinks or reorders mid-turn — the pin', async () => {
    const { svc, session, toolsPerIteration } = harness(['alpha']);
    await (svc as any).runAgentLoop(session, 'anthropic', { model: 'm' }, ['alpha'], undefined, null);

    for (let i = 1; i < toolsPerIteration.length; i++) {
      const prev = toolsPerIteration[i - 1];
      const curr = toolsPerIteration[i];
      expect(curr.length).toBeGreaterThanOrEqual(prev.length);
      expect(curr.slice(0, prev.length)).toEqual(prev); // strict prefix extension
    }
  });

  it('unrestricted turns (no grants) are untouched — everything already visible', async () => {
    const { svc, session, toolsPerIteration } = harness(undefined);
    await (svc as any).runAgentLoop(session, 'anthropic', { model: 'm' }, undefined, undefined, null);

    // full registry every iteration, identical arrays — the cache-clean case
    for (const tools of toolsPerIteration) {
      expect(tools).toEqual(toolsPerIteration[0]);
      expect(tools).toContain('beta');
    }
  });

  it("the caller's grants array is never mutated", async () => {
    const grants = ['alpha'];
    const { svc, session } = harness(grants);
    await (svc as any).runAgentLoop(session, 'anthropic', { model: 'm' }, grants, undefined, null);
    expect(grants).toEqual(['alpha']);
  });
});
