import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';
import { waitForDatabaseReady } from '../with-site-running';
import * as path from 'path';
import * as os from 'os';

export const exportSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_export_site',
    description:
      'Export a local WordPress site to a zip archive (files + database). ASYNC: returns immediately. Poll local_operation_status every 20s until complete. The zip path is returned when done — it goes to ~/Downloads by default or the specified output_path. Use this BEFORE local_wpe_pull (to backup the current local state) or before bulk plugin updates (as a rollback point). The zip is compatible with local_import_site for restoration.' +
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

    const rawDir = (args.output_path as string) || path.join(os.homedir(), 'Downloads');
    // Expand ~ — agents often pass ~/Desktop/... which Node won't expand automatically
    const outputDir = rawDir.startsWith('~') ? path.join(os.homedir(), rawDir.slice(1)) : rawDir;
    const outputFile = path.join(outputDir, `${site.name}.zip`);

    const ls = services.localServices!;

    // Auto-start if halted — mysqldump needs a running MySQL server.
    // Unlike synchronous tools, export is fire-and-forget, so we CANNOT use
    // withSiteRunning (it would stop the site the moment exportSite() returns,
    // while the worker is still zipping files in the background).
    // Instead we auto-start here and thread the auto-stop into the callbacks.
    const statuses = ls.getAllSiteStatuses() as Record<string, string>;
    const wasRunning = statuses[site.id] === 'running';

    if (!wasRunning) {
      services.logger.info(`[local_export_site] Site ${site.id} is halted — auto-starting for export`);
      await ls.startSite(site.id);
      await waitForDatabaseReady(site.id, services);
    }

    // Register with tracker so local_operation_status can report progress
    services.operationTracker?.register(site.id, site.name, 'export');

    // Fire-and-forget — zip creation blocks for minutes on large sites.
    // Auto-stop the site (if we started it) only AFTER the worker finishes.
    ls.exportSite(site.id, outputFile)
      .then(() => {
        services.operationTracker?.complete(site.id, `Exported to ${outputFile}`);
        if (!wasRunning) {
          services.logger.info(`[local_export_site] Export complete — auto-stopping site ${site.id}`);
          ls.stopSite(site.id).catch((e: Error) => {
            services.logger.error(`[local_export_site] Failed to auto-stop site ${site.id}: ${e.message}`);
          });
        }
      })
      .catch((err: Error) => {
        services.operationTracker?.fail(site.id, err.message);
        if (!wasRunning) {
          ls.stopSite(site.id).catch(() => { /* best effort */ });
        }
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
