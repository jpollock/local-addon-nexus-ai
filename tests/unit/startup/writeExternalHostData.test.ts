// tests/unit/startup/writeExternalHostData.test.ts
import { writeExternalHostData } from '../../../src/main/startup/writeExternalHostData';

/**
 * Fakes the two real write paths writeExternalHostData uses:
 *  - `upsertSite` for identity + wp_version/php_version (the columns the real
 *    GraphService.upsertSite SQL actually mentions).
 *  - a raw `UPDATE sites SET ...` via `getDb()` for the extended L1/L2 columns
 *    (site_url, post_count, user_count, ssh_last_sync_at, ...) that the real
 *    upsertSite's SQL does NOT mention at all — see the docblock in
 *    writeExternalHostData.ts for why those can't go through upsertSite.
 *
 * The `upsertSite` mock merges only the keys it was actually given, mirroring
 * the real COALESCE behavior: a key omitted from the call leaves the stored
 * value untouched, exactly like COALESCE(NULL, column) does in SQLite.
 */
function graph(existingDomain = 'real.example.com') {
  const rows = new Map<string, any>();
  rows.set('ssh:myhost', { id: 'ssh:myhost', domain: existingDomain, php_version: '8.1.0' });
  const runCalls: Array<[string, any[]]> = [];
  return {
    upsertSite: jest.fn(async (site: any) => { rows.set(site.id, { ...rows.get(site.id), ...site }); }),
    upsertPlugin: jest.fn(async () => 1),
    upsertTheme: jest.fn(async () => 1),
    getDb: () => ({
      prepare: (sql: string) => ({
        get: () => rows.get('ssh:myhost'),
        run: (...a: any[]) => { runCalls.push([sql, a]); },
        all: () => [],
      }),
    }),
    _rows: rows,
    _runCalls: runCalls,
  };
}

/** Finds the extended-column `UPDATE sites SET ...` call and returns its bind params. */
function siteUpdateArgs(g: ReturnType<typeof graph>): any[] | undefined {
  const call = g._runCalls.find(([sql]) => /UPDATE sites SET/i.test(sql));
  return call?.[1];
}

const NOW = 1_800_000_000_000;

describe('writeExternalHostData — the honesty rule', () => {
  it('does not write php_version at all when it was not collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    const written = g.upsertSite.mock.calls[0][0];
    expect(written).not.toHaveProperty('php_version');
    expect(g._rows.get('ssh:myhost').php_version).toBe('8.1.0'); // prior value survives
  });

  it('never substitutes 8.0 for a missing php_version', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', {}, NOW);
    const written = g.upsertSite.mock.calls[0]?.[0] ?? {};
    expect(written.php_version).not.toBe('8.0');
  });

  it('writes a collected php_version', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { phpVersion: '8.3.1' }, NOW);
    expect(g.upsertSite.mock.calls[0][0].php_version).toBe('8.3.1');
  });

  it('never overwrites a real domain with the alias', async () => {
    const g = graph('real.example.com');
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    const written = g.upsertSite.mock.calls[0][0];
    expect(written.domain).toBe('real.example.com');
    expect(written.domain).not.toBe('myhost');
  });

  it('does not write a count of 0 when the count was not collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    // post_count/user_count are extended columns — never on the upsertSite call at all.
    const written = g.upsertSite.mock.calls[0][0];
    expect(written).not.toHaveProperty('post_count');
    expect(written).not.toHaveProperty('user_count');
    // And the raw UPDATE binds NULL for them, which COALESCE turns into "leave alone".
    const args = siteUpdateArgs(g)!;
    expect(args[4]).toBeNull(); // post_count
    expect(args[7]).toBeNull(); // user_count
  });

  it('writes a genuine zero count', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { postCount: 0 }, NOW);
    const args = siteUpdateArgs(g)!;
    expect(args[4]).toBe(0); // post_count — a real zero, not swallowed by the null-guard
  });

  it('does not stamp ssh_last_sync_at when nothing was collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', {}, NOW);
    expect(g.upsertSite).not.toHaveBeenCalled();
    expect(g._runCalls).toHaveLength(0);
  });

  it('stamps ssh_last_sync_at when something was collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    const args = siteUpdateArgs(g)!;
    expect(args[9]).toBe(NOW); // ssh_last_sync_at
  });

  it('writes plugin and theme rows when collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', {
      plugins: [{ slug: 'akismet', name: 'Akismet', version: '5.3', isActive: true }],
      themes:  [{ slug: 'tt4', name: 'TT4', version: '1.0', isActive: true }],
    }, NOW);
    expect(g.upsertPlugin).toHaveBeenCalledWith(expect.objectContaining({
      site_id: 'ssh:myhost', slug: 'akismet', name: 'Akismet', version: '5.3', is_active: true, author: null,
    }));
    expect(g.upsertTheme).toHaveBeenCalledWith(expect.objectContaining({ site_id: 'ssh:myhost', slug: 'tt4' }));
  });

  it('leaves existing plugin rows alone when the plugin batch failed', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    expect(g.upsertPlugin).not.toHaveBeenCalled();
    expect(g._runCalls.filter(([sql]) => /DELETE FROM plugins/i.test(sql))).toHaveLength(0);
  });

  it('removes plugins that no longer exist on the host', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { plugins: [] }, NOW);
    expect(g._runCalls.some(([sql]) => /DELETE FROM plugins/i.test(sql))).toBe(true);
  });
});
