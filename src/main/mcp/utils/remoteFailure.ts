/**
 * Why a remote SSH/WP-CLI call failed, said honestly.
 *
 * The close handler used to be `stdout: stderr || \`SSH exited with code ${code}\``, which has two
 * defects that compound:
 *
 * 1. **A timeout was never reported as a timeout.** `close`'s `signal` argument was ignored, so a
 *    call killed at the 35s deadline was indistinguishable from WP-CLI returning an error.
 * 2. **stderr masqueraded as the cause.** Any host that writes a warning to stderr reported that
 *    warning for *every* failure. Observed live on a real WP Engine install: OpenSSH prints a
 *    post-quantum key-exchange advisory on every connection, so a 35-second timeout surfaced to
 *    the user as "connection is not using a post-quantum key exchange algorithm" — an unrelated
 *    advisory, presented as the reason the command failed.
 *
 * The rule here: **lead with the actual failure, keep the output as context.** The cause is never
 * masked and the detail is never lost. One line, because this lands in a log line and in a tool
 * error handed to an agent.
 */

/**
 * How long a single remote WP-CLI/SSH call may take before it is abandoned.
 *
 * Was 35s, and that was marginal by the code's own account: WP Engine SSH cold-start variance is
 * 13–30s depending on server load, DB size and PHP process warmth. Measured live on a real
 * install, a `wp plugin list` was killed at 35.07s — the deadline itself, not the server giving
 * up. 60s is twice the documented ceiling, and matches the 60s this codebase already allows a
 * batched external-SSH call.
 *
 * Raising it costs nothing for the common case: a warm call through the ControlMaster socket
 * returns in 1–3s, and a genuinely unreachable host still fails immediately on DNS rather than
 * waiting out the deadline. What it buys is that a slow-but-alive server is not reported as a
 * failure — which, before `describeRemoteFailure`, was reported as whatever warning happened to
 * be on stderr.
 *
 * Note for anyone tuning this: the multiplexed socket (see `SSH_CONTROL_PERSIST` below) now
 * outlives typical agent cadences, so the 1–3s warm path is the common case for scheduled
 * agents. Historically `ControlPersist=30s` expired before every 2-minute cadence, which is why
 * calls were reaching the timeout ceiling — the socket was always cold and the cold start is
 * 13–30s. That is fixed.
 */
export const REMOTE_SSH_TIMEOUT_MS = 60_000;

/**
 * How long the multiplexed SSH socket outlives its last command.
 *
 * Was 30s, which is shorter than every agent cadence in this codebase — an agent on a 2-minute
 * schedule found the socket already gone and paid the full 13-30s WP Engine cold start on every
 * single call, which is how calls were reaching the timeout ceiling at all.
 *
 * The cost of raising it is an authenticated socket to a production server staying open longer,
 * which is why this is 10 minutes rather than an hour: long enough that a scheduled agent reuses
 * it, short enough that an idle machine is not holding connections indefinitely.
 */
export const SSH_CONTROL_PERSIST = '600s';

export interface RemoteFailure {
  /** Process exit code; null when the process was killed by a signal. */
  code: number | null;
  /** Signal that killed the process, if any. Node's spawn timeout sends SIGTERM. */
  signal: string | null;
  /** Everything the command wrote to stderr — warnings and errors alike. */
  stderr: string;
  elapsedMs: number;
  /** The deadline that was in force, so a kill at the deadline can be named as one. */
  timeoutMs: number;
}

/**
 * OpenSSH's post-quantum advisory, printed to stderr on EVERY WP Engine
 * connection — three lines, ~230 characters, arriving BEFORE the real error.
 *
 * It is dropped because it is unconditional noise that displaces signal: any
 * caller truncating the reason truncates away the part that matters. Measured
 * 2026-08-23, the fleet run logged `... — output: ** WARNING: connection is
 * not using a post-quantum key exchange algorithm. ** This session may be
 * vulnerable to ... ** The server m` — cut off mid-banner, with the actual
 * cause ("The concurrent connection limit of 5 connections per user has been
 * reached") never reaching the log at all.
 *
 * Matched on the advisory's own wording rather than on the `**` prefix, so a
 * genuine message that happens to start with `**` still survives.
 */
const SSH_PQ_ADVISORY = /^\*\*.*(post-quantum|store now, decrypt later|openssh\.com\/pq)/i;

/** Squash multi-line output into one readable line, dropping blank runs. */
function oneLine(text: string, limit = 400): string {
  const flat = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !SSH_PQ_ADVISORY.test(l))
    .join(' ');
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export function describeRemoteFailure(f: RemoteFailure): string {
  const context = oneLine(f.stderr ?? '');
  const withContext = (lead: string) => (context ? `${lead} — output: ${context}` : lead);

  // A signal kill at (or just before) the deadline is our own timeout. The 5% slack absorbs the
  // gap between the deadline firing and `close` arriving; a kill well inside the deadline came
  // from somewhere else and must not be mislabelled, or it sends someone hunting a timeout that
  // never happened.
  if (f.signal && f.elapsedMs >= f.timeoutMs * 0.95) {
    return withContext(`Timed out after ${Math.round(f.timeoutMs / 1000)}s with no response`);
  }
  if (f.signal) {
    return withContext(`Killed by ${f.signal} after ${Math.round(f.elapsedMs)}ms`);
  }
  return withContext(`Command exited with code ${f.code}`);
}
