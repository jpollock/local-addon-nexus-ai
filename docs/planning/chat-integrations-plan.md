# Chat Integrations — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/planning/chat-integrations-design.md`

**Goal:** Ship the "boss ping" triage moment — a GA4 connector (`web-analytics` agent), a `diagnose_site` composite tool that joins traffic + search + logs + site state, an Integrations section in Settings, and per-integration chat tool scoping.

**Architecture:** GA4 is a new directory-based agent (the seo-insights pattern) contributing read-only tools to chat via `ContributedToolRegistry`; `diagnose_site` is a core composite `McpToolHandler` that fans out with `Promise.allSettled` across registry handlers (direct `.execute()` calls) and agent tools (`dispatcher.dispatch()`); the catalog is a static renderer module + a new `SettingsTab` section; scoping rides the existing `toMcpDefinitions(isEnabled)` hook.

**Tech Stack:** TypeScript, Electron (main + renderer), Jest (`ts-jest`), plain `fetch` for Google APIs, `@nexus-ai/agent-sdk` (`defineAgent`, `mockContext`, `testTool`).

## Global Constraints

- **NEVER** `git push`, `npm version`, `git tag`, or trigger releases. Local commits only.
- Renderer code: **class components, `React.createElement()` only — no JSX, no hooks** (Local's older React).
- `better-sqlite3` stays at 12.11.1. If you ran `npm install`, run `npm run rebuild` before loading the addon in Local (tests need the system-Node binary from `npm install`; Local needs the Electron binary from `npm run rebuild`).
- `UpdateSettingsSchema` in `src/common/schemas.ts` is `.strict()` — every new `NexusSettings` field MUST also be added there or `UPDATE_SETTINGS` calls containing it fail validation.
- Agent name rules: lowercase, digits, `-`, single `_` only (regex `/^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$/`) — double underscore breaks `agent__<name>__<tool>` MCP splitting. Agent **directory name must equal the manifest/definition `name`**.
- After editing anything under `agents/`, run `npm run sync-agents` (copies repo `agents/` → `~/Library/Application Support/Local/nexus-ai/agents`; hot reload picks it up in ~2s).
- Tests: `npm test` (unit only; evals are `npm run test:eval` and excluded from unit runs). New unit tests go in `tests/unit/...` named `*.test.ts`.
- Contributed agent tools take `siteId` (camelCase); registry tools take `site`. Do not mix.
- New read-only registry tools MUST be added to `TIER_OVERRIDES` in `src/main/mcp/safety.ts` with tier `1` — unlisted tools default to tier 2 (counted as state-changing actions).
- Commit after each task's tests pass. Commit messages: `feat(...)`/`fix(...)`/`test(...)` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `web-analytics` agent scaffold — GA4 client, `list_properties`, `map_property`

**Files:**
- Create: `agents/web-analytics/ga4.ts`
- Create: `agents/web-analytics/agent.ts`
- Create: `agents/web-analytics/nexus.agent.yaml`
- Test: `tests/unit/agents/web-analytics/ga4.test.ts`
- Test: `tests/unit/agents/web-analytics/agent.test.ts`

**Interfaces:**
- Consumes: `defineAgent`, `cron` from `@nexus-ai/agent-sdk`; `ctx.credentials.getStatus/getToken/requestConnection('google')`; `ctx.state.get/set`.
- Produces (Task 2 and Task 4 rely on these):
  - `ga4.ts`: `listGa4Properties(token: string): Promise<Ga4Property[]>` where `Ga4Property = { property: string; displayName: string; account: string }` (`property` is the full resource name, e.g. `"properties/123456"`).
  - `agent.ts`: state key helper `ga4PropertyKey(siteId: string) => \`ga4Property:${siteId}\``; contributed tools `list_properties`, `map_property`; shared helpers `ok(text)`, `err(text)`, `getGoogleToken(ctx)`.
  - Chat-visible names: `agent__web-analytics__list_properties`, `agent__web-analytics__map_property`.

- [ ] **Step 1: Write failing tests for the GA4 client**

Create `tests/unit/agents/web-analytics/ga4.test.ts`:

```ts
import { listGa4Properties } from '../../../../agents/web-analytics/ga4';

describe('listGa4Properties', () => {
  afterEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockRestore?.();
  });

  it('flattens accountSummaries into properties', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        accountSummaries: [
          {
            displayName: 'Acme Account',
            propertySummaries: [
              { property: 'properties/111', displayName: 'acme.com - GA4' },
              { property: 'properties/222', displayName: 'acme-store.com' },
            ],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const props = await listGa4Properties('tok');

    expect(props).toEqual([
      { property: 'properties/111', displayName: 'acme.com - GA4', account: 'Acme Account' },
      { property: 'properties/222', displayName: 'acme-store.com', account: 'Acme Account' },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
      { headers: { Authorization: 'Bearer tok' } },
    );
  });

  it('throws on API error payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ error: { message: 'insufficient scopes' } }),
    }) as unknown as typeof fetch;

    await expect(listGa4Properties('tok')).rejects.toThrow('GA4 API error: insufficient scopes');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/agents/web-analytics/ga4.test.ts`
Expected: FAIL — cannot find module `agents/web-analytics/ga4`.

- [ ] **Step 3: Implement `agents/web-analytics/ga4.ts` (client half)**

```ts
/**
 * Minimal GA4 API client — plain fetch, no SDK (matches the GSC pattern in
 * agents/seo-insights). Admin API lists properties; Data API runs reports.
 */

export interface Ga4Property {
  property: string;      // full resource name, e.g. "properties/123456"
  displayName: string;
  account: string;
}

interface Ga4ErrorPayload {
  error?: { message: string };
}

export async function listGa4Properties(token: string): Promise<Ga4Property[]> {
  const res = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as Ga4ErrorPayload & {
    accountSummaries?: Array<{
      displayName?: string;
      propertySummaries?: Array<{ property: string; displayName: string }>;
    }>;
  };
  if (data.error) throw new Error(`GA4 API error: ${data.error.message}`);
  const out: Ga4Property[] = [];
  for (const acct of data.accountSummaries ?? []) {
    for (const p of acct.propertySummaries ?? []) {
      out.push({ property: p.property, displayName: p.displayName, account: acct.displayName ?? '' });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/unit/agents/web-analytics/ga4.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write failing agent tests**

Create `tests/unit/agents/web-analytics/agent.test.ts`:

```ts
import { mockContext, testTool } from '../../../../src/main/agent-sdk/testing';
import type { AgentDefinition, AgentContext } from '../../../../src/main/agent-sdk/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const agent: AgentDefinition = require('../../../../agents/web-analytics/agent').default;

/** mockContext() has no credentials override — mutate the returned object (repo convention). */
function connectedContext(): AgentContext {
  const ctx = mockContext();
  ctx.credentials.getStatus = async () => 'connected' as const;
  ctx.credentials.getToken = async () => ({ token: 'tok', expiresAt: '', scopes: [] });
  return ctx;
}

afterEach(() => {
  (global.fetch as jest.Mock | undefined)?.mockRestore?.();
});

describe('agent identity', () => {
  it('has correct name, tier-1 read-only posture, and google credential', () => {
    expect(agent.name).toBe('web-analytics');
    expect(agent.credentials?.[0]).toMatchObject({
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
    const tools = Object.keys(agent.contributes?.tools ?? {});
    expect(tools).toEqual(expect.arrayContaining(['list_properties', 'map_property']));
  });
});

describe('list_properties', () => {
  it('prompts for connection when google is not connected', async () => {
    const ctx = mockContext(); // default credentials: not_connected
    const result = await testTool(agent, 'list_properties', {}, ctx);
    expect(result.content[0].text).toMatch(/not connected/i);
  });

  it('lists properties when connected', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        accountSummaries: [{ displayName: 'Acme', propertySummaries: [{ property: 'properties/111', displayName: 'acme.com' }] }],
      }),
    }) as unknown as typeof fetch;

    const result = await testTool(agent, 'list_properties', {}, connectedContext());
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('properties/111');
    expect(result.content[0].text).toContain('acme.com');
  });
});

