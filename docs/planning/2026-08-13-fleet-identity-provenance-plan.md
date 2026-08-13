# Fleet Identity & Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `graph.db` able to say, reliably and correctably, which local site is a sandbox of which WP Engine install — and expose the fleet as installs grouped by site, every row carrying where its data came from and how old it is.

**Architecture:** A new `site_links` table in `graph.db` replaces the implicit
`hostConnections[].remoteSiteId` → CAPI lookup that silently fails today. A
`SiteLinkStore` owns reads and writes. A `SiteLinkResolver` resolves links via
CAPI and records their origin, with a precedence rule that user-made links are
never overwritten by inference. A `FleetAssembler` composes installs, their
attached sandboxes, and provenance into the rows the fleet view renders. Three
MCP tools expose all of it. No UI in this plan.

**Tech Stack:** TypeScript (CommonJS, ES2020, strict), `better-sqlite3`, Jest +
ts-jest.

**Spec:** `docs/planning/2026-08-13-nexus-native-fleet-workspace-design.md`

## Global Constraints

- All new code is TypeScript under `src/main/`, 2-space indent, single quotes,
  matching surrounding files.
- Migrations follow the existing ad-hoc idempotent style in
  `GraphService.initialize()` — existence check, then `this.db.transaction(...)`.
  There is no migration version table; do not add one in this plan.
- Reuse the existing `DataProvenance` type from `src/common/types:611`. Do not
  define a second provenance shape. It is
  `{ level: 'live' | 'configured' | 'searchable' | 'scanned' | 'external-api'; source: string; ageSeconds: number | null; caveat: string | null }`.
  This plan uses only `live`, `configured` and `scanned`.
- Tests live under `tests/unit/`, run with `npx jest <path>`, and use real
  temporary SQLite files (see `tests/unit/events/GraphService.migrations.test.ts`
  for the established helper pattern) rather than mocking `better-sqlite3`.
- Every task ends green: `npx tsc --noEmit` passes and the task's tests pass.
- A **user** link is authoritative. Nothing derived from `hostConnections` or
  inference may overwrite `link_source = 'user'`.

**Refinement from the spec:** the spec sketched `PRIMARY KEY (local_site_id,
wpe_install_id)`. This plan uses `local_site_id` as the sole primary key — a
sandbox is pulled from exactly one install, so one row per local site is the
truer model. Two local sites may still point at the same install, which the
index on `wpe_install_id` supports.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/events/GraphService.ts` (modify) | Add the `site_links` migration alongside the existing `site_usage` migration |
| `src/main/fleet/SiteLinkStore.ts` (create) | CRUD over `site_links`. Knows SQL, knows nothing about CAPI |
| `src/main/fleet/SiteLinkResolver.ts` (create) | Resolves links via CAPI and enforces the precedence rule. Knows nothing about SQL |
| `src/main/fleet/FleetAssembler.ts` (create) | Composes installs + sandboxes + provenance into fleet rows |
| `src/main/fleet/types.ts` (create) | `SiteLink`, `SiteLinkSource`, `FleetInstall`, `FleetSandbox`, `FleetSiteGroup`, `ReconcileReport` |
| `src/main/mcp/modules/fleet-links/` (create) | Three MCP tool handlers plus a `registerFleetLinkTools` index |
| `src/main/index.ts` (modify) | Construct the three services; register the tool module |

Store, resolver and assembler are separated so each is testable without the
others: the store needs a database and no network, the resolver needs a fake
bridge and no database, the assembler needs both as injected collaborators.

---

## Task 1: `site_links` table and migration

**Files:**
- Modify: `src/main/events/GraphService.ts` (migration block, after the
  `site_usage` migration)
- Test: `tests/unit/events/GraphService.siteLinks.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a `site_links` table with columns `local_site_id TEXT PRIMARY KEY`,
  `wpe_install_id TEXT NOT NULL`, `wpe_install_name TEXT NOT NULL`,
  `link_source TEXT NOT NULL`, `verified_at INTEGER`, and index
  `idx_site_links_install` on `wpe_install_id`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/events/GraphService.siteLinks.test.ts`:

```typescript
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { GraphService } from '../../../src/main/events/GraphService';

