/**
 * Table-driven dispatch test across every wp-cli tool. Asserts each tool sends
 * the same WP-CLI args on the remote branch after the transport migration.
 *
 * Only tests commands that pass the current whitelist in remote-exec.ts.
 * Commands blocked by the whitelist (core update, theme activate, post create/
 * update/delete, eval) are tested separately to verify they return the expected
 * "blocked" error rather than dispatching.
 *
 * Mocks child_process.spawn to intercept SSH commands and extract WP-CLI args.
 */
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Mock spawn to capture WP-CLI args from SSH commands
let capturedWpCliArgs: string[] | undefined;

const mockChildProcess = (): ChildProcess => {
  const proc = new EventEmitter() as ChildProcess;
  (proc as any).stdout = new EventEmitter();
  (proc as any).stderr = new EventEmitter();
  setTimeout(() => {
    (proc as any).stdout.emit('data', Buffer.from('[]'));
    proc.emit('close', 0);
  }, 10);
  return proc;
};

const spawnMock = jest.fn((cmd: string, args: string[]) => {
  // Extract WP-CLI args from the SSH command string
  // Format: ssh user@host "cd /path && wp <args>"
  if (cmd === 'ssh' && args.length >= 2) {
    const sshCommand = args[args.length - 1]; // Last arg is the remote command
    const match = sshCommand.match(/wp\s+(.+)$/);
    if (match) {
      // Parse the WP-CLI command line, respecting quotes
      const wpCommand = match[1];
      // Simple split on spaces (doesn't handle all edge cases, but sufficient for this test)
      const parsed: string[] = [];
      let current = '';
      let inQuote = false;
      for (let i = 0; i < wpCommand.length; i++) {
        const c = wpCommand[i];
        if (c === "'" && !inQuote) {
          inQuote = true;
        } else if (c === "'" && inQuote) {
          inQuote = false;
        } else if (c === ' ' && !inQuote) {
          if (current) {
            parsed.push(current);
            current = '';
          }
        } else {
          current += c;
        }
      }
      if (current) parsed.push(current);
      capturedWpCliArgs = parsed;
    }
  }
  return mockChildProcess();
});

jest.mock('child_process', () => ({
  spawn: (cmd: string, args: string[]) => spawnMock(cmd, args)
}));

import { createLocalServicesBridge } from '../../../src/main/mcp/local-services-bridge';
import { coreVersionHandler } from '../../../src/main/mcp/modules/wp-cli/core-version';
import { optionGetHandler } from '../../../src/main/mcp/modules/wp-cli/option-get';
import { pluginActivateHandler } from '../../../src/main/mcp/modules/wp-cli/plugin-activate';
import { pluginDeactivateHandler } from '../../../src/main/mcp/modules/wp-cli/plugin-deactivate';
import { pluginInstallHandler } from '../../../src/main/mcp/modules/wp-cli/plugin-install';
import { pluginListHandler } from '../../../src/main/mcp/modules/wp-cli/plugin-list';
import { pluginUpdateHandler } from '../../../src/main/mcp/modules/wp-cli/plugin-update';
import { themeListHandler } from '../../../src/main/mcp/modules/wp-cli/theme-list';
import { userListHandler } from '../../../src/main/mcp/modules/wp-cli/user-list';

