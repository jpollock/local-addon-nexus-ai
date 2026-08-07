import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const wpeLinkHandler: McpToolHandler = {
  definition: {
    name: 'local_wpe_link',
    description:
      'Check whether a local site is linked to a WP Engine install. ' +
      'A link enables local_wpe_pull and local_wpe_push between the two environments. ' +
      'Read-only — does not create or modify links. ' +
      'To link a site: use Local\'s Connect UI or provide remote_install_id when calling local_wpe_pull. ' +
      'Use nexus_list_sites to see all linked pairs at a glance.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    // Check the raw site object for host connections
    const rawSite = services.localServices!.resolveSiteObject(site.id) as any;
    const connections = rawSite?.hostConnections;

    if (!connections || Object.keys(connections).length === 0) {
      return ok(`Site "${site.name}" is not linked to any WP Engine environment.`);
    }

    // Resolve install UUID → install name via graph.db when installName is absent
    const db = (services as any).graphService?.getDb?.();
    const resolveByInstallId = (uuid: string): string | null => {
      if (!db || !uuid) return null;
      try {
        const row = db.prepare(
          `SELECT name FROM sites WHERE source = 'wpe' AND remote_install_id = ? LIMIT 1`
        ).get(uuid) as { name: string } | undefined;
        return row?.name ?? null;
      } catch { return null; }
    };

    // `remoteSiteId` is a WPE *Site* UUID, not an install UUID — one Site commonly has
    // production, staging and development as siblings all sharing it (confirmed live: NitroPack
    // has three installs under one wpe_site_id). Without the environment filter this returns
    // whichever sibling SQLite hands back first for a bare `wpe_site_id = ?`, which is exactly
    // how a local site named "NitroPack Production", genuinely connected to the production
    // install per Local's own Pull-to-Local UI, got reported as linked to "nitropackstg"
    // (staging) instead — silently, with no error, feeding wrong log/attack data into every
    // downstream check that trusted this resolution. `hostConnections` already carries
    // `remoteSiteEnv` for exactly this — it was just never read.
    const resolveBySiteId = (uuid: string, environment?: string): string | null => {
      if (!db || !uuid) return null;
      try {
        if (environment) {
          const scoped = db.prepare(
            `SELECT name FROM sites WHERE source = 'wpe' AND wpe_site_id = ? AND environment = ? LIMIT 1`
          ).get(uuid, environment) as { name: string } | undefined;
          if (scoped?.name) return scoped.name;
        }
        // No environment to filter by, or no row matched it — fall back to the ambiguous
        // lookup rather than reporting nothing; a possibly-wrong sibling still beats silence
        // for a read-only "is this linked at all" check, but callers that need to be SURE
        // which environment must pass remoteSiteEnv.
        const row = db.prepare(
          `SELECT name FROM sites WHERE source = 'wpe' AND wpe_site_id = ? LIMIT 1`
        ).get(uuid) as { name: string } | undefined;
        return row?.name ?? null;
      } catch { return null; }
    };

    const lines = [`## WPE Link for "${site.name}"`];
    for (const [key, conn] of Object.entries(connections) as [string, any][]) {
      const installName = conn?.installName
        ?? resolveByInstallId(conn?.installId)
        ?? resolveBySiteId(conn?.remoteSiteId, conn?.remoteSiteEnv)
        ?? resolveByInstallId(conn?.remoteSiteId)
        ?? conn?.remoteSiteId
        ?? conn?.name
        ?? JSON.stringify(conn);
      lines.push(`- **${key}:** ${installName}`);
    }

    return ok(lines.join('\n'));
  },
};
