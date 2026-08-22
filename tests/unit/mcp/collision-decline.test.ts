/**
 * WP-58 — the collision decline. THE MECHANISM, not another honouring call site.
 *
 * `CLAUDE.md`'s "Names collide across sources" rule has been prose since before
 * the defect it describes was written: *"Any name-keyed query must constrain by
 * `source`, and a bare-name lookup that cannot disambiguate must decline rather
 * than pick… An unordered `... AND name=? LIMIT 1` is not a lookup, it is a coin
 * toss."* Three call sites honoured it. Nothing would ever have FAILED if a new
 * one forgot — which is how `resolveAnySite`, written to be the correct shared
 * path, forgot in its first ten lines while its own docblock credited it with
 * the logic it skipped.
 *
 * This file is the thing that fails.
 *
 * ── Vacuous-guard shape #15, named up front because it is the live risk ──────
 * The collision set is DATA-DEPENDENT: on a clean machine, or in CI, no name
 * exists in both Local's store and the graph, so a test that drives "whatever
 * collides here" drives nothing and passes perfectly. Three things stop that:
 *
 *   1. A FLOOR. The five names `CLAUDE.md:471` records are always driven, live
 *      sources or not, so the driven set can never be empty.
 *   2. The floor is ANCHORED OUTSIDE ITSELF — parsed out of `CLAUDE.md`, so the
 *      constant here and the record cannot drift apart in silence (WP-54: an
 *      agreement pin needs an anchor outside both derivations).
 *   3. Every name is asserted to be a REAL collision in the fixture — present
 *      in Local's store AND in the graph — before anything is asserted about
 *      declining, and a control proves the same name resolves fine when the
 *      graph does NOT hold it. A decline that would have happened anyway is
 *      not a decline.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveLocalSite,
  resolveLocalSiteResult,
  resolveAnySite,
} from '../../../src/main/mcp/site-resolver';
import type { SiteDataAccessor, LocalSiteInfo } from '../../../src/main/mcp/types';
import { getSiteStructureHandler } from '../../../src/main/mcp/modules/site-context/get-site-structure';
import { compareSitesHandler } from '../../../src/main/mcp/modules/fleet/compare-sites';
import { resolveTargetArgs } from '../../../src/main/transport/resolveTargetArgs';

// ---------------------------------------------------------------------------
// The floor, and the anchor that keeps it honest
// ---------------------------------------------------------------------------

/**
 * The names `CLAUDE.md`'s "Names collide across sources" paragraph records.
 * Pinned here so the driven set is never empty; checked against `CLAUDE.md`
 * itself below so this array cannot quietly stop being what the record says.
 *
 * A FLOOR, NOT THE SET. It stood at five for months while the fleet had six.
 * `thelocalshed` was added 2026-08-21 because the LIVE MEASUREMENT below found
 * it and the prose had not — which is the argument for measuring a
 * data-dependent population rather than listing it. The two are asserted
 * against each other, neither derived from the other, so amending one fails
 * until the other follows: prose and constant move in one commit or neither.
 */
const PINNED_FLOOR = ['goldenecomm', 'jpp0413p', 'myloop', 'psbtest2', 'testjppstg', 'thelocalshed'];

const CLAUDE_MD = path.resolve(__dirname, '../../../CLAUDE.md');

