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
  updated_at: number | null;
}

interface GraphLike {
  listSites(options?: { active_only?: boolean; source?: string }): Promise<unknown[]>;
}

/**
 * Nothing stale is ever presented as current — every install carries the level
 * and age of the data behind it. See the design doc's provenance rule.
 *
 * Four rungs, because there are four genuinely different states:
 *
 * - `live`         — reached the install itself within the live window.
 * - `configured`   — reached it, but a while ago.
 * - `external-api` — never reached the install; everything shown came from
 *                    CAPI. This is the normal state for a WPE customer with
 *                    auto-sync off or no SSH key, and it is the only rung that
 *                    `syncFromCAPI` (the Tier-1 sync that always runs) can
 *                    produce, since it writes no `last_sync_at`.
 * - `scanned`      — nothing at all: no sync, not even a CAPI row timestamp.
 *
 * Collapsing `external-api` into `scanned` was the bug: a row displaying a
 * name, environment and domain CAPI returned seconds ago cannot honestly say
 * we have never reached it.
 */
export function deriveProvenance(
  lastSyncAt: number | null,
  updatedAt: number | null,
  now: number,
): DataProvenance {
  if (lastSyncAt !== null) {
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

  if (updatedAt !== null) {
    return {
      level: 'external-api',
      source: 'WP Engine API',
      ageSeconds: Math.max(0, Math.round((now - updatedAt) / 1000)),
      caveat: "From the WP Engine API — we've not reached the install itself.",
    };
  }

  return {
    level: 'scanned',
    source: 'none',
    ageSeconds: null,
    caveat: "We've never successfully reached this site.",
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
    // Group keys whose label already came from a production install. listSites
    // orders by install name, so first-seen alone would label a site after
    // whichever environment sorts first — 'devjeremy' before 'wwwjeremy'.
    const namedFromProduction = new Set<string>();

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
        provenance: deriveProvenance(row.last_sync_at, row.updated_at ?? null, now),
      };

      const key = row.wpe_site_id ?? installId;
      const isProduction = row.environment === 'production';
      const existing = groups.get(key);
      if (existing) {
        existing.installs.push(install);
        if (isProduction && !namedFromProduction.has(key)) {
          existing.name = row.domain ?? row.name;
        }
      } else {
        groups.set(key, {
          wpeSiteId: row.wpe_site_id,
          name: row.domain ?? row.name,
          installs: [install],
        });
      }
      if (isProduction) namedFromProduction.add(key);
    }

    return Array.from(groups.values());
  }
}
