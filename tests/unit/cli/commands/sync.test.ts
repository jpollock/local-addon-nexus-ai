/**
 * `nexus sync push` confirmation behavior.
 *
 * Replaces a set of tautological tests that used to live in
 * cli-commands.functional.test.ts (they asserted string literals defined in
 * the test itself, e.g. `expect('y'.toLowerCase() === 'y').toBe(true)` --
 * they'd have passed identically even if the real prompt in sync.ts were
 * deleted). These drive the real `push` action via commander's parseAsync,
 * the same pattern already used in host.test.ts: readline mocked at the
 * module level, process.exit spied and converted into a catchable error, and
 * the GraphQL client's `mutate` replaced with a jest.fn so no real network
 * call happens.
 */

class ExitError extends Error {
  constructor(readonly code: number) { super(`process.exit(${code})`); }
}

function loadSyncCommand(mutate: jest.Mock) {
  jest.resetModules();
  jest.doMock('../../../../src/cli/utils/graphql', () => ({
    getClient: () => ({ mutate }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../../../src/cli/commands/sync').syncCommand;
}

function mockReadlineAnswer(answer: string) {
  jest.doMock('readline', () => ({
    createInterface: () => ({
      question: (_q: string, cb: (answer: string) => void) => cb(answer),
      close: jest.fn(),
    }),
  }));
}

/**
 * jest.doMock registrations are NOT cleared by jest.resetModules() or
 * jest.restoreAllMocks() -- once one test in this file calls
 * mockReadlineAnswer(), that mock silently leaks into every LATER test that
 * doesn't call it again, including tests meant to prove a prompt is never
 * reached at all (--yes should skip it). Without a reset, such a test can't
 * tell "the code correctly skipped the prompt" from "the code asked, and a
 * stale mock from an earlier test answered it" -- proven empirically: deleting
 * sync.ts's --yes check entirely left all of this file's tests passing.
 *
 * Call this at the start of every test (before any test-specific
 * mockReadlineAnswer() override) so a prompt that shouldn't be reached fails
 * loudly -- a thrown error inside the Promise executor rejects the answer
 * promise, which sync.ts's own try/catch converts into a process.exit(1),
 * which then fails the test's assertions on `mutate` / `exitCodes` -- rather
 * than silently succeeding via a leftover answer from a different test.
 */
function resetReadlineMockToFailLoudly() {
  jest.doMock('readline', () => ({
    createInterface: () => ({
      question: () => {
        throw new Error('prompt should not have been reached -- --yes should have skipped it');
      },
      close: jest.fn(),
    }),
  }));
}

let out: string[];
let err: string[];
let exitCodes: number[];
let originalIsTTY: boolean | undefined;

beforeEach(() => {
  out = [];
  err = [];
  exitCodes = [];
  originalIsTTY = process.stdin.isTTY;
  jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { out.push(a.join(' ')); });
  jest.spyOn(console, 'error').mockImplementation((...a: any[]) => { err.push(a.join(' ')); });
  jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    throw new ExitError(code ?? 0);
  }) as any);
  // Default to "fail loudly if reached" before every test. A test that needs
  // a real answer calls mockReadlineAnswer() itself, AFTER this, to override
  // it for that one test only.
  resetReadlineMockToFailLoudly();
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
});

/** Every action body is wrapped in try/catch that calls process.exit(1) on
 * error, so the ExitError thrown by the first exit() is caught there and
 * re-thrown by a second exit() -- swallow it here and assert on exitCodes. */
async function run(cmd: any, argv: string[]): Promise<void> {
  try {
    await cmd.parseAsync(argv, { from: 'user' });
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
  }
}

function successPushMutate() {
  return jest.fn().mockResolvedValue({
    nexusSyncPush: {
      success: true, error: null, linkCreated: false, installCreated: false,
      bytesTransferred: null, duration: null,
    },
  });
}

describe('nexus sync push — files-only confirmation (interactive TTY)', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  it('declining the files-only prompt exits before any GraphQL call happens', async () => {
    mockReadlineAnswer('n');
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging']);

    expect(mutate).not.toHaveBeenCalled();
    expect(exitCodes[0]).toBe(0);
    expect(out.join('\n')).toContain('Cancelled');
  });

  it('accepting the files-only prompt (y) proceeds to call the mutation', async () => {
    mockReadlineAnswer('y');
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging']);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][1]).toMatchObject({
      input: expect.objectContaining({ localSite: 'mysite@local', wpeTarget: 'wpe:acct/inst@staging' }),
    });
    expect(exitCodes).toEqual([]);
  });

  it('accepting the files-only prompt (yes) also proceeds', async () => {
    mockReadlineAnswer('yes');
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging']);

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('--yes skips the prompt entirely (no readline interaction needed)', async () => {
    // No mockReadlineAnswer() call -- the outer beforeEach's
    // resetReadlineMockToFailLoudly() is still in effect, so if the code path
    // tried to prompt, readline's mocked question() would throw synchronously
    // rather than hang. Reaching the mutate call at all proves the prompt was
    // skipped.
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging', '--yes']);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(exitCodes).toEqual([]);
  });

  it('--db still runs the heavyweight "type yes" prompt, unaffected by the files-only branch', async () => {
    mockReadlineAnswer('yes');
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging', '--db']);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][1]).toMatchObject({ input: expect.objectContaining({ includeDb: true }) });
  });

  it('--db declines with anything other than the exact word "yes"', async () => {
    mockReadlineAnswer('y'); // valid for files-only, NOT valid for the db ritual
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging', '--db']);

    expect(mutate).not.toHaveBeenCalled();
    expect(exitCodes[0]).toBe(0);
  });

  it('--db --yes skips the prompt entirely', async () => {
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging', '--db', '--yes']);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(exitCodes).toEqual([]);
  });
});

describe('nexus sync push — non-interactive stdin', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  });

  it('refuses rather than hanging when stdin is not a TTY and --yes is not passed', async () => {
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging']);

    expect(mutate).not.toHaveBeenCalled();
    expect(exitCodes[0]).toBe(1);
    expect(err.join('\n')).toContain('--yes');
  });

  it('refuses on a non-TTY stdin for a --db push too, without --yes', async () => {
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging', '--db']);

    expect(mutate).not.toHaveBeenCalled();
    expect(exitCodes[0]).toBe(1);
  });

  it('--yes on a non-TTY stdin proceeds without prompting', async () => {
    const mutate = successPushMutate();

    await run(loadSyncCommand(mutate), ['push', 'mysite@local', '--to', 'wpe:acct/inst@staging', '--yes']);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(exitCodes).toEqual([]);
  });
});
