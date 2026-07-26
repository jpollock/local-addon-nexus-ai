import { McpToolHandler, McpToolResult } from '../../types';
import { ok } from '../wp-cli/preflight';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { IwSiteBinding } from '../../../../common/types';

export const iwFleetStatusHandler: McpToolHandler = {
  definition: {
    name: 'iw_fleet_status',
    description:
      'Show IW connection status across all local sites — which sites are connected to ' +
      'a Power project, their project ID, and when they connected. Reads from stored ' +
      'bindings (no WP-CLI calls). Sites not yet connected are shown as Not connected.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(_args, services): Promise<McpToolResult> {
    const { registryStorage, siteData } = services;
    const bindings = (registryStorage!.get(STORAGE_KEYS.IW_SITE_BINDINGS) ?? {}) as Record<string, IwSiteBinding>;
    const sites = Object.values(siteData.getSites());

    const lines: string[] = ['IW Fleet Status:'];
    let connectedCount = 0;

    for (const site of sites) {
      const binding = bindings[site.id];
      if (binding?.projectId) {
        connectedCount++;
        const connectedAt = new Date(binding.connectedAt).toISOString().split('T')[0];
        lines.push(`  ✓ ${site.name.padEnd(30)} ${binding.projectId}  (connected ${connectedAt})`);
      } else {
        lines.push(`  ○ ${site.name}`);
      }
    }

    lines.push(`\n${connectedCount}/${sites.length} sites connected to Power.`);
    return ok(lines.join('\n'));
  },
};
