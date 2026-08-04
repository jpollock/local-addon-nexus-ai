/**
 * wp_theme_activate must reach a WP Engine install WITH --skip-themes.
 *
 * That flag is the tool's entire reason to exist: it lets a broken active theme
 * be swapped out on an install where the theme fatals during bootstrap. The
 * hazard was documented in ssh-args.ts as unreachable because
 * ALLOWED_REMOTE_COMMANDS blocked `theme activate` before dispatch. Removing
 * that whitelist made it reachable, and the all-or-nothing skip-flag ternary
 * then emitted a bare `wp 'theme' 'activate' '<slug>'`.
 *
 * These two assertions have to travel together: the first proves the command
 * dispatches, which is exactly what re-arms the second.
 */
import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

const resolveTransportMock = jest.fn();
jest.mock('../../../src/main/transport', () => ({
  ...jest.requireActual('../../../src/main/transport'),
  resolveTransport: (...args: any[]) => resolveTransportMock(...args),
}));

import { themeActivateHandler } from '../../../src/main/mcp/modules/wp-cli/theme-activate';
import { WpeSshTransport } from '../../../src/main/transport/WpeSshTransport';
import { withPolicy, REMOTE_POLICY, checkCommand } from '../../../src/main/transport/policy';

function fakeProc(opts: { code?: number; stdout?: string } = {}) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    proc.emit('close', opts.code ?? 0);
  });
  return proc;
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => fakeProc({ stdout: 'Success: Switched to theme.' }));
  resolveTransportMock.mockReset();
});

describe('wp_theme_activate on WP Engine', () => {
  it('is no longer blocked by the unified remote policy', () => {
    expect(checkCommand(['theme', 'activate', 'twentytwentyone'], REMOTE_POLICY)).toBeNull();
  });

  it('emits --skip-themes and omits --skip-plugins', async () => {
    resolveTransportMock.mockResolvedValue(
      withPolicy(new WpeSshTransport('acmeprod'), REMOTE_POLICY),
    );

    const res = await themeActivateHandler.execute(
      { install_name: 'acmeprod', slug: 'twentytwentyone' },
      {} as any,
    );

    expect(res.isError).toBeFalsy();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("wp --skip-themes 'theme' 'activate' 'twentytwentyone'");
  });
});
