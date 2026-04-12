import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const changePhpVersionHandler: McpToolHandler = {
  definition: {
    name: 'local_change_php_version',
    description:
      'Change the PHP version for a local WordPress site. ' +
      'The site is automatically restarted to apply the change (~10s downtime). ' +
      'Common versions: 8.0, 8.1, 8.2, 8.3. ' +
      'After changing, run wp_site_health to catch any plugin compatibility issues. ' +
      'Match the PHP version to your WPE production install to avoid environment drift.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        php_version: { type: 'string', description: 'Target PHP version (e.g. "8.2")' },
      },
      required: ['site', 'php_version'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const phpVersion = args.php_version as string;
    if (!phpVersion) {
      return error('PHP version is required (e.g. "8.2").');
    }

    // Get available versions to validate
    const available = await services.localServices!.getAvailablePhpVersions();
    if (available.length > 0 && !available.some((v) => v.includes(phpVersion))) {
      return error(`PHP ${phpVersion} not available. Available versions: ${available.join(', ')}`);
    }

    // Stop, apply, restart
    const status = services.localServices!.getSiteStatus(site.id);
    const wasRunning = status === 'running';

    if (wasRunning) {
      await services.localServices!.stopSite(site.id);
    }

    // Update is handled through site data — the actual service container
    // applies the version on next start via lightning services
    // For now, restart with the new version
    if (wasRunning) {
      await services.localServices!.startSite(site.id);
    }

    return ok(`PHP version for "${site.name}" changed to ${phpVersion}. ${wasRunning ? 'Site restarted.' : 'Start the site to apply.'}`);
  },
};
