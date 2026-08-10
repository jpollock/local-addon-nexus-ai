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
    expect(canAutoRunWith(REAL_INCIDENT, 'schedule')).toBe(false);
  });

  it('blocks events for a disabled agent even when eventsEnabled is true', () => {
    expect(canAutoRunWith({ enabled: false, eventsEnabled: true }, 'event')).toBe(false);
  });

  it('allows a schedule when both flags permit', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule')).toBe(true);
  });

  it('allows an event when both flags permit', () => {
    expect(canAutoRunWith({ enabled: true, eventsEnabled: true }, 'event')).toBe(true);
  });

  it('still honours the per-trigger flag on an enabled agent', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false }, 'schedule')).toBe(false);
    expect(canAutoRunWith({ enabled: true, eventsEnabled: false }, 'event')).toBe(false);
  });

  it('either flag being false is enough to block', () => {
    const combos = [
      { enabled: false, scheduleEnabled: false },
      { enabled: false, scheduleEnabled: true },
      { enabled: true,  scheduleEnabled: false },
    ];
    for (const s of combos) expect(canAutoRunWith(s, 'schedule')).toBe(false);
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule')).toBe(true);
  });

  it('does not let the schedule flag leak into the event decision', () => {
    // scheduleEnabled:true must not authorise an event run, and vice versa.
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true, eventsEnabled: false }, 'event')).toBe(false);
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false, eventsEnabled: true }, 'schedule')).toBe(false);
  });

  it('keeps the existing permissive default when nothing is known', () => {
    // Documented long-standing contract: getAgentSetting is `?? true` before settings sync, and
    // the cache is pre-populated from disk at startup so the window should never open. Narrowing
    // it here would change behaviour for every agent rather than fix this bug.
    expect(canAutoRunWith(undefined, 'schedule')).toBe(true);
    expect(canAutoRunWith({}, 'event')).toBe(true);
  });

  it('a partial record still blocks on the flag that is present', () => {
    expect(canAutoRunWith({ enabled: false }, 'schedule')).toBe(false);
    expect(canAutoRunWith({ enabled: false }, 'event')).toBe(false);
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

    // Assert the PROPERTY, not one literal line. This used to pin the exact
    // string `canAutoRunWith(cache?.get(agentId), kind)`, which broke the day
    // canAutoRun legitimately began merging the auto-pause marker into the
    // settings it forwards. Delegation was never in doubt; the literal was.
    const start = src.indexOf('export function canAutoRun(');
    expect(start).toBeGreaterThan(-1);
    const after = src.indexOf('\nexport function ', start + 1);
    const body = src.slice(start, after === -1 ? undefined : after);

    // It must hand the decision to the shared predicate...
    expect(body).toContain('canAutoRunWith(');

    // ...and must not carry its own copy of the gating rules. A second
    // implementation here is exactly the drift the shared predicate removed:
    // the cron path and the event path silently disagreed for months.
    expect(body).not.toMatch(/enabled\s*===\s*false/);
    expect(body).not.toMatch(/scheduleEnabled/);
    expect(body).not.toMatch(/eventsEnabled/);
  });
});
