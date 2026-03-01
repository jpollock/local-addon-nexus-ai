import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const optionGetHandler: McpToolHandler = {
  definition: {
    name: 'wp_option_get',
    description: 'Get a WordPress option value (e.g. blogname, siteurl).',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        option: { type: 'string', description: 'Option name (e.g. "blogname", "siteurl")' },
      },
      required: ['option'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const option = args.option as string;
    if (!option) return error('Option name is required.');

    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, ['option', 'get', option], services);
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      return ok(`${option}: ${result.stdout?.trim() ?? '(empty)'}`);
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    const value = await services.localServices!.getOption(target.site.id, option);
    if (value === null) {
      return error(`Option "${option}" not found.`);
    }

    return ok(`${option}: ${value}`);
  },
};
