import { evaluateReleasePolicy, ReleasePolicy, PolicyVerdict } from '../../common/releasePolicy';

const LATEST_URL = 'https://releases.elasticapi.io/nexus-ai/latest.json';
const DEFAULT_TTL_MS = 60 * 60 * 1000; // refetch at most hourly

type FetchPolicy = () => Promise<ReleasePolicy | null>;

async function defaultFetch(): Promise<ReleasePolicy | null> {
  try {
    const res = await fetch(LATEST_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) return (await res.json()) as ReleasePolicy;
  } catch {
    // fail-safe: treat as no policy
  }
  return null;
}

/**
 * Main-process cache of the remote release policy behind the agent kill switch (T-KILLSWITCH).
 *
 * Design constraints:
 * - **Never block a run on the network.** `verdict()` returns the last-known verdict immediately and
 *   kicks off a background refresh when the cache is stale. The kill switch therefore takes effect
 *   within one refresh cycle; a slow or hung fetch never delays an agent run.
 * - **Fail-safe.** No data (never fetched, or a failed/garbled fetch) → agents are NOT disabled. A
 *   release-server outage must never halt everyone's agents. A successful fetch is kept as the
 *   last-known policy, so a subsequent failure does not flap the switch back off.
 */
export class ReleasePolicyGate {
  private policy: ReleasePolicy | null = null;
  private fetchedAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly currentVersion: string,
    private readonly fetchPolicy: FetchPolicy = defaultFetch,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Current verdict from the last-known policy. Triggers a background refresh if stale. Never throws. */
  verdict(): PolicyVerdict {
    void this.refresh(); // fire-and-forget; the current call uses the last-known policy
    return evaluateReleasePolicy(this.policy, this.currentVersion);
  }

  /** Fetch the policy if stale (or forced). Awaitable for startup priming and tests. Never throws. */
  async refresh(force = false): Promise<void> {
    if (!force && this.fetchedAt !== 0 && this.now() - this.fetchedAt < this.ttlMs) return;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const p = await this.fetchPolicy();
        if (p) this.policy = p; // keep last-known on a null/failed fetch (fail-safe)
      } catch {
        // keep last-known
      } finally {
        this.fetchedAt = this.now();
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
}
