import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';
import { AgentRunner } from '../../../src/main/agent-runtime/AgentRunner';
import { EventLog } from '../../../src/main/logging/eventLog';
import type { AgentDefinition } from '../../../src/main/agent-sdk/types';

const services = { contributedRegistry: { list: () => [] } } as any;
const failing = { call: async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }), list: () => [] } as any;
const okRegistry = { call: async () => ({ isError: false, content: [{ type: 'text', text: '{}' }] }), list: () => [] } as any;

describe('failedCallCount', () => {
  it('starts at zero', () => {
    expect(new NexusToolProvider(okRegistry, services, undefined).failedCallCount()).toBe(0);
  });

  it('counts a tool call that failed', async () => {
    const p = new NexusToolProvider(failing, services, undefined);
    await expect(p.invoke('wp_plugin_list', { site: 'x' })).rejects.toThrow();
    expect(p.failedCallCount()).toBe(1);
  });

  it('counts a refusal too — the agent asked for something it could not have', async () => {
    const p = new NexusToolProvider(okRegistry, services, ['wp_plugin_list']);
    await expect(p.invoke('wp_plugin_update', { site: 'x' })).rejects.toThrow();
    expect(p.failedCallCount()).toBe(1);
  });

  it('does not count successes', async () => {
    const p = new NexusToolProvider(okRegistry, services, undefined);
    await p.invoke('wp_plugin_list', { site: 'x' });
    expect(p.failedCallCount()).toBe(0);
  });
});

describe('run.end failedCalls field', () => {
  it('is omitted when zero — failedCalls=0 trains people to ignore it', async () => {
    const events: any[] = [];
    const eventLog: EventLog = {
      write: (e: any) => events.push(e),
    } as any;

    const agent: AgentDefinition = {
      name: 'test-agent',
      version: '1.0.0',
      triggers: [{ type: 'cron', expression: '0 0 * * *' }],
      run: async () => {},
    };

    const stateStore = {
      buildHandle: () => ({
        get: () => undefined, set: () => {}, delete: () => {}, scratch: {},
        isCoolingDown: () => false, setCooldown: () => {},
      }),
      recordRun: () => {},
    };

    const runner = new AgentRunner(
      stateStore as any,
      okRegistry,
      services as any,
      { provider: 'anthropic', apiKey: 'sk-test', modelName: 'claude-sonnet-4' } as any,
      undefined,
      eventLog,
    );

    await runner.run(agent);
    const runEnd = events.find((e) => e.event === 'run.end');
    expect(runEnd).toBeDefined();
    expect(runEnd.fields).not.toHaveProperty('failedCalls');
  });

  it('is present when non-zero', async () => {
    const events: any[] = [];
    const eventLog: EventLog = {
      write: (e: any) => events.push(e),
    } as any;

    const agent: AgentDefinition = {
      name: 'test-agent',
      version: '1.0.0',
      triggers: [{ type: 'cron', expression: '0 0 * * *' }],
      tools: ['wp_plugin_list'],
      run: async (ctx) => {
        try {
          await ctx.tools.invoke('wp_plugin_update', { site: 'x' });
        } catch {
          // expected — refusal
        }
      },
    };

    const stateStore = {
      buildHandle: () => ({
        get: () => undefined, set: () => {}, delete: () => {}, scratch: {},
        isCoolingDown: () => false, setCooldown: () => {},
      }),
      recordRun: () => {},
    };

    const runner = new AgentRunner(
      stateStore as any,
      okRegistry,
      services as any,
      { provider: 'anthropic', apiKey: 'sk-test', modelName: 'claude-sonnet-4' } as any,
      undefined,
      eventLog,
    );

    await runner.run(agent);
    const runEnd = events.find((e) => e.event === 'run.end');
    expect(runEnd).toBeDefined();
    expect(runEnd.fields.failedCalls).toBe(1);
  });
});
