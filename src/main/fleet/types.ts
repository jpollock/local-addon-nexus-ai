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
