/**
 * fixes-082526 · item 4 — the external health-scoring gate exists ONCE.
 *
 * CLAUDE.md recorded the defect by name: the gate was duplicated between
 * `resolvers.ts` (GraphQL/CLI path) and `get-site-health.ts` (MCP path),
 * "NOT pinned together by any test — a change to one must be mirrored to the
 * other." Unlike the resolveAgentCron/effectiveCadence pair, both copies
 * live in the main bundle, so the honest fix is extraction, not a pinning
 * table: one function, two importers, zero copies to drift.
 *
 * The rule itself (from the fleet-counts doctrine): the gate is DATA
 * PRESENCE, not host class. An external host is scored on security +
 * performance only once a refresh has populated plugin rows AND a real
 * php_version — scoring off zero plugin rows once produced "no security
 * plugin detected" and full plugin-hygiene credit from the same absence.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { remoteHealthFactors } from '../../../src/main/health/remoteFactors';

function db(pluginRowsFor: string[] = []) {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE plugins (site_id TEXT, slug TEXT)');
  const ins = d.prepare('INSERT INTO plugins (site_id, slug) VALUES (?, ?)');
  for (const id of pluginRowsFor) ins.run(id, 'akismet');
  return d;
}

describe('remoteHealthFactors — the one gate', () => {
  it('a WPE install is scored on security + performance, unconditionally', () => {
    expect(remoteHealthFactors(db(), { id: 's1', source: 'wpe', php_version: undefined }))
      .toEqual(['security', 'performance']);
  });

  it('a refreshed external host (plugins + php_version) is scored like a WPE install', () => {
    expect(remoteHealthFactors(db(['s1']), { id: 's1', source: 'external', php_version: '8.3.1' }))
      .toEqual(['security', 'performance']);
  });

  it('an external host with no plugin rows is NOT scored — absence must not earn credit', () => {
    expect(remoteHealthFactors(db(), { id: 's1', source: 'external', php_version: '8.3.1' }))
      .toEqual([]);
  });

  it('an external host with plugins but no php_version is NOT scored (proc_open hosts)', () => {
    expect(remoteHealthFactors(db(['s1']), { id: 's1', source: 'external', php_version: undefined }))
      .toEqual([]);
  });

  it('another site\'s plugin rows do not make this one scoreable', () => {
    expect(remoteHealthFactors(db(['other']), { id: 's1', source: 'external', php_version: '8.3.1' }))
      .toEqual([]);
  });
});

describe('the duplication stays dead', () => {
  const read = (p: string) =>
    fs.readFileSync(path.join(__dirname, '../../../', p), 'utf8');

  it.each([
    'src/main/graphql/resolvers.ts',
    'src/main/mcp/modules/fleet-intelligence/get-site-health.ts',
  ])('%s imports the shared gate and keeps no inline copy', (file) => {
    const src = read(file);
    expect(src).toContain('remoteHealthFactors');
    // The inline copy's fingerprint: its own COUNT query against plugins in
    // service of scoring. Reintroducing it here is the drift this kills.
    expect(src).not.toMatch(/externalScoreable/);
  });
});
