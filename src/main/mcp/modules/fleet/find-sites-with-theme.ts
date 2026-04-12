import { McpToolHandler, McpToolResult } from '../../types';

export const findSitesWithThemeHandler: McpToolHandler = {
  definition: {
    name: 'find_sites_with_theme',
    description:
      'Find all indexed sites that have a specific theme installed — matches by theme name or slug. Works even when sites are stopped — reads from the content index. Returns site names, theme version, and active/inactive status. Use for theme migration planning or to identify sites using a specific theme before updates.' +
      'Matches by slug (exact) or name (case-insensitive substring). ' +
      'Shows active status and child theme info. Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        theme: {
          type: 'string',
          description: 'Theme name or slug to search for (e.g. "twentytwentyfour" or "Twenty Twenty")',
        },
      },
      required: ['theme'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const query = args.theme as string;
    if (!query) {
      return error('Missing required argument: theme');
    }

    const entries = services.indexRegistry.listAll();
    const indexed = entries.filter((e) => e.structure);

    if (indexed.length === 0) {
      return ok('No indexed sites with structure data available.');
    }

    const queryLower = query.toLowerCase();
    const matches: Array<{
      siteName: string;
      themeName: string;
      version: string;
      status: string;
      isChildTheme: boolean;
      parentTheme?: string;
      lastIndexed: number;
    }> = [];

    for (const entry of indexed) {
      for (const theme of entry.structure!.themes) {
        const slugMatch = theme.slug.toLowerCase() === queryLower;
        const nameMatch = theme.name.toLowerCase().includes(queryLower);

        if (slugMatch || nameMatch) {
          matches.push({
            siteName: entry.siteName || entry.siteId,
            themeName: theme.name,
            version: theme.version,
            status: theme.isActive ? 'active' : 'inactive',
            isChildTheme: theme.isChildTheme,
            parentTheme: theme.parentTheme,
            lastIndexed: entry.lastIndexed,
          });
        }
      }
    }

    if (matches.length === 0) {
      return ok(`No indexed sites have a theme matching "${query}".`);
    }

    const lines: string[] = [`## Sites with theme "${query}"`, ''];
    lines.push('| Site | Theme | Version | Status | Child Theme | Last Indexed |');
    lines.push('|------|-------|---------|--------|-------------|-------------|');

    for (const m of matches) {
      const date = m.lastIndexed ? new Date(m.lastIndexed).toISOString().split('T')[0] : 'unknown';
      const childInfo = m.isChildTheme ? `Yes (parent: ${m.parentTheme || 'unknown'})` : 'No';
      lines.push(`| ${m.siteName} | ${m.themeName} | v${m.version} | ${m.status} | ${childInfo} | ${date} |`);
    }

    lines.push('');
    lines.push(`Found in ${matches.length} of ${indexed.length} indexed sites.`);

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
