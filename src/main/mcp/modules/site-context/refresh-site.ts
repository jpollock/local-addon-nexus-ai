/**
 * nexus_site_refresh — refresh the digital twin for one site.
 *
 * Runs a filesystem scan (always) followed by a WP-CLI enrichment if the
 * site is currently running. Updates SiteMetadataCache in place.
 *
 * Safe to call repeatedly — idempotent. Skips WP-CLI enrichment if a full
 * scan is less than 4 hours old (matches StartupSiteScanner behaviour).
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { StartupSiteScanner } from '../../../startup/StartupSiteScanner';

export const refreshSiteHandler: McpToolHandler = {
  definition: {
    name: 'nexus_site_refresh',
    description:
      'Refresh the cached data (digital twin) for a single Local site. ' +
      'Always runs a filesystem scan to update WP version and installed plugins/themes. ' +
      'If the site is running, also enriches with WP-CLI data: active plugin/theme status, ' +
      'post counts, admin email, site URL. ' +
      'Use before asking questions about a halted or recently-changed site.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
        force: {
          type: 'boolean',
          description: 'Force WP-CLI enrichment even if a recent full scan exists. Default: false',
        },
      },
      required: ['site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      return error(`Site "${args.site}" not found`);
    }

    const metadataCache = services.metadataCache;
    if (!metadataCache) {
      return error('Metadata cache not available');
    }

    const localServices = services.localServices;
    if (!localServices) {
      return error('Local services not available');
    }

    const existingBefore = metadataCache.get(site.id);
    const depthBefore = existingBefore?.scanDepth ?? 'none';

    // If force=true, temporarily invalidate the full scan age check by clearing scanDepth
    if (args.force && existingBefore) {
      metadataCache.update(site.id, { scanDepth: 'filesystem' });
    }

    const siteStatus = localServices.getSiteStatus(site.id);
    const isRunning  = siteStatus === 'running';

    const scanner = new StartupSiteScanner({
      getAllSites: () => [{ id: site.id, name: site.name, path: site.path }],
      getRunningSiteIds: () => isRunning ? [site.id] : [],
      localServices,
      metadataCache,
      logger: { info: services.logger.info.bind(services.logger), warn: services.logger.error.bind(services.logger), error: services.logger.error.bind(services.logger) },
    });

    await scanner.scan();

    const after = metadataCache.getWithAge(site.id);
    const depthAfter = after?.scanDepth ?? 'unknown';
    const ageStr = metadataCache.getAgeString(site.id);

    const lines: string[] = [];
    lines.push(`## ${site.name} — twin refreshed`);
    lines.push('');
    lines.push(`**Scan depth:** ${depthBefore} → ${depthAfter}`);
    lines.push(`**Last updated:** ${ageStr}`);
    lines.push(`**Site status:** ${isRunning ? 'running (WP-CLI available)' : 'halted (filesystem only)'}`);

    if (after) {
      lines.push('');
      lines.push('**Data now available:**');
      if (after.wpVersion)      lines.push(`- WordPress: ${after.wpVersion}`);
      if (after.phpVersion)     lines.push(`- PHP: ${after.phpVersion}`);
      if (after.plugins?.length) lines.push(`- Plugins: ${after.plugins.length} (with active/inactive status)`);
      else if (after.installedPlugins?.length) lines.push(`- Installed plugins: ${after.installedPlugins.length} (no status — site halted)`);
      if (after.themes?.length) lines.push(`- Themes: ${after.themes.length} (with active/inactive status)`);
      else if (after.installedThemes?.length) lines.push(`- Installed themes: ${after.installedThemes.length} (no status — site halted)`);
      if (after.postCount != null) lines.push(`- Posts: ${after.postCount} published`);
      if (after.activeTheme)    lines.push(`- Active theme: ${after.activeTheme}`);
    }

    if (!isRunning && depthAfter === 'filesystem') {
      lines.push('');
      lines.push('_Start the site and run refresh again to get plugin status, post counts, and more._');
    }

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
