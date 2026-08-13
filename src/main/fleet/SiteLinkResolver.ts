import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { SiteLinkStore } from './SiteLinkStore';
import type { ReconcileReport, SiteLink } from './types';

/**
 * Resolves local sites to WP Engine installs and records where each link came
 * from. Knows CAPI (via the bridge); knows nothing about SQL.
 */
export class SiteLinkResolver {
  constructor(
    private readonly store: SiteLinkStore,
    private readonly bridge: Pick<LocalServicesBridge, 'resolveWpeInstall'>,
  ) {}

  /**
   * Resolve one local site's link. A pre-existing 'user' link short-circuits:
   * a human said what this is, and CAPI does not get to disagree.
   */
  async resolveOne(localSiteId: string): Promise<SiteLink | null> {
    const existing = this.store.get(localSiteId);
    if (existing?.linkSource === 'user') return existing;

    const install = await this.bridge.resolveWpeInstall(localSiteId);
    if (!install) return null;

    const link: SiteLink = {
      localSiteId,
      wpeInstallId: install.installId,
      wpeInstallName: install.installName,
      linkSource: 'hostConnection',
      verifiedAt: Date.now(),
    };
    this.store.put(link);
    return link;
  }

  setManualLink(localSiteId: string, wpeInstallId: string, wpeInstallName: string): SiteLink {
    const link: SiteLink = {
      localSiteId,
      wpeInstallId,
      wpeInstallName,
      linkSource: 'user',
      verifiedAt: Date.now(),
    };
    this.store.put(link);
    return link;
  }

  clearLink(localSiteId: string): void {
    this.store.remove(localSiteId);
  }

  /**
   * Resolve every known local site. Sites that fail — no host connection, a
   * renamed install, a CAPI error — are reported rather than dropped, so a
   * human can link them manually.
   */
  async reconcileAll(
    sites: Record<string, { id: string; name: string }>,
  ): Promise<ReconcileReport> {
    const report: ReconcileReport = { linked: [], unresolved: [] };

    for (const site of Object.values(sites)) {
      try {
        const link = await this.resolveOne(site.id);
        if (link) {
          report.linked.push(link);
        } else {
          report.unresolved.push({ localSiteId: site.id, localSiteName: site.name });
        }
      } catch {
        report.unresolved.push({ localSiteId: site.id, localSiteName: site.name });
      }
    }

    return report;
  }
}
