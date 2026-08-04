/**
 * `nexus host` CLI behaviour that the GraphQL-level tests cannot reach:
 * exit codes, and what gets printed when the addon answers oddly.
 *
 * The command module is re-required per test. Commander stores parsed option
 * values on the Command instance, so a shared instance leaks flags between
 * parses — `--json` from one test would still be set in the next.
 */

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
  it('sends null rather than a default when --env is omitted', async () => {
    // The commander default is gone: the resolver must be able to tell
    // "unspecified" from "the user chose production".
    const mutate = jest.fn().mockResolvedValue({
      nexusHostAdd: {
        success: true, error: null, registered: true, environment: 'staging',
        report: { ok: true, alias: 'h1', hostname: 'x', port: '22' },
      },
    });
    await run(loadHostCommand(mutate), ['add', 'h1', '--yes']);
    expect(mutate.mock.calls[0][1]).toMatchObject({ alias: 'h1', environment: null });
  });

  it('prints the resolver\'s environment in the try line, not the flag', async () => {
    const mutate = jest.fn().mockResolvedValue({
      nexusHostAdd: {
        success: true, error: null, registered: true, environment: 'staging',
        report: { ok: true, alias: 'h1', hostname: 'x', port: '22' },
      },
    });
    await run(loadHostCommand(mutate), ['add', 'h1', '--yes']);
    expect(out.join('\n')).toContain('ssh:h1@staging');
  });

  it('passes an explicit --env straight through', async () => {
    const mutate = jest.fn().mockResolvedValue({
      nexusHostAdd: {
        success: true, error: null, registered: true, environment: 'development',
        report: { ok: true, alias: 'h1', hostname: 'x', port: '22' },
      },
    });
    await run(loadHostCommand(mutate), ['add', 'h1', '--yes', '--env', 'development']);
    expect(mutate.mock.calls[0][1]).toMatchObject({ environment: 'development' });
  });

  it('never prompts under --json', async () => {
    // --json must be scriptable: no probe round trip for a preview, no confirm.
    const mutate = jest.fn().mockResolvedValue({
      nexusHostAdd: {
        success: true, error: null, registered: true, environment: 'production',
        report: { ok: true, alias: 'h1', hostname: 'x', port: '22' },
      },
    });
    await run(loadHostCommand(mutate), ['add', 'h1', '--json']);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out[0])).toMatchObject({ registered: true, environment: 'production' });
  });
});
