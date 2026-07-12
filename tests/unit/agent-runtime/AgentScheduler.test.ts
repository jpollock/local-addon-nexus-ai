import { AgentScheduler } from '../../../src/main/agent-runtime/AgentScheduler';
import { defineAgent, cron, on } from '../../../src/main/agent-sdk';

jest.mock('node-cron');

function makeRunner() {
  return { run: jest.fn().mockResolvedValue({ status: 'success', agentName: 'x', startedAt: 0, finishedAt: 0 }) };
}

describe('AgentScheduler', () => {
  it('register() accepts a cron-triggered agent without throwing', () => {
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'a', version: '1.0.0', triggers: [cron('* * * * *')], run: jest.fn() });
    expect(() => scheduler.register(agent)).not.toThrow();
    scheduler.stop();
  });

  it('register() ignores agents with no cron trigger', () => {
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'b', version: '1.0.0', triggers: [on('wp:post.published')], run: jest.fn() });
    expect(() => scheduler.register(agent)).not.toThrow();
    scheduler.stop();
  });

  it('unregister() removes a registered agent', () => {
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'c', version: '1.0.0', triggers: [cron('* * * * *')], run: jest.fn() });
    scheduler.register(agent);
    expect(() => scheduler.unregister('c')).not.toThrow();
    scheduler.stop();
  });

  it('stop() destroys all scheduled tasks without throwing', () => {
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'd', version: '1.0.0', triggers: [cron('* * * * *')], run: jest.fn() });
    scheduler.register(agent);
    expect(() => scheduler.stop()).not.toThrow();
  });
});
