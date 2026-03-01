import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const pluginListHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_list',
    description: 'List all installed WordPress plugins for a local site or remote WPE install.',
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
    if ('content' in target) return target; // error result

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(
        target.installName,
        ['plugin', 'list', '--format=json'],
        services,
      );
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      try {
        const plugins = JSON.parse(result.stdout || '[]');
        if (plugins.length === 0) return ok('No plugins installed.');
        const lines = [`## Plugins (${plugins.length}) — ${target.installName}`];
        for (const p of plugins) {
          const status = p.status === 'active' ? '**active**' : p.status;
          lines.push(`- ${p.name} v${p.version} [${status}]`);
        }
        return ok(lines.join('\n'));
      } catch {
        return ok(result.stdout || 'No plugins found.');
      }
    }

    // Local path
    const check = requireRunning(target.site, services);
    if (check) return check;

    const plugins = await services.localServices!.getPlugins(target.site.id);

    if (plugins.length === 0) {
      return ok('No plugins installed.');
    }

    const lines = [`## Plugins (${plugins.length})`];
    for (const p of plugins) {
      const status = p.status === 'active' ? '**active**' : p.status;
      lines.push(`- ${p.name} v${p.version} [${status}]`);
    }

    return ok(lines.join('\n'));
  },
};
