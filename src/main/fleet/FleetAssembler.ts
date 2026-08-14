import type { DataProvenance } from '../../common/types';
import type { SiteDataAccessor } from '../mcp/types';
import type { SiteLinkStore } from './SiteLinkStore';
import type { FleetInstall, FleetSiteGroup } from './types';

/** Anything synced within this window counts as observed rather than remembered. */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

interface GraphSiteRow {
  id: string;
  name: string;
  remote_install_id: string | null;
  environment: string | null;
  wpe_site_id: string | null;
  domain: string | null;
  last_sync_at: number | null;
}

interface GraphLike {
  listSites(options?: { active_only?: boolean; source?: string }): Promise<unknown[]>;
}

/**
 * Nothing stale is ever presented as current — every install carries the level
 * and age of the data behind it. See the design doc's provenance rule.
 */
export function deriveProvenance(lastSyncAt: number | null, now: number): DataProvenance {
  if (lastSyncAt === null) {
    return {
      level: 'scanned',
      source: 'none',
      ageSeconds: null,
      caveat: "We've never successfully reached this site.",
    };
  }

  const ageSeconds = Math.max(0, Math.round((now - lastSyncAt) / 1000));
  if (now - lastSyncAt <= LIVE_WINDOW_MS) {
    return { level: 'live', source: 'WPE sync', ageSeconds, caveat: null };
  }

  return {
    level: 'configured',
    source: 'last WPE sync',
    ageSeconds,
    caveat: 'Values are from the last sync, not observed just now.',
  };
}

/** Composes WPE installs, their attached sandboxes, and provenance into fleet rows. */
export class FleetAssembler {
  constructor(
    private readonly graph: GraphLike,
    private readonly links: SiteLinkStore,
    private readonly siteData: SiteDataAccessor,
  ) {}

  async listFleet(): Promise<FleetSiteGroup[]> {
    const rows = (await this.graph.listSites({ source: 'wpe', active_only: true })) as GraphSiteRow[];
    const now = Date.now();
    const groups = new Map<string, FleetSiteGroup>();

    for (const row of rows) {
      const installId = row.remote_install_id ?? row.id;
      const attached = this.links.getByInstall(installId)[0] ?? null;

      const install: FleetInstall = {
        installId,
        installName: row.name,
        environment: row.environment,
        domain: row.domain,
        sandbox: attached
          ? {
              localSiteId: attached.localSiteId,
              // Name the sandbox after the local site. SiteLink stores the
              // install name, which is a different thing and would mislabel it.
              localSiteName:
                this.siteData.getSite(attached.localSiteId)?.name ?? attached.localSiteId,
              linkSource: attached.linkSource,
            }
          : null,
        provenance: deriveProvenance(row.last_sync_at, now),
      };

      const key = row.wpe_site_id ?? installId;
      const existing = groups.get(key);
      if (existing) {
        existing.installs.push(install);
      } else {
        groups.set(key, {
          wpeSiteId: row.wpe_site_id,
          name: row.domain ?? row.name,
          installs: [install],
        });
      }
    }

    return Array.from(groups.values());
  }
}
