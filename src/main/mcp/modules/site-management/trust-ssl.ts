import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const trustSslHandler: McpToolHandler = {
  definition: {
    name: 'local_trust_ssl',
    description: 'Trust the self-signed SSL certificate for a local WordPress site on this machine. Eliminates browser SSL warnings when accessing the site via https. Run once per site on each new machine. Requires admin/sudo password on macOS. This is a local machine setting only — it does not affect other users or WPE environments.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    await services.localServices!.trustCert(site.id);
    return ok(`SSL certificate trusted for "${site.name}".`);
  },
};
