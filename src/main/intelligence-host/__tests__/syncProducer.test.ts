/**
 * WP-14 · The sync producer and the lineage record.
 *
 * The assertions that earn their keep here are the ones about IDENTITY and
 * about FABRICATION:
 *
 *   - ADR-21's id freeze: a sync against a site the layer already knows must
 *     not mint a single new entity. `COUNT(*) FROM entities` is the pin, not a
 *     shape assertion — a shape assertion passes happily while a second,
 *     divergent entity is created beside the first (audit A7's exact defect).
 *   - The pointer MOVES: pulled from production Tuesday, from staging
 *     Thursday, and the copy has ONE content upstream, the newer one.
 *   - A failed pull writes nothing. Local reports success and failure with the
 *     same status string, so this is one banner id away from recording that a
 *     copy holds production's content when it does not.
 *   - Additive parity: `has_environment` is untouched by any of it.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { createSyncObserver, deriveSyncFacts } from '../syncProducer';
import { runSiteLinkMirror } from '../siteLinkMirror';
import { environmentEntityId, siteEntityId } from '../provisionalEntity';
import type { SyncObservation } from '../../operation-tracker';

const LOCAL_SITE = 'local-site-1';
const PROD_ROW = 'graph-row-prod';
const STAGE_ROW = 'graph-row-stage';
const WPE_SITE_UUID = 'wpe-site-uuid';

const silent = { info: () => {}, error: () => {} };

/** graph.db stand-in: the mirror calls .all(), the producer calls .get(). */
function fakeDb() {
  const rows = [
    { id: PROD_ROW, name: 'acmeprod', remote_install_id: 'inst-prod', wpe_site_id: WPE_SITE_UUID, environment: 'production' },
    { id: STAGE_ROW, name: 'acmestg', remote_install_id: 'inst-stage', wpe_site_id: WPE_SITE_UUID, environment: 'staging' },
  ];
  return {
    prepare: (sql: string) => ({
      all: () => rows,
      get: (wpeSiteId: string, environment: string) =>
        sql.includes('wpe_site_id')
          ? rows.find((r) => r.wpe_site_id === wpeSiteId && r.environment === environment)
          : undefined,
    }),
  };
}

function newCore(): { core: IntelligenceCore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-sync-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  return { core, dir };
}

/** The world after Track-1's mirror has run: one Site, two WPE envs, one copy. */
function mirroredCore() {
  const { core, dir } = newCore();
  runSiteLinkMirror(core, {
    getDb: () => fakeDb() as never,
    getLinks: () => [
      {
        localSiteId: LOCAL_SITE,
        wpeInstallId: 'inst-prod',
        wpeInstallName: 'acmeprod',
        linkSource: 'user',
        verifiedAt: Date.parse('2026-08-01T00:00:00.000Z'),
      } as never,
    ],
    logger: silent,
  });
  return { core, dir };
}

function observation(over: Partial<SyncObservation> = {}): SyncObservation {
  return {
    siteId: LOCAL_SITE,
    siteName: 'Acme copy',
    type: 'pull',
    outcome: 'succeeded',
    startedAt: Date.parse('2026-08-17T10:00:00.000Z'),
    finishedAt: Date.parse('2026-08-17T10:05:00.000Z'),
    databasePhaseObserved: true,
    ...over,
  };
}

function observerFor(core: IntelligenceCore, hostConn?: { wpeSiteId?: string; environment?: string }) {
  return createSyncObserver({
    core,
    logger: silent,
    getHostConnection: () => hostConn,
    getDb: () => fakeDb() as never,
  });
}

function linksFrom(core: IntelligenceCore, from: string, kind: string) {
  return core.ledger
    .raw()
    .prepare(`SELECT to_entity, established_by, created_at FROM entity_links WHERE from_entity = ? AND kind = ?`)
    .all(from, kind) as Array<{ to_entity: string; established_by: string; created_at: string }>;
}

const entityCount = (core: IntelligenceCore) =>
  (core.ledger.raw().prepare(`SELECT COUNT(*) n FROM entities`).get() as { n: number }).n;

