import type Database from 'better-sqlite3';
import type { SiteLink, SiteLinkSource } from './types';

interface Row {
  local_site_id: string;
  wpe_install_id: string;
  wpe_install_name: string;
  link_source: string;
  verified_at: number | null;
}

function toLink(row: Row): SiteLink {
  return {
    localSiteId: row.local_site_id,
    wpeInstallId: row.wpe_install_id,
    wpeInstallName: row.wpe_install_name,
    linkSource: row.link_source as SiteLinkSource,
    verifiedAt: row.verified_at,
  };
}

/** CRUD over the site_links table. Knows SQL; knows nothing about CAPI. */
export class SiteLinkStore {
  constructor(private readonly db: Database.Database) {}

  get(localSiteId: string): SiteLink | null {
    const row = this.db
      .prepare('SELECT * FROM site_links WHERE local_site_id = ?')
      .get(localSiteId) as Row | undefined;
    return row ? toLink(row) : null;
  }

  /**
   * All local sites linked to one install. Ordered so the caller's choice of
   * `[0]` is stable: without an ORDER BY, SQLite's row order is an artefact of
   * page layout and can change after a vacuum, silently reattaching a
   * different sandbox to the install.
   */
  getByInstall(wpeInstallId: string): SiteLink[] {
    const rows = this.db
      .prepare('SELECT * FROM site_links WHERE wpe_install_id = ? ORDER BY local_site_id')
      .all(wpeInstallId) as Row[];
    return rows.map(toLink);
  }

  list(): SiteLink[] {
    const rows = this.db.prepare('SELECT * FROM site_links').all() as Row[];
    return rows.map(toLink);
  }

  /**
   * Insert or replace a link.
   *
   * Unguarded by design — this is the storage layer. The precedence invariant
   * lives one level up in SiteLinkResolver: a link with `linkSource: 'user'` is
   * authoritative and inference must never overwrite it (`resolveOne`
   * short-circuits on it). A caller reaching past the resolver into `put` can
   * clobber a human's correction with an inferred one, which is precisely the
   * silently-wrong join `site_links` exists to prevent. Go through the resolver
   * unless you are deliberately recording a user decision.
   */
  put(link: SiteLink): void {
    this.db
      .prepare(
        `INSERT INTO site_links
           (local_site_id, wpe_install_id, wpe_install_name, link_source, verified_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(local_site_id) DO UPDATE SET
           wpe_install_id   = excluded.wpe_install_id,
           wpe_install_name = excluded.wpe_install_name,
           link_source      = excluded.link_source,
           verified_at      = excluded.verified_at`,
      )
      .run(
        link.localSiteId,
        link.wpeInstallId,
        link.wpeInstallName,
        link.linkSource,
        link.verifiedAt,
      );
  }

  remove(localSiteId: string): void {
    this.db.prepare('DELETE FROM site_links WHERE local_site_id = ?').run(localSiteId);
  }
}
