import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const evalHandler: McpToolHandler = {
  definition: {
    name: 'wp_eval',
    description:
      'Execute arbitrary PHP code in WordPress context. LOCAL SITES ONLY — ' +
      'wp_eval is blocked on remote WPE installs for security. ' +
      'For remote WPE sites use wp_plugin_list, wp_plugin_update, wp_core_version, etc.',
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
