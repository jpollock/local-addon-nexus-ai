/**
 * web-analytics × multiple connected Google accounts (2026-08-26).
 *
 * The credential store was always multi-connection; the agent's reach path
 * was single-token, so a second Google account's GA4 properties were
 * invisible and a binding never recorded which account it belonged to.
 * These pin the widened behavior:
 *
 *  - list_properties aggregates EVERY granted account and labels each
 *    property with the account it came from; an account whose token failed
 *    is REPORTED, never silently absent (silent absence reads as "no
 *    properties there");
 *  - map_property stamps the binding with the connection that served the
 *    chosen property, so report tools query the right account forever after;
 *  - report tools use the binding's own account token; a legacy binding
 *    (no connectionId) keeps the first-grant path unchanged;
 *  - with a credential backend that predates multi-account, everything
 *    behaves exactly as before (feature detection, not a hard dependency).
 */
import webAnalytics, { readBinding } from '../../../../agents/web-analytics/agent';
import { mockContext, testTool } from '../../../../src/main/agent-sdk/testing';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

const PROPS_BY_TOKEN: Record<string, unknown> = {
  at_alpha: {
    accountSummaries: [{
      displayName: 'Alpha Org',
      propertySummaries: [{ property: 'properties/111', displayName: 'alpha-site' }],
    }],
  },
  at_beta: {
    accountSummaries: [{
      displayName: 'Beta Org',
      propertySummaries: [{ property: 'properties/222', displayName: 'beta-site' }],
    }],
  },
};

function multiAccountCtx(overrides: Record<string, unknown> = {}) {
  const ctx = mockContext({});
  const stateStore = new Map<string, string>();
  (ctx as any).state = {
    get: (k: string) => stateStore.get(k),
    set: (k: string, v: string) => stateStore.set(k, v),
  };
  (ctx as any).credentials = {
    getStatus: async () => 'connected',
    requestConnection: async () => {},
    getToken: async () => ({ token: 'at_alpha', expiresAt: '', scopes: [GA4_SCOPE] }),
    listConnections: async () => [
      { connectionId: 'c_alpha', accountLabel: 'alpha@example.com', status: 'active' },
      { connectionId: 'c_beta', accountLabel: 'beta@example.com', status: 'active' },
    ],
    getTokenFor: async (_p: string, connectionId: string) => {
      if (connectionId === 'c_alpha') return { token: 'at_alpha', expiresAt: '', scopes: [GA4_SCOPE] };
      if (connectionId === 'c_beta') return { token: 'at_beta', expiresAt: '', scopes: [GA4_SCOPE] };
      throw new Error(`unknown connection ${connectionId}`);
    },
    ...overrides,
  };
  return ctx;
}

beforeEach(() => {
  global.fetch = jest.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    const token = (init?.headers?.Authorization ?? '').replace('Bearer ', '');
    return {
      ok: true,
      status: 200,
      json: async () => PROPS_BY_TOKEN[token] ?? { accountSummaries: [] },
    };
  }) as never;
});

describe('list_properties across accounts', () => {
  it('aggregates every granted account, labelling each property with its account', async () => {
    const result = await testTool(webAnalytics, 'list_properties', { format: 'json' }, multiAccountCtx());
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    const byProp = Object.fromEntries(payload.properties.map((p: any) => [p.property, p]));
    expect(byProp['properties/111'].accountLabel).toBe('alpha@example.com');
    expect(byProp['properties/111'].connectionId).toBe('c_alpha');
    expect(byProp['properties/222'].accountLabel).toBe('beta@example.com');
  });

  it('an account whose token failed is REPORTED, never silently absent', async () => {
    const ctx = multiAccountCtx({
      getTokenFor: async (_p: string, id: string) => {
        if (id === 'c_alpha') return { token: 'at_alpha', expiresAt: '', scopes: [GA4_SCOPE] };
        throw new Error('refresh rejected');
      },
    });
    const result = await testTool(webAnalytics, 'list_properties', { format: 'json' }, ctx);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.properties.map((p: any) => p.property)).toEqual(['properties/111']);
    expect(JSON.stringify(payload.accountErrors)).toContain('beta@example.com');
  });

  it('a backend without multi-account keeps the single-token behavior byte-for-byte', async () => {
    const ctx = multiAccountCtx({ listConnections: undefined, getTokenFor: undefined });
    const result = await testTool(webAnalytics, 'list_properties', { format: 'json' }, ctx);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.properties.map((p: any) => p.property)).toEqual(['properties/111']);
  });
});

describe('map_property stamps the serving account', () => {
  it('the binding records connectionId + accountLabel of the account that has the property', async () => {
    const ctx = multiAccountCtx();
    const result = await testTool(webAnalytics, 'map_property',
      { siteId: 'mysite', propertyId: '222', format: 'json' }, ctx);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.binding.connectionId).toBe('c_beta');
    expect(payload.binding.accountLabel).toBe('beta@example.com');
    const stored = readBinding((ctx as any).state.get('ga4Property:mysite'));
    expect(stored?.connectionId).toBe('c_beta');
  });
});

describe('report tools use the binding\'s own account', () => {
  it('traffic_summary queries with the bound connection\'s token', async () => {
    const ctx = multiAccountCtx();
    await testTool(webAnalytics, 'map_property', { siteId: 'mysite', propertyId: '222' }, ctx);
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init?: { headers?: Record<string, string> }) => ({
      ok: true, status: 200,
      json: async () => ({ rows: [] }),
    }));
    await testTool(webAnalytics, 'traffic_summary', { siteId: 'mysite', days: 7 }, ctx);
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) {
      expect(init.headers.Authorization).toBe('Bearer at_beta');
    }
  });

  it('a LEGACY binding (no connectionId) keeps the first-grant token path', async () => {
    const ctx = multiAccountCtx();
    (ctx as any).state.set('ga4Property:oldsite', JSON.stringify({ property: 'properties/111' }));
    (global.fetch as jest.Mock).mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) }));
    await testTool(webAnalytics, 'traffic_summary', { siteId: 'oldsite', days: 7 }, ctx);
    const calls = (global.fetch as jest.Mock).mock.calls.filter(([u]: [string]) => String(u).includes('runReport'));
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) {
      expect(init.headers.Authorization).toBe('Bearer at_alpha');
    }
  });
});
