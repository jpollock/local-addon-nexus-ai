import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { SiteLinkStore } from './SiteLinkStore';
import type { ReconcileReport, SiteLink } from './types';

/**
 * Per-site budget for a resolution during a sweep.
 *
 * `resolveWpeInstall` reaches CAPI, which has no timeout of its own. On a
 * captive-portal or VPN network a single request can hang indefinitely; without
 * this bound one such site would stall the entire sweep behind it.
 */
export const RESOLVE_TIMEOUT_MS = 10_000;

/** Resolves to null if `work` has not settled within `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  // Losing the race does not cancel the CAPI call — it may still complete and
  // write its link. It just no longer holds the sweep up.
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

/**
 * Resolves local sites to WP Engine installs and records where each link came
 * from. Knows CAPI (via the bridge); knows nothing about SQL.
 */
export class SiteLinkResolver {
  /** Result of the most recent sweep, for surfaces that report unresolved sites. */
  private lastReport: ReconcileReport | null = null;

  constructor(
    private readonly store: SiteLinkStore,
    private readonly bridge: Pick<LocalServicesBridge, 'resolveWpeInstall'>,
  ) {}

  /** The most recent reconciliation report, or null if no sweep has finished. */
  getLastReport(): ReconcileReport | null {
    return this.lastReport;
  }

  /** Record a completed sweep so tools can surface what could not be linked. */
  setLastReport(report: ReconcileReport): void {
    this.lastReport = report;
  }

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
   * renamed install, a CAPI error, a request that never came back — are
   * reported rather than dropped, so a human can link them manually.
   */
  async reconcileAll(
    sites: Record<string, { id: string; name: string }>,
  ): Promise<ReconcileReport> {
    const report: ReconcileReport = { linked: [], unresolved: [] };

    for (const site of Object.values(sites)) {
      try {
        const link = await withTimeout(this.resolveOne(site.id), RESOLVE_TIMEOUT_MS);
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
