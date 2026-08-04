// tests/unit/agents/security-sentinel/fleet-cost.test.js
'use strict';

// The cron trigger is `*/15 * * * *` and fires with no event, so getScanScope() returns nulls,
// collectFleetData() applies no site filter, and every sweep covers the whole fleet — 375 sites
// on the machine this was measured on. Previously that meant two nested serial loops with no
// cap: 343 SSH deep refreshes one at a time, then 375 Tier 1 passes, then Tier 2 (measured at
// ~5 minutes for ONE site) inline for anything that escalated. AgentScheduler has no overlap
// guard, so sweeps that outlive their 15-minute interval stack up.

const agent = require('../../../../agents/security-sentinel/agent');
const {
  mapWithConcurrency, FLEET_CONCURRENCY, MAX_TIER2_PER_SWEEP, MAX_REFRESH_PER_SWEEP,
  collectFleetData, getScanScope,
} = agent._test;

describe('Concurrency is bounded, not unbounded and not serial', () => {
  it('respects the house p-queue ceiling of 3', () => {
    // Local's GraphQL server is single-threaded; the documented rule for resolvers doing real
    // work is concurrency <= 3. Raising this trades a faster sweep for a stalled event loop.
    expect(FLEET_CONCURRENCY).toBeLessThanOrEqual(3);
    expect(FLEET_CONCURRENCY).toBeGreaterThan(1);
  });

  it('never exceeds the limit in flight', async () => {
    let inFlight = 0, peak = 0;
    await mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 3, async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBe(3);
  });

  it('preserves input order regardless of completion order', async () => {
    const out = await mapWithConcurrency([30, 5, 20, 1], 3, async (ms) => {
      await new Promise(r => setTimeout(r, ms));
      return ms;
    });
    expect(out.map(r => r.value)).toEqual([30, 5, 20, 1]);
  });

  it('isolates a rejection instead of failing the whole sweep', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('site 2 unreachable');
      return n;
    });
    expect(out[0].value).toBe(1);
    expect(out[1].error.message).toBe('site 2 unreachable');
    expect(out[2].value).toBe(3);
  });

  it('handles an empty list without hanging', async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });

  it('does not spawn more workers than items', async () => {
    let started = 0;
    await mapWithConcurrency([1], 8, async () => { started++; });
    expect(started).toBe(1);
  });
});

describe('Expensive work is capped per sweep', () => {
  it('caps Tier 2 investigations', () => {
    // A measured Tier 2 is ~5 min and leaves a full site clone on disk. Thirteen accumulated
    // to 6.5 GB on one machine.
    expect(MAX_TIER2_PER_SWEEP).toBeGreaterThan(0);
    expect(MAX_TIER2_PER_SWEEP).toBeLessThanOrEqual(5);
  });

  it('caps SSH deep refreshes well below a full fleet', () => {
    expect(MAX_REFRESH_PER_SWEEP).toBeGreaterThan(0);
    expect(MAX_REFRESH_PER_SWEEP).toBeLessThanOrEqual(25);
  });
});

