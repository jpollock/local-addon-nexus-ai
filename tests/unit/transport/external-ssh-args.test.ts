import {
  buildExternalSshArgs,
  buildExternalWpCliCommand,
  buildSshConfigDumpArgs,
  EXTERNAL_SSH_TIMEOUT_MS,
} from '../../../src/main/transport/ssh-args';

describe('buildExternalSshArgs', () => {
  it('does NOT pass -F /dev/null — external hosts depend on ~/.ssh/config', () => {
    // The single most important assertion in this milestone. buildWpeSshArgs
    // passes -F /dev/null deliberately so WPE connections ignore the user's
    // config. Copying that here would break every bastion, jump host and
    // agent-auth setup, and would look like a network fault rather than a bug.
    const args = buildExternalSshArgs('acme-box', 'wp core version');
    expect(args).not.toContain('/dev/null');
    expect(args).not.toContain('-F');
  });

  it('pins the exact argv', () => {
    expect(buildExternalSshArgs('acme-box', 'wp core version')).toEqual([
      '-o', 'BatchMode=yes',
      'acme-box',
      'wp core version',
    ]);
  });

  it('passes the alias through verbatim so ssh_config resolves it', () => {
    expect(buildExternalSshArgs('web-01.prod_eu', 'true').at(-2)).toBe('web-01.prod_eu');
  });
});

describe('buildExternalWpCliCommand', () => {
  it('builds a bare wp command when no path is given', () => {
    expect(buildExternalWpCliCommand(['core', 'version']))
      .toBe("wp 'core' 'version'");
  });

  it('adds --path when one is given', () => {
    expect(buildExternalWpCliCommand(['core', 'version'], '/var/www/html'))
      .toBe("wp --path='/var/www/html' 'core' 'version'");
  });

  it('does NOT add --skip-plugins/--skip-themes', () => {
    // Those exist for WPE's mu-plugin environment. An arbitrary host gets plain wp.
    expect(buildExternalWpCliCommand(['plugin', 'list'])).not.toContain('--skip-plugins');
  });

  it('escapes embedded single quotes in args and path', () => {
    expect(buildExternalWpCliCommand(['option', 'update', 'x', "Bob's"]))
      .toBe("wp 'option' 'update' 'x' 'Bob'\\''s'");
    expect(buildExternalWpCliCommand(['core', 'version'], "/srv/it's"))
      .toBe("wp --path='/srv/it'\\''s' 'core' 'version'");
  });
});

describe('buildExternalWpCliCommand — wpCliBin', () => {
  it('defaults to bare wp when no binary is given', () => {
    expect(buildExternalWpCliCommand(['core', 'version'])).toBe("wp 'core' 'version'");
  });

  it('uses and escapes an explicit binary path', () => {
    expect(buildExternalWpCliCommand(['core', 'version'], undefined, '/opt/cpanel/composer/bin/wp'))
      .toBe("'/opt/cpanel/composer/bin/wp' 'core' 'version'");
  });

  it('keeps wpCliBin third so wpPath is not transposed', () => {
    expect(buildExternalWpCliCommand(['core', 'version'], '/home/u/public_html', '/usr/local/bin/wp'))
      .toBe("'/usr/local/bin/wp' --path='/home/u/public_html' 'core' 'version'");
  });

  it('escapes a binary path containing a quote', () => {
    expect(buildExternalWpCliCommand(['x'], undefined, "/tmp/w'p"))
      .toBe("'/tmp/w'\\''p' 'x'");
  });
});

describe('buildExternalSshArgs — connectTimeoutSec', () => {
  it('omits ConnectTimeout by default', () => {
    expect(buildExternalSshArgs('h1', 'echo ok')).toEqual(['-o', 'BatchMode=yes', 'h1', 'echo ok']);
  });

  it('inserts ConnectTimeout before the alias when asked', () => {
    expect(buildExternalSshArgs('h1', 'echo ok', { connectTimeoutSec: 10 }))
      .toEqual(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'h1', 'echo ok']);
  });

  it('still never passes -F /dev/null', () => {
    expect(buildExternalSshArgs('h1', 'echo ok', { connectTimeoutSec: 10 })).not.toContain('-F');
  });
});

describe('buildSshConfigDumpArgs', () => {
  it('asks ssh to dump the resolved config for the alias', () => {
    expect(buildSshConfigDumpArgs('h1')).toEqual(['-G', 'h1']);
  });

  it('does not pass -F /dev/null', () => {
    expect(buildSshConfigDumpArgs('h1')).not.toContain('-F');
  });
});

it('pins the external SSH timeout', () => {
  expect(EXTERNAL_SSH_TIMEOUT_MS).toBe(20000);
});

describe('alias validation — argv injection', () => {
  it('rejects an alias that ssh would read as an option', () => {
    // -oProxyCommand=<cmd> in argv position makes ssh run <cmd> locally.
    expect(() => buildExternalSshArgs('-oProxyCommand=touch /tmp/pwned', 'wp core version'))
      .toThrow(/Invalid SSH host alias/);
  });

  it('rejects a bare leading hyphen', () => {
    expect(() => buildExternalSshArgs('-h1', 'echo ok')).toThrow(/Invalid SSH host alias/);
  });

  it('rejects shell and argv metacharacters, whitespace and empty', () => {
    for (const bad of ['a b', 'a;b', 'a|b', 'a$b', 'a`b', 'a\nb', 'user@host', 'a/b', '']) {
      expect(() => buildExternalSshArgs(bad, 'echo ok')).toThrow(/Invalid SSH host alias/);
    }
  });

  it('guards the ssh -G path too, not just the connect path', () => {
    // resolveSshConfig is the FIRST thing the probe runs, so this is the first
    // place a hostile alias would reach ssh.
    expect(() => buildSshConfigDumpArgs('-oProxyCommand=id')).toThrow(/Invalid SSH host alias/);
  });

  it('accepts the alias shapes real ssh config files use', () => {
    for (const good of ['h1', 'acme-box', 'web-01.prod_eu', 'a', 'A1', '9lives', 'x.y-z_1']) {
      expect(() => buildExternalSshArgs(good, 'echo ok')).not.toThrow();
      expect(() => buildSshConfigDumpArgs(good)).not.toThrow();
    }
  });

  it('leaves the WPE builder untouched — its argv is pinned elsewhere', () => {
    // Named so nobody "helpfully" extends the alias check to install names.
    const { buildWpeSshArgs } = require('../../../src/main/transport/ssh-args');
    expect(() => buildWpeSshArgs('-weird-install', 'wp core version', '/k')).not.toThrow();
  });
});
