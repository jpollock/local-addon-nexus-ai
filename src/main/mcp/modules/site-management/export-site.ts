import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';
import * as path from 'path';
import * as os from 'os';

export const exportSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_export_site',
    description:
      'Export a local WordPress site to a zip archive. ' +
      'Returns immediately with status "in_progress" — the zip is created in the background. ' +
      'Poll local_operation_status to track progress and get the final file path when done.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        output_path: { type: 'string', description: 'Output directory path. Defaults to ~/Downloads.' },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const outputDir = (args.output_path as string) || path.join(os.homedir(), 'Downloads');
    const outputFile = path.join(outputDir, `${site.name}.zip`);

    // Register with tracker so local_operation_status can report progress
    services.operationTracker?.register(site.id, site.name, 'export');

    // Fire-and-forget — zip creation blocks for minutes on large sites.
    // Return immediately and let the agent poll local_operation_status.
    services.localServices!.exportSite(site.id, outputFile)
      .then(() => {
        services.operationTracker?.complete(site.id, `Exported to ${outputFile}`);
      })
      .catch((err: Error) => {
        services.operationTracker?.fail(site.id, err.message);
      });

    return ok(
      JSON.stringify({
        status: 'in_progress',
        site: site.name,
        output_file: outputFile,
        message: `Export started. The zip will be created at ${outputFile}.`,
        next_steps: 'Poll local_operation_status every 15-30s. When completed, the zip is ready.',
      }, null, 2),
    );
  },
};
