import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const getSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_get_site',
    description:
      'Get detailed information about a specific local WordPress site — name, domain, filesystem path, status, PHP version, WP version, and content index state. Use nexus_list_sites to discover site names if unknown. For full plugin/theme/health details, use nexus_site_audit.' +
      'Returns name, domain, path, status, PHP version, and content index status.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const status = services.localServices!.getSiteStatus(site.id);
    const indexEntry = services.indexRegistry.get(site.id);

    const lines: string[] = [];
    lines.push(`## ${site.name}`);
    lines.push(`- **ID:** ${site.id}`);
    lines.push(`- **Domain:** ${site.domain ?? 'unknown'}`);
    lines.push(`- **Path:** ${site.path}`);
    lines.push(`- **Status:** ${status}`);

    if (indexEntry) {
      lines.push(`- **Indexed:** yes (${indexEntry.documentCount} docs, ${indexEntry.chunkCount} chunks)`);
      if (indexEntry.lastIndexed) {
        lines.push(`- **Last indexed:** ${new Date(indexEntry.lastIndexed).toISOString()}`);
      }
    } else {
      lines.push('- **Indexed:** no');
    }

    return ok(lines.join('\n'));
  },
};
