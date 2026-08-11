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

function formatProperties(props: Awaited<ReturnType<typeof listGa4Properties>>, domain?: string): string {
  if (props.length === 0) return 'No GA4 properties found on this Google account.';
  const lines = ['Available GA4 properties:', ''];
  for (const p of props) {
    const hint = domain && p.displayName.toLowerCase().includes(domain.toLowerCase()) ? '   ← likely match' : '';
    lines.push(`- ${p.property} — ${p.displayName} (${p.account})${hint}`);
  }
  return lines.join('\n');
}

/** Resolve the mapped GA4 property for a site, or a user-facing error result. */
function getMappedProperty(ctx: AgentContext, siteId?: string):
  { property: string; siteId: string } | { result: ReturnType<typeof err> } {
  if (!siteId) return { result: err('This tool needs a siteId — the Local site name.') };
  const binding = readBinding(ctx.state.get<string>(ga4PropertyKey(siteId)));
  if (!binding) {
    return { result: err(`⚠ No GA4 property bound to "${siteId}". Bind one on this agent's Sites tab, or run map_property siteId="${siteId}".`) };
  }
  return { property: binding.property, siteId };
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
          const auth = await getGoogleToken(ctx);
          if ('result' in auth) return json ? jsonErr(auth.code, textOf(auth.result)) : auth.result;
          try {
            const props = await listGa4Properties(auth.token);
            return json ? jsonOk({ properties: props }) : ok(formatProperties(props));
          } catch (e: unknown) {
            const message = `Could not list GA4 properties: ${(e as Error).message}`;
            return json ? jsonErr('ListFailed', message) : err(`⚠ ${message}`);
          }
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

          const auth = await getGoogleToken(ctx);
          if ('result' in auth) return json ? jsonErr(auth.code, textOf(auth.result)) : auth.result;

          let props;
          try {
            props = await listGa4Properties(auth.token);
          } catch (e: unknown) {
            const message = `Could not list GA4 properties: ${(e as Error).message}`;
            return json ? jsonErr('ListFailed', message) : err(`⚠ ${message}`);
          }

          if (!args.propertyId) {
            const existing = readBinding(ctx.state.get<string>(ga4PropertyKey(args.siteId)));
            if (json) return jsonOk({ siteId: args.siteId, binding: existing ?? null, properties: props });
            const header = existing ? `Currently bound: ${existing.property}\n\n` : '';
            return ok(`${header}${formatProperties(props, args.domain)}\n\nRun map_property again with propertyId to bind one.`);
          }

          const normalized = args.propertyId.startsWith('properties/') ? args.propertyId : `properties/${args.propertyId}`;
          const match = props.find(p => p.property === normalized);
          if (!match) {
            const message = `Property "${args.propertyId}" not found on this account.`;
            return json
              ? jsonErr('NotFound', message, { properties: props })
              : err(`⚠ ${message}\n\n${formatProperties(props, args.domain)}`);
          }

          const binding: Ga4Binding = {
            property: match.property,
            displayName: match.displayName,
            boundAt: Date.now(),
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
          const auth = await getGoogleToken(ctx);
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
          const auth = await getGoogleToken(ctx);
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
          const auth = await getGoogleToken(ctx);
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
