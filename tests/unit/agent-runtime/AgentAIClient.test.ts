import { AgentAIClient } from '../../../src/main/agent-runtime/AgentAIClient';
import { AgentAILoopError } from '../../../src/main/agent-sdk/types';

function makeTextProvider(text: string) {
  return {
    streamChat: async function* () {
      yield { type: 'token', text };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

function makeToolProvider(toolResult: unknown, finalText: string) {
  let call = 0;
  return {
    streamChat: async function* () {
      if (call++ === 0) {
        yield { type: 'tool_call_start', id: 't1', name: 'nexus_list_sites' };
        yield { type: 'tool_call_end', id: 't1', name: 'nexus_list_sites', arguments: {} };
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'token', text: finalText };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    },
  };
}

const fakeToolProvider = {
  getProviderToolDefinitions: () => [],
  invoke: jest.fn().mockResolvedValue(['site-a']),
};

describe('AgentAIClient', () => {
  beforeEach(() => {
    fakeToolProvider.invoke.mockClear();
  });

  it('returns text on first non-tool response', async () => {
    const client = new AgentAIClient(makeTextProvider('hello') as any, { model: 'test-model' }, fakeToolProvider as any);
    expect(await client.run('ping')).toBe('hello');
  });

  it('calls tool and returns final text', async () => {
    const client = new AgentAIClient(makeToolProvider(undefined, 'done') as any, { model: 'test-model' }, fakeToolProvider as any);
    const result = await client.run('list sites');
    expect(fakeToolProvider.invoke).toHaveBeenCalledWith('nexus_list_sites', {});
    expect(result).toBe('done');
  });

  it('masks PII in tool results before they reach the provider (P0-5 backstop)', async () => {
    const seen: any[][] = [];
    let call = 0;
    const provider = {
      streamChat: async function* (messages: any[]) {
        seen.push(messages);
        if (call++ === 0) {
          yield { type: 'tool_call_start', id: 't1', name: 'wp_user_list' };
          yield { type: 'tool_call_end', id: 't1', name: 'wp_user_list', arguments: {} };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'token', text: 'ok' };
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
    };
    const toolProvider = {
      getProviderToolDefinitions: () => [],
      invoke: jest.fn().mockResolvedValue({ users: [{ email: 'admin@customer.com' }] }),
    };
    const client = new AgentAIClient(provider as any, { model: 'm' }, toolProvider as any);
    await client.run('list users');

    // The second-turn outbound messages carry the tool result — its email must be masked.
    const toolMsg = seen[1].find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain('[email redacted]');
    expect(toolMsg.content).not.toContain('admin@customer.com');
  });

  it('refuses to call the provider when the daily budget is exceeded (T-BUDGETS)', async () => {
    let called = false;
    const provider = {
      streamChat: async function* () {
        called = true;
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const overBudgetGuard = {
      assertWithinBudget() {
        throw new Error('Daily LLM spend budget reached: $5.00 of $5.00.');
      },
      record() {},
    };
    const client = new AgentAIClient(
      provider as any, { model: 'm' }, fakeToolProvider as any,
      undefined, undefined, undefined, undefined, overBudgetGuard as any,
    );
    await expect(client.run('go')).rejects.toThrow(/budget/i);
    expect(called).toBe(false); // the model was never called — no spend past the ceiling
  });

  it('throws AgentAILoopError when maxTurns exceeded', async () => {
    const loopProvider = {
      streamChat: async function* () {
        yield { type: 'tool_call_start', id: 't1', name: 'x' };
        yield { type: 'tool_call_end', id: 't1', name: 'x', arguments: {} };
        yield { type: 'done', stopReason: 'tool_use' };
      },
    };
    const client = new AgentAIClient(loopProvider as any, { model: 'm' }, fakeToolProvider as any);
    await expect(client.run('go', { maxTurns: 2 })).rejects.toThrow(AgentAILoopError);
  });
});