// ───────────────────────────────────────────────────────────────────────────

test('a UI-initiated pull emits the event with all three roles and moves the lineage pointer', () => {
  const { core } = mirroredCore();
  const prodEnv = core.entities!.resolve(PROD_ROW, 'graph.site_row')[0].entityId;
  const copy = environmentEntityId(core.entities, LOCAL_SITE);

  // No detail at all — the UI path. The upstream must be recovered from
  // Local's own hostConnections through the graph row.
  observerFor(core, { wpeSiteId: WPE_SITE_UUID, environment: 'production' })(observation());

  const events = core.ledger.query({ topicPrefix: 'episodic.sync.' });
  expect(events).toHaveLength(1);
  expect(events[0].topic).toBe('episodic.sync.pulled');
  expect(events[0].schema).toBe('sync.observed/1');
  // The `site` role is the Site the MIRROR established (keyed by wpe.site_id),
  // reached by traversal — not a fresh `local.site_id.logical` derivation.
  expect(events[0].entity).toEqual({
    site: core.entities!.resolve(WPE_SITE_UUID, 'wpe.site_id')[0].entityId,
    environment: prodEnv,
    working_copy: copy,
  });
  expect(events[0].entity.site).not.toBe(siteEntityId(core.entities, LOCAL_SITE));
  expect(events[0].payload).toEqual({ flow: 'full', direction: 'down', includes_db: true });
  expect(events[0].source.system).toBe('sync:wpe');
  // observed_at is when the sync FINISHED — when the copy actually held it.
  expect(events[0].observed_at).toBe('2026-08-17T10:05:00.000Z');

  const lineage = linksFrom(core, copy, 'content_pulled_from');
  expect(lineage).toEqual([
    { to_entity: prodEnv, established_by: 'pull_lineage', created_at: '2026-08-17T10:05:00.000Z' },
  ]);
  core.close();
});

test('ids are FROZEN: a sync against a known site creates no entity', () => {
  const { core } = mirroredCore();
  const copyBefore = environmentEntityId(core.entities, LOCAL_SITE);
  const siteBefore = core.entities!.resolve(WPE_SITE_UUID, 'wpe.site_id')[0].entityId;
  const before = entityCount(core);

  observerFor(core, { wpeSiteId: WPE_SITE_UUID, environment: 'production' })(
    observation({ detail: { installName: 'acmeprod', includesDb: true } }),
  );

  // The pin that matters. A shape assertion alone passes happily while a
  // second, divergent entity is minted beside the first (audit A7's defect).
  expect(entityCount(core)).toBe(before);
  const emitted = core.ledger.query({ topicPrefix: 'episodic.sync.' })[0];
  expect(emitted.entity.working_copy).toBe(copyBefore);
  expect(emitted.entity.site).toBe(siteBefore);
  core.close();
});

test('an UNMIRRORED local site falls back to the id its other producers already stamp', () => {
  const { core } = newCore();
  // No mirror has run: nothing links this copy to a Site. The derivation is
  // then correct — it is the same id wpEventProducer stamps for this site, so
  // the histories stay joined rather than splitting.
  observerFor(core)(observation({ detail: { installName: 'acmeprod', includesDb: true } }));

  const emitted = core.ledger.query({ topicPrefix: 'episodic.sync.' })[0];
  expect(emitted.entity.site).toBe(siteEntityId(core.entities, LOCAL_SITE));
  expect(emitted.entity.working_copy).toBe(environmentEntityId(core.entities, LOCAL_SITE));
  expect(emitted.entity.environment).toBeUndefined(); // no mirror, no upstream
  core.close();
});