describe('map_property', () => {
  it('requires siteId', async () => {
    const result = await testTool(agent, 'map_property', {}, connectedContext());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/siteId/);
  });

  it('lists properties with a domain hint when no propertyId is given', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        accountSummaries: [{ displayName: 'Acme', propertySummaries: [
          { property: 'properties/111', displayName: 'acme.com' },
          { property: 'properties/222', displayName: 'other.net' },
        ] }],
      }),
    }) as unknown as typeof fetch;

    const result = await testTool(agent, 'map_property', { siteId: 'acme', domain: 'acme.com' }, connectedContext());
    expect(result.content[0].text).toContain('likely match');
    expect(result.content[0].text).toContain('properties/111');
  });

  it('binds a property and normalizes bare numeric IDs', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        accountSummaries: [{ displayName: 'Acme', propertySummaries: [{ property: 'properties/111', displayName: 'acme.com' }] }],
      }),
    }) as unknown as typeof fetch;

    const ctx = connectedContext();
    const result = await testTool(agent, 'map_property', { siteId: 'acme', propertyId: '111' }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('✓');
    expect(ctx.state.get<string>('ga4Property:acme')).toBe('properties/111');
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx jest tests/unit/agents/web-analytics/agent.test.ts`
Expected: FAIL — cannot find module `agents/web-analytics/agent`.

- [ ] **Step 7: Implement `agents/web-analytics/agent.ts`**

```ts
/**
 * web-analytics — Google Analytics 4 connector agent.
 *
 * Contributes read-only GA4 tools to chat. Passive agent: the weekly cron run
 * is a no-op status report; all value is delivered through contributed tools
 * (and through diagnose_site, which dispatches anomaly_scan).
 */
import { defineAgent, cron } from '@nexus-ai/agent-sdk';
import type { AgentContext } from '@nexus-ai/agent-sdk';
import { listGa4Properties } from './ga4';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export const ga4PropertyKey = (siteId: string) => `ga4Property:${siteId}`;

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/** Returns a token, or a user-facing result explaining how to connect. */
async function getGoogleToken(ctx: AgentContext): Promise<{ token: string } | { result: ReturnType<typeof ok> }> {
  const status = await ctx.credentials.getStatus('google');
  if (status === 'not_connected') {
    await ctx.credentials.requestConnection('google');
    return { result: ok('Google Analytics is not connected. A connection prompt has been queued — connect Google in Settings → Integrations, then retry.') };
  }
  if (status === 'revoked') {
    await ctx.credentials.requestConnection('google');
    return { result: ok('Google access was revoked. Reconnect in Settings → Integrations, then retry.') };
  }
  try {
    const t = await ctx.credentials.getToken('google');
    return { token: t.token };
  } catch (e: unknown) {
    return { result: ok(`⚠ Could not get Google access token: ${(e as Error).message}`) };
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

export default defineAgent({
  name: 'web-analytics',
  version: '0.1.0',
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
        description: 'List Google Analytics 4 properties available on the connected Google account. Use before map_property.',
        inputSchema: { type: 'object', properties: {} },
        executionMode: 'function' as const,
        handler: async (_args: Record<string, never>, ctx: AgentContext) => {
          ctx.log.phase('list_properties');
          const auth = await getGoogleToken(ctx);
          if ('result' in auth) return auth.result;
          try {
            return ok(formatProperties(await listGa4Properties(auth.token)));
          } catch (e: unknown) {
            return err(`⚠ Could not list GA4 properties: ${(e as Error).message}`);
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
          },
          required: ['siteId'],
        },
        executionMode: 'function' as const,
        handler: async (args: { siteId?: string; propertyId?: string; domain?: string }, ctx: AgentContext) => {
          ctx.log.phase('map_property');
          if (!args.siteId) return err('map_property needs a siteId — the Local site name to bind the GA4 property to.');
          const auth = await getGoogleToken(ctx);
          if ('result' in auth) return auth.result;

          let props;
          try {
            props = await listGa4Properties(auth.token);
          } catch (e: unknown) {
            return err(`⚠ Could not list GA4 properties: ${(e as Error).message}`);
          }

          if (!args.propertyId) {
            const existing = ctx.state.get<string>(ga4PropertyKey(args.siteId));
            const header = existing ? `Currently mapped: ${existing}\n\n` : '';
            return ok(`${header}${formatProperties(props, args.domain)}\n\nRun map_property again with propertyId to bind one.`);
          }

          const normalized = args.propertyId.startsWith('properties/') ? args.propertyId : `properties/${args.propertyId}`;
          const match = props.find(p => p.property === normalized);
          if (!match) return err(`⚠ Property "${args.propertyId}" not found on this account.\n\n${formatProperties(props, args.domain)}`);

          ctx.state.set(ga4PropertyKey(args.siteId), match.property);
          ctx.log.info(`GA4 property mapped: ${args.siteId} → ${match.property}`);
          return ok(`✓ Mapped ${args.siteId} → ${match.property} (${match.displayName})`);
        },
      },
    },
  },

  async run() {
    // Passive agent — all value is in contributed tools.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { summary: 'Web Analytics connector is passive — its tools run via chat (map_property, traffic_summary, anomaly_scan, page_performance).' } as any;
  },
});
```

- [ ] **Step 8: Run to verify pass**

Run: `npx jest tests/unit/agents/web-analytics/`
Expected: PASS (all tests in both files).

- [ ] **Step 9: Write `agents/web-analytics/nexus.agent.yaml`**

The registry reads only `name`, `permissions.tier`, and `contributes.tools` from YAML — but mirror the full definition (repo convention):

```yaml
name: web-analytics
version: 0.1.0
description: >-
  Google Analytics 4 connector — traffic summaries, anomaly scans, and page
  performance for mapped sites.
permissions:
  tier: 1
credentials:
  - provider: google
    scopes:
      - https://www.googleapis.com/auth/analytics.readonly
    optional: true
    reason: >-
      Reads Google Analytics traffic data to diagnose site problems and report
      performance
triggers:
  - type: cron
    expression: 0 8 * * 1
contributes:
  tools:
    - name: list_properties
      description: >-
        List Google Analytics 4 properties available on the connected Google
        account. Use before map_property.
      executionMode: function
      inputSchema:
        type: object
        properties: {}
    - name: map_property
      description: >-
        Bind a GA4 property to a site. Required before traffic_summary,
        anomaly_scan, and page_performance. Call without propertyId to list
        available properties; pass the site domain to highlight the likely
        match.
      executionMode: function
      inputSchema:
        type: object
        properties:
          siteId:
            type: string
            description: Local site name the property belongs to
          propertyId:
            type: string
            description: >-
              GA4 property (e.g. "properties/123456" or bare "123456"). Omit to
              list options.
          domain:
            type: string
            description: Site domain, used to highlight the likely matching property
        required:
          - siteId
```

- [ ] **Step 10: Sync and commit**

```bash
npm run sync-agents
git add agents/web-analytics tests/unit/agents/web-analytics
git commit -m "feat(web-analytics): GA4 connector agent — list_properties + map_property

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: GA4 reporting tools — `traffic_summary`, `anomaly_scan`, `page_performance`

**Files:**
- Modify: `agents/web-analytics/ga4.ts` (append report client + delta math)
- Modify: `agents/web-analytics/agent.ts` (three new contributed tools)
- Modify: `agents/web-analytics/nexus.agent.yaml` (three new tool entries)
- Test: `tests/unit/agents/web-analytics/ga4.test.ts` (append)
- Test: `tests/unit/agents/web-analytics/agent.test.ts` (append)

**Interfaces:**
- Consumes: `ga4PropertyKey`, `getGoogleToken`, `ok`/`err` from Task 1.
- Produces (Task 4 dispatches this):
  - `runGa4Report(token, property, opts: { dimension: string; days: number; offsetDays?: number; limit?: number }): Promise<Ga4Row[]>` where `Ga4Row = { dimension: string; metrics: number[] }` and metrics order is `GA4_METRICS = ['sessions', 'totalUsers', 'screenPageViews', 'keyEvents']`.
  - `computeDeltas(current: Ga4Row[], prior: Ga4Row[], thresholdPct?: number): DeltaReport` where `DeltaReport = { totals: Array<{ metric; current; prior; deltaPct: number | null }>; movers: Array<{ dimension; metric; current; prior; deltaPct: number | null }> }`.
  - Contributed tool `anomaly_scan` with args `{ siteId: string; days?: number; thresholdPct?: number }` — returns a JSON text bundle; returns `isError: true` with text containing `map_property` when the site has no mapped property. **Task 4's `diagnose_site` calls exactly `dispatcher.dispatch('web-analytics', 'anomaly_scan', { siteId, days })`.**

