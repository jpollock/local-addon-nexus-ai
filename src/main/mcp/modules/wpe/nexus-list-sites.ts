import { McpToolHandler, McpToolResult } from '../../types';
import { ok, requireLocalServices } from './helpers';

export const nexusListSitesHandler: McpToolHandler = {
  definition: {
    name: 'nexus_list_sites',
    description:
      'Unified site discovery. Lists all local sites and WP Engine environments ' +
      'in a single view, linking local sites to their WPE counterparts.',
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
    const localByWpeInstall = new Map<string, string>(); // wpe install name → local site name
    for (const s of localSites) {
      const connections = (s as any).hostConnections;
      const connList = connections
        ? (Array.isArray(connections) ? connections : Object.values(connections))
        : [];
      for (const conn of connList) {
        if (conn.host === 'wpe' && conn.installName) {
          localByWpeInstall.set(conn.installName, s.name);
        }
      }
    }

    const localSection = localSites.map((s) => {
      const connections = (s as any).hostConnections;
      const connList = connections
        ? (Array.isArray(connections) ? connections : Object.values(connections))
        : [];
      const wpeConn = connList.find((c: any) => c.host === 'wpe');
      return {
        id: s.id,
        name: s.name,
        domain: (s as any).domain ?? 'unknown',
        status: statuses[s.id] ?? 'unknown',
        linkedWpe: wpeConn?.installName ?? null,
      };
    });

    // WPE installs (if available)
    let wpeSection: any[] = [];
    let capiError = '';
    if (services.localServices!.isCAPIAvailable()) {
      try {
        const installs = await services.localServices!.capiGetInstalls() as any[];
        if (installs) {
          wpeSection = installs.map((i) => ({
            id: i.id,
            name: i.name,
            environment: i.environment ?? 'unknown',
            linkedLocal: localByWpeInstall.get(i.name) ?? null,
          }));
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
        const link = s.linkedWpe ? ` ↔ wpe:${s.linkedWpe}` : '';
        lines.push(`- **${s.name}** (${s.domain}) [running]${link}`);
      }
      for (const s of halted) {
        const link = s.linkedWpe ? ` ↔ wpe:${s.linkedWpe}` : '';
        lines.push(`- ${s.name} (${s.domain}) [${s.status}]${link}`);
      }
    }

    if (wpeSection.length > 0) {
      lines.push('');
      lines.push('### WP Engine Environments (live fleet)');
      for (const i of wpeSection) {
        const link = i.linkedLocal ? ` ↔ local:${i.linkedLocal}` : '';
        lines.push(`- **${i.name}** (${i.environment})${link}`);
      }
    }

    if (localSection.length === 0 && wpeSection.length === 0) {
      lines.push('');
      lines.push('No sites found.');
    }

    return ok(lines.join('\n'));
  },
};