describe('collectFleetData refreshes a bounded subset and reports the rest', () => {
  /** rows come back through parseSqlResult, so the mock must emit the pipe-table shape. */
  function sqlTable(cols, rows) {
    return [
      `| ${cols.join(' | ')} |`,
      `| ${cols.map(() => '---').join(' | ')} |`,
      ...rows.map(r => `| ${r.join(' | ')} |`),
    ].join('\n');
  }

  function mkTools(siteCount) {
    const cols = ['id', 'name', 'source', 'environment', 'ssh_last_sync_at', 'post_count',
                  'user_count', 'settings_json', 'wp_version', 'php_version', 'admin_email',
                  'account_id', 'domain'];
    const rows = Array.from({ length: siteCount }, (_, i) =>
      [`id${i}`, `site${i}`, 'wpe', 'production', '', '0', '0', '', '7.0', '8.3', '', 'acct', '']);

    const refreshCalls = [];
    const invoke = jest.fn(async (tool, args) => {
      if (tool === 'wpe_site_deep_refresh') { refreshCalls.push(args.install_name); return 'ok'; }
      if (tool === 'fleet_sql') {
        if (String(args.query).includes('FROM sites')) return sqlTable(cols, rows);
        return sqlTable(['a'], []);   // plugins / users — empty
      }
      return '';
    });
    return { tools: { invoke }, refreshCalls };
  }

  const mkLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

  it('refreshes at most MAX_REFRESH_PER_SWEEP even with a large fleet', async () => {
    const { tools, refreshCalls } = mkTools(50);
    const log = mkLog();
    const installs = await collectFleetData(tools, null, null, log);

    expect(refreshCalls.length).toBe(MAX_REFRESH_PER_SWEEP);
    expect(installs).toHaveLength(50);   // every site is still swept
  });

  it('says how many refreshes it deferred rather than silently skipping', async () => {
    const { tools } = mkTools(50);
    const log = mkLog();
    await collectFleetData(tools, null, null, log);

    const said = log.info.mock.calls.flat().join(' ');
    expect(said).toMatch(/50 install\(s\) have never completed an SSH sync/);
    expect(said).toMatch(/deferred/);
  });

  it('surfaces refresh failures instead of swallowing them one by one', async () => {
    const { tools } = mkTools(5);
    tools.invoke.mockImplementation(async (tool, args) => {
      if (tool === 'wpe_site_deep_refresh') throw new Error('ssh: connect timed out');
      if (tool === 'fleet_sql') {
        const cols = ['id', 'name', 'source', 'environment', 'ssh_last_sync_at', 'post_count',
                      'user_count', 'settings_json', 'wp_version', 'php_version', 'admin_email',
                      'account_id', 'domain'];
        if (String(args.query).includes('FROM sites')) {
          return sqlTable(cols, [['id0', 'site0', 'wpe', 'production', '', '0', '0', '', '7.0', '8.3', '', 'a', '']]);
        }
        return sqlTable(['a'], []);
      }
      return '';
    });
    const log = mkLog();
    await collectFleetData(tools, null, null, log);

    expect(log.warn.mock.calls.flat().join(' ')).toMatch(/deep refresh\(es\) failed.*connect timed out/);
  });

  it('does not refresh local sites — they have no SSH', async () => {
    const cols = ['id', 'name', 'source', 'environment', 'ssh_last_sync_at', 'post_count',
                  'user_count', 'settings_json', 'wp_version', 'php_version', 'admin_email',
                  'account_id', 'domain'];
    const refreshCalls = [];
    const tools = {
      invoke: jest.fn(async (tool, args) => {
        if (tool === 'wpe_site_deep_refresh') { refreshCalls.push(args.install_name); return 'ok'; }
        if (String(args?.query ?? '').includes('FROM sites')) {
          return sqlTable(cols, [['id0', 'localsite', 'local', 'development', '', '0', '0', '', '7.0', '8.3', '', 'a', '']]);
        }
        return sqlTable(['a'], []);
      }),
    };
    await collectFleetData(tools, null, null, mkLog());
    expect(refreshCalls).toHaveLength(0);
  });
});

describe('The cron trigger really is fleet-wide', () => {
  // This is why the caps matter: the cron fires with no event, so nothing narrows the scope.
  it('getScanScope returns nulls when there is no event', () => {
    expect(getScanScope(undefined)).toEqual({ installId: null, installName: null });
    expect(getScanScope(null)).toEqual({ installId: null, installName: null });
  });

  it('getScanScope only narrows for a wpe sync.completed event', () => {
    expect(getScanScope({ namespace: 'wpe', type: 'sync.completed', payload: { installName: 'x' } }))
      .toEqual({ installId: null, installName: 'x' });
    expect(getScanScope({ namespace: 'cron', type: 'tick' }))
      .toEqual({ installId: null, installName: null });
  });
});
