import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const evalHandler: McpToolHandler = {
  definition: {
    name: 'wp_eval',
    description:
      'LAST RESORT — execute arbitrary PHP code in a WordPress context. ' +
      'Use this ONLY when no dedicated tool exists for the operation. ' +
      'Before reaching for wp_eval, check whether these cover your need: ' +
      'wp_post_create / wp_post_update / wp_post_delete (content), ' +
      'wp_plugin_install / wp_plugin_update / wp_plugin_activate (plugins), ' +
      'wp_option_get / wp_search_replace (options/data), ' +
      'wp_core_update / wp_core_version (WordPress core), ' +
      'wp_user_list (users). ' +
      'LOCAL SITES ONLY — blocked on remote WPE installs for security.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Local site name, ID, or domain. Do NOT use for remote WPE installs.',
        },
        code: {
          type: 'string',
          description: 'PHP code to execute (without <?php tags)',
        },
      },
      required: ['code'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const code = args.code as string;
    if (!code) return error('PHP code is required.');

    const target = await resolveTarget(args, services);
    if ('content' in target) return target; // error result

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, ['eval', code], services);
      if (!result.success) {
        return error(`Remote WP-CLI error: ${result.stdout}`);
      }
      return ok(result.stdout?.trim() || '(no output)');
    }

    // Local path
    const check = requireRunning(target.site, services);
    if (check) return check;

    // Load plugins and themes so eval code can access plugin functions
    const result = await services.localServices!.wpCliRun(target.site.id, ['eval', code], {
      skipPlugins: false,
      skipThemes: false,
    });

    if (!result.success) {
      return error('Eval failed: ' + result.stdout);
    }

    return ok(result.stdout?.trim() || '(no output)');
  },
};
