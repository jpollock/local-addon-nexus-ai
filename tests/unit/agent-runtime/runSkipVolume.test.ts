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
        return true; // Simulate successful write
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

  it('emits separately for different trigger kinds with same reason on same day', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-10T10:00:00-07:00'));

    const decision: AutoRunDecision = { allowed: false, reason: 'agent-disabled' };

    // Scheduler ticks first (normal case for agents with cron)
    emitRunSkip('test-agent', 'schedule', decision, mockLog);
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0].fields).toEqual({ trigger: 'schedule', reason: 'agent-disabled' });

    // User presses Run Now later the same day - must emit, not be swallowed by schedule slot
    emitRunSkip('test-agent', 'manual', decision, mockLog);
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[1].fields).toEqual({ trigger: 'manual', reason: 'agent-disabled' });

    // Event trigger also emits independently
    emitRunSkip('test-agent', 'event', decision, mockLog);
    expect(writeCalls).toHaveLength(3);
    expect(writeCalls[2].fields).toEqual({ trigger: 'event', reason: 'agent-disabled' });

    // Second manual refusal same day - now suppressed
    emitRunSkip('test-agent', 'manual', decision, mockLog);
    expect(writeCalls).toHaveLength(3); // still 3

    jest.useRealTimers();
  });

  it('does not claim slot when write is dropped by level gate', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-10T10:00:00-07:00'));

    const decision: AutoRunDecision = { allowed: false, reason: 'agent-disabled' };

    // Create a mock that simulates the level gate dropping the write
    const mockLogDropping: jest.Mocked<any> = {
      write: jest.fn(() => false), // Simulates level gate refusing the write
    };

    // First refusal - write returns false (dropped), so slot should NOT be claimed
    emitRunSkip('test-agent', 'schedule', decision, mockLogDropping);
    expect(mockLogDropping.write).toHaveBeenCalledTimes(1);

    // Second refusal - should try to write again because slot wasn't claimed
    emitRunSkip('test-agent', 'schedule', decision, mockLogDropping);
    expect(mockLogDropping.write).toHaveBeenCalledTimes(2);

    // Now with a mock that accepts writes
    const mockLogAccepting: jest.Mocked<any> = {
      write: jest.fn(() => true), // Write succeeds
    };

    // First refusal - write succeeds, slot claimed
    emitRunSkip('test-agent-2', 'schedule', decision, mockLogAccepting);
    expect(mockLogAccepting.write).toHaveBeenCalledTimes(1);

    // Second refusal - should be suppressed (no write call)
    emitRunSkip('test-agent-2', 'schedule', decision, mockLogAccepting);
    expect(mockLogAccepting.write).toHaveBeenCalledTimes(1); // still 1

    jest.useRealTimers();
  });
});
