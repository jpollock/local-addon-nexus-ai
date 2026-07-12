import { DaemonManager } from '../../../src/main/agent-runtime/DaemonManager';
import { defineAgent, stream } from '../../../src/main/agent-sdk';
import Database from 'better-sqlite3';
import { AgentEventBus } from '../../../src/main/agent-event-bus/AgentEventBus';

// Mock child_process so fork() returns a controllable stub rather than spawning
// real OS processes.  The factory must not reference outer variables because
// jest.mock() is hoisted before variable initialisation.
jest.mock('child_process', () => ({
  fork: jest.fn().mockReturnValue({
    pid: 1234,
    kill: jest.fn(),
    on: jest.fn(),
    send: jest.fn().mockReturnValue(true),
  }),
}));

function makeBus() {
  const db = new Database(':memory:');
  return new AgentEventBus(db);
}

const daemonAgent = defineAgent({
  name: 'daemon-test',
  version: '1.0.0',
  triggers: [stream('wp:order.*')],
  run: jest.fn(),
});

describe('DaemonManager', () => {
  it('start() accepts a daemon agent without throwing', () => {
    const manager = new DaemonManager(makeBus());
    expect(() => manager.start(daemonAgent)).not.toThrow();
    manager.stop('daemon-test');
  });

  it('status() returns running after start', () => {
    const manager = new DaemonManager(makeBus());
    manager.start(daemonAgent);
    expect(manager.status('daemon-test')).toBe('running');
    manager.stop('daemon-test');
  });

  it('status() returns stopped after stop', () => {
    const manager = new DaemonManager(makeBus());
    manager.start(daemonAgent);
    manager.stop('daemon-test');
    expect(manager.status('daemon-test')).toBe('stopped');
  });

  it('ignores non-daemon agents (no stream trigger)', () => {
    const manager = new DaemonManager(makeBus());
    // defineAgent rejects empty triggers — shown here for documentation only.
    // The actual guard being tested is the manager's own stream-trigger check.
    // expect(() => defineAgent({ name: 'task', version: '1.0.0', triggers: [], run: jest.fn() })).toThrow();
    const agentWithCron = defineAgent({ name: 'cron-only', version: '1.0.0', triggers: [{ type: 'cron', expression: '* * * * *' }], run: jest.fn() });
    expect(() => manager.start(agentWithCron)).not.toThrow();
    expect(manager.status('cron-only')).toBe('stopped'); // no daemon started
    manager.stopAll();
  });

  it('stopAll() resolves without throwing', async () => {
    const manager = new DaemonManager(makeBus());
    manager.start(daemonAgent);
    await expect(manager.stopAll()).resolves.not.toThrow();
  });

  it('enforces MAX_DAEMONS limit', () => {
    const manager = new DaemonManager(makeBus());
    for (let i = 0; i < 5; i++) {
      const a = defineAgent({ name: `daemon-${i}`, version: '1.0.0', triggers: [stream('wp:*')], run: jest.fn() });
      manager.start(a);
    }
    const overflow = defineAgent({ name: 'daemon-overflow', version: '1.0.0', triggers: [stream('wp:*')], run: jest.fn() });
    expect(() => manager.start(overflow)).toThrow('Maximum daemon agent limit (5) reached');
    manager.stopAll();
  });
});