test('the content pointer MOVES on re-pull — two pulls, the second wins', () => {
  const { core } = mirroredCore();
  const copy = environmentEntityId(core.entities, LOCAL_SITE);
  const prodEnv = core.entities!.resolve(PROD_ROW, 'graph.site_row')[0].entityId;
  const stageEnv = core.entities!.resolve(STAGE_ROW, 'graph.site_row')[0].entityId;
  const observe = observerFor(core);

  observe(observation({ detail: { installName: 'acmeprod', includesDb: true } }));
  expect(linksFrom(core, copy, 'content_pulled_from').map((l) => l.to_entity)).toEqual([prodEnv]);

  observe(
    observation({
      finishedAt: Date.parse('2026-08-18T09:00:00.000Z'),
      detail: { installName: 'acmestg', includesDb: true },
    }),
  );

  const lineage = linksFrom(core, copy, 'content_pulled_from');
  expect(lineage).toHaveLength(1); // the PK upserts — one content upstream, always
  expect(lineage[0].to_entity).toBe(stageEnv);
  expect(lineage[0].created_at).toBe('2026-08-18T09:00:00.000Z');
  // Both pulls are still in the episodic record; only the POINTER moved.
  expect(core.ledger.query({ topicPrefix: 'episodic.sync.' })).toHaveLength(2);
  core.close();
});

test('a FAILED pull emits nothing and moves nothing', () => {
  const { core } = mirroredCore();
  const copy = environmentEntityId(core.entities, LOCAL_SITE);
  observerFor(core)(observation({ outcome: 'failed', detail: { installName: 'acmeprod', includesDb: true } }));

  expect(core.ledger.query({ topicPrefix: 'episodic.sync.' })).toHaveLength(0);
  expect(linksFrom(core, copy, 'content_pulled_from')).toHaveLength(0);
  core.close();
});

test('a files-only pull is recorded, but carries no content and so moves no content pointer', () => {
  const { core } = mirroredCore();
  const copy = environmentEntityId(core.entities, LOCAL_SITE);
  observerFor(core)(
    observation({ databasePhaseObserved: false, detail: { installName: 'acmeprod', includesDb: false } }),
  );

  const events = core.ledger.query({ topicPrefix: 'episodic.sync.' });
  expect(events).toHaveLength(1);
  expect(events[0].payload).toMatchObject({ flow: 'code', includes_db: false });
  expect(linksFrom(core, copy, 'content_pulled_from')).toHaveLength(0);
  core.close();
});

test('a push is recorded and never rewrites the copy\'s content lineage', () => {
  const { core } = mirroredCore();
  const copy = environmentEntityId(core.entities, LOCAL_SITE);
  const observe = observerFor(core);

  observe(observation({ detail: { installName: 'acmeprod', includesDb: true } }));
  observe(
    observation({
      type: 'push',
      finishedAt: Date.parse('2026-08-19T09:00:00.000Z'),
      detail: { installName: 'acmestg', includesDb: true },
    }),
  );

  const events = core.ledger.query({ topicPrefix: 'episodic.sync.' });
  expect(events.map((e) => e.topic)).toEqual(['episodic.sync.pulled', 'episodic.sync.pushed']);
  expect(events[1].payload).toMatchObject({ direction: 'up', flow: 'full' });
  // Still pointing at what it was PULLED from, not what it was pushed to.
  const lineage = linksFrom(core, copy, 'content_pulled_from');
  expect(lineage).toHaveLength(1);
  expect(lineage[0].to_entity).toBe(core.entities!.resolve(PROD_ROW, 'graph.site_row')[0].entityId);
  core.close();
});

test('an unresolvable upstream is OMITTED, never invented', () => {
  const { core } = mirroredCore();
  const before = entityCount(core);
  const copy = environmentEntityId(core.entities, LOCAL_SITE);

  // A name the mirror never saw, and no hostConnection to fall back on.
  observerFor(core)(observation({ detail: { installName: 'never-mirrored', includesDb: true } }));

  const events = core.ledger.query({ topicPrefix: 'episodic.sync.' });
  expect(events).toHaveLength(1);
  expect(events[0].entity.environment).toBeUndefined();
  expect(Object.keys(events[0].entity).sort()).toEqual(['site', 'working_copy']);
  expect(entityCount(core)).toBe(before); // nothing derived from the name
  expect(linksFrom(core, copy, 'content_pulled_from')).toHaveLength(0);
  core.close();
});

