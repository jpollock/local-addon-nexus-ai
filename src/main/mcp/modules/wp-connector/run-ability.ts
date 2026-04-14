import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from '../wp-cli/preflight';
import { resolveSite } from '../../site-resolver';

/**
 * Builds PHP code that executes a WordPress Ability by name.
 * Handles: API availability check, ability lookup, permission check, execution.
 */
function buildPhp(abilityName: string, input: Record<string, unknown>): string {
  const escapedName = abilityName.replace(/'/g, "\\'");
  const inputJson = JSON.stringify(input).replace(/'/g, "\\'");
  const hasInput = Object.keys(input).length > 0;

  const lines = [
    `if (!function_exists('wp_get_ability')) { echo json_encode(['error' => 'Abilities API not available. Requires WordPress 6.9+.']); exit; }`,
    `$ability = wp_get_ability('${escapedName}');`,
    `if (!$ability) { echo json_encode(['error' => 'Ability not found: ${escapedName}']); exit; }`,
    // When no input is provided, check the ability's input_schema to determine
    // whether to pass null or an empty array. Abilities with "type":"null" or
    // empty schemas (like core/get-user-info) expect null.
    hasInput
      ? `$input = json_decode('${inputJson}', true);`
      : `$schema = $ability->get_input_schema(); $input = (empty($schema) || (isset($schema['type']) && $schema['type'] === 'null')) ? null : [];`,
    `$perm = $ability->check_permissions($input);`,
    `if (is_wp_error($perm)) { echo json_encode(['error' => $perm->get_error_message()]); exit; }`,
    `$result = $ability->execute($input);`,
    `if (is_wp_error($result)) { echo json_encode(['error' => $result->get_error_message()]); exit; }`,
    `echo json_encode(['result' => $result]);`,
  ];

  return lines.join(' ');
}

interface AbilityResult {
  result?: unknown;
  error?: string;
}

export const runAbilityHandler: McpToolHandler = {
  definition: {
    name: 'wp_run_ability',
    description:
      'Execute a WordPress Ability (AI writing feature) on a site — generate a title, summary, excerpt, or alt text for a post or image. Use wp_list_abilities first to see available abilities and their required parameters. The site must be running, have AI set up via wp_setup_ai, and have a working API key or Local Gateway configured.' +
      'Abilities are registered by plugins (ACF, Jetpack, etc.) and WordPress core via the Abilities API (WP 6.9+). ' +
      'Use `wp_list_abilities` first to discover available abilities and their input schemas. ' +
      'Local-only (not remote).',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Local site name, ID, or domain',
        },
        ability: {
          type: 'string',
          description: 'Ability name (e.g., "acf/list-field-groups", "core/get-site-info")',
        },
        input: {
          type: 'object',
          description: 'Input data matching the ability\'s input_schema. Use wp_list_abilities to see expected input.',
          additionalProperties: true,
        },
      },
      required: ['site', 'ability'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { localServices } = services;
    if (!localServices) {
      return error('Local services not available.');
    }

    const abilityName = args.ability as string;
    if (!abilityName) {
      return error('Ability name is required.');
    }

    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      return error(`Site not found: "${args.site}"`);
    }

    const check = requireRunning(site, services);
    if (check) return check;

    const input = (args.input as Record<string, unknown>) ?? {};
    const phpCode = buildPhp(abilityName, input);

    try {
      // skipPlugins: false loads plugins so their registered abilities are available.
      // --user=1 ensures WP-CLI runs as admin so ability permission checks pass.
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
        return error('Empty response from WordPress. The ability may have failed silently.');
      }

      let parsed: AbilityResult;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return error(`Failed to parse ability response: ${stdout.slice(0, 200)}`);
      }

      if (parsed.error) {
        return error(`Ability error: ${parsed.error}`);
      }

      const output = typeof parsed.result === 'string'
        ? parsed.result
        : JSON.stringify(parsed.result, null, 2);

      return ok(`Result of "${abilityName}":\n\n${output}`);
    } catch (err) {
      return error(`WP-CLI failure: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
