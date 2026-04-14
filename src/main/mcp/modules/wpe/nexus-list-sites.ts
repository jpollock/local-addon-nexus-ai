import { McpToolHandler, McpToolResult } from '../../types';
import { ok, requireLocalServices } from './helpers';

export const nexusListSitesHandler: McpToolHandler = {
  definition: {
    name: 'nexus_list_sites',
    description:
      'Unified site discovery — lists all local sites and WP Engine environments in a single view, marking linked pairs with ↔. The FIRST tool to call before any workflow involving sites. Returns: local site IDs (used as site= in wp_* tools), WPE install names/IDs (used as remote_install_id= in local_wpe_pull/local_wpe_push — both name and UUID accepted). Never ask the user for a site name or ID — discover them here first.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    // Local sites — build a map of WPE install name → local site name for linkage
    const localSites = Object.values(services.siteData.getSites());
    const statuses = services.localServices!.getAllSiteStatuses();

    // Extract WPE linkage from hostConnections
    // Note: hostConnections stores remoteSiteId (WPE site UUID) + remoteSiteEnv (environment)
    // We'll need to resolve install names from CAPI later
    const localByWpeSite = new Map<string, { siteName: string; env: string }>(); // remoteSiteId → local site info
    for (const s of localSites) {
      const connections = (s as any).hostConnections;
      const connList = connections
        ? (Array.isArray(connections) ? connections : Object.values(connections))
        : [];
      for (const conn of connList) {
        if (conn.hostId === 'wpe' && conn.remoteSiteId) {
          localByWpeSite.set(conn.remoteSiteId, {
            siteName: s.name,
            env: conn.remoteSiteEnv || 'production',
          });
        }
      }
    }

    const localSection = localSites.map((s) => {
      const connections = (s as any).hostConnections;
      const connList = connections
        ? (Array.isArray(connections) ? connections : Object.values(connections))
        : [];
      const wpeConn = connList.find((c: any) => c.hostId === 'wpe');
      return {
        id: s.id,
        name: s.name,
        domain: (s as any).domain ?? 'unknown',
        status: statuses[s.id] ?? 'unknown',
        linkedWpe: wpeConn ? `${wpeConn.remoteSiteId}/${wpeConn.remoteSiteEnv || 'production'}` : null,
        wpeConn, // Keep for later resolution
      };
    });

    // WPE sites + installs (if available)
    // Fetch full site objects to get site.id → installs mapping
    let wpeSection: any[] = [];
    let capiError = '';
    const wpeSites = new Map<string, { name: string; installs: any[] }>(); // siteId → site data

    if (services.localServices!.isCAPIAvailable()) {
      try {
        const sites = await services.localServices!.capiGetSites() as any[];
        if (sites) {
          // Build map of site ID → installs
          for (const site of sites) {
            wpeSites.set(site.id, { name: site.name, installs: site.installs || [] });
          }

          // Flatten installs for display
          for (const site of sites) {
            for (const install of site.installs || []) {
              const linkInfo = localByWpeSite.get(site.id);
              const isLinked = linkInfo && linkInfo.env === install.environment;

              wpeSection.push({
                id: install.id,
                name: install.name,
                environment: install.environment ?? 'unknown',
                siteName: site.name,
                linkedLocal: isLinked ? linkInfo.siteName : null,
              });
            }
          }
        }
      } catch (err: any) {
        capiError = err.message?.includes('error code')
          ? ' (token expired — call wpe_login)'
          : ` (${err.message})`;
      }
    }

    // Build output
    const lines: string[] = [];
    lines.push(`## Fleet (${localSection.length} local, ${wpeSection.length} WPE${capiError})`);
    lines.push('');
    lines.push('Local sites = development copies. WP Engine installs = live environments.');
    lines.push('↔ indicates a linked pair (same site, different environments).');

    if (localSection.length > 0) {
      lines.push('');
      lines.push('### Local Sites');
      const running = localSection.filter((s) => s.status === 'running');
      const halted = localSection.filter((s) => s.status !== 'running');

      for (const s of running) {
        let link = '';
        if (s.wpeConn) {
          const siteData = wpeSites.get(s.wpeConn.remoteSiteId);
          if (siteData) {
            const install = siteData.installs.find((i: any) => i.environment === s.wpeConn.remoteSiteEnv);
            link = install ? ` ↔ wpe:${install.name}` : ` ↔ wpe:${s.wpeConn.remoteSiteId}/${s.wpeConn.remoteSiteEnv}`;
          } else {
            link = ` ↔ wpe:${s.wpeConn.remoteSiteId}/${s.wpeConn.remoteSiteEnv}`;
          }
        }
        lines.push(`- **${s.name}** (${s.domain}) [running]${link}`);
      }
      for (const s of halted) {
        let link = '';
        if (s.wpeConn) {
          const siteData = wpeSites.get(s.wpeConn.remoteSiteId);
          if (siteData) {
            const install = siteData.installs.find((i: any) => i.environment === s.wpeConn.remoteSiteEnv);
            link = install ? ` ↔ wpe:${install.name}` : ` ↔ wpe:${s.wpeConn.remoteSiteId}/${s.wpeConn.remoteSiteEnv}`;
          } else {
            link = ` ↔ wpe:${s.wpeConn.remoteSiteId}/${s.wpeConn.remoteSiteEnv}`;
          }
        }
        lines.push(`- ${s.name} (${s.domain}) [${s.status}]${link}`);
      }
    }

    if (wpeSection.length > 0) {
      lines.push('');
      lines.push('### WP Engine Environments (live fleet)');
      lines.push('Use install name OR id as remote_install_id= in local_wpe_pull/local_wpe_push.');
      for (const i of wpeSection) {
        const link = i.linkedLocal ? ` ↔ local:${i.linkedLocal}` : '';
        lines.push(`- **${i.name}** (${i.siteName}, ${i.environment}, id:${i.id})${link}`);
      }
    }

    if (localSection.length === 0 && wpeSection.length === 0) {
      lines.push('');
      lines.push('No sites found.');
    }

    return ok(lines.join('\n'));
  },
};
