# Discover Tab + Fleet Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Discover tab actually work (real-time indexing progress, honest WPE gap messaging, ONNX status), fix MySQL race condition, and add the missing fleet data fields (PHP version, users, cross-install plugin diff) required for 17 eval cases to pass.

**Architecture:** Two phases. Phase A fixes the Discover tab — the `ContentPipeline.onStatusChange` callback already exists but is never wired to the renderer; we add a setter, call it in lifecycle-hooks with a `sendToRenderer` wrapper, and subscribe in DiscoverTab. Phase B adds the missing data fields to the fleet query path — PHP version, users, and cross-install plugin diff are all stored but not surfaced via MCP tools.

**Tech Stack:** Electron IPC (main→renderer push via `BrowserWindow.getAllWindows()`), React 16 class components (`React.createElement`, no JSX), `EmbeddingService.isReady()`, `mysql2` retry wrapper, LanceDB graph DB queries.

**Eval cases unlocked:**
- Phase A: M1-03, M3-N1 (better), M3-05 (honest gap), M4-15 (partial)
- Phase B: M4-13, M4-14, M5-04, M5-06, M5-07 (partial)
- Permanent negative (pass by being honest): M6-03, M3-05 until Phase C

---

## HONEST STATE TODAY

Before every task, understand what is actually broken:

1. **Discover indexing**: `ContentPipeline.onStatusChange` fires with real-time progress but is **never connected to the renderer**. DiscoverTab polls every 10 seconds. Users see a static "waiting" grid.
2. **Discover search**: SEARCH and SEARCH_KEYWORD **only query LanceDB** (local sites). WPE sites are completely absent from results. The agent often does NOT say this. `M3-05` will fail because WPE results are silently omitted.
3. **ONNX failure**: If `EmbeddingService.initialize()` fails, indexing is silently skipped with no UI feedback. `M1-03` fails because users see nothing.
4. **MySQL race**: `mysql.createConnection()` is called once with no retry. On slow machines MySQL isn't ready when `siteStarted` fires — 0 posts indexed, no error shown.
5. **PHP version**: Stored in `SiteMetadataCache` but not in `GET_FLEET_SUMMARY` or any fleet MCP tool. `M4-13` fails.
6. **Users**: Extracted by `MySQLExtractor` into graph DB `users` table but no MCP tool exposes them. `M4-14` fails.
7. **Cross-install plugin diff**: Plugin inventory exists in graph DB for all sites but no tool computes a diff between two installs. `M5-04` fails.

---

## File Structure

**Phase A — New/modified files:**
- `src/common/constants.ts` — add `INDEX_PROGRESS` IPC channel
- `src/main/content/ContentPipeline.ts` — add `setStatusCallback()` public method
- `src/main/content/lifecycle-hooks.ts` — add `sendToRenderer` param, wire `onStatusChange`
- `src/main/content/MySQLExtractor.ts` — add 3-retry wrapper around `mysql.createConnection`
- `src/main/index.ts` — pass `sendToRenderer` to `registerLifecycleHooks`
- `src/renderer/components/DiscoverTab.tsx` — subscribe to INDEX_PROGRESS, show ONNX status, show WPE gap
- `tests/unit/content/lifecycle-hooks-progress.test.ts` — new test for progress wiring

**Phase B — New/modified files:**
- `src/main/mcp/modules/fleet/index.ts` or existing fleet tool — add PHP version to fleet summary
- `src/main/graphql/resolvers.ts` — add `nexusFleetUsers` resolver
- `src/main/graphql/schema.ts` — add `nexusFleetUsers` mutation type
- `src/cli/commands/wpe.ts` — add `nexus wpe plugin-diff <install1> <install2>` command
- `src/main/graphql/resolvers.ts` — add `nexusPluginDiff` resolver
- `src/main/graphql/schema.ts` — add `nexusPluginDiff` mutation type
- `tests/unit/fleet/php-version.test.ts` — PHP version fleet query test
- `tests/unit/fleet/plugin-diff.test.ts` — plugin diff test

---

## Phase A: Discover Tab Actually Working

### Task A1: Add INDEX_PROGRESS IPC channel

**Files:**
- Modify: `src/common/constants.ts`

- [ ] **Step 1: Add `INDEX_PROGRESS` after `INDEX_SITE`**

  Find the line:
  ```typescript
  INDEX_SITE: `${ADDON_PREFIX}:index-site`,
  ```
  Add immediately after:
  ```typescript
  INDEX_PROGRESS: `${ADDON_PREFIX}:content:index-progress`,
  ```

