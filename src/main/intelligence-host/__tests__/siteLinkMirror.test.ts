/**
 * WP-07 · site_links → entity service one-way mirror.
 *
 * Governing decision: docs/intelligence/reconciliation-entity-identity.md.
 * Track 1 owns runtime linking; the mirror is a CONSUMER. The properties
 * pinned here are the packet's acceptance criteria:
 *  - ensure() adopts the producers' provisional ids (identical by construction);
 *  - env entities are aliased under BOTH graph.site_row AND wpe.install_id
 *    (the "subtle trap": FleetAssembler addresses installs by
 *    remote_install_id ?? id, producers derive from the graph row id);
 *  - Site entities alias under wpe.site_id;
 *  - link_source maps user→user_link 1.0, hostConnection→host_connection 0.95,
 *    inferred→name_heuristic 0.5, with verified_at as the freshness carrier;
 *  - the sweep is idempotent (second run: zero new rows);
 *  - everything is non-fatal.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { runSiteLinkMirror } from '../siteLinkMirror';
import {
  environmentEntityId,
  provisionalEnvironmentId,
  provisionalSiteId,
  siteEntityId,
} from '../provisionalEntity';
import type { SiteLink } from '../../fleet/types';

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-mirror-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
}

/** Graph rows shaped like the live sites table, WPE columns only. */
function fakeGraphDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, source TEXT,
    remote_install_id TEXT, wpe_site_id TEXT, is_active INTEGER)`);
  // The trap case: graph row id differs from the CAPI install id.
  db.prepare(`INSERT INTO sites VALUES ('row-prod', 'acmeprod', 'wpe', 'inst-uuid-1', 'site-uuid-A', 1)`).run();
  // Same logical site, second environment.
  db.prepare(`INSERT INTO sites VALUES ('row-stg', 'acmestg', 'wpe', 'inst-uuid-2', 'site-uuid-A', 1)`).run();
  // No wpe_site_id — groups by install alone.
  db.prepare(`INSERT INTO sites VALUES ('row-solo', 'soloinstall', 'wpe', 'inst-uuid-3', NULL, 1)`).run();
  // Soft-deleted: must not enter the entity graph.
  db.prepare(`INSERT INTO sites VALUES ('row-gone', 'removed', 'wpe', 'inst-uuid-4', NULL, 0)`).run();
  // Local rows are not the mirror's business.
  db.prepare(`INSERT INTO sites VALUES ('local-1', 'my-local', 'local', NULL, NULL, 1)`).run();
  return db;
}

const VERIFIED_MS = Date.parse('2026-08-01T12:00:00.000Z');

const LINKS: SiteLink[] = [
  // user link — authoritative
  { localSiteId: 'local-1', wpeInstallId: 'inst-uuid-1', wpeInstallName: 'acmeprod', linkSource: 'user', verifiedAt: VERIFIED_MS },
  // platform config
  { localSiteId: 'local-2', wpeInstallId: 'inst-uuid-2', wpeInstallName: 'acmestg', linkSource: 'hostConnection', verifiedAt: VERIFIED_MS },
  // inference
  { localSiteId: 'local-3', wpeInstallId: 'inst-uuid-3', wpeInstallName: 'soloinstall', linkSource: 'inferred', verifiedAt: null },
];

function counts(core: IntelligenceCore) {
  const db = core.ledger.raw();
  return {
    entities: (db.prepare('SELECT COUNT(*) c FROM entities').get() as { c: number }).c,
    aliases: (db.prepare('SELECT COUNT(*) c FROM entity_aliases').get() as { c: number }).c,
    links: (db.prepare('SELECT COUNT(*) c FROM entity_links').get() as { c: number }).c,
  };
}

describe('runSiteLinkMirror', () => {
  test('ensure() and the provisional helpers mint identical ids by construction', () => {
    const core = makeCore();
    expect(core.entities!.ensure('env', 'local.site_id', 'abc123')).toBe(provisionalEnvironmentId('abc123'));
    expect(core.entities!.ensure('site', 'local.site_id.logical', 'abc123')).toBe(provisionalSiteId('abc123'));
    core.close();
  });

  test('producer helpers: ensure() when the service is up, identical pure derivation when it is not', () => {
    const core = makeCore();
    // With the entity service: same ids AND the entity is registered.
    expect(environmentEntityId(core.entities, 'abc123')).toBe(provisionalEnvironmentId('abc123'));
    expect(siteEntityId(core.entities, 'abc123')).toBe(provisionalSiteId('abc123'));
    expect(core.entities!.resolve('abc123', 'local.site_id')).toHaveLength(1);

    // Without it (init failed): the pure fallback, still the same ids.
    expect(environmentEntityId(undefined, 'abc123')).toBe(provisionalEnvironmentId('abc123'));
    expect(siteEntityId(undefined, 'abc123')).toBe(provisionalSiteId('abc123'));

    // A throwing service degrades to the fallback instead of breaking a producer.
    const broken = { ensure: () => { throw new Error('ledger closed'); } };
    expect(environmentEntityId(broken as never, 'abc123')).toBe(provisionalEnvironmentId('abc123'));
    expect(siteEntityId(broken as never, 'abc123')).toBe(provisionalSiteId('abc123'));
    core.close();
  });

  test('mirrors site_links and WPE identity into aliases/links; idempotent on re-run', () => {
    const core = makeCore();
    const graphDb = fakeGraphDb();
    const logger = { info: () => {}, error: (...a: unknown[]) => console.error(a) };

    const result = runSiteLinkMirror(core, { getLinks: () => LINKS, getDb: () => graphDb, logger });
    expect(result).toBeDefined();
    const entities = core.entities!;

    // ── Both-aliases join: graph.site_row AND wpe.install_id reach ONE entity ──
    const viaRow = entities.resolve('row-prod', 'graph.site_row');
    const viaInstall = entities.resolve('inst-uuid-1', 'wpe.install_id');
    expect(viaRow).toHaveLength(1);
    expect(viaInstall).toHaveLength(1);
    expect(viaRow[0].entityId).toBe(viaInstall[0].entityId);
    // …and that one entity is the producers' provisional env id (adoption).
    expect(viaRow[0].entityId).toBe(provisionalEnvironmentId('row-prod'));

    // Soft-deleted rows never enter the entity graph.
    expect(entities.resolve('row-gone', 'graph.site_row')).toHaveLength(0);
    expect(entities.resolve('inst-uuid-4', 'wpe.install_id')).toHaveLength(0);

    // ── Site entities alias under wpe.site_id and group installs ──
    const [site] = entities.resolve('site-uuid-A', 'wpe.site_id');
    expect(site).toBeDefined();
    expect(site.type).toBe('site');
    const envs = entities.environmentsOf(site.entityId);
    const envIds = envs.map((e) => e.entityId);
    expect(envIds).toContain(provisionalEnvironmentId('row-prod'));
    expect(envIds).toContain(provisionalEnvironmentId('row-stg'));

    // ── Mapping table: link_source → established_by/confidence ──
    // The user-linked local sandbox is an environment of the same logical site,
    // and it OUTRANKS the CAPI-established environments in the ordering.
    const localEnv = provisionalEnvironmentId('local-1');
    expect(envIds).toContain(localEnv);
    expect(envs[0]).toEqual({ entityId: localEnv, confidence: 1.0, establishedBy: 'user_link' });
    const capiEnv = envs.find((e) => e.entityId === provisionalEnvironmentId('row-prod'));
    expect(capiEnv).toEqual(expect.objectContaining({ confidence: 0.95, establishedBy: 'host_connection' }));

    // hostConnection-sourced sandbox: host_connection 0.95.
    const stgSandbox = envs.find((e) => e.entityId === provisionalEnvironmentId('local-2'));
    expect(stgSandbox).toEqual(expect.objectContaining({ confidence: 0.95, establishedBy: 'host_connection' }));

    // inferred-sourced sandbox on the ungrouped install: name_heuristic 0.5,
    // attached under the install's own logical-site entity (no wpe_site_id).
    const soloSite = provisionalSiteId('row-solo');
    const soloEnvs = entities.environmentsOf(soloSite);
    expect(soloEnvs.find((e) => e.entityId === provisionalEnvironmentId('local-3'))).toEqual(
      expect.objectContaining({ confidence: 0.5, establishedBy: 'name_heuristic' }),
    );

    // ── verified_at is the freshness carrier ──
    const ledgerDb = core.ledger.raw();
    const userEdge = ledgerDb
      .prepare(`SELECT created_at FROM entity_links WHERE to_entity = ? AND kind = 'has_environment'`)
      .get(localEnv) as { created_at: string };
    expect(userEdge.created_at).toBe(new Date(VERIFIED_MS).toISOString());

    // ── Idempotency: a second sweep adds zero rows ──
    const before = counts(core);
    runSiteLinkMirror(core, { getLinks: () => LINKS, getDb: () => graphDb, logger });
    expect(counts(core)).toEqual(before);

    core.close();
    graphDb.close();
  });

  test('non-fatal: missing core, missing entity service, and a throwing graph db never throw', () => {
    const logger = { info: () => {}, error: () => {} };
    expect(runSiteLinkMirror(undefined, { getLinks: () => LINKS, getDb: () => undefined, logger })).toBeUndefined();

    const core = makeCore();
    const noEntities = { ...core, entities: undefined };
    expect(runSiteLinkMirror(noEntities, { getLinks: () => LINKS, getDb: () => undefined, logger })).toBeUndefined();

    // A graph db that throws mid-query degrades to mirroring links without
    // WPE row context rather than failing the sweep.
    const throwingDb = { prepare: () => { throw new Error('db locked'); } };
    const result = runSiteLinkMirror(core, {
      getLinks: () => LINKS,
      getDb: () => throwingDb as never,
      logger,
    });
    expect(result).toBeDefined();
    // The install id still resolves — minted from wpe.install_id directly.
    expect(core.entities!.resolve('inst-uuid-1', 'wpe.install_id')).toHaveLength(1);

    // And a throwing link source is swallowed too.
    expect(
      runSiteLinkMirror(core, { getLinks: () => { throw new Error('store gone'); }, getDb: () => undefined, logger }),
    ).toBeUndefined();
    core.close();
  });
});