- [ ] **Step 1: Write failing tests for report client + delta math** (append to `ga4.test.ts`)

```ts
import { runGa4Report, computeDeltas, GA4_METRICS } from '../../../../agents/web-analytics/ga4';

describe('runGa4Report', () => {
  it('builds relative date ranges and parses rows', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        rows: [
          { dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '100' }, { value: '80' }, { value: '150' }, { value: '5' }] },
        ],
      }),
    }) as unknown as typeof fetch;

    const rows = await runGa4Report('tok', 'properties/111', { dimension: 'sessionDefaultChannelGroup', days: 7 });

    expect(rows).toEqual([{ dimension: 'Organic Search', metrics: [100, 80, 150, 5] }]);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/111:runReport');
    const body = JSON.parse(init.body);
    expect(body.dateRanges).toEqual([{ startDate: '7daysAgo', endDate: 'yesterday' }]);
    expect(body.metrics).toEqual(GA4_METRICS.map((name) => ({ name })));
  });

  it('offsets the window for prior periods', async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ rows: [] }) }) as unknown as typeof fetch;

    await runGa4Report('tok', 'properties/111', { dimension: 'date', days: 7, offsetDays: 7 });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.dateRanges).toEqual([{ startDate: '14daysAgo', endDate: '8daysAgo' }]);
  });
});

describe('computeDeltas', () => {
  const row = (dimension: string, metrics: number[]) => ({ dimension, metrics });

  it('computes per-metric totals with percentage deltas', () => {
    const report = computeDeltas(
      [row('a', [50, 40, 60, 1]), row('b', [50, 40, 60, 1])],
      [row('a', [100, 80, 120, 2]), row('b', [100, 80, 120, 2])],
    );
    const sessions = report.totals.find((t) => t.metric === 'sessions')!;
    expect(sessions).toEqual({ metric: 'sessions', current: 100, prior: 200, deltaPct: -50 });
  });

  it('flags per-dimension movers past the threshold, skipping noise-floor rows', () => {
    const report = computeDeltas(
      [row('/checkout', [10, 8, 12, 0])],
      [row('/checkout', [100, 80, 120, 10]), row('/tiny', [2, 1, 2, 0])],
      25,
    );
    expect(report.movers).toEqual(
      expect.arrayContaining([expect.objectContaining({ dimension: '/checkout', metric: 'sessions', deltaPct: -90 })]),
    );
    expect(report.movers.find((m) => m.dimension === '/tiny')).toBeUndefined(); // prior < 10 = noise
  });

  it('returns null deltaPct when prior is zero', () => {
    const report = computeDeltas([row('a', [10, 0, 0, 0])], []);
    expect(report.totals.find((t) => t.metric === 'sessions')!.deltaPct).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/agents/web-analytics/ga4.test.ts`
Expected: FAIL — `runGa4Report`, `computeDeltas`, `GA4_METRICS` not exported.

- [ ] **Step 3: Append to `agents/web-analytics/ga4.ts`**

```ts
export const GA4_METRICS = ['sessions', 'totalUsers', 'screenPageViews', 'keyEvents'] as const;

export interface Ga4Row {
  dimension: string;
  metrics: number[]; // parallel to GA4_METRICS
}

/**
 * Run a single-dimension report over a relative window.
 * days=7, offsetDays=0  → last 7 days ending yesterday
 * days=7, offsetDays=7  → the 7 days before that (prior period)
 */
export async function runGa4Report(
  token: string,
  property: string,
  opts: { dimension: string; days: number; offsetDays?: number; limit?: number },
): Promise<Ga4Row[]> {
  const offset = opts.offsetDays ?? 0;
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{
        startDate: `${offset + opts.days}daysAgo`,
        endDate: offset === 0 ? 'yesterday' : `${offset + 1}daysAgo`,
      }],
      dimensions: [{ name: opts.dimension }],
      metrics: GA4_METRICS.map((name) => ({ name })),
      limit: String(opts.limit ?? 100),
    }),
  });
  const data = await res.json() as Ga4ErrorPayload & {
    rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>;
  };
  if (data.error) throw new Error(`GA4 API error: ${data.error.message}`);
  return (data.rows ?? []).map((r) => ({
    dimension: r.dimensionValues?.[0]?.value ?? '',
    metrics: GA4_METRICS.map((_, i) => Number(r.metricValues?.[i]?.value) || 0),
  }));
}

export interface DeltaReport {
  totals: Array<{ metric: string; current: number; prior: number; deltaPct: number | null }>;
  movers: Array<{ dimension: string; metric: string; current: number; prior: number; deltaPct: number | null }>;
}

const NOISE_FLOOR = 10; // ignore dimension rows with prior volume below this

function pct(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

/** Compare two report windows: per-metric totals + per-dimension movers past thresholdPct. */
export function computeDeltas(current: Ga4Row[], prior: Ga4Row[], thresholdPct = 25): DeltaReport {
  const totals = GA4_METRICS.map((metric, i) => {
    const c = current.reduce((s, r) => s + r.metrics[i], 0);
    const p = prior.reduce((s, r) => s + r.metrics[i], 0);
    return { metric, current: c, prior: p, deltaPct: pct(c, p) };
  });

  const priorByDim = new Map(prior.map((r) => [r.dimension, r]));
  const dims = new Set([...current.map((r) => r.dimension), ...prior.map((r) => r.dimension)]);
  const movers: DeltaReport['movers'] = [];
  for (const dim of dims) {
    const c = current.find((r) => r.dimension === dim);
    const p = priorByDim.get(dim);
    GA4_METRICS.forEach((metric, i) => {
      const cv = c?.metrics[i] ?? 0;
      const pv = p?.metrics[i] ?? 0;
      if (pv < NOISE_FLOOR) return;
      const d = pct(cv, pv);
      if (d !== null && Math.abs(d) >= thresholdPct) {
        movers.push({ dimension: dim, metric, current: cv, prior: pv, deltaPct: d });
      }
    });
  }
  movers.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
  return { totals, movers };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/unit/agents/web-analytics/ga4.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for the three tools** (append to `agent.test.ts`)

```ts
describe('anomaly_scan', () => {
  it('errors with a map_property hint when site is unmapped', async () => {
    const result = await testTool(agent, 'anomaly_scan', { siteId: 'acme' }, connectedContext());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('map_property');
  });

  it('returns a JSON bundle of channel and page deltas when mapped', async () => {
    const ctx = connectedContext();
    ctx.state.set('ga4Property:acme', 'properties/111');
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '100' }, { value: '80' }, { value: '150' }, { value: '5' }] }],
      }),
    }) as unknown as typeof fetch;

    const result = await testTool(agent, 'anomaly_scan', { siteId: 'acme', days: 7 }, ctx);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('property', 'properties/111');
    expect(parsed).toHaveProperty('channels');
    expect(parsed).toHaveProperty('pages');
    expect(global.fetch).toHaveBeenCalledTimes(4); // channels current+prior, pages current+prior
  });
});

describe('traffic_summary', () => {
  it('returns totals with prior-period comparison when mapped', async () => {
    const ctx = connectedContext();
    ctx.state.set('ga4Property:acme', 'properties/111');
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        rows: [{ dimensionValues: [{ value: '20260722' }], metricValues: [{ value: '10' }, { value: '8' }, { value: '15' }, { value: '1' }] }],
      }),
    }) as unknown as typeof fetch;

    const result = await testTool(agent, 'traffic_summary', { siteId: 'acme' }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totals).toEqual(
      expect.arrayContaining([expect.objectContaining({ metric: 'sessions' })]),
    );
    expect(parsed.byDay).toBeDefined();
  });
});

