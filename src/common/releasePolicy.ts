/**
 * Remote release policy — the shared, fail-safe evaluator behind the kill switch (T-KILLSWITCH,
 * P1-7 / IR-1). The CLI and the main process both fetch `latest.json` and evaluate it here so the
 * rule lives in one place.
 *
 * Fail-safe is the whole point: a null/absent/malformed policy (unreachable `latest.json`, a field
 * missing or the wrong type) NEVER blocks the tool or disables agents. A release-server outage or a
 * garbled file must not brick an install or halt everyone's agents — the switch can only ever turn
 * things OFF deliberately, never as a side effect of failure.
 */

export interface ReleasePolicy {
  version?: string;
  /** Running versions strictly below this are blocked. */
  minSupportedVersion?: string;
  /** Exact versions that are blocked. */
  blockedVersions?: string[];
  /** Hard remote kill switch for autonomous agents, independent of version. */
  disableAgents?: boolean;
}

export interface PolicyVerdict {
  /** The running version is below minSupportedVersion or explicitly blocked. */
  versionBlocked: boolean;
  /** Agents must not run: version-blocked, or the disableAgents kill switch is set. */
  agentsDisabled: boolean;
  /** Human-readable reason, when something is blocked/disabled. */
  reason?: string;
}

/** True if `a` is strictly a lower version than `b` (numeric dotted compare; non-numeric parts → 0). */
export function isVersionBelow(a: string, b: string): boolean {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

export function evaluateReleasePolicy(
  policy: ReleasePolicy | null | undefined,
  currentVersion: string,
): PolicyVerdict {
  const safe: PolicyVerdict = { versionBlocked: false, agentsDisabled: false };
  if (!policy || typeof policy !== 'object') return safe;
  try {
    const blocked = Array.isArray(policy.blockedVersions) ? policy.blockedVersions : [];
    const explicitlyBlocked = blocked.includes(currentVersion);
    const belowMin =
      typeof policy.minSupportedVersion === 'string' &&
      isVersionBelow(currentVersion, policy.minSupportedVersion);
    const versionBlocked = explicitlyBlocked || belowMin;
    const agentsDisabled = versionBlocked || policy.disableAgents === true;

    let reason: string | undefined;
    if (explicitlyBlocked) reason = `version ${currentVersion} is blocked by the release policy`;
    else if (belowMin)
      reason = `version ${currentVersion} is below the minimum supported version ${policy.minSupportedVersion}`;
    else if (policy.disableAgents === true) reason = 'agents are remotely disabled by the release policy';

    return { versionBlocked, agentsDisabled, reason };
  } catch {
    return safe; // malformed policy must never block or disable
  }
}
