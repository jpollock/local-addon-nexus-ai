/**
 * wpe_detect_drift — compare local dev sites against their linked WPE installs.
 *
 * For each local site that is linked to a WPE install (via hostConnections),
 * compares WP version and plugins between the two environments. Surfaces:
 *   - WP version drift (local ahead, WPE ahead, or in sync)
 *   - Plugin version differences
 *   - Plugins present on one side but not the other
 *
 * Reads from the local graph DB — no SSH or CAPI calls. Requires:
 *   - WPE sync to have run (for WPE plugin/version data)
 *   - Local sites to be indexed OR have graph records (for local plugin/version data)
 */
import { McpToolHandler } from '../../types';
import { requireLocalServices } from './helpers';
import { compareVersions } from '../fleet/version-utils';

interface PluginRow {
  slug: string;
  name: string;
  version: string | null;
  is_active: number;
}

interface DriftSite {
  localName: string;
  wpeName: string;
  local: { wp_version: string | null; php_version: string | null };
  wpe: { wp_version: string | null; php_version: string | null };
  wpDrift: 'local-ahead' | 'wpe-ahead' | 'in-sync' | 'unknown';
  pluginDiffs: PluginDiff[];
}

interface PluginDiff {
  slug: string;
  name: string;
  status: 'version-diff' | 'local-only' | 'wpe-only';
  localVersion: string | null;
  wpeVersion: string | null;
}

