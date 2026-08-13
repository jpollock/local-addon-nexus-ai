/**
 * One-time disclosure that enabling an agent lets it send site data to the configured AI provider
 * on its schedule (P0-5, part b).
 *
 * Chat has a persistent footer note naming the provider; agents run autonomously against
 * production with no such surface, so the moment of enabling is where the user is told — once.
 * Acknowledgment is a renderer-local flag (like the docked panel's state), not a synced setting:
 * it only governs whether this informational notice is shown again.
 */
const ACK_KEY = 'nexus-agent-data-disclosure-ack';

/** True once the user has acknowledged the one-time agent data-flow disclosure. */
export function hasAcknowledgedAgentDataDisclosure(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Record the acknowledgment so the notice never shows again. */
export function acknowledgeAgentDataDisclosure(): void {
  try {
    localStorage.setItem(ACK_KEY, '1');
  } catch {
    /* storage disabled (private mode) — worst case the notice shows again next time */
  }
}

/** Show the disclosure only when ENABLING (not disabling) and it has not been acknowledged. */
export function shouldShowAgentDataDisclosure(enabling: boolean, acknowledged: boolean): boolean {
  return enabling && !acknowledged;
}
