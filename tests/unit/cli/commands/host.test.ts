/**
 * `nexus host` CLI behaviour that the GraphQL-level tests cannot reach:
 * exit codes, and what gets printed when the addon answers oddly.
 *
 * The command module is re-required per test. Commander stores parsed option
 * values on the Command instance, so a shared instance leaks flags between
 * parses — `--json` from one test would still be set in the next.
 */

// Without a top-level import/export TS treats this file as a GLOBAL script,
// and its ExitError/out/err declarations collide with sync.test.ts's when
// jest assigns both to one worker — the whole suite then aborts with
// TS-redeclaration errors and its tests silently vanish from the run
// (WP-05 finding 7, root-caused in WP-06). This makes the file a module.
export {};

class ExitError extends Error {
  constructor(readonly code: number) { super(`process.exit(${code})`); }
}

function loadHostCommand(mutate: jest.Mock) {
  jest.resetModules();
  jest.doMock('../../../../src/cli/utils/graphql', () => ({
    getClient: () => ({ mutate }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../../../src/cli/commands/host').hostCommand;
}

let out: string[];
let err: string[];
let exitCodes: number[];

beforeEach(() => {
  out = [];
  err = [];
  exitCodes = [];
  jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { out.push(a.join(' ')); });
  jest.spyOn(console, 'error').mockImplementation((...a: any[]) => { err.push(a.join(' ')); });
  jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    throw new ExitError(code ?? 0);
  }) as any);
});

afterEach(() => jest.restoreAllMocks());

/**
 * Run a subcommand. Every action body is wrapped in its own try/catch that
 * calls process.exit(1), so the ExitError thrown by the first exit is caught
 * there and re-thrown by a second exit — hence swallowing it here and asserting
 * on `exitCodes` rather than on what escapes.
 */
async function run(cmd: any, argv: string[]): Promise<void> {
  try {
    await cmd.parseAsync(argv, { from: 'user' });
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
  }
}

describe('host list --json', () => {
  it('prints the hosts and exits 0 when the resolver succeeds', async () => {
    const mutate = jest.fn().mockResolvedValue({
      nexusHostList: { success: true, error: null, hosts: [{ alias: 'h1', environment: 'staging' }] },
    });
    await run(loadHostCommand(mutate), ['list', '--json']);
    expect(exitCodes).toEqual([]);
    expect(JSON.parse(out.join('\n'))).toEqual([{ alias: 'h1', environment: 'staging' }]);
  });

  it('exits non-zero and surfaces the error when the resolver fails', async () => {
    // Regression: this printed `[]` and exited 0, so a script could not tell
    // "no hosts registered" from "the addon is broken".
    const mutate = jest.fn().mockResolvedValue({
      nexusHostList: { success: false, error: 'Storage not available', hosts: [] },
    });
    await run(loadHostCommand(mutate), ['list', '--json']);
    expect(exitCodes[0]).toBe(1);
    expect(JSON.parse(out[0])).toEqual({ error: 'Storage not available' });
  });

  it('still prints the empty array for a genuinely empty fleet', async () => {
    const mutate = jest.fn().mockResolvedValue({
      nexusHostList: { success: true, error: null, hosts: [] },
    });
    await run(loadHostCommand(mutate), ['list', '--json']);
    expect(exitCodes).toEqual([]);
    expect(JSON.parse(out[0])).toEqual([]);
  });
});

describe('host test — a failure report with no diagnosis', () => {
  it('prints a sentence instead of crashing on a null failure', async () => {
    // `ok` is non-null in the schema but `failure` is not, so this shape is
    // representable. Unguarded it produced
    // "✗ Cannot read properties of null (reading 'split')".
    const mutate = jest.fn().mockResolvedValue({
      nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'h1', failure: null },
      },
    });
    await run(loadHostCommand(mutate), ['test', 'h1']);
    expect(exitCodes[0]).toBe(1);
    const text = err.join('\n');
    expect(text).toContain('no diagnosis');
    expect(text).not.toContain('Cannot read properties');
  });

  it('still prints kind, detail and remedy when the failure is present', async () => {
    const mutate = jest.fn().mockResolvedValue({
      nexusHostProbe: {
        success: true, error: null,
        report: {
          ok: false, alias: 'h1',
          failure: { kind: 'auth-failed', detail: 'Permission denied', remedy: 'ssh-copy-id ...' },
        },
      },
    });
    await run(loadHostCommand(mutate), ['test', 'h1']);
    expect(exitCodes[0]).toBe(1);
    const text = err.join('\n');
    expect(text).toContain('auth-failed');
    expect(text).toContain('Permission denied');
    expect(text).toContain('ssh-copy-id');
  });
});

