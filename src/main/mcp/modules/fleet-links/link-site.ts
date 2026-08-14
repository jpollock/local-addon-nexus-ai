import type { McpToolHandler } from '../../types';

export const linkSiteHandler: McpToolHandler = {
  definition: {
    name: 'nexus_link_site',
    description:
      'Link a local site to a WP Engine install as its sandbox. Use when automatic resolution ' +
      'failed — a renamed install, a restored backup, or a cloned site. A link made this way is ' +
      'authoritative and will never be overwritten by automatic resolution.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site ID' },
        install_id: { type: 'string', description: 'WP Engine install ID' },
        install_name: { type: 'string', description: 'WP Engine install name' },
      },
      required: ['site', 'install_id', 'install_name'],
    },
  },
  async execute(args, services) {
    const resolver = services.siteLinkResolver;
    const site = args.site as string | undefined;
    const installId = args.install_id as string | undefined;
    const installName = args.install_name as string | undefined;

    if (!resolver) {
      return { content: [{ type: 'text', text: 'Site link resolver is not available.' }], isError: true };
    }
    if (!site || !installId || !installName) {
      return {
        content: [{ type: 'text', text: 'site, install_id and install_name are all required.' }],
        isError: true,
      };
    }

    resolver.setManualLink(site, installId, installName);
    return { content: [{ type: 'text', text: `Linked ${site} to install ${installName} (${installId}).` }] };
  },
};