/** Pull the colliding names out of the record's own sentence. */
function collisionNamesFromRecord(): string[] {
  const text = fs.readFileSync(CLAUDE_MD, 'utf8');
  const start = text.indexOf('**Names collide across sources.**');
  if (start === -1) throw new Error('CLAUDE.md no longer contains "Names collide across sources."');
  const end = text.indexOf('each exist as both', start);
  if (end === -1) throw new Error('CLAUDE.md\'s collision sentence no longer reads "each exist as both"');
  const sentence = text.slice(start + '**Names collide across sources.**'.length, end);
  return (sentence.match(/`([^`]+)`/g) ?? []).map((t) => t.slice(1, -1)).sort();
}

// ---------------------------------------------------------------------------
// Live discovery — the owner's real fleet, when this runs on it
// ---------------------------------------------------------------------------

/**
 * Every name present in BOTH Local's own store and the graph's active
 * `wpe`/`external` rows — the two populations CLAUDE.md's "Fleet counts"
 * section says are each authoritative for different things.
 *
 * `available: false` means this machine has no fleet to read (CI, a fresh
 * clone), which is not a failure — it is why the floor exists.
 */
function discoverLiveCollisions(): { names: string[]; available: boolean } {
  const support = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const sitesJson = path.join(support, 'sites.json');
  const graphDb = path.join(support, 'nexus-ai', 'graph.db');
  if (!fs.existsSync(sitesJson) || !fs.existsSync(graphDb)) return { names: [], available: false };

  try {
    const raw = JSON.parse(fs.readFileSync(sitesJson, 'utf8')) as Record<string, { name?: string }>;
    const local = new Set(
      Object.values(raw)
        .map((s) => String(s?.name ?? '').toLowerCase())
        .filter(Boolean),
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(graphDb, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          "SELECT DISTINCT name FROM sites WHERE source IN ('wpe','external') AND is_active = 1",
        )
        .all() as Array<{ name: string }>;
      const names = rows
        .map((r) => String(r.name ?? '').toLowerCase())
        .filter((n) => n && local.has(n))
        .sort();
      return { names, available: true };
    } finally {
      db.close();
    }
  } catch {
    // A fleet we cannot read is a fleet we do not claim to have measured.
    return { names: [], available: false };
  }
}

const live = discoverLiveCollisions();

/**
 * The set every resolver is driven over: the UNION of the floor and whatever
 * discovery found — never the discovery alone.
 *
 * A named function rather than an inline expression, because the property that
 * matters ("discovery ADDS to the floor, it never replaces it") is only
 * checkable if there is something to call with an empty discovery. On a
 * machine WITH a fleet — the only machine this file is usually run on — an
 * inline `live.names` would pass every assertion below, so the mistake it
 * guards against is invisible exactly where it would be made.
 */
export function drivenCollisionSet(floor: readonly string[], discovered: readonly string[]): string[] {
  return Array.from(new Set([...floor, ...discovered])).sort();
}

const DRIVEN: string[] = drivenCollisionSet(PINNED_FLOOR, live.names);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function localStore(sites: LocalSiteInfo[]): SiteDataAccessor {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return {
    getSite: (id: string) => byId.get(id) ?? null,
    getSites: () => Object.fromEntries(byId),
  };
}

type GraphRow = { id: string; name: string; source: string; account_id?: string };

/**
 * A graph stand-in that honours the two query shapes `site-resolver.ts` builds:
 * the source-pinned `account_id`/`name` external lookup, and the
 * `source IN ('wpe','external')` bare-name lookup. Rows are filtered the way
 * SQLite would filter them, so a fixture cannot answer a question the real
 * query would not have asked.
 */
function graph(rows: GraphRow[]) {
  const all = (sql: string, params: string[]) => {
    if (sql.includes('account_id=?')) {
      const [alias, site] = params;
      return rows.filter(
        (r) =>
          r.source === 'external' &&
          (r.account_id ?? r.name) === alias &&
          (site === undefined || r.name === site),
      );
    }
    const [name] = params;
    const pinned = sql.match(/source\s*=\s*'(\w+)'/);
    // `LOWER(name) = ?` is the collision probe's query and it passes a
    // lowercased parameter; `name = ?` is the resolvers' and passes it as
    // typed. Model both, or a case-difference fixture silently answers the
    // wrong question.
    const ci = sql.includes('LOWER(name)');
    return rows.filter(
      (r) =>
        (ci ? r.name.toLowerCase() === name : r.name === name) &&
        (!pinned || r.source === pinned[1]),
    );
  };
  return {
    getDb: () => ({
      prepare: (sql: string) => ({
        all: (...params: string[]) => all(sql, params),
        // `resolveTargetArgs` reaches for `.get()`. A fixture missing it does
        // not fail — the call throws into that function's own catch and the
        // WPE install goes silently unfound, which reads as a code defect.
        get: (...params: string[]) => all(sql, params)[0],
      }),
    }),
  } as any;
}

function localSiteNamed(name: string): LocalSiteInfo {
  return { id: `local-${name}`, name, path: `/Local Sites/${name}`, domain: `${name}.local` };
}

// ---------------------------------------------------------------------------
// The set itself
// ---------------------------------------------------------------------------

describe('WP-58 · the collision set the resolvers are driven over', () => {
  it('the floor is exactly the set CLAUDE.md records', () => {
    // The anchor. Edit the record's list without editing this file (or the
    // reverse) and this fails — which is the only thing keeping a hand-written
    // constant from being a claim nobody checks.
    expect(collisionNamesFromRecord()).toEqual([...PINNED_FLOOR].sort());
  });

  it('with no fleet to read, the driven set is STILL the floor', () => {
    // Shape #15's own guard, driven. This is the only assertion in the file
    // that fails if someone "simplifies" the union to the discovery — and it
    // fails here on a machine where every other assertion would still pass.
    expect(drivenCollisionSet(PINNED_FLOOR, [])).toEqual([...PINNED_FLOOR].sort());
  });

  it('discovery adds to the floor, it never replaces it', () => {
    const set = drivenCollisionSet(PINNED_FLOOR, ['some-new-collision']);
    expect(set).toContain('some-new-collision');
    for (const name of PINNED_FLOOR) expect(set).toContain(name);
  });

  it('the driven set is never smaller than the floor, whatever discovery found', () => {
    expect(DRIVEN.length).toBeGreaterThanOrEqual(PINNED_FLOOR.length);
    for (const name of PINNED_FLOOR) expect(DRIVEN).toContain(name);
  });

  it('every collision discovered on this machine is driven', () => {
    // Vacuous when there is no fleet to read, and says so rather than
    // pretending it measured something.
    for (const name of live.names) expect(DRIVEN).toContain(name);
    if (!live.available) {
      expect(live.names).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Every resolver, every name
// ---------------------------------------------------------------------------

describe.each(DRIVEN)('WP-58 · "%s" exists in both sources', (name) => {
  const siteData = localStore([localSiteNamed(name)]);
  const withGraph = graph([{ id: `wpe-${name}`, name, source: 'wpe' }]);
  const emptyGraph = graph([]);

  it('the fixture really is a collision — present in Local AND in the graph', () => {
    // Asserted BEFORE anything about declining. A decline over a name that is
    // not in both stores is shape #15 wearing a green tick.
    const localNames = Object.values(siteData.getSites()).map((s) => s.name);
    expect(localNames).toContain(name);

    const graphRows = withGraph
      .getDb()
      .prepare("SELECT id, name, source, account_id FROM sites WHERE source IN ('wpe','external') AND is_active = 1 AND name = ?")
      .all(name);
    expect(graphRows).toHaveLength(1);
  });

  it('CONTROL — the same name resolves locally when the graph does NOT hold it', () => {
    // Without this, a decline caused by a typo in the fixture reads exactly
    // like a decline caused by the collision.
    expect(resolveLocalSite(name, siteData, emptyGraph)?.id).toBe(`local-${name}`);
    expect(resolveAnySite(name, siteData, emptyGraph)).toEqual({
      kind: 'ok',
      id: `local-${name}`,
      name,
      source: 'local',
    });
  });

  it('resolveLocalSite refuses it', () => {
    expect(resolveLocalSite(name, siteData, withGraph)).toBeNull();
  });

  it('resolveLocalSite states a reason, and the reason names both sides', () => {
    const result = resolveLocalSiteResult(name, siteData, withGraph);
    expect(result.kind).toBe('collision');
    if (result.kind !== 'collision') throw new Error('unreachable');
    expect(result.matches).toEqual(expect.arrayContaining([`${name}@local`, `wpe:<account>/${name}`]));
    expect(result.message).toContain(name);
    expect(result.message).toContain(`${name}@local`);
    // The Local site it refused is carried, so a caller with a better message
    // of its own (resolveTargetArgs has one) does not have to look it up again.
    expect(result.site.id).toBe(`local-${name}`);
  });

  it('resolveAnySite declines with the disambiguated forms', () => {
    const result = resolveAnySite(name, siteData, withGraph);
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') throw new Error('unreachable');
    expect(result.matches).toEqual(expect.arrayContaining([`${name}@local`, `wpe:<account>/${name}`]));
  });

  it('the escape hatch works — @local pins the copy, wpe: pins the install', () => {
    // Declining is only cheap because the caller can say which one it meant.
    expect(resolveAnySite(`${name}@local`, siteData, withGraph)).toEqual({
      kind: 'ok',
      id: `local-${name}`,
      name,
      source: 'local',
    });
    expect(resolveLocalSite(`${name}@local`, siteData, withGraph)?.id).toBe(`local-${name}`);
    expect(resolveAnySite(`wpe:acct/${name}@production`, siteData, withGraph)).toEqual({
      kind: 'ok',
      id: `wpe-${name}`,
      name,
      source: 'wpe',
    });
  });

  it('an external row collides the same way a WPE install does', () => {
    const external = graph([
      { id: `ssh:hostinger/${name}`, name, source: 'external', account_id: 'hostinger' },
    ]);
    expect(resolveLocalSite(name, siteData, external)).toBeNull();
    const result = resolveAnySite(name, siteData, external);
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') throw new Error('unreachable');
    expect(result.matches).toEqual(
      expect.arrayContaining([`${name}@local`, `ssh:hostinger/${name}`]),
    );
  });
});

// ---------------------------------------------------------------------------
// What the decline must NOT do
// ---------------------------------------------------------------------------

describe('WP-58 · the decline is scoped to the name, not to everything', () => {
  const name = 'myloop';
  const siteData = localStore([localSiteNamed(name)]);
  const withGraph = graph([{ id: `wpe-${name}`, name, source: 'wpe' }]);

  it('a Local site ID still resolves, collision or not — an id is not a name', () => {
    // 115 call sites pass a Local site id. An id cannot name a WPE install, so
    // declining on one would be refusing an unambiguous question.
    expect(resolveLocalSite(`local-${name}`, siteData, withGraph)?.name).toBe(name);
    expect(resolveAnySite(`local-${name}`, siteData, withGraph)).toEqual({
      kind: 'ok',
      id: `local-${name}`,
      name,
      source: 'local',
    });
  });

  it('an ID or DOMAIN match survives even when the graph holds a row of that EXACT name', () => {
    // The assertion above is satisfied by a fixture where the graph simply has
    // no such row — which is every fixture in this file, and is why the
    // battery's "decline on everything" mutation SURVIVED its first run. The
    // scope rule is only exercised where the collision is actually available
    // to be declined and is deliberately not, so this fixture builds that.
    //
    // The residual it also pins, honestly: a Local site whose DOMAIN equals a
    // graph row's NAME is NOT declined. The ruling scopes the decline to name
    // matches, and this test says so rather than leaving it to be discovered.
    const data = localStore([
      { id: 'myloop', name: 'someothername', path: '/Local Sites/x', domain: 'myloop.example.com' },
    ]);
    const g = graph([
      { id: 'wpe-1', name: 'myloop', source: 'wpe' },
      { id: 'ssh:h/myloop.example.com', name: 'myloop.example.com', source: 'external', account_id: 'h' },
    ]);

    // The fixture really does hold both rows — asserted before the claim.
    expect(g.getDb().prepare("... LOWER(name) = ?").all('myloop')).toHaveLength(1);
    expect(g.getDb().prepare("... LOWER(name) = ?").all('myloop.example.com')).toHaveLength(1);

    expect(resolveLocalSite('myloop', data, g)?.name).toBe('someothername');
    expect(resolveLocalSite('myloop.example.com', data, g)?.name).toBe('someothername');
    expect(resolveLocalSiteResult('myloop', data, g).kind).toBe('ok');
    expect(resolveLocalSiteResult('myloop.example.com', data, g).kind).toBe('ok');
  });

  it('a non-colliding local name is unaffected', () => {
    const data = localStore([localSiteNamed('quiet-site'), localSiteNamed(name)]);
    expect(resolveLocalSite('quiet-site', data, withGraph)?.id).toBe('local-quiet-site');
    expect(resolveLocalSiteResult('quiet-site', data, withGraph).kind).toBe('ok');
  });

  it('a graph-only name still resolves through resolveAnySite', () => {
    expect(resolveAnySite(name, localStore([]), withGraph)).toEqual({
      kind: 'ok',
      id: `wpe-${name}`,
      name,
      source: 'wpe',
    });
  });

  it('an absent graph is not a collision', () => {
    expect(resolveLocalSite(name, siteData, undefined)?.id).toBe(`local-${name}`);
    expect(resolveLocalSiteResult(name, siteData, undefined).kind).toBe('ok');
  });

  it('a graph that throws is not a collision either', () => {
    const broken = {
      getDb: () => ({
        prepare: () => {
          throw new Error('database is locked');
        },
      }),
    } as any;
    expect(resolveLocalSite(name, siteData, broken)?.id).toBe(`local-${name}`);
  });
});

// ---------------------------------------------------------------------------
// The coin toss one casing away
// ---------------------------------------------------------------------------

describe('WP-58 · the collision probe is case-generous, because the collision is', () => {
  // Local site names are whatever a human typed; WPE install names are
  // lowercase by WP Engine's own rules. `MyLoop` beside `myloop` is therefore
  // the ORDINARY shape of this collision, not an exotic one — and an exact
  // probe misses every instance of it while looking like it works.
  const siteData = localStore([
    { id: 'local-MyLoop', name: 'MyLoop', path: '/Local Sites/MyLoop', domain: 'myloop.local' },
  ]);
  const withGraph = graph([{ id: 'wpe-myloop', name: 'myloop', source: 'wpe' }]);

  it('declines when the two spellings differ only in case', () => {
    expect(resolveLocalSite('myloop', siteData, withGraph)).toBeNull();
    expect(resolveLocalSite('MyLoop', siteData, withGraph)).toBeNull();
    expect(resolveAnySite('MyLoop', siteData, withGraph).kind).toBe('ambiguous');
  });

  it('the disambiguated form echoes the STORE\'S casing, not the caller\'s', () => {
    // A form the caller cannot paste back in is not a disambiguation. The
    // Local site is `MyLoop`, so the pin has to say `MyLoop@local`.
    const result = resolveLocalSiteResult('myloop', siteData, withGraph);
    expect(result.kind).toBe('collision');
    if (result.kind !== 'collision') throw new Error('unreachable');
    expect(result.matches).toContain('MyLoop@local');
    expect(resolveLocalSite('MyLoop@local', siteData, withGraph)?.id).toBe('local-MyLoop');
  });
});

// ---------------------------------------------------------------------------
// The callers — a ruling is only true where the call is actually made (WP-56)
// ---------------------------------------------------------------------------

describe('WP-58 · the tools that answer about a site', () => {
  const name = 'myloop';
  // `quiet-site` is the unambiguous partner: compare_sites resolves side A
  // before it looks at side B, so a colliding name on side B is only reached
  // when side A resolves cleanly.
  const siteData = localStore([localSiteNamed(name), localSiteNamed('quiet-site')]);
  const graphService = graph([{ id: `wpe-${name}`, name, source: 'wpe' }]);
  const services = {
    siteData,
    graphService,
    twinService: { get: () => null },
    indexRegistry: { get: () => null },
    fileScanner: { scan: async () => { throw new Error('should not be reached'); } },
  } as any;

  it('get_site_structure states the collision instead of saying "not found"', async () => {
    // "Not found" for a name that exists TWICE is the narrowing-in-silence the
    // packet's one-line ruling forbids: the caller concludes the site is
    // absent when the truth is that this tool is Local-only and the caller has
    // not said which one it means.
    const result: any = await getSiteStructureHandler.execute({ site: name }, services);
    expect(result.isError).toBe(true);
    const text = result.content.map((c: any) => c.text).join('\n');
    expect(text).not.toContain('not found');
    expect(text).toContain('Ambiguous site "myloop"');
    expect(text).toContain('myloop@local');
    expect(text).toContain('wpe:<account>/myloop');
  });

  it('compare_sites declines the same name on either side', async () => {
    const a: any = await compareSitesHandler.execute({ site_a: name, site_b: 'quiet-site' }, services);
    expect(a.isError).toBe(true);
    expect(a.content.map((c: any) => c.text).join('\n')).toContain('matches 2 sites across sources');

    const b: any = await compareSitesHandler.execute({ site_a: 'quiet-site', site_b: name }, services);
    expect(b.isError).toBe(true);
    expect(b.content.map((c: any) => c.text).join('\n')).toContain('matches 2 sites across sources');
  });

  it('resolveTargetArgs refuses a Local/EXTERNAL collision, not only a Local/WPE one', () => {
    // The pre-fix gate was `localSite && wpeInstallName` — it saw a WP Engine
    // install and was blind to an external SSH host, so `nexus wp …` against a
    // name held by a Local site and a registered host ran on the copy without
    // a word. Same hole, one source over.
    const external = graph([
      { id: `ssh:hostinger/${name}`, name, source: 'external', account_id: 'hostinger' },
    ]);
    expect(() =>
      resolveTargetArgs(name, { siteData, graphService: external } as any),
    ).toThrow(/Ambiguous site "myloop"/);
  });

  it('resolveTargetArgs still refuses a Local/WPE collision with the install named', () => {
    expect(() => resolveTargetArgs(name, { siteData, graphService } as any)).toThrow(
      /matches both a Local site and the WP Engine install "myloop"/,
    );
  });

  it('resolveTargetArgs accepts the @local pin it tells the user to use', () => {
    expect(resolveTargetArgs(`${name}@local`, { siteData, graphService } as any)).toEqual({
      site: name,
    });
  });
});

// ---------------------------------------------------------------------------
// Item 3 — one function, one case policy
// ---------------------------------------------------------------------------

describe('WP-58 · the duplicate resolveSite is gone', () => {
  it('graphql/resolver-utils no longer exports a second site resolver', () => {
    // Two functions of the same name, in one repo, disagreeing about
    // case-sensitivity, is not a detail — it is the same defect one layer up.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const utils = require('../../../src/main/graphql/resolver-utils');
    expect(utils.resolveSite).toBeUndefined();
  });

  it('mcp/site-resolver no longer exports the old name', () => {
    // A rename that leaves an alias behind is a rename nothing enforces: the
    // required third parameter is only a mechanism if the two-argument form
    // stops existing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const resolver = require('../../../src/main/mcp/site-resolver');
    expect(resolver.resolveSite).toBeUndefined();
    expect(typeof resolver.resolveLocalSite).toBe('function');
  });
});