describe('host add — the environment it reports', () => {
  // A connection can now hold zero, one, or many sites, so `add` always probes
  // once (unqualified) before deciding whether to register directly or prompt
  // over candidates. Every case here is the single-root case, so the second
  // (and only the second) mutate call is nexusHostAdd.
  function singleRootMutate(addEnvironment: string) {
    return jest.fn().mockResolvedValue({
      nexusHostProbe: {
        success: true, error: null,
        report: { ok: true, alias: 'h1', hostname: 'x', port: '22', wpPath: '/home/u/public_html' },
      },
      nexusHostAdd: {
        success: true, error: null, registered: true, environment: addEnvironment,
        report: { ok: true, alias: 'h1', hostname: 'x', port: '22' },
      },
    });
  }

  it('sends null (not a local default) when --env is omitted, so the resolver decides', async () => {
    // C1: environment is resolved per-site, on the RESOLVER, not the CLI — a
    // site that's already registered must keep its own label, and only the
    // resolver knows whether one exists. The CLI must never default to
    // 'production' itself, or it would silently downgrade an existing site.
    const mutate = singleRootMutate('production');
    await run(loadHostCommand(mutate), ['add', 'h1', '--yes']);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1][1]).toMatchObject({ alias: 'h1', environment: null });
  });

  it('prints the resolver\'s environment in the try line, not the flag', async () => {
    const mutate = singleRootMutate('staging');
    await run(loadHostCommand(mutate), ['add', 'h1', '--yes']);
    expect(out.join('\n')).toContain('@staging');
  });

  it('passes an explicit --env straight through', async () => {
    const mutate = singleRootMutate('development');
    await run(loadHostCommand(mutate), ['add', 'h1', '--yes', '--env', 'development']);
    expect(mutate.mock.calls[1][1]).toMatchObject({ environment: 'development' });
  });

  it('never prompts under --json, and uses one consistent envelope', async () => {
    // --json must be scriptable: no confirmation, no per-candidate prompt.
    // It still probes first (that's how the CLI learns there's only one root),
    // then registers — two mutate calls, zero interactive prompts.
    const mutate = singleRootMutate('production');
    await run(loadHostCommand(mutate), ['add', 'h1', '--json']);
    expect(mutate).toHaveBeenCalledTimes(2);
    // C4: always {registered, sites, error} — a script can rely on
    // `.registered` and `.sites` existing on every branch, including success.
    expect(JSON.parse(out[0])).toEqual({
      registered: true,
      sites: [{ site: 'h1', registered: true, environment: 'production', error: null }],
      error: null,
    });
  });
});

