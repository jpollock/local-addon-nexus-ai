import { ConnectionStore } from '../../../src/main/credentials/ConnectionStore';
import type { Connection, Grant } from '../../../src/main/credentials/types';

function makeStorage() {
  const store = new Map<string, any>();
  return { get: (k: string) => store.get(k) ?? null, set: (k: string, v: any) => store.set(k, v) };
}

function makeConnection(id: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    provider: 'google',
    accountLabel: 'user@example.com',
    grantedScopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    status: 'active',
    createdAt: new Date().toISOString(),
    lastRefreshedAt: null,
    ...overrides,
  };
}

function makeGrant(connectionId: string, agentId: string, siteId: string): Grant {
  return { connectionId, agentId, siteId, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] };
}

describe('ConnectionStore', () => {
  it('saveConnection + getConnection round-trip', () => {
    const store = new ConnectionStore(makeStorage());
    const conn = makeConnection('c1');
    store.saveConnection(conn);
    expect(store.getConnection('c1')).toEqual(conn);
  });

  it('listConnections returns all saved connections', () => {
    const store = new ConnectionStore(makeStorage());
    store.saveConnection(makeConnection('c1'));
    store.saveConnection(makeConnection('c2'));
    expect(store.listConnections()).toHaveLength(2);
  });

  it('deleteConnection removes it from listConnections', () => {
    const store = new ConnectionStore(makeStorage());
    store.saveConnection(makeConnection('c1'));
    store.deleteConnection('c1');
    expect(store.getConnection('c1')).toBeNull();
    expect(store.listConnections()).toHaveLength(0);
  });

  it('saveGrant + getGrant round-trip', () => {
    const store = new ConnectionStore(makeStorage());
    const grant = makeGrant('c1', 'seo-insights', 'site-1');
    store.saveGrant(grant);
    expect(store.getGrant('c1', 'seo-insights', 'site-1')).toEqual(grant);
  });

  it('listGrantsForConnection returns only matching grants', () => {
    const store = new ConnectionStore(makeStorage());
    store.saveGrant(makeGrant('c1', 'seo-insights', 'site-1'));
    store.saveGrant(makeGrant('c1', 'sentinel', 'site-1'));
    store.saveGrant(makeGrant('c2', 'seo-insights', 'site-1'));
    expect(store.listGrantsForConnection('c1')).toHaveLength(2);
  });

  it('deleteGrantsForConnection removes all grants for that connection', () => {
    const store = new ConnectionStore(makeStorage());
    store.saveGrant(makeGrant('c1', 'seo-insights', 'site-1'));
    store.saveGrant(makeGrant('c1', 'sentinel', 'site-1'));
    store.saveGrant(makeGrant('c2', 'seo-insights', 'site-1'));
    store.deleteGrantsForConnection('c1');
    expect(store.listGrantsForConnection('c1')).toHaveLength(0);
    expect(store.listGrantsForConnection('c2')).toHaveLength(1);
  });
});
