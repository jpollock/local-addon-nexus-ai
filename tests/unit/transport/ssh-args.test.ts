import * as path from 'path';
import * as os from 'os';
import {
  buildWpeSshArgs, buildWpCliCommand, escapeShellArg, wpeSshKeyPath, WPE_SSH_TIMEOUT_MS,
} from '../../../src/main/transport/ssh-args';

const STUB_KEY = '/stub/ssh/wpe-connect';

describe('escapeShellArg', () => {
  it('wraps in single quotes', () => {
    expect(escapeShellArg('plugin')).toBe("'plugin'");
  });
  it('escapes embedded single quotes', () => {
    expect(escapeShellArg("Bob's")).toBe("'Bob'\\''s'");
  });
});

describe('buildWpCliCommand', () => {
  it('adds skip flags by default', () => {
    expect(buildWpCliCommand(['plugin', 'list', '--format=json']))
      .toBe("wp --skip-plugins --skip-themes 'plugin' 'list' '--format=json'");
  });
  it('keeps --skip-themes when only skipPlugins is false', () => {
    // The flags are independent. skipPlugins: false used to zero the whole flag
    // string, which is what silently stripped --skip-themes from
    // wp_theme_activate once the remote whitelist stopped blocking it.
    expect(buildWpCliCommand(['post', 'list'], { skipPlugins: false }))
      .toBe("wp --skip-themes 'post' 'list'");
  });
  it('keeps --skip-plugins when only skipThemes is false', () => {
    expect(buildWpCliCommand(['post', 'list'], { skipThemes: false }))
      .toBe("wp --skip-plugins 'post' 'list'");
  });
  it('honours theme-activate: --skip-themes without --skip-plugins', () => {
    // The exact opts wp_theme_activate sends. Losing --skip-themes here breaks
    // crash recovery on a WP Engine install whose active theme fatals.
    expect(buildWpCliCommand(['theme', 'activate', 'twentytwentyone'], { skipPlugins: false, skipThemes: true }))
      .toBe("wp --skip-themes 'theme' 'activate' 'twentytwentyone'");
  });
  it('omits both flags only when both are false, leaving the legacy double space', () => {
    // NOTE the two spaces after `wp`. The template is
    // `wp ${skipFlags} ${args}`.trim() — with skipFlags empty, trim() only
    // strips the ends, so the interior gap survives. This is the string
    // RemoteContentExtractor executes over SSH today. Do NOT "fix" it.
    expect(buildWpCliCommand(['post', 'list'], { skipPlugins: false, skipThemes: false }))
      .toBe("wp  'post' 'list'");
  });
});

describe('buildWpeSshArgs', () => {
  it('produces the pinned argv', () => {
    expect(buildWpeSshArgs('acmeprod', 'rm -f /tmp/x', STUB_KEY)).toEqual([
      '-F', '/dev/null',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
      '-o', 'ServerAliveInterval=60',
      '-o', 'ServerAliveCountMax=120',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ControlMaster=auto',
      '-o', 'ControlPath=/tmp/ssh-nexus-%C',
      '-o', 'ControlPersist=30s',
      '-i', STUB_KEY,
      'local+ssh+acmeprod@acmeprod.ssh.wpengine.net',
      'rm -f /tmp/x',
    ]);
  });

  it('defaults the key path to the Local userData location', () => {
    expect(buildWpeSshArgs('a', 'true').at(-3))
      .toBe(path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'ssh', 'wpe-connect'));
  });
});

describe('wpeSshKeyPath', () => {
  afterEach(() => { delete (process as any).electronPaths; });

  it('prefers electronPaths.userDataPath when Local provides it', () => {
    (process as any).electronPaths = { userDataPath: '/custom/userdata' };
    expect(wpeSshKeyPath()).toBe(path.join('/custom/userdata', 'ssh', 'wpe-connect'));
  });

  it('falls back to os.homedir() when electronPaths is undefined', () => {
    delete (process as any).electronPaths;
    expect(wpeSshKeyPath()).toBe(
      path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'ssh', 'wpe-connect')
    );
  });
});

it('pins the SSH timeout', () => {
  expect(WPE_SSH_TIMEOUT_MS).toBe(35000);
});
