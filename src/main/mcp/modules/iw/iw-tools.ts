import { McpToolHandler, McpToolResult } from '../../types';
import { resolveLocalSite } from '../../site-resolver';
import { requireRunning, ok, error } from '../wp-cli/preflight';
import {
  detectHubPlugin,
  installHubPlugin,
  getConnectionStatus,
  readIwBinding,
  clearIwBinding,
} from './hub-connect';

export const iwGetConnectionStatusHandler: McpToolHandler = {
  definition: {
    name: 'iw_get_connection_status',
    description:
      'Get the WP Engine Intelligent Web (Hub Plugin) connection status for a local site — ' +
      'whether the Hub Plugin is installed, whether the site is connected to a Power project, ' +
      'and the project/client/account IDs. Use before iw_connect_site to check current state.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { localServices, registryStorage } = services;
    const site = resolveLocalSite(args.site as string, services.siteData, services.graphService);
    if (!site) return error(`Site not found: ${args.site}`);

    const status = await getConnectionStatus(site.id, localServices!);
    const binding = readIwBinding(site.id, registryStorage!);

    const lines: string[] = [`IW Status — ${site.name}:`];
    lines.push(`  Hub Plugin:  ${status.hubInstalled ? 'installed' : 'not installed'}`);
    if (status.copyReset) lines.push('  ⚠ Connection reset (site was copied) — reconnect needed');
    lines.push(`  Connected:   ${status.connected ? 'yes' : 'no'}`);
    if (status.connected) {
      lines.push(`  Project ID:  ${status.projectId ?? '(project picker pending)'}`);
      lines.push(`  Account ID:  ${status.accountId ?? '(lazy — populated on first token use)'}`);
      lines.push(`  Client ID:   ${status.clientId}`);
    }
    if (binding?.connectedAt) {
      lines.push(`  Bound at:    ${new Date(binding.connectedAt).toISOString()}`);
    }

    return ok(lines.join('\n'));
  },
};

export const iwConnectSiteHandler: McpToolHandler = {
  definition: {
    name: 'iw_connect_site',
    description:
      'Install the Hub Plugin (if needed) and open the WP-admin Hub settings page in the browser ' +
      'so the user can complete the OAuth flow to connect the site to a WP Engine Power project. ' +
      'After calling this, poll iw_get_connection_status to detect completion. LOCAL SITES ONLY — site must be running.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { localServices } = services;
    const site = resolveLocalSite(args.site as string, services.siteData, services.graphService);
    if (!site) return error(`Site not found: ${args.site}`);

    const runCheck = requireRunning(site, services);
    if (runCheck) return runCheck;

    const siteObj = localServices!.resolveSiteObject(site.id) as any;
    const webRoot: string = siteObj?.paths?.webRoot ?? '';
    const hubInstalled = webRoot ? detectHubPlugin(webRoot) : false;

    if (!hubInstalled) {
      const installResult = await installHubPlugin(site.id, localServices!);
      if (!installResult.ok) return error(installResult.error ?? 'Hub Plugin install failed');
    }

    const siteUrl: string = siteObj?.url || `http://${site.domain}`;
    const hubAdminUrl = `${siteUrl}/wp-admin/admin.php?page=wpe-hub-settings`;

    const { shell } = await import('electron');
    shell.openExternal(hubAdminUrl);

    return ok(
      `Hub settings page opened: ${hubAdminUrl}\n` +
      `${hubInstalled ? '' : 'Hub Plugin was installed and activated.\n'}` +
      'Complete the "Connect to WP Engine" OAuth flow in your browser, then call ' +
      'iw_get_connection_status to confirm the connection.',
    );
  },
};

export const iwDisconnectSiteHandler: McpToolHandler = {
  definition: {
    name: 'iw_disconnect_site',
    description:
      'Disconnect a local site from its WP Engine Power project. ' +
      'Clears the Nexus-side binding and (if the site is running) the wpe_auth_* options in WordPress. ' +
      'The Hub Plugin remains installed — only the connection is cleared.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { localServices, registryStorage } = services;
    const site = resolveLocalSite(args.site as string, services.siteData, services.graphService);
    if (!site) return error(`Site not found: ${args.site}`);

    clearIwBinding(site.id, registryStorage!);

    if (localServices!.getSiteStatus(site.id) === 'running') {
      await localServices!.wpCliRun(site.id, [
        'eval',
        `if (class_exists('WpeAuthCore')) { WpeAuthCore::clear_registration(); } delete_option('wpe_auth_copy_detected');`,
      ]).catch(() => {});
    }

    return ok(`${site.name} disconnected from WP Engine Power. Hub Plugin remains installed.`);
  },
};
