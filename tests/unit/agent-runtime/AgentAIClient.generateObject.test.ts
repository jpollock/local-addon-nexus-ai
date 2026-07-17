import { AgentAIClient } from '../../../src/main/agent-runtime/AgentAIClient';

function makeClient(mockResponse: string): AgentAIClient {
  const mockProvider = {
    streamChat: jest.fn().mockImplementation(async function*(_messages: unknown, _tools: unknown) {
      // Simulate the model calling our output tool
      yield { type: 'tool_call_end', name: '__output__', id: 'c1', arguments: { result: JSON.parse(mockResponse) } };
    }),
  } as any;
  const mockToolProvider = {
    getProviderToolDefinitions: () => [],
    invoke: jest.fn(),
  } as any;
  return new AgentAIClient(mockProvider, { model: 'claude-sonnet-5', apiKey: 'test' } as any, mockToolProvider);
}

describe('AgentAIClient.generateObject', () => {
  it('returns parsed object from model tool call', async () => {
    const client = makeClient(JSON.stringify({ verdict: 'ready', steps: [] }));
    const result = await client.generateObject<{ verdict: string; steps: unknown[] }>({
      prompt: 'Analyze this site',
      schema: {
        type: 'object',
        properties: { verdict: { type: 'string' }, steps: { type: 'array', items: {} } },
        required: ['verdict', 'steps'],
      },
    });
    expect(result.verdict).toBe('ready');
    expect(result.steps).toEqual([]);
  });

  it('throws if model does not call the output tool', async () => {
    const mockProvider = {
      streamChat: jest.fn().mockImplementation(async function*() {
        yield { type: 'token', text: 'I cannot help with that' };
      }),
    } as any;
    const client = new AgentAIClient(
      mockProvider,
      { model: 'claude-sonnet-5', apiKey: 'test' } as any,
      { getProviderToolDefinitions: () => [], invoke: jest.fn() } as any,
    );
    await expect(
      client.generateObject({ prompt: 'test', schema: { type: 'object', properties: {}, required: [] } }),
    ).rejects.toThrow('generateObject: model did not call __output__ tool');
  });

  it('noTools: true only injects __output__ tool', async () => {
    const capturedTools: any[] = [];
    const mockProvider = {
      streamChat: jest.fn().mockImplementation(async function*(messages: unknown, tools: any[]) {
        capturedTools.push(...tools);
        yield { type: 'tool_call_end', name: '__output__', id: 'c1', arguments: { verdict: 'clean' } };
      }),
    } as any;
    const mockToolProvider = {
      getProviderToolDefinitions: jest.fn().mockReturnValue([{ name: 'fleet_sql', parameters: {} }]),
      invoke: jest.fn(),
    } as any;
    const client = new AgentAIClient(mockProvider, { model: 'claude-sonnet-5', apiKey: 'test' } as any, mockToolProvider);
    await client.generateObject({ prompt: 'test', schema: { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'] }, noTools: true });
    expect(capturedTools.map(t => t.name)).toEqual(['__output__']);
    expect(mockToolProvider.getProviderToolDefinitions).not.toHaveBeenCalled();
  });

  it('unwraps arguments directly when no top-level result key', async () => {
    const mockProvider = {
      streamChat: jest.fn().mockImplementation(async function*() {
        yield { type: 'tool_call_end', name: '__output__', id: 'c2', arguments: { verdict: 'blocked', count: 3 } };
      }),
    } as any;
    const client = new AgentAIClient(
      mockProvider,
      { model: 'claude-sonnet-5', apiKey: 'test' } as any,
      { getProviderToolDefinitions: () => [], invoke: jest.fn() } as any,
    );
    const result = await client.generateObject<{ verdict: string; count: number }>({
      prompt: 'Check this',
      schema: {
        type: 'object',
        properties: { verdict: { type: 'string' }, count: { type: 'number' } },
        required: ['verdict', 'count'],
      },
    });
    expect(result.verdict).toBe('blocked');
    expect(result.count).toBe(3);
  });
});
