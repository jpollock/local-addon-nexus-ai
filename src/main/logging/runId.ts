/**
 * A correlation id, stamped on every log line and audit entry produced by one unit of work.
 *
 * This is the thing that makes the whole design queryable: `grep run=r_8f3a2c logs/**\/*.log`
 * reassembles a run across the combined stream, the per-agent file and the audit trail. It is
 * short because a person types it into a grep, and time-prefixed because sorting a grep result
 * should give chronological order without a second pass.
 *
 * A bare `Date.now()` was not enough: AGENT_RUN_NOW invokes the runner once per selected site,
 * back to back, so runs collide inside a millisecond. Uniqueness is structural, not
 * probabilistic: a per-millisecond counter ensures two ids minted in the same millisecond
 * differ by construction, not by luck. A random suffix wide enough to make 1000 same-ms
 * collisions negligible would not fit the 16-char budget; "unlikely" is the wrong property
 * for a correlation key — a collision silently merges two runs in every grep that uses it.
 */
export type RunKind = 'agent' | 'chat' | 'gateway';

const PREFIX: Record<RunKind, string> = { agent: 'r', chat: 'c', gateway: 'g' };

// Process-scoped counter for same-millisecond uniqueness. This module is instantiated once
// per Electron main process, so this counter is process-global and remains valid across all
// callers. Do not refactor to make this configurable or request-scoped — the scope is the
// process, and that is the scope that matters for log correlation.
let lastMs = 0;
let seq = 0;

export function newRunId(kind: RunKind): string {
  const ms = Date.now();
  if (ms === lastMs) {
    seq++;
  } else {
    lastMs = ms;
    seq = 0;
  }
  const time = ms.toString(36).padStart(8, '0');
  const tail = seq.toString(36).padStart(2, '0');
  return `${PREFIX[kind]}_${time}${tail}`;
}