function tmpDbPath(): string {
  return path.join(__dirname, `links-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('GraphService site_links migration', () => {
  const openDbs: string[] = [];

  async function freshService(dbPath: string): Promise<GraphService> {
    openDbs.push(dbPath);
    const svc = new GraphService(dbPath, { info: jest.fn(), error: jest.fn() });
    await svc.initialize();
    return svc;
  }

  afterEach(() => {
    for (const p of openDbs) {
      for (const suffix of ['', '-shm', '-wal']) {
        try { fs.unlinkSync(p + suffix); } catch { /* ignore */ }
      }
    }
    openDbs.length = 0;
  });

  it('creates site_links with the expected columns on a fresh database', async () => {
    const dbPath = tmpDbPath();
    const svc = await freshService(dbPath);
    const db = svc.getDb() as Database.Database;

    const cols = (db.pragma('table_info(site_links)') as Array<{ name: string }>)
      .map((c) => c.name)
      .sort();

    expect(cols).toEqual([
      'link_source',
      'local_site_id',
      'verified_at',
      'wpe_install_id',
      'wpe_install_name',
    ]);
    await svc.close();
  });

  it('creates the install index', async () => {
    const dbPath = tmpDbPath();
    const svc = await freshService(dbPath);
    const db = svc.getDb() as Database.Database;

    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_site_links_install'")
      .get() as { name: string } | undefined;

    expect(idx?.name).toBe('idx_site_links_install');
    await svc.close();
  });

  it('is idempotent — re-initializing an existing database does not throw', async () => {
    const dbPath = tmpDbPath();
    const first = await freshService(dbPath);
    await first.close();

    const second = new GraphService(dbPath, { info: jest.fn(), error: jest.fn() });
    await expect(second.initialize()).resolves.not.toThrow();
    await second.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/events/GraphService.siteLinks.test.ts`
Expected: FAIL — `table_info(site_links)` returns an empty array, so `cols` is `[]`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/events/GraphService.ts`, immediately after the block that creates
`site_usage`, add:

```typescript
    // Migration: create site_links table if missing.
    // Replaces the implicit hostConnections UUID -> CAPI lookup, which silently
    // resolves to nothing when an install is renamed, restored, or cloned.
    const hasSiteLinks = this.db
      .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='site_links'")
      .get() as { c: number };
    if (!hasSiteLinks.c) {
      this.logger.info('[GraphService] Creating site_links table...');
      this.db.transaction(() => {
        this.db!.exec(`
          CREATE TABLE site_links (
            local_site_id    TEXT PRIMARY KEY,
            wpe_install_id   TEXT NOT NULL,
            wpe_install_name TEXT NOT NULL,
            link_source      TEXT NOT NULL,
            verified_at      INTEGER
          );
        `);
        this.db!.exec(
          'CREATE INDEX IF NOT EXISTS idx_site_links_install ON site_links(wpe_install_id)',
        );
      })();
      this.logger.info('[GraphService] ✓ site_links table created');
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/events/GraphService.siteLinks.test.ts && npx tsc --noEmit`
Expected: 3 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/events/GraphService.ts tests/unit/events/GraphService.siteLinks.test.ts
git commit -m "feat(fleet): add site_links table for local-site to WPE-install identity"
```

---

## Task 2: `SiteLinkStore`

**Files:**
- Create: `src/main/fleet/types.ts`
- Create: `src/main/fleet/SiteLinkStore.ts`
- Test: `tests/unit/fleet/SiteLinkStore.test.ts`

**Interfaces:**
- Consumes: the `site_links` table from Task 1; `Database.Database` from
  `graphService.getDb()`
- Produces:
  - `type SiteLinkSource = 'hostConnection' | 'user' | 'inferred'`
  - `interface SiteLink { localSiteId: string; wpeInstallId: string; wpeInstallName: string; linkSource: SiteLinkSource; verifiedAt: number | null }`
  - `class SiteLinkStore` with `get(localSiteId): SiteLink | null`,
    `getByInstall(wpeInstallId): SiteLink[]`, `list(): SiteLink[]`,
    `put(link: SiteLink): void`, `remove(localSiteId): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fleet/SiteLinkStore.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { SiteLinkStore } from '../../../src/main/fleet/SiteLinkStore';
import type { SiteLink } from '../../../src/main/fleet/types';

function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE site_links (
      local_site_id    TEXT PRIMARY KEY,
      wpe_install_id   TEXT NOT NULL,
      wpe_install_name TEXT NOT NULL,
      link_source      TEXT NOT NULL,
      verified_at      INTEGER
    );
    CREATE INDEX idx_site_links_install ON site_links(wpe_install_id);
  `);
  return db;
}

const link: SiteLink = {
  localSiteId: 'local-1',
  wpeInstallId: 'inst-abc',
  wpeInstallName: 'goodaesthetic',
  linkSource: 'hostConnection',
  verifiedAt: 1_700_000_000_000,
};

describe('SiteLinkStore', () => {
  let db: Database.Database;
  let store: SiteLinkStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SiteLinkStore(db);
  });

  afterEach(() => db.close());

  it('returns null for an unknown local site', () => {
    expect(store.get('nope')).toBeNull();
  });

  it('round-trips a link', () => {
    store.put(link);
    expect(store.get('local-1')).toEqual(link);
  });

  it('put replaces an existing row for the same local site', () => {
    store.put(link);
    store.put({ ...link, wpeInstallId: 'inst-xyz', wpeInstallName: 'other', linkSource: 'user' });

    expect(store.list()).toHaveLength(1);
    expect(store.get('local-1')?.wpeInstallId).toBe('inst-xyz');
    expect(store.get('local-1')?.linkSource).toBe('user');
  });

  it('getByInstall returns every local site pointing at one install', () => {
    store.put(link);
    store.put({ ...link, localSiteId: 'local-2' });

    const found = store.getByInstall('inst-abc').map((l) => l.localSiteId).sort();
    expect(found).toEqual(['local-1', 'local-2']);
  });

  it('getByInstall returns an empty array for an unlinked install', () => {
    expect(store.getByInstall('inst-none')).toEqual([]);
  });

  it('remove deletes the row', () => {
    store.put(link);
    store.remove('local-1');
    expect(store.get('local-1')).toBeNull();
    expect(store.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/SiteLinkStore.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/SiteLinkStore'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/fleet/types.ts`:

```typescript
/**
 * How a local-site-to-WPE-install link came to exist.
 *
 * 'user' is authoritative: inference must never overwrite it. Install renames,
 * backup restores and site clones all make automatic resolution wrong, and a
 * silently wrong join is worse than a missing one.
 */
export type SiteLinkSource = 'hostConnection' | 'user' | 'inferred';

export interface SiteLink {
  localSiteId: string;
  wpeInstallId: string;
  wpeInstallName: string;
  linkSource: SiteLinkSource;
  /** Epoch ms when this link was last confirmed against CAPI, or null if never. */
  verifiedAt: number | null;
}
```

Create `src/main/fleet/SiteLinkStore.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { SiteLink, SiteLinkSource } from './types';

interface Row {
  local_site_id: string;
  wpe_install_id: string;
  wpe_install_name: string;
  link_source: string;
  verified_at: number | null;
}

function toLink(row: Row): SiteLink {
  return {
    localSiteId: row.local_site_id,
    wpeInstallId: row.wpe_install_id,
    wpeInstallName: row.wpe_install_name,
    linkSource: row.link_source as SiteLinkSource,
    verifiedAt: row.verified_at,
  };
}

/** CRUD over the site_links table. Knows SQL; knows nothing about CAPI. */
export class SiteLinkStore {
  constructor(private readonly db: Database.Database) {}

  get(localSiteId: string): SiteLink | null {
    const row = this.db
      .prepare('SELECT * FROM site_links WHERE local_site_id = ?')
      .get(localSiteId) as Row | undefined;
    return row ? toLink(row) : null;
  }

  getByInstall(wpeInstallId: string): SiteLink[] {
    const rows = this.db
      .prepare('SELECT * FROM site_links WHERE wpe_install_id = ?')
      .all(wpeInstallId) as Row[];
    return rows.map(toLink);
  }

  list(): SiteLink[] {
    const rows = this.db.prepare('SELECT * FROM site_links').all() as Row[];
    return rows.map(toLink);
  }

  put(link: SiteLink): void {
    this.db
      .prepare(
        `INSERT INTO site_links
           (local_site_id, wpe_install_id, wpe_install_name, link_source, verified_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(local_site_id) DO UPDATE SET
           wpe_install_id   = excluded.wpe_install_id,
           wpe_install_name = excluded.wpe_install_name,
           link_source      = excluded.link_source,
           verified_at      = excluded.verified_at`,
      )
      .run(
        link.localSiteId,
        link.wpeInstallId,
        link.wpeInstallName,
        link.linkSource,
        link.verifiedAt,
      );
  }

  remove(localSiteId: string): void {
    this.db.prepare('DELETE FROM site_links WHERE local_site_id = ?').run(localSiteId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/fleet/SiteLinkStore.test.ts && npx tsc --noEmit`
Expected: 6 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/fleet/types.ts src/main/fleet/SiteLinkStore.ts tests/unit/fleet/SiteLinkStore.test.ts
git commit -m "feat(fleet): add SiteLinkStore CRUD over site_links"
```

---

## Task 3: `SiteLinkResolver` — resolve one site, respect precedence

**Files:**
- Create: `src/main/fleet/SiteLinkResolver.ts`
- Test: `tests/unit/fleet/SiteLinkResolver.test.ts`

**Interfaces:**
- Consumes: `SiteLinkStore` from Task 2;
  `LocalServicesBridge.resolveWpeInstall(siteId): Promise<WpeInstallInfo | null>`
  from `src/main/mcp/local-services-bridge.ts`, where `WpeInstallInfo` is
  `{ installName: string; installId: string; remoteSiteId: string; primaryDomain: string; environment?: string }`
- Produces: `class SiteLinkResolver` with
  `resolveOne(localSiteId: string): Promise<SiteLink | null>` and
  `setManualLink(localSiteId, wpeInstallId, wpeInstallName): SiteLink`,
  `clearLink(localSiteId): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fleet/SiteLinkResolver.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { SiteLinkStore } from '../../../src/main/fleet/SiteLinkStore';
import { SiteLinkResolver } from '../../../src/main/fleet/SiteLinkResolver';

function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE site_links (
      local_site_id    TEXT PRIMARY KEY,
      wpe_install_id   TEXT NOT NULL,
      wpe_install_name TEXT NOT NULL,
      link_source      TEXT NOT NULL,
      verified_at      INTEGER
    );
  `);
  return db;
}

function fakeBridge(install: unknown) {
  return { resolveWpeInstall: jest.fn().mockResolvedValue(install) } as any;
}

const INSTALL = {
  installName: 'goodaesthetic',
  installId: 'inst-abc',
  remoteSiteId: 'site-uuid',
  primaryDomain: 'good-aesthetic.com',
  environment: 'production',
};

describe('SiteLinkResolver', () => {
  let db: Database.Database;
  let store: SiteLinkStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SiteLinkStore(db);
  });

  afterEach(() => db.close());

  it('writes a hostConnection link when CAPI resolves the site', async () => {
    const resolver = new SiteLinkResolver(store, fakeBridge(INSTALL));
    const link = await resolver.resolveOne('local-1');

    expect(link).toMatchObject({
      localSiteId: 'local-1',
      wpeInstallId: 'inst-abc',
      wpeInstallName: 'goodaesthetic',
      linkSource: 'hostConnection',
    });
    expect(typeof link!.verifiedAt).toBe('number');
    expect(store.get('local-1')).toEqual(link);
  });

  it('returns null and writes nothing when CAPI cannot resolve the site', async () => {
    const resolver = new SiteLinkResolver(store, fakeBridge(null));
    expect(await resolver.resolveOne('local-1')).toBeNull();
    expect(store.get('local-1')).toBeNull();
  });

  it('never overwrites a user link with a resolved one', async () => {
    store.put({
      localSiteId: 'local-1',
      wpeInstallId: 'inst-chosen-by-human',
      wpeInstallName: 'humanchoice',
      linkSource: 'user',
      verifiedAt: 1,
    });

    const bridge = fakeBridge(INSTALL);
    const resolver = new SiteLinkResolver(store, bridge);
    const link = await resolver.resolveOne('local-1');

    expect(link!.wpeInstallId).toBe('inst-chosen-by-human');
    expect(link!.linkSource).toBe('user');
    expect(bridge.resolveWpeInstall).not.toHaveBeenCalled();
  });

  it('setManualLink writes a user link that survives a later resolve', async () => {
    const resolver = new SiteLinkResolver(store, fakeBridge(INSTALL));
    resolver.setManualLink('local-1', 'inst-manual', 'manualname');

    expect(store.get('local-1')?.linkSource).toBe('user');
    await resolver.resolveOne('local-1');
    expect(store.get('local-1')?.wpeInstallId).toBe('inst-manual');
  });

  it('clearLink removes the link so resolution can run again', async () => {
    const resolver = new SiteLinkResolver(store, fakeBridge(INSTALL));
    resolver.setManualLink('local-1', 'inst-manual', 'manualname');
    resolver.clearLink('local-1');

    const link = await resolver.resolveOne('local-1');
    expect(link!.wpeInstallId).toBe('inst-abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/SiteLinkResolver.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/SiteLinkResolver'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/fleet/SiteLinkResolver.ts`:

```typescript
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { SiteLinkStore } from './SiteLinkStore';
import type { SiteLink } from './types';

/**
 * Resolves local sites to WP Engine installs and records where each link came
 * from. Knows CAPI (via the bridge); knows nothing about SQL.
 */
export class SiteLinkResolver {
  constructor(
    private readonly store: SiteLinkStore,
    private readonly bridge: Pick<LocalServicesBridge, 'resolveWpeInstall'>,
  ) {}

  /**
   * Resolve one local site's link. A pre-existing 'user' link short-circuits:
   * a human said what this is, and CAPI does not get to disagree.
   */
  async resolveOne(localSiteId: string): Promise<SiteLink | null> {
    const existing = this.store.get(localSiteId);
    if (existing?.linkSource === 'user') return existing;

    const install = await this.bridge.resolveWpeInstall(localSiteId);
    if (!install) return null;

    const link: SiteLink = {
      localSiteId,
      wpeInstallId: install.installId,
      wpeInstallName: install.installName,
      linkSource: 'hostConnection',
      verifiedAt: Date.now(),
    };
    this.store.put(link);
    return link;
  }

  setManualLink(localSiteId: string, wpeInstallId: string, wpeInstallName: string): SiteLink {
    const link: SiteLink = {
      localSiteId,
      wpeInstallId,
      wpeInstallName,
      linkSource: 'user',
      verifiedAt: Date.now(),
    };
    this.store.put(link);
    return link;
  }

  clearLink(localSiteId: string): void {
    this.store.remove(localSiteId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/fleet/SiteLinkResolver.test.ts && npx tsc --noEmit`
Expected: 5 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/fleet/SiteLinkResolver.ts tests/unit/fleet/SiteLinkResolver.test.ts
git commit -m "feat(fleet): resolve site links via CAPI, user links take precedence"
```

---

## Task 4: Startup reconciliation sweep

**Files:**
- Modify: `src/main/fleet/SiteLinkResolver.ts` (add `reconcileAll`)
- Modify: `src/main/fleet/types.ts` (add `ReconcileReport`)
- Test: `tests/unit/fleet/SiteLinkResolver.reconcile.test.ts`

**Interfaces:**
- Consumes: `SiteDataAccessor.getSites(): Record<string, LocalSiteInfo>` from
  `src/main/mcp/types.ts`, where `LocalSiteInfo` is
  `{ id: string; name: string; path: string; domain: string }`
- Produces: `interface ReconcileReport { linked: SiteLink[]; unresolved: Array<{ localSiteId: string; localSiteName: string }> }`
  and `SiteLinkResolver.reconcileAll(sites: Record<string, LocalSiteInfo>): Promise<ReconcileReport>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fleet/SiteLinkResolver.reconcile.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { SiteLinkStore } from '../../../src/main/fleet/SiteLinkStore';
import { SiteLinkResolver } from '../../../src/main/fleet/SiteLinkResolver';

function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE site_links (
      local_site_id    TEXT PRIMARY KEY,
      wpe_install_id   TEXT NOT NULL,
      wpe_install_name TEXT NOT NULL,
      link_source      TEXT NOT NULL,
      verified_at      INTEGER
    );
  `);
  return db;
}

const SITES = {
  'local-1': { id: 'local-1', name: 'good-aesthetic', path: '/a', domain: 'a.local' },
  'local-2': { id: 'local-2', name: 'orphan', path: '/b', domain: 'b.local' },
};

describe('SiteLinkResolver.reconcileAll', () => {
  let db: Database.Database;
  let store: SiteLinkStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SiteLinkStore(db);
  });

  afterEach(() => db.close());

  it('links what CAPI resolves and reports what it cannot', async () => {
    const bridge = {
      resolveWpeInstall: jest.fn(async (id: string) =>
        id === 'local-1'
          ? {
              installName: 'goodaesthetic',
              installId: 'inst-abc',
              remoteSiteId: 'site-uuid',
              primaryDomain: 'good-aesthetic.com',
              environment: 'production',
            }
          : null,
      ),
    } as any;

    const resolver = new SiteLinkResolver(store, bridge);
    const report = await resolver.reconcileAll(SITES);

    expect(report.linked.map((l) => l.localSiteId)).toEqual(['local-1']);
    expect(report.unresolved).toEqual([{ localSiteId: 'local-2', localSiteName: 'orphan' }]);
    expect(store.list()).toHaveLength(1);
  });

  it('one site failing to resolve does not abort the sweep', async () => {
    const bridge = {
      resolveWpeInstall: jest.fn(async (id: string) => {
        if (id === 'local-1') throw new Error('CAPI exploded');
        return {
          installName: 'orphanname',
          installId: 'inst-two',
          remoteSiteId: 'site-two',
          primaryDomain: 'b.com',
        };
      }),
    } as any;

    const resolver = new SiteLinkResolver(store, bridge);
    const report = await resolver.reconcileAll(SITES);

    expect(report.linked.map((l) => l.localSiteId)).toEqual(['local-2']);
    expect(report.unresolved).toEqual([
      { localSiteId: 'local-1', localSiteName: 'good-aesthetic' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/SiteLinkResolver.reconcile.test.ts`
Expected: FAIL — `resolver.reconcileAll is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/fleet/types.ts`:

```typescript
export interface UnresolvedSite {
  localSiteId: string;
  localSiteName: string;
}

export interface ReconcileReport {
  linked: SiteLink[];
  /** Sites we could not attach to an install — these need a human to link them. */
  unresolved: UnresolvedSite[];
}
```

Add to `SiteLinkResolver`, and extend its imports to
`import type { ReconcileReport, SiteLink } from './types';`:

```typescript
  /**
   * Resolve every known local site. Sites that fail — no host connection, a
   * renamed install, a CAPI error — are reported rather than dropped, so a
   * human can link them manually.
   */
  async reconcileAll(
    sites: Record<string, { id: string; name: string }>,
  ): Promise<ReconcileReport> {
    const report: ReconcileReport = { linked: [], unresolved: [] };

    for (const site of Object.values(sites)) {
      try {
        const link = await this.resolveOne(site.id);
        if (link) {
          report.linked.push(link);
        } else {
          report.unresolved.push({ localSiteId: site.id, localSiteName: site.name });
        }
      } catch {
        report.unresolved.push({ localSiteId: site.id, localSiteName: site.name });
      }
    }

    return report;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/fleet/ && npx tsc --noEmit`
Expected: all fleet tests passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/fleet/SiteLinkResolver.ts src/main/fleet/types.ts tests/unit/fleet/SiteLinkResolver.reconcile.test.ts
git commit -m "feat(fleet): reconcile all local site links, report the unresolved"
```

---

## Task 5: `FleetAssembler` — installs, sandboxes, provenance

**Files:**
- Create: `src/main/fleet/FleetAssembler.ts`
- Modify: `src/main/fleet/types.ts` (add fleet row types)
- Test: `tests/unit/fleet/FleetAssembler.test.ts`

**Interfaces:**
- Consumes: `SiteLinkStore.getByInstall` from Task 2; `GraphService.listSites({ source })`
  which returns rows carrying at least `{ id, name, remote_install_id, environment, wpe_site_id, domain, last_sync_at }`;
  `SiteDataAccessor.getSite(id): LocalSiteInfo | null` from `src/main/mcp/types.ts`,
  used to name an attached sandbox after the local site rather than the install;
  the existing `DataProvenance` type from `src/common/types`
- Produces:
  - `interface FleetSandbox { localSiteId: string; localSiteName: string; linkSource: SiteLinkSource }`
  - `interface FleetInstall { installId: string; installName: string; environment: string | null; domain: string | null; sandbox: FleetSandbox | null; provenance: DataProvenance }`
  - `interface FleetSiteGroup { wpeSiteId: string | null; name: string; installs: FleetInstall[] }`
  - `class FleetAssembler` constructed as
    `new FleetAssembler(graph, siteLinkStore, siteData)`, with
    `listFleet(): Promise<FleetSiteGroup[]>` and the exported helper
    `deriveProvenance(lastSyncAt: number | null, now: number): DataProvenance`

Provenance is derived from `last_sync_at`: synced within 5 minutes is `live`,
any older known sync is `configured`, and a null sync is `scanned` with a
caveat. This mirrors `SiteDataResolver`'s existing levels so the UI has one
vocabulary.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fleet/FleetAssembler.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { SiteLinkStore } from '../../../src/main/fleet/SiteLinkStore';
import { FleetAssembler } from '../../../src/main/fleet/FleetAssembler';

function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE site_links (
      local_site_id    TEXT PRIMARY KEY,
      wpe_install_id   TEXT NOT NULL,
      wpe_install_name TEXT NOT NULL,
      link_source      TEXT NOT NULL,
      verified_at      INTEGER
    );
  `);
  return db;
}

const NOW = 1_800_000_000_000;

function graphWith(rows: unknown[]) {
  return { listSites: jest.fn().mockResolvedValue(rows) } as any;
}

const SITE_DATA = {
  getSite: (id: string) =>
    id === 'local-1'
      ? { id: 'local-1', name: 'good-aesthetic sandbox', path: '/a', domain: 'a.local' }
      : null,
} as any;

describe('FleetAssembler', () => {
  let db: Database.Database;
  let store: SiteLinkStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SiteLinkStore(db);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.close();
  });

  it('groups installs under their WPE site', async () => {
    const graph = graphWith([
      { id: 'i1', name: 'ga-prod', remote_install_id: 'inst-1', environment: 'production', wpe_site_id: 'site-A', domain: 'a.com', last_sync_at: NOW - 60_000 },
      { id: 'i2', name: 'ga-stg', remote_install_id: 'inst-2', environment: 'staging', wpe_site_id: 'site-A', domain: 'stg.a.com', last_sync_at: NOW - 60_000 },
      { id: 'i3', name: 'other', remote_install_id: 'inst-3', environment: 'production', wpe_site_id: 'site-B', domain: 'b.com', last_sync_at: NOW - 60_000 },
    ]);

    const groups = await new FleetAssembler(graph, store, SITE_DATA).listFleet();

    expect(groups).toHaveLength(2);
    expect(groups[0].installs.map((i) => i.installName)).toEqual(['ga-prod', 'ga-stg']);
    expect(groups[1].installs.map((i) => i.installName)).toEqual(['other']);
  });

  it('attaches a linked sandbox to its install', async () => {
    store.put({
      localSiteId: 'local-1',
      wpeInstallId: 'inst-1',
      wpeInstallName: 'ga-prod',
      linkSource: 'user',
      verifiedAt: NOW,
    });
    const graph = graphWith([
      { id: 'i1', name: 'ga-prod', remote_install_id: 'inst-1', environment: 'production', wpe_site_id: 'site-A', domain: 'a.com', last_sync_at: NOW },
    ]);

    const [group] = await new FleetAssembler(graph, store, SITE_DATA).listFleet();

    expect(group.installs[0].sandbox).toEqual({
      localSiteId: 'local-1',
      localSiteName: 'good-aesthetic sandbox',
      linkSource: 'user',
    });
  });

  it('reports no sandbox when nothing is linked', async () => {
    const graph = graphWith([
      { id: 'i1', name: 'ga-prod', remote_install_id: 'inst-1', environment: 'production', wpe_site_id: 'site-A', domain: 'a.com', last_sync_at: NOW },
    ]);
    const [group] = await new FleetAssembler(graph, store, SITE_DATA).listFleet();
    expect(group.installs[0].sandbox).toBeNull();
  });

  it('derives provenance from last_sync_at', async () => {
    const graph = graphWith([
      { id: 'i1', name: 'fresh', remote_install_id: 'inst-1', environment: 'production', wpe_site_id: 'site-A', domain: 'a.com', last_sync_at: NOW - 60_000 },
      { id: 'i2', name: 'stale', remote_install_id: 'inst-2', environment: 'production', wpe_site_id: 'site-B', domain: 'b.com', last_sync_at: NOW - 4 * 86_400_000 },
      { id: 'i3', name: 'never', remote_install_id: 'inst-3', environment: 'production', wpe_site_id: 'site-C', domain: 'c.com', last_sync_at: null },
    ]);

    const groups = await new FleetAssembler(graph, store, SITE_DATA).listFleet();
    const byName = Object.fromEntries(
      groups.flatMap((g) => g.installs).map((i) => [i.installName, i.provenance]),
    );

    expect(byName.fresh.level).toBe('live');
    expect(byName.fresh.ageSeconds).toBe(60);
    expect(byName.stale.level).toBe('configured');
    expect(byName.never.level).toBe('scanned');
    expect(byName.never.ageSeconds).toBeNull();
    expect(byName.never.caveat).toBeTruthy();
  });

  it('asks the graph only for WPE-sourced sites', async () => {
    const graph = graphWith([]);
    await new FleetAssembler(graph, store, SITE_DATA).listFleet();
    expect(graph.listSites).toHaveBeenCalledWith({ source: 'wpe', active_only: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/FleetAssembler.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/FleetAssembler'`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/fleet/types.ts`:

```typescript
import type { DataProvenance } from '../../common/types';

export interface FleetSandbox {
  localSiteId: string;
  localSiteName: string;
  linkSource: SiteLinkSource;
}

export interface FleetInstall {
  installId: string;
  installName: string;
  environment: string | null;
  domain: string | null;
  /** The local working copy attached to this install, if any. */
  sandbox: FleetSandbox | null;
  provenance: DataProvenance;
}

export interface FleetSiteGroup {
  wpeSiteId: string | null;
  name: string;
  installs: FleetInstall[];
}
```

Create `src/main/fleet/FleetAssembler.ts`:

```typescript
import type { DataProvenance } from '../../common/types';
import type { SiteDataAccessor } from '../mcp/types';
import type { SiteLinkStore } from './SiteLinkStore';
import type { FleetInstall, FleetSiteGroup } from './types';

/** Anything synced within this window counts as observed rather than remembered. */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

interface GraphSiteRow {
  id: string;
  name: string;
  remote_install_id: string | null;
  environment: string | null;
  wpe_site_id: string | null;
  domain: string | null;
  last_sync_at: number | null;
}

interface GraphLike {
  listSites(options?: { active_only?: boolean; source?: string }): Promise<unknown[]>;
}

/**
 * Nothing stale is ever presented as current — every install carries the level
 * and age of the data behind it. See the design doc's provenance rule.
 */
export function deriveProvenance(lastSyncAt: number | null, now: number): DataProvenance {
  if (lastSyncAt === null) {
    return {
      level: 'scanned',
      source: 'none',
      ageSeconds: null,
      caveat: "We've never successfully reached this site.",
    };
  }

  const ageSeconds = Math.max(0, Math.round((now - lastSyncAt) / 1000));
  if (now - lastSyncAt <= LIVE_WINDOW_MS) {
    return { level: 'live', source: 'WPE sync', ageSeconds, caveat: null };
  }

  return {
    level: 'configured',
    source: 'last WPE sync',
    ageSeconds,
    caveat: 'Values are from the last sync, not observed just now.',
  };
}

/** Composes WPE installs, their attached sandboxes, and provenance into fleet rows. */
export class FleetAssembler {
  constructor(
    private readonly graph: GraphLike,
    private readonly links: SiteLinkStore,
    private readonly siteData: SiteDataAccessor,
  ) {}

  async listFleet(): Promise<FleetSiteGroup[]> {
    const rows = (await this.graph.listSites({ source: 'wpe', active_only: true })) as GraphSiteRow[];
    const now = Date.now();
    const groups = new Map<string, FleetSiteGroup>();

    for (const row of rows) {
      const installId = row.remote_install_id ?? row.id;
      const attached = this.links.getByInstall(installId)[0] ?? null;

      const install: FleetInstall = {
        installId,
        installName: row.name,
        environment: row.environment,
        domain: row.domain,
        sandbox: attached
          ? {
              localSiteId: attached.localSiteId,
              // Name the sandbox after the local site. SiteLink stores the
              // install name, which is a different thing and would mislabel it.
              localSiteName:
                this.siteData.getSite(attached.localSiteId)?.name ?? attached.localSiteId,
              linkSource: attached.linkSource,
            }
          : null,
        provenance: deriveProvenance(row.last_sync_at, now),
      };

      const key = row.wpe_site_id ?? installId;
      const existing = groups.get(key);
      if (existing) {
        existing.installs.push(install);
      } else {
        groups.set(key, {
          wpeSiteId: row.wpe_site_id,
          name: row.domain ?? row.name,
          installs: [install],
        });
      }
    }

    return Array.from(groups.values());
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/fleet/ && npx tsc --noEmit`
Expected: all fleet tests passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/fleet/FleetAssembler.ts src/main/fleet/types.ts tests/unit/fleet/FleetAssembler.test.ts
git commit -m "feat(fleet): assemble fleet rows with sandbox attachment and provenance"
```

---

## Task 6: MCP tool surface

**Files:**
- Create: `src/main/mcp/modules/fleet-links/list-fleet.ts`
- Create: `src/main/mcp/modules/fleet-links/link-site.ts`
- Create: `src/main/mcp/modules/fleet-links/unlink-site.ts`
- Create: `src/main/mcp/modules/fleet-links/index.ts`
- Modify: `src/main/mcp/safety.ts` (tier entries)
- Modify: `src/main/mcp/types.ts` (two optional fields on `NexusServices`)
- Test: `tests/unit/mcp/fleet-links.test.ts`

**Interfaces:**
- Consumes: `FleetAssembler.listFleet()` and `SiteLinkResolver.setManualLink` /
  `clearLink` from Tasks 3 and 5, reached through `NexusServices`
- Produces: three registered tools — `nexus_fleet_list` (Tier 1),
  `nexus_link_site` (Tier 2), `nexus_unlink_site` (Tier 2) — and
  `registerFleetLinkTools(registry: ToolRegistry): void`

These services reach handlers through `NexusServices`. Add two optional fields
to `src/main/mcp/types.ts`'s `NexusServices` interface:
`fleetAssembler?: import('../fleet/FleetAssembler').FleetAssembler;` and
`siteLinkResolver?: import('../fleet/SiteLinkResolver').SiteLinkResolver;`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp/fleet-links.test.ts`:

```typescript
import { listFleetHandler, linkSiteHandler, unlinkSiteHandler } from '../../../src/main/mcp/modules/fleet-links';

const GROUPS = [
  {
    wpeSiteId: 'site-A',
    name: 'good-aesthetic.com',
    installs: [
      {
        installId: 'inst-1',
        installName: 'ga-prod',
        environment: 'production',
        domain: 'good-aesthetic.com',
        sandbox: null,
        provenance: { level: 'live', source: 'WPE sync', ageSeconds: 60, caveat: null },
      },
    ],
  },
];

function services(overrides: Record<string, unknown> = {}) {
  return {
    fleetAssembler: { listFleet: jest.fn().mockResolvedValue(GROUPS) },
    siteLinkResolver: { setManualLink: jest.fn(), clearLink: jest.fn() },
    ...overrides,
  } as any;
}

describe('fleet-links tools', () => {
  it('nexus_fleet_list returns grouped installs as JSON', async () => {
    const result = await listFleetHandler.execute({}, services());
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual(GROUPS);
  });

  it('nexus_fleet_list errors cleanly when the assembler is absent', async () => {
    const result = await listFleetHandler.execute({}, services({ fleetAssembler: undefined }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not available/i);
  });

  it('nexus_link_site records a user link', async () => {
    const svc = services();
    const result = await linkSiteHandler.execute(
      { site: 'local-1', install_id: 'inst-1', install_name: 'ga-prod' },
      svc,
    );
    expect(svc.siteLinkResolver.setManualLink).toHaveBeenCalledWith('local-1', 'inst-1', 'ga-prod');
    expect(result.isError).toBeFalsy();
  });

  it('nexus_link_site rejects a missing install_id', async () => {
    const svc = services();
    const result = await linkSiteHandler.execute({ site: 'local-1' }, svc);
    expect(result.isError).toBe(true);
    expect(svc.siteLinkResolver.setManualLink).not.toHaveBeenCalled();
  });

  it('nexus_unlink_site clears the link', async () => {
    const svc = services();
    const result = await unlinkSiteHandler.execute({ site: 'local-1' }, svc);
    expect(svc.siteLinkResolver.clearLink).toHaveBeenCalledWith('local-1');
    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/mcp/fleet-links.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/mcp/modules/fleet-links'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/mcp/modules/fleet-links/list-fleet.ts`:

```typescript
import type { McpToolHandler } from '../../types';

export const listFleetHandler: McpToolHandler = {
  definition: {
    name: 'nexus_fleet_list',
    description:
      'List the whole fleet — WP Engine installs grouped by site, each with its environment, ' +
      'any attached local sandbox, and the provenance (level and age) of the data behind it. ' +
      'Use this before acting on a site so you know how current the information is.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  async execute(_args, services) {
    const assembler = (services as any).fleetAssembler;
    if (!assembler) {
      return {
        content: [{ type: 'text', text: 'Fleet assembler is not available — the graph database may still be initializing.' }],
        isError: true,
      };
    }
    const groups = await assembler.listFleet();
    return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
  },
};
```

Create `src/main/mcp/modules/fleet-links/link-site.ts`:

```typescript
import type { McpToolHandler } from '../../types';

export const linkSiteHandler: McpToolHandler = {
  definition: {
    name: 'nexus_link_site',
    description:
      'Link a local site to a WP Engine install as its sandbox. Use when automatic resolution ' +
      'failed — a renamed install, a restored backup, or a cloned site. A link made this way is ' +
      'authoritative and will never be overwritten by automatic resolution.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site ID' },
        install_id: { type: 'string', description: 'WP Engine install ID' },
        install_name: { type: 'string', description: 'WP Engine install name' },
      },
      required: ['site', 'install_id', 'install_name'],
    },
  },
  async execute(args, services) {
    const resolver = (services as any).siteLinkResolver;
    const site = args.site as string | undefined;
    const installId = args.install_id as string | undefined;
    const installName = args.install_name as string | undefined;

    if (!resolver) {
      return { content: [{ type: 'text', text: 'Site link resolver is not available.' }], isError: true };
    }
    if (!site || !installId || !installName) {
      return {
        content: [{ type: 'text', text: 'site, install_id and install_name are all required.' }],
        isError: true,
      };
    }

    resolver.setManualLink(site, installId, installName);
    return { content: [{ type: 'text', text: `Linked ${site} to install ${installName} (${installId}).` }] };
  },
};
```

Create `src/main/mcp/modules/fleet-links/unlink-site.ts`:

```typescript
import type { McpToolHandler } from '../../types';

export const unlinkSiteHandler: McpToolHandler = {
  definition: {
    name: 'nexus_unlink_site',
    description:
      'Remove the link between a local site and its WP Engine install. Automatic resolution ' +
      'will be free to run again for this site.',
    inputSchema: {
      type: 'object',
      properties: { site: { type: 'string', description: 'Local site ID' } },
      required: ['site'],
    },
  },
  async execute(args, services) {
    const resolver = (services as any).siteLinkResolver;
    const site = args.site as string | undefined;

    if (!resolver) {
      return { content: [{ type: 'text', text: 'Site link resolver is not available.' }], isError: true };
    }
    if (!site) {
      return { content: [{ type: 'text', text: 'site is required.' }], isError: true };
    }

    resolver.clearLink(site);
    return { content: [{ type: 'text', text: `Unlinked ${site}.` }] };
  },
};
```

Create `src/main/mcp/modules/fleet-links/index.ts`:

```typescript
import { ToolRegistry } from '../../tool-registry';
import { listFleetHandler } from './list-fleet';
import { linkSiteHandler } from './link-site';
import { unlinkSiteHandler } from './unlink-site';

export { listFleetHandler, linkSiteHandler, unlinkSiteHandler };

/** Fleet identity — list the fleet, and correct the local-site-to-install links. */
export function registerFleetLinkTools(registry: ToolRegistry): void {
  registry.register(listFleetHandler);
  registry.register(linkSiteHandler);
  registry.register(unlinkSiteHandler);
}
```

In `src/main/mcp/safety.ts`, add explicit tiers to `TIER_OVERRIDES` so these do
not fall through to the default of 2:

```typescript
  nexus_fleet_list: 1,
  nexus_link_site: 2,
  nexus_unlink_site: 2,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/mcp/fleet-links.test.ts && npx tsc --noEmit`
Expected: 5 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/modules/fleet-links src/main/mcp/safety.ts src/main/mcp/types.ts tests/unit/mcp/fleet-links.test.ts
git commit -m "feat(fleet): expose fleet list and manual site linking as MCP tools"
```

---

## Task 7: Wire into startup

**Files:**
- Modify: `src/main/index.ts`
- Test: `tests/unit/fleet/startup-wiring.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6
- Produces: `nexusServices.fleetAssembler` and `nexusServices.siteLinkResolver`
  populated, `registerFleetLinkTools(registry)` called, and a reconciliation
  sweep run once after the graph is ready

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fleet/startup-wiring.test.ts`:

```typescript
import { runStartupReconciliation } from '../../../src/main/fleet/startupReconciliation';

describe('runStartupReconciliation', () => {
  it('sweeps all sites and logs the unresolved count', async () => {
    const resolver = {
      reconcileAll: jest.fn().mockResolvedValue({
        linked: [{ localSiteId: 'local-1' }],
        unresolved: [{ localSiteId: 'local-2', localSiteName: 'orphan' }],
      }),
    } as any;
    const siteData = {
      getSites: () => ({
        'local-1': { id: 'local-1', name: 'a', path: '/a', domain: 'a.local' },
        'local-2': { id: 'local-2', name: 'orphan', path: '/b', domain: 'b.local' },
      }),
    } as any;
    const logger = { info: jest.fn(), error: jest.fn() };

    const report = await runStartupReconciliation(resolver, siteData, logger);

    expect(resolver.reconcileAll).toHaveBeenCalled();
    expect(report.unresolved).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('1 linked, 1 unresolved'));
  });

  it('never throws — a reconciliation failure must not break startup', async () => {
    const resolver = { reconcileAll: jest.fn().mockRejectedValue(new Error('boom')) } as any;
    const siteData = { getSites: () => ({}) } as any;
    const logger = { info: jest.fn(), error: jest.fn() };

    const report = await runStartupReconciliation(resolver, siteData, logger);

    expect(report).toEqual({ linked: [], unresolved: [] });
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fleet/startup-wiring.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/fleet/startupReconciliation'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/fleet/startupReconciliation.ts`:

```typescript
import type { SiteDataAccessor } from '../mcp/types';
import type { SiteLinkResolver } from './SiteLinkResolver';
import type { ReconcileReport } from './types';

interface LoggerLike {
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/**
 * Resolve every local site's install link once at startup. Deliberately never
 * throws: a CAPI outage or an unauthenticated user must degrade the fleet view,
 * not prevent the addon from booting.
 */
export async function runStartupReconciliation(
  resolver: SiteLinkResolver,
  siteData: SiteDataAccessor,
  logger: LoggerLike,
): Promise<ReconcileReport> {
  try {
    const report = await resolver.reconcileAll(siteData.getSites());
    logger.info(
      `[NexusAI] Site link reconciliation: ${report.linked.length} linked, ${report.unresolved.length} unresolved`,
    );
    return report;
  } catch (err) {
    logger.error('[NexusAI] Site link reconciliation failed', err);
    return { linked: [], unresolved: [] };
  }
}
```

In `src/main/index.ts`, after `graphService.initialize()` succeeds inside the
async init IIFE, construct the services and sweep:

```typescript
    const siteLinkStore = new SiteLinkStore(graphService.getDb()!);
    const siteLinkResolver = new SiteLinkResolver(siteLinkStore, localServices);
    const fleetAssembler = new FleetAssembler(graphService, siteLinkStore, siteDataAccessor);
    nexusServices.siteLinkResolver = siteLinkResolver;
    nexusServices.fleetAssembler = fleetAssembler;
    await runStartupReconciliation(siteLinkResolver, siteDataAccessor, localLogger);
```

Add the imports at the top of `src/main/index.ts`:

```typescript
import { SiteLinkStore } from './fleet/SiteLinkStore';
import { SiteLinkResolver } from './fleet/SiteLinkResolver';
import { FleetAssembler } from './fleet/FleetAssembler';
import { runStartupReconciliation } from './fleet/startupReconciliation';
```

And register the tool module alongside the other `register*Tools(registry)`
calls:

```typescript
  registerFleetLinkTools(registry);
```

with `import { registerFleetLinkTools } from './mcp/modules/fleet-links/index';`

- [ ] **Step 4: Run the full unit suite**

Run: `npx jest tests/unit && npx tsc --noEmit`
Expected: all passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/fleet/startupReconciliation.ts tests/unit/fleet/startup-wiring.test.ts
git commit -m "feat(fleet): wire link resolution and fleet assembly into startup"
```

---

## Out of scope for this plan

Deliberately excluded, each covered by a later plan in the spec's sequencing:

- **Any UI.** The shell is being replaced and the design is still directional.
  This plan's deliverable is verified through MCP tools and unit tests.
- **`nexusd` extraction** (Track 2).
- **Backup gate and the sandbox loop** (Track 3) — `site_links` is its
  precondition, which is why this plan comes first.
- **The two lenses and findings** (Track 4).
- **Local-only sites in the fleet list.** The spec keeps them so the app isn't
  empty for non-WPE users; that composition belongs with the fleet UI, and
  `FleetAssembler` is where it will be added.

## Self-review notes

- **Spec coverage:** this plan implements the spec's "Fleet and site identity"
  section — grain, `site_links` schema, migration from `hostConnections`,
  provenance, and user-correctable links. Capability derivation, the local-only
  site group, and the reconciliation UI are explicitly deferred above.
- **Type consistency:** `SiteLink`, `SiteLinkSource`, `ReconcileReport`,
  `FleetInstall`, `FleetSandbox` and `FleetSiteGroup` are all defined in
  `src/main/fleet/types.ts` in Tasks 2, 4 and 5 before any later task uses them.
  `deriveProvenance` returns the pre-existing `DataProvenance` shape rather than
  a new one.
- **Known deviation from the spec:** `site_links` uses `local_site_id` as the
  sole primary key rather than a composite key. Rationale is in Global
  Constraints.
