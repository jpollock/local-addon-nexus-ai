/**
 * Cache-inversion phase A (migration §10 step 2, first half).
 *
 * GraphService.upsertSite / upsertPlugin are the chokepoint every observer
 * already flows through — CAPI sync, WP-CLI metadata refresh, external-host
 * refresh, the event processor. Wrapping the instance turns every graph write
 * into an envelope emission AS WELL, without touching GraphService itself or
 * any of its ~11 call sites.
 *
 * Phase A = emit alongside (caches keep working exactly as before).
 * Phase B (later) = readers move to twin views and the caches become outputs.
 *
 * Dedup: an 8-hourly WPE sync re-upserts ~300 sites x ~20 plugins whether or
 * not anything changed. Observations are only emitted when the value differs
 * from the current twin fact (or an in-process cache of what we just emitted),
 * so the ledger records change, not repetition. Trade-off, documented: a
 * re-confirmed unchanged fact does not refresh observed_at — "freshness of
 * graph-sourced facts" still derives from sync bookkeeping until real
 * observers emit their own heartbeats.
 */
import { IntelligenceCore } from './bootstrap';
import { environmentEntityId, siteStampFor, eventEntityStamp } from './provisionalEntity';
import { createChangeGate, rowTimeToIso as toIso } from './changeGate';

interface MinimalLogger {
  error: (msg: string, ...args: unknown[]) => void;
}

/* Structural view of GraphService — only what the tap wraps. */
interface GraphServiceLike {
  upsertSite(site: Record<string, unknown>): Promise<void>;
  upsertPlugin(plugin: Record<string, unknown>): Promise<number>;
  upsertTheme?(theme: Record<string, unknown>): Promise<number>;
}

export function tapGraphService(
  graphService: GraphServiceLike,
  core: IntelligenceCore,
  logger: MinimalLogger
): void {
  const shouldEmit = createChangeGate(core);

  const originalUpsertPlugin = graphService.upsertPlugin.bind(graphService);
  graphService.upsertPlugin = async (plugin: Record<string, unknown>): Promise<number> => {
    const id = await originalUpsertPlugin(plugin);
    try {
      const siteId = String(plugin.site_id ?? '');
      const slug = String(plugin.slug ?? '');
      if (siteId && slug) {
        const entityId = environmentEntityId(core.entities, siteId);
        const value = {
          version: plugin.version == null ? undefined : String(plugin.version),
          active: Boolean(plugin.is_active),
        };
        if (shouldEmit(entityId, `plugin:${slug}`, value)) {
          core.emitter.emit({
            observed_at: toIso(plugin.updated_at) ?? new Date().toISOString(), // live tap: the write is happening now
            topic: 'state.plugin.observed',
            schema: 'plugin.observed/1',
            entity: eventEntityStamp(siteStampFor(core.entities, siteId), entityId),
            actor: { id: 'act_graph_sync', kind: 'system' },
            source: { class: 'platform', system: 'graph-sync', trust: 'observed' },
            payload: { slug, version: value.version ?? '', active: value.active },
          });
          core.scheduleFolds();
        }
      }
    } catch (err) {
      logger.error('[Intelligence] graph tap (plugin) error:', (err as Error).message);
    }
    return id;
  };

  if (graphService.upsertTheme) {
    const originalUpsertTheme = graphService.upsertTheme.bind(graphService);
    graphService.upsertTheme = async (theme: Record<string, unknown>): Promise<number> => {
      const id = await originalUpsertTheme(theme);
      try {
        const siteId = String(theme.site_id ?? '');
        const slug = String(theme.slug ?? '');
        if (siteId && slug) {
          const entityId = environmentEntityId(core.entities, siteId);
          const value = {
            version: theme.version == null ? undefined : String(theme.version),
            active: Boolean(theme.is_active),
          };
          if (shouldEmit(entityId, `theme:${slug}`, value)) {
            core.emitter.emit({
              observed_at: toIso(theme.updated_at) ?? new Date().toISOString(), // live tap: the write is happening now
              topic: 'state.theme.observed',
              schema: 'theme.observed/1',
              entity: eventEntityStamp(siteStampFor(core.entities, siteId), entityId),
              actor: { id: 'act_graph_sync', kind: 'system' },
              source: { class: 'platform', system: 'graph-sync', trust: 'observed' },
              payload: { slug, version: value.version ?? '', active: value.active },
            });
            core.scheduleFolds();
          }
        }
      } catch (err) {
        logger.error('[Intelligence] graph tap (theme) error:', (err as Error).message);
      }
      return id;
    };
  }

  const originalUpsertSite = graphService.upsertSite.bind(graphService);
  graphService.upsertSite = async (site: Record<string, unknown>): Promise<void> => {
    await originalUpsertSite(site);
    try {
      const siteId = String(site.id ?? '');
      if (siteId) {
        const entityId = environmentEntityId(core.entities, siteId);
        const value = {
          name: site.name == null ? undefined : String(site.name),
          domain: site.domain == null ? undefined : String(site.domain),
          wp_version: site.wp_version == null ? undefined : String(site.wp_version),
          php_version: site.php_version == null ? undefined : String(site.php_version),
        };
        if (shouldEmit(entityId, 'site.core', value)) {
          core.emitter.emit({
            observed_at: toIso(site.updated_at) ?? new Date().toISOString(), // live tap: the write is happening now
            topic: 'state.site.observed',
            schema: 'site.observed/1',
            entity: eventEntityStamp(siteStampFor(core.entities, siteId), entityId),
            actor: { id: 'act_graph_sync', kind: 'system' },
            source: {
              class: 'platform',
              system: `graph-sync:${String(site.source ?? 'unknown')}`,
              trust: 'observed',
            },
            payload: value as Record<string, unknown>,
          });
          core.scheduleFolds();
        }
      }
    } catch (err) {
      logger.error('[Intelligence] graph tap (site) error:', (err as Error).message);
    }
  };
}
