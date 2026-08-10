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
 * Note for anyone tuning this: `ControlPersist=30s` expires the multiplexed socket sooner than
 * most agent cadences, so a scheduled agent running every 2 minutes is cold on *every* call and
 * never sees the 1–3s warm path.
 */
export const REMOTE_SSH_TIMEOUT_MS = 60_000;

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

/** Squash multi-line output into one readable line, dropping blank runs. */
function oneLine(text: string, limit = 400): string {
  const flat = text.split('\n').map(l => l.trim()).filter(Boolean).join(' ');
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
