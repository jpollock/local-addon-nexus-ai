/**
 * wpe_fleet_versions — WP and PHP versions for WPE installs from local graph.
 *
 * Reads from the graph DB (populated by WPE sync) — zero CAPI calls.
 * Use after wpe_portfolio_usage identifies high-traffic installs to get
 * their WP/PHP versions without making one API call per install.
 *
 * Accepts an optional filter list of install names.
 */
import { McpToolHandler } from '../../types';
import { requireCAPI, staleSyncWarning } from './helpers';

export const fleetVersionsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_fleet_versions',
    description:
      'Get WordPress and PHP versions for WP Engine installs from locally-synced data. ' +
      'Returns results instantly from the local graph — no API calls per install. ' +
      'Run after wpe_portfolio_usage to get versions for high-traffic installs without ' +
      'making individual wpe_get_install calls. ' +
      'Optionally filter to specific install names with install_names.',
    inputSchema: {
      type: 'object',
      properties: {
        install_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to these install names only. Omit to return all synced installs.',
        },
        min_wp_version: {
          type: 'string',
          description: 'Only return installs with WP version older than this (e.g. "6.8" returns all installs below 6.8).',
        },
      },
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const graphService = (services as any).graphService;
      if (!graphService?.getDb) {
        return { content: [{ type: 'text' as const, text: 'Graph database not available.' }], isError: true };
      }
      const db = graphService.getDb();
      if (!db) {
        return { content: [{ type: 'text' as const, text: 'Graph database not initialized.' }], isError: true };
      }

      const filterNames = args.install_names as string[] | undefined;

      // Build query — always WPE source only
      let query = `SELECT name, wp_version, php_version, domain, last_sync_at
                   FROM sites WHERE source = 'wpe'`;
      const params: any[] = [];

      if (filterNames && filterNames.length > 0) {
        const placeholders = filterNames.map(() => '?').join(',');
        query += ` AND name IN (${placeholders})`;
        params.push(...filterNames);
      }

      query += ' ORDER BY name ASC';

      const rows = db.prepare(query).all(...params) as Array<{
        name: string;
        wp_version: string | null;
        php_version: string | null;
        domain: string;
        last_sync_at: number | null;
      }>;

      if (rows.length === 0) {
        const msg = filterNames?.length
          ? `None of the requested installs found in graph. Run wpe_sync_sites first.`
          : `No WP Engine installs found in graph. Run wpe_sync_sites first.`;
        return { content: [{ type: 'text' as const, text: msg }] };
      }

      // Optional: filter by WP version
      const minWp = args.min_wp_version as string | undefined;
      const filtered = minWp
        ? rows.filter((r) => {
            if (!r.wp_version) return true; // unknown — include
            return compareVersions(r.wp_version, minWp) < 0;
          })
        : rows;

      const versionNote = minWp ? ` (WP < ${minWp})` : '';
      const lines = [
        `## WP Engine Fleet Versions${versionNote} — ${filtered.length} install${filtered.length === 1 ? '' : 's'}`,
        '',
        '| Install | WP Version | PHP Version | Domain |',
        '|---------|-----------|------------|--------|',
      ];

      for (const r of filtered) {
        lines.push(
          `| ${r.name} | ${r.wp_version ?? '—'} | ${r.php_version ?? '—'} | ${r.domain} |`,
        );
      }

      // Report any requested installs not found
      if (filterNames?.length) {
        const found = new Set(rows.map((r) => r.name));
        const missing = filterNames.filter((n) => !found.has(n));
        if (missing.length > 0) {
          lines.push('', `⚠️ Not found in graph (may need sync): ${missing.join(', ')}`);
        }
      }

      const warning = await staleSyncWarning(services);
      return { content: [{ type: 'text' as const, text: lines.join('\n') + warning }] };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error reading fleet versions: ${err.message}` }], isError: true };
    }
  },
};

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
