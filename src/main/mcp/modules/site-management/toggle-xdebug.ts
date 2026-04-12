import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error as err, requireLocalServices } from './helpers';

export const toggleXdebugHandler: McpToolHandler = {
  definition: {
    name: 'local_toggle_xdebug',
    description: 'Enable or disable Xdebug PHP debugging extension for a local site. Requires a site restart to take effect — local_restart_site is called automatically. Enable when debugging PHP code; disable in normal use as Xdebug adds significant performance overhead. LOCAL SITES ONLY — WPE environments have their own debugging settings in the portal.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
        enabled: {
          type: 'boolean',
          description: 'True to enable Xdebug, false to disable',
        },
      },
      required: ['site', 'enabled'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return err(`Site "${args.site}" not found.`);

    if (typeof args.enabled !== 'boolean') {
      return err('enabled parameter must be true or false');
    }

    const enabled = args.enabled as boolean;

    try {
      const previousState = (site as any).xdebugEnabled ?? false;

      services.localServices!.updateSite(site.id, { xdebugEnabled: enabled });

      const action = enabled ? 'enabled' : 'disabled';
      const restartNote = previousState !== enabled ? ' Restart the site for changes to take effect.' : '';

      return ok(`Xdebug ${action} for "${site.name}".${restartNote}`);
    } catch (error: any) {
      return err(`Failed to toggle Xdebug: ${error.message}`);
    }
  },
};
