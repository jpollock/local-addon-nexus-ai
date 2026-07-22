import { ApiKeyConnectionStore } from '../../../src/main/credentials/ApiKeyConnectionStore';
import type { ApiKeyConnection } from '../../../src/main/credentials/types';

function makeStore(): ApiKeyConnectionStore {
  const mem = new Map<string, unknown>();
  const storage = { get: (k: string) => mem.get(k), set: (k: string, v: unknown) => mem.set(k, v) };
  return new ApiKeyConnectionStore(storage as any);
}

describe('ApiKeyConnectionStore', () => {
  it('saves and retrieves a connection', () => {
    const store = makeStore();
    const conn: ApiKeyConnection = { id: 'abc', provider: 'aws', label: 'arn:aws:iam::123:user/nexus', status: 'active', createdAt: '2026-07-22T00:00:00Z' };
    store.save(conn);
    expect(store.get('abc')?.label).toBe('arn:aws:iam::123:user/nexus');
  });

  it('list returns all connections', () => {
    const store = makeStore();
    store.save({ id: 'a', provider: 'aws', label: 'arn1', status: 'active', createdAt: '' });
    store.save({ id: 'b', provider: 'gcs', label: 'proj', status: 'active', createdAt: '' });
    expect(store.list()).toHaveLength(2);
    expect(store.list('aws')).toHaveLength(1);
  });

  it('markRevoked updates status without deleting', () => {
    const store = makeStore();
    store.save({ id: 'x', provider: 'aws', label: 'arn', status: 'active', createdAt: '' });
    store.markRevoked('x');
    expect(store.get('x')?.status).toBe('revoked');
  });
});
