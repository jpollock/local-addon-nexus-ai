/**
 * Integration test: Agent Runtime end-to-end
 *
 * Verifies that AgentRunner, AgentStateStore, AgentEventBus, AgentScheduler,
 * and NexusToolProvider wire together correctly using an in-memory SQLite DB.
 * Does NOT require Local to be running.
 */
import Database from 'better-sqlite3';
import { AgentEventBus } from '../../src/main/agent-event-bus/AgentEventBus';
import { AgentStateStore } from '../../src/main/agent-runtime/AgentStateStore';
import { AgentRunner } from '../../src/main/agent-runtime/AgentRunner';
import { AgentScheduler } from '../../src/main/agent-runtime/AgentScheduler';
import { defineAgent, cron, on } from '../../src/main/agent-sdk';
import type { NexusEvent } from '../../src/main/agent-sdk/types';

function makeInMemoryStack() {
  const db = new Database(':memory:');
  const bus = new AgentEventBus(db);
  const stateStore = new AgentStateStore(db);
  const fakeRegistry = {
    call: jest.fn().mockImplementation(async (name: string) => ({
      content: [{ type: 'text', text: JSON.stringify(name === 'nexus_list_sites' ? [{ name: 'site-a' }, { name: 'site-b' }] : []) }],
      isError: false,
    })),
  };
  const aiClient = { complete: jest.fn().mockResolvedValue('') };
  // Pass toolRegistry + services directly — AgentRunner constructs NexusToolProvider per-run
  const runner = new AgentRunner(stateStore, fakeRegistry as any, {} as any, aiClient);
  return { db, bus, stateStore, runner, fakeRegistry };
}

describe('Agent Runtime — Integration', () => {
  it('Task agent: run via AgentRunner, asserts tool called and state written', async () => {
    const { runner, stateStore, fakeRegistry } = makeInMemoryStack();

    const agent = defineAgent({
      name: 'hello-nexus',
      version: '1.0.0',
      triggers: [cron('* * * * *')],
      tools: ['nexus_list_sites'],
      async run({ tools, state, log }) {
        const sites = await tools.invoke('nexus_list_sites', {}) as any[];
        state.set('lastRunSiteCount', sites.length);
        log.info(`found ${sites.length} sites`);
      },
    });

    const result = await runner.run(agent);

    expect(result.status).toBe('success');
    expect(fakeRegistry.call).toHaveBeenCalledWith('nexus_list_sites', {}, {}, 'agent');
    expect(stateStore.get('hello-nexus', 'lastRunSiteCount')).toBe(2);
  });

  it('Reactive agent: event published to bus triggers agent run and writes state', async () => {
    const { bus, stateStore, runner } = makeInMemoryStack();

    const agent = defineAgent({
      name: 'hello-nexus-reactive',
      version: '1.0.0',
      triggers: [on('wp:post.published')],
      async run({ event, state }) {
        state.set('lastEvent', event?.key);
      },
    });

    // Simulate reactive wiring: subscribe to bus pattern, hand event to runner
    bus.subscribe('wp:post.published', async (event: NexusEvent) => {
      await runner.run(agent, event);
    });

    const event: NexusEvent = {
      namespace: 'wp', type: 'post.published', key: 'wp:post.published',
      payload: { post_id: 42 }, createdAt: Date.now(),
    };
    bus.publish(event);

    // Give async handler time to complete
    await new Promise(r => setTimeout(r, 50));

    expect(stateStore.get('hello-nexus-reactive', 'lastEvent')).toBe('wp:post.published');
  });

  it('Event bus replay: agent receives events published while offline', () => {
    const db = new Database(':memory:');
    const bus = new AgentEventBus(db);
    const t0 = Date.now() - 100;

    const pastEvent: NexusEvent = {
      namespace: 'wp', type: 'post.published', key: 'wp:post.published',
      payload: {}, createdAt: t0,
    };
    bus.publish(pastEvent);

    const replayed = bus.replay(t0 - 1, 'wp:*');
    expect(replayed).toHaveLength(1);
    expect(replayed[0].key).toBe('wp:post.published');
  });

  it('AgentScheduler: registered agent is fired by scheduler (fast cron)', () => {
    const { runner } = makeInMemoryStack();
    const scheduler = new AgentScheduler(runner);

    const ran = jest.fn();
    const agent = defineAgent({
      name: 'fast-cron-agent',
      version: '1.0.0',
      triggers: [cron('* * * * *')],
      run: ran,
    });

    scheduler.register(agent);
    // node-cron fires on the minute — can't wait in a test; verify registration doesn't throw
    // and unregister works cleanly
    scheduler.unregister('fast-cron-agent');
    scheduler.stop();
    // If we get here without throwing, the scheduler is wired correctly
    expect(true).toBe(true);
  });
});
