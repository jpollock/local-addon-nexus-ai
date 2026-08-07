import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3');
import { getLogProcessorConnectedSites } from '../../../src/main/agent-runtime/log-processor-sites';

describe('getLogProcessorConnectedSites', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-log-processor-sites-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty array when log-processor has never run (no db file)', () => {
    expect(getLogProcessorConnectedSites(tmpDir)).toEqual([]);
  });

  it('returns every site with a bound source, connected or not', () => {
    const agentDir = path.join(tmpDir, 'log-processor');
    fs.mkdirSync(agentDir, { recursive: true });
    const db = new BetterSqlite3(path.join(agentDir, 'logs.sqlite'));
    db.exec(`
      CREATE TABLE sources (
        site TEXT PRIMARY KEY, provider TEXT, bucket TEXT, region TEXT, prefix TEXT,
        enabled INTEGER, created_at INTEGER
      );
    `);
    db.prepare('INSERT INTO sources (site, provider, bucket, region, prefix, enabled, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('site-a', 's3', 'bucket-a', 'us-east-1', '', 1, Date.now());
    db.prepare('INSERT INTO sources (site, provider, bucket, region, prefix, enabled, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('site-b', 's3', 'bucket-b', 'us-east-1', '', 0, Date.now());
    db.close();

    expect(getLogProcessorConnectedSites(tmpDir).sort()).toEqual(['site-a', 'site-b']);
  });
});
