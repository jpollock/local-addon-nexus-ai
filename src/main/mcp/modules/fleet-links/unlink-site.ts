import type { McpToolHandler } from '../../types';

export const unlinkSiteHandler: McpToolHandler = {
  definition: {
    name: 'nexus_unlink_site',
    description:
      'Remove the link between a local site and its WP Engine install. Automatic resolution ' +
      'will be free to run again for this site.',
    inputSchema: {
      type: 'object',
      properties: { site: { type: 'string', description: 'Local site ID' } },
      required: ['site'],
    },
  },
  async execute(args, services) {
    const resolver = services.siteLinkResolver;
    const site = args.site as string | undefined;

    if (!resolver) {
      return { content: [{ type: 'text', text: 'Site link resolver is not available.' }], isError: true };
    }
    if (!site) {
      return { content: [{ type: 'text', text: 'site is required.' }], isError: true };
    }

    resolver.clearLink(site);
    return { content: [{ type: 'text', text: `Unlinked ${site}.` }] };
  },
};
