import { IPC_CHANNELS } from '../../../common/constants';
import { fetchScopeSites, ScopeSite, ScopeSiteEnv } from './fetchScopeSites';

/**
 * The one derived set behind web-analytics' Sites tab.
 *
 * Same rule as log-processor's (BEHAVIOR.md §4): the tab badge, the header line, the footnote and
 * the Run now enabled state all read one set — sites with a GA4 property bound. What differs is
 * only what makes a site eligible. There, an install had objects in a bucket; here, a human
 * confirmed which property belongs to it.
 */

export interface Ga4Binding {
  property: string;
  /** The label chosen in Google. Absent on bindings written before the agent stored it. */
  displayName?: string;
  boundAt?: number;
}

export interface GoogleAccount {
  /** This agent may use the account — the only state in which its tools actually work. */
  connected: boolean;
  /** A Google account exists on the machine, whatever this agent's own access is. */
  accountExists: boolean;
  /** The account label from the credential manager — usually the email. */
  label?: string;
  status?: string;
}

/**
 * Why the two booleans.
 *
 * An OAuth connection is one Google account; access to it is granted *per agent*, so a second
 * agent does not silently inherit what the first authorised. `accountExists` and `connected`
 * therefore differ routinely, and the difference is the whole story a user needs: "connect
 * Google" is wrong advice for someone who already has, and "not connected" is simply false.
 *
 * This gate reads `agentStatus` — the same call the agent's own `getStatus` makes — so the tab and
 * the runtime cannot disagree about whether a tool will work.
 */

export interface AnalyticsState {
  bindings: Record<string, Ga4Binding>;
  fleet: ScopeSite[];
  google: GoogleAccount;
}

export const EMPTY_ANALYTICS: AnalyticsState = { bindings: {}, fleet: [], google: { connected: false, accountExists: false } };

export async function loadAnalyticsState(electron: any): Promise<AnalyticsState> {
  const ipc = electron?.ipcRenderer;
  if (!ipc) return EMPTY_ANALYTICS;

  const [state, fleet, creds] = await Promise.all([
    ipc.invoke(IPC_CHANNELS.AGENT_WEB_ANALYTICS_STATE).catch(() => null),
    fetchScopeSites(electron).catch(() => [] as ScopeSite[]),
    ipc.invoke(IPC_CHANNELS.CREDENTIAL_STATUS, { provider: 'google', agentId: 'web-analytics' }).catch(() => null),
  ]);

  const active = (creds?.connections ?? []).find((c: any) => c?.provider === 'google' && c.status !== 'revoked');
  const revoked = (creds?.connections ?? []).find((c: any) => c?.provider === 'google' && c.status === 'revoked');
  const agentStatus: string | null = creds?.agentStatus ?? null;

  return {
    bindings: state?.bindings ?? {},
    // Every site, local and WP Engine: a GA4 property can be attached to either, and the agent
    // keys bindings by site name without caring which platform it came from.
    fleet: fleet ?? [],
    google: {
      connected: agentStatus === 'connected',
      accountExists: !!active,
      label: active?.accountLabel,
      status: agentStatus ?? (revoked ? 'revoked' : undefined),
    },
  };
}

export interface AnalyticsSiteRow {
  name: string;
  environment: ScopeSiteEnv;
  platform: ScopeSite['platform'];
  binding?: Ga4Binding;
  /** Bound to a property, so scheduled runs include it. */
  bound: boolean;
}

export function deriveAnalyticsRows(state: AnalyticsState): AnalyticsSiteRow[] {
  return state.fleet.map(s => {
    const binding = state.bindings[s.name];
    return {
      name: s.name,
      environment: s.environment,
      platform: s.platform,
      binding,
      bound: !!binding,
    };
  }).sort((a, b) => {
    // Bound sites first, then alphabetical — on a 118-site fleet the two that are configured
    // would otherwise be scattered through the All sites view.
    if (a.bound !== b.bound) return a.bound ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** The set every count and enabled-state on the surface reads. */
export function boundSiteNames(rows: AnalyticsSiteRow[]): string[] {
  return rows.filter(r => r.bound).map(r => r.name);
}

/**
 * How strongly a GA4 property looks like it belongs to a site.
 *
 * This is a hint for ordering and for a badge, never a decision. log-processor can join
 * automatically because the install id inside a log filename *is* the install id; a GA4 property
 * name is free text a human typed, so "Alpine Outfitters — GA4" is evidence about
 * `alpineoutfitters` and nothing more. Two properties named after the same site is the ordinary
 * case, which is exactly why a person confirms the binding.
 */
export function matchScore(siteName: string, propertyDisplayName: string): number {
  const site = siteName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const prop = propertyDisplayName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!site || !prop) return 0;
  if (prop === site) return 3;
  if (prop.includes(site) || site.includes(prop)) return 2;
  // Shared leading run of at least four characters — catches "myloop" vs "My Loop (old)".
  let shared = 0;
  while (shared < site.length && shared < prop.length && site[shared] === prop[shared]) shared++;
  return shared >= 4 ? 1 : 0;
}
