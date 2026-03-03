import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from '../wp-cli/preflight';
import { resolveSite } from '../../site-resolver';

/**
 * PHP snippet that discovers all registered WordPress Abilities.
 * Returns a JSON array of ability metadata including input/output schemas.
 * Gracefully returns [] on pre-6.9 sites where the API doesn't exist.
 */
function buildPhp(category?: string): string {
  const lines = [
    `if (!function_exists('wp_get_abilities')) { echo json_encode([]); exit; }`,
    `$abilities = wp_get_abilities();`,
    `$result = [];`,
    `foreach ($abilities as $a) {`,
  ];

  if (category) {
    const escaped = category.replace(/'/g, "\\'");
    lines.push(`  if ($a->get_category() !== '${escaped}') { continue; }`);
  }

  lines.push(
    `  $item = [`,
    `    'name' => $a->get_name(),`,
    `    'label' => $a->get_label(),`,
    `    'description' => $a->get_description(),`,
    `    'category' => $a->get_category(),`,
    `    'input_schema' => $a->get_input_schema(),`,
    `    'output_schema' => $a->get_output_schema(),`,
    `  ];`,
    `  $annotations = $a->get_meta_item('annotations', []);`,
    `  if (!empty($annotations)) { $item['annotations'] = $annotations; }`,
    `  $result[] = $item;`,
    `}`,
    `echo json_encode($result);`,
  );

  return lines.join(' ');
}

interface AbilityInfo {
  name: string;
  label: string;
  description: string;
  category: string;
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  annotations?: Record<string, unknown>;
}

function formatAbilities(abilities: AbilityInfo[]): string {
  if (abilities.length === 0) {
    return 'No abilities registered on this site. The site may be running WordPress < 6.9 or have no plugins that register abilities.';
  }

  const lines: string[] = [`Found ${abilities.length} registered ability(ies):`, ''];

  // Group by category
  const byCategory = new Map<string, AbilityInfo[]>();
  for (const a of abilities) {
    const cat = a.category || 'uncategorized';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(a);
  }

  for (const [category, items] of byCategory) {
    lines.push(`### ${category}`);
    lines.push('');

    for (const a of items) {
      lines.push(`- **${a.name}** — ${a.description || a.label || '(no description)'}`);

      if (a.input_schema) {
        const props = (a.input_schema as any).properties;
        if (props && Object.keys(props).length > 0) {
          const paramNames = Object.keys(props).join(', ');
          lines.push(`  Input: { ${paramNames} }`);
        }
      }

      if (a.annotations) {
        const flags = Object.entries(a.annotations)
          .filter(([, v]) => v === true)
          .map(([k]) => k);
        if (flags.length > 0) {
          lines.push(`  Flags: ${flags.join(', ')}`);
        }
      }
    }

    lines.push('');
  }

  lines.push('Use `wp_run_ability` to execute any of these abilities.');

  return lines.join('\n');
}

export const listAbilitiesHandler: McpToolHandler = {
  definition: {
    name: 'wp_list_abilities',
    description:
      'Discover all registered WordPress Abilities on a site. ' +
      'Abilities are machine-readable capabilities registered by plugins (e.g., ACF, Jetpack) and WordPress core via the Abilities API (WP 6.9+). ' +
      'Returns ability names, descriptions, categories, and input/output schemas. ' +
      'Local-only (not remote).',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Local site name, ID, or domain',
        },
        category: {
          type: 'string',
          description: 'Filter abilities by category slug (e.g., "acf", "core")',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { localServices } = services;
    if (!localServices) {
      return error('Local services not available.');
    }

    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      return error(`Site not found: "${args.site}"`);
    }

    const check = requireRunning(site, services);
    if (check) return check;

    const category = args.category as string | undefined;
    const phpCode = buildPhp(category);

    try {
      // skipPlugins: false loads plugins so their registered abilities are visible.
      // --user=1 ensures WP-CLI runs as admin so all abilities are visible.
      const result = await localServices.wpCliRun(
        site.id,
        ['eval', phpCode, '--user=1'],
        { skipPlugins: false },
      );

      if (!result.success) {
        return error(`WP-CLI error: ${result.stdout || 'Unknown error'}`);
      }

      const stdout = (result.stdout ?? '').trim();
      if (!stdout) {
        return ok('No abilities registered on this site. The site may be running WordPress < 6.9 or have no plugins that register abilities.');
      }

      let abilities: AbilityInfo[];
      try {
        abilities = JSON.parse(stdout);
      } catch {
        return error(`Failed to parse abilities response: ${stdout.slice(0, 200)}`);
      }

      return ok(formatAbilities(abilities));
    } catch (err) {
      return error(`WP-CLI failure: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
