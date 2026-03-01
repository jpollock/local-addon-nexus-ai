import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const coreVersionHandler: McpToolHandler = {
  definition: {
    name: 'wp_core_version',
    description: 'Get the WordPress core version for a local site or remote WPE install.',
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
      const result = await remoteWpCliRun(target.installName, ['core', 'version'], services);
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      return ok(`WordPress ${result.stdout?.trim() ?? 'unknown'}`);
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    const version = await services.localServices!.getWpVersion(target.site.id);
    return ok(`WordPress ${version ?? 'unknown'}`);
  },
};
