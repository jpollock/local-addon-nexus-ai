import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, requireLocalServices } from './helpers';

export const createSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_create_site',
    description:
      'Create a new local WordPress site with WordPress pre-installed. ' +
      'Default admin credentials are admin/admin — change immediately for any site that will be pushed to WPE. ' +
      'Optionally specify PHP version; defaults to Local current default. ' +
      'Site is created and started automatically. ' +
      'After creation, run wp_plugin_update --all to ensure plugins are current before doing any WPE pull.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the new site' },
        php_version: { type: 'string', description: 'PHP version (e.g. "8.2"). Optional.' },
      },
      required: ['name'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const name = args.name as string;
    if (!name || !name.trim()) {
      return error('Site name is required.');
    }

    // Resolve php_version prefix ("8.2") to the latest matching installed version ("8.2.30")
    // Local requires an exact version matching its lightning-services directory.
    let phpVersion = args.php_version as string | undefined;
    if (phpVersion) {
      const available = await services.localServices!.getAvailablePhpVersions();
      // Find the highest patch version matching the prefix (e.g. "8.2" → "8.2.30")
      const matches = available
        .filter((v) => v.startsWith(phpVersion!))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (matches.length === 0) {
        const versions = available.join(', ');
        return error(
          `PHP version "${phpVersion}" is not installed in Local. ` +
          `Available versions: ${versions || 'none found — check Local preferences'}`,
        );
      }
      phpVersion = matches[0]; // use the highest matching patch version
    }

    const result = await services.localServices!.createSite({
      name: name.trim(),
      phpVersion,
    });

    return ok(
      `Site created:\n` +
      `- **Name:** ${result.name}\n` +
      `- **Domain:** ${result.domain}\n` +
      `- **ID:** ${result.id}\n` +
      `- **Credentials:** admin / admin`,
    );
  },
};
