/**
 * SiteData types — Local's internal site API surface
 *
 * These interfaces describe the shape of site objects and the accessor used
 * to retrieve them. They are derived from actual property access patterns in
 * ipc-handlers.ts and resolvers.ts — not from Local's internal source.
 *
 * Use `LocalSite` wherever code iterates over or reads from Local's site
 * objects. Use `LocalSiteDataAccessor` for the top-level accessor injected
 * through `IpcHandlerDeps.siteData`.
 */

// ---------------------------------------------------------------------------
// Host connection (WPE link stored on a site)
// ---------------------------------------------------------------------------

export interface LocalSiteHostConnection {
  hostId: string;
  /** WPE install UUID */
  installId?: string;
  /** Account UUID, present on some host connections */
  accountId?: string;
  /** e.g. 'production' | 'staging' | 'development' */
  remoteSiteEnv?: {
    environment?: string;
  };
}

// ---------------------------------------------------------------------------
// Port / service maps (Local's internal port registry)
// ---------------------------------------------------------------------------

export interface LocalSitePorts {
  /** HTTP port for the site */
  site?: number[];
}

export interface LocalSiteServicePorts {
  site?: number[];
}

export interface LocalSiteNginxService {
  ports?: LocalSiteServicePorts;
}

export interface LocalSiteServices {
  nginx?: LocalSiteNginxService;
}

// ---------------------------------------------------------------------------
// Site paths
// ---------------------------------------------------------------------------

export interface LocalSitePaths {
  webRoot: string;
}

// ---------------------------------------------------------------------------
// Full local site object
// ---------------------------------------------------------------------------

/**
 * Shape of a single site object returned by Local's siteData API.
 *
 * All fields except `id`, `name`, and `path` are optional — they may be
 * absent on older Local versions or for sites that have never been started.
 */
export interface LocalSite {
  id: string;
  name: string;
  path: string;
  domain?: string;
  /** User-facing URL (may differ from domain on mapped ports) */
  url?: string;
  /** e.g. 'running' | 'halted' */
  status?: string;
  phpVersion?: string;
  wpVersion?: string;
  ports?: LocalSitePorts;
  services?: LocalSiteServices;
  paths?: LocalSitePaths;
  /** MySQL / MariaDB port (if exposed by Local). */
  mysqlPort?: number;
  /**
   * Host-connection records keyed by connection ID or stored as an array.
   * Use `Object.values()` or `Array.isArray()` guard before iterating.
   */
  hostConnections?: Record<string, LocalSiteHostConnection> | LocalSiteHostConnection[];
}

// ---------------------------------------------------------------------------
// Top-level accessor
// ---------------------------------------------------------------------------

/**
 * The siteData accessor injected by Local into addons.
 * Corresponds to Local's internal SiteData service.
 */
export interface LocalSiteDataAccessor {
  /** Return all sites keyed by site ID. */
  getSites(): Record<string, LocalSite>;
  /** Return a single site by ID, or null if not found. */
  getSite(id: string): LocalSite | null;
}
