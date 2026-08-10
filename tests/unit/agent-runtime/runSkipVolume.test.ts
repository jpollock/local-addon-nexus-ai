/**
 * run.skip deduplication — emit on transition, not on every tick
 *
 * Three disabled agents on 15-minute cadences produce ~288 identical lines a day without
 * deduplication. This test verifies that run.skip is emitted only on the first refusal for
 * an agent, and again only if the reason changes.
 */
import { emitRunSkip, resetRunSkipCache } from '../../../src/main/ipc-handlers';
import type { EventLog } from '../../../src/main/logging/eventLog';
import type { SkipTrigger, AutoRunDecision } from '../../../src/main/agent-runtime/auto-run-gate';

describe('run.skip volume reduction', () => {
  let mockLog: jest.Mocked<EventLog>;
  let writeCalls: any[];

  beforeEach(() => {
    resetRunSkipCache(); // Clear cache between tests
    writeCalls = [];
    mockLog = {
      write: jest.fn((event) => {
        writeCalls.push(event);
      }),
    } as any;
  });

  it('emits run.skip on first refusal', () => {
    const decision: AutoRunDecision = { allowed: false, reason: 'agent-disabled' };
    emitRunSkip('test-agent', 'schedule', decision, mockLog);

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toMatchObject({
      level: 'INFO',
      source: 'test-agent',
      event: 'run.skip',
      fields: { trigger: 'schedule', reason: 'agent-disabled' },
    });
  });

  it('does not emit on allowed decision', () => {
    const decision: AutoRunDecision = { allowed: true };
    emitRunSkip('test-agent', 'schedule', decision, mockLog);

    expect(writeCalls).toHaveLength(0);
  });

  it('suppresses repeated refusals with same reason', () => {
    const decision: AutoRunDecision = { allowed: false, reason: 'trigger-disabled' };

    // First refusal - should emit
    emitRunSkip('test-agent', 'event', decision, mockLog);
    expect(writeCalls).toHaveLength(1);

    // Second refusal, same reason - should NOT emit
    emitRunSkip('test-agent', 'event', decision, mockLog);
    expect(writeCalls).toHaveLength(1); // still 1

    // Third refusal, same reason - should NOT emit
    emitRunSkip('test-agent', 'event', decision, mockLog);
    expect(writeCalls).toHaveLength(1); // still 1
  });

  it('emits again when reason changes', () => {
    // First refusal: trigger-disabled
    emitRunSkip('test-agent', 'schedule', { allowed: false, reason: 'trigger-disabled' }, mockLog);
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0].fields?.reason).toBe('trigger-disabled');

    // Second refusal: reason changed to agent-disabled
    emitRunSkip('test-agent', 'schedule', { allowed: false, reason: 'agent-disabled' }, mockLog);
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[1].fields?.reason).toBe('agent-disabled');

    // Third refusal: same new reason - should NOT emit
    emitRunSkip('test-agent', 'schedule', { allowed: false, reason: 'agent-disabled' }, mockLog);
    expect(writeCalls).toHaveLength(2); // still 2
  });

  it('tracks different agents independently', () => {
    const decision: AutoRunDecision = { allowed: false, reason: 'agent-disabled' };

    // First agent refuses
    emitRunSkip('agent-one', 'schedule', decision, mockLog);
    expect(writeCalls).toHaveLength(1);

    // Second agent refuses (different agent) - should emit
    emitRunSkip('agent-two', 'schedule', decision, mockLog);
    expect(writeCalls).toHaveLength(2);

    // First agent refuses again - should NOT emit
    emitRunSkip('agent-one', 'schedule', decision, mockLog);
    expect(writeCalls).toHaveLength(2); // still 2
  });

  it('emits once per day for the same agent and reason (day-keyed deduplication)', () => {
    // Use fake timers to control time
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-10T10:00:00-07:00')); // Sunday 10am PDT

    const decision: AutoRunDecision = { allowed: false, reason: 'agent-disabled' };

    // First refusal on Sunday - should emit
    emitRunSkip('test-agent', 'schedule', decision, mockLog);
    expect(writeCalls).toHaveLength(1);

    // Same refusal 2 hours later on Sunday - should NOT emit
    jest.setSystemTime(new Date('2026-08-10T12:00:00-07:00'));
    emitRunSkip('test-agent', 'schedule', decision, mockLog);
    expect(writeCalls).toHaveLength(1); // still 1

    // Cross midnight into Monday - same reason should emit again (new day's log file)
    jest.setSystemTime(new Date('2026-08-11T02:00:00-07:00')); // Monday 2am PDT
    emitRunSkip('test-agent', 'schedule', decision, mockLog);
    expect(writeCalls).toHaveLength(2); // Monday's file gets its line

    // Same reason later Monday - should NOT emit
    jest.setSystemTime(new Date('2026-08-11T10:00:00-07:00'));
    emitRunSkip('test-agent', 'schedule', decision, mockLog);
    expect(writeCalls).toHaveLength(2); // still 2

    jest.useRealTimers();
  });
});
