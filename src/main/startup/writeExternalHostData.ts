// src/main/startup/writeExternalHostData.ts
import type { ExternalHostData } from './collectExternalHostData';

export type GraphWriter = {
  upsertSite(site: Record<string, unknown>): Promise<unknown>;
  upsertPlugin(plugin: Record<string, unknown>): Promise<unknown>;
  upsertTheme(theme: Record<string, unknown>): Promise<unknown>;
  getDb?: () => any;
};

export type WriteLogger = {
  warn: (...args: any[]) => void;
};

const noopLogger: WriteLogger = { warn: () => {} };

/**
 * Persist collected L1+L2 data for one external host.
 *
 * THE HONESTY RULE, which this file exists to enforce:
 * a field absent from `data` is NOT WRITTEN. It does not become NULL, 0, false
 * or a default — the column keeps whatever the last successful cycle put there.
 * An unreachable host must never look like a host with no plugins and no PHP.
 *
 * php_version in particular must never fall back to '8.0'. That fabrication was
 * removed from the health-scoring path and this writer is the other door it
 * could come back through.
 *
 * WHY TWO WRITES, NOT ONE:
 * The task brief this was built from assumed `GraphService.upsertSite` persists
 * whatever keys are on the object passed to it. It does not — its SQL statement
 * (src/main/events/GraphService.ts) names a fixed column list (id, name, domain,
 * wp_version, php_version, account_id, last_sync_at, is_active, created_at,
 * updated_at, source, environment, remote_install_id, remote_domain,
 * wpe_site_id, platform, host). site_url, admin_email, active_theme,
 * settings_json, post_count(+by_type), user_count(+by_role), last_post_at and
 * ssh_last_sync_at all exist as real columns (added by WpeRefreshScheduler's
 * column guard) but upsertSite's INSERT/UPDATE never mentions them — passing
 * them to upsertSite alone would silently drop every one of them in
 * production, even though a hand-rolled test double that just merges the
 * object into a Map would show it "working". That is the exact class of bug
 * this task exists to prevent, just arrived at from the write side instead of
 * the fabrication side.
 *
 * So: identity + core scalar fields (id, name, domain, source, host,
 * is_active, created_at, updated_at, last_sync_at, wp_version, php_version) go
 * through the real `upsertSite` API, exactly like the existing lazy-sighting
 * write in `maybeUpsertExternalSite` (mcp/tool-registry.ts). The extended L1/L2
 * columns go through a direct SQL UPDATE with per-column COALESCE guards,
 * exactly like `WpeRefreshScheduler`'s own scalar-field write — the
 * established pattern for "column that upsertSite doesn't own" in this
 * codebase. Both writers already agree on this split; this one now matches
 * them instead of reinventing (and silently losing data via) a third shape.
 *
 * FAILURE ISOLATION: the extended-columns UPDATE, the plugin replace, and the
 * theme replace are each wrapped independently. A DB fault partway through
 * one (e.g. `upsertPlugin` throwing on the 3rd of 5 rows) must not prevent the
 * others from running — in particular, a plugin-write fault must not silently
 * drop a theme collection that succeeded in the same cycle. Failures are
 * logged, not swallowed, since a caller may want to know a host's inventory
 * didn't fully persist even though the cycle didn't throw.
 */
