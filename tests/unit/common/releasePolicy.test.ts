import { evaluateReleasePolicy } from '../../../src/common/releasePolicy';

describe('evaluateReleasePolicy (T-KILLSWITCH, fail-safe)', () => {
  it('a null/absent policy never blocks or disables (outage must not brick the tool)', () => {
    expect(evaluateReleasePolicy(null, '0.5.2')).toEqual({ versionBlocked: false, agentsDisabled: false });
    expect(evaluateReleasePolicy(undefined, '0.5.2')).toEqual({ versionBlocked: false, agentsDisabled: false });
    expect(evaluateReleasePolicy({}, '0.5.2')).toEqual({ versionBlocked: false, agentsDisabled: false });
  });

  it('disableAgents=true disables agents but does not block the version', () => {
    const v = evaluateReleasePolicy({ disableAgents: true }, '0.5.2');
    expect(v.agentsDisabled).toBe(true);
    expect(v.versionBlocked).toBe(false);
    expect(v.reason).toMatch(/disabled/i);
  });

  it('an explicitly blocked version blocks and disables agents', () => {
    const v = evaluateReleasePolicy({ blockedVersions: ['0.5.2', '0.5.1'] }, '0.5.2');
    expect(v.versionBlocked).toBe(true);
    expect(v.agentsDisabled).toBe(true);
    expect(v.reason).toMatch(/blocked/i);
  });

  it('a version below minSupportedVersion blocks and disables agents', () => {
    const v = evaluateReleasePolicy({ minSupportedVersion: '0.6.0' }, '0.5.2');
    expect(v.versionBlocked).toBe(true);
    expect(v.agentsDisabled).toBe(true);
    expect(v.reason).toMatch(/minimum|below/i);
  });

  it('a supported, unblocked version with no kill switch is clear', () => {
    const v = evaluateReleasePolicy({ minSupportedVersion: '0.5.0', blockedVersions: ['0.4.9'], disableAgents: false }, '0.5.2');
    expect(v.versionBlocked).toBe(false);
    expect(v.agentsDisabled).toBe(false);
  });

  it('equal to minSupportedVersion is supported (not below)', () => {
    expect(evaluateReleasePolicy({ minSupportedVersion: '0.5.2' }, '0.5.2').versionBlocked).toBe(false);
  });

  it('never throws on malformed input (fail-safe)', () => {
    expect(() => evaluateReleasePolicy({ blockedVersions: 'nope' as any, minSupportedVersion: 42 as any }, 'x')).not.toThrow();
    expect(evaluateReleasePolicy({ blockedVersions: 'nope' as any }, '0.5.2').agentsDisabled).toBe(false);
  });
});