describe('page_performance', () => {
  it('returns per-page rows when mapped', async () => {
    const ctx = connectedContext();
    ctx.state.set('ga4Property:acme', 'properties/111');
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        rows: [{ dimensionValues: [{ value: '/checkout' }], metricValues: [{ value: '50' }, { value: '40' }, { value: '70' }, { value: '2' }] }],
      }),
    }) as unknown as typeof fetch;

    const result = await testTool(agent, 'page_performance', { siteId: 'acme' }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.pages[0]).toMatchObject({ page: '/checkout', sessions: 50 });
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx jest tests/unit/agents/web-analytics/agent.test.ts`
Expected: FAIL — `Tool 'anomaly_scan' not found`.

- [ ] **Step 7: Add the three tools to `agents/web-analytics/agent.ts`**

Add imports at top: `import { listGa4Properties, runGa4Report, computeDeltas, GA4_METRICS } from './ga4';`

Add a shared resolver above `defineAgent`:

```ts
/** Resolve the mapped GA4 property for a site, or a user-facing error result. */
function getMappedProperty(ctx: AgentContext, siteId?: string):
  { property: string; siteId: string } | { result: ReturnType<typeof err> } {
  if (!siteId) return { result: err('This tool needs a siteId — the Local site name.') };
  const property = ctx.state.get<string>(ga4PropertyKey(siteId));
  if (!property) {
    return { result: err(`⚠ No GA4 property mapped for "${siteId}". Run map_property siteId="${siteId}" to bind one (Google Analytics must be connected in Settings → Integrations).`) };
  }
  return { property, siteId };
}
```

Add inside `contributes.tools`:

```ts
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
```

- [ ] **Step 8: Run to verify pass**

Run: `npx jest tests/unit/agents/web-analytics/`
Expected: PASS (all tests).

- [ ] **Step 9: Mirror the three tools into `nexus.agent.yaml`** (append under `contributes.tools`)

```yaml
    - name: traffic_summary
      description: >-
        Traffic totals (sessions, users, pageviews, key events) for a mapped
        site over a window, with prior-period comparison and per-day breakdown.
      executionMode: function
      inputSchema:
        type: object
        properties:
          siteId:
            type: string
            description: Local site name (must be mapped via map_property)
          days:
            type: number
            default: 7
            description: Window size in days (compared against the prior window)
        required:
          - siteId
    - name: anomaly_scan
      description: >-
        Scan a mapped site for significant traffic changes vs. the prior period
        — by channel and by page. The primary GA4 evidence source for
        diagnosing site problems.
      executionMode: function
      inputSchema:
        type: object
        properties:
          siteId:
            type: string
            description: Local site name (must be mapped via map_property)
          days:
            type: number
            default: 7
            description: Window size in days
          thresholdPct:
            type: number
            default: 25
            description: Flag changes of at least this magnitude (%)
        required:
          - siteId
    - name: page_performance
      description: >-
        Per-page GA4 drill-down for a mapped site — sessions, users, pageviews,
        key events by pagePath. Use as a follow-up after anomaly_scan flags a
        page.
      executionMode: function
      inputSchema:
        type: object
        properties:
          siteId:
            type: string
            description: Local site name (must be mapped via map_property)
          days:
            type: number
            default: 28
            description: Window size in days
          limit:
            type: number
            default: 20
            description: Max pages to return
        required:
          - siteId
```

- [ ] **Step 10: Sync and commit**

```bash
npm run sync-agents
git add agents/web-analytics tests/unit/agents/web-analytics
git commit -m "feat(web-analytics): traffic_summary, anomaly_scan, page_performance GA4 tools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Credential connection reuse + consent scope labels

Today a second agent connecting the same Google account mints a **duplicate** connection row. Fix: merge into the existing connection when the OAuth flow returns the same account (Google's `include_granted_scopes: 'true'` already makes the returned scope set the union). Also: populate `scopeLabels` in consent requests from `ProviderRegistry.scopeMetadata` so the modal shows "Analytics (read-only)" instead of a raw URL.

**Files:**
- Modify: `src/main/credentials/CredentialManager.ts` (`connect()` at ~line 127; `requestConnectionForAgent()` at ~line 111)
- Test: `tests/unit/credentials/CredentialManager.connect.test.ts` (new)

**Interfaces:**
- Consumes: `ConnectionStore.listConnections/saveConnection/saveGrant` (existing, upsert-by-id semantics), `ProviderRegistry.get(provider).scopeMetadata`.
- Produces: unchanged public API. New behavior: `connect()` reuses an active connection with matching `provider` + `accountLabel`; emits `credential:scope_added` (already declared in `CredentialEventType`) instead of `credential:connected` on reuse.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/credentials/CredentialManager.connect.test.ts`. First open `src/main/credentials/CredentialManager.ts` and read the constructor options interface at the top of the file. The test below injects a stub flow runner; if the constructor options do not already include `flowRunnerFactory`, add it as an optional option defaulting to the current runner construction (`flowRunnerFactory?: () => { run: OAuthFlowRunner['run'] }`) — the field `this.flowRunnerFactory` already exists and is called in `connect()`, so this is exposing an existing seam, not new machinery.

```ts
import { CredentialManager } from '../../../src/main/credentials/CredentialManager';

const SCOPE_GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
const SCOPE_GA4 = 'https://www.googleapis.com/auth/analytics.readonly';

function makeStorage() {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k) ?? null,
    set: (k: string, v: unknown) => { data.set(k, v); },
  };
}

function makeManager(flowScopes: string[], accountLabel = 'user@acme.com') {
  const events: unknown[] = [];
  const mgr = new CredentialManager({
    storage: makeStorage() as never,
    emitNexusState: () => {},
    emitCredentialEvent: (e: unknown) => { events.push(e); },
    flowRunnerFactory: () => ({
      run: async () => ({
        outcome: 'success' as const,
        accessToken: 'at',
        refreshToken: 'rt',
        expiresIn: 3600,
        scopes: flowScopes,
        accountLabel,
      }),
    }),
  } as never);
  return { mgr, events };
}

describe('CredentialManager.connect — connection reuse', () => {
  it('reuses the existing connection for the same provider+account instead of duplicating', async () => {
    const { mgr, events } = makeManager([SCOPE_GSC]);
    await mgr.connect('google', 'seo-insights', '', [SCOPE_GSC]);
    expect(mgr.listConnections()).toHaveLength(1);
    const firstId = mgr.listConnections()[0].id;

    // Second agent, expanded scopes, same Google account — same manager instance
    (mgr as never as { flowRunnerFactory: () => unknown }).flowRunnerFactory = () => ({
      run: async () => ({
        outcome: 'success' as const,
        accessToken: 'at2',
        refreshToken: 'rt2',
        expiresIn: 3600,
        scopes: [SCOPE_GSC, SCOPE_GA4], // union, thanks to include_granted_scopes
        accountLabel: 'user@acme.com',
      }),
    });
    await mgr.connect('google', 'web-analytics', '', [SCOPE_GA4]);

    const conns = mgr.listConnections();
    expect(conns).toHaveLength(1);
    expect(conns[0].id).toBe(firstId);
    expect(conns[0].grantedScopes).toEqual([SCOPE_GSC, SCOPE_GA4]);
    expect(events.some((e) => (e as { type: string }).type === 'credential:scope_added')).toBe(true);
  });

  it('creates a separate connection for a different Google account', async () => {
    const { mgr } = makeManager([SCOPE_GSC], 'user@acme.com');
    await mgr.connect('google', 'seo-insights', '', [SCOPE_GSC]);
    (mgr as never as { flowRunnerFactory: () => unknown }).flowRunnerFactory = () => ({
      run: async () => ({
        outcome: 'success' as const, accessToken: 'x', refreshToken: 'y', expiresIn: 3600,
        scopes: [SCOPE_GA4], accountLabel: 'other@client.com',
      }),
    });
    await mgr.connect('google', 'web-analytics', '', [SCOPE_GA4]);
    expect(mgr.listConnections()).toHaveLength(2);
  });
});
```

If `CredentialManager` has no public `listConnections()`, use the one the IPC handler uses (`mgr.listConnections()` is called in `ipc-handlers.ts:4862-4866`, so it exists).

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/credentials/CredentialManager.connect.test.ts`
Expected: FAIL — either `flowRunnerFactory` not accepted (fix constructor first, re-run) or, once accepted, `expect(conns).toHaveLength(1)` fails with 2 connections.

- [ ] **Step 3: Implement the reuse in `connect()`**

Replace the body after `if (result.outcome !== 'success') return;` in `CredentialManager.connect()` (currently lines ~134–157):

