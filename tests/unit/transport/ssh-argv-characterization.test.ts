/**
 * Golden-argv characterization for the two duplicated SSH implementations.
 * Written BEFORE the transport refactor; must pass UNCHANGED after it.
 */
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import { createLocalServicesBridge } from '../../../src/main/mcp/local-services-bridge';
import { executeSentinelCommands } from '../../../src/main/sentinel/SentinelExecutor';

const EXPECTED_KEY = path.join(
  os.homedir(), 'Library', 'Application Support', 'Local', 'ssh', 'wpe-connect',
);

export const SHARED_SSH_OPTS = [
  '-F', '/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
  '-o', 'ServerAliveInterval=60',
  '-o', 'ServerAliveCountMax=120',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ControlMaster=auto',
  '-o', 'ControlPath=/tmp/ssh-nexus-%C',
  '-o', 'ControlPersist=30s',
  '-i', EXPECTED_KEY,
];

function fakeProc(opts: { code?: number; stdout?: string; stderr?: string } = {}) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.code ?? 0);
  });
  return proc;
}

describe('WPE SSH argv — golden characterization', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  describe('remoteWpCliRun (local-services-bridge)', () => {
    const bridge = () => createLocalServicesBridge({} as any);

    it('builds the exact ssh argv, with skip flags by default', async () => {
      await bridge().remoteWpCliRun('acmeprod', ['plugin', 'list', '--format=json']);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = spawnMock.mock.calls[0];
      expect(cmd).toBe('ssh');
      expect(args).toEqual([
        ...SHARED_SSH_OPTS,
        'local+ssh+acmeprod@acmeprod.ssh.wpengine.net',
        "wp --skip-plugins --skip-themes 'plugin' 'list' '--format=json'",
      ]);
      expect(opts).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], timeout: 35000 });
    });

    it('omits both skip flags when both are explicitly false', async () => {
      // The legacy `wp  'post' 'list'` shape — two spaces — is still reachable,
      // and RemoteContentExtractor still emits exactly it. What changed is that
      // it now takes both flags to get there.
      await bridge().remoteWpCliRun('acmeprod', ['post', 'list'], { skipPlugins: false, skipThemes: false });
      expect(spawnMock.mock.calls[0][1].at(-1)).toBe("wp  'post' 'list'");
    });

    it('drops only --skip-plugins when only skipPlugins is false', async () => {
      // DELIBERATE CHANGE from the original characterization. The all-or-nothing
      // ternary this pinned is what discarded wp_theme_activate's skipThemes
      // once the remote command whitelist was removed.
      await bridge().remoteWpCliRun('acmeprod', ['post', 'list'], { skipPlugins: false });
      expect(spawnMock.mock.calls[0][1].at(-1)).toBe("wp --skip-themes 'post' 'list'");
    });

    it('shell-escapes embedded single quotes', async () => {
      await bridge().remoteWpCliRun('acmeprod', ['option', 'update', 'blogname', "Bob's Site"]);
      expect(spawnMock.mock.calls[0][1].at(-1))
        .toBe("wp --skip-plugins --skip-themes 'option' 'update' 'blogname' 'Bob'\\''s Site'");
    });

    it('on non-zero exit returns stderr in stdout (NOT stdout)', async () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'partial', stderr: 'boom' }));
      const result = await bridge().remoteWpCliRun('acmeprod', ['core', 'version']);
      expect(result).toEqual({ stdout: 'boom', success: false });
    });

    it('on non-zero exit with no stderr reports the exit code', async () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 7 }));
      const result = await bridge().remoteWpCliRun('acmeprod', ['core', 'version']);
      expect(result).toEqual({ stdout: 'SSH exited with code 7', success: false });
    });

    it('resolves (never rejects) on spawn error', async () => {
      spawnMock.mockImplementation(() => {
        const proc: any = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setImmediate(() => proc.emit('error', new Error('ENOENT')));
        return proc;
      });
      await expect(bridge().remoteWpCliRun('acmeprod', ['core', 'version']))
        .resolves.toEqual({ stdout: 'ENOENT', success: false });
    });
  });

  describe('remoteSshRaw (SentinelExecutor)', () => {
    const stubServices: any = { remoteWpCliRun: jest.fn() };

    it('builds the same ssh argv with a bare rm command', async () => {
      await executeSentinelCommands('acmeprod', ['rm wp-content/mu-plugins/evil.php'], stubServices);

      const [cmd, args, opts] = spawnMock.mock.calls[0];
      expect(cmd).toBe('ssh');
      expect(args).toEqual([
        ...SHARED_SSH_OPTS,
        'local+ssh+acmeprod@acmeprod.ssh.wpengine.net',
        "rm -f '/nas/content/live/acmeprod/wp-content/mu-plugins/evil.php'",
      ]);
      expect(opts).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], timeout: 35000 });
    });

    it('on failure prefers stdout over stderr — the OPPOSITE of remoteWpCliRun', async () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'from-stdout', stderr: 'from-stderr' }));
      const res = await executeSentinelCommands('acmeprod', ['rm evil.php'], stubServices);
      expect(res.success).toBe(false);
      expect(res.steps[0].error).toBe('from-stdout');
    });
  });
});