test('a declared includes_db beats an inferred one, in both directions', () => {
  // Declared false while the phase was seen: a tool that knows it pulled no
  // database wins over the inference.
  expect(deriveSyncFacts(observation({ databasePhaseObserved: true, detail: { includesDb: false } })))
    .toMatchObject({ includesDb: false, flow: 'code' });
  // Declared true while no phase was seen.
  expect(deriveSyncFacts(observation({ databasePhaseObserved: false, detail: { includesDb: true } })))
    .toMatchObject({ includesDb: true, flow: 'full' });
  // Database-only: content moved, no files.
  expect(deriveSyncFacts(observation({ detail: { includesDb: true, databaseOnly: true } })))
    .toMatchObject({ includesDb: true, flow: 'content' });
  // Nothing declared — the inference is all there is.
  expect(deriveSyncFacts(observation({ databasePhaseObserved: true })))
    .toMatchObject({ includesDb: true, flow: 'full' });
  expect(deriveSyncFacts(observation({ type: 'push' }))).toMatchObject({ direction: 'up' });
});

test('the producer is non-fatal: a broken graph and a broken entity service cost only the observation', () => {
  const { core } = mirroredCore();
  const boom = () => { throw new Error('graph exploded'); };

  const withBadDb = createSyncObserver({
    core,
    logger: silent,
    getHostConnection: () => ({ wpeSiteId: WPE_SITE_UUID, environment: 'production' }),
    getDb: () => ({ prepare: boom }) as never,
  });
  expect(() => withBadDb(observation())).not.toThrow();
  // The event still lands — only the upstream role is lost.
  const events = core.ledger.query({ topicPrefix: 'episodic.sync.' });
  expect(events).toHaveLength(1);
  expect(events[0].entity.environment).toBeUndefined();

  const brokenEntities = { ...core, entities: { resolve: boom, ensure: boom, link: boom } } as never;
  const withBadEntities = createSyncObserver({
    core: brokenEntities,
    logger: silent,
    getHostConnection: () => undefined,
    getDb: () => fakeDb() as never,
  });
  expect(() => withBadEntities(observation())).not.toThrow();
  core.close();
});

test('mirror: has_working_copy is written ALONGSIDE has_environment, and round-trips', () => {
  const { core } = mirroredCore();
  const entities = core.entities!;
  const copy = environmentEntityId(entities, LOCAL_SITE);
  const siteEntity = entities.resolve(WPE_SITE_UUID, 'wpe.site_id')[0].entityId;

  // Parity: the shipped edge is untouched and still carries the copy.
  const envs = entities.environmentsOf(siteEntity).map((e) => e.entityId);
  expect(envs).toContain(copy);
  expect(envs).toContain(entities.resolve(PROD_ROW, 'graph.site_row')[0].entityId);
  expect(envs).toContain(entities.resolve(STAGE_ROW, 'graph.site_row')[0].entityId);

  // The new traversal names the copy, and ONLY the copy.
  const copies = entities.workingCopiesOf(siteEntity);
  expect(copies.map((c) => c.entityId)).toEqual([copy]);
  expect(copies[0].establishedBy).toBe('user_link'); // the site_link's own evidence
  core.close();
});

test('mirror: re-running adds no rows — both edge kinds stay idempotent', () => {
  const { core } = mirroredCore();
  const countLinks = (kind: string) =>
    (core.ledger.raw().prepare(`SELECT COUNT(*) n FROM entity_links WHERE kind = ?`).get(kind) as { n: number }).n;
  const envBefore = countLinks('has_environment');
  const copyBefore = countLinks('has_working_copy');

  runSiteLinkMirror(core, {
    getDb: () => fakeDb() as never,
    getLinks: () => [
      { localSiteId: LOCAL_SITE, wpeInstallId: 'inst-prod', wpeInstallName: 'acmeprod', linkSource: 'user', verifiedAt: Date.parse('2026-08-01T00:00:00.000Z') } as never,
    ],
    logger: silent,
  });

  expect(countLinks('has_environment')).toBe(envBefore);
  expect(countLinks('has_working_copy')).toBe(copyBefore);
  core.close();
});