```ts
    if (result.outcome !== 'success') return;

    // Reuse an existing active connection for the same provider + account
    // instead of minting a duplicate. include_granted_scopes on the auth URL
    // means result.scopes is already the union of old + new grants.
    const existing = this.store.listConnections().find(
      (c) => c.provider === provider && c.status === 'active' && c.accountLabel === result.accountLabel,
    );

    const connectionId = existing?.id ?? crypto.randomUUID();
    const conn: Connection = {
      id: connectionId,
      provider: provider as 'google',
      accountLabel: result.accountLabel,
      grantedScopes: result.scopes,
      status: 'active',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastRefreshedAt: existing ? new Date().toISOString() : null,
    };

    this.vault.store(connectionId, provider, result.refreshToken);
    this.tokenCache.set(connectionId, {
      token: result.accessToken,
      expiresAt: Date.now() + result.expiresIn * 1000,
      scopes: result.scopes,
    });
    this.store.saveConnection(conn);
    this.store.saveGrant({ connectionId, agentId, siteId, scopes });

    this.emitCredentialEvent(
      existing
        ? { type: 'credential:scope_added', provider, scopes: result.scopes }
        : { type: 'credential:connected', provider, scopes: result.scopes },
    );
```

If the `CredentialEvent` union type in `src/main/credentials/types.ts` requires a different payload shape for `credential:scope_added`, match that declared shape — the type name is already declared at `types.ts:64`.

- [ ] **Step 4: Populate `scopeLabels` in `requestConnectionForAgent()`**

Replace the method body (currently lines ~111–123):

```ts
  async requestConnectionForAgent(
    provider: string,
    agentId: string,
    siteId: string,
    meta?: {
      scopes?: string[];
      agentName?: string;
      reason?: string;
      scopeLabels?: Record<string, string>;
    },
  ): Promise<void> {
    // Fill scope labels from provider metadata so the consent modal shows
    // human-readable names instead of raw scope URLs.
    const cfg = this.providerRegistry.get(provider);
    const scopeLabels = meta?.scopeLabels ?? (cfg && meta?.scopes
      ? Object.fromEntries(
          meta.scopes
            .filter((s) => cfg.scopeMetadata[s])
            .map((s) => [s, cfg.scopeMetadata[s].label]),
        )
      : undefined);
    this.emitNexusState({
      credentialConnectRequest: {
        provider, agentId, siteId, ...meta,
        ...(scopeLabels && Object.keys(scopeLabels).length > 0 ? { scopeLabels } : {}),
      },
    });
  }
```

- [ ] **Step 5: Run all credential tests**

Run: `npx jest tests/unit/credentials/`
Expected: PASS — including the pre-existing `AgentCredentialsContext.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/main/credentials/CredentialManager.ts tests/unit/credentials/CredentialManager.connect.test.ts
git commit -m "fix(credentials): reuse same-account connection on connect; label scopes in consent modal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `diagnose_site` composite tool

**Files:**
- Create: `src/main/mcp/modules/composite/diagnose-site.ts`
- Modify: `src/main/mcp/modules/composite/index.ts` (register)
- Modify: `src/main/mcp/safety.ts` (add `diagnose_site: 1` to the Tier 1 block of `TIER_OVERRIDES`)
- Test: `tests/unit/mcp/diagnose-site.test.ts`

**Interfaces:**
- Consumes: `getSiteTwinHandler` (exported from `src/main/mcp/modules/site-context/get-site-twin.ts`), `getSiteLogsHandler` (exported from `src/main/mcp/modules/site-management/get-site-logs.ts`), `resolveSite` from `src/main/mcp/site-resolver`, `ok`/`error` from `src/main/mcp/modules/wp-cli/preflight`, and `(services as any).dispatcher.dispatch(agentName, toolName, args)` — the same loose accessor ChatService uses (`ChatService.ts:296-320`).
- Produces: registry tool `diagnose_site` with args `{ site: string; timeframe_days?: number }` returning a JSON evidence bundle:
  `{ site: { name, domain, status? }, timeframeDays, evidence: Array<{ source: string; status: 'ok' | 'error' | 'not_connected'; data?: string; suggestion?: string }> }`
  Sources: `site_twin`, `site_logs`, `search_delta`, `traffic`, `access_log_aggregates`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp/diagnose-site.test.ts` (fixture pattern from `db-scanner.test.ts` — handlers called via `.execute()` directly, never `registry.call`):

```ts
import { diagnoseSiteHandler } from '../../../src/main/mcp/modules/composite/diagnose-site';
import type { LocalSiteInfo, NexusServices, SiteDataAccessor } from '../../../src/main/mcp/types';

const site: LocalSiteInfo = {
  id: 'site-1',
  name: 'acme',
  domain: 'acme.local',
  path: '/Users/test/Local Sites/acme',
} as LocalSiteInfo;

const createMockSiteData = (sites: LocalSiteInfo[]): SiteDataAccessor => {
  const byId: Record<string, LocalSiteInfo> = {};
  sites.forEach((s) => { byId[s.id] = s; });
  return {
    getSite: (id: string) => byId[id] ?? null,
    getSites: () => byId,
  };
};

function makeServices(overrides: {
  dispatch?: jest.Mock;
  sites?: LocalSiteInfo[];
} = {}): NexusServices {
  const services = {
    vectorStore: {} as never,
    embeddingService: {} as never,
    contentPipeline: {} as never,
    indexRegistry: {} as never,
    fileScanner: {} as never,
    siteData: createMockSiteData(overrides.sites ?? [site]),
    graphService: {} as never,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never,
    auditLogger: {} as never,
    localServices: {} as never,
    registryStorage: { get: jest.fn().mockReturnValue(null), set: jest.fn() } as never,
  } as NexusServices;
  if (overrides.dispatch) {
    (services as never as { dispatcher: unknown }).dispatcher = { dispatch: overrides.dispatch };
  }
  return services;
}

// The twin and logs handlers hit real site paths/services in-process; for unit
// tests we only assert bundle structure, so their per-source failures are fine
// (they degrade to status 'error', which is itself part of the contract).

describe('diagnose_site', () => {
  it('returns an error for an unknown site', async () => {
    const result = await diagnoseSiteHandler.execute({ site: 'ghost' }, makeServices({ sites: [] }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('marks agent-backed sources not_connected with suggestions when no dispatcher exists', async () => {
    const result = await diagnoseSiteHandler.execute({ site: 'acme' }, makeServices());
    expect(result.isError).toBeUndefined();
    const bundle = JSON.parse(result.content[0].text);
    const traffic = bundle.evidence.find((e: { source: string }) => e.source === 'traffic');
    expect(traffic.status).toBe('not_connected');
    expect(traffic.suggestion).toMatch(/Google Analytics/);
    const search = bundle.evidence.find((e: { source: string }) => e.source === 'search_delta');
    expect(search.status).toBe('not_connected');
  });

  it('collects dispatcher-backed evidence and passes tool text through', async () => {
    const dispatch = jest.fn()
      .mockImplementation(async (agentName: string) => ({
        content: [{ type: 'text', text: `${agentName}-evidence` }],
      }));
    const result = await diagnoseSiteHandler.execute({ site: 'acme', timeframe_days: 7 }, makeServices({ dispatch }));
    const bundle = JSON.parse(result.content[0].text);

    expect(dispatch).toHaveBeenCalledWith('web-analytics', 'anomaly_scan', { siteId: 'acme', days: 7 });
    expect(dispatch).toHaveBeenCalledWith('seo-insights', 'detect_decay', { siteId: 'acme' });
    expect(dispatch).toHaveBeenCalledWith('log-processor', 'get_log_aggregates', expect.objectContaining({ siteId: 'acme' }));
    const traffic = bundle.evidence.find((e: { source: string }) => e.source === 'traffic');
    expect(traffic.status).toBe('ok');
    expect(traffic.data).toBe('web-analytics-evidence');
  });

  it('degrades a throwing source to error without failing the bundle', async () => {
    const dispatch = jest.fn().mockRejectedValue(new Error('agent exploded'));
    const result = await diagnoseSiteHandler.execute({ site: 'acme' }, makeServices({ dispatch }));
    expect(result.isError).toBeUndefined();
    const bundle = JSON.parse(result.content[0].text);
    const traffic = bundle.evidence.find((e: { source: string }) => e.source === 'traffic');
    expect(traffic.status).toBe('error');
    expect(traffic.data).toContain('agent exploded');
  });

  it('marks isError tool results as error status', async () => {
    const dispatch = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '⚠ no property mapped' }], isError: true });
    const result = await diagnoseSiteHandler.execute({ site: 'acme' }, makeServices({ dispatch }));
    const bundle = JSON.parse(result.content[0].text);
    const traffic = bundle.evidence.find((e: { source: string }) => e.source === 'traffic');
    expect(traffic.status).toBe('error');
    expect(traffic.data).toContain('no property mapped');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/mcp/diagnose-site.test.ts`
