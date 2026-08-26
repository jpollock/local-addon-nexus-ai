/**
 * web-analytics — Google Analytics 4 connector agent.
 *
 * Contributes read-only GA4 tools to chat. Passive agent: the weekly cron run
 * is a no-op status report; all value is delivered through contributed tools
 * (and through diagnose_site, which dispatches anomaly_scan).
 */
import { defineAgent, cron } from '@nexus-ai/agent-sdk';
import type { AgentContext } from '@nexus-ai/agent-sdk';
import { listGa4Properties, runGa4Report, computeDeltas, GA4_METRICS } from './ga4';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export const ga4PropertyKey = (siteId: string) => `ga4Property:${siteId}`;

/**
 * What a binding stores.
 *
 * The property id alone was enough for the tools — they only ever pass it to the Data API — but
 * not for a UI: rendering "properties/447120388" as the answer to "which property is this?" makes
 * the user go and look it up in Google. Storing the label the user actually chose means the Sites
 * tab renders from local state with no Google round trip, and still reads correctly when the
 * account is disconnected.
 *
 * Bindings written before this shape existed are bare property-id strings; readBinding accepts
 * both so an older mapping keeps working instead of silently reading as unbound.
 */
export interface Ga4Binding {
  property: string;
  displayName?: string;
  boundAt?: number;
  /**
   * Multiple connected Google accounts (2026-08-26): WHICH account served
   * this property, so report tools query the right one forever after.
   * Absent on legacy bindings — those keep the first-grant token path.
   */
  connectionId?: string;
  accountLabel?: string;
}

export function readBinding(raw: string | undefined): Ga4Binding | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith('{')) return { property: raw };
  try {
    const parsed = JSON.parse(raw) as Ga4Binding;
    return parsed?.property ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Error codes the UI branches on. A parsed string is not enough to pick the right fix. */
export type Ga4ErrorCode = 'NotConnected' | 'Revoked' | 'TokenError' | 'ListFailed' | 'NotFound';

const jsonOk = (payload: Record<string, unknown>) => ok(JSON.stringify({ ok: true, ...payload }));
const jsonErr = (code: Ga4ErrorCode, message: string, extra: Record<string, unknown> = {}) =>
  err(JSON.stringify({ ok: false, errorCode: code, message, ...extra }));

export function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/** The human-readable text inside a tool result — reused as the `message` on json error paths
 * so both surfaces say the same thing. */
export function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0]?.text ?? '';
}

