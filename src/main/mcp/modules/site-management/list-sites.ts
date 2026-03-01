import { McpToolHandler, McpToolResult } from '../../types';
import { ok, requireLocalServices } from './helpers';

export const listSitesHandler: McpToolHandler = {
  definition: {
    name: 'local_list_sites',
    description:
      'List all WordPress sites in Local. Returns name, domain, status (running/halted), ' +
      'PHP version, and content index status for each site. Sites are grouped by status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const sites = Object.values(services.siteData.getSites());
    const statuses = services.localServices!.getAllSiteStatuses();
    const indexed = services.indexRegistry.listAll();
    const indexedIds = new Set(indexed.map((e: any) => e.siteId));

    const enriched = sites.map((site) => ({
      id: site.id,
      name: site.name,
      domain: site.domain ?? 'unknown',
      status: statuses[site.id] ?? 'unknown',
      indexed: indexedIds.has(site.id),
    }));

    // Group by status: running first
    const running = enriched.filter((s) => s.status === 'running');
    const other = enriched.filter((s) => s.status !== 'running');

    const lines: string[] = [];
    lines.push(`## Local Sites (${sites.length} total, ${running.length} running)`);

    if (running.length > 0) {
      lines.push('');
      lines.push('### Running');
      for (const s of running) {
        lines.push(`- **${s.name}** (${s.domain}) [indexed: ${s.indexed ? 'yes' : 'no'}]`);
      }
    }

    if (other.length > 0) {
      lines.push('');
      lines.push('### Halted');
      for (const s of other) {
        lines.push(`- ${s.name} (${s.domain}) [${s.status}]`);
      }
    }

    if (sites.length === 0) {
      lines.push('');
      lines.push('No sites found. Use `local_create_site` to create one.');
    }

    return ok(lines.join('\n'));
  },
};
