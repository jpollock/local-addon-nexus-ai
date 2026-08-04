import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { cachedDataNote, haltedNoDataError } from './twin-fallback';
import { freshnessFooter } from '../../../twin/twin-helpers';

export const themeListHandler: McpToolHandler = {
  definition: {
    name: 'wp_theme_list',
    description: 'List all installed WordPress themes with name, version, and active/inactive status. Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). Use to confirm which theme is active, find outdated themes, or audit installed themes before removal.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        ssh_target: {
          type: 'string',
          description: 'External SSH host, as ssh:<alias>@<production|staging|development>. The alias is a Host entry in the user\'s ~/.ssh/config. Register one with `nexus host add`.',
        },
        wp_path: {
          type: 'string',
          description: 'Absolute WordPress root on an external host. Usually unnecessary — a registered host supplies its own discovered path.',
        },
      },
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const transport = await resolveTransport(args, services, 'wpcli_read');
    if ('content' in transport) return transport;

    const executeCommand = async (): Promise<McpToolResult> => {
      // Remote: always call WP-CLI
      if (transport.kind === 'wpe-ssh' && transport.siteRef.kind === 'wpe') {
        const result = await transport.runWpCli(['theme', 'list', '--format=json']);
        if (!result.success) {
          return error(`Remote WP-CLI error: ${result.stdout}`);
        }
        try {
          const themes = JSON.parse(result.stdout || '[]');
          if (themes.length === 0) return ok('No themes installed.');
          const lines = [`## Themes (${themes.length}) — ${transport.siteRef.installName}`];
          for (const t of themes) {
            const status = t.status === 'active' ? '**active**' : t.status;
            lines.push(`- ${t.name} v${t.version} [${status}]`);
          }
          return ok(lines.join('\n'));
        } catch {
          return ok(result.stdout || 'No themes found.');
        }
      }

      // Local: check if running; fall back to twin if halted
      const siteId = transport.siteRef.kind === 'local' ? transport.siteRef.siteId : '';
      const siteStatus = services.localServices!.getSiteStatus(siteId);
      if (siteStatus !== 'running') {
        const twin = services.twinService?.get(siteId);
        if (twin?.themes?.length) {
          const check = services.twinService?.canAnswer?.(twin, 'themes');
          if (check && !check.can) {
            return error(`No cached theme data for ${transport.siteRef.kind === 'local' ? transport.siteRef.siteName : 'site'}. ${check.reason ?? ''}`);
          }
          const lines: string[] = [];
          if (check?.confidence === 'stale' && check.reason) {
            lines.push(`> ⚠️ ${check.reason}`);
          } else {
            lines.push(cachedDataNote(twin.asOf ?? Date.now(), transport.siteRef.kind === 'local' ? transport.siteRef.siteName : 'site'));
          }
          lines.push(`## Themes (${twin.themes.length})`);
          for (const t of twin.themes) {
            const tStatus = t.status === 'active' ? '**active**' : (t.status ?? 'unknown');
            lines.push(`- ${t.name}${t.version ? ` v${t.version}` : ''} [${tStatus}]`);
          }
          const footer = freshnessFooter(twin);
          if (footer) { lines.push(''); lines.push(footer); }
          return ok(lines.join('\n'));
        }
        return error(haltedNoDataError(transport.siteRef.kind === 'local' ? transport.siteRef.siteName : 'site'));
      }

      const themes = await services.localServices!.getThemes(siteId);

      if (themes.length === 0) {
        return ok('No themes installed.');
      }

      const lines = [`## Themes (${themes.length})`];
      for (const t of themes) {
        const tStatus = t.status === 'active' ? '**active**' : t.status;
        lines.push(`- ${t.name} v${t.version} [${tStatus}]`);
      }

      return ok(lines.join('\n'));
    };

    // Note: twin fallback already handles halted case, so no withSiteRunning wrapper needed
    return executeCommand();
  },
};
