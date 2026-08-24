/**
 * The host-side collector for the fleet collapse — Phase 1.4.
 *
 * The pure model has its own acceptance suite; these tests pin the GLUE: the
 * graph SQL (including the optional-column degrade), the pipeline-twin
 * mapping (latest of l2/l3 wins, outcome → state, reason carried), the D15
 * ceiling wiring, and the local-store shapes (php at services.php.version,
 * wp_version enriched from the graph — never invented).
 */
import Database from 'better-sqlite3';
import { collectFleetCollapse } from '../../../src/main/fleet/collectFleetCollapse';
import { refreshSshGatewayStatus } from '../../../src/main/transport/wpeGatewayStatus';

function makeDb(opts: { withIndexedAt?: boolean } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (
      id TEXT, source TEXT, name TEXT, domain TEXT, wp_version TEXT, php_version TEXT,
      host TEXT, ${opts.withIndexedAt === false ? '' : 'content_indexed_at INTEGER,'}
      last_sync_at INTEGER, remote_install_id TEXT, wpe_site_id TEXT,
      environment TEXT, account_id TEXT, is_active INTEGER
    );
    CREATE TABLE wpe_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT);
  `);
  return db;
}

function insertWpe(db: any, id: string, name: string, over: Record<string, unknown> = {}) {
  const row = {
    id, source: 'wpe', name, domain: `${name}.wpengine.com`, wp_version: '6.8',
    php_version: '8.2', host: null, content_indexed_at: 1, last_sync_at: 1,
    remote_install_id: `inst-${name}`, wpe_site_id: 'prop-1', environment: 'production',
    account_id: 'acct-1', is_active: 1, ...over,
  } as Record<string, unknown>;
  const cols = Object.keys(row).filter((c) => row[c] !== undefined); // undefined = column absent from this schema
  db.prepare(`INSERT INTO sites (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => row[c]));
}

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function fakeCore(facts: Record<string, Record<string, unknown>>) {
  // facts: envId is opaque here — key by fact name only, per-call sequencing
  // is not what these tests pin. The core returns the same facts for any env.
  return { twins: { get: (_env: string, fact: string) => (facts[fact] ? { value: facts[fact] } : undefined) } };
}

describe('collectFleetCollapse — glue behaviours', () => {
  test('assembles graph rows, D21 names and accounts into grouped properties', () => {
    const db = makeDb();
    insertWpe(db, 'wpe-1', 'benfischer');
    insertWpe(db, 'wpe-2', 'benfischer1stg', { environment: 'staging' });

    const out = collectFleetCollapse({
      localSites: [], db, indexEntries: [],
      wpeSites: [{ id: 'prop-1', name: 'benfischer', account_id: 'acct-1' }],
      wpeAccounts: [{ id: 'acct-1', name: 'a', nickname: 'Fischer Digital' }],
      siteLinks: [], core: null,
    });

    expect(out.header.total).toBe(1);
    expect(out.properties[0].name).toBe('benfischer');
    expect(out.properties[0].accountName).toBe('Fischer Digital');
    expect(out.properties[0].places).toHaveLength(2);
  });

  test('a database without content_indexed_at degrades instead of throwing', () => {
    const db = makeDb({ withIndexedAt: false });
    insertWpe(db, 'wpe-1', 'plain', { content_indexed_at: undefined });

    const out = collectFleetCollapse({
      localSites: [], db, indexEntries: [], wpeSites: [], wpeAccounts: [], siteLinks: [], core: null,
    });
    expect(out.header.total).toBe(1);
    expect(out.properties[0].places[0].knowledge).toBe('detailed'); // wp_version present, no index signal
  });

  test('pipeline twins: the LATEST of l2/l3 decides the checked state, reason carried', () => {
    const db = makeDb();
    insertWpe(db, 'wpe-1', 'a');
    const core = fakeCore({
      'pipeline:l2': { outcome: 'ok', finished_at: '2026-08-24T01:00:00.000Z' },
      'pipeline:l3': { outcome: 'fail', finished_at: '2026-08-24T09:00:00.000Z', reason: 'ssh: refused' },
    });

    const out = collectFleetCollapse({
      localSites: [], db, indexEntries: [],
      wpeSites: [{ id: 'prop-1', name: 'A', account_id: 'acct-1' }],
      wpeAccounts: [], siteLinks: [], core,
    });
    const checked = out.properties[0].places[0].checked;
    expect(checked.state).toBe('fail');
    expect(checked.reason).toBe('ssh: refused');
    expect(checked.finishedAt).toBe('2026-08-24T09:00:00.000Z');
  });

  test('no core, or no facts: every place reads never — not ok, not fabricated', () => {
    const db = makeDb();
    insertWpe(db, 'wpe-1', 'a');
    const out = collectFleetCollapse({
      localSites: [], db, indexEntries: [],
      wpeSites: [{ id: 'prop-1', name: 'A', account_id: 'acct-1' }],
      wpeAccounts: [], siteLinks: [], core: null,
    });
    expect(out.properties[0].places[0].checked.state).toBe('never');
  });

  test('a gatewayless account (D15) stamps its stated reason as the ceiling', async () => {
    const db = makeDb();
    db.prepare("INSERT INTO wpe_accounts VALUES ('acct-auto','esm5z2bl7u8vqk','AutoscaleAlpha')").run();
    insertWpe(db, 'wpe-au', 'jpmeautoscale', { account_id: 'acct-auto' });
    await refreshSshGatewayStatus(
      db as never, new Map([['acct-auto', 'jpmeautoscale']]), silent,
      async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
    );

    const out = collectFleetCollapse({
      localSites: [], db, indexEntries: [],
      wpeSites: [{ id: 'prop-1', name: 'Auto', account_id: 'acct-auto' }],
      wpeAccounts: [{ id: 'acct-auto', name: 'esm5z2bl7u8vqk', nickname: 'AutoscaleAlpha' }],
      siteLinks: [], core: null,
    });
    expect(out.properties[0].places[0].ceiling).toContain('AutoscaleAlpha');
  });

  test('local shapes: php from services.php.version, wp from the graph, statuses carried', () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO sites (id, source, name, domain, wp_version, php_version, host, content_indexed_at, last_sync_at, remote_install_id, wpe_site_id, environment, account_id, is_active) " +
      "VALUES ('LocA','local','x','x.local','6.8',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1)",
    ).run();

    const out = collectFleetCollapse({
      localSites: [{ id: 'LocA', name: 'solo', services: { php: { version: '8.2.29' } } }],
      statuses: { LocA: 'running' },
      db, indexEntries: [{ siteId: 'LocA', state: 'indexed' }],
      wpeSites: [], wpeAccounts: [], siteLinks: [], core: null,
    });
    const place = out.properties[0].places[0];
    expect(place.status).toBe('running');
    expect(place.knowledge).toBe('searchable');
    expect(out.header.byOrigin.local).toBe(1);
  });
});
