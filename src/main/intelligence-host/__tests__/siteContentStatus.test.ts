/**
 * WP-22b · the one read the chip needs, and everything it must refuse to say.
 *
 * `siteStatus()` already knows how old a copy's content is; nothing renderer-side
 * could reach it. This module is the read behind the single IPC channel that closes
 * that gap, so what it is pinned on is mostly what it DOESN'T return:
 *
 *   - a dark core yields `null`, not a state — "not recording" is a fact about
 *     Nexus AI, and dressing it as `unlinked` would put a fact about the copy in
 *     front of a user who is about to trust their content's age;
 *   - the three absences `siteStatus` distinguishes stay three (`no-sync`,
 *     `ambiguous`, `unlinked`) — each has a different remedy, and the boundary is
 *     exactly where a "simplifying" collapse would be invisible;
 *   - a site id Local's own store does not know yields `null` rather than a status
 *     computed for an id nobody can name.
 *
 * The chip renders only `pulled`, but the payload keeps the distinctions anyway:
 * a boundary that flattens them cannot be un-flattened by a later surface.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { provisionalEnvironmentId, provisionalSiteId } from '../provisionalEntity';
import { setIntelligenceCore } from '../coreRegistry';
import { readSiteContentStatus } from '../siteContentStatus';

const LOCAL_SITE = 'local-alpine';
const COPY = provisionalEnvironmentId(LOCAL_SITE);
const SITE = provisionalSiteId(LOCAL_SITE);
const PROD = provisionalEnvironmentId('wpe-row-alpine-prod');
const DEV = provisionalEnvironmentId('wpe-row-alpine-dev');
const DAY = 86_400_000;

let core: IntelligenceCore;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp22b-content-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Local's own store, in the shape `siteData.getSites()` returns (keyed by id). */
function deps(over: Record<string, unknown> = {}) {
  return {
    siteData: {
      getSites: () => ({ [LOCAL_SITE]: { id: LOCAL_SITE, name: 'Alpine Outfitters' } }),
    },
    // The graph rows are what let `describeEnvironmentsFor` name the live site.
    // Without them the source falls back to a phrase, so this fixture is also the
    // pin that the handler passes the describer through at all.
    nexusServices: {
      graphService: {
        listSites: async () => [
          { id: 'wpe-row-alpine-prod', name: 'alpine-prod', source: 'wpe', environment: 'production' },
          { id: 'wpe-row-alpine-dev', name: 'alpine-dev', source: 'wpe', environment: 'development' },
        ],
      },
    },
    ...over,
  };
}

function seedSite(installEntity = PROD): void {
  const e = core.entities!;
  e.ensure('env', 'local.site_id', LOCAL_SITE);
  e.ensure('site', 'local.site_id.logical', LOCAL_SITE);
  e.link(SITE, COPY, 'has_working_copy', 1.0, 'user_link');
  e.link(SITE, COPY, 'has_environment', 1.0, 'user_link');
  e.link(SITE, installEntity, 'has_environment', 0.95, 'host_connection');
}

function seedPull(daysAgo: number, from = PROD): void {
  core.emitter.emit({
    observed_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    topic: 'episodic.sync.pulled',
    schema: 'sync.observed/1',
    entity: { site: SITE, environment: from, working_copy: COPY },
    actor: { id: 'act_seed', kind: 'system' },
    source: { class: 'work', system: 'local:sync', trust: 'observed' },
    payload: { flow: 'full', direction: 'down', includes_db: true },
  });
}

// ---------------------------------------------------------------------------
// This block MUST run first: the core registry has a setter and no unsetter, so
// "nothing is recording" is only reproducible before any test registers a core.
// Same ordering discipline as siteFinderTwins.test.ts's baseline run.
// ---------------------------------------------------------------------------

describe('readSiteContentStatus — before anything is recording', () => {
  test('a dark core costs the chip, and says nothing about the copy', async () => {
    seedSite();
    seedPull(11);
    expect(await readSiteContentStatus(deps(), LOCAL_SITE)).toBeNull();
  });
});

