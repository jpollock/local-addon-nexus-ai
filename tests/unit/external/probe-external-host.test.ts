import { resolveSshConfig } from '../../../src/main/external/sshExec';
import type { RawSshResult, SshExec } from '../../../src/main/external/sshExec';

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });

function execReturning(stdout: string, seen: string[][] = []): SshExec {
  return async (args) => { seen.push(args); return ok(stdout); };
}

const SSH_G_OUTPUT = [
  'host example',
  'user deploy',
  'hostname 203.0.113.10',
  'port 2222',
  'identityfile ~/.ssh/id_ed25519',
].join('\n');

describe('resolveSshConfig', () => {
  it('parses hostname, user and port from ssh -G', async () => {
    const cfg = await resolveSshConfig('example', execReturning(SSH_G_OUTPUT));
    expect(cfg).toEqual({ hostname: '203.0.113.10', user: 'deploy', port: '2222' });
  });

  it('invokes ssh -G <alias> and nothing else', async () => {
    const seen: string[][] = [];
    await resolveSshConfig('example', execReturning(SSH_G_OUTPUT, seen));
    expect(seen).toEqual([['-G', 'example']]);
  });

  it('is case-insensitive on keys, as ssh -G output can vary', async () => {
    const cfg = await resolveSshConfig('example', execReturning('HostName 10.0.0.1\nUser bob\nPort 22'));
    expect(cfg).toEqual({ hostname: '10.0.0.1', user: 'bob', port: '22' });
  });

  it('falls back to the alias and sane defaults when ssh -G yields nothing', async () => {
    const cfg = await resolveSshConfig('example', async () => ({ code: 255, stdout: '', stderr: 'boom' }));
    expect(cfg).toEqual({ hostname: 'example', user: '', port: '22' });
  });
});

import { probeExternalHost } from '../../../src/main/external/probeExternalHost';

/**
 * Route fake results by matching the remote command (the last argv element).
 * `-G` is matched separately since it carries no remote command.
 */
function router(routes: Array<[RegExp, RawSshResult]>, seen: string[][] = []): SshExec {
  return async (args) => {
    seen.push(args);
    if (args[0] === '-G') return ok(SSH_G_OUTPUT);
    const remote = args[args.length - 1];
    for (const [re, res] of routes) if (re.test(remote)) return res;
    return { code: 127, stdout: '', stderr: 'unrouted: ' + remote };
  };
}

const CONNECT_OK: [RegExp, RawSshResult] = [/echo nexus-ok/, ok('nexus-ok\n')];
const WP_ON_PATH: [RegExp, RawSshResult] = [/command -v wp/, ok('/usr/bin/wp\n')];
const WP_VERSION: [RegExp, RawSshResult] = [/--version/, ok('WP-CLI 2.12.0\n')];
const FIND_ONE: [RegExp, RawSshResult] = [/wp-config\.php/, ok('/home/u/public_html/wp-config.php\n')];
const CORE_VERSION: [RegExp, RawSshResult] = [/'core' 'version'/, ok('6.8.1\n')];
const SITEURL: [RegExp, RawSshResult] = [/'option' 'get' 'siteurl'/, ok('https://example.com\n')];

const HAPPY = [CONNECT_OK, WP_ON_PATH, WP_VERSION, FIND_ONE, CORE_VERSION, SITEURL];

describe('probeExternalHost — happy path', () => {
  it('reports ok with everything it discovered', async () => {
    const r = await probeExternalHost('example', { exec: router(HAPPY) });
    expect(r.ok).toBe(true);
    expect(r.failure).toBeUndefined();
    expect(r.wpPath).toBe('/home/u/public_html');
    expect(r.wpVersion).toBe('6.8.1');
    expect(r.wpCliVersion).toBe('2.12.0');
    expect(r.siteUrl).toBe('https://example.com');
    expect(r.resolved).toEqual({ hostname: '203.0.113.10', user: 'deploy', port: '2222' });
  });

  it('leaves wpCliPath undefined when wp is on PATH', async () => {
    const r = await probeExternalHost('example', { exec: router(HAPPY) });
    expect(r.wpCliPath).toBeUndefined();
  });

  it('skips discovery when a path is supplied, and escapes it', async () => {
    const seen: string[][] = [];
    const r = await probeExternalHost('example', {
      wpPath: "/home/u/o'brien",
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION, CORE_VERSION, SITEURL], seen),
    });
    expect(r.ok).toBe(true);
    expect(r.wpPath).toBe("/home/u/o'brien");
    const remotes = seen.map((a) => a[a.length - 1]);
    expect(remotes.some((c) => /wp-config\.php/.test(c))).toBe(false);
    expect(remotes.some((c) => c.includes("--path='/home/u/o'\\''brien'"))).toBe(true);
  });

  it('survives a siteurl failure — a broken DB must not block registration', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION, FIND_ONE, CORE_VERSION,
        [/'option' 'get' 'siteurl'/, { code: 1, stdout: '', stderr: 'Error establishing a database connection' }]]),
    });
    expect(r.ok).toBe(true);
    expect(r.siteUrl).toBeUndefined();
  });
});

