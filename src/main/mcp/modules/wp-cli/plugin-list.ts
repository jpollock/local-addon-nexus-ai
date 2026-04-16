import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';
import { cachedDataNote, haltedNoDataError } from './twin-fallback';

export const pluginListHandler: McpToolHandler = {
  definition: {
    name: 'wp_plugin_list',
    description:
      'List all installed WordPress plugins with name, version, and status. ' +
      'Works on local sites (site=) and remote WPE installs via SSH (install_name=). ' +
      'Use this before wp_plugin_update to see what needs updating, ' +
      'or before wp_plugin_install to check if a plugin already exists.',
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

    // Local path — check if running; fall back to twin if halted
    const siteStatus = services.localServices!.getSiteStatus(target.site.id);
    if (siteStatus !== 'running') {
      const twin = services.twinService?.get(target.site.id);
      if (twin?.plugins?.length) {
        const note = cachedDataNote(twin.asOf ?? Date.now(), target.site.name);
        const lines = [note, `## Plugins (${twin.plugins.length})`];
        for (const p of twin.plugins) {
          const pStatus = p.status === 'active' ? '**active**' : (p.status ?? 'unknown');
          lines.push(`- ${p.name}${p.version ? ` v${p.version}` : ''} [${pStatus}]`);
        }
        return ok(lines.join('\n'));
      }
      return error(haltedNoDataError(target.site.name));
    }

    const plugins = await services.localServices!.getPlugins(target.site.id);

    if (plugins.length === 0) {
      return ok('No plugins installed.');
    }

    const lines = [`## Plugins (${plugins.length})`];
    for (const p of plugins) {
      const pStatus = p.status === 'active' ? '**active**' : p.status;
      lines.push(`- ${p.name} v${p.version} [${pStatus}]`);
    }

    return ok(lines.join('\n'));
  },
};