describe('readSiteContentStatus — with the core registered', () => {
  beforeEach(() => {
    setIntelligenceCore(core);
  });

  test('a copy that has pulled carries the source and an age in seconds', async () => {
    seedSite();
    seedPull(11);

    const status = await readSiteContentStatus(deps(), LOCAL_SITE);
    expect(status).toBeTruthy();
    expect(status!.state).toBe('pulled');
    expect(status!.sourceName).toBe('the live site');
    // Time, never an item count (docs finding №3). Bracketed rather than exact:
    // the fixture is stamped against a real clock.
    expect(status!.behindSeconds).toBeGreaterThan(10.9 * 86_400);
    expect(status!.behindSeconds).toBeLessThan(11.1 * 86_400);
  });

  test('a WP Engine development source keeps its disambiguating name', async () => {
    seedSite(DEV);
    seedPull(3, DEV);

    const status = await readSiteContentStatus(deps(), LOCAL_SITE);
    // Finding №6 — the source name crosses the boundary already translated, so no
    // renderer can re-derive a bare "development" from an environment id.
    expect(status!.sourceName).toBe('development (at WP Engine)');
  });

  test('a linked copy with no recorded sync is no-sync, with NO age', async () => {
    seedSite();

    const status = await readSiteContentStatus(deps(), LOCAL_SITE);
    expect(status!.state).toBe('no-sync');
    expect(status!.sourceName).toBe('the live site');
    expect(status!.behindSeconds).toBeUndefined();
  });

  test('more than one candidate place is ambiguous, not unlinked', async () => {
    const e = core.entities!;
    e.ensure('env', 'local.site_id', LOCAL_SITE);
    e.ensure('site', 'local.site_id.logical', LOCAL_SITE);
    e.link(SITE, COPY, 'has_working_copy', 1.0, 'user_link');
    e.link(SITE, PROD, 'has_environment', 0.95, 'host_connection');
    e.link(SITE, DEV, 'has_environment', 0.95, 'host_connection');

    const status = await readSiteContentStatus(deps(), LOCAL_SITE);
    expect(status!.state).toBe('ambiguous');
    expect(status!.sourceName).toBeUndefined();
    expect(status!.behindSeconds).toBeUndefined();
  });

  test('a copy nothing has linked is unlinked, and still an answer', async () => {
    const status = await readSiteContentStatus(deps(), LOCAL_SITE);
    expect(status!.state).toBe('unlinked');
    expect(status!.behindSeconds).toBeUndefined();
  });

  test('an id Local does not know yields null, never a computed status', async () => {
    seedSite();
    seedPull(4);
    expect(await readSiteContentStatus(deps(), 'not-a-local-site')).toBeNull();
  });

  test('a site store that throws costs the chip, not the caller', async () => {
    const broken = deps({
      siteData: { getSites: () => { throw new Error('store unavailable'); } },
    });
    await expect(readSiteContentStatus(broken, LOCAL_SITE)).resolves.toBeNull();
  });

  test('a graph that throws still answers — the describer is optional detail', async () => {
    seedSite();
    seedPull(6);
    const noGraph = deps({
      nexusServices: { graphService: { listSites: async () => { throw new Error('no graph'); } } },
    });

    const status = await readSiteContentStatus(noGraph, LOCAL_SITE);
    // The age survives; only the source's NAME degrades, to the phrase that names
    // the relationship without claiming to know the place.
    expect(status!.state).toBe('pulled');
    expect(status!.sourceName).toBe('the site it follows');
  });

  test('carries nothing beyond the content slice — no site name, no entity id', async () => {
    seedSite();
    seedPull(2);
    const status = await readSiteContentStatus(deps(), LOCAL_SITE);
    expect(Object.keys(status!).sort()).toEqual(['behindSeconds', 'sourceName', 'state']);
  });
});
