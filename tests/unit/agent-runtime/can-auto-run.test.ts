// tests/unit/agent-runtime/can-auto-run.test.ts
//
// A disabled agent must not start itself.
//
// `enabled` is the master switch in the settings UI, but no automatic trigger consulted it:
// AgentScheduler checked `scheduleEnabled` alone, the event bridge checked `eventsEnabled`
// alone, and `enabled` gated only the paths a human drives. security-sentinel therefore sat at
// {enabled: false, scheduleEnabled: true} on a real machine and swept hundreds of sites
// unattended — switched off, still running.

import { canAutoRunWith } from '../../../src/main/agent-runtime/auto-run-gate';

describe('canAutoRunWith', () => {
  // Copied verbatim from agent-settings.json at the time of the incident.
  const REAL_INCIDENT = { enabled: false, scheduleEnabled: true, eventsEnabled: false };

  it('blocks the exact settings that caused the incident', () => {
    // scheduleEnabled was true, so the old `scheduleEnabled`-only check fired the cron.
    expect(REAL_INCIDENT.scheduleEnabled).toBe(true);      // the old check would have passed
    // Stronger than before: not only refused, but refused for the master-switch reason —
    // the fact that actually explains the incident, now that a reason is returned at all.
    expect(canAutoRunWith(REAL_INCIDENT, 'schedule')).toEqual({ allowed: false, reason: 'agent-disabled' });
  });

  it('blocks events for a disabled agent even when eventsEnabled is true', () => {
    expect(canAutoRunWith({ enabled: false, eventsEnabled: true }, 'event'))
      .toEqual({ allowed: false, reason: 'agent-disabled' });
  });

  it('allows a schedule when both flags permit', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule')).toEqual({ allowed: true });
  });

  it('allows an event when both flags permit', () => {
    expect(canAutoRunWith({ enabled: true, eventsEnabled: true }, 'event')).toEqual({ allowed: true });
  });

  it('still honours the per-trigger flag on an enabled agent', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false }, 'schedule'))
      .toEqual({ allowed: false, reason: 'trigger-disabled' });
    expect(canAutoRunWith({ enabled: true, eventsEnabled: false }, 'event'))
      .toEqual({ allowed: false, reason: 'trigger-disabled' });
  });

  it('either flag being false is enough to block', () => {
    const combos: Array<[{ enabled?: boolean; scheduleEnabled?: boolean }, 'agent-disabled' | 'trigger-disabled']> = [
      [{ enabled: false, scheduleEnabled: false }, 'agent-disabled'],
      [{ enabled: false, scheduleEnabled: true }, 'agent-disabled'],
      [{ enabled: true,  scheduleEnabled: false }, 'trigger-disabled'],
    ];
    for (const [s, reason] of combos) {
      expect(canAutoRunWith(s, 'schedule')).toEqual({ allowed: false, reason });
    }
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule')).toEqual({ allowed: true });
  });

  it('does not let the schedule flag leak into the event decision', () => {
    // scheduleEnabled:true must not authorise an event run, and vice versa.
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true, eventsEnabled: false }, 'event'))
      .toEqual({ allowed: false, reason: 'trigger-disabled' });
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false, eventsEnabled: true }, 'schedule'))
      .toEqual({ allowed: false, reason: 'trigger-disabled' });
  });

  it('keeps the existing permissive default when nothing is known', () => {
    // Documented long-standing contract: getAgentSetting is `?? true` before settings sync, and
    // the cache is pre-populated from disk at startup so the window should never open. Narrowing
    // it here would change behaviour for every agent rather than fix this bug.
    expect(canAutoRunWith(undefined, 'schedule')).toEqual({ allowed: true });
    expect(canAutoRunWith({}, 'event')).toEqual({ allowed: true });
  });

  it('a partial record still blocks on the flag that is present', () => {
    expect(canAutoRunWith({ enabled: false }, 'schedule')).toEqual({ allowed: false, reason: 'agent-disabled' });
    expect(canAutoRunWith({ enabled: false }, 'event')).toEqual({ allowed: false, reason: 'agent-disabled' });
  });
});

describe('why a run was refused', () => {
  it('names the master switch', () => {
    // "The agent didn't run" is the first thing a user reports, and it is currently the one
    // case that produces zero bytes anywhere.
    expect(canAutoRunWith({ enabled: false, scheduleEnabled: true }, 'schedule'))
      .toEqual({ allowed: false, reason: 'agent-disabled' });
  });

  it('names the per-trigger switch', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false }, 'schedule'))
      .toEqual({ allowed: false, reason: 'trigger-disabled' });
    expect(canAutoRunWith({ enabled: true, eventsEnabled: false }, 'event'))
      .toEqual({ allowed: false, reason: 'trigger-disabled' });
  });

  it('allows when nothing is explicitly off', () => {
    expect(canAutoRunWith(undefined, 'schedule')).toEqual({ allowed: true });
    expect(canAutoRunWith({ enabled: true }, 'event')).toEqual({ allowed: true });
  });

  it('prefers the master switch when both are off, so the reason is the real one', () => {
    expect(canAutoRunWith({ enabled: false, scheduleEnabled: false }, 'schedule'))
      .toEqual({ allowed: false, reason: 'agent-disabled' });
  });
});

describe('Both automatic trigger paths go through the shared gate', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../../', p), 'utf8');

  it('the cron path calls canAutoRun and no longer checks scheduleEnabled alone', () => {
    const src = read('src/main/agent-runtime/AgentScheduler.ts');
    expect(src).toContain("canAutoRun(agent.name, 'schedule')");
    expect(src).not.toMatch(/getAgentSetting\(agent\.name,\s*'scheduleEnabled'\)/);
  });

  it('the event path calls canAutoRun and no longer checks eventsEnabled alone', () => {
    const src = read('src/main/index.ts');
    expect(src).toContain("canAutoRun(agent.name, 'event')");
    expect(src).not.toMatch(/getAgentSetting\(agent\.name,\s*'eventsEnabled'\)/);
  });

  it('ipc-handlers delegates to the pure predicate rather than reimplementing it', () => {
    const src = read('src/main/ipc-handlers.ts');
    expect(src).toContain('canAutoRunWith(cache?.get(agentId), kind)');
  });
});
