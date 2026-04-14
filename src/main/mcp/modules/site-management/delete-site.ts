import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const deleteSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_delete_site',
    description:
      'Tier 3 (destructive) — permanently delete a local WordPress site including all files and database. Requires confirmation token: call once to get the token, call again with _confirmationToken to proceed. trash_files=true (default) sends files to the OS trash; trash_files=false deletes immediately. WPE links are removed — this does NOT affect the linked WPE install. Export the site first with local_export_site if you need a backup.' +
      'and requires confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        trash_files: {
          type: 'boolean',
          description: 'Move files to trash instead of permanent delete. Defaults to true.',
        },
        _confirmationToken: { type: 'string', description: 'Confirmation token for Tier 3 operations' },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const trashFiles = args.trash_files !== false; // default true
    await services.localServices!.deleteSite(site.id, trashFiles);

    return ok(`Site "${site.name}" deleted${trashFiles ? ' (files moved to trash)' : ' permanently'}.`);
  },
};
