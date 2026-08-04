/**
 * Shared conformance suite. Every SiteTransport implementation must pass it.
 * Spec 1 and Spec 2 transports plug in here — a new transport is "done" when
 * this passes.
 */
import { EventEmitter } from 'events';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import type { SiteTransport } from '../../../src/main/transport/types';
import { WpeSshTransport } from '../../../src/main/transport/WpeSshTransport';
import { LocalTransport } from '../../../src/main/transport/LocalTransport';
import { ExternalSshTransport } from '../../../src/main/transport/ExternalSshTransport';

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

/**
 * The gate every SiteTransport implementation must pass.
 *
 * Callers supply TWO fixtures: one whose underlying call succeeds and one whose
 * underlying call fails. Requiring both is the point — the previous version
 * tested only the happy path, so a transport that threw on failure, or returned
 * an empty diagnostic, passed.
 */
export interface ConformanceFixtures {
  /** Transport whose underlying execution succeeds. */
  ok: () => SiteTransport;
  /** Transport whose underlying execution fails (non-zero exit or spawn error). */
  failing: () => SiteTransport;
}

const ALL_CAPABILITIES = [
  'wp-cli', 'arbitrary-options', 'db-query', 'eval',
  'search-replace', 'core-update', 'theme-activate',
] as const;

export function runTransportConformance(name: string, fx: ConformanceFixtures) {
  describe(`SiteTransport conformance — ${name}`, () => {
    it('exposes a non-empty kind and a siteRef with a kind discriminant', () => {
      const t = fx.ok();
      expect(typeof t.kind).toBe('string');
      expect(t.kind.length).toBeGreaterThan(0);
      expect(t.siteRef).toBeDefined();
      expect(typeof t.siteRef.kind).toBe('string');
    });

    it('supports() returns a boolean for every seeded capability', () => {
      const t = fx.ok();
      for (const cap of ALL_CAPABILITIES) {
        expect(typeof t.supports(cap)).toBe('boolean');
      }
    });

    it('runWpCli succeeds on the happy path and returns a string-or-null stdout', async () => {
      const r = await fx.ok().runWpCli(['core', 'version']);
      expect(r.success).toBe(true);
      expect(r.stdout === null || typeof r.stdout === 'string').toBe(true);
    });

    it('runWpCli RESOLVES with success:false on failure — never rejects', async () => {
      const r = await fx.failing().runWpCli(['core', 'version']);
      expect(r.success).toBe(false);
    });

    it('runWpCli failure carries diagnostic output rather than an empty string', async () => {
      const r = await fx.failing().runWpCli(['core', 'version']);
      expect(String(r.stdout ?? '')).not.toBe('');
    });

    it('runWpCli accepts RunOpts without throwing', async () => {
      await expect(
        fx.ok().runWpCli(['core', 'version'], { skipPlugins: false, timeoutMs: 5000 }),
      ).resolves.toHaveProperty('success');
    });

    it('runWpCli survives two sequential calls', async () => {
      const t = fx.ok();
      const a = await t.runWpCli(['core', 'version']);
      const b = await t.runWpCli(['plugin', 'list']);
      expect(a.success).toBe(true);
      expect(b.success).toBe(true);
    });

    it('deleteRemoteFile resolves with {success, output} on both paths', async () => {
      const okRes = await fx.ok().deleteRemoteFile('/tmp/nexus-conformance-probe');
      expect(typeof okRes.success).toBe('boolean');
      expect(typeof okRes.output).toBe('string');

      const failRes = await fx.failing().deleteRemoteFile('/tmp/nexus-conformance-probe');
      expect(typeof failRes.success).toBe('boolean');
      expect(typeof failRes.output).toBe('string');
    });

    it('probe() reports reachable=true on the happy path', async () => {
      const p = await fx.ok().probe();
      expect(p.reachable).toBe(true);
    });

    it('probe() reports reachable=false when unreachable, and never rejects', async () => {
      const p = await fx.failing().probe();
      expect(p.reachable).toBe(false);
    });
  });
}

describe('WpeSshTransport', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  runTransportConformance('WpeSshTransport', {
    ok: () => {
      spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
      return new WpeSshTransport('acmeprod');
    },
    failing: () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'boom-out', stderr: 'boom-err' }));
      return new WpeSshTransport('acmeprod');
    },
  });

  it('runWpCli sends the same argv the legacy path did', async () => {
    await new WpeSshTransport('acmeprod').runWpCli(['plugin', 'list', '--format=json']);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args.at(-2)).toBe('local+ssh+acmeprod@acmeprod.ssh.wpengine.net');
    expect(args.at(-1)).toBe("wp --skip-plugins --skip-themes 'plugin' 'list' '--format=json'");
    expect(opts.timeout).toBe(35000);
  });

  it('runWpCli returns stderr on failure (legacy remoteWpCliRun shape)', async () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'partial', stderr: 'boom' }));
    await expect(new WpeSshTransport('acmeprod').runWpCli(['core', 'version']))
      .resolves.toEqual({ stdout: 'boom', success: false });
  });

  it('deleteRemoteFile issues a bare rm -f and returns stdout on failure (legacy remoteSshRaw shape)', async () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1, stdout: 'from-stdout', stderr: 'from-stderr' }));
    const res = await new WpeSshTransport('acmeprod')
      .deleteRemoteFile('/nas/content/live/acmeprod/evil.php');
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acmeprod/evil.php'");
    expect(res).toEqual({ success: false, output: 'from-stdout' });
  });

  it('deleteRemoteFile escapes single quotes in the path', async () => {
    await new WpeSshTransport('acme').deleteRemoteFile("/nas/content/live/acme/it's.php");
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("rm -f '/nas/content/live/acme/it'\\''s.php'");
  });
});

