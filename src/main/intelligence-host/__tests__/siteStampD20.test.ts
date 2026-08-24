/**
 * D20 — events about remote graph rows adopt the mirror's property Site, or
 * carry no site stamp at all. They never mint one.
 *
 * Before this fix, `graphServiceTap` and `graphBackfill` passed graph row ids
 * (`wpe-…`, `ssh:…`) into `siteEntityId`, minting logical Sites under
 * `local.site_id.logical` with zero environment links — 418 phantoms holding
 * 93.8% of episodic events (sites-ia-readiness §2). The env side is NOT
 * changed: `siteLinkMirror` deliberately adopts the same
 * (`local.site_id`, row-id) env entity, so producer history stays attached.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { initIntelligenceCore, type IntelligenceCore } from '../bootstrap';
import { tapGraphService } from '../graphServiceTap';
import { runGraphBackfill } from '../graphBackfill';
import { siteStampFor } from '../provisionalEntity';

const silent = { info: () => {}, error: () => {} };

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-d20-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
}

/** The mirror's own write shape: env adopted under local.site_id, property Site linked. */
function mirrorProperty(core: IntelligenceCore, rowId: string, wpeSiteId: string): string {
  const env = core.entities!.ensure('env', 'local.site_id', rowId);
  core.entities!.addAlias(env, 'graph.site_row', rowId, 1.0, 'derivation');
  const site = core.entities!.ensure('site', 'wpe.site_id', wpeSiteId);
  core.entities!.link(site, env, 'has_environment', 0.95, 'host_connection');
  return site;
}

function phantomAliases(core: IntelligenceCore, rowId: string): number {
  return (
    core.ledger
      .raw()
      .prepare(
        `SELECT COUNT(*) c FROM entity_aliases WHERE namespace = 'local.site_id.logical' AND value = ?`,
      )
      .get(rowId) as { c: number }
  ).c;
}

function tapped(core: IntelligenceCore) {
  const gs = {
    upsertSite: async (_s: Record<string, unknown>) => {},
    upsertPlugin: async (_p: Record<string, unknown>) => 1,
  };
  tapGraphService(gs, core, { error: () => {} });
  return gs;
}

describe('siteStampFor — the rule itself', () => {
  test('a local id keeps its logical Site; remote ids without a link get nothing', () => {
    const core = makeCore();
    expect(siteStampFor(core.entities, 'Ck3bTFmxY')).toMatch(/^ent_site_/);
    expect(siteStampFor(core.entities, 'wpe-abc-123')).toBeUndefined();
    expect(siteStampFor(core.entities, 'ssh:host/site')).toBeUndefined();
    core.close();
  });

  test('a mirrored row resolves to the mirror property Site — never a fresh mint', () => {
    const core = makeCore();
    const property = mirrorProperty(core, 'wpe-abc-123', 'uuid-1');
    expect(siteStampFor(core.entities, 'wpe-abc-123')).toBe(property);
    expect(phantomAliases(core, 'wpe-abc-123')).toBe(0);
    core.close();
  });

  test('registry down: remote is omitted, local falls back to the derivation', () => {
    expect(siteStampFor(undefined, 'wpe-abc-123')).toBeUndefined();
    expect(siteStampFor(undefined, 'Ck3bTFmxY')).toMatch(/^ent_site_/);
  });
});

describe('graphServiceTap — remote rows', () => {
  test('a mirrored WPE row stamps the property Site; env unchanged', async () => {
    const core = makeCore();
    const property = mirrorProperty(core, 'wpe-abc-123', 'uuid-1');
    const gs = tapped(core);

    await gs.upsertPlugin({ site_id: 'wpe-abc-123', slug: 'woocommerce', version: '9.9.1', is_active: true, updated_at: Date.now() });

    const [e] = core.ledger.query({ topicPrefix: 'state.plugin.' });
    expect(e.entity.site).toBe(property);
    expect(e.entity.environment).toBe(core.entities!.ensure('env', 'local.site_id', 'wpe-abc-123'));
    core.close();
  });

  test('an unmirrored WPE row emits with NO site key, and no phantom is minted', async () => {
    const core = makeCore();
    const gs = tapped(core);

    await gs.upsertSite({ id: 'wpe-lonely-1', name: 'lonely', domain: 'x.wpengine.com', wp_version: '6.8', source: 'wpe', updated_at: Date.now() });

    const [e] = core.ledger.query({ topicPrefix: 'state.site.' });
    expect(e.entity.environment).toBeDefined();
    expect('site' in e.entity).toBe(false);
    expect(phantomAliases(core, 'wpe-lonely-1')).toBe(0);
    core.close();
  });

  test('a local row is untouched: logical Site stamped as before', async () => {
    const core = makeCore();
    const gs = tapped(core);

    await gs.upsertPlugin({ site_id: 'Ck3bTFmxY', slug: 'akismet', version: '5.3', is_active: true, updated_at: Date.now() });

    const [e] = core.ledger.query({ topicPrefix: 'state.plugin.' });
    expect(e.entity.site).toBe(core.entities!.ensure('site', 'local.site_id.logical', 'Ck3bTFmxY'));
    core.close();
  });
});

describe('graphBackfill — remote rows', () => {
  test('backfill omits the site stamp for unmirrored remote rows and keeps it for local', () => {
    const core = makeCore();
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sites (id TEXT, name TEXT, domain TEXT, wp_version TEXT, php_version TEXT, source TEXT, is_active INTEGER, updated_at INTEGER);
      CREATE TABLE plugins (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
    `);
    db.prepare("INSERT INTO sites VALUES ('wpe-b1','remote','r.com','6.8',NULL,'wpe',1,1700000000000)").run();
    db.prepare("INSERT INTO sites VALUES ('LocA1','local','l.local','6.8',NULL,'local',1,1700000000000)").run();

    runGraphBackfill(core, db as never, silent);

    const events = core.ledger.query({ topicPrefix: 'state.site.' });
    const remote = events.find((e) => e.source.system === 'graph-backfill' && !('site' in e.entity));
    const local = events.find((e) => 'site' in e.entity);
    expect(events).toHaveLength(2);
    expect(remote).toBeDefined();
    expect(local?.entity.site).toBe(core.entities!.ensure('site', 'local.site_id.logical', 'LocA1'));
    expect(phantomAliases(core, 'wpe-b1')).toBe(0);
    core.close();
  });
});
