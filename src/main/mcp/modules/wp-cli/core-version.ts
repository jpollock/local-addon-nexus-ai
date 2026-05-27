import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';
import { cachedDataNote, haltedNoDataError } from './twin-fallback';
import { freshnessFooter } from '../../../twin/twin-helpers';

export const coreVersionHandler: McpToolHandler = {
  definition: {
    name: 'wp_core_version',
    description: 'Get the current WordPress core version. Works on local sites (site=) and remote WPE installs via SSH (install_name=). Use this before wp_core_update to see if an upgrade is available, or to confirm a version after updating. Also returns whether core update is available when site is running.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
      },
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const target = await resolveTarget(args, services, 'wpcli_read');

    // If local site lookup failed, check if the name matches a WPE install in the graph DB.
    // Claude often passes bare names as site= — this recovers gracefully instead of "not found".
    // IMPORTANT: never serve cached data when the original error was an access control block —
    // that would silently bypass the user's permission settings.
    if ('content' in target) {
      const errText = (target.content?.[0] as any)?.text ?? '';
      const isAccessBlocked = errText.includes('Operation blocked') || errText.includes('not permitted');
      if (!isAccessBlocked) {
        const query = (args.site ?? args.install_name) as string | undefined;
        if (query) {
          const db = services.graphService?.getDb?.();
          if (db) {
            try {
              const row = db.prepare(
                "SELECT name, wp_version, last_sync_at FROM sites WHERE source='wpe' AND LOWER(name)=? AND wp_version IS NOT NULL LIMIT 1"
              ).get(query.toLowerCase()) as { name: string; wp_version: string; last_sync_at: number } | undefined;
              if (row?.wp_version) {
                const ageMs = Date.now() - (row.last_sync_at ?? 0);
                const ageHours = Math.floor(ageMs / 3600000);
                const ageNote = ageHours < 1 ? 'synced recently'
                  : ageHours < 24 ? `synced ${ageHours}h ago`
                  : `synced ${Math.floor(ageHours / 24)}d ago`;
                return ok(`WordPress ${row.wp_version} _(${ageNote} — run \`nexus wpe sync\` to refresh)_`);
              }
            } catch { /* graph not ready */ }
          }
        }
      }
      return target; // original error (including access blocked)
    }

    if (target.type === 'remote') {
      // Check graph DB cache first — avoids SSH for data we already have
      const db = services.graphService?.getDb?.();
      if (db) {
        try {
          const row = db.prepare(
            "SELECT wp_version, last_sync_at FROM sites WHERE source='wpe' AND name=? AND wp_version IS NOT NULL LIMIT 1"
          ).get(target.installName) as { wp_version: string; last_sync_at: number } | undefined;
          if (row?.wp_version) {
            const ageMs = Date.now() - (row.last_sync_at ?? 0);
            const ageHours = Math.floor(ageMs / 3600000);
            const ageNote = ageHours < 1 ? 'synced recently'
              : ageHours < 24 ? `synced ${ageHours}h ago`
              : `synced ${Math.floor(ageHours / 24)}d ago`;
            return ok(`WordPress ${row.wp_version} _(${ageNote} — run \`nexus wpe sync\` to refresh)_`);
          }
        } catch { /* graph not ready — fall through to SSH */ }
      }

      const result = await remoteWpCliRun(target.installName, ['core', 'version'], services);
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      return ok(`WordPress ${result.stdout?.trim() ?? 'unknown'}`);
    }

    // Local path — check if running; fall back to twin if halted
    const siteStatus = services.localServices!.getSiteStatus(target.site.id);
    if (siteStatus !== 'running') {
      const twin = services.twinService?.get(target.site.id);
      if (twin?.wpVersion) {
        const lines: string[] = [];
        const check = services.twinService?.canAnswer?.(twin, 'wpVersion');
        if (check && !check.can) {
          return error(`No cached WP version for ${target.site.name}. ${check.reason ?? ''}`);
        }
        if (check?.confidence === 'stale' && check.reason) {
          lines.push(`> ⚠️ ${check.reason}`);
        } else {
          lines.push(cachedDataNote(twin.asOf ?? Date.now(), target.site.name));
        }
        lines.push(`WordPress ${twin.wpVersion}`);
        const footer = freshnessFooter(twin);
        if (footer) lines.push(footer);
        return ok(lines.join('\n'));
      }
      return error(haltedNoDataError(target.site.name));
    }

    const version = await services.localServices!.getWpVersion(target.site.id);
    return ok(`WordPress ${version ?? 'unknown'}`);
  },
};
