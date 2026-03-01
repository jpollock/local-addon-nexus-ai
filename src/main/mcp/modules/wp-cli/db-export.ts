import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error } from './preflight';

export const dbExportHandler: McpToolHandler = {
  definition: {
    name: 'wp_db_export',
    description: 'Export the WordPress database to a SQL dump file.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        destination: { type: 'string', description: 'Output file path. Optional.' },
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

    const destination = args.destination as string | undefined;
    const dumpPath = await services.localServices!.dumpDatabase(site.id, destination);

    return ok(`Database exported to: ${dumpPath}`);
  },
};