describe('host add — multiple discovered sites', () => {
  function multiHostMutate() {
    return jest.fn()
      // 1. the initial, unqualified probe
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true, error: null,
          report: {
            ok: false, alias: 'multi-host',
            failure: { kind: 'multiple-wordpress', detail: 'Found 2.', remedy: 'Pass --path.' },
            candidates: ['/home/u1/site-a', '/home/u1/site-b'],
          },
        },
      })
      // 2. per-candidate probe for site-a
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true,
          report: { ok: true, alias: 'multi-host', wpPath: '/home/u1/site-a', siteUrl: 'https://alpha.example.com' },
        },
      })
      // 3. per-candidate probe for site-b
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true,
          report: { ok: true, alias: 'multi-host', wpPath: '/home/u1/site-b', siteUrl: 'https://beta.example.com' },
        },
      })
      // 4 & 5. one nexusHostAdd call per selected site
      .mockResolvedValueOnce({
        nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' },
      })
      .mockResolvedValueOnce({
        nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' },
      });
  }

  it('C3: --yes alone (no --all) refuses to auto-select more than one candidate', async () => {
    // -y used to mean "auto-select everything found," which on shared hosting
    // can include installs the caller doesn't own. It must now require the
    // explicit, named --all to expand scope beyond a single site.
    const mutate = jest.fn().mockResolvedValueOnce({
      nexusHostProbe: {
        success: true, error: null,
        report: {
          ok: false, alias: 'multi-host',
          failure: { kind: 'multiple-wordpress', detail: 'Found 2.', remedy: 'Pass --path.' },
          candidates: ['/home/u1/site-a', '/home/u1/site-b'],
        },
      },
    });
    await run(loadHostCommand(mutate), ['add', 'multi-host', '--yes']);
    expect(mutate).toHaveBeenCalledTimes(1); // never probed the candidates, never registered anything
    expect(exitCodes[0]).toBe(1);
    expect(err.join('\n')).toContain('--all');
  });

  it('C3/C4: --json alone (no --all) refuses with the same consistent envelope', async () => {
    const mutate = jest.fn().mockResolvedValueOnce({
      nexusHostProbe: {
        success: true, error: null,
        report: {
          ok: false, alias: 'multi-host',
          failure: { kind: 'multiple-wordpress', detail: 'Found 2.', remedy: 'Pass --path.' },
          candidates: ['/home/u1/site-a', '/home/u1/site-b'],
        },
      },
    });
    await run(loadHostCommand(mutate), ['add', 'multi-host', '--json']);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(exitCodes[0]).toBe(1);
    const payload = JSON.parse(out[0]);
    expect(payload.registered).toBe(false);
    expect(payload.sites).toEqual([]);
    expect(payload.error).toContain('--all');
  });

  it('--all registers every discovered candidate without prompting', async () => {
    const mutate = multiHostMutate();
    await run(loadHostCommand(mutate), ['add', 'multi-host', '--all']);

    // 1 discovery probe + 2 per-candidate probes + 2 registrations.
    expect(mutate).toHaveBeenCalledTimes(5);
    expect(mutate.mock.calls[3][1]).toMatchObject({
      alias: 'multi-host', path: '/home/u1/site-a', site: 'alpha',
    });
    expect(mutate.mock.calls[4][1]).toMatchObject({
      alias: 'multi-host', path: '/home/u1/site-b', site: 'beta',
    });
    expect(exitCodes).toEqual([]);
    expect(out.join('\n')).toContain('ssh:multi-host/alpha@production');
    expect(out.join('\n')).toContain('ssh:multi-host/beta@production');
  });

  it('--json --all registers every candidate and emits one consistent JSON envelope', async () => {
    const mutate = multiHostMutate();
    await run(loadHostCommand(mutate), ['add', 'multi-host', '--json', '--all']);

    expect(mutate).toHaveBeenCalledTimes(5);
    const summary = JSON.parse(out.join(''));
    expect(summary).toEqual({
      registered: true,
      sites: [
        { site: 'alpha', registered: true, environment: 'production', error: null },
        { site: 'beta', registered: true, environment: 'production', error: null },
      ],
      error: null,
    });
  });

  it('an explicit --path against a multi-site connection registers just that one root (--all/--yes not needed)', async () => {
    // Passing --path to probeExternalHost skips discovery, so the addon
    // reports back a single successful root rather than multiple-wordpress —
    // the CLI never needs to know the connection has siblings, and the
    // C3 multi-candidate refusal never triggers.
    const mutate = jest.fn().mockResolvedValue({
      nexusHostProbe: {
        success: true,
        report: { ok: true, alias: 'multi-host', wpPath: '/home/u1/site-a', siteUrl: 'https://alpha.example.com' },
      },
      nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' },
    });
    await run(loadHostCommand(mutate), ['add', 'multi-host', '--path', '/home/u1/site-a']);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1][1]).toMatchObject({ path: '/home/u1/site-a', site: 'alpha' });
  });

  it('C2: two candidates that derive the same slug are disambiguated, not clobbered', async () => {
    // shop.example.com and shop.example.net both suggest "shop". Without
    // dedup, the second nexusHostAdd call would silently overwrite the first
    // (same ssh:<alias>/<slug> id) while the CLI still prints two successes.
    const mutate = jest.fn()
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true, error: null,
          report: {
            ok: false, alias: 'shop-host',
            failure: { kind: 'multiple-wordpress', detail: 'Found 2.', remedy: 'Pass --path.' },
            candidates: ['/home/u1/shop-com', '/home/u1/shop-net'],
          },
        },
      })
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true,
          report: { ok: true, alias: 'shop-host', wpPath: '/home/u1/shop-com', siteUrl: 'https://shop.example.com' },
        },
      })
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true,
          report: { ok: true, alias: 'shop-host', wpPath: '/home/u1/shop-net', siteUrl: 'https://shop.example.net' },
        },
      })
      .mockResolvedValueOnce({
        nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' },
      })
      .mockResolvedValueOnce({
        nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' },
      });

    await run(loadHostCommand(mutate), ['add', 'shop-host', '--all']);

    expect(mutate).toHaveBeenCalledTimes(5);
    expect(mutate.mock.calls[3][1]).toMatchObject({ path: '/home/u1/shop-com', site: 'shop' });
    // The second candidate's slug collided and was disambiguated, not dropped.
    expect(mutate.mock.calls[4][1]).toMatchObject({ path: '/home/u1/shop-net', site: 'shop-2' });
    expect(out.join('\n')).toContain("registering this one as 'shop-2'");
  });
});