describe('LocalTransport', () => {
  const services = () => ({
    wpCliRun: jest.fn(async () => ({ stdout: 'WordPress 6.8', success: true })),
  }) as any;

  runTransportConformance('LocalTransport', {
    ok: () => new LocalTransport('site-1', 'Test Site', {
      wpCliRun: jest.fn(async () => ({ stdout: 'WordPress 6.8', success: true })),
    } as any),
    failing: () => new LocalTransport('site-1', 'Test Site', {
      wpCliRun: jest.fn(async () => ({ stdout: 'wp-cli not found', success: false })),
    } as any),
  });

  it('delegates runWpCli to localServices with the site id', async () => {
    const s = services();
    await new LocalTransport('site-1', 'Test Site', s).runWpCli(['core', 'version']);
    expect(s.wpCliRun).toHaveBeenCalledWith('site-1', ['core', 'version']);
  });

  it('passes timeoutMs through', async () => {
    const s = services();
    await new LocalTransport('site-1', 'Test Site', s).runWpCli(['core', 'version'], { timeoutMs: 5000 });
    expect(s.wpCliRun).toHaveBeenCalledWith('site-1', ['core', 'version'], { timeoutMs: 5000 });
  });

  it('refuses deleteRemoteFile — local sites have no remote filesystem', async () => {
    const res = await new LocalTransport('site-1', 'Test Site', services())
      .deleteRemoteFile('/tmp/x');
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/not supported/i);
  });
});

describe('LocalTransport — stopped site', () => {
  function svc(status: string) {
    return {
      wpCliRun: jest.fn().mockResolvedValue({ stdout: 'ran', success: true }),
      getSiteStatus: jest.fn().mockReturnValue(status),
    } as any;
  }

  it('refuses with an actionable message when the site is not running', async () => {
    const s = svc('halted');
    const t = new LocalTransport('id-1', 'mysite', s);
    const res = await t.runWpCli(['core', 'version']);
    expect(res.success).toBe(false);
    expect(res.stdout).toContain('mysite');
    expect(res.stdout).toContain('halted');
    expect(res.stdout).toMatch(/start it first/i);
    expect(s.wpCliRun).not.toHaveBeenCalled();
  });

  it('runs normally when the site is running', async () => {
    const s = svc('running');
    const res = await new LocalTransport('id-1', 'mysite', s).runWpCli(['core', 'version']);
    expect(res.success).toBe(true);
    expect(s.wpCliRun).toHaveBeenCalled();
  });

  it('runs when the host cannot report status, rather than refusing', async () => {
    const s = { wpCliRun: jest.fn().mockResolvedValue({ stdout: 'ran', success: true }) } as any;
    const res = await new LocalTransport('id-1', 'mysite', s).runWpCli(['core', 'version']);
    expect(res.success).toBe(true);
  });
});

describe('ExternalSshTransport', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
  });

  runTransportConformance('ExternalSshTransport', {
    ok: () => {
      spawnMock.mockImplementation(() => fakeProc({ stdout: 'WordPress 6.8' }));
      return new ExternalSshTransport('acme-box');
    },
    failing: () => {
      spawnMock.mockImplementation(() => fakeProc({ code: 1, stderr: 'ssh: connect refused' }));
      return new ExternalSshTransport('acme-box');
    },
  });

  it('invokes ssh with the alias and a bare wp command', async () => {
    await new ExternalSshTransport('acme-box').runWpCli(['core', 'version']);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args).toEqual(['-o', 'BatchMode=yes', 'acme-box', "wp 'core' 'version'"]);
    expect(opts.timeout).toBe(20000);
  });

  it('passes --path through when constructed with one', async () => {
    await new ExternalSshTransport('acme-box', '/var/www/html').runWpCli(['core', 'version']);
    expect(spawnMock.mock.calls[0][1].at(-1))
      .toBe("wp --path='/var/www/html' 'core' 'version'");
  });

  it('hints about WP-CLI provisioning when wp is missing', async () => {
    spawnMock.mockImplementation(() =>
      fakeProc({ code: 127, stderr: 'bash: wp: command not found' }));
    const res = await new ExternalSshTransport('acme-box').runWpCli(['core', 'version']);
    expect(res.success).toBe(false);
    expect(res.stdout).toMatch(/nexus host test/i);
  });

  it('hints about --path when WordPress is not found', async () => {
    spawnMock.mockImplementation(() => fakeProc({
      code: 1, stderr: 'Error: This does not seem to be a WordPress installation.',
    }));
    const res = await new ExternalSshTransport('acme-box').runWpCli(['core', 'version']);
    expect(res.stdout).toMatch(/--path=/);
  });

  it('refuses deleteRemoteFile — Sentinel remediation is WP Engine only', async () => {
    const res = await new ExternalSshTransport('acme-box').deleteRemoteFile('/tmp/x');
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/not supported/i);
  });
});
