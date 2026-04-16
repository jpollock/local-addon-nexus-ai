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
    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    if (target.type === 'remote') {
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
        const note = cachedDataNote(twin.asOf ?? Date.now(), target.site.name);
        const footer = freshnessFooter(twin);
        const parts = [`${note}\nWordPress ${twin.wpVersion}`];
        if (footer) parts.push(footer);
        return ok(parts.join('\n'));
      }
      return error(haltedNoDataError(target.site.name));
    }

    const version = await services.localServices!.getWpVersion(target.site.id);
    return ok(`WordPress ${version ?? 'unknown'}`);
  },
};
