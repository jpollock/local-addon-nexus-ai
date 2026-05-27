import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error } from './preflight';
import { withSiteRunning } from '../with-site-running';

export const dbExportHandler: McpToolHandler = {
  definition: {
    name: 'wp_db_export',
    description:
      'Export the WordPress database to a SQL dump file. ' +
      'LOCAL SITES ONLY — use wpe_create_backup for remote WPE database exports. ' +
      'Site must be running. Output path defaults to ~/Desktop/{site}-{timestamp}.sql if not specified.',
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

    return withSiteRunning(site.id, services, async () => {
      const destination = args.destination as string | undefined;
      const dumpPath = await services.localServices!.dumpDatabase(site.id, destination);

      return ok(`Database exported to: ${dumpPath}`);
    });
  },
};
