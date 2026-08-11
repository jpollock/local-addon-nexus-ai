import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3');
import { getLogProcessorConnectedSites, getLogProcessorState } from '../../../src/main/agent-runtime/log-processor-sites';

const SCHEMA = `
  CREATE TABLE bucket_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    bucket TEXT NOT NULL, region TEXT NOT NULL, prefix TEXT NOT NULL,
    last_scanned_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE install_scan (
    site TEXT PRIMARY KEY, object_count INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
    oldest_object_at TEXT, newest_object_at TEXT, sample_key TEXT, scanned_at INTEGER NOT NULL
  );
  CREATE TABLE ledger (
    site TEXT, file_date TEXT, files INTEGER, bytes INTEGER, lines INTEGER, processed_at INTEGER,
    PRIMARY KEY (site, file_date)
  );
`;

function makeFixture(tmpDir: string, apply: (db: any) => void, schema = SCHEMA): void {
  const agentDir = path.join(tmpDir, 'log-processor');
  fs.mkdirSync(agentDir, { recursive: true });
  const db = new BetterSqlite3(path.join(agentDir, 'logs.sqlite'));
  db.exec(schema);
  apply(db);
  db.close();
}

const insertScan = (db: any, site: string, objects: number) =>
  db.prepare('INSERT INTO install_scan (site, object_count, bytes, oldest_object_at, newest_object_at, sample_key, scanned_at) VALUES (?,?,?,?,?,?,?)')
    .run(site, objects, objects * 1000, '2026-07-01', '2026-08-01', `20260801-0016-${site}.apachestyle.log.gz`, 5000);

describe('getLogProcessorState', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-log-processor-state-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('reports no bucket and no installs when log-processor has never run', () => {
    expect(getLogProcessorState(tmpDir)).toEqual({ bucket: null, installs: [] });
  });

  it('returns the account bucket and every install found in it', () => {
    makeFixture(tmpDir, db => {
      db.prepare('INSERT INTO bucket_config (id, bucket, region, prefix, last_scanned_at, created_at) VALUES (1,?,?,?,?,?)')
        .run('wpejpp', 'us-east-1', 'wpe_logs/nginx/', 9000, 1);
      insertScan(db, 'synced-install', 312);
      insertScan(db, 'never-synced', 44);
      db.prepare('INSERT INTO ledger (site, file_date, files, bytes, lines, processed_at) VALUES (?,?,?,?,?,?)')
        .run('synced-install', '2026-08-01', 1, 100, 10, 1000);
      db.prepare('INSERT INTO ledger (site, file_date, files, bytes, lines, processed_at) VALUES (?,?,?,?,?,?)')
        .run('synced-install', '2026-08-02', 1, 100, 10, 2000);
    });

    const state = getLogProcessorState(tmpDir);
    expect(state.bucket).toEqual({ bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx/', lastScannedAt: 9000 });
    expect(state.installs).toEqual([
      {
        site: 'never-synced', objectCount: 44, bytes: 44_000,
        oldestObjectAt: '2026-07-01', newestObjectAt: '2026-08-01',
        sampleKey: '20260801-0016-never-synced.apachestyle.log.gz', lastSyncedAt: null,
      },
      {
        site: 'synced-install', objectCount: 312, bytes: 312_000,
        oldestObjectAt: '2026-07-01', newestObjectAt: '2026-08-01',
        sampleKey: '20260801-0016-synced-install.apachestyle.log.gz', lastSyncedAt: 2000,
      },
    ]);
  });

  it('reads as "nothing connected" against a pre-v3 database rather than crashing', () => {
    // A database written by the per-site build has `sources` but neither new table. The tab must
    // render its empty state, not blow up on a missing-table error.
    makeFixture(tmpDir, db => {
      db.prepare('INSERT INTO sources (site, provider, bucket, region, prefix, enabled, created_at) VALUES (?,?,?,?,?,?,?)')
        .run('legacy-site', 's3', 'old-bucket', 'us-east-1', '', 1, 1);
    }, `
      CREATE TABLE sources (
        site TEXT PRIMARY KEY, provider TEXT, bucket TEXT, region TEXT, prefix TEXT,
        enabled INTEGER, created_at INTEGER
      );
    `);

    expect(getLogProcessorState(tmpDir)).toEqual({ bucket: null, installs: [] });
  });
});

describe('getLogProcessorConnectedSites', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-log-processor-sites-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns an empty array when log-processor has never run (no db file)', () => {
    expect(getLogProcessorConnectedSites(tmpDir)).toEqual([]);
  });

  it('returns only installs that actually have objects in the bucket', () => {
    makeFixture(tmpDir, db => {
      insertScan(db, 'has-logs', 312);
      // A row can survive a rescan with zero objects; it must not be offered as a run target,
      // because the schedule would have nothing to read for it.
      insertScan(db, 'no-logs', 0);
    });
    expect(getLogProcessorConnectedSites(tmpDir)).toEqual(['has-logs']);
  });
});
