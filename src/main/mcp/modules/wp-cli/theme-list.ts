import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';
import { cachedDataNote, haltedNoDataError } from './twin-fallback';
import { freshnessFooter } from '../../../twin/twin-helpers';

export const themeListHandler: McpToolHandler = {
  definition: {
    name: 'wp_theme_list',
    description: 'List all installed WordPress themes with name, version, and active/inactive status. Works on local sites (site=) and remote WPE installs via SSH (install_name=). Use to confirm which theme is active, find outdated themes, or audit installed themes before removal.',
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
    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(
        target.installName,
        ['theme', 'list', '--format=json'],
        services,
      );
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      try {
        const themes = JSON.parse(result.stdout || '[]');
        if (themes.length === 0) return ok('No themes installed.');
        const lines = [`## Themes (${themes.length}) — ${target.installName}`];
        for (const t of themes) {
          const status = t.status === 'active' ? '**active**' : t.status;
          lines.push(`- ${t.name} v${t.version} [${status}]`);
        }
        return ok(lines.join('\n'));
      } catch {
        return ok(result.stdout || 'No themes found.');
      }
    }

    // Local path — check if running; fall back to twin if halted
    const siteStatus = services.localServices!.getSiteStatus(target.site.id);
    if (siteStatus !== 'running') {
      const twin = services.twinService?.get(target.site.id);
      if (twin?.themes?.length) {
        const check = services.twinService?.canAnswer?.(twin, 'themes');
        if (check && !check.can) {
          return error(`No cached theme data for ${target.site.name}. ${check.reason ?? ''}`);
        }
        const lines: string[] = [];
        if (check?.confidence === 'stale' && check.reason) {
          lines.push(`> ⚠️ ${check.reason}`);
        } else {
          lines.push(cachedDataNote(twin.asOf ?? Date.now(), target.site.name));
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
      return error(haltedNoDataError(target.site.name));
    }

    const themes = await services.localServices!.getThemes(target.site.id);

    if (themes.length === 0) {
      return ok('No themes installed.');
    }

    const lines = [`## Themes (${themes.length})`];
    for (const t of themes) {
      const tStatus = t.status === 'active' ? '**active**' : t.status;
      lines.push(`- ${t.name} v${t.version} [${tStatus}]`);
    }

    return ok(lines.join('\n'));
  },
};
