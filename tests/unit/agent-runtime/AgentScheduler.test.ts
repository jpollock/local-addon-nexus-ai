import { AgentScheduler } from '../../../src/main/agent-runtime/AgentScheduler';
import { defineAgent, cron, on } from '../../../src/main/agent-sdk';
import * as nodeCron from 'node-cron';

jest.mock('node-cron');

function makeRunner() {
  return { run: jest.fn().mockResolvedValue({ status: 'success', agentName: 'x', startedAt: 0, finishedAt: 0 }) };
}

function makeMockTask() {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
  };
}

describe('AgentScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const mockTask = makeMockTask();
    (nodeCron.validate as jest.Mock).mockReturnValue(true);
    (nodeCron.schedule as jest.Mock).mockReturnValue(mockTask);
  });

  it('register() accepts a cron-triggered agent without throwing', () => {
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'a', version: '1.0.0', triggers: [cron('* * * * *')], run: jest.fn() });
    scheduler.register(agent);
    expect(nodeCron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
    scheduler.stop();
  });

  it('register() ignores agents with no cron trigger', () => {
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'b', version: '1.0.0', triggers: [on('wp:post.published')], run: jest.fn() });
    scheduler.register(agent);
    expect(nodeCron.schedule).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('start() starts all registered tasks', () => {
    const mockTask = makeMockTask();
    (nodeCron.schedule as jest.Mock).mockReturnValue(mockTask);
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'e', version: '1.0.0', triggers: [cron('* * * * *')], run: jest.fn() });
    scheduler.register(agent);
    scheduler.start();
    expect(mockTask.start).toHaveBeenCalled();
    scheduler.stop();
  });

  it('unregister() removes a registered agent and calls destroy', () => {
    const mockTask = makeMockTask();
    (nodeCron.schedule as jest.Mock).mockReturnValue(mockTask);
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'c', version: '1.0.0', triggers: [cron('* * * * *')], run: jest.fn() });
    scheduler.register(agent);
    scheduler.unregister('c');
    expect(mockTask.stop).toHaveBeenCalled();
    expect(mockTask.destroy).toHaveBeenCalled();
    scheduler.stop();
  });

  it('stop() destroys all scheduled tasks without throwing', () => {
    const mockTask = makeMockTask();
    (nodeCron.schedule as jest.Mock).mockReturnValue(mockTask);
    const scheduler = new AgentScheduler(makeRunner() as any);
    const agent = defineAgent({ name: 'd', version: '1.0.0', triggers: [cron('* * * * *')], run: jest.fn() });
    scheduler.register(agent);
    scheduler.stop();
    expect(mockTask.stop).toHaveBeenCalled();
  });
});