export function err(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/** Returns a token, or a user-facing result explaining how to connect. */
export async function getGoogleToken(ctx: AgentContext): Promise<{ token: string } | { result: ReturnType<typeof ok>; code: Ga4ErrorCode }> {
  const status = await ctx.credentials.getStatus('google');
  if (status === 'not_connected') {
    await ctx.credentials.requestConnection('google');
    return { code: 'NotConnected', result: ok('Google Analytics is not connected. A connection prompt has been queued — connect Google on this agent\'s Sites tab, or in Preferences → Nexus AI → Connected accounts, then retry.') };
  }
  if (status === 'revoked') {
    await ctx.credentials.requestConnection('google');
    return { code: 'Revoked', result: ok('Google access was revoked. Reconnect on this agent\'s Sites tab, or in Preferences → Nexus AI → Connected accounts, then retry.') };
  }
  try {
    const t = await ctx.credentials.getToken('google');
    return { token: t.token };
  } catch (e: unknown) {
    return { code: 'TokenError', result: ok(`⚠ Could not get Google access token: ${(e as Error).message}`) };
  }
}

/** A granted account's live token, labelled. */
interface AccountToken {
  token: string;
  connectionId?: string;
  accountLabel?: string;
}

/**
 * Every granted Google account's token — the multi-account widening.
 * Feature-detected: a credential backend without `listConnections` (or one
 * account granted) behaves exactly as the single-token path always did.
 * A connection whose token could not be minted is returned as a FAILURE,
 * never silently dropped: its properties would otherwise read as
 * "not there", which is the data-loss shape.
 */
export async function getGoogleTokens(ctx: AgentContext): Promise<
  | { tokens: AccountToken[]; failures: Array<{ accountLabel: string; message: string }> }
  | { result: ReturnType<typeof ok>; code: Ga4ErrorCode }
> {
  const creds = ctx.credentials as typeof ctx.credentials & {
    listConnections?: (p: string) => Promise<Array<{ connectionId: string; accountLabel: string; status: string }>>;
    getTokenFor?: (p: string, id: string) => Promise<{ token: string }>;
  };

  if (creds.listConnections && creds.getTokenFor) {
    let connections: Array<{ connectionId: string; accountLabel: string; status: string }> = [];
    try {
      connections = await creds.listConnections('google');
    } catch { /* fall through to the single-token path below */ }
    if (connections.length > 0) {
      const tokens: AccountToken[] = [];
      const failures: Array<{ accountLabel: string; message: string }> = [];
      for (const conn of connections) {
        try {
          const t = await creds.getTokenFor('google', conn.connectionId);
          tokens.push({ token: t.token, connectionId: conn.connectionId, accountLabel: conn.accountLabel });
        } catch (e: unknown) {
          failures.push({ accountLabel: conn.accountLabel, message: (e as Error).message });
        }
      }
      if (tokens.length > 0 || failures.length > 0) return { tokens, failures };
    }
  }

  const single = await getGoogleToken(ctx);
  if ('result' in single) return single;
  return { tokens: [{ token: single.token }], failures: [] };
}

/** The token for a BOUND property: the binding's own account, or the legacy first-grant path. */
export async function getGoogleTokenForBinding(
  ctx: AgentContext,
  binding: Ga4Binding,
): Promise<{ token: string } | { result: ReturnType<typeof ok>; code: Ga4ErrorCode }> {
  const creds = ctx.credentials as typeof ctx.credentials & {
    getTokenFor?: (p: string, id: string) => Promise<{ token: string }>;
  };
  if (binding.connectionId && creds.getTokenFor) {
    try {
      const t = await creds.getTokenFor('google', binding.connectionId);
      return { token: t.token };
    } catch (e: unknown) {
      const label = binding.accountLabel ? ` (${binding.accountLabel})` : '';
      return {
        code: 'TokenError',
        result: ok(`⚠ Could not get a token for the Google account this site is bound to${label}: ${(e as Error).message}. Reconnect that account, or re-run map_property to bind against another.`),
      };
    }
  }
  return getGoogleToken(ctx);
}

function formatProperties(props: Awaited<ReturnType<typeof listGa4Properties>>, domain?: string): string {
  if (props.length === 0) return 'No GA4 properties found on this Google account.';
  const lines = ['Available GA4 properties:', ''];
  for (const p of props) {
    const hint = domain && p.displayName.toLowerCase().includes(domain.toLowerCase()) ? '   ← likely match' : '';
    lines.push(`- ${p.property} — ${p.displayName} (${p.account})${hint}`);
  }
  return lines.join('\n');
}

/** One property row, labelled with the account it came from (labels absent on the legacy path). */
type LabelledProperty = Awaited<ReturnType<typeof listGa4Properties>>[number] & {
  connectionId?: string;
  accountLabel?: string;
};

/** List properties across EVERY granted account; failures reported per account, never dropped. */
async function listAllProperties(ctx: AgentContext): Promise<
  | { properties: LabelledProperty[]; accountErrors: Array<{ accountLabel: string; message: string }> }
  | { result: ReturnType<typeof ok>; code: Ga4ErrorCode }
> {
  const auth = await getGoogleTokens(ctx);
  if ('result' in auth) return auth;
  const properties: LabelledProperty[] = [];
  const accountErrors = [...auth.failures];
  for (const t of auth.tokens) {
    try {
      const props = await listGa4Properties(t.token);
      for (const p of props) {
        properties.push({ ...p, connectionId: t.connectionId, accountLabel: t.accountLabel });
      }
    } catch (e: unknown) {
      accountErrors.push({ accountLabel: t.accountLabel ?? 'connected account', message: (e as Error).message });
    }
  }
  if (properties.length === 0 && accountErrors.length > 0 && auth.tokens.length === accountErrors.length) {
    // Every account failed: that is a ListFailed, not an empty fleet.
    const message = `Could not list GA4 properties: ${accountErrors.map((f) => `${f.accountLabel}: ${f.message}`).join('; ')}`;
    return { code: 'ListFailed', result: err(`⚠ ${message}`) as never };
  }
  return { properties, accountErrors };
}

/** Resolve the mapped GA4 property for a site, or a user-facing error result. */
function getMappedProperty(ctx: AgentContext, siteId?: string):
  { property: string; siteId: string; binding: Ga4Binding } | { result: ReturnType<typeof err> } {
  if (!siteId) return { result: err('This tool needs a siteId — the Local site name.') };
  const binding = readBinding(ctx.state.get<string>(ga4PropertyKey(siteId)));
  if (!binding) {
    return { result: err(`⚠ No GA4 property bound to "${siteId}". Bind one on this agent's Sites tab, or run map_property siteId="${siteId}".`) };
  }
  // The binding rides along so report tools can query the ACCOUNT it names.
  return { property: binding.property, siteId, binding };
}

export default defineAgent({
  name: 'web-analytics',
  version: '0.2.0',
  description: 'Google Analytics 4 connector — traffic summaries, anomaly scans, and page performance for mapped sites.',

  credentials: [
    {
      provider: 'google',
      scopes: [GA4_SCOPE],
      optional: true,
      reason: 'Reads Google Analytics traffic data to diagnose site problems and report performance',
    },
  ],

  triggers: [cron('0 8 * * 1')],

  contributes: {
    tools: {
      list_properties: {
        description: 'List Google Analytics 4 properties available on the connected Google account. Use before map_property. Pass format="json" for the structured payload the Sites tab renders.',
        inputSchema: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['text', 'json'], default: 'text' },
          },
        },
        executionMode: 'function' as const,
        handler: async (args: { format?: 'text' | 'json' }, ctx: AgentContext) => {
          ctx.log.phase('list_properties');
          const json = args?.format === 'json';
          const listed = await listAllProperties(ctx);
          if ('result' in listed) return json ? jsonErr(listed.code, textOf(listed.result)) : listed.result;
          const warn = listed.accountErrors.length
            ? `\n\n⚠ Some connected accounts could not be read: ${listed.accountErrors.map((f) => `${f.accountLabel} (${f.message})`).join('; ')}`
            : '';
          return json
            ? jsonOk({ properties: listed.properties, accountErrors: listed.accountErrors })
            : ok(formatProperties(listed.properties) + warn);
        },
      },

      map_property: {
        description: 'Bind a GA4 property to a site. Required before traffic_summary, anomaly_scan, and page_performance. Call without propertyId to list available properties; pass the site domain to highlight the likely match.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Local site name the property belongs to' },
            propertyId: { type: 'string', description: 'GA4 property (e.g. "properties/123456" or bare "123456"). Omit to list options.' },
            domain: { type: 'string', description: 'Site domain, used to highlight the likely matching property' },
            unbind: { type: 'boolean', default: false, description: 'Forget this site\'s binding. Nothing is changed in Google Analytics.' },
            format: { type: 'string', enum: ['text', 'json'], default: 'text' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (
          args: { siteId?: string; propertyId?: string; domain?: string; unbind?: boolean; format?: 'text' | 'json' },
          ctx: AgentContext,
        ) => {
          ctx.log.phase('map_property');
          const json = args?.format === 'json';
          if (!args.siteId) {
            const message = 'map_property needs a siteId — the Local site name to bind the GA4 property to.';
            return json ? jsonErr('NotFound', message) : err(message);
          }

          // Unbinding needs no Google call at all — it only forgets a local pointer. Requiring a
          // live token to undo something would leave a site stuck bound whenever the account is
          // disconnected, which is exactly when a user wants to clear it.
          if (args.unbind) {
            ctx.state.set(ga4PropertyKey(args.siteId), '');
            ctx.log.info(`GA4 property unbound: ${args.siteId}`);
            const message = `✓ Unbound ${args.siteId}. Nothing was changed in Google Analytics.`;
            return json ? jsonOk({ siteId: args.siteId, binding: null }) : ok(message);
          }

          const listed = await listAllProperties(ctx);
          if ('result' in listed) return json ? jsonErr(listed.code, textOf(listed.result)) : listed.result;
          const props = listed.properties;

          if (!args.propertyId) {
            const existing = readBinding(ctx.state.get<string>(ga4PropertyKey(args.siteId)));
            if (json) return jsonOk({ siteId: args.siteId, binding: existing ?? null, properties: props });
            const header = existing ? `Currently bound: ${existing.property}\n\n` : '';
            return ok(`${header}${formatProperties(props, args.domain)}\n\nRun map_property again with propertyId to bind one.`);
          }

          const normalized = args.propertyId.startsWith('properties/') ? args.propertyId : `properties/${args.propertyId}`;
          const match = props.find(p => p.property === normalized);
          if (!match) {
            const message = `Property "${args.propertyId}" not found on any connected account.`;
            return json
              ? jsonErr('NotFound', message, { properties: props })
              : err(`⚠ ${message}\n\n${formatProperties(props, args.domain)}`);
          }

          const binding: Ga4Binding = {
            property: match.property,
            displayName: match.displayName,
            boundAt: Date.now(),
            // The account that served this property — report tools query it,
            // not whichever grant happens to be first. Absent only on the
            // legacy single-account credential backend.
            ...(match.connectionId ? { connectionId: match.connectionId } : {}),
            ...(match.accountLabel ? { accountLabel: match.accountLabel } : {}),
          };
          ctx.state.set(ga4PropertyKey(args.siteId), JSON.stringify(binding));
          ctx.log.info(`GA4 property bound: ${args.siteId} → ${match.property}`);
          return json
            ? jsonOk({ siteId: args.siteId, binding })
            : ok(`✓ Bound ${args.siteId} → ${match.property} (${match.displayName})`);
        },
      },

      traffic_summary: {
        description: 'Traffic totals (sessions, users, pageviews, key events) for a mapped site over a window, with prior-period comparison and per-day breakdown.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Local site name (must be mapped via map_property)' },
            days: { type: 'number', default: 7, description: 'Window size in days (compared against the prior window)' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId?: string; days?: number }, ctx: AgentContext) => {
          ctx.log.phase('traffic_summary');
          const mapped = getMappedProperty(ctx, args.siteId);
          if ('result' in mapped) return mapped.result;
          // The binding's own account — never whichever grant is first.
          const auth = await getGoogleTokenForBinding(ctx, mapped.binding);
          if ('result' in auth) return auth.result;
          const days = args.days ?? 7;
          try {
            const [current, prior] = await Promise.all([
              runGa4Report(auth.token, mapped.property, { dimension: 'date', days }),
              runGa4Report(auth.token, mapped.property, { dimension: 'date', days, offsetDays: days }),
            ]);
            const { totals } = computeDeltas(current, prior);
            const byDay = current
              .sort((a, b) => a.dimension.localeCompare(b.dimension))
              .map((r) => ({ date: r.dimension, ...Object.fromEntries(GA4_METRICS.map((m, i) => [m, r.metrics[i]])) }));
            return ok(JSON.stringify({ property: mapped.property, days, totals, byDay }, null, 2));
          } catch (e: unknown) {
            return err(`⚠ GA4 report failed: ${(e as Error).message}`);
          }
        },
      },

      anomaly_scan: {
        description: 'Scan a mapped site for significant traffic changes vs. the prior period — by channel and by page. The primary GA4 evidence source for diagnosing site problems.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Local site name (must be mapped via map_property)' },
            days: { type: 'number', default: 7, description: 'Window size in days' },
            thresholdPct: { type: 'number', default: 25, description: 'Flag changes of at least this magnitude (%)' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId?: string; days?: number; thresholdPct?: number }, ctx: AgentContext) => {
          ctx.log.phase('anomaly_scan');
          const mapped = getMappedProperty(ctx, args.siteId);
          if ('result' in mapped) return mapped.result;
          // The binding's own account — never whichever grant is first.
          const auth = await getGoogleTokenForBinding(ctx, mapped.binding);
          if ('result' in auth) return auth.result;
          const days = args.days ?? 7;
          const threshold = args.thresholdPct ?? 25;
          try {
            const [chNow, chPrior, pgNow, pgPrior] = await Promise.all([
              runGa4Report(auth.token, mapped.property, { dimension: 'sessionDefaultChannelGroup', days }),
              runGa4Report(auth.token, mapped.property, { dimension: 'sessionDefaultChannelGroup', days, offsetDays: days }),
              runGa4Report(auth.token, mapped.property, { dimension: 'pagePath', days, limit: 50 }),
              runGa4Report(auth.token, mapped.property, { dimension: 'pagePath', days, offsetDays: days, limit: 50 }),
            ]);
            return ok(JSON.stringify({
              property: mapped.property,
              days,
              thresholdPct: threshold,
              channels: computeDeltas(chNow, chPrior, threshold),
              pages: computeDeltas(pgNow, pgPrior, threshold),
            }, null, 2));
          } catch (e: unknown) {
            return err(`⚠ GA4 anomaly scan failed: ${(e as Error).message}`);
          }
        },
      },

      page_performance: {
        description: 'Per-page GA4 drill-down for a mapped site — sessions, users, pageviews, key events by pagePath. Use as a follow-up after anomaly_scan flags a page.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: { type: 'string', description: 'Local site name (must be mapped via map_property)' },
            days: { type: 'number', default: 28, description: 'Window size in days' },
            limit: { type: 'number', default: 20, description: 'Max pages to return' },
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId?: string; days?: number; limit?: number }, ctx: AgentContext) => {
          ctx.log.phase('page_performance');
          const mapped = getMappedProperty(ctx, args.siteId);
          if ('result' in mapped) return mapped.result;
          // The binding's own account — never whichever grant is first.
          const auth = await getGoogleTokenForBinding(ctx, mapped.binding);
          if ('result' in auth) return auth.result;
          try {
            const rows = await runGa4Report(auth.token, mapped.property, {
              dimension: 'pagePath',
              days: args.days ?? 28,
              limit: args.limit ?? 20,
            });
            const pages = rows.map((r) => ({ page: r.dimension, ...Object.fromEntries(GA4_METRICS.map((m, i) => [m, r.metrics[i]])) }));
            return ok(JSON.stringify({ property: mapped.property, days: args.days ?? 28, pages }, null, 2));
          } catch (e: unknown) {
            return err(`⚠ GA4 page report failed: ${(e as Error).message}`);
          }
        },
      },
    },
  },

  async run() {
    // Passive agent — all value is in contributed tools.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { summary: 'Web Analytics connector is passive — its tools run via chat (list_properties, map_property, traffic_summary, anomaly_scan, page_performance).' } as any;
  },
});
