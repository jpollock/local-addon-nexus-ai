import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const themeListHandler: McpToolHandler = {
  definition: {
    name: 'wp_theme_list',
    description: 'List all installed WordPress themes for a local site or remote WPE install.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
      },
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(
        target.installName,
        ['theme', 'list', '--format=json'],
        services,
      );
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      try {
        const themes = JSON.parse(result.stdout || '[]');
        if (themes.length === 0) return ok('No themes installed.');
        const lines = [`## Themes (${themes.length}) — ${target.installName}`];
        for (const t of themes) {
          const status = t.status === 'active' ? '**active**' : t.status;
          lines.push(`- ${t.name} v${t.version} [${status}]`);
        }
        return ok(lines.join('\n'));
      } catch {
        return ok(result.stdout || 'No themes found.');
      }
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    const themes = await services.localServices!.getThemes(target.site.id);

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
