import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error } from './preflight';

export const themeListHandler: McpToolHandler = {
  definition: {
    name: 'wp_theme_list',
    description: 'List all installed WordPress themes for a site.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const check = requireRunning(site, services);
    if (check) return check;

    const themes = await services.localServices!.getThemes(site.id);

    if (themes.length === 0) {
      return ok('No themes installed.');
    }

    const lines = [`## Themes (${themes.length})`];
    for (const t of themes) {
      const status = t.status === 'active' ? '**active**' : t.status;
      lines.push(`- ${t.name} v${t.version} [${status}]`);
    }

    return ok(lines.join('\n'));
  },
};