Expected: FAIL — cannot find module `diagnose-site`.

- [ ] **Step 3: Implement `src/main/mcp/modules/composite/diagnose-site.ts`**

```ts
import { McpToolHandler, McpToolResult, NexusServices } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error } from '../wp-cli/preflight';
import { getSiteTwinHandler } from '../site-context/get-site-twin';
import { getSiteLogsHandler } from '../site-management/get-site-logs';

/**
 * Composite triage tool: gathers every available evidence source for a site
 * in parallel and returns a structured bundle for the chat model to reason
 * over. A missing source NEVER fails the bundle — it degrades to
 * not_connected with a suggestion, which is how the Integrations catalog
 * gets discovered ("connect GA4 and I can tell you if visitors are affected").
 */

const SOURCE_TIMEOUT_MS = 15_000;

interface Evidence {
  source: string;
  status: 'ok' | 'error' | 'not_connected';
  data?: string;
  suggestion?: string;
}

interface AgentToolResultShape {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${SOURCE_TIMEOUT_MS}ms`)), SOURCE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer!));
}

function textOf(result: McpToolResult | AgentToolResultShape): string {
  return result.content.map((c) => c.text).join('\n');
}

/** Wrap a registry handler call as an evidence source. */
async function handlerEvidence(
  source: string,
  handler: McpToolHandler,
  args: Record<string, unknown>,
  services: NexusServices,
): Promise<Evidence> {
  try {
    const result = await withTimeout(handler.execute(args, services), source);
    return { source, status: result.isError ? 'error' : 'ok', data: textOf(result) };
  } catch (e: unknown) {
    return { source, status: 'error', data: (e as Error).message };
  }
}

