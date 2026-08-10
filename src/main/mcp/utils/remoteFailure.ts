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
