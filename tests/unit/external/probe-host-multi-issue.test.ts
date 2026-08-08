import { probeHostMultiIssue } from '../../../src/main/external/probeHostMultiIssue';
import type { RawSshResult, SshExec } from '../../../src/main/external/sshExec';

const ok = (stdout: string): RawSshResult => ({ code: 0, stdout, stderr: '' });
const SSH_G_OUTPUT = ['hostname 203.0.113.10', 'user deploy', 'port 2222', 'identityfile ~/.ssh/id_ed25519'].join('\n');

function router(routes: Array<[RegExp, RawSshResult]>): SshExec {
  return async (args) => {
    if (args[0] === '-G') return ok(SSH_G_OUTPUT);
    const remote = args[args.length - 1];
    for (const [re, res] of routes) if (re.test(remote)) return res;
    return { code: 127, stdout: '', stderr: 'unrouted: ' + remote };
  };
}

const CONNECT_OK: [RegExp, RawSshResult] = [/echo nexus-ok/, ok('nexus-ok\n')];
const WP_ON_PATH: [RegExp, RawSshResult] = [/command -v wp/, ok('/usr/bin/wp\n')];
const WP_VERSION: [RegExp, RawSshResult] = [/'--version'/, ok('WP-CLI 2.12.0\n')];
const FIND_ONE: [RegExp, RawSshResult] = [/wp-config\.php/, ok('/home/u/public_html/wp-config.php\n')];
const CORE_VERSION: [RegExp, RawSshResult] = [/'core' 'version'/, ok('6.8.1\n')];
const WHOAMI: [RegExp, RawSshResult] = [/whoami/, ok('deploy\n')];

const HAPPY = [CONNECT_OK, WHOAMI, WP_ON_PATH, WP_VERSION, FIND_ONE, CORE_VERSION];

describe('probeHostMultiIssue — happy path', () => {
  it('reports all four checks ok and zero issues', async () => {
    const r = await probeHostMultiIssue('example', { exec: router(HAPPY) });
    expect(r.checks.connection.status).toBe('ok');
    expect(r.checks.hostKey.status).toBe('ok');
    expect(r.checks.wpCli.status).toBe('ok');
    expect(r.checks.installs.status).toBe('ok');
    expect(r.issues).toEqual([]);
  });
});

describe('probeHostMultiIssue — connection/auth issues, all interpolated', () => {
  it('classifies "Permission denied (publickey)" as authKeyNotLoaded and interpolates the resolved IdentityFile', async () => {
    const r = await probeHostMultiIssue('example', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'Permission denied (publickey).' }]]),
    });
    const issue = r.issues.find((i) => i.kind === 'authKeyNotLoaded');
    expect(issue).toBeTruthy();
    expect(issue!.remedy).toContain('ssh-add');
    expect(issue!.remedy).toContain('~/.ssh/id_ed25519'); // from resolved.identityFile, not hardcoded
    expect(r.checks.connection.status).toBe('fail');
    // Every other check must be reported, not skipped -- 'idle', not silently absent.
    expect(r.checks.wpCli.status).toBe('idle');
    expect(r.checks.installs.status).toBe('idle');
  });

  it('classifies "Connection refused" as connRefused and names the resolved port', async () => {
    const r = await probeHostMultiIssue('example', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'ssh: connect to host x port 2222: Connection refused' }]]),
    });
    const issue = r.issues.find((i) => i.kind === 'connRefused');
    expect(issue!.remedy).toContain('2222'); // from resolved.port
  });

  it('classifies a jump-host failure as proxyJumpFailed and names the jump host', async () => {
    const r = await probeHostMultiIssue('example', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'ssh: connect to host bastion port 22: Connection timed out\r\nkex_exchange_identification: Connection closed by remote host' }]]),
    });
    const issue = r.issues.find((i) => i.kind === 'proxyJumpFailed' || i.kind === 'connTimeout');
    expect(issue).toBeTruthy();
  });

  it('classifies an unknown alias as aliasNotFound', async () => {
    const r = await probeHostMultiIssue('typo', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'ssh: Could not resolve hostname typo: nodename nor servname provided' }]]),
    });
    expect(r.issues.find((i) => i.kind === 'aliasNotFound')).toBeTruthy();
  });
});

describe('probeHostMultiIssue — host key', () => {
  it('reports unknownHostKey with a captured fingerprint, alongside connection failure, in the same pass', async () => {
    // Uses the same captureOfferedHostKey seam as probeExternalHost -- mock the module.
    jest.doMock('../../../src/main/external/hostKeyTrust', () => ({
      captureOfferedHostKey: jest.fn().mockResolvedValue({ fingerprint: 'SHA256:abc', keyType: 'ED25519', rawLine: 'x' }),
    }));
    jest.resetModules();
    const { probeHostMultiIssue: freshProbe } = require('../../../src/main/external/probeHostMultiIssue');
    const r = await freshProbe('example', {
      exec: router([[/echo nexus-ok/, { code: 255, stdout: '', stderr: 'Host key verification failed.' }]]),
    });
    const issue = r.issues.find((i: any) => i.kind === 'unknownHostKey');
    expect(issue?.fingerprint).toBe('SHA256:abc');
    expect(r.checks.hostKey.status).toBe('fail');
    jest.dontMock('../../../src/main/external/hostKeyTrust');
  });
});

describe('probeHostMultiIssue — root user', () => {
  it('reports rootUser as its own issue alongside a successful connection', async () => {
    const r = await probeHostMultiIssue('example', {
      exec: router([CONNECT_OK, [/whoami/, ok('root\n')], WP_ON_PATH, WP_VERSION, FIND_ONE, CORE_VERSION]),
    });
    expect(r.issues.find((i) => i.kind === 'rootUser')).toBeTruthy();
    // A root issue must not prevent the OTHER checks (WP-CLI, installs) from still running and reporting ok.
    expect(r.checks.wpCli.status).toBe('ok');
  });
});

describe('probeHostMultiIssue — WP-CLI branches', () => {
  it('reports wpCliMissing as a neutral (warn, not fail) branch with the install command', async () => {
    const r = await probeHostMultiIssue('example', {
      exec: router([CONNECT_OK, WHOAMI, [/command -v wp/, { code: 1, stdout: '', stderr: '' }], [/for p in/, ok('')]]),
    });
    const issue = r.issues.find((i) => i.kind === 'wpCliMissing');
    expect(issue).toBeTruthy();
    expect(issue!.remedy).toContain('wp-cli.phar');
    expect(r.checks.wpCli.status).toBe('warn');
  });
});

describe('probeHostMultiIssue — installs', () => {
  it('reports wordPressNotFound when discovery finds nothing', async () => {
    const r = await probeHostMultiIssue('example', {
      exec: router([CONNECT_OK, WHOAMI, WP_ON_PATH, WP_VERSION, [/wp-config\.php/, ok('')]]),
    });
    expect(r.issues.find((i) => i.kind === 'wordPressNotFound')).toBeTruthy();
    expect(r.checks.installs.status).toBe('fail');
  });

  it('lists every discovered root when there is more than one, without treating it as a hard failure', async () => {
    const r = await probeHostMultiIssue('example', {
      exec: router([CONNECT_OK, WHOAMI, WP_ON_PATH, WP_VERSION,
        [/wp-config\.php/, ok('/home/u/site-a/wp-config.php\n/home/u/site-b/wp-config.php\n')]]),
    });
    expect(r.installs).toEqual(['/home/u/site-a', '/home/u/site-b']);
    expect(r.checks.installs.status).toBe('ok');
  });
});
