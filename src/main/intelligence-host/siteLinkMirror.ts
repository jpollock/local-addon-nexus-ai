/**
 * WP-07 · One-way mirror: Track-1's `site_links` → the entity service.
 *
 * Governing decision: docs/intelligence/reconciliation-entity-identity.md.
 * `site_links` (graph.db) remains the operational source of truth for
 * local↔install attachment; this sweep makes those assertions visible to the
 * ledger side as aliases and typed links. It never writes back, never links
 * on its own evidence, and is idempotent — re-running it against unchanged
 * inputs adds zero rows.
 *
 * The "subtle trap" this exists to close: producers derive env-entity ids
 * from graph `sites.id`, but FleetAssembler addresses installs by
 * `remote_install_id ?? id`. The mirror aliases every WPE env entity under
 * BOTH `graph.site_row` and `wpe.install_id`, so a join through either
 * identifier lands on the one entity whose ledger history already exists.
 *
 * Runs after Track-1's reconciliation sweep (wired in src/main/index.ts) —
 * subscription to individual link changes would need a hook inside Track-1
 * files, which are out of bounds for this packet; per-sweep re-mirroring is
 * the reconciliation note's sanctioned alternative.
 */
import type { IntelligenceCore } from './bootstrap';
import type { EstablishedBy } from '../../intelligence';
import type { SiteLink, SiteLinkSource } from '../fleet/types';

interface MinimalLogger {
  info: (msg: string) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

/** The one query this module runs against graph.db. */
interface GraphDbLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

export interface SiteLinkMirrorDeps {
  /** Track-1's SiteLinkStore.list() — read-only. */
  getLinks: () => SiteLink[];
  /** graph.db handle, may be absent while the graph initializes. */
  getDb: () => GraphDbLike | null | undefined;
  logger: MinimalLogger;
}

export interface SiteLinkMirrorResult {
  wpeRows: number;
  links: number;
  /** site_links rows that could not be mirrored (their error was logged). */
  skipped: number;
}

interface WpeRow {
  id: string;
  name: string | null;
  remote_install_id: string | null;
  wpe_site_id: string | null;
}

/**
 * Reconciliation note §2 mapping table. `link_source` values are a closed
 * union, but the row comes from SQLite — an unknown value degrades to the
 * weakest evidence rather than throwing inside a non-fatal sweep.
 */
const LINK_SOURCE_MAP: Record<SiteLinkSource, { establishedBy: EstablishedBy; confidence: number }> = {
  user: { establishedBy: 'user_link', confidence: 1.0 },
  hostConnection: { establishedBy: 'host_connection', confidence: 0.95 },
  inferred: { establishedBy: 'name_heuristic', confidence: 0.5 },
};

export function runSiteLinkMirror(
  core: IntelligenceCore | undefined,
  deps: SiteLinkMirrorDeps,
): SiteLinkMirrorResult | undefined {
  const entities = core?.entities;
  if (!entities) return undefined;
  const { logger } = deps;

  try {
    // ── WPE identity registration: every active WPE row, both aliases ──────
    let rows: WpeRow[] = [];
    try {
      const db = deps.getDb();
      if (db) {
        rows = db
          .prepare(
            `SELECT id, name, remote_install_id, wpe_site_id FROM sites
             WHERE source = 'wpe' AND is_active = 1`,
          )
          .all() as WpeRow[];
      }
    } catch (err) {
      // Degrade: links still mirror, minted from the install id directly.
      logger.error(`[Intelligence] site-link mirror: graph read failed (non-fatal): ${(err as Error).message}`);
    }

    const rowByInstall = new Map<string, WpeRow>();
    for (const row of rows) {
      // ensure() under the producers' derivation namespace ADOPTS the
      // provisional id — all existing ledger history stays attached.
      const envId = entities.ensure('env', 'local.site_id', row.id);
      entities.addAlias(envId, 'graph.site_row', row.id, 1.0, 'derivation');
      if (row.remote_install_id) {
        entities.addAlias(envId, 'wpe.install_id', row.remote_install_id, 1.0, 'derivation');
        rowByInstall.set(row.remote_install_id, row);
      }
      if (row.name) entities.addAlias(envId, 'wpe.install_name', row.name, 1.0, 'derivation');
      rowByInstall.set(row.id, row);

      // Containment is CAPI-given platform config, not a human assertion.
      const siteEntity = siteEntityFor(entities, row);
      entities.link(siteEntity, envId, 'has_environment', 0.95, 'host_connection');
    }

    // ── site_links mirror: each row's evidence lands on the cross edge ─────
    let mirrored = 0;
    let skipped = 0;
    for (const link of deps.getLinks()) {
      try {
        const mapped = LINK_SOURCE_MAP[link.linkSource] ?? LINK_SOURCE_MAP.inferred;
        const at = link.verifiedAt !== null ? new Date(link.verifiedAt).toISOString() : undefined;
        const localEnv = entities.ensure('env', 'local.site_id', link.localSiteId);
        const row = rowByInstall.get(link.wpeInstallId);

        if (row) {
          // The sandbox is an environment of the install's logical Site; the
          // site_link's own evidence is what attaches it.
          const siteEntity = siteEntityFor(entities, row);
          entities.link(siteEntity, localEnv, 'has_environment', mapped.confidence, mapped.establishedBy, at);
          // WP-14/audit A6: ALSO say what it actually is. Additive — the
          // has_environment edge above is kept verbatim, because every shipped
          // reader traverses it and losing them is not a migration, it is a
          // regression.
          entities.link(siteEntity, localEnv, 'has_working_copy', mapped.confidence, mapped.establishedBy, at);
        } else {
          // Install unknown to the graph (not yet synced, or soft-deleted):
          // mint the env from the install id, attach it under the LOCAL
          // site's logical entity — the id local events already carry.
          const wpeEnv = entities.ensure('env', 'wpe.install_id', link.wpeInstallId);
          if (link.wpeInstallName) {
            entities.addAlias(wpeEnv, 'wpe.install_name', link.wpeInstallName, 1.0, 'derivation');
          }
          const siteEntity = entities.ensure('site', 'local.site_id.logical', link.localSiteId);
          entities.link(siteEntity, localEnv, 'has_environment', 1.0, 'derivation');
          entities.link(siteEntity, localEnv, 'has_working_copy', 1.0, 'derivation');
          entities.link(siteEntity, wpeEnv, 'has_environment', mapped.confidence, mapped.establishedBy, at);
        }
        mirrored++;
      } catch (err) {
        skipped++;
        logger.error(
          `[Intelligence] site-link mirror: skipped link for local site ${link.localSiteId} (non-fatal): ${(err as Error).message}`,
        );
      }
    }

    logger.info(
      `[Intelligence] site-link mirror: ${rows.length} WPE rows aliased, ${mirrored} links mirrored` +
        (skipped ? `, ${skipped} skipped` : ''),
    );
    return { wpeRows: rows.length, links: mirrored, skipped };
  } catch (err) {
    // The sweep observes; it must never break whatever scheduled it.
    logger.error(`[Intelligence] site-link mirror failed (non-fatal): ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * The logical Site container for a WPE row: keyed by `wpe.site_id` when CAPI
 * provides one (the canonical external alias, reconciliation note §3), else
 * the row's own provisional logical-site id — the derivation producers
 * already stamp on that row's events.
 */
function siteEntityFor(entities: NonNullable<IntelligenceCore['entities']>, row: WpeRow): string {
  return row.wpe_site_id
    ? entities.ensure('site', 'wpe.site_id', row.wpe_site_id)
    : entities.ensure('site', 'local.site_id.logical', row.id);
}