/** Wrap an agent-contributed tool dispatch as an evidence source. */
async function agentEvidence(
  source: string,
  services: NexusServices,
  agentName: string,
  toolName: string,
  args: Record<string, unknown>,
  suggestion: string,
): Promise<Evidence> {
  const dispatcher = (services as unknown as {
    dispatcher?: { dispatch: (a: string, t: string, args: Record<string, unknown>) => Promise<AgentToolResultShape> };
  }).dispatcher;
  if (!dispatcher) {
    return { source, status: 'not_connected', suggestion };
  }
  try {
    const result = await withTimeout(dispatcher.dispatch(agentName, toolName, args), source);
    if (result.isError) return { source, status: 'error', data: textOf(result), suggestion };
    return { source, status: 'ok', data: textOf(result) };
  } catch (e: unknown) {
    return { source, status: 'error', data: (e as Error).message, suggestion };
  }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const diagnoseSiteHandler: McpToolHandler = {
  definition: {
    name: 'diagnose_site',
    description:
      'Investigate a reported problem on a site — the FIRST tool to call when a user says something is wrong, broken, slow, or "my boss says there\'s a problem". Gathers all available evidence in parallel: site state and recent changes (digital twin), PHP/nginx logs, Search Console decay, GA4 traffic anomalies, and access-log aggregates. Returns a structured evidence bundle; sources that are not connected are listed with how to connect them. Follow up on specific evidence with page_performance, fetch_log_window, or GSC tools.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
        timeframe_days: { type: 'number', description: 'Evidence window in days (default: 7). Use a larger window for "since last month" reports.' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.siteData,
    annotations: { title: 'Diagnose Site', readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const days = typeof args.timeframe_days === 'number' && args.timeframe_days > 0
      ? Math.min(args.timeframe_days, 90)
      : 7;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const settled = await Promise.allSettled([
      handlerEvidence('site_twin', getSiteTwinHandler, { site: site.name }, services),
      handlerEvidence('site_logs', getSiteLogsHandler, { site: site.name, logType: 'all', lines: 200 }, services),
      agentEvidence('search_delta', services, 'seo-insights', 'detect_decay', { siteId: site.name },
        'Connect Google Search Console (Settings → Integrations) to include search performance evidence.'),
      agentEvidence('traffic', services, 'web-analytics', 'anomaly_scan', { siteId: site.name, days },
        'Connect Google Analytics (Settings → Integrations) and map a GA4 property to include traffic evidence — it will show whether visitors are affected.'),
      agentEvidence('access_log_aggregates', services, 'log-processor', 'get_log_aggregates',
        { siteId: site.name, from: isoDay(from), to: isoDay(to) },
        'Connect an access-log source (log-processor agent) to include server traffic evidence.'),
    ]);

    // allSettled never leaves a hole: our evidence wrappers already catch, so
    // rejected here means a programming error — still surface it as evidence.
    const evidence: Evidence[] = settled.map((s, i) =>
      s.status === 'fulfilled'
        ? s.value
        : { source: ['site_twin', 'site_logs', 'search_delta', 'traffic', 'access_log_aggregates'][i], status: 'error', data: String(s.reason) },
    );

    return ok(JSON.stringify({
      site: { name: site.name, domain: site.domain },
      timeframeDays: days,
      evidence,
    }, null, 2));
  },
};
```

- [ ] **Step 4: Register + tier**

In `src/main/mcp/modules/composite/index.ts`:

```ts
import { diagnoseSiteHandler } from './diagnose-site';
```
and inside `registerCompositeTools`:
```ts
  registry.register(diagnoseSiteHandler);
```

In `src/main/mcp/safety.ts`, add to the **Tier 1 — Read** block of `TIER_OVERRIDES`:

```ts
  diagnose_site: 1,
```

- [ ] **Step 5: Run to verify pass**

Run: `npx jest tests/unit/mcp/diagnose-site.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/modules/composite/diagnose-site.ts src/main/mcp/modules/composite/index.ts src/main/mcp/safety.ts tests/unit/mcp/diagnose-site.test.ts
git commit -m "feat(composite): diagnose_site evidence-bundle triage tool

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `disabledIntegrations` setting + chat tool scoping

**Files:**
- Modify: `src/common/types.ts` (`NexusSettings`, ~line 336)
- Modify: `src/common/schemas.ts` (`UpdateSettingsSchema`, ~line 46-72)
- Modify: `src/main/chat/tool-adapter.ts`
- Test: `tests/unit/chat/tool-adapter.test.ts` (new)

**Interfaces:**
- Consumes: `ContributedToolRegistry.toMcpDefinitions(isEnabled?)` — the filter callback already exists (`ContributedToolRegistry.ts:60-68`); `STORAGE_KEYS.SETTINGS` via `services.registryStorage`.
- Produces: `NexusSettings.disabledIntegrations?: string[]` — a list of **agent names** whose contributed tools are hidden from chat. Task 6's Integrations toggle reads/writes this field.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chat/tool-adapter.test.ts`:

```ts
import { adaptToolsForChat } from '../../../src/main/chat/tool-adapter';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { STORAGE_KEYS } from '../../../src/common/constants';
import type { NexusServices } from '../../../src/main/mcp/types';

const CONTRIBUTED = [
  { agentName: 'web-analytics', name: 'agent__web-analytics__anomaly_scan', description: 'scan', inputSchema: { type: 'object', properties: {} } },
  { agentName: 'seo-insights', name: 'agent__seo-insights__detect_decay', description: 'decay', inputSchema: { type: 'object', properties: {} } },
];

function makeServices(disabledIntegrations?: string[]): NexusServices {
  const services = {
    registryStorage: {
      get: (key: string) => (key === STORAGE_KEYS.SETTINGS ? { disabledIntegrations } : null),
      set: jest.fn(),
    },
    // adaptToolsForChat only touches registryStorage + contributedRegistry on services
  } as unknown as NexusServices;
  (services as unknown as { contributedRegistry: unknown }).contributedRegistry = {
    toMcpDefinitions: (isEnabled?: (agentName: string) => boolean) =>
      CONTRIBUTED.filter((t) => !isEnabled || isEnabled(t.agentName))
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  };
  return services;
}

describe('adaptToolsForChat integration scoping', () => {
  it('includes all contributed tools when nothing is disabled', () => {
    const tools = adaptToolsForChat(new ToolRegistry(), makeServices());
    const names = tools.map((t) => t.name);
    expect(names).toContain('agent__web-analytics__anomaly_scan');
    expect(names).toContain('agent__seo-insights__detect_decay');
  });

  it('hides contributed tools of disabled integrations', () => {
    const tools = adaptToolsForChat(new ToolRegistry(), makeServices(['web-analytics']));
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('agent__web-analytics__anomaly_scan');
    expect(names).toContain('agent__seo-insights__detect_decay');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/chat/tool-adapter.test.ts`
Expected: the "hides" test FAILS (both tools present — no filtering exists yet).

- [ ] **Step 3: Add the setting**

In `src/common/types.ts`, append to `NexusSettings` (after `enableHubBridge`):

```ts
  /** Agent names whose contributed tools are hidden from chat (Integrations toggle). Default: none. */
  disabledIntegrations?: string[];
```

In `src/common/schemas.ts`, add inside `UpdateSettingsSchema` (the object is `.strict()` — this line is mandatory, not optional):

```ts
  disabledIntegrations: z.array(z.string()).optional(),
```

- [ ] **Step 4: Filter in `tool-adapter.ts`**

In `src/main/chat/tool-adapter.ts`, add the import:

```ts
import { STORAGE_KEYS } from '../../common/constants';
```

and replace the contributed-tools line:

```ts
  // Append contributed agent tools (agent__<name>__<tool>) from ContributedToolRegistry,
  // filtered by the user's Integrations enable/disable toggles.
  const settings = (services.registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as { disabledIntegrations?: string[] };
  const disabled = new Set(settings.disabledIntegrations ?? []);
  const contributedDefs = (services as any).contributedRegistry?.toMcpDefinitions(
    (agentName: string) => !disabled.has(agentName),
  ) ?? [];
```

- [ ] **Step 5: Run to verify pass**

Run: `npx jest tests/unit/chat/tool-adapter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/common/types.ts src/common/schemas.ts src/main/chat/tool-adapter.ts tests/unit/chat/tool-adapter.test.ts
git commit -m "feat(chat): per-integration tool scoping via disabledIntegrations setting

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Integrations catalog + Settings section

**Files:**
- Create: `src/renderer/components/integrations/catalog.ts`
- Modify: `src/renderer/components/SettingsTab.tsx` (new section; state + data load + render method)
- Test: `tests/unit/renderer/integrations-catalog.test.ts` (new — pure logic only, no DOM)

**Interfaces:**
- Consumes: IPC `CREDENTIAL_STATUS` (returns `{ connections: Connection[] }`), `CREDENTIAL_CONNECT` (`{ provider, agentId, siteId, scopes }`), `CREDENTIAL_API_KEY_STATUS`; `saveSetting(patch)` in SettingsTab; `NexusSettings.disabledIntegrations` from Task 5.
- Produces: `INTEGRATIONS: IntegrationEntry[]`, `resolveIntegrationStatus(entry, oauthConnections, apiKeyProviders): IntegrationStatus` — the catalog schema anticipates future transports (`mcp`, `cli`, `app`) per the spec.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/integrations-catalog.test.ts`:

```ts
import { INTEGRATIONS, resolveIntegrationStatus } from '../../../src/renderer/components/integrations/catalog';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

describe('INTEGRATIONS catalog', () => {
  it('ships the three launch entries', () => {
    expect(INTEGRATIONS.map((e) => e.id)).toEqual(['google-analytics', 'google-search-console', 'access-logs']);
  });
});

describe('resolveIntegrationStatus', () => {
  const ga4 = INTEGRATIONS.find((e) => e.id === 'google-analytics')!;
  const logs = INTEGRATIONS.find((e) => e.id === 'access-logs')!;

  it('not_connected with no connections', () => {
    expect(resolveIntegrationStatus(ga4, [], [])).toBe('not_connected');
  });

  it('connected when an active connection grants the required scope', () => {
    const conns = [{ provider: 'google', status: 'active' as const, grantedScopes: [GA4_SCOPE, GSC_SCOPE] }];
    expect(resolveIntegrationStatus(ga4, conns, [])).toBe('connected');
  });

  it('needs_scope when connected without the required scope', () => {
    const conns = [{ provider: 'google', status: 'active' as const, grantedScopes: [GSC_SCOPE] }];
    expect(resolveIntegrationStatus(ga4, conns, [])).toBe('needs_scope');
  });

  it('revoked when the only connection is revoked', () => {
    const conns = [{ provider: 'google', status: 'revoked' as const, grantedScopes: [GA4_SCOPE] }];
    expect(resolveIntegrationStatus(ga4, conns, [])).toBe('revoked');
  });

  it('api-key entries resolve against api key providers', () => {
    expect(resolveIntegrationStatus(logs, [], ['aws'])).toBe('connected');
    expect(resolveIntegrationStatus(logs, [], [])).toBe('not_connected');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/renderer/integrations-catalog.test.ts`
Expected: FAIL — cannot find module `catalog`.

- [ ] **Step 3: Implement `src/renderer/components/integrations/catalog.ts`**

```ts
/**
 * Integrations catalog — the static registry of connectable integrations.
 *
 * Slice 1 ships api-agent and api-key transports (both already exist in the
 * credential system). The transport union deliberately anticipates future
 * slices: 'mcp' (external MCP servers), 'cli' (gh/git adapters), 'app'
 * (open-in-editor handoffs) — adding those becomes a catalog entry + a
 * transport implementation, not an architecture change.
 */

export type IntegrationTransport = 'api-agent' | 'api-key' | 'mcp' | 'cli' | 'app';

export interface IntegrationEntry {
  id: string;
  name: string;
  description: string;
  transport: IntegrationTransport;
  /** ContributedToolRegistry namespace — what disabledIntegrations toggles. */
  agentName: string;
  provider: 'google' | 'aws';
  /** OAuth scopes required (api-agent transport only). */
  scopes?: string[];
  personaTags: string[];
}

export type IntegrationStatus = 'connected' | 'not_connected' | 'revoked' | 'needs_scope';

export interface OauthConnectionSummary {
  provider: string;
  status: 'active' | 'revoked' | 'error';
  grantedScopes: string[];
}

export const INTEGRATIONS: IntegrationEntry[] = [
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    description: 'Traffic, conversions, and anomaly evidence for diagnosing site problems.',
    transport: 'api-agent',
    agentName: 'web-analytics',
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    personaTags: ['agency', 'content'],
  },
  {
    id: 'google-search-console',
    name: 'Google Search Console',
    description: 'Search performance, demand gaps, and content decay analysis.',
    transport: 'api-agent',
    agentName: 'seo-insights',
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    personaTags: ['agency', 'content'],
  },
  {
    id: 'access-logs',
    name: 'Access Logs (S3)',
    description: 'WP Engine access-log ingestion for traffic forensics and AI-crawler analysis.',
    transport: 'api-key',
    agentName: 'log-processor',
    provider: 'aws',
    personaTags: ['agency', 'developer'],
  },
];

export function resolveIntegrationStatus(
  entry: IntegrationEntry,
  oauthConnections: OauthConnectionSummary[],
  apiKeyProviders: string[],
): IntegrationStatus {
  if (entry.transport === 'api-key') {
    return apiKeyProviders.includes(entry.provider) ? 'connected' : 'not_connected';
  }
  const forProvider = oauthConnections.filter((c) => c.provider === entry.provider);
  if (forProvider.length === 0) return 'not_connected';
  const active = forProvider.filter((c) => c.status === 'active');
  if (active.length === 0) return 'revoked';
  const required = entry.scopes ?? [];
  const covered = active.some((c) => required.every((s) => c.grantedScopes.includes(s)));
  return covered ? 'connected' : 'needs_scope';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/unit/renderer/integrations-catalog.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the Integrations section to `SettingsTab.tsx`**

House style: class component, `React.createElement` only, no JSX, no hooks. Reuse the existing style constants (`cardStyle`, `rowStyle`, `rowLabelStyle`, `rowTitleStyle`, `rowSubStyle`, `rowControlStyle` at `SettingsTab.tsx:60-83`).

1. Imports (top of file):

```ts
import { INTEGRATIONS, resolveIntegrationStatus, IntegrationEntry, OauthConnectionSummary } from './integrations/catalog';
```

2. Extend `SettingsTabState` with:

```ts
  oauthConnections: OauthConnectionSummary[];
  apiKeyProviders: string[];
  connecting: string | null; // integration id mid-connect
```
Initialize in the constructor's state object: `oauthConnections: [], apiKeyProviders: [], connecting: null`.

3. In the data-load `Promise.all` (at ~line 115-131), add two invokes and store results:

```ts
      this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_STATUS).catch(() => ({ connections: [] })),
      this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_API_KEY_STATUS).catch(() => ({ connections: [] })),
```
Map into state: `oauthConnections: credStatus.connections ?? []` and `apiKeyProviders: (apiKeyStatus.connections ?? []).filter((c: { status: string }) => c.status === 'active').map((c: { provider: string }) => c.provider)`. (Open `ipc-handlers.ts:4886-4916` while implementing to confirm the exact `CREDENTIAL_API_KEY_STATUS` response shape and adjust the mapping to it.)

4. Add the connect handler and section renderer as class methods:

```ts
  private handleConnectIntegration = async (entry: IntegrationEntry) => {
    this.setState({ connecting: entry.id });
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_CONNECT, {
        provider: entry.provider,
        agentId: entry.agentName,
        siteId: '',
        scopes: entry.scopes ?? [],
      });
      const credStatus = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_STATUS);
      this.setState({ oauthConnections: credStatus.connections ?? [] });
    } finally {
      this.setState({ connecting: null });
    }
  };

  private toggleIntegration = (agentName: string, enabled: boolean) => {
    const current = this.state.settings?.disabledIntegrations ?? [];
    const next = enabled ? current.filter((n) => n !== agentName) : [...current, agentName];
    this.saveSetting({ disabledIntegrations: next });
  };

  renderIntegrationsSection(): React.ReactNode {
    const { oauthConnections, apiKeyProviders, connecting } = this.state;
    const disabled = new Set(this.state.settings?.disabledIntegrations ?? []);

    const STATUS_LABEL: Record<string, { text: string; color: string }> = {
      connected: { text: 'Connected', color: '#51bb7b' },
      not_connected: { text: 'Not connected', color: 'var(--nxai-card-sub, #6b7280)' },
      needs_scope: { text: 'Needs re-connect (missing permission)', color: '#e0a800' },
      revoked: { text: 'Revoked — reconnect', color: '#d63638' },
    };

    return React.createElement('div', { style: cardStyle },
      ...INTEGRATIONS.map((entry) => {
        const status = resolveIntegrationStatus(entry, oauthConnections, apiKeyProviders);
        const label = STATUS_LABEL[status];
        const enabled = !disabled.has(entry.agentName);
        const showConnect = entry.transport === 'api-agent' && status !== 'connected';

        return React.createElement('div', { key: entry.id, style: rowStyle },
          React.createElement('div', { style: rowLabelStyle },
            React.createElement('div', { style: rowTitleStyle }, entry.name),
            React.createElement('div', { style: rowSubStyle }, entry.description),
            React.createElement('div', { style: { ...rowSubStyle, color: label.color } }, label.text),
          ),
          React.createElement('div', { style: rowControlStyle },
            showConnect
              ? React.createElement('button', {
                  onClick: () => this.handleConnectIntegration(entry),
                  disabled: connecting === entry.id,
                }, connecting === entry.id ? 'Connecting…' : 'Connect')
              : null,
            entry.transport === 'api-key' && status !== 'connected'
              ? React.createElement('span', { style: rowSubStyle }, 'Set up via the log-processor agent')
              : null,
            React.createElement('label', { style: { marginLeft: 12 } },
              React.createElement('input', {
                type: 'checkbox',
                checked: enabled,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.toggleIntegration(entry.agentName, e.target.checked),
              }),
              ' Enabled in chat',
            ),
          ),
        );
      }),
    );
  }
