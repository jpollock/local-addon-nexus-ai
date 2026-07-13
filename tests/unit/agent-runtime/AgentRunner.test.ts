import { AgentRunner } from '../../../src/main/agent-runtime/AgentRunner';
import { defineAgent, cron, on } from '../../../src/main/agent-sdk';
import type { AgentContext, NexusEvent } from '../../../src/main/agent-sdk/types';

function makeRunner() {
  const stateStore = {
    buildHandle: jest.fn().mockReturnValue({
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      scratch: {},
    }),
  };
  // Mock ToolRegistry — none of the unit-test agents invoke tools,
  // so `call` will not be hit, but we provide a valid mock for completeness.
  const toolRegistry = {
    call: jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: '[]' }],
    }),
  };
  const services = {};
  const aiClient = { run: jest.fn().mockResolvedValue('ok') };
  return new AgentRunner(stateStore as any, toolRegistry as any, services as any, aiClient as any);
}

describe('AgentRunner', () => {
  it('runs a task agent and returns success result', async () => {
    const runFn = jest.fn().mockResolvedValue(undefined);
    const agent = defineAgent({ name: 'a', version: '1.0.0', triggers: [cron('* * * * *')], run: runFn });
    const runner = makeRunner();
    const result = await runner.run(agent);
    expect(result.status).toBe('success');
    expect(result.agentName).toBe('a');
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('passes event to the context for reactive agents', async () => {
    let receivedEvent: NexusEvent | undefined;
    const agent = defineAgent({
      name: 'b', version: '1.0.0', triggers: [on('wp:post.published')],
      run: async (ctx) => { receivedEvent = ctx.event; },
    });
    const event: NexusEvent = { namespace: 'wp', type: 'post.published', key: 'wp:post.published', payload: {}, createdAt: Date.now() };
    const runner = makeRunner();
    await runner.run(agent, event);
    expect(receivedEvent).toBe(event);
  });

  it('returns error result when run() throws', async () => {
    const agent = defineAgent({
      name: 'c', version: '1.0.0', triggers: [cron('* * * * *')],
      run: async () => { throw new Error('boom'); },
    });
    const runner = makeRunner();
    const result = await runner.run(agent);
    expect(result.status).toBe('error');
    expect(result.error).toBe('boom');
  });

  it('calls onError when run() throws and onError is defined', async () => {
    const onError = jest.fn().mockResolvedValue(undefined);
    const agent = defineAgent({
      name: 'd', version: '1.0.0', triggers: [cron('* * * * *')],
      run: async () => { throw new Error('oops'); },
      onError,
    });
    const runner = makeRunner();
    await runner.run(agent);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('oops');
  });

  it('returns timeout result when run() exceeds timeoutMs', async () => {
    const agent = defineAgent({
      name: 'e', version: '1.0.0', triggers: [cron('* * * * *')],
      timeoutMs: 50,
      run: async () => new Promise(resolve => setTimeout(resolve, 200)),
    });
    const runner = makeRunner();
    const result = await runner.run(agent);
    expect(result.status).toBe('timeout');
  }, 1000);

  it('calls onError on timeout', async () => {
    const onError = jest.fn().mockResolvedValue(undefined);
    const agent = defineAgent({
      name: 'f', version: '1.0.0', triggers: [cron('* * * * *')],
      timeoutMs: 50,
      run: async () => new Promise(resolve => setTimeout(resolve, 200)),
      onError,
    });
    const runner = makeRunner();
    const result = await runner.run(agent);
    expect(result.status).toBe('timeout');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].name).toBe('TimeoutError');
  }, 1000);
});
