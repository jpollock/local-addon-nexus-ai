/**
 * fixes-082526 · Tier A 7 — the sentinel cadence floor.
 *
 * The incident this encodes: security-sentinel sweeping 375 sites every 15
 * minutes — a full Tier 2/3 investigation per site per tick — because the
 * picker offered the interval and a seeded cadence made it look chosen. The
 * agent's manifest schedule is daily 03:00; the picker offering the 15-minute cron for it
 * re-arms the retired incident with one click.
 *
 * The floor is per-agent, not global: content-shaped agents legitimately run
 * every 15 minutes. Only the agent whose every run is a production-scale
 * investigation loses the interval.
 */
import { cadenceOptionsFor } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';

describe('cadenceOptionsFor', () => {
  it('security-sentinel is never offered the 15-minute interval', () => {
    const values = cadenceOptionsFor('security-sentinel').map((o) => o.value);
    expect(values).not.toContain('*/15 * * * *');
    expect(values[0]).toBe('0 * * * *'); // hourly is the new floor
    expect(values).toContain('0 0 * * *'); // the manifest's own daily remains
  });

  it('every other agent keeps the full list, 15 minutes included', () => {
    for (const agent of ['seo-insights', 'web-analytics', 'log-processor']) {
      expect(cadenceOptionsFor(agent).map((o) => o.value)).toContain('*/15 * * * *');
    }
  });

  it('cycling from a stored 15-minute cadence moves OFF it for the sentinel, not around to it', () => {
    // The seeded default is the 15-minute cron; findIndex misses on the filtered list and
    // the cycle must land on a legal option, never back on the floor-breaker.
    const options = cadenceOptionsFor('security-sentinel');
    const idx = options.findIndex((o) => o.value === '*/15 * * * *');
    const next = options[(idx + 1) % options.length];
    expect(next.value).toBe('0 * * * *');
  });
});
