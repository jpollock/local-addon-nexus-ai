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
