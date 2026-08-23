import { describeRemoteFailure, REMOTE_SSH_TIMEOUT_MS } from '../../../src/main/mcp/utils/remoteFailure';

describe('REMOTE_SSH_TIMEOUT_MS', () => {
  it('clears the documented cold-start ceiling with real headroom', () => {
    // The bridge's own comment puts WP Engine SSH cold start at 13-30s, and the previous 35s
    // budget killed a live call at 35.07s. A deadline anywhere near 30s turns an ordinary cold
    // start into a reported failure, so this pins the headroom rather than the number.
    expect(REMOTE_SSH_TIMEOUT_MS).toBeGreaterThan(30_000 * 1.5);
  });
});

const PQ_WARNING =
  '** WARNING: connection is not using a post-quantum key exchange algorithm.\n'
  + '** This session may be vulnerable to "store now, decrypt later" attacks.\n'
  + '** The server may need to be upgraded. See https://openssh.com/pq.html\n';

describe('describeRemoteFailure', () => {
  it('names a timeout as a timeout', () => {
    // The real case, measured live: dur=35074ms against a 35000ms spawn timeout. The handler
    // ignored the signal entirely and reported stderr, so a timeout was indistinguishable from a
    // WP-CLI failure.
    const msg = describeRemoteFailure({
      code: null, signal: 'SIGTERM', stderr: '', elapsedMs: 35074, timeoutMs: 35000,
    });
    expect(msg).toContain('Timed out after 35s');
  });

  it('does not let a stderr warning masquerade as the cause of a timeout', () => {
    // This host prints the OpenSSH post-quantum advisory on every connection, so `stderr ||
    // ...` reported that warning for EVERY failure regardless of what actually went wrong.
    const msg = describeRemoteFailure({
      code: null, signal: 'SIGTERM', stderr: PQ_WARNING, elapsedMs: 35074, timeoutMs: 35000,
    });
    expect(msg.startsWith('Timed out after 35s')).toBe(true);
    // REVERSED 2026-08-23. This used to assert the warning was KEPT as
    // context — "real output, just not the reason" — which was reasonable
    // when the only concern was mislabelling. It is no longer tenable: the
    // advisory is unconditional (every WP Engine connection prints it, on
    // success and failure alike), it is ~230 characters, and it arrives
    // BEFORE the real error. On the fleet run that day it consumed the
    // caller's whole 200-char budget and hid "The concurrent connection limit
    // of 5 connections per user has been reached" — the actual cause, which
    // had to be recovered by reproducing the command by hand.
    //
    // Context that is always present carries no information and displaces
    // context that does. It is dropped.
    expect(msg).not.toContain('post-quantum');
  });

  it('leads with the exit code, then the output, for an ordinary failure', () => {
    const msg = describeRemoteFailure({
      code: 1, signal: null, stderr: "Error: The site you have requested is not installed.\n",
      elapsedMs: 900, timeoutMs: 35000,
    });
    expect(msg).toContain('exited with code 1');
    expect(msg).toContain('not installed');
  });

  it('still surfaces a real error that arrives alongside a warning', () => {
    // The failure mode that made this worth fixing: the genuine error was discarded whenever a
    // warning shared the stream.
    const msg = describeRemoteFailure({
      code: 1, signal: null, stderr: PQ_WARNING + "Error: 'wp-config.php' not found.\n",
      elapsedMs: 1200, timeoutMs: 35000,
    });
    expect(msg).toContain("'wp-config.php' not found");
    expect(msg).toContain('exited with code 1');
  });

  it('says something useful when the command failed silently', () => {
    const msg = describeRemoteFailure({ code: 255, signal: null, stderr: '', elapsedMs: 300, timeoutMs: 35000 });
    expect(msg).toContain('exited with code 255');
    expect(msg).not.toMatch(/undefined|null/);
  });

  it('reports a signal kill that is not the timeout as a signal kill', () => {
    // Killed early — the server or the OS did it, not our deadline. Calling that a timeout would
    // send someone looking at the wrong thing.
    const msg = describeRemoteFailure({
      code: null, signal: 'SIGKILL', stderr: '', elapsedMs: 1200, timeoutMs: 35000,
    });
    expect(msg).toContain('SIGKILL');
    expect(msg).not.toContain('Timed out');
  });

  it('collapses the noise so the message stays readable', () => {
    const msg = describeRemoteFailure({
      code: 1, signal: null, stderr: PQ_WARNING, elapsedMs: 500, timeoutMs: 35000,
    });
    // One line, not four — these end up in a log line and in a tool error shown to an agent.
    expect(msg.split('\n')).toHaveLength(1);
  });

  it('never returns an empty string', () => {
    expect(describeRemoteFailure({ code: 0, signal: null, stderr: '', elapsedMs: 1, timeoutMs: 35000 }).length)
      .toBeGreaterThan(0);
  });
});

/**
 * OpenSSH's post-quantum advisory is three lines of stderr on EVERY WP Engine
 * connection, and it arrives BEFORE the real error. Callers that truncate the
 * reason therefore truncate away the only part that matters.
 *
 * Measured 2026-08-23: the fleet run logged
 * "the first page failed: Command exited with code 1 — output: ** WARNING:
 *  connection is not using a post-quantum key exchange algorithm. ** This
 *  session may be vulnerable to ... ** The server m"
 * — cut off mid-banner. The actual message, recovered only by reproducing the
 * command by hand, was "The concurrent connection limit of 5 connections per
 * user has been reached."
 */
describe('describeRemoteFailure — the OpenSSH advisory does not crowd out the error', () => {
  const BANNER = [
    '** WARNING: connection is not using a post-quantum key exchange algorithm.',
    '** This session may be vulnerable to "store now, decrypt later" attacks.',
    '** The server may need to be upgraded. See https://openssh.com/pq.html',
  ].join('\n');

  test('the real error leads, with the banner dropped', () => {
    const out = describeRemoteFailure({
      code: 1, signal: null, elapsedMs: 700, timeoutMs: 120000,
      stderr: `${BANNER}\nThe concurrent connection limit of 5 connections per user has been reached.`,
    });

    expect(out).toContain('concurrent connection limit of 5');
    expect(out).not.toContain('post-quantum');
    expect(out).not.toContain('store now');
  });

  // The counterpart: dropping too much is the opposite failure. Anything that
  // is not this specific advisory must survive, including other `**` lines.
  test('a non-advisory message is kept, including one that starts with **', () => {
    const out = describeRemoteFailure({
      code: 1, signal: null, elapsedMs: 10, timeoutMs: 120000,
      stderr: '** IMPORTANT: disk quota exceeded\nError: could not write',
    });

    expect(out).toContain('disk quota exceeded');
    expect(out).toContain('could not write');
  });

  test('a banner with no other output still reports the exit code', () => {
    const out = describeRemoteFailure({
      code: 255, signal: null, elapsedMs: 40, timeoutMs: 120000, stderr: BANNER,
    });

    expect(out).toContain('255');
    expect(out).not.toContain('post-quantum');
  });
});
