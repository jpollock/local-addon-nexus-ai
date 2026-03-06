import { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const manageSiteGroupHandler: McpToolHandler = {
  definition: {
    name: 'manage_site_group',
    description:
      'Create, rename, or delete site groups. Also move sites between groups.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'The action to perform',
          enum: ['create', 'rename', 'delete', 'add_site', 'remove_site'],
        },
        group_id: { type: 'string', description: 'Group ID (required for rename/delete/add_site/remove_site)' },
        name: { type: 'string', description: 'Group name (required for create and rename)' },
        site_id: { type: 'string', description: 'Site ID (required for add_site/remove_site)' },
      },
      required: ['action'],
    },
    annotations: { title: 'Manage Site Group', readOnlyHint: false },
  },

  async execute(args, services): Promise<McpToolResult> {
    const bridge = services.localServices;
    if (!bridge?.getSiteGroups) return ok('Site groups are not available.');

    const action = args.action as string;

    switch (action) {
      case 'create': {
        const name = args.name as string;
        if (!name) return ok('Name is required for creating a group.');
        try {
          const group = bridge.createSiteGroup(name);
          return ok(`Group "${group.name}" created (ID: ${group.id}).`);
        } catch (err: any) {
          return ok(`Failed to create group: ${err.message}`);
        }
      }

      case 'rename': {
        const groupId = args.group_id as string;
        const name = args.name as string;
        if (!groupId) return ok('group_id is required for rename.');
        if (!name) return ok('name is required for rename.');
        try {
          const group = bridge.renameSiteGroup(groupId, name);
          return ok(`Group renamed to "${group.name}".`);
        } catch (err: any) {
          return ok(`Failed to rename group: ${err.message}`);
        }
      }

      case 'delete': {
        const groupId = args.group_id as string;
        if (!groupId) return ok('group_id is required for delete.');
        try {
          bridge.deleteSiteGroup(groupId);
          return ok('Group deleted. Sites moved to default group.');
        } catch (err: any) {
          return ok(`Failed to delete group: ${err.message}`);
        }
      }

      case 'add_site': {
        const groupId = args.group_id as string;
        const siteId = args.site_id as string;
        if (!groupId || !siteId) return ok('group_id and site_id are required.');
        try {
          bridge.moveSitesToGroup([siteId], groupId);
          return ok(`Site moved to group.`);
        } catch (err: any) {
          return ok(`Failed to move site: ${err.message}`);
        }
      }

      case 'remove_site': {
        const siteId = args.site_id as string;
        if (!siteId) return ok('site_id is required.');
        try {
          bridge.removeSitesFromGroups([siteId]);
          return ok(`Site removed from its group.`);
        } catch (err: any) {
          return ok(`Failed to remove site: ${err.message}`);
        }
      }

      default:
        return ok(`Unknown action: ${action}. Use: create, rename, delete, add_site, remove_site.`);
    }
  },
};
