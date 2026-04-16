/**
 * nexus_site_status — report what's in the digital twin and how fresh it is.
 *
 * Answers: "what do we know about this site, and how old is that knowledge?"
 * Used by other tools before answering questions to surface data quality.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';

export const siteStatusHandler: McpToolHandler = {
  definition: {
    name: 'nexus_site_status',
    description:
      'Show what cached data exists for a Local site (the digital twin) and how fresh it is. ' +
      'Reports scan depth (filesystem vs full), age of each data category, and what is missing. ' +
      'Use to understand data quality before asking questions about plugins, versions, or content. ' +
      'Run nexus_site_refresh if data is missing or stale.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
      },
      required: ['site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found`);

    const metadataCache = services.metadataCache;
    const indexEntry    = services.indexRegistry.get(site.id);
    const meta          = metadataCache?.getWithAge(site.id) ?? null;
    const siteStatus    = services.localServices?.getSiteStatus(site.id) ?? 'unknown';

    const lines: string[] = [];
    lines.push(`## ${site.name} — twin status`);
    lines.push('');
    lines.push(`**Site:** ${site.domain || site.id}`);
    lines.push(`**Runtime:** ${siteStatus === 'running' ? '🟢 Running' : '⚫ Halted'}`);
    lines.push('');

    // --- Metadata tier ---
    lines.push('### Metadata (SiteMetadataCache)');
    if (!meta) {
      lines.push('❌ **No data** — run `nexus_site_refresh` to populate');
    } else {
      const depth = meta.scanDepth ?? 'full';
      const depthLabel = depth === 'full'
        ? '✅ Full (WP-CLI)'
        : '🔶 Filesystem only';
      lines.push(`**Scan depth:** ${depthLabel}`);
      lines.push(`**Last updated:** ${metadataCache!.getAgeString(site.id)} (${meta.isStale ? '⚠️ stale' : 'fresh'})`);
      lines.push(`**Source:** ${meta.updateSource}`);
      lines.push('');

      const row = (label: string, value: string | number | undefined | null, available: boolean) =>
        `- **${label}:** ${available ? String(value) : '—'} ${!available ? '_(not collected)_' : ''}`;

      lines.push(row('WordPress',     meta.wpVersion,                            !!meta.wpVersion));
      lines.push(row('PHP',           meta.phpVersion,                           !!meta.phpVersion));
      lines.push(row('MySQL',         meta.mysqlVersion,                         !!meta.mysqlVersion));
      lines.push(row('Site URL',      meta.siteUrl,                              !!meta.siteUrl));
      lines.push(row('Admin email',   meta.adminEmail,                           !!meta.adminEmail));
      lines.push(row('Active theme',  meta.activeTheme,                          !!meta.activeTheme));

      if (meta.plugins?.length) {
        const active = meta.plugins.filter((p) => p.status === 'active').length;
        lines.push(`- **Plugins:** ${meta.plugins.length} known (${active} active)`);
      } else if (meta.installedPlugins?.length) {
        lines.push(`- **Plugins:** ${meta.installedPlugins.length} installed dirs _(no status — filesystem scan)_`);
      } else {
        lines.push('- **Plugins:** — _(not collected)_');
      }

      if (meta.themes?.length) {
        lines.push(`- **Themes:** ${meta.themes.length} known`);
      } else if (meta.installedThemes?.length) {
        lines.push(`- **Themes:** ${meta.installedThemes.length} installed dirs _(no status — filesystem scan)_`);
      } else {
        lines.push('- **Themes:** — _(not collected)_');
      }

      lines.push(row('Post count',    meta.postCount,                            meta.postCount != null));
      lines.push(row('Last post',
        meta.lastPostAt ? new Date(meta.lastPostAt).toLocaleDateString() : null,
        meta.lastPostAt != null));
    }

    // --- Content index tier ---
    lines.push('');
    lines.push('### Content Index (VectorStore)');
    if (!indexEntry) {
      lines.push('❌ **Not indexed** — run `reindex_site` to index WordPress content');
    } else {
      const stateIcon = indexEntry.state === 'indexed' ? '✅'
        : indexEntry.state === 'stale'   ? '⚠️'
        : indexEntry.state === 'error'   ? '❌'
        : '🔄';
      lines.push(`**State:** ${stateIcon} ${indexEntry.state}`);
      lines.push(`**Documents:** ${indexEntry.documentCount}`);
      lines.push(`**Chunks:** ${indexEntry.chunkCount}`);
      if (indexEntry.lastIndexed) {
        const ageMs = Date.now() - indexEntry.lastIndexed;
        const ageDays = Math.floor(ageMs / 86400000);
        const ageHours = Math.floor((ageMs % 86400000) / 3600000);
        const ageStr = ageDays > 0 ? `${ageDays}d ${ageHours}h ago` : `${ageHours}h ago`;
        lines.push(`**Last indexed:** ${ageStr}`);
      }
    }

    // --- Recommendation ---
    lines.push('');
    lines.push('### Next actions');
    if (!meta) {
      lines.push('- Run `nexus_site_refresh` to populate basic metadata');
    } else if (meta.isStale) {
      lines.push('- Run `nexus_site_refresh` — cached data is > 24h old');
    } else if ((meta.scanDepth ?? 'full') === 'filesystem' && siteStatus === 'running') {
      lines.push('- Run `nexus_site_refresh` — site is running, can upgrade to full WP-CLI scan');
    } else if ((meta.scanDepth ?? 'full') === 'filesystem' && siteStatus !== 'running') {
      lines.push('- Start the site, then run `nexus_site_refresh` for plugin status and post counts');
    } else {
      lines.push('- Twin is up to date ✅');
    }

    if (!indexEntry || indexEntry.state === 'stale') {
      lines.push('- Run `reindex_site` to refresh semantic search index');
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
