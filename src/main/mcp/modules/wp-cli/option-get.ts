import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error } from './preflight';

export const optionGetHandler: McpToolHandler = {
  definition: {
    name: 'wp_option_get',
    description: 'Get a WordPress option value (e.g. blogname, siteurl).',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        option: { type: 'string', description: 'Option name (e.g. "blogname", "siteurl")' },
      },
      required: ['site', 'option'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const check = requireRunning(site, services);
    if (check) return check;

    const option = args.option as string;
    if (!option) return error('Option name is required.');

    const value = await services.localServices!.getOption(site.id, option);
    if (value === null) {
      return error(`Option "${option}" not found.`);
    }

    return ok(`${option}: ${value}`);
  },
};
