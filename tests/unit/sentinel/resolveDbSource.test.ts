// tests/unit/sentinel/resolveDbSource.test.ts
//
// Slice 3: deciding whether app/sql/local.sql is trustworthy enough to read as current data —
// without starting the site, without connecting to anything.
//
// The threshold (60s) is chosen from a real fleet measurement: 29 of 38 sites lag 0-4s after a
// clean stop (mysqldump runs before mysqld's own shutdown flush), 7 of 38 lag 59,292-63,108s
// after an unclean one (a pkill/crash skips the dump entirely). There is no observed case
// between those two clusters.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveDbSource } from '../../../src/main/sentinel/scanner/db/resolveDbSource';

let tmp: string;
let siteId: string;
let webRoot: string;
let runDirBase: string;

function writeDump(webRootDir: string, mtimeMs: number, { completed = true } = {}) {
  const sqlDir = path.join(path.dirname(webRootDir), 'sql');
  fs.mkdirSync(sqlDir, { recursive: true });
  const dumpPath = path.join(sqlDir, 'local.sql');
  const body = completed
    ? '-- MySQL dump\nINSERT INTO `wp_options` VALUES (1,\'x\',\'y\',\'yes\');\n-- Dump completed on 2026-08-06 12:00:00\n'
    : '-- MySQL dump\nINSERT INTO `wp_options` VALUES (1,\'x\',\'y\',\'yes\');\n'; // truncated write
  fs.writeFileSync(dumpPath, body);
  fs.utimesSync(dumpPath, new Date(mtimeMs), new Date(mtimeMs));
  return dumpPath;
}

function writeDataFile(engine: 'mysql' | 'mariadb', mtimeMs: number) {
  const dataDir = path.join(runDirBase, siteId, engine, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const f = path.join(dataDir, 'ibdata1');
  fs.writeFileSync(f, 'x');
  fs.utimesSync(f, new Date(mtimeMs), new Date(mtimeMs));
}

function writeSocket(engine: 'mysql' | 'mariadb') {
  const sockDir = path.join(runDirBase, siteId, engine);
  fs.mkdirSync(sockDir, { recursive: true });
  fs.writeFileSync(path.join(sockDir, 'mysqld.sock'), '');
}

beforeEach(() => {
  // Everything — site, dump, and the run/ directory this test stands in for — lives under one
  // temp root. resolveDbSource's real default reads ~/Library/.../Local/run; tests inject an
  // isolated base instead so a test run never touches the developer's actual Local state.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-source-'));
  siteId = 'site-' + Math.random().toString(36).slice(2);
  webRoot = path.join(tmp, 'sites', siteId, 'app', 'public');
  fs.mkdirSync(webRoot, { recursive: true });
  runDirBase = path.join(tmp, 'run');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('resolveDbSource', () => {
  it('refuses when there is no dump at all', () => {
    const r = resolveDbSource(siteId, webRoot, runDirBase);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-dump');
  });

  it('refuses a dump with no completion marker — a partial write, not an old one', () => {
    writeDump(webRoot, Date.now(), { completed: false });
    const r = resolveDbSource(siteId, webRoot, runDirBase);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-completion-marker');
  });

  it('accepts a fresh, complete dump on a halted site with no run/ directory at all', () => {
    writeDump(webRoot, Date.now());
    const r = resolveDbSource(siteId, webRoot, runDirBase);
    expect(r.ok).toBe(true);
  });

  it('accepts a dump lagging a few seconds behind a clean shutdown flush', () => {
    const now = Date.now();
    writeDump(webRoot, now);
    writeDataFile('mysql', now + 2_000); // 2s lag — well inside the clean cluster
    const r = resolveDbSource(siteId, webRoot, runDirBase);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lagMs).toBe(2_000);
  });

  it('refuses a dump lagging hours behind — an uncleanly stopped site', () => {
    const now = Date.now();
    writeDump(webRoot, now);
    writeDataFile('mysql', now + 60 * 60 * 1000); // 1 hour — the killed cluster
    const r = resolveDbSource(siteId, webRoot, runDirBase);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale');
  });

  it('also checks the mariadb data directory, not only mysql', () => {
    const now = Date.now();
    writeDump(webRoot, now);
    writeDataFile('mariadb', now + 60 * 60 * 1000);
    const r = resolveDbSource(siteId, webRoot, runDirBase);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale');
  });

  it('refuses outright when the site is currently running, regardless of dump freshness', () => {
    writeDump(webRoot, Date.now()); // freshest possible dump
    writeSocket('mysql');
    const r = resolveDbSource(siteId, webRoot, runDirBase);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('site-running');
  });

  it('checks the mariadb socket as well as mysql for the running gate', () => {
    writeDump(webRoot, Date.now());
    writeSocket('mariadb');
    const r = resolveDbSource(siteId, webRoot, runDirBase);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('site-running');
  });
});
