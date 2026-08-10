import { canAutoRunWith } from '../../../src/main/agent-runtime/auto-run-gate';

describe('master switch', () => {
  test('a disabled agent may not be started by the scheduler', () => {
    expect(canAutoRunWith({ enabled: false }, 'schedule')).toBe(false);
  });

  test('a disabled agent may not be started by an event either', () => {
    expect(canAutoRunWith({ enabled: false }, 'event')).toBe(false);
  });

  test('the master switch takes precedence over the per-trigger switch', () => {
    expect(canAutoRunWith({ enabled: false, scheduleEnabled: true }, 'schedule')).toBe(false);
    expect(canAutoRunWith({ enabled: false, eventsEnabled: true }, 'event')).toBe(false);
  });
});

describe('per-trigger switches', () => {
  test('scheduleEnabled gates schedule runs', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false }, 'schedule')).toBe(false);
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule')).toBe(true);
  });

  test('eventsEnabled gates event runs', () => {
    expect(canAutoRunWith({ enabled: true, eventsEnabled: false }, 'event')).toBe(false);
    expect(canAutoRunWith({ enabled: true, eventsEnabled: true }, 'event')).toBe(true);
  });

  test('scheduleEnabled does not gate event runs', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: false }, 'event')).toBe(true);
  });

  test('eventsEnabled does not gate schedule runs', () => {
    expect(canAutoRunWith({ enabled: true, eventsEnabled: false }, 'schedule')).toBe(true);
  });
});

describe('absence is permissive', () => {
  test('undefined settings means enabled', () => {
    expect(canAutoRunWith(undefined, 'schedule')).toBe(true);
    expect(canAutoRunWith(undefined, 'event')).toBe(true);
  });

  test('empty settings means enabled', () => {
    expect(canAutoRunWith({}, 'schedule')).toBe(true);
    expect(canAutoRunWith({}, 'event')).toBe(true);
  });

  test('absent scheduleEnabled means on', () => {
    expect(canAutoRunWith({ enabled: true }, 'schedule')).toBe(true);
  });

  test('absent eventsEnabled means on', () => {
    expect(canAutoRunWith({ enabled: true }, 'event')).toBe(true);
  });
});

describe('auto-pause marker', () => {
  test('an auto-paused agent may not be started by the scheduler', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true }, 'schedule')).toBe(true);
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true, autoPausedAt: 900 }, 'schedule')).toBe(false);
  });

  test('an auto-paused agent may not be started by an event either', () => {
    // Both triggers are automatic, so both are blocked. Running by hand does
    // not pass through this gate at all — "Try again" keeps working.
    expect(canAutoRunWith({ enabled: true, autoPausedAt: 900 }, 'event')).toBe(false);
  });

  test('clearing the marker resumes automatic runs', () => {
    expect(canAutoRunWith({ enabled: true, scheduleEnabled: true, autoPausedAt: undefined }, 'schedule')).toBe(true);
  });
});
