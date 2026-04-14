import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const updateDomainHandler: McpToolHandler = {
  definition: {
    name: 'wpe_update_domain',
    description: 'Update a domain on a WP Engine install — set it as the primary domain, configure a redirect to another domain, or enable/disable HTTPS enforcement. Use to change the primary domain or set up www → non-www (or vice versa) redirects. Use wpe_get_domains to find the domain_id before updating.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        domain_id: { type: 'string', description: 'Domain ID to update' },
        primary: { type: 'boolean', description: 'Set as the primary domain' },
        redirect_to: { type: 'string', description: 'Domain name to redirect traffic to' },
      },
      required: ['install_id', 'domain_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    if (args.primary === undefined && args.redirect_to === undefined) {
      return error('At least one of "primary" or "redirect_to" must be provided.');
    }

    try {
      const body: Record<string, unknown> = {};
      if (args.primary !== undefined) body.primary = args.primary;
      if (args.redirect_to !== undefined) body.redirect_to = args.redirect_to;

      await services.localServices!.capiDirect(
        `/installs/${args.install_id}/domains/${args.domain_id}`,
        'PATCH',
        body,
      ) as any;

      return ok(`Domain \`${args.domain_id}\` updated successfully on install \`${args.install_id}\`.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
