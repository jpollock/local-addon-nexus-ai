import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const coreUpdateHandler: McpToolHandler = {
  definition: {
    name: 'wp_core_update',
    description:
      'Update WordPress core to the latest version (or a specific version). ' +
      'Run wp_core_version first to see the current version. ' +
      'After updating core, re-run wp_plugin_update --all to catch any plugins blocked by WP version requirements.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        version: {
          type: 'string',
          description: 'Specific version to update to (e.g. "6.9.4"). Omit for latest.',
        },
        force: {
          type: 'boolean',
          description: 'Force update even if already on the target version. Default: false.',
        },
      },
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    const cliArgs = ['core', 'update'];
    if (args.version) cliArgs.push(`--version=${args.version}`);
    if (args.force) cliArgs.push('--force');

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, cliArgs, services);
      if (!result.success) return error(`Failed to update WP core on ${target.installName}: ${result.stdout}`);
      return ok(result.stdout || `WordPress core updated on ${target.installName}.`);
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    // Core update downloads from WordPress.org — allow up to 3 minutes
    const result = await services.localServices!.wpCliRun(target.site.id, cliArgs, { timeoutMs: 180000 });
    if (!result.success) return error(`Failed to update WP core: ${result.stdout}`);

    return ok(result.stdout || 'WordPress core updated.');
  },
};
