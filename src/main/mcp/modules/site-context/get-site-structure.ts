/**
 * get_site_structure — deep structural context for a WordPress site.
 *
 * Data sources (in priority order):
 *   1. SiteDigitalTwin  — WP/PHP/MySQL versions, plugins with active status,
 *                         themes, post counts, site URL. Always populated on
 *                         site start; available for halted sites via startup scan.
 *   2. IndexRegistry    — deep structural fields populated during content
 *                         indexing: isMultisite, WooCommerce/ACF detection,
 *                         custom tables, user/role breakdown, REST API, health.
 *   3. FileScanner      — last resort fallback if neither store has data.
 *
 * The twin takes precedence for overlapping fields (WP version, plugins, themes)
 * because it is fresher. The IndexRegistry adds depth that the twin doesn't collect.
 * Freshness is surfaced so callers know how old each data tier is.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';

export const getSiteStructureHandler: McpToolHandler = {
  definition: {
    name: 'get_site_structure',
    description:
      'Get deep structural context for a WordPress site — WP/PHP/MySQL versions, ' +
      'plugins (active/inactive) with versions, themes, post counts, site URL, ' +
      'user/role summary, REST API namespaces, permalink structure, site health indicators, ' +
      'WooCommerce/ACF detection, and custom table detection. ' +
      'Basic metadata (versions, plugins, post counts) is available even for halted sites. ' +
      'DB-backed details (users, custom tables, REST API) require a prior content index. ' +
      'Use before making structural changes or to give an AI agent full site context.',
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

    // ── Tier 1: Digital Twin ──────────────────────────────────────────────
    const twin = services.twinService?.get(site.id) ?? null;

    // ── Tier 2: IndexRegistry structure ──────────────────────────────────
    const indexEntry = services.indexRegistry.get(site.id);
    let structure = indexEntry?.structure ?? null;

    // ── Tier 3: FileScanner fallback (only if no twin AND no structure) ───
    if (!twin && !structure) {
      try {
        structure = await services.fileScanner.scan(site.path);
      } catch (err) {
        return error(`No cached data and filesystem scan failed: ${(err as Error).message}`);
      }
    }

    // ── Assemble response ─────────────────────────────────────────────────
    const lines: string[] = [];

    // Header
    lines.push(`## ${site.name}`);

    // Freshness banner
    if (twin) {
      const twinFreshness = services.twinService!.getFreshness(twin);
      const age = twin.asOf
        ? formatAge(Date.now() - twin.asOf)
        : 'unknown';
      const depthLabel = twin.completeness === 'none'       ? '❌ No data'
                       : twin.completeness === 'filesystem' ? '🔶 Filesystem only'
                       : twin.completeness === 'metadata'   ? '✅ WP-CLI scan'
                       : '✅ Fully indexed';
      const staleWarn = twinFreshness.staleFields.length > 0 ? ' ⚠️ some fields stale' : '';
      lines.push(`_Twin: ${depthLabel} · updated ${age}${staleWarn}_`);
    } else if (structure) {
      lines.push('_Data from content index (no twin data available)_');
    }
    lines.push('');

    // Core versions — twin takes precedence
    const wpVersion  = twin?.wpVersion  ?? structure?.wpVersion  ?? 'unknown';
    const phpVersion = twin?.phpVersion ?? structure?.phpVersion ?? 'unknown';
    lines.push(`**Domain:** ${site.domain ?? 'unknown'}`);
    lines.push(`**WordPress:** ${wpVersion}`);
    lines.push(`**PHP:** ${phpVersion}`);
    if (twin?.mysqlVersion)   lines.push(`**MySQL:** ${twin.mysqlVersion}`);
    if (twin?.siteUrl)        lines.push(`**Site URL:** ${twin.siteUrl}`);
    if (twin?.adminEmail)     lines.push(`**Admin email:** ${twin.adminEmail}`);
    const isMultisite = structure?.isMultisite ?? false;
    lines.push(`**Multisite:** ${isMultisite ? 'Yes' : 'No'}`);

    // Post counts (twin only — not in SiteStructure)
    if (twin?.postCount != null) {
      lines.push(`**Published posts:** ${twin.postCount}`);
      if (twin.postCountByType && Object.keys(twin.postCountByType).length > 1) {
        const breakdown = Object.entries(twin.postCountByType)
          .sort(([, a], [, b]) => b - a)
          .map(([type, count]) => `${type}: ${count}`)
          .join(', ');
        lines.push(`**By type:** ${breakdown}`);
      }
      if (twin.lastPostAt) {
        lines.push(`**Last post:** ${new Date(twin.lastPostAt).toLocaleDateString()}`);
      }
    }

    // ── Themes ────────────────────────────────────────────────────────────
    lines.push('');
    if (twin?.themes?.length) {
      // Twin has themes with status
      const active = twin.themes.filter((t) => t.status === 'active');
      lines.push(`### Themes (${active.length} active)`);
      for (const t of twin.themes) {
        const activeTag = t.status === 'active' ? ' **(active)**' : '';
        const ver = t.version ? ` v${t.version}` : '';
        lines.push(`- ${t.title ?? t.name}${ver}${activeTag}`);
      }
    } else if (structure?.themes?.length) {
      // Fall back to index structure
      const active = structure.themes.filter((t) => t.isActive);
      lines.push(`### Themes (${active.length} active)`);
      for (const t of structure.themes) {
        const activeTag = t.isActive ? ' **(active)**' : '';
        const childTag  = t.isChildTheme ? ` (child of ${t.parentTheme})` : '';
        lines.push(`- ${t.name} v${t.version}${activeTag}${childTag}`);
      }
    } else if (twin?.installedThemes?.length) {
      lines.push(`### Themes (${twin.installedThemes.length} installed, status unknown)`);
      for (const name of twin.installedThemes) lines.push(`- ${name}`);
    } else {
      lines.push('### Themes');
      lines.push('No theme data available.');
    }

    // ── Plugins ───────────────────────────────────────────────────────────
    lines.push('');
    if (twin?.plugins?.length) {
      // Twin has plugins with status
      const active = twin.plugins.filter((p) => p.status === 'active');
      lines.push(`### Plugins (${active.length} active / ${twin.plugins.length} installed)`);
      for (const p of twin.plugins) {
        const activeTag = p.status === 'active' ? ' **(active)**' : '';
        const ver = p.version ? ` v${p.version}` : '';
        lines.push(`- ${p.title ?? p.name}${ver}${activeTag}`);
      }
    } else if (structure?.plugins?.length) {
      // Fall back to index structure
      const active = structure.plugins.filter((p) => p.isActive);
      lines.push(`### Plugins (${active.length} active / ${structure.plugins.length} installed)`);
      for (const p of structure.plugins) {
        const activeTag = p.isActive ? ' **(active)**' : '';
        lines.push(`- ${p.name} v${p.version}${activeTag}`);
      }
    } else if (twin?.installedPlugins?.length) {
      lines.push(`### Plugins (${twin.installedPlugins.length} installed, status unknown)`);
      for (const name of twin.installedPlugins) lines.push(`- ${name}`);
    } else {
      lines.push('### Plugins');
      lines.push('No plugin data available.');
    }

    // ── Fields from IndexRegistry only ────────────────────────────────────

    // Key integrations
    if (structure) {
      lines.push('');
      lines.push('### Key Integrations');
      lines.push(`- WooCommerce: ${structure.hasWooCommerce ? 'Installed' : 'Not found'}`);
      lines.push(`- ACF: ${structure.hasACF ? 'Installed' : 'Not found'}`);
    }

    // Custom tables
    if (structure?.customTables?.length) {
      lines.push('');
      lines.push('### Custom Tables');
      const byPlugin = new Map<string, Array<{ name: string; rowCount: number }>>();
      for (const table of structure.customTables) {
        if (!byPlugin.has(table.pluginGuess)) byPlugin.set(table.pluginGuess, []);
        byPlugin.get(table.pluginGuess)!.push({ name: table.name, rowCount: table.rowCount });
      }
      for (const [plugin, tables] of byPlugin) {
        lines.push(`- **${plugin}:** ${tables.map((t) => `${t.name} (~${t.rowCount} rows)`).join(', ')}`);
      }
    }

    // Users
    if (structure?.users && structure.users.totalUsers > 0) {
      lines.push('');
      lines.push('### Users');
      lines.push(`- Total: ${structure.users.totalUsers}`);
      const roleParts = Object.entries(structure.users.roleBreakdown)
        .sort(([, a], [, b]) => b - a)
        .map(([role, count]) => `${role.charAt(0).toUpperCase() + role.slice(1)}s: ${count}`);
      if (roleParts.length) lines.push(`- ${roleParts.join(', ')}`);
      if (structure.users.customRoles.length) {
        lines.push(`- Custom roles: ${structure.users.customRoles.join(', ')}`);
      }
    }

    // REST API
    if (structure?.restApi) {
      lines.push('');
      lines.push('### REST API');
      if (structure.restApi.customNamespaces.length) {
        lines.push(`- Custom namespaces: ${structure.restApi.customNamespaces.join(', ')}`);
      }
      lines.push(`- Total routes: ${structure.restApi.routeCount}`);
    }

    // Site Health
    if (structure?.health) {
      lines.push('');
      lines.push('### Site Health');
      lines.push(`- Search engines: ${structure.health.searchEngineVisibility ? 'Allowed' : 'Blocked'}`);
      if (structure.permalinks) lines.push(`- Permalinks: ${structure.permalinks.structure}`);
      lines.push(`- Language: ${structure.health.language}`);
      lines.push(`- Timezone: ${structure.health.timezone}`);
      lines.push(`- Default role: ${structure.health.defaultRole}`);
    }

    // Index status
    if (indexEntry) {
      lines.push('');
      lines.push('### Content Index');
      const stateIcon = indexEntry.state === 'indexed' ? '✅'
        : indexEntry.state === 'stale'   ? '⚠️'
        : indexEntry.state === 'error'   ? '❌' : '🔄';
      lines.push(`- State: ${stateIcon} ${indexEntry.state}`);
      lines.push(`- Documents: ${indexEntry.documentCount} (${indexEntry.chunkCount} chunks)`);
      if (indexEntry.lastIndexed) {
        lines.push(`- Last indexed: ${formatAge(Date.now() - indexEntry.lastIndexed)}`);
      }
    } else if (!structure) {
      lines.push('');
      lines.push('_No content index yet. Run `reindex_site` to enable semantic search._');
    }

    // Data availability note for halted sites
    if (twin && twin.completeness === 'filesystem') {
      lines.push('');
      lines.push('_🔶 Site is halted — plugin/theme status and post counts require starting the site._');
    } else if (!twin || twin.completeness === 'none') {
      lines.push('');
      lines.push('_Run `nexus_site_refresh` to populate site metadata._');
    }

    return ok(lines.join('\n'));
  },
};

function formatAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60)   return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