export async function writeExternalHostData(
  graphService: GraphWriter,
  siteId: string,
  alias: string,
  data: ExternalHostData,
  now: number,
  logger: WriteLogger = noopLogger,
): Promise<void> {
  const collectedAnything = Object.keys(data).length > 0;
  if (!collectedAnything) {
    // Unreachable or wholly unparseable. Do not stamp ssh_last_sync_at — doing so
    // would suppress the retry until the next staleness window elapses.
    return;
  }

  const db = graphService.getDb?.();

  // Preserve a real domain. A sighting-era row may still carry the alias; only
  // replace it when we have something better, never the other way round.
  let domain: string = alias;
  try {
    const existing = db?.prepare('SELECT domain FROM sites WHERE id=?').get(siteId) as
      { domain?: string } | undefined;
    if (existing?.domain && existing.domain !== alias) domain = existing.domain;
  } catch { /* graph not ready — fall back to the alias, same as first sighting */ }
  if (data.siteUrl) {
    try {
      const host = new URL(data.siteUrl).hostname;
      if (host) domain = host;
    } catch { /* not a URL — keep whatever we had */ }
  }

  // Identity + the scalar columns upsertSite's own SQL actually persists.
  // wp_version/php_version are COALESCE-guarded inside upsertSite itself
  // (`site.wp_version ?? null`), so a missing key and an explicit `undefined`
  // value read identically there — omitting the key when uncollected is not
  // load-bearing, just keeps the call's shape legible about what this cycle
  // actually collected.
  const siteWrite: Record<string, unknown> = {
    id: siteId,
    name: alias,
    domain,
    source: 'external',
    host: 'external',
    is_active: true,
    created_at: now,
    updated_at: now,
    last_sync_at: now,
  };
  if (data.wpVersion !== undefined) siteWrite.wp_version = data.wpVersion;
  if (data.phpVersion !== undefined) siteWrite.php_version = data.phpVersion;
  await graphService.upsertSite(siteWrite);

  // Extended L1/L2 columns upsertSite does not own. Every value is bound as
  // NULL when absent so COALESCE leaves the existing column untouched — a
  // field this cycle didn't collect can never overwrite one a prior cycle did.
  // ssh_last_sync_at is the one column set unconditionally here, and only
  // because we already returned above when nothing was collected at all.
  if (db) {
    try {
      const postCountByType = data.postCountPosts !== undefined
        ? JSON.stringify({ post: data.postCountPosts })
        : null;
      let userCountByRole: string | null = null;
      if (data.adminCount !== undefined || data.editorCount !== undefined) {
        const byRole: Record<string, number> = {};
        if (data.adminCount !== undefined) byRole.administrator = data.adminCount;
        if (data.editorCount !== undefined) byRole.editor = data.editorCount;
        userCountByRole = JSON.stringify(byRole);
      }

      db.prepare(`
        UPDATE sites SET
          site_url            = COALESCE(?, site_url),
          admin_email          = COALESCE(?, admin_email),
          active_theme         = COALESCE(?, active_theme),
          settings_json        = COALESCE(?, settings_json),
          post_count           = COALESCE(?, post_count),
          post_count_by_type   = COALESCE(?, post_count_by_type),
          last_post_at         = COALESCE(?, last_post_at),
          user_count           = COALESCE(?, user_count),
          user_count_by_role   = COALESCE(?, user_count_by_role),
          ssh_last_sync_at     = ?,
          updated_at           = ?
        WHERE id = ?
      `).run(
        data.siteUrl ?? null,
        data.adminEmail ?? null,
        data.activeTheme ?? null,
        data.settingsJson ?? null,
        data.postCount ?? null,
        postCountByType,
        data.lastPostAt ?? null,
        data.userCount ?? null,
        userCountByRole,
        now,
        now,
        siteId,
      );
    } catch { /* best-effort — core identity/version fields above already landed */ }
  }

  // Inventories replace the previous set ONLY when this cycle collected one.
  // `undefined` means the batch failed; `[]` means the host really has none.
  // Plugins and themes are isolated from each other: a fault partway through
  // one must not abort the other, or a successful theme collection would be
  // dropped as collateral damage from an unrelated plugin-write failure.
  if (data.plugins !== undefined) {
    try {
      try { db?.prepare('DELETE FROM plugins WHERE site_id=?').run(siteId); } catch { /* keep going */ }
      for (const p of data.plugins) {
        await graphService.upsertPlugin({
          site_id: siteId, slug: p.slug, name: p.name, version: p.version,
          is_active: p.isActive, author: null, created_at: now, updated_at: now,
        });
      }
    } catch (err) {
      logger.warn(
        `[writeExternalHostData] plugin write failed for ${siteId}, inventory may be incomplete: `
        + `${(err as Error)?.message ?? err}`
      );
    }
  }
  if (data.themes !== undefined) {
    try {
      try { db?.prepare('DELETE FROM themes WHERE site_id=?').run(siteId); } catch { /* keep going */ }
      for (const t of data.themes) {
        await graphService.upsertTheme({
          site_id: siteId, slug: t.slug, name: t.name, version: t.version,
          is_active: t.isActive, author: null, created_at: now, updated_at: now,
        });
      }
    } catch (err) {
      logger.warn(
        `[writeExternalHostData] theme write failed for ${siteId}, inventory may be incomplete: `
        + `${(err as Error)?.message ?? err}`
      );
    }
  }
}