describe('probeExternalHost — gate 1', () => {
  it('diagnoses password-only auth with a pasteable ssh-copy-id line', async () => {
    const r = await probeExternalHost('example', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'deploy@203.0.113.10: Permission denied (publickey,password).' }]]),
    });
    expect(r.ok).toBe(false);
    expect(r.failure?.kind).toBe('auth-failed');
    // Must carry the RESOLVED user and port, not the alias.
    expect(r.failure?.remedy).toContain('ssh-copy-id');
    expect(r.failure?.remedy).toContain('-p 2222');
    expect(r.failure?.remedy).toContain('deploy@203.0.113.10');
    expect(r.failure?.remedy).not.toContain('example@');
    // ssh's own words survive — that is what a user searches for.
    expect(r.failure?.detail).toContain('Permission denied (publickey,password)');
  });

  it('diagnoses an unconfigured alias at gate 1, not before it', async () => {
    const seen: string[][] = [];
    const r = await probeExternalHost('typo', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'ssh: Could not resolve hostname typo: nodename nor servname provided' }]], seen),
    });
    expect(r.failure?.kind).toBe('alias-not-found');
    expect(r.failure?.remedy).toContain('~/.ssh/config');
    // ssh -G ran, and did NOT reject the alias by itself.
    expect(seen[0]).toEqual(['-G', 'typo']);
    expect(seen.some((a) => /echo nexus-ok/.test(a[a.length - 1]))).toBe(true);
  });

  it('reports anything else as unreachable with stderr verbatim', async () => {
    const r = await probeExternalHost('example', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'ssh: connect to host port 22: Connection refused' }]]),
    });
    expect(r.failure?.kind).toBe('unreachable');
    expect(r.failure?.detail).toContain('Connection refused');
  });

  it('reports a local spawn failure as unreachable', async () => {
    const r = await probeExternalHost('example', {
      exec: async (args) => (args[0] === '-G'
        ? ok(SSH_G_OUTPUT)
        : { code: null, stdout: '', stderr: '', spawnError: 'spawn ssh ENOENT' }),
    });
    expect(r.failure?.kind).toBe('unreachable');
    expect(r.failure?.detail).toContain('ENOENT');
  });
});

describe('probeExternalHost — gate 2', () => {
  it('falls back to known locations when wp is off PATH, and stores the path', async () => {
    const r = await probeExternalHost('example', {
      exec: router([
        CONNECT_OK,
        [/command -v wp/, { code: 1, stdout: '', stderr: '' }],
        [/for p in /, ok('/opt/cpanel/composer/bin/wp\n')],
        WP_VERSION, FIND_ONE, CORE_VERSION, SITEURL,
      ]),
    });
    expect(r.ok).toBe(true);
    expect(r.wpCliPath).toBe('/opt/cpanel/composer/bin/wp');
  });

  it('uses the discovered binary for every later command', async () => {
    const seen: string[][] = [];
    await probeExternalHost('example', {
      exec: router([
        CONNECT_OK,
        [/command -v wp/, { code: 1, stdout: '', stderr: '' }],
        [/for p in /, ok('/opt/cpanel/composer/bin/wp\n')],
        WP_VERSION, FIND_ONE, CORE_VERSION, SITEURL,
      ], seen),
    });
    const coreCall = seen.map((a) => a[a.length - 1]).find((c) => /'core' 'version'/.test(c))!;
    expect(coreCall.startsWith("'/opt/cpanel/composer/bin/wp' ")).toBe(true);
  });

  it('refuses with an install command when WP-CLI is genuinely absent', async () => {
    const r = await probeExternalHost('example', {
      exec: router([
        CONNECT_OK,
        [/command -v wp/, { code: 1, stdout: '', stderr: '' }],
        [/for p in /, { code: 1, stdout: '', stderr: '' }],
      ]),
    });
    expect(r.failure?.kind).toBe('wp-cli-missing');
    expect(r.failure?.remedy).toContain('wp-cli.phar');
    expect(r.ok).toBe(false);
  });
});

describe('probeExternalHost — gate 3', () => {
  it('finds WordPress under ~/domains/<site>/public_html', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION,
        [/wp-config\.php/, ok('/home/u/domains/example.com/public_html/wp-config.php\n')],
        CORE_VERSION, SITEURL]),
    });
    expect(r.wpPath).toBe('/home/u/domains/example.com/public_html');
  });

  it('asks for --path when nothing is found', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION, [/wp-config\.php/, { code: 1, stdout: '', stderr: '' }]]),
    });
    expect(r.failure?.kind).toBe('wordpress-not-found');
    expect(r.failure?.remedy).toContain('--path');
  });

  it('lists every candidate and refuses when several are found', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION,
        [/wp-config\.php/, ok('/home/u/a/wp-config.php\n/home/u/b/wp-config.php\n')],
        CORE_VERSION, SITEURL]),
    });
    expect(r.failure?.kind).toBe('multiple-wordpress');
    expect(r.candidates).toEqual(['/home/u/a', '/home/u/b']);
    expect(r.failure?.remedy).toContain('--path');
  });

  it('deduplicates repeated roots rather than calling them ambiguous', async () => {
    const r = await probeExternalHost('example', {
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION,
        [/wp-config\.php/, ok('/home/u/a/wp-config.php\n/home/u/a/wp-config.php\n')],
        CORE_VERSION, SITEURL]),
    });
    expect(r.ok).toBe(true);
    expect(r.wpPath).toBe('/home/u/a');
  });
});

describe('probeExternalHost — gate 4', () => {
  it("reports WP-CLI's own message when the path is not WordPress", async () => {
    const r = await probeExternalHost('example', {
      wpPath: '/home/u/empty',
      exec: router([CONNECT_OK, WP_ON_PATH, WP_VERSION,
        [/'core' 'version'/, { code: 1, stdout: '', stderr: "Error: This does not seem to be a WordPress installation." }]]),
    });
    expect(r.failure?.kind).toBe('wordpress-not-found');
    expect(r.failure?.detail).toContain('does not seem to be a WordPress installation');
  });
});