```

5. In `render()` (at ~line 695-718), add before the closing of the container:

```ts
      sectionHeader('Integrations'),
      this.renderIntegrationsSection(),
```

- [ ] **Step 6: Compile + run renderer tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest tests/unit/renderer/`
Expected: clean compile; all renderer tests PASS (pre-existing + new catalog tests).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/integrations src/renderer/components/SettingsTab.tsx tests/unit/renderer/integrations-catalog.test.ts
git commit -m "feat(settings): Integrations section — catalog, connect, per-integration chat toggle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Eval scenario + full verification

**Files:**
- Modify: `tests/eval/chat-evals.test.ts` (add `diagnose_site` to `EVAL_TOOLS` + a routing eval)

**Interfaces:**
- Consumes: the `EVAL_TOOLS` array and the file's existing eval helper (it calls Ollama directly and returns `{ content, toolCalls }`; tests auto-skip when Ollama isn't running).

- [ ] **Step 1: Add `diagnose_site` to `EVAL_TOOLS`**

Append to the `EVAL_TOOLS` array in `tests/eval/chat-evals.test.ts` (same Ollama function format as the existing entries):

```ts
  {
    type: 'function' as const,
    function: {
      name: 'diagnose_site',
      description: 'Investigate a reported problem on a site — the FIRST tool to call when a user says something is wrong, broken, slow, or "my boss says there is a problem". Gathers all available evidence in parallel: site state, logs, search performance, and traffic anomalies.',
      parameters: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Site name, ID, or domain' },
          timeframe_days: { type: 'number', description: 'Evidence window in days (default: 7)' },
        },
        required: ['site'],
      },
    },
  },
```

- [ ] **Step 2: Add the "boss ping" routing eval**

Read the existing test cases below line 120 of the file and add one more using the same helper they use (the file defines a single eval-call helper that sends a prompt with `EVAL_TOOLS` and returns `ChatEvalResult`):

```ts
  it('routes a boss-ping problem report to diagnose_site', async () => {
    const result = await chatEval('My boss thinks there is a problem with the acme site — can you investigate?');
    expect(result.toolCalls.length).toBeGreaterThan(0);
    expect(result.toolCalls[0].function.name).toBe('diagnose_site');
    expect(result.toolCalls[0].function.arguments.site).toBe('acme');
  });
```

(If the helper has a different name than `chatEval`, use the name the neighboring tests use — assertions stay exactly as above.)

- [ ] **Step 3: Run the eval suite (best-effort — requires Ollama)**

Run: `npm run test:eval`
Expected: the new eval passes, or the suite auto-skips if Ollama is not running (both acceptable — evals are advisory, not gating).

- [ ] **Step 4: Full unit suite + agent sync**

```bash
npm test
npm run sync-agents
```
Expected: all unit suites pass (the 5 pre-existing native-module suite failures are known and unrelated); sync copies `web-analytics` to AGENTS_DIR.

- [ ] **Step 5: Commit**

```bash
git add tests/eval/chat-evals.test.ts
git commit -m "test(eval): boss-ping routing eval for diagnose_site

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual acceptance (requires Local + a real GA4 account)**

Not automatable — run the demo script from the spec in three states and record results in the PR/notes:
1. **GA4 unconnected:** ask chat *"my boss thinks there's a problem with <site> — investigate."* Expect a diagnosis from twin + logs, with the model relaying the "Connect Google Analytics" suggestion.
2. **GA4 connected, unmapped:** expect the model to offer `map_property` with the property list.
3. **GA4 connected + mapped:** expect traffic evidence (channel/page deltas) woven into the diagnosis.
Reload flow after building: `./dev-reload.sh` (never hand-rolled pkill/build/open).

---

## Self-review notes (resolved during planning)

- **Spec coverage:** GA4 agent (Tasks 1–2), incremental consent + scope labels (Task 3 — spec's "consent modal re-runs for the expanded grant" promise required this fix; discovered during exploration that reuse didn't exist), `diagnose_site` (Task 4), scoping (Task 5), catalog + Settings section (Task 6), eval + acceptance (Task 7). Spec's "auto-suggest by domain match against the fleet" is implemented as a model-supplied `domain` arg on `map_property` — the chat model always knows the domain from context, avoiding a fleet-query dependency inside the agent.
- **`needs_mapping` status** from the spec is realized as an `error`-status evidence entry whose text contains the `map_property` instruction (the agent tool's own error text) — the model relays it identically; a distinct enum value added no behavior.
- **Type consistency check:** `agent__web-analytics__anomaly_scan` args `{ siteId, days }` (Task 2) match Task 4's dispatch call. `disabledIntegrations` (Task 5) matches Task 6's toggle. `Ga4Row.metrics` order = `GA4_METRICS` order everywhere.
- **Known sharp edges for implementers:** `mockContext()` has no credentials override — mutate the returned object; `executionMode` must be `'function'` for all web-analytics tools (`'run'` would discard handler results); the YAML manifest is what registers tools with MCP/chat — forgetting to mirror agent.ts into YAML means tools silently don't appear.
