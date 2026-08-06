import { maybeUpsertExternalSite } from '../../../src/main/mcp/tool-registry';

/** Minimal in-memory stand-in for Local's RegistryStorage. */
function makeMemoryStorage() {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k) ?? null,
    set: (k: string, v: unknown) => { data.set(k, v); },
  };
}

/** Fake better-sqlite3 `db` whose `.prepare(...).all(...)` always returns `rows`. */
function makeFakeDb(rows: any[]) {
  return {
    prepare: () => ({ all: () => rows }),
  };
}

describe('maybeUpsertExternalSite — refresh only, never create', () => {
  it('updates last_sync_at on an existing site', async () => {
    const fakeDb = makeFakeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', domain: 'site-a.example.com', environment: 'production' },
    ]);
    const graphService = { upsertSite: jest.fn(async () => {}), getDb: () => fakeDb };
    const registryStorage = makeMemoryStorage();

    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:hostinger-test/site-a@production' },
      true,
      registryStorage,
      graphService,
    );

    expect(graphService.upsertSite).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ssh:hostinger-test/site-a', source: 'external', is_active: true }),
    );
  });

  it('does nothing for a bare shorthand against a connection with zero sites — nothing to sight', async () => {
    const fakeDb = makeFakeDb([]);
    const graphService = { upsertSite: jest.fn(async () => {}), getDb: () => fakeDb };
    const registryStorage = makeMemoryStorage();

    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:brand-new-alias@production' },
      true,
      registryStorage,
      graphService,
    );

    expect(graphService.upsertSite).not.toHaveBeenCalled();
  });

  it('never invents a site row for an alias that was never registered', async () => {
    const fakeDb = makeFakeDb([]);
    const graphService = { upsertSite: jest.fn(async () => {}), getDb: () => fakeDb };
    const registryStorage = makeMemoryStorage();

    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:unregistered/whatever@production' },
      true,
      registryStorage,
      graphService,
    );

    expect(graphService.upsertSite).not.toHaveBeenCalled();
  });

  it('does nothing when the command failed, regardless of what would have resolved', async () => {
    const fakeDb = makeFakeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', domain: 'site-a.example.com', environment: 'production' },
    ]);
    const graphService = { upsertSite: jest.fn(async () => {}), getDb: () => fakeDb };
    const registryStorage = makeMemoryStorage();

    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:hostinger-test/site-a@production' },
      false,
      registryStorage,
      graphService,
    );

    expect(graphService.upsertSite).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no ssh_target, registryStorage, or graphService', async () => {
    const graphService = { upsertSite: jest.fn(async () => {}) };
    const registryStorage = makeMemoryStorage();

    await maybeUpsertExternalSite({}, true, registryStorage, graphService);
    await maybeUpsertExternalSite({ ssh_target: 'ssh:hostinger-test/site-a@production' }, true, null, graphService);
    await maybeUpsertExternalSite({ ssh_target: 'ssh:hostinger-test/site-a@production' }, true, registryStorage, null);

    expect(graphService.upsertSite).not.toHaveBeenCalled();
  });

  it('falls back to the site name for domain when the row has none', async () => {
    const fakeDb = makeFakeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', domain: null, environment: 'production' },
    ]);
    const graphService = { upsertSite: jest.fn(async () => {}), getDb: () => fakeDb };
    const registryStorage = makeMemoryStorage();

    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:hostinger-test/site-a@production' },
      true,
      registryStorage,
      graphService,
    );

    expect(graphService.upsertSite).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'site-a' }),
    );
  });

  it('swallows a graphService failure without throwing', async () => {
    const fakeDb = makeFakeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', domain: 'site-a.example.com', environment: 'production' },
    ]);
    const graphService = {
      upsertSite: jest.fn(async () => { throw new Error('db is locked'); }),
      getDb: () => fakeDb,
    };
    const registryStorage = makeMemoryStorage();

    await expect(
      maybeUpsertExternalSite(
        { ssh_target: 'ssh:hostinger-test/site-a@production' },
        true,
        registryStorage,
        graphService,
      ),
    ).resolves.toBeUndefined();
  });
});
