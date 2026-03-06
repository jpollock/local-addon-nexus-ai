import { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const listSiteGroupsHandler: McpToolHandler = {
  definition: {
    name: 'list_site_groups',
    description:
      'List all site groups. Groups organize sites into named collections ' +
      '(e.g., "Sites", "Starred"). Shows group name, site count, and member sites.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { title: 'List Site Groups', readOnlyHint: true },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const bridge = services.localServices;
    if (!bridge?.getSiteGroups) return ok('Site groups are not available.');

    const groups = bridge.getSiteGroups();
    if (groups.length === 0) {
      return ok('No site groups found.');
    }

    const allSites = services.siteData.getSites();
    const lines = ['## Site Groups', ''];

    for (const group of groups) {
      lines.push(`### ${group.name}`);
      lines.push(`- Sites: ${group.siteIds.length}`);

      if (group.siteIds.length > 0) {
        const names = group.siteIds.map((id: string) => {
          const site = allSites[id];
          return site?.name || id;
        });
        lines.push(`- Members: ${names.join(', ')}`);
      }
      lines.push('');
    }

    return ok(lines.join('\n'));
  },
};