export const detectDriftHandler: McpToolHandler = {
  definition: {
    name: 'wpe_detect_drift',
    description:
      'Detect configuration drift between local development sites and their linked WP Engine production environments. Compares plugin versions, WP core version, and PHP version between the local copy and the live install. Use before pushing local changes to production to identify unexpected differences. Shows which environment is ahead for each dimension.' +
      'Shows WP version drift and plugin differences (version mismatches, plugins only on one side). ' +
      'Reads from the local graph — no live API calls required. ' +
      'Run wpe_sync_sites first to ensure WPE data is current.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Filter to a specific local site name. Omit to check all linked sites.',
        },
        plugins_only: {
          type: 'boolean',
          description: 'Only show sites with plugin differences (default: false)',
        },
      },
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services) {
    const siteFilter = args.site as string | undefined;
    const pluginsOnly = args.plugins_only as boolean | undefined;

    const graphService = (services as any).graphService;
    const db = graphService?.getDb?.();
    if (!db) {
      return { content: [{ type: 'text' as const, text: 'Graph database not available. Run wpe_sync_sites first.' }] };
    }

    // Get all local sites with their WPE linkage
    const localSites = Object.values(services.siteData.getSites()) as any[];
    const linkedSites = localSites
      .map((s) => {
        const connections = s.hostConnections
          ? (Array.isArray(s.hostConnections) ? s.hostConnections : Object.values(s.hostConnections))
          : [];
        const wpeConn = connections.find((c: any) => c.host === 'wpe');
        if (!wpeConn?.installName) return null;
        return { localId: s.id, localName: s.name, wpeName: wpeConn.installName };
      })
      .filter(Boolean) as Array<{ localId: string; localName: string; wpeName: string }>;

    if (linkedSites.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No local sites are linked to WP Engine installs. Use `local_wpe_link` to connect them.' }] };
    }

    // Apply site filter
    const toCheck = siteFilter
      ? linkedSites.filter((s) => s.localName.toLowerCase().includes(siteFilter.toLowerCase()))
      : linkedSites;

    if (toCheck.length === 0) {
      return { content: [{ type: 'text' as const, text: `No linked site matching "${siteFilter}" found.` }] };
    }

    const results: DriftSite[] = [];

    for (const { localId, localName, wpeName } of toCheck) {
      // Get local site versions from graph (fall back to index registry)
      const localRow = db.prepare(
        'SELECT wp_version, php_version FROM sites WHERE id = ? LIMIT 1'
      ).get(localId) as { wp_version: string | null; php_version: string | null } | undefined;

      let localWpVersion = localRow?.wp_version ?? null;
      if (!localWpVersion) {
        // Fall back to index registry structure
        const entry = services.indexRegistry.listAll().find((e: any) => e.siteId === localId);
        localWpVersion = entry?.structure?.wpVersion ?? null;
      }

      // Get WPE site versions from graph
      const wpeRow = db.prepare(
        "SELECT wp_version, php_version FROM sites WHERE source='wpe' AND name=? LIMIT 1"
      ).get(wpeName) as { wp_version: string | null; php_version: string | null } | undefined;

      // Get local plugins from graph
      const localPlugins: PluginRow[] = db.prepare(
        'SELECT slug, name, version, is_active FROM plugins WHERE site_id = ?'
      ).all(localId);

      // Get WPE plugins from graph
      const wpePlugins: PluginRow[] = db.prepare(
        "SELECT p.slug, p.name, p.version, p.is_active FROM plugins p JOIN sites s ON p.site_id=s.id WHERE s.source='wpe' AND s.name=?"
      ).all(wpeName);

      // Compute WP drift
      const localWp = localWpVersion;
      const wpeWp = wpeRow?.wp_version ?? null;
      let wpDrift: DriftSite['wpDrift'] = 'unknown';
      if (localWp && wpeWp) {
        const cmp = compareVersions(localWp, wpeWp);
        wpDrift = cmp > 0 ? 'local-ahead' : cmp < 0 ? 'wpe-ahead' : 'in-sync';
      }

      // Build plugin maps
      const localMap = new Map(localPlugins.map((p) => [p.slug, p]));
      const wpeMap = new Map(wpePlugins.map((p) => [p.slug, p]));
      const allSlugs = new Set([...localMap.keys(), ...wpeMap.keys()]);

      const pluginDiffs: PluginDiff[] = [];
      for (const slug of allSlugs) {
        const lp = localMap.get(slug);
        const wp = wpeMap.get(slug);

        if (lp && wp) {
          // Both have it — check version
          if (lp.version && wp.version && lp.version !== wp.version) {
            pluginDiffs.push({
              slug,
              name: lp.name || wp.name || slug,
              status: 'version-diff',
              localVersion: lp.version,
              wpeVersion: wp.version,
            });
          }
        } else if (lp && !wp) {
          pluginDiffs.push({
            slug,
            name: lp.name || slug,
            status: 'local-only',
            localVersion: lp.version,
            wpeVersion: null,
          });
        } else if (!lp && wp) {
          pluginDiffs.push({
            slug,
            name: wp.name || slug,
            status: 'wpe-only',
            localVersion: null,
            wpeVersion: wp.version,
          });
        }
      }

      results.push({
        localName,
        wpeName,
        local: { wp_version: localWp, php_version: null },
        wpe: { wp_version: wpeWp, php_version: wpeRow?.php_version ?? null },
        wpDrift,
        pluginDiffs,
      });
    }

    // Apply plugins_only filter
    const filtered = pluginsOnly ? results.filter((r) => r.pluginDiffs.length > 0) : results;

    if (filtered.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No drift detected across linked sites. All plugin versions match.' }] };
    }

    // Format output
    const lines: string[] = ['## Local ↔ WPE Drift Report', ''];

    for (const site of filtered) {
      const wpIcon = site.wpDrift === 'in-sync' ? '✓' : site.wpDrift === 'local-ahead' ? '⬆' : site.wpDrift === 'wpe-ahead' ? '⬇' : '?';
      lines.push(`### ${site.localName} ↔ ${site.wpeName}`);

      // WP version row
      lines.push(`**WordPress:** local \`${site.local.wp_version ?? '—'}\` ${wpIcon} wpe \`${site.wpe.wp_version ?? '—'}\`` +
        (site.wpDrift === 'local-ahead' ? ' _(local is ahead)_' :
         site.wpDrift === 'wpe-ahead' ? ' _(WPE is ahead)_' :
         site.wpDrift === 'in-sync' ? ' _(in sync)_' : ''));

      if (site.wpe.php_version) {
        lines.push(`**PHP (WPE):** \`${site.wpe.php_version}\``);
      }

      // Plugin diffs
      if (site.pluginDiffs.length === 0) {
        lines.push('**Plugins:** ✓ no differences');
      } else {
        lines.push(`**Plugins:** ${site.pluginDiffs.length} difference${site.pluginDiffs.length !== 1 ? 's' : ''}`);
        lines.push('');
        lines.push('| Plugin | Local | WPE | Status |');
        lines.push('|--------|-------|-----|--------|');
        for (const diff of site.pluginDiffs) {
          const statusLabel = diff.status === 'version-diff' ? '⚠ version diff'
            : diff.status === 'local-only' ? '📍 local only'
            : '🌐 WPE only';
          lines.push(`| ${diff.name} | ${diff.localVersion ?? '—'} | ${diff.wpeVersion ?? '—'} | ${statusLabel} |`);
        }
      }

      lines.push('');
    }

    const inSync = results.filter((r) => r.wpDrift === 'in-sync' && r.pluginDiffs.length === 0).length;
    const drifted = results.length - inSync;
    lines.push(`---`);
    lines.push(`${results.length} linked site${results.length !== 1 ? 's' : ''} checked · ${drifted} with drift · ${inSync} fully in sync`);

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
};
