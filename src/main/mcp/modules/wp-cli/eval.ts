import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
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
      'wp_theme_activate (theme switching, including crash recovery), ' +
      'wp_option_get / wp_search_replace (options/data), ' +
      'wp_core_update / wp_core_version (WordPress core). ' +
      'LOCAL SITES ONLY — blocked on remote WPE installs for security. ' +
      'Use skip_themes=true when the active theme crashes WordPress on bootstrap (e.g. theme requires newer WP API). ' +
      'Use skip_plugins=true when a plugin conflict prevents WordPress from loading.',
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
        skip_themes: {
          type: 'boolean',
          description: 'Skip loading the active theme. Use when a theme incompatibility crashes WordPress (e.g. theme requires WP 6.5 but site runs 6.3). Defaults to false.',
        },
        skip_plugins: {
          type: 'boolean',
          description: 'Skip loading all plugins. Use when a plugin conflict prevents WordPress from loading. Defaults to false.',
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

    // Local path — require site to be running (wp_eval needs MySQL; auto-start hangs)
    const siteStatus = services.localServices!.getSiteStatus(target.site.id);
    if (siteStatus !== 'running') {
      return error(
        `Site "${target.site.name}" is ${siteStatus}. wp_eval requires the site to be running (MySQL must be available). ` +
        `Start it first with local_start_site, then retry.`,
      );
    }

    const result = await services.localServices!.wpCliRun(target.site.id, ['eval', code], {
      skipPlugins: !!(args.skip_plugins),
      skipThemes: !!(args.skip_themes),
      timeoutMs: 30_000,
    });

    if (!result.success) {
      return error('Eval failed: ' + result.stdout);
    }

    return ok(result.stdout?.trim() || '(no output)');
  },
};
