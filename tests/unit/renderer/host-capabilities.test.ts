import { externalHostCapabilities } from '../../../src/renderer/components/settings/hostCapabilities';

describe('externalHostCapabilities', () => {
  it('marks pull, push and delete unavailable — they are WP Engine only', () => {
    const caps = externalHostCapabilities();
    for (const id of ['pull', 'push', 'delete']) {
      expect(caps.find(c => c.id === id)?.state).toBe('unavailable');
    }
  });

  it('marks wpcli gated, not plainly allowed — it is subject to What agents may do', () => {
    expect(externalHostCapabilities().find(c => c.id === 'wpcli')?.state).toBe('gated');
  });

  it('includes reading as allowed, and never as a toggleable permission', () => {
    const read = externalHostCapabilities().find(c => c.id === 'read');
    expect(read?.state).toBe('allowed');
  });

  it('uses exactly three states — no capability is left undescribed', () => {
    const states = new Set(externalHostCapabilities().map(c => c.state));
    for (const s of states) expect(['allowed', 'gated', 'unavailable']).toContain(s);
    expect(states.size).toBe(3);
  });

  it('derives its rows from GRID_ROWS rather than a hand-authored list', () => {
    // C3: the two screens cannot disagree because there is one source.
    // Pin the coupling: every GRID_ROWS id appears exactly once.
    const { GRID_ROWS } = require('../../../src/renderer/components/settings/PermissionsSection');
    const caps = externalHostCapabilities();
    for (const row of GRID_ROWS) {
      expect(caps.filter(c => c.id === row.id)).toHaveLength(1);
    }
  });

  it('carries the label from GRID_ROWS verbatim, not a retyped copy', () => {
    const { GRID_ROWS } = require('../../../src/renderer/components/settings/PermissionsSection');
    const caps = externalHostCapabilities();
    for (const row of GRID_ROWS) {
      expect(caps.find(c => c.id === row.id)?.label).toBe(row.label);
    }
  });
});
