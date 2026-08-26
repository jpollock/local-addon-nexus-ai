/**
 * fixes-082526 · item 5 — the fleet health loops stop fabricating.
 *
 * CLAUDE.md names the trio: nexusFleetHealth, fleet_health_summary and
 * DASHBOARD_V2_STATS all iterate the CONTENT-INDEX population (423 entries,
 * 297 of them WPE install ids), look each id up in Local's store, and on the
 * miss fabricate phpVersion '8.0' and score all five factors — maintenance
 * and activity read local-only tables, so every WPE entry scored 0 on 35% of
 * its weight and the "critical" count was an artifact of the join, not the
 * fleet. "Fixing one without the other two leaves the bug reachable from a
 * different surface" — so the derivation exists ONCE, and the three loops
 * consume it.
 *
 * The rules, each pinned below:
 *  - a LOCAL entry keeps all five factors and its real version; no '8.0';
 *  - a WPE entry resolves through the graph (install id → row), scores
 *    security+performance off the ROW's id (where its plugin rows live) and
 *    the row's php_version — or honestly undefined;
 *  - an EXTERNAL entry goes through remoteHealthFactors (item 4's gate) —
 *    unscoreable data-absence is EXCLUDED, not scored zero, because
 *    calculateScore throws on an empty factor set by design;
 *  - an entry no store can resolve is UNRESOLVED — named, never scored 0
 *    into the critical bucket.
 */
import Database from 'better-sqlite3';
import { buildFleetScoringInputs } from '../../../src/main/health/fleetScoring';

function graphDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE sites (
    id TEXT PRIMARY KEY, name TEXT, source TEXT, is_active INTEGER,
    remote_install_id TEXT, domain TEXT, php_version TEXT
  );
  CREATE TABLE plugins (site_id TEXT, slug TEXT);`);
  return d;
}

const LOCAL_SITES = {
  loc1: { domain: 'loc1.local', phpVersion: '8.2.9' },
  loc2: { domain: 'loc2.local' }, // no version recorded — stays undefined, never 8.0
};

describe('buildFleetScoringInputs', () => {
  it('a local entry: all five factors (default), real version, no fabrication', () => {
    const out = buildFleetScoringInputs([{ siteId: 'loc1' }, { siteId: 'loc2' }], LOCAL_SITES, null);
    expect(out.siteIds).toEqual(['loc1', 'loc2']);
    expect(out.siteInfoMap.loc1).toEqual({ domain: 'loc1.local', phpVersion: '8.2.9' });
    expect(out.siteInfoMap.loc2.phpVersion).toBeUndefined();
    expect(out.perSite.loc1).toBeUndefined(); // default = all five
    expect(out.unresolved).toEqual([]);
  });

  it('a WPE entry resolves install id → graph row: remote factors, row-id data, row version', () => {
    const db = graphDb();
    db.prepare("INSERT INTO sites VALUES ('row9','mysite','wpe',1,'myinstall','my.wpengine.com','8.1.27')").run();
    const out = buildFleetScoringInputs([{ siteId: 'myinstall' }], {}, db);
    expect(out.siteIds).toEqual(['myinstall']); // result keys stay the caller's ids
    expect(out.siteInfoMap.myinstall).toMatchObject({ domain: 'my.wpengine.com', phpVersion: '8.1.27' });
    expect(out.perSite.myinstall).toEqual({ factors: ['security', 'performance'], dataSiteId: 'row9' });
  });

  it('a WPE row with no php_version stays undefined — the calculator has the honest path', () => {
    const db = graphDb();
    db.prepare("INSERT INTO sites VALUES ('row9','mysite','wpe',1,'myinstall','my.wpengine.com',NULL)").run();
    const out = buildFleetScoringInputs([{ siteId: 'myinstall' }], {}, db);
    expect(out.siteInfoMap.myinstall.phpVersion).toBeUndefined();
  });

  it('an external entry passes item 4\'s gate: refreshed → scored, unrefreshed → EXCLUDED', () => {
    const db = graphDb();
    db.prepare("INSERT INTO sites VALUES ('ssh:a/b','b','external',1,NULL,'b.example','8.3.1')").run();
    db.prepare("INSERT INTO plugins VALUES ('ssh:a/b','akismet')").run();
    db.prepare("INSERT INTO sites VALUES ('ssh:a/c','c','external',1,NULL,'c.example',NULL)").run();
    const out = buildFleetScoringInputs([{ siteId: 'ssh:a/b' }, { siteId: 'ssh:a/c' }], {}, db);
    expect(out.siteIds).toEqual(['ssh:a/b']);
    expect(out.perSite['ssh:a/b']).toEqual({ factors: ['security', 'performance'], dataSiteId: 'ssh:a/b' });
    expect(out.unresolved).toEqual([{ siteId: 'ssh:a/c', reason: 'not enough data to score' }]);
  });

  it('an entry nothing resolves is UNRESOLVED, never scored into the critical bucket', () => {
    const out = buildFleetScoringInputs([{ siteId: 'ghost' }], {}, graphDb());
    expect(out.siteIds).toEqual([]);
    expect(out.unresolved).toEqual([{ siteId: 'ghost', reason: 'not in any store' }]);
  });

  it('with no graph handle, a non-local entry is unresolved rather than guessed at', () => {
    const out = buildFleetScoringInputs([{ siteId: 'myinstall' }], {}, null);
    expect(out.siteIds).toEqual([]);
    expect(out.unresolved).toHaveLength(1);
  });

  it('an inactive graph row does not resolve — host remove soft-deletes', () => {
    const db = graphDb();
    db.prepare("INSERT INTO sites VALUES ('row9','mysite','wpe',0,'myinstall','my.wpengine.com','8.1.27')").run();
    const out = buildFleetScoringInputs([{ siteId: 'myinstall' }], {}, db);
    expect(out.unresolved).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// calculateAllScores honours the per-site routing
// ---------------------------------------------------------------------------
import { HealthScoreCalculator } from '../../../src/main/health/HealthScoreCalculator';

describe('calculateAllScores × perSite', () => {
  function calcWithSpy() {
    const calls: Array<{ siteId: string; factors: unknown }> = [];
    const calc = new HealthScoreCalculator({} as never);
    (calc as any).calculateScore = async (siteId: string, _info: unknown, factors: unknown) => {
      calls.push({ siteId, factors });
      return { overall: 77 };
    };
    return { calc, calls };
  }

  it('routes factors and dataSiteId per entry; results stay keyed by the caller\'s ids', async () => {
    const { calc, calls } = calcWithSpy();
    const scores = await calc.calculateAllScores(
      ['loc1', 'myinstall'],
      { loc1: {}, myinstall: {} },
      { myinstall: { factors: ['security', 'performance'], dataSiteId: 'row9' } },
    );
    expect(scores).toEqual({ loc1: 77, myinstall: 77 });
    expect(calls).toEqual(
      expect.arrayContaining([
        { siteId: 'loc1', factors: undefined },       // local: the all-five default
        { siteId: 'row9', factors: ['security', 'performance'] }, // remote: row-id data, remote factors
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// The three loops consume the ONE derivation (source pin)
// ---------------------------------------------------------------------------
import * as fs from 'fs';
import * as path from 'path';

describe('the trio consumes the shared derivation', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../../', p), 'utf8');

  it.each([
    'src/main/graphql/resolvers.ts',
    'src/main/mcp/modules/fleet-intelligence/fleet-health-summary.ts',
    'src/main/ipc-handlers.ts',
  ])('%s imports buildFleetScoringInputs and keeps no fabricated 8.0 in a scoring loop', (file) => {
    const src = read(file);
    expect(src).toContain('buildFleetScoringInputs');
    // Any surviving `|| '8.0'` default must be a documented LOCAL-path
    // exception (Local's store supplies a real version there — the blessed
    // case in CLAUDE.md). An undocumented one is the item-5 fabrication
    // returning. PHP EOL *lists* legitimately contain '8.0'; only the
    // defaulting form is checked.
    // The code form only — prose ABOUT the default (comments quoting
    // `|| '8.0'`) is not the default.
    const marker = "phpVersion || '8.0'";
    for (let i = src.indexOf(marker); i !== -1; i = src.indexOf(marker, i + 1)) {
      const before = src.slice(Math.max(0, i - 600), i);
      expect(before).toMatch(/LOCAL path|LOCAL-only path/i);
    }
  });
});
