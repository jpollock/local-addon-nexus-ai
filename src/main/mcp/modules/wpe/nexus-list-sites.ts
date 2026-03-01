import { McpToolHandler, McpToolResult } from '../../types';
import { ok, requireLocalServices } from './helpers';

export const nexusListSitesHandler: McpToolHandler = {
  definition: {
    name: 'nexus_list_sites',
    description:
      'Unified site discovery. Lists all local sites and WP Engine environments ' +
      'in a single view, linking local sites to their WPE counterparts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    // Local sites
    const localSites = Object.values(services.siteData.getSites());
    const statuses = services.localServices!.getAllSiteStatuses();

    const localSection = localSites.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain ?? 'unknown',
      status: statuses[s.id] ?? 'unknown',
      type: 'local' as const,
    }));

    // WPE installs (if available)
    let wpeSection: any[] = [];
    if (services.localServices!.isCAPIAvailable()) {
      try {
        const installs = await services.localServices!.capiGetInstalls() as any[];
        if (installs) {
          wpeSection = installs.map((i) => ({
            id: i.id,
            name: i.name,
            environment: i.environment ?? 'unknown',
            type: 'wpe' as const,
          }));
        }
      } catch {
        // CAPI call failed — continue with local-only
      }
    }

    // Build output
    const lines: string[] = [];

    lines.push(`## Sites (${localSection.length} local, ${wpeSection.length} WPE)`);

    if (localSection.length > 0) {
      lines.push('');
      lines.push('### Local Sites');
      const running = localSection.filter((s) => s.status === 'running');
      const halted = localSection.filter((s) => s.status !== 'running');

      for (const s of running) {
        lines.push(`- **${s.name}** (${s.domain}) [running]`);
      }
      for (const s of halted) {
        lines.push(`- ${s.name} (${s.domain}) [${s.status}]`);
      }
    }

    if (wpeSection.length > 0) {
      lines.push('');
      lines.push('### WP Engine Environments');
      for (const i of wpeSection) {
        lines.push(`- **${i.name}** (${i.environment})`);
      }
    }

    if (localSection.length === 0 && wpeSection.length === 0) {
      lines.push('');
      lines.push('No sites found. Create a local site with `local_create_site`.');
    }

    return ok(lines.join('\n'));
  },
};
