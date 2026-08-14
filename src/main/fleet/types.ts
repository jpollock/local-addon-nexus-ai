import type { DataProvenance } from '../../common/types';

/**
 * How a local-site-to-WPE-install link came to exist.
 *
 * 'user' is authoritative: inference must never overwrite it. Install renames,
 * backup restores and site clones all make automatic resolution wrong, and a
 * silently wrong join is worse than a missing one.
 */
export type SiteLinkSource = 'hostConnection' | 'user' | 'inferred';

export interface SiteLink {
  localSiteId: string;
  wpeInstallId: string;
  wpeInstallName: string;
  linkSource: SiteLinkSource;
  /** Epoch ms when this link was last confirmed against CAPI, or null if never. */
  verifiedAt: number | null;
}

export interface UnresolvedSite {
  localSiteId: string;
  localSiteName: string;
}

export interface ReconcileReport {
  linked: SiteLink[];
  /** Sites we could not attach to an install — these need a human to link them. */
  unresolved: UnresolvedSite[];
}

export interface FleetSandbox {
  localSiteId: string;
  localSiteName: string;
  linkSource: SiteLinkSource;
}

export interface FleetInstall {
  installId: string;
  installName: string;
  environment: string | null;
  domain: string | null;
  /** The local working copy attached to this install, if any. */
  sandbox: FleetSandbox | null;
  provenance: DataProvenance;
}

export interface FleetSiteGroup {
  wpeSiteId: string | null;
  name: string;
  installs: FleetInstall[];
}
