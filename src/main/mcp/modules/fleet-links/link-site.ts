import type { McpToolHandler } from '../../types';

export const linkSiteHandler: McpToolHandler = {
  definition: {
    name: 'nexus_link_site',
    description:
      'Link a local site to a WP Engine install as its sandbox. Use when automatic resolution ' +
      'failed — a renamed install, a restored backup, or a cloned site. The install must already ' +
      'be known to Nexus; its name is read from the install id, not supplied. A link made this ' +
      'way is authoritative and will never be overwritten by automatic resolution. Get install ' +
      'ids from nexus_fleet_list.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site ID' },
        install_id: {
          type: 'string',
          description: 'WP Engine install ID, as shown by nexus_fleet_list',
        },
      },
      required: ['site', 'install_id'],
    },
  },
  async execute(args, services) {
    const resolver = services.siteLinkResolver;
    const site = args.site as string | undefined;
    const installId = args.install_id as string | undefined;

    if (!resolver) {
      return { content: [{ type: 'text', text: 'Site link resolver is not available.' }], isError: true };
    }
    if (!site || !installId) {
      return {
        content: [{ type: 'text', text: 'site and install_id are both required.' }],
        isError: true,
      };
    }

    // A user link is permanently immune to correction by inference, so an
    // unverified id would produce a link that never matches a real install and
    // can never self-heal. The name is worse than the id: Track 3's SSH path is
    // built from it (local+ssh+{name}@{name}.ssh.wpengine.net), so a wrong name
    // is a wrong SSH target. Resolve both from what we actually know.
    const db = services.graphService?.getDb?.();
    if (!db) {
      return {
        content: [{ type: 'text', text: 'The graph database is not available — cannot verify the install id.' }],
        isError: true,
      };
    }

    const row = db
      .prepare("SELECT name FROM sites WHERE source = 'wpe' AND remote_install_id = ?")
      .get(installId) as { name: string } | undefined;

    if (!row) {
      return {
        content: [
          {
            type: 'text',
            text:
              `No WP Engine install with id "${installId}" is known to Nexus. ` +
              'Call nexus_fleet_list for the install ids Nexus has, and run a WPE sync first if ' +
              'the install is new.',
          },
        ],
        isError: true,
      };
    }

    resolver.setManualLink(site, installId, row.name);
    return {
      content: [{ type: 'text', text: `Linked ${site} to install ${row.name} (${installId}).` }],
    };
  },
};
