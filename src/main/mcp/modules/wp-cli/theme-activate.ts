import { McpToolHandler, McpToolResult } from '../../types';
import { requireRunning, ok, error } from './preflight';
import { resolveTarget, remoteWpCliRun } from './remote-exec';

export const themeActivateHandler: McpToolHandler = {
  definition: {
    name: 'wp_theme_activate',
    description:
      'Activate a WordPress theme by slug. ' +
      'Works on local sites (site=) and remote WPE installs via SSH (install_name=). ' +
      'Runs with --skip-themes internally, so it works even when the currently active theme ' +
      'crashes WordPress on bootstrap (e.g. theme requires a newer WP API than is installed). ' +
      'Use this for crash recovery: switch to a compatible theme (twentytwentyone, twentytwentytwo) ' +
      'when the active theme prevents WordPress from loading. ' +
      'The theme must already be installed — use wp_theme_list to see available themes.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        slug: {
          type: 'string',
          description: 'Theme slug to activate (e.g. "twentytwentyone", "twentytwentytwo", "astra")',
        },
      },
      required: ['slug'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const slug = args.slug as string;
    if (!slug) return error('Theme slug is required.');

    const target = await resolveTarget(args, services);
    if ('content' in target) return target;

    if (target.type === 'remote') {
      const result = await remoteWpCliRun(target.installName, ['theme', 'activate', slug], services);
      if (!result.success) {
        return error(`Failed to activate theme "${slug}" on ${target.installName}: ${result.stdout}`);
      }
      return ok(`Theme "${slug}" activated on ${target.installName}.`);
    }

    const check = requireRunning(target.site, services);
    if (check) return check;

    // Always skip themes when activating — this is the key: it lets us switch themes
    // even when the currently active theme crashes WordPress on load.
    const result = await services.localServices!.wpCliRun(
      target.site.id,
      ['theme', 'activate', slug],
      { skipPlugins: false, skipThemes: true },
    );

    if (!result.success) {
      return error(`Failed to activate theme "${slug}": ${result.stdout}`);
    }

    return ok(`Theme "${slug}" activated. WordPress will now load with the new theme.`);
  },
};
