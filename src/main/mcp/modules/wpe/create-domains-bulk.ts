import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const createDomainsBulkHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_domains_bulk',
    description: 'Add multiple domains to a WP Engine install at once.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of domain names to add',
        },
      },
      required: ['install_id', 'domains'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const domains = args.domains as string[];

      await services.localServices!.capiDirect(
        `/installs/${args.install_id}/domains/bulk`,
        'POST',
        { domains: domains.map((name) => ({ name })) },
      ) as any;

      return ok(
        `## Domains Added\n\n` +
        `Successfully added ${domains.length} domain(s) to install \`${args.install_id}\`:\n\n` +
        domains.map((d) => `- ${d}`).join('\n'),
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