describe('host add — the interactive picker (C5)', () => {
  // readline is mocked at the module level so `readline.createInterface`
  // returns a fake interface whose `.question` answers from a canned queue —
  // no real stdin/stdout involved.
  function mockReadlineAnswers(answers: string[]) {
    let i = 0;
    jest.doMock('readline', () => ({
      createInterface: () => ({
        question: (_q: string, cb: (answer: string) => void) => cb(answers[i++] ?? ''),
        close: jest.fn(),
      }),
    }));
  }

  function discoveryMutate() {
    return jest.fn()
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true, error: null,
          report: {
            ok: false, alias: 'multi-host',
            failure: { kind: 'multiple-wordpress', detail: 'Found 2.', remedy: 'Pass --path.' },
            candidates: ['/home/u1/site-a', '/home/u1/site-b'],
          },
        },
      })
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true,
          report: { ok: true, alias: 'multi-host', wpPath: '/home/u1/site-a', siteUrl: 'https://alpha.example.com' },
        },
      })
      .mockResolvedValueOnce({
        nexusHostProbe: {
          success: true,
          report: { ok: true, alias: 'multi-host', wpPath: '/home/u1/site-b', siteUrl: 'https://beta.example.com' },
        },
      });
  }

  it('accepting the default (blank answer) registers with the auto-suggested slug', async () => {
    mockReadlineAnswers(['', '']);
    const mutate = discoveryMutate();
    mutate
      .mockResolvedValueOnce({ nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' } })
      .mockResolvedValueOnce({ nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' } });

    await run(loadHostCommand(mutate), ['add', 'multi-host']);

    expect(mutate).toHaveBeenCalledTimes(5);
    expect(mutate.mock.calls[3][1]).toMatchObject({ site: 'alpha' });
    expect(mutate.mock.calls[4][1]).toMatchObject({ site: 'beta' });
  });

  it('C6: "n" and "no" both skip a candidate', async () => {
    mockReadlineAnswers(['n', 'no']);
    const mutate = discoveryMutate();
    mutate.mockResolvedValueOnce({ nexusHostAdd: { success: true, error: null, registered: false } });

    await run(loadHostCommand(mutate), ['add', 'multi-host']);

    // Nothing selected — the 4th call is the zero-selection nexusHostAdd that
    // persists the connection, never a per-site registration.
    expect(mutate).toHaveBeenCalledTimes(4);
    expect(mutate.mock.calls[3][1]).toEqual({ alias: 'multi-host' });
    expect(out.join('\n')).toContain('No sites selected');
  });

  it('C6: "y" and "yes" both accept the suggested slug', async () => {
    mockReadlineAnswers(['y', 'yes']);
    const mutate = discoveryMutate();
    mutate
      .mockResolvedValueOnce({ nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' } })
      .mockResolvedValueOnce({ nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' } });

    await run(loadHostCommand(mutate), ['add', 'multi-host']);

    expect(mutate.mock.calls[3][1]).toMatchObject({ site: 'alpha' });
    expect(mutate.mock.calls[4][1]).toMatchObject({ site: 'beta' });
  });

  it('typing a custom name renames that one site', async () => {
    mockReadlineAnswers(['storefront', 'n']);
    const mutate = discoveryMutate();
    mutate.mockResolvedValueOnce({
      nexusHostAdd: { success: true, error: null, registered: true, environment: 'production' },
    });

    await run(loadHostCommand(mutate), ['add', 'multi-host']);

    expect(mutate).toHaveBeenCalledTimes(4); // discovery + 2 per-candidate probes + 1 registration
    expect(mutate.mock.calls[3][1]).toMatchObject({ site: 'storefront' });
  });

  it('selecting nothing prints the zero-site message and still registers the connection', async () => {
    mockReadlineAnswers(['n', 'n']);
    const mutate = discoveryMutate();
    mutate.mockResolvedValueOnce({ nexusHostAdd: { success: true, error: null, registered: false } });

    await run(loadHostCommand(mutate), ['add', 'multi-host']);

    expect(mutate).toHaveBeenCalledTimes(4);
    // The 4th call is the unqualified nexusHostAdd that persists the
    // zero-site connection — it must carry neither path nor site.
    expect(mutate.mock.calls[3][1]).toEqual({ alias: 'multi-host' });
    expect(out.join('\n')).toContain('No sites selected. Connection registered with zero sites.');
    expect(exitCodes).toEqual([]);
  });
});
