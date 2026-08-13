import { parseTelemetryEnvFlag } from '../../../src/common/telemetryEnv';

describe('parseTelemetryEnvFlag', () => {
  it('treats false/no/off/disable/0 as an explicit opt-out', () => {
    for (const v of ['0', 'false', 'FALSE', ' false ', 'no', 'off', 'disable', 'disabled']) {
      expect(parseTelemetryEnvFlag(v)).toBe(false);
    }
  });

  it('treats true/yes/on/enable/1 as an explicit opt-in', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', 'enable', 'enabled']) {
      expect(parseTelemetryEnvFlag(v)).toBe(true);
    }
  });

  it('returns undefined for unset, empty, or unrecognized values so callers fall through', () => {
    expect(parseTelemetryEnvFlag(undefined)).toBeUndefined();
    expect(parseTelemetryEnvFlag('')).toBeUndefined();
    expect(parseTelemetryEnvFlag('   ')).toBeUndefined();
    expect(parseTelemetryEnvFlag('maybe')).toBeUndefined();
  });

  it('regression: NEXUS_TELEMETRY=false is an opt-out, not a silent no-op', () => {
    // Historically only "0"/"1" were honored, so `NEXUS_TELEMETRY=false` left telemetry ON.
    expect(parseTelemetryEnvFlag('false')).toBe(false);
  });
});
