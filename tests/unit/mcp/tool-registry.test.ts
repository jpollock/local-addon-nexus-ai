import { maybeUpsertExternalSite } from '../../../src/main/mcp/tool-registry';

/** Minimal in-memory stand-in for Local's RegistryStorage. */
function makeMemoryStorage() {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k) ?? null,
    set: (k: string, v: unknown) => { data.set(k, v); },
  };
}

/**
 * Fake better-sqlite3 `db`. Answers BOTH query shapes so this fixture exercises
 * the real create-vs-refresh decision against either implementation under
 * test, rather than crashing on whichever one it doesn't happen to implement:
 *   - `.prepare(...).all(...)`  — current code's `findExternalSites` lookup.
 *   - `.prepare(...).get(...)`  — the pre-Task-7 code's single-row domain
 *     lookup (`SELECT domain FROM sites WHERE id=?`).
 * `rows` models "what the graph already has registered for this alias/site".
 * An empty array must behave like a real empty result set for both shapes
 * (`.all()` -> `[]`, `.get()` -> `undefined`), not throw — a throw here was
 * previously masking the pre-Task-7 bug: its own try/catch swallowed the
 * `.get is not a function` TypeError and returned early, so the "never
 * invents a site" tests passed against the buggy code for the wrong reason.
 */
function makeFakeDb(rows: any[]) {
  return {
    prepare: () => ({
      all: () => rows,
      get: () => rows[0],
    }),
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

  // Ported from the now-deleted tests/unit/external/lazy-upsert.test.ts, which
  // asserted the pre-Task-5/7 one-alias-one-site model (`ssh:<alias>` ids, a
  // wpPath/environment pair on the connection profile) and was never updated
  // when that model changed. The two real behaviors it covered that have no
  // equivalent above — a malformed target must not throw, and a sighting must
  // never relabel an existing site's environment from the target's suffix —
  // are re-asserted here against the current refresh-only implementation.

  it('never throws on a malformed target — a sighting failure must not break a working command', async () => {
    const graphService = { upsertSite: jest.fn(async () => {}), getDb: () => makeFakeDb([]) };
    const registryStorage = makeMemoryStorage();

    await expect(
      maybeUpsertExternalSite(
        { ssh_target: 'not-a-valid-target' },
        true,
        registryStorage,
        graphService,
      ),
    ).resolves.toBeUndefined();
    expect(graphService.upsertSite).not.toHaveBeenCalled();
  });

  it('never relabels a registered site from the target suffix', async () => {
    // `nexus wp core version ssh:hostinger-test/site-a@development` is a
    // permitted read on every environment, so it succeeds — the row's own
    // stored `environment` (from registration) must win over the `@development`
    // suffix on the target string, or a read against a production site would
    // silently relabel it as development.
    const fakeDb = makeFakeDb([
      { id: 'ssh:hostinger-test/site-a', name: 'site-a', domain: 'site-a.example.com', environment: 'production' },
    ]);
    const graphService = { upsertSite: jest.fn(async () => {}), getDb: () => fakeDb };
    const registryStorage = makeMemoryStorage();

    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:hostinger-test/site-a@development' },
      true,
      registryStorage,
      graphService,
    );

    expect(graphService.upsertSite).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'production' }),
    );
  });
});