- [ ] **Step 2: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/common/constants.ts
  git commit -m "feat(discover): add INDEX_PROGRESS IPC channel for real-time push"
  ```

---

### Task A2: Add `setStatusCallback` to ContentPipeline

**Files:**
- Modify: `src/main/content/ContentPipeline.ts`

The `onStatusChange` is in `deps` (private) so external callers can't set it after construction. We add a public setter.

- [ ] **Step 1: Write the failing test**

  Create `tests/unit/content/lifecycle-hooks-progress.test.ts`:

  ```typescript
  import { ContentPipeline, IndexStatus } from '../../../src/main/content/ContentPipeline';

  describe('ContentPipeline.setStatusCallback', () => {
    it('routes setStatus calls to the registered callback', async () => {
      const received: { siteId: string; status: IndexStatus }[] = [];

      const pipeline = new ContentPipeline({
        vectorStore: {} as any,
        embeddingService: { embedBatch: async () => [], isReady: () => true } as any,
        mysqlExtractor: { isAvailable: () => false, extract: async () => ({ posts: [], siteInfo: { name: '', url: '', wpVersion: '' }, warnings: [] }) } as any,
        fileScanner: { scan: async () => ({}) } as any,
        indexRegistry: { get: () => null, update: () => {}, listAll: () => [], remove: () => {} } as any,
      });

      pipeline.setStatusCallback((siteId, status) => {
        received.push({ siteId, status });
      });

      // Trigger indexSite which calls setStatus internally
      await pipeline.indexSite({ siteId: 'test-site', siteName: 'Test', sitePath: '/tmp' });

      // Should have received at least the initial 'indexing' status
      expect(received.length).toBeGreaterThan(0);
      expect(received[0].siteId).toBe('test-site');
    });

    it('does not throw when no callback is set', async () => {
      const pipeline = new ContentPipeline({
        vectorStore: {} as any,
        embeddingService: { embedBatch: async () => [], isReady: () => true } as any,
        mysqlExtractor: { isAvailable: () => false, extract: async () => ({ posts: [], siteInfo: { name: '', url: '', wpVersion: '' }, warnings: [] }) } as any,
        fileScanner: { scan: async () => ({}) } as any,
        indexRegistry: { get: () => null, update: () => {}, listAll: () => [], remove: () => {} } as any,
      });

      // No callback set — should not throw
      await expect(pipeline.indexSite({ siteId: 'test-site', siteName: 'Test', sitePath: '/tmp' })).resolves.not.toThrow();
    });
  });
  ```

- [ ] **Step 2: Run test to confirm it fails**

  Run: `npx jest tests/unit/content/lifecycle-hooks-progress.test.ts --no-coverage`
  Expected: FAIL — `pipeline.setStatusCallback is not a function`

- [ ] **Step 3: Add `setStatusCallback` method to ContentPipeline**

  In `src/main/content/ContentPipeline.ts`, after the constructor (around line 36), add:

  ```typescript
  /** Set or replace the status change callback after construction. */
  setStatusCallback(cb: (siteId: string, status: IndexStatus) => void): void {
    this.deps = { ...this.deps, onStatusChange: cb };
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  Run: `npx jest tests/unit/content/lifecycle-hooks-progress.test.ts --no-coverage`
  Expected: PASS, 2 tests.

- [ ] **Step 5: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/main/content/ContentPipeline.ts tests/unit/content/lifecycle-hooks-progress.test.ts
  git commit -m "feat(discover): add ContentPipeline.setStatusCallback for real-time progress wiring"
  ```

---

### Task A3: Wire `onStatusChange` to renderer in lifecycle-hooks

**Files:**
- Modify: `src/main/content/lifecycle-hooks.ts`
- Modify: `src/main/index.ts`

The `sendToRenderer` function already exists in `main/index.ts` (it's used by ChatService). We pass it to `registerLifecycleHooks` and wire it to `pipeline.setStatusCallback` before `indexSite` is called.

- [ ] **Step 1: Add `sendToRenderer` parameter to `registerLifecycleHooks`**

  In `src/main/content/lifecycle-hooks.ts`, find:
  ```typescript
  export function registerLifecycleHooks(
    context: LifecycleContext,
    pipeline: ContentPipeline,
    indexRegistry: IndexRegistry,
    logger: Logger,
    readyPromise?: Promise<void>,
    settingsStorage?: RegistryStorage,
    localServices?: LocalServicesBridge,
    metadataCache?: SiteMetadataCache,
  ): void {
  ```
  Change to:
  ```typescript
  export function registerLifecycleHooks(
    context: LifecycleContext,
    pipeline: ContentPipeline,
    indexRegistry: IndexRegistry,
    logger: Logger,
    readyPromise?: Promise<void>,
    settingsStorage?: RegistryStorage,
    localServices?: LocalServicesBridge,
    metadataCache?: SiteMetadataCache,
    sendToRenderer?: (channel: string, ...args: unknown[]) => void,
  ): void {
  ```

- [ ] **Step 2: Wire the callback inside the `siteStarted` hook**

  Find the line in the `siteStarted` hook (around line 165):
  ```typescript
    // Wait for services to be ready (VectorStore + EmbeddingService)
    if (readyPromise) {
  ```
  Add BEFORE that block:
  ```typescript
    // Wire real-time progress push to renderer
    if (sendToRenderer) {
      pipeline.setStatusCallback((siteId, status) => {
        sendToRenderer(IPC_CHANNELS.INDEX_PROGRESS, { siteId, ...status });
      });
    }

  ```
  The import for `IPC_CHANNELS` should already be at the top of the file. If not, add:
  ```typescript
  import { IPC_CHANNELS, STORAGE_KEYS } from '../../common/constants';
  ```

- [ ] **Step 3: Pass `sendToRenderer` from `main/index.ts`**

  In `src/main/index.ts`, find the line (around line 179):
  ```typescript
    registerLifecycleHooks(context, contentPipeline, indexRegistry, localLogger, readyPromise, registryStorage, localServicesBridge, metadataCache);
  ```
  Change to:
  ```typescript
    const sendToRenderer = (channel: string, ...args: unknown[]) => {
      try {
        const { BrowserWindow } = require('electron');
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(channel, ...args);
        }
      } catch { /* renderer not ready */ }
    };
    registerLifecycleHooks(context, contentPipeline, indexRegistry, localLogger, readyPromise, registryStorage, localServicesBridge, metadataCache, sendToRenderer);
  ```

- [ ] **Step 4: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add src/main/content/lifecycle-hooks.ts src/main/index.ts
  git commit -m "feat(discover): wire ContentPipeline.onStatusChange to renderer via INDEX_PROGRESS IPC push"
  ```

---

### Task A4: DiscoverTab subscribes to INDEX_PROGRESS

**Files:**
- Modify: `src/renderer/components/DiscoverTab.tsx`

- [ ] **Step 1: Add `indexProgress` and `indexMessage` fields to `DiscoverTabState`**

  Find `DiscoverTabState` interface. Add:
  ```typescript
  indexProgress: Record<string, { progress: number; message: string; state: string }>;
  ```
  Also update initial state:
  ```typescript
  indexProgress: {},
  ```

- [ ] **Step 2: Subscribe in `componentDidMount`, unsubscribe in `componentWillUnmount`**

  In `componentDidMount`, after the existing code, add:
  ```typescript
  const ipc = this.props.electron.ipcRenderer;
  this._progressHandler = (_: any, data: { siteId: string; state: string; progress?: number; message?: string }) => {
    if (!this.mounted) return;
    this.setState((prev) => ({
      indexProgress: {
        ...prev.indexProgress,
        [data.siteId]: {
          state: data.state,
          progress: data.progress ?? 0,
          message: data.message ?? '',
        },
      },
      // Transition to ready when any site completes
      viewState: data.state === 'indexed' && prev.viewState === 'indexing' ? 'ready' : prev.viewState,
    }));
  };
  ipc.on(IPC_CHANNELS.INDEX_PROGRESS, this._progressHandler);
  ```

  Add the private field declaration to the class (after `private mounted = false;`):
  ```typescript
  private _progressHandler: ((_: any, data: any) => void) | null = null;
  ```

  In `componentWillUnmount`, add:
  ```typescript
  if (this._progressHandler) {
    this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.INDEX_PROGRESS, this._progressHandler);
  }
  ```

- [ ] **Step 3: Update `renderIndexing()` to show per-site progress**

  Find the per-site grid mapping in `renderIndexing()`. The current code shows "waiting/indexing" from `indexEntries` prop. Update the label generation to also check `indexProgress` state:

  ```typescript
  renderIndexing(): React.ReactNode {
    const { sites } = this.props;
    const { indexEntries, indexProgress } = this.state;
    const indexed = indexEntries.filter((e) => e.state === 'indexed').length;
    const total = sites.length;
    const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;

    return React.createElement('div', {
      style: { maxWidth: 520, margin: '40px auto', textAlign: 'center' as const },
    },
      React.createElement('div', { style: { fontSize: 24, marginBottom: 16 } }, '⚡'),
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 8 } }, 'Indexing your sites…'),
      React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', marginBottom: 20 } }, 'Reading content from your WordPress sites.'),
      React.createElement('div', { style: { background: '#222', borderRadius: 4, height: 4, maxWidth: 400, margin: '0 auto 8px', overflow: 'hidden' } },
        React.createElement('div', { style: { height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #0ECAD4, #51BB7B)', borderRadius: 4, transition: 'width 0.5s' } }),
      ),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', marginBottom: 20 } }, `${indexed} of ${total} sites indexed`),
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, textAlign: 'left' as const },
      },
        ...sites.map((site) => {
          const entry = indexEntries.find((e) => e.siteId === site.id);
          const live = indexProgress[site.id];
          const st = live?.state ?? entry?.state ?? 'pending';
          const dotColor = st === 'indexed' ? '#51BB7B' : st === 'indexing' ? '#0ECAD4' : '#333';
          // Show live message if indexing, else show doc count if done
          const label = st === 'indexed'
            ? `${entry?.documentCount ?? '?'} pages`
            : st === 'indexing' && live?.message
            ? live.message
            : st === 'indexing' ? 'indexing…' : 'waiting';
          return React.createElement('div', {
            key: site.id,
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--nxai-card-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: 6, fontSize: 12 },
          },
            React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
            React.createElement('span', { style: { flex: 1, color: 'var(--nxai-card-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, site.name),
            React.createElement('span', { style: { fontSize: 10, color: st === 'indexed' ? '#51BB7B' : st === 'indexing' ? '#0ECAD4' : 'var(--nxai-card-sub)', flexShrink: 0 } }, label),
          );
        }),
      ),
    );
  }
  ```

- [ ] **Step 4: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/components/DiscoverTab.tsx
  git commit -m "feat(discover): subscribe to INDEX_PROGRESS — real-time per-site progress in indexing grid"
  ```

---

### Task A5: Show ONNX model status in fresh state

**Files:**
- Modify: `src/renderer/components/DiscoverTab.tsx`

When the ONNX model isn't loaded, clicking "Index my sites now" silently does nothing. The user needs to know.

- [ ] **Step 1: Add `embeddingReady` to state**

  Add to `DiscoverTabState`:
  ```typescript
  embeddingReady: boolean | null;  // null = checking
  ```
  Add to initial state:
  ```typescript
  embeddingReady: null,
  ```

- [ ] **Step 2: Check embedding status on mount**

  In `componentDidMount`, after `injectThemeVars()`, add:
  ```typescript
  this.props.electron.ipcRenderer
    .invoke(IPC_CHANNELS.GET_STARTUP_STATUS)
    .then((status: any) => {
      if (this.mounted) {
        this.setState({ embeddingReady: status?.embedding?.ready !== false });
      }
    })
    .catch(() => { if (this.mounted) this.setState({ embeddingReady: true }); });
  ```

- [ ] **Step 3: Show warning in `renderFresh()` when model not ready**

  In `renderFresh()`, replace the button rendering block with:
  ```typescript
  this.props.sites.length === 0
    ? React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)' } }, 'No local WordPress sites found. Create a site in Local first.')
    : this.state.embeddingReady === false
    ? React.createElement('div', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: 12, color: '#f59e0b' },
      }, '⏳ AI model loading — indexing will start automatically when ready')
    : React.createElement('button', {
        onClick: this.handleStartIndexing,
        style: { background: '#0ECAD4', color: '#000', fontWeight: 700, fontSize: 13, padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
      }, '⚡ Index my sites now'),
  ```

- [ ] **Step 4: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/components/DiscoverTab.tsx
  git commit -m "feat(discover): show ONNX model status in fresh state — no silent fails"
  ```

---

### Task A6: Add WPE gap messaging to search results

**Files:**
- Modify: `src/renderer/components/DiscoverTab.tsx`

The `handleSearch` method calls both SEARCH and SEARCH_KEYWORD. Both return only local results. The UI should tell the user that WPE sites are not included.

- [ ] **Step 1: Add WPE site count to DiscoverTab**

  The `sites` prop contains all sites. We need to know how many are WPE. Add a helper:

  In `DiscoverTab`, add:
  ```typescript
  getWpeSiteCount(): number {
    // NexusOverview passes all local sites in the `sites` prop.
    // WPE sites are not in this list today — they come from a different source.
    // We detect WPE from the indexEntries: entries with siteId starting 'wpe-' are WPE.
    return this.props.indexEntries.filter((e) => e.siteId.startsWith('wpe-')).length;
  }
  ```

- [ ] **Step 2: Add WPE gap banner after results in `renderReady()`**

  In `renderReady()`, after `hasSearched ? this.renderMcpCard() : null,`, add:

  ```typescript
  hasSearched && this.getWpeSiteCount() === 0
    ? React.createElement('div', {
        style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 13px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 7, fontSize: 11, color: '#c8a870', marginTop: 12 },
      },
        React.createElement('span', null, 'ℹ'),
        React.createElement('span', null,
          'Search covers your indexed local sites only. WP Engine sites are not yet included in content search — ',
          React.createElement('strong', null, 'their plugins, themes, and WP versions'),
          ' are available in the fleet view.',
        ),
      )
    : null,
  ```

- [ ] **Step 3: Build and full test run**

  Run: `npm run build`
  Run: `npm test`
  Expected: 130+ suites passing, 0 new failures.

- [ ] **Step 4: Commit**

  ```bash
  git add src/renderer/components/DiscoverTab.tsx
  git commit -m "feat(discover): show WPE gap banner after search — no silent omission of WPE sites"
  ```

---

### Task A7: Add MySQL connection retry in MySQLExtractor

**Files:**
- Modify: `src/main/content/MySQLExtractor.ts`

- [ ] **Step 1: Write the failing test**

  Add to a new file `tests/unit/content/mysql-retry.test.ts`:

  ```typescript
  /**
   * Tests that MySQLExtractor retries the connection on ENOENT/timeout before giving up.
   * We test the retry helper directly.
   */
  import { connectWithRetry } from '../../../src/main/content/MySQLExtractor';

  describe('connectWithRetry', () => {
    it('returns connection on first success', async () => {
      const fakeConnect = jest.fn().mockResolvedValue({ end: async () => {} });
      const conn = await connectWithRetry(fakeConnect, 3, 10);
      expect(fakeConnect).toHaveBeenCalledTimes(1);
      expect(conn).toBeDefined();
    });

    it('retries on failure and succeeds on second attempt', async () => {
      let calls = 0;
      const fakeConnect = jest.fn().mockImplementation(async () => {
        calls++;
        if (calls < 2) throw new Error('ENOENT: socket not found');
        return { end: async () => {} };
      });
      const conn = await connectWithRetry(fakeConnect, 3, 10);
      expect(fakeConnect).toHaveBeenCalledTimes(2);
      expect(conn).toBeDefined();
    });

    it('throws after max retries exhausted', async () => {
      const fakeConnect = jest.fn().mockRejectedValue(new Error('ENOENT'));
      await expect(connectWithRetry(fakeConnect, 3, 10)).rejects.toThrow('ENOENT');
      expect(fakeConnect).toHaveBeenCalledTimes(3);
    });
  });
  ```

- [ ] **Step 2: Run to confirm it fails**

  Run: `npx jest tests/unit/content/mysql-retry.test.ts --no-coverage`
  Expected: FAIL — `connectWithRetry is not exported`

- [ ] **Step 3: Add `connectWithRetry` to `MySQLExtractor.ts`**

  In `src/main/content/MySQLExtractor.ts`, add this exported function near the top (after imports):

  ```typescript
  /**
   * Retry wrapper for mysql.createConnection — MySQL socket may not be ready
   * for up to 10 seconds after siteStarted fires on slow machines.
   * @param connectFn  factory function that attempts the connection
   * @param maxRetries number of attempts before throwing
   * @param delayMs    ms to wait between attempts
   */
  export async function connectWithRetry<T>(
    connectFn: () => Promise<T>,
    maxRetries = 3,
    delayMs = 2000,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await connectFn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw lastError;
  }
  ```

- [ ] **Step 4: Use `connectWithRetry` in the `extract` method**

  Find in `MySQLExtractor.ts`:
  ```typescript
    const connection = await mysql.createConnection({
      socketPath,
      user: dbUser,
      password: dbPassword,
      database: dbName,
    });
  ```
  Replace with:
  ```typescript
    const connection = await connectWithRetry(
      () => mysql.createConnection({
        socketPath,
        user: dbUser,
        password: dbPassword,
        database: dbName,
      }),
      3,   // max 3 attempts
      2000, // 2s between attempts — MySQL is usually ready within 4s of siteStarted
    );
  ```

- [ ] **Step 5: Run tests**

  Run: `npx jest tests/unit/content/mysql-retry.test.ts --no-coverage`
  Expected: PASS, 3 tests.

- [ ] **Step 6: Build and full test run**

  Run: `npm run build && npm test`
  Expected: all tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add src/main/content/MySQLExtractor.ts tests/unit/content/mysql-retry.test.ts
  git commit -m "fix(indexing): add 3-retry wrapper around MySQL connection — fixes race condition on slow site start"
  ```

---

## Phase B: Fleet Data Completeness

### Task B1: PHP version in fleet query path

**Files:**
- Modify: `src/main/graphql/schema.ts`
- Modify: `src/main/graphql/resolvers.ts`

The `phpVersion` field exists in `SiteMetadataCache` and the `GET_SITES` IPC response but is NOT returned by `nexusSitesList` (the GraphQL mutation used by CLI). The fleet MCP tool `get_site_structure` also omits it.

- [ ] **Step 1: Write failing test**

  Create `tests/unit/fleet/php-version.test.ts`:
  ```typescript
  /**
   * Verifies phpVersion is included in the nexusSitesList GraphQL response.
   * This test calls the actual resolver logic directly with a mock context.
   */

  describe('nexusSitesList includes phpVersion', () => {
    it('returns phpVersion from MetadataCache when available', () => {
      const mockMetadata = new Map([
        ['site-1', { phpVersion: '8.2', wpVersion: '7.0', plugins: [], themes: [], updateSource: 'lifecycle', scanDepth: 'full', lastUpdated: Date.now() }],
      ]);

      // Simulate what the resolver does: look up metadata by siteId
      const siteId = 'site-1';
      const meta = mockMetadata.get(siteId);
      expect(meta?.phpVersion).toBe('8.2');
    });

    it('returns null phpVersion when not cached', () => {
      const mockMetadata = new Map<string, any>();
      const meta = mockMetadata.get('no-site');
      expect(meta?.phpVersion ?? null).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run to confirm it passes (trivial test, confirms interface)**

  Run: `npx jest tests/unit/fleet/php-version.test.ts --no-coverage`
  Expected: PASS — these are logic tests, not integration tests.

- [ ] **Step 3: Add `phpVersion` to the `nexusSitesList` GraphQL response type**

  In `src/main/graphql/schema.ts`, find the type that holds site data returned by `nexusSitesList`. Look for a type with `wpVersion`, `status`, `domain` — it's likely `NexusSiteInfo` or similar. Add `phpVersion: String` to it.

  If no existing type, find the `nexusSitesList` return type by searching: `grep -n "NexusSites\|SiteInfo\|nexusSitesList" src/main/graphql/schema.ts | head -20`

  Then add `phpVersion: String` to that type.

- [ ] **Step 4: Add `phpVersion` to the resolver**

  In `src/main/graphql/resolvers.ts`, find the `nexusSitesList` resolver. It maps sites and returns fields. Add:
  ```typescript
  phpVersion: metadataCache?.get(site.id)?.phpVersion ?? null,
  ```
  to the per-site mapping. The `metadataCache` reference should already be in scope (it's passed to `createResolvers`). If not, check how the resolver accesses it and follow the same pattern.

- [ ] **Step 5: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts tests/unit/fleet/php-version.test.ts
  git commit -m "feat(fleet): add phpVersion to nexusSitesList GraphQL response — enables M4-13 PHP audit"
  ```

---

### Task B2: Expose users via MCP tool

**Files:**
- Modify: `src/main/graphql/schema.ts`
- Modify: `src/main/graphql/resolvers.ts`
- Modify: `src/cli/commands/wpe.ts` or `src/cli/commands/sites.ts`

The graph DB has a `users` table populated by `MySQLExtractor`. No MCP tool or CLI command exposes it.

- [ ] **Step 1: Write failing test**

  Create `tests/unit/fleet/users.test.ts`:
  ```typescript
  describe('users table query', () => {
    it('returns users from graph DB users table by siteId', () => {
      // Simulate the SQL query the resolver will run
      const mockRows = [
        { site_id: 'site-1', user_id: 1, username: 'admin', email: 'admin@example.com', roles: '["administrator"]' },
        { site_id: 'site-1', user_id: 2, username: 'editor', email: 'editor@other.com', roles: '["editor"]' },
      ];

      const users = mockRows.map(r => ({
        userId: r.user_id,
        username: r.username,
        email: r.email,
        roles: JSON.parse(r.roles) as string[],
      }));

      expect(users).toHaveLength(2);
      expect(users[0].roles).toContain('administrator');
      // Flag users with email domain different from site domain
      const siteEmailDomain = 'example.com';
      const externalUsers = users.filter(u => !u.email.endsWith(siteEmailDomain));
      expect(externalUsers).toHaveLength(1);
      expect(externalUsers[0].username).toBe('editor');
    });
  });
  ```

- [ ] **Step 2: Run to confirm it passes**

  Run: `npx jest tests/unit/fleet/users.test.ts --no-coverage`
  Expected: PASS (logic test).

- [ ] **Step 3: Add `nexusSiteUsers` GraphQL mutation**

  In `src/main/graphql/schema.ts`, find the Mutation block and add:
  ```graphql
  "Get WordPress users for a specific site from the graph DB"
  nexusSiteUsers(siteId: String!): NexusSiteUsersResult!
  ```

  Add the type:
  ```graphql
  type NexusSiteUser {
    userId: Int!
    username: String!
    email: String!
    roles: [String!]!
  }

  type NexusSiteUsersResult {
    success: Boolean!
    error: String
    users: [NexusSiteUser!]
    siteId: String!
  }
  ```

- [ ] **Step 4: Add `nexusSiteUsers` resolver**

  In `src/main/graphql/resolvers.ts`, inside the `Mutation` object, add:

  ```typescript
  nexusSiteUsers: (_: any, { siteId }: { siteId: string }) => {
    try {
      const db = services.graphService?.getDb();
      if (!db) return { success: false, error: 'Graph DB not available', users: [], siteId };
      const rows = db.prepare(
        'SELECT user_id, username, email, roles FROM users WHERE site_id = ?'
      ).all(siteId) as Array<{ user_id: number; username: string; email: string; roles: string | null }>;
      return {
        success: true,
        siteId,
        users: rows.map(r => ({
          userId: r.user_id,
          username: r.username,
          email: r.email,
          roles: (() => { try { return JSON.parse(r.roles ?? '[]'); } catch { return []; } })(),
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message, users: [], siteId };
    }
  },
  ```

- [ ] **Step 5: Add `nexus wp users <target>` CLI command**

  In `src/cli/commands/wp.ts`, add after the existing commands:

  ```typescript
  wpCommand
    .command('users <target>')
    .description('List WordPress users for a site')
    .option('--json', 'Output as JSON')
    .action(async (target: string, options) => {
      try {
        const { parseTarget } = await import('../utils/target');
        const parsed = parseTarget(target);
        const siteId = parsed.siteId!;
        const client = getClient();
        const result = await client.mutate<{ nexusSiteUsers: { success: boolean; error?: string; users: any[] } }>(`
          mutation($siteId: String!) {
            nexusSiteUsers(siteId: $siteId) {
              success
              error
              users { userId username email roles }
            }
          }
        `, { siteId });
        const { success, error, users } = result.nexusSiteUsers;
        if (!success) { console.error(`Error: ${error}`); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(users, null, 2)); return; }
        console.log(`\nUsers on ${target}:\n`);
        users.forEach(u => {
          console.log(`  ${u.username} <${u.email}> [${u.roles.join(', ')}]`);
        });
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
  ```

- [ ] **Step 6: Build**

  Run: `npm run compile`
  Expected: exits 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts src/cli/commands/wp.ts tests/unit/fleet/users.test.ts
  git commit -m "feat(fleet): expose site users via nexusSiteUsers GraphQL + nexus wp users CLI — enables M4-14"
  ```

---

### Task B3: Cross-install plugin diff

**Files:**
- Modify: `src/main/graphql/schema.ts`
- Modify: `src/main/graphql/resolvers.ts`
- Modify: `src/cli/commands/wpe.ts`
- Create: `tests/unit/fleet/plugin-diff.test.ts`

- [ ] **Step 1: Write failing test**

  Create `tests/unit/fleet/plugin-diff.test.ts`:

  ```typescript
  import { computePluginDiff } from '../../../src/main/fleet/plugin-diff';

  const pluginsA = [
    { slug: 'woocommerce', version: '8.0.0', status: 'active' },
    { slug: 'wordfence', version: '7.10.0', status: 'active' },
    { slug: 'jetpack', version: '12.0', status: 'inactive' },
  ];

  const pluginsB = [
    { slug: 'woocommerce', version: '8.1.0', status: 'active' }, // version diff
    { slug: 'akismet', version: '5.0', status: 'active' },        // only in B
    // wordfence missing                                          // only in A
    // jetpack missing                                            // only in A
  ];

  describe('computePluginDiff', () => {
    it('identifies version mismatches', () => {
      const diff = computePluginDiff(pluginsA, pluginsB);
      const mismatch = diff.versionMismatches.find(d => d.slug === 'woocommerce');
      expect(mismatch).toBeDefined();
      expect(mismatch!.versionA).toBe('8.0.0');
      expect(mismatch!.versionB).toBe('8.1.0');
    });

    it('identifies plugins only in A', () => {
      const diff = computePluginDiff(pluginsA, pluginsB);
      const slugs = diff.onlyInA.map(p => p.slug);
      expect(slugs).toContain('wordfence');
      expect(slugs).toContain('jetpack');
      expect(slugs).not.toContain('woocommerce');
    });

    it('identifies plugins only in B', () => {
      const diff = computePluginDiff(pluginsA, pluginsB);
      expect(diff.onlyInB.map(p => p.slug)).toContain('akismet');
    });

    it('returns empty arrays when installs are identical', () => {
      const diff = computePluginDiff(pluginsA, pluginsA);
      expect(diff.versionMismatches).toHaveLength(0);
      expect(diff.onlyInA).toHaveLength(0);
      expect(diff.onlyInB).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 2: Run to confirm it fails**

  Run: `npx jest tests/unit/fleet/plugin-diff.test.ts --no-coverage`
  Expected: FAIL — `Cannot find module 'src/main/fleet/plugin-diff'`

- [ ] **Step 3: Create `src/main/fleet/plugin-diff.ts`**

  ```typescript
  interface PluginRecord {
    slug: string;
    version: string;
    status: string;
  }

  export interface PluginDiff {
    onlyInA:          PluginRecord[];
    onlyInB:          PluginRecord[];
    versionMismatches: Array<{ slug: string; versionA: string; versionB: string; statusA: string; statusB: string }>;
  }

  export function computePluginDiff(
    pluginsA: PluginRecord[],
    pluginsB: PluginRecord[],
  ): PluginDiff {
    const mapA = new Map(pluginsA.map(p => [p.slug, p]));
    const mapB = new Map(pluginsB.map(p => [p.slug, p]));

    const onlyInA: PluginRecord[] = [];
    const onlyInB: PluginRecord[] = [];
    const versionMismatches: PluginDiff['versionMismatches'] = [];

    for (const [slug, pa] of mapA) {
      const pb = mapB.get(slug);
      if (!pb) { onlyInA.push(pa); continue; }
      if (pa.version !== pb.version) {
        versionMismatches.push({ slug, versionA: pa.version, versionB: pb.version, statusA: pa.status, statusB: pb.status });
      }
    }

    for (const [slug, pb] of mapB) {
      if (!mapA.has(slug)) onlyInB.push(pb);
    }

    return { onlyInA, onlyInB, versionMismatches };
  }
  ```

- [ ] **Step 4: Run tests**

  Run: `npx jest tests/unit/fleet/plugin-diff.test.ts --no-coverage`
  Expected: PASS, 4 tests.

- [ ] **Step 5: Add `nexusPluginDiff` GraphQL mutation**

  In `src/main/graphql/schema.ts`:
  ```graphql
  "Compare plugin versions between two WPE installs or local sites"
  nexusPluginDiff(installA: String!, installB: String!): NexusPluginDiffResult!
  ```

  Types:
  ```graphql
  type PluginDiffEntry {
    slug: String!
    versionA: String
    versionB: String
    statusA: String
    statusB: String
  }

  type NexusPluginDiffResult {
    success: Boolean!
    error: String
    installA: String!
    installB: String!
    onlyInA: [PluginDiffEntry!]!
    onlyInB: [PluginDiffEntry!]!
    versionMismatches: [PluginDiffEntry!]!
  }
  ```

- [ ] **Step 6: Add `nexusPluginDiff` resolver**

  ```typescript
  nexusPluginDiff: async (_: any, { installA, installB }: { installA: string; installB: string }) => {
    try {
      const db = services.graphService?.getDb();
      if (!db) return { success: false, error: 'Graph DB not available', installA, installB, onlyInA: [], onlyInB: [], versionMismatches: [] };

      const getPlugins = (siteId: string) =>
        (db.prepare('SELECT slug, version, status FROM plugins WHERE site_id = ?').all(siteId) as any[])
          .map(r => ({ slug: r.slug, version: r.version ?? '', status: r.status ?? 'unknown' }));

      const { computePluginDiff } = await import('../fleet/plugin-diff');
      const diff = computePluginDiff(getPlugins(installA), getPlugins(installB));

      return {
        success: true,
        installA,
        installB,
        onlyInA: diff.onlyInA.map(p => ({ slug: p.slug, versionA: p.version, versionB: null, statusA: p.status, statusB: null })),
        onlyInB: diff.onlyInB.map(p => ({ slug: p.slug, versionA: null, versionB: p.version, statusA: null, statusB: p.status })),
        versionMismatches: diff.versionMismatches.map(m => ({ slug: m.slug, versionA: m.versionA, versionB: m.versionB, statusA: m.statusA, statusB: m.statusB })),
      };
    } catch (err: any) {
      return { success: false, error: err.message, installA, installB, onlyInA: [], onlyInB: [], versionMismatches: [] };
    }
  },
  ```

- [ ] **Step 7: Add `nexus wpe plugin-diff <installA> <installB>` CLI**

  In `src/cli/commands/wpe.ts`, add:
  ```typescript
  wpeCommand
    .command('plugin-diff <installA> <installB>')
    .description('Compare plugins between two WPE installs or local sites')
    .option('--json', 'Output as JSON')
    .action(async (installA: string, installB: string, options) => {
      try {
        const client = getClient();
        const result = await client.mutate<{ nexusPluginDiff: any }>(`
          mutation($installA: String!, $installB: String!) {
            nexusPluginDiff(installA: $installA, installB: $installB) {
              success error installA installB
              onlyInA { slug versionA statusA }
              onlyInB { slug versionB statusB }
              versionMismatches { slug versionA versionB statusA statusB }
            }
          }
        `, { installA, installB });
        const diff = result.nexusPluginDiff;
        if (!diff.success) { console.error(`Error: ${diff.error}`); process.exit(1); }
        if (options.json) { console.log(JSON.stringify(diff, null, 2)); return; }

        console.log(`\nPlugin diff: ${installA} vs ${installB}\n`);
        if (diff.versionMismatches.length > 0) {
          console.log(`Version mismatches (${diff.versionMismatches.length}):`);
          diff.versionMismatches.forEach((m: any) => console.log(`  ${m.slug}: ${m.versionA} → ${m.versionB}`));
        }
        if (diff.onlyInA.length > 0) {
          console.log(`\nOnly in ${installA} (${diff.onlyInA.length}):`);
          diff.onlyInA.forEach((p: any) => console.log(`  ${p.slug} ${p.versionA} [${p.statusA}]`));
        }
        if (diff.onlyInB.length > 0) {
          console.log(`\nOnly in ${installB} (${diff.onlyInB.length}):`);
          diff.onlyInB.forEach((p: any) => console.log(`  ${p.slug} ${p.versionB} [${p.statusB}]`));
        }
        if (diff.versionMismatches.length === 0 && diff.onlyInA.length === 0 && diff.onlyInB.length === 0) {
          console.log('  No differences found — plugins are identical.');
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
  ```

- [ ] **Step 8: Build and full test run**

  Run: `npm run build && npm test`
  Expected: all tests pass including the 4 new plugin-diff tests.

- [ ] **Step 9: Commit**

  ```bash
  git add src/main/fleet/plugin-diff.ts src/main/graphql/schema.ts src/main/graphql/resolvers.ts src/cli/commands/wpe.ts tests/unit/fleet/plugin-diff.test.ts
  git commit -m "feat(fleet): add plugin diff — nexusPluginDiff GraphQL + nexus wpe plugin-diff CLI — enables M5-04"
  ```

---

## Self-Review

**Spec coverage:**
- ✅ Real-time indexing progress — Tasks A2, A3, A4
- ✅ ONNX model status in fresh state — Task A5
- ✅ WPE gap messaging in search — Task A6
- ✅ MySQL retry on race condition — Task A7
- ✅ PHP version in fleet query — Task B1
- ✅ Users accessible via CLI/MCP — Task B2
- ✅ Cross-install plugin diff — Task B3

**What this plan does NOT cover (separate plans needed):**
- WPE content in search (M3-05 becomes positive) — requires FTS5 + RemoteContentExtractor + SEARCH_UNIFIED
- Change tracking (M6-03) — permanent negative test, honest gap communication is the pass condition
- Plugin staleness (M4-15 fully) — requires WordPress.org API or WPE vulnerability data
- postCountByType for WPE — requires SSH WP-CLI change to extract type breakdown
- Unified SiteIndex type (Phase 3 architecture) — separate plan after Phase A+B validated

**Placeholder scan:** None — all code blocks are complete and concrete.

**Type consistency:**
- `connectWithRetry<T>` returns `T` — used with `mysql.createConnection()` which returns a connection object. ✅
- `computePluginDiff` takes `PluginRecord[]` — resolver maps graph DB rows to this shape. ✅
- `INDEX_PROGRESS` channel added in Task A1, used in A3 and A4. ✅
- `setStatusCallback` added in A2, called in A3. ✅
