import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const exportSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_export_site',
    description: 'Export a local WordPress site to a zip archive.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        output_path: { type: 'string', description: 'Output directory path. Defaults to Downloads.' },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    // outputPath must be a file path, not a directory.
    // Construct full path: directory + site name + .zip
    const outputDir = (args.output_path as string) || require('os').homedir() + '/Downloads';
    const path = require('path');
    const outputPath = path.join(outputDir, `${site.name}.zip`);

    const exportPath = await services.localServices!.exportSite(site.id, outputPath);

    return ok(`Site "${site.name}" exported to: ${exportPath}`);
  },
};