// Commands that pass the whitelist and actually dispatch.
// All include --skip-plugins --skip-themes by default (added by buildWpCliArgs).
const DISPATCH_CASES: Array<{ name: string; handler: any; args: Record<string, unknown>; expected: string[] }> = [
  {
    name: 'wp_core_version',
    handler: coreVersionHandler,
    args: { install_name: 'acmeprod' },
    expected: ['--skip-plugins', '--skip-themes', 'core', 'version'],
  },
  {
    name: 'wp_option_get',
    handler: optionGetHandler,
    args: { install_name: 'acmeprod', option: 'siteurl' },
    expected: ['--skip-plugins', '--skip-themes', 'option', 'get', 'siteurl'],
  },
  {
    name: 'wp_plugin_activate',
    handler: pluginActivateHandler,
    args: { install_name: 'acmeprod', slug: 'akismet' },
    expected: ['--skip-plugins', '--skip-themes', 'plugin', 'activate', 'akismet'],
  },
  {
    name: 'wp_plugin_deactivate',
    handler: pluginDeactivateHandler,
    args: { install_name: 'acmeprod', slug: 'akismet' },
    expected: ['--skip-plugins', '--skip-themes', 'plugin', 'deactivate', 'akismet'],
  },
  {
    name: 'wp_plugin_install (basic)',
    handler: pluginInstallHandler,
    args: { install_name: 'acmeprod', slug: 'contact-form-7' },
    expected: ['--skip-plugins', '--skip-themes', 'plugin', 'install', 'contact-form-7'],
  },
  {
    name: 'wp_plugin_install (with version)',
    handler: pluginInstallHandler,
    args: { install_name: 'acmeprod', slug: 'contact-form-7', version: '5.7' },
    expected: ['--skip-plugins', '--skip-themes', 'plugin', 'install', 'contact-form-7', '--version=5.7'],
  },
  {
    name: 'wp_plugin_install (with activate)',
    handler: pluginInstallHandler,
    args: { install_name: 'acmeprod', slug: 'contact-form-7', activate: true },
    expected: ['--skip-plugins', '--skip-themes', 'plugin', 'install', 'contact-form-7', '--activate'],
  },
  {
    name: 'wp_plugin_list',
    handler: pluginListHandler,
    args: { install_name: 'acmeprod' },
    expected: ['--skip-plugins', '--skip-themes', 'plugin', 'list', '--format=json'],
  },
  {
    name: 'wp_plugin_update (single)',
    handler: pluginUpdateHandler,
    args: { install_name: 'acmeprod', slug: 'akismet' },
    expected: ['--skip-plugins', '--skip-themes', 'plugin', 'update', 'akismet'],
  },
  {
    name: 'wp_plugin_update (all)',
    handler: pluginUpdateHandler,
    args: { install_name: 'acmeprod', slug: '--all' },
    expected: ['--skip-plugins', '--skip-themes', 'plugin', 'update', '--all'],
  },
  {
    name: 'wp_theme_list',
    handler: themeListHandler,
    args: { install_name: 'acmeprod' },
    expected: ['--skip-plugins', '--skip-themes', 'theme', 'list', '--format=json'],
  },
  {
    name: 'wp_user_list',
    handler: userListHandler,
    args: { install_name: 'acmeprod' },
    expected: ['--skip-plugins', '--skip-themes', 'user', 'list', '--format=json'],
  },
];

function makeServices() {
  const bridge = createLocalServicesBridge({} as any);
  return {
    localServices: Object.assign(bridge, {
      isCAPIAvailable: () => true,
      isSSHKeyAvailable: () => true,
      resolveWpeInstall: async () => null,
    }),
    siteData: { getSites: () => ({}), getSite: () => null },
    registryStorage: {
      get: (key: string) => {
        if (key === 'nexus-ai_wpe_install_cache') {
          return {
            installs: [{ installName: 'acmeprod', environment: 'staging' }],
            syncedAt: Date.now(),
          };
        }
        if (key === 'nexus-ai_settings') {
          return {
            wpeOperationPermissions: {
              wpcli: { staging: true },
              wpcli_read: { staging: true },
            },
          };
        }
        return null;
      },
    },
    graphService: { getDb: () => null },
  } as any;
}

describe('wp-cli tool remote dispatch', () => {
  it.each(DISPATCH_CASES)('$name sends the expected WP-CLI args', async ({ handler, args, expected }) => {
    capturedWpCliArgs = undefined;
    spawnMock.mockClear();

    const result = await handler.execute(args, makeServices());

    // If the result is an error, show it to help debug permission/whitelist issues
    if ('content' in result && !result.content[0]?.text?.includes('success')) {
      console.log(`Tool returned error:`, result.content[0]?.text);
    }

    expect(capturedWpCliArgs).toEqual(expected);
  });
});
