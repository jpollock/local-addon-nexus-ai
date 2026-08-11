import { canAutoRunWith } from '../../../src/main/agent-runtime/auto-run-gate';

describe('master switch', () => {
  test('a disabled agent may not be started by the scheduler', () => {
    expect(canAutoRunWith({ enabled: false }, 'schedule').allowed).toBe(false);
  });

  test('a disabled agent may not be started by an event either', () => {
    expect(canAutoRunWith({ enabled: false }, 'event').allowed).toBe(false);
  });

  test('the master switch takes precedence over the per-trigger switch', () => {
    expect(canAutoRunWith({ enabled: false, scheduleEnabled: true }, 'schedule').allowed).toBe(false);
    expect(canAutoRunWith({ enabled: false, eventsEnabled: true }, 'event').allowed).toBe(false);
  });
});

describe('per-trigger switches', () => {
  test('scheduleEnabled gates schedule runs', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false }, 'schedule').allowed).toBe(false);
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule').allowed).toBe(true);
  });

  test('eventsEnabled gates event runs', () => {
    expect(canAutoRunWith({ enabled: true, eventsEnabled: false }, 'event').allowed).toBe(false);
    expect(canAutoRunWith({ enabled: true, eventsEnabled: true }, 'event').allowed).toBe(true);
  });

  test('scheduleEnabled does not gate event runs', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false }, 'event').allowed).toBe(true);
  });

  test('eventsEnabled does not gate schedule runs', () => {
    expect(canAutoRunWith({ enabled: true, eventsEnabled: false }, 'schedule').allowed).toBe(true);
  });
});

describe('absence is permissive', () => {
  test('undefined settings means enabled', () => {
    expect(canAutoRunWith(undefined, 'schedule').allowed).toBe(true);
    expect(canAutoRunWith(undefined, 'event').allowed).toBe(true);
  });

  test('empty settings means enabled', () => {
    expect(canAutoRunWith({}, 'schedule').allowed).toBe(true);
    expect(canAutoRunWith({}, 'event').allowed).toBe(true);
  });

  test('absent scheduleEnabled means on', () => {
    expect(canAutoRunWith({ enabled: true }, 'schedule').allowed).toBe(true);
  });

  test('absent eventsEnabled means on', () => {
    expect(canAutoRunWith({ enabled: true }, 'event').allowed).toBe(true);
  });
});

describe('auto-pause marker', () => {
  test('an auto-paused agent may not be started by the scheduler', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule').allowed).toBe(true);
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true, autoPausedAt: 900 }, 'schedule').allowed).toBe(false);
  });

  test('an auto-paused agent may not be started by an event either', () => {
    // Both triggers are automatic, so both are blocked. Running by hand does
    // not pass through this gate at all — "Try again" keeps working.
    expect(canAutoRunWith({ enabled: true, autoPausedAt: 900 }, 'event').allowed).toBe(false);
  });

  test('clearing the marker resumes automatic runs', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true, autoPausedAt: undefined }, 'schedule').allowed).toBe(true);
  });

  test('reports auto-pause as its own reason, never as agent-disabled', () => {
    // The whole point of keeping autoPausedAt separate from `enabled` is that the user set
    // one and Nexus set the other. Collapsing them in the skip reason puts that confusion
    // straight back into the log the user reads to find out why nothing ran.
    const paused = canAutoRunWith({ enabled: true, scheduleEnabled: true, autoPausedAt: 900 }, 'schedule');
    expect(paused).toEqual({ allowed: false, reason: 'auto-paused' });

    const disabled = canAutoRunWith({ enabled: false, autoPausedAt: 900 }, 'schedule');
    expect(disabled).toEqual({ allowed: false, reason: 'agent-disabled' });
  });
});
