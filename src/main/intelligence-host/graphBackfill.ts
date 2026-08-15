/**
 * Phase-B seeding: one-shot backfill of current graph.db state into the ledger.
 *
 * The tap (phase A) only captures changes from now on; readers can't migrate
 * to twin views until twins cover the whole fleet. This walks the graph's
 * active sites + plugins ONCE and emits them as observations:
 *
 *   - observed_at = the row's updated_at — the original sync's observation
 *     time, not "now". Backfill does not launder stale data as fresh.
 *   - source.system = 'graph-backfill' — provenance says exactly how these
 *     entered the ledger.
 *   - is_active = 1 rows only — soft-deleted sites stay deleted (the
 *     nexusHostRemove rule: a removed host must never be reconnected to).
 *   - Marker-guarded: runs once per install, recorded in storage.
 *
 * Non-fatal by construction, like everything else on this seam.
 */
import { IntelligenceCore } from './bootstrap';
import { provisionalEnvironmentId, provisionalSiteId } from './provisionalEntity';
import { createChangeGate, rowTimeToIso } from './changeGate';

// v2: adds themes. Bumping the marker re-runs the whole pass; the change gate
// makes the already-seeded sites/plugins portion nearly free (0 re-emissions).
const MARKER_KEY = 'intelligence_backfill_v2';
const RETRY_MS = 15_000;
const MAX_ATTEMPTS = 20; // graph.db initializes async; poll for up to ~5 minutes

interface MinimalStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}
interface MinimalLogger {
  info: (msg: string) => void;
  error: (msg: string, ...args: unknown[]) => void;
}
/** Structural view of better-sqlite3's Database — only what backfill reads. */
interface DbLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

export interface BackfillResult {
  sites: number;
  plugins: number;
  themes: number;
  emitted: number;
}

export function scheduleGraphBackfill(options: {
  core: IntelligenceCore;
  storage: MinimalStorage;
  getDb: () => DbLike | null | undefined;
  logger: MinimalLogger;
}): void {
  const { core, storage, getDb, logger } = options;
  if (storage.get(MARKER_KEY)) return; // already seeded

  let attempts = 0;
  const tryRun = () => {
    try {
      const db = getDb();
      if (!db) {
        if (++attempts < MAX_ATTEMPTS) setTimeout(tryRun, RETRY_MS);
        return;
      }
      const result = runGraphBackfill(core, db, logger);
      storage.set(MARKER_KEY, new Date().toISOString());
      logger.info(
        `[Intelligence] backfill complete: ${result.emitted} observations emitted ` +
          `(${result.sites} sites, ${result.plugins} plugins scanned)`
      );
    } catch (err) {
      logger.error('[Intelligence] backfill failed (will not retry):', (err as Error).message);
      // Deliberately still set the marker? No — leave unset so a restart retries.
    }
  };
  setTimeout(tryRun, RETRY_MS);
}

export function runGraphBackfill(
  core: IntelligenceCore,
  db: DbLike,
  logger: MinimalLogger
): BackfillResult {
  const gate = createChangeGate(core);
  let emitted = 0;

  const sites = db
    .prepare(
      `SELECT id, name, domain, wp_version, php_version, source, updated_at
       FROM sites WHERE is_active = 1`
    )
    .all() as Array<Record<string, unknown>>;

  for (const site of sites) {
    const siteId = String(site.id ?? '');
    if (!siteId) continue;
    const entityId = provisionalEnvironmentId(siteId);
    const value = {
      name: site.name == null ? undefined : String(site.name),
      domain: site.domain == null ? undefined : String(site.domain),
      wp_version: site.wp_version == null ? undefined : String(site.wp_version),
      php_version: site.php_version == null ? undefined : String(site.php_version),
    };
    if (gate(entityId, 'site.core', value)) {
      core.emitter.emit({
        observed_at: rowTimeToIso(site.updated_at),
        topic: 'state.site.observed',
        schema: 'site.observed/1',
        entity: { site: provisionalSiteId(siteId), environment: entityId },
        actor: { id: 'act_graph_backfill', kind: 'system' },
        source: {
          class: 'platform',
          system: 'graph-backfill',
          trust: 'observed',
        },
        payload: value as Record<string, unknown>,
      });
      emitted++;
    }
  }

  const plugins = db
    .prepare(
      `SELECT p.site_id, p.slug, p.version, p.is_active, p.updated_at
       FROM plugins p JOIN sites s ON s.id = p.site_id
       WHERE s.is_active = 1`
    )
    .all() as Array<Record<string, unknown>>;

  for (const plugin of plugins) {
    const siteId = String(plugin.site_id ?? '');
    const slug = String(plugin.slug ?? '');
    if (!siteId || !slug) continue;
    const entityId = provisionalEnvironmentId(siteId);
    const value = {
      version: plugin.version == null ? undefined : String(plugin.version),
      active: Boolean(plugin.is_active),
    };
    if (gate(entityId, `plugin:${slug}`, value)) {
      core.emitter.emit({
        observed_at: rowTimeToIso(plugin.updated_at),
        topic: 'state.plugin.observed',
        schema: 'plugin.observed/1',
        entity: { site: provisionalSiteId(siteId), environment: entityId },
        actor: { id: 'act_graph_backfill', kind: 'system' },
        source: { class: 'platform', system: 'graph-backfill', trust: 'observed' },
        payload: { slug, version: value.version ?? '', active: value.active },
      });
      emitted++;
    }
  }

  // Themes (v2). Older graph databases may lack the table — skip gracefully.
  let themeCount = 0;
  try {
    const themes = db
      .prepare(
        `SELECT t.site_id, t.slug, t.version, t.is_active, t.updated_at
         FROM themes t JOIN sites s ON s.id = t.site_id
         WHERE s.is_active = 1`
      )
      .all() as Array<Record<string, unknown>>;
    themeCount = themes.length;
    for (const theme of themes) {
      const siteId = String(theme.site_id ?? '');
      const slug = String(theme.slug ?? '');
      if (!siteId || !slug) continue;
      const entityId = provisionalEnvironmentId(siteId);
      const value = {
        version: theme.version == null ? undefined : String(theme.version),
        active: Boolean(theme.is_active),
      };
      if (gate(entityId, `theme:${slug}`, value)) {
        core.emitter.emit({
          observed_at: rowTimeToIso(theme.updated_at),
          topic: 'state.theme.observed',
          schema: 'theme.observed/1',
          entity: { site: provisionalSiteId(siteId), environment: entityId },
          actor: { id: 'act_graph_backfill', kind: 'system' },
          source: { class: 'platform', system: 'graph-backfill', trust: 'observed' },
          payload: { slug, version: value.version ?? '', active: value.active },
        });
        emitted++;
      }
    }
  } catch {
    logger.info('[Intelligence] backfill: themes table unavailable — skipped');
  }

  core.scheduleFolds();
  logger.info(
    `[Intelligence] backfill scanned ${sites.length} sites, ${plugins.length} plugins, ${themeCount} themes`
  );
  return { sites: sites.length, plugins: plugins.length, themes: themeCount, emitted };
}
