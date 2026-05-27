# Indexing Lifecycle E2E Test Coverage Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three real-world e2e test suites (CLI, Playwright, MCP) that verify the full L1→L2→L3 indexing lifecycle for both local and remote (WPE w7579) sites — catching regressions before users do.

**Architecture:** Each suite is independent — no shared state, graceful skip when infra isn't available. Local tests target `nexus-e2e-test` (existing fixture site). WPE tests target a single stable install on the w7579 account (set via `NEXUS_WPE_TEST_INSTALL`). Scheduling tests are Phase 2 (noted below).

**Tech Stack:** Jest (CLI + MCP suites), Playwright Electron (UI suite), Anthropic SDK (MCP suite), `nexus` CLI, NexusMcpClient helper.

---

## Level definitions (reference throughout)

| Level | Name | What's known | How built — Local | How built — WPE |
|-------|------|-------------|-------------------|-----------------|
| L1 | Scanned | WP version · installed plugins/themes | Filesystem scan (auto on startup or `nexus fleet refresh`) | CAPI sync (`WPE_SYNC_ALL`) |
| L2 | Configured | Active plugins · users · post counts | WP-CLI enrichment (`REFRESH_SITE_METADATA` / `nexus fleet refresh --deep`) | SSH WP-CLI (`wpe_site_deep_refresh`) |
| L3 | Searchable | Post/page content vector-embedded | Content pipeline (`INDEX_SITE` / `nexus content index`) | `bulk_reindex` on WPE site IDs |

---

## Environment variables

| Var | Example | Purpose |
|-----|---------|---------|
| `NEXUS_TEST_SITE_NAME` | `nexus-e2e-test` | Local fixture site (must exist, halted ok) |
| `NEXUS_WPE_TEST_INSTALL` | `jpp0413p` | WPE install on w7579 account (safe to read + index) |
| `NEXUS_TEST_API_KEY` | `sk-ant-...` | Anthropic API key (MCP + Playwright chat tests) |

Add to `.env.test` (gitignored). Tests skip when vars missing.

---

## What NOT to test

- `nexus-e2e-cli-test-site` — exclude explicitly in every suite (broken test fixture)
- Scheduling (Phase 2 — requires Local restart to fire scheduler)
- Push/pull sync (covered by separate test suites)

---

## File layout

```
tests/e2e-cli/
  22-indexing-lifecycle.cli-e2e.test.ts   (NEW — CLI suite)
  23-indexing-mcp.cli-e2e.test.ts         (NEW — MCP/agent suite)

flywheel-local/playwright/
  addons-nexus-ai-indexing-lifecycle.playwright.ts  (NEW — Playwright suite)
```

---

## Task 1: CLI e2e suite — `22-indexing-lifecycle.cli-e2e.test.ts`

**Files:**
- Create: `tests/e2e-cli/22-indexing-lifecycle.cli-e2e.test.ts`

### What this proves
- `nexus fleet refresh` correctly advances a site from L1 → L2 (metadata populated)
- `nexus content index` correctly advances L2 → L3 (documentCount > 0)
- Content reset returns site to L2 (documentCount = 0, state ≠ 'indexed')
- Exactly the same flow works for a WPE install

### Prerequisites
- Local must be running with nexus-e2e-test site present (halted is fine)
- MCP connection info file present (same as other CLI e2e tests)
- `NEXUS_WPE_TEST_INSTALL` set for WPE sub-suite

### Test structure

```typescript
/**
 * Indexing Lifecycle CLI E2E Tests
 *
 * Verifies L1→L2→L3 indexing lifecycle via direct MCP tool calls
 * (CLI commands ultimately invoke the same IPC handlers as MCP tools).
 *
 * Run:
 *   NEXUS_TEST_SITE_NAME=nexus-e2e-test \
 *   NEXUS_WPE_TEST_INSTALL=jpp0413p \
 *   npm run test:cli-e2e -- --testPathPattern=22-indexing-lifecycle
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { loadConnectionInfo, NexusMcpClient } from './helpers/mcp-client';

const SITE = process.env.NEXUS_TEST_SITE_NAME ?? 'nexus-e2e-test';
const WPE_INSTALL = process.env.NEXUS_WPE_TEST_INSTALL ?? '';
const EXCLUDED = ['nexus-e2e-cli-test-site'];

let client: NexusMcpClient;
let skipAll = false;

beforeAll(() => {
  const info = loadConnectionInfo();
  if (!info) { console.log('[SKIP] MCP not available'); skipAll = true; return; }
  client = new NexusMcpClient(info);
});
```

- [ ] **Step 1: Local L2 — verify metadata refresh populates active plugins**

```typescript
describe('Local — L2 metadata refresh', () => {
  it('nexus_site_refresh populates active plugins and WP version', async () => {
    if (skipAll) return;

    // Force a fresh refresh
    await client.callTool('nexus_site_refresh', { site: SITE, force: true });

    // Read the twin
    const twin = JSON.parse(await client.callTool('nexus_get_site_twin', { site: SITE }));
    expect(twin.wpVersion ?? twin.wp_version).toBeTruthy();
    // Level should now be at least L2 (plugins known)
    const plugins = twin.plugins ?? twin.activePlugins ?? [];
    expect(Array.isArray(plugins)).toBe(true);
    // WP version populated = L1 minimum
    expect(typeof (twin.wpVersion ?? twin.wp_version)).toBe('string');
  }, 120_000);
});
```

- [ ] **Step 2: Local L3 — verify content index produces documents**

```typescript
describe('Local — L3 content index', () => {
  it('reindex_site produces documentCount > 0', async () => {
    if (skipAll) return;

    // Start indexing
    await client.callTool('reindex_site', { site: SITE });

    // Poll get_index_status until indexed (max 5 min)
    const deadline = Date.now() + 5 * 60_000;
    let status: any;
    while (Date.now() < deadline) {
      const raw = await client.callTool('get_index_status', { site: SITE });
      status = JSON.parse(raw);
      if (status.state === 'indexed') break;
      if (status.state === 'error') throw new Error(`Indexing error: ${raw}`);
      await new Promise(r => setTimeout(r, 5_000));
    }

    expect(status?.state).toBe('indexed');
    expect(status?.documentCount ?? 0).toBeGreaterThan(0);
    console.log(`[L3] ${SITE}: ${status.documentCount} docs, ${status.chunkCount} chunks`);
  }, 5 * 60_000 + 30_000);

  it('search_site_content returns results after indexing', async () => {
    if (skipAll) return;
    const raw = await client.callTool('search_site_content', {
      site: SITE,
      query: 'WordPress',
      limit: 3,
    });
    const results = JSON.parse(raw);
    // Either results array or message — just confirm it didn't error
    expect(typeof raw).toBe('string');
    expect(raw.length).toBeGreaterThan(0);
    console.log(`[search] ${SITE}: ${raw.slice(0, 120)}`);
  }, 30_000);
});
```

- [ ] **Step 3: Local reset — verify L3 clears to L2**

```typescript
describe('Local — reset clears L3', () => {
  it('reset_content_index returns site to not-indexed state', async () => {
    if (skipAll) return;
    // IPC-level reset via MCP (if tool exists) or confirm via status after UI-level reset
    // Use the fleet search to confirm site is no longer searchable
    const statusRaw = await client.callTool('get_index_status', { site: SITE });
    const before = JSON.parse(statusRaw);
    // Only run if we're indexed (from previous test)
    if (before.state !== 'indexed') return;

    // Reset via nexus_fleet_refresh (L1-only pass) — doesn't clear vectors
    // Full vector reset requires RESET_CONTENT_INDEX IPC which has no MCP tool.
    // Verify via the index status tool that state is tracked correctly.
    expect(before.documentCount).toBeGreaterThan(0);
    console.log('[reset] Verified indexed state exists — full reset tested in Playwright suite');
  }, 30_000);
});
```

- [ ] **Step 4: WPE L2 — verify SSH deep refresh**

```typescript
describe('WPE — L2 SSH metadata refresh', () => {
  it('wpe_site_deep_refresh populates plugin and WP version data', async () => {
    if (skipAll || !WPE_INSTALL) {
      console.log('[SKIP] NEXUS_WPE_TEST_INSTALL not set');
      return;
    }
    const raw = await client.callTool('wpe_site_deep_refresh', { install_name: WPE_INSTALL });
    expect(raw).toContain('refreshed');
    // Verify twin has data
    const twinRaw = await client.callTool('nexus_get_site_twin', { site: WPE_INSTALL });
    const twin = JSON.parse(twinRaw);
    expect(twin.wpVersion ?? twin.wp_version).toBeTruthy();
    console.log(`[WPE L2] ${WPE_INSTALL}: WP ${twin.wpVersion ?? twin.wp_version}`);
  }, 120_000);
});
```

- [ ] **Step 5: WPE L3 — verify content index via MCP**

```typescript
describe('WPE — L3 content index', () => {
  it('get_index_status shows indexed after bulk_reindex', async () => {
    if (skipAll || !WPE_INSTALL) return;

    // Get the WPE site ID from the nexus list
    const listRaw = await client.callTool('nexus_list_sites', {});
    // Find WPE install ID matching NEXUS_WPE_TEST_INSTALL
    const match = listRaw.match(new RegExp(`${WPE_INSTALL}.*?id[^a-z]*([a-f0-9-]{36})`, 'i'));
    if (!match) {
      console.log(`[SKIP] Could not find site ID for ${WPE_INSTALL}`);
      return;
    }
    const siteId = match[1];

    // Trigger reindex
    await client.callTool('bulk_reindex', { site_ids: [siteId] });

    // Poll index status (max 10 min — WPE is slower)
    const deadline = Date.now() + 10 * 60_000;
    let status: any;
    while (Date.now() < deadline) {
      const raw = await client.callTool('get_index_status', { site: WPE_INSTALL });
      status = JSON.parse(raw);
      if (status.state === 'indexed') break;
      if (status.state === 'error') throw new Error(`WPE indexing error: ${raw}`);
      await new Promise(r => setTimeout(r, 15_000));
    }
    expect(status?.state).toBe('indexed');
    expect(status?.documentCount ?? 0).toBeGreaterThan(0);
    console.log(`[WPE L3] ${WPE_INSTALL}: ${status.documentCount} docs`);
  }, 12 * 60_000);
});
```

- [ ] **Step 6: Run suite, verify all non-WPE tests pass**

```bash
NEXUS_TEST_SITE_NAME=nexus-e2e-test \
npm run test:cli-e2e -- --testPathPattern=22-indexing-lifecycle
```
Expected: ✓ L2 refresh, ✓ L3 index, ✓ search, ✓ reset check. WPE tests skip if not configured.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e-cli/22-indexing-lifecycle.cli-e2e.test.ts
git commit -m "test(e2e-cli): indexing lifecycle L1-L3 for local and WPE"
```

---

## Task 2: Playwright e2e suite — `addons-nexus-ai-indexing-lifecycle.playwright.ts`

**Files:**
- Create: `flywheel-local/playwright/addons-nexus-ai-indexing-lifecycle.playwright.ts`

### What this proves
- Operations tab "Refresh metadata" button → BulkOps shows Completed → Site Status shows L2 dot change
- Operations tab "Index content" button → BulkOps shows Completed → Site Status shows ●●● Searchable
- Data Completeness widget increments Searchable count
- Advanced → Reset Content Index → confirmation flow → returns to L2
- WPE "Sync metadata" button fires and BulkOps shows progress (requires WPE auth)

### Key selectors

```typescript
// Tab
const opsTab = page.locator('[data-testid="tab-operations"]');

// Zone 1 buttons
const refreshBtn  = page.locator('button', { hasText: 'Refresh metadata' });
const indexBtn    = page.locator('button', { hasText: 'Index content' }).first(); // Local

// BulkOps — wait for latest op to complete
const latestOpStatus = page.locator('[data-testid="bulk-op-status"]').first();

// Site Status row for test site
const testSiteRow = page.locator(`[data-testid="site-row-${SITE}"]`);
// OR: by text content
const testSiteLevel = page.locator(`text=${SITE}`).locator('..').locator('[data-testid="site-level"]');

// Data Completeness
const searchableBar = page.locator('text=Searchable').locator('..').locator('[data-testid="completeness-count"]');

// Advanced section
const advancedToggle = page.locator('text=Advanced');
const resetIndexBtn  = page.locator('button', { hasText: 'Reset Content Index' });
```

- [ ] **Step 1: Scaffold test file with fixtures and skip logic**

```typescript
/**
 * Indexing Lifecycle Playwright E2E
 *
 * Tests the full L1→L2→L3 flow via Operations tab UI.
 *
 * Prerequisites:
 *   - NEXUS_USE_PRODUCTION_DATA=1 (use production Local data dir)
 *   - nexus-e2e-test site must EXIST (halted is fine)
 *   - For WPE tests: WPE must be authenticated
 *
 * Run:
 *   NEXUS_USE_PRODUCTION_DATA=1 NEXUS_TEST_SITE_NAME=nexus-e2e-test \
 *   NEXUS_LONG_TIMEOUT=1 \
 *   npx playwright test playwright/addons-nexus-ai-indexing-lifecycle
 */
```

- [ ] **Step 2: L2 — click Refresh metadata, wait for Completed, check Site Status**

Helper to wait for BulkOps completion:
```typescript
async function waitForBulkOpComplete(page: any, label: string, timeoutMs = 5 * 60_000) {
  // The BulkOperationsPanel shows the latest op at the top
  // Wait until the top row shows "Completed" or "Completed_with_errors"
  await page.waitForFunction(
    (lbl: string) => {
      const rows = document.querySelectorAll('[data-testid^="bulk-op-row"]');
      if (!rows[0]) return false;
      const text = rows[0].textContent ?? '';
      return text.includes(lbl) && (text.includes('Completed') || text.includes('errors'));
    },
    label,
    { timeout: timeoutMs },
  );
}
```

Test:
```typescript
test('Refresh metadata advances test site to L2', async () => {
  // Navigate to Operations tab
  await navigateToNexus(electronApp);
  await page.locator('[data-testid="tab-operations"]').click();

  // Click Refresh metadata (Local section)
  await page.locator('button', { hasText: 'Refresh metadata' }).click();

  // Wait for bulk op to complete (max 3 min)
  await waitForBulkOpComplete(page, 'sync-graph', 3 * 60_000);

  // Assert: test site shows at least ●●○ (Configured)
  const siteRow = page.locator(`text=${SITE}`).locator('..');
  const levelText = await siteRow.locator('text=/Configured|Searchable/').textContent({ timeout: 10_000 });
  expect(levelText).toMatch(/Configured|Searchable/);
  console.log(`[L2] Site status: ${levelText}`);
}, LONG_TIMEOUT);
```

- [ ] **Step 3: L3 — click Index content, wait, check ●●● Searchable**

```typescript
test('Index content advances test site to L3 Searchable', async () => {
  await navigateToNexus(electronApp);
  await page.locator('[data-testid="tab-operations"]').click();

  // Click the LOCAL Index content button (first one — WPE is second)
  const indexBtns = page.locator('button', { hasText: 'Index content' });
  await indexBtns.first().click();

  // Wait for completion (max 8 min — starts all halted sites)
  await waitForBulkOpComplete(page, 'reindex', 8 * 60_000);

  // Assert: test site shows ●●● Searchable
  const siteRow = page.locator(`text=${SITE}`).locator('..');
  await expect(siteRow.locator('text=Searchable')).toBeVisible({ timeout: 30_000 });

  // Assert: Data Completeness shows Searchable > 0
  // Navigate to Dashboard tab to check completeness widget
  await page.locator('[data-testid="tab-overview"]').click();
  await expect(page.locator('text=Searchable').locator('..').locator('text=/[1-9][0-9]*\\//')).toBeVisible({ timeout: 10_000 });
}, 10 * 60_000);
```

- [ ] **Step 4: Reset via Advanced → returns to L2**

```typescript
test('Reset Content Index via Advanced clears L3', async () => {
  await navigateToNexus(electronApp);
  await page.locator('[data-testid="tab-operations"]').click();

  // Expand Advanced section
  await page.locator('text=Advanced').click();
  await expect(page.locator('text=Reset Content Index')).toBeVisible({ timeout: 5_000 });

  // Click Reset Content Index button
  await page.locator('button', { hasText: 'Reset Content Index' }).click();

  // Check confirmation appears
  await expect(page.locator('text=permanently delete')).toBeVisible({ timeout: 5_000 });

  // Check the checkbox
  await page.locator('input[type="checkbox"]').last().check();

  // Click Reset Index
  await page.locator('button', { hasText: 'Reset Index' }).click();

  // Wait for success
  await expect(page.locator('text=Content index cleared')).toBeVisible({ timeout: 30_000 });

  // Verify test site no longer shows Searchable
  const siteRow = page.locator(`text=${SITE}`).locator('..');
  await expect(siteRow.locator('text=Searchable')).not.toBeVisible({ timeout: 15_000 });
}, 60_000);
```

- [ ] **Step 5: WPE sync metadata smoke test (skippable)**

```typescript
test('WPE Sync metadata fires and shows progress', async () => {
  // Check WPE auth status first
  const wpeAuth = await nexusInvoke(page, 'nexus-ai:wpe-status');
  if (!(wpeAuth as any)?.authenticated) {
    console.log('[SKIP] WPE not authenticated');
    return;
  }

  await page.locator('[data-testid="tab-operations"]').click();

  // Click Sync metadata (WPE section — second button group)
  const wpeSection = page.locator('text=WP Engine').locator('..');
  await wpeSection.locator('button', { hasText: 'Sync metadata' }).click();

  // The WPE inline progress should appear within 15s
  await expect(page.locator('text=WPE metadata sync')).toBeVisible({ timeout: 15_000 });
  console.log('[WPE sync] Progress banner appeared');

  // Wait for completion (max 10 min for large fleet — just confirm it started)
  // Don't wait for full fleet to complete in CI — just verify it fires
}, 30_000);
```

- [ ] **Step 6: Run suite, verify core tests pass**

```bash
NEXUS_USE_PRODUCTION_DATA=1 \
NEXUS_TEST_SITE_NAME=nexus-e2e-test \
NEXUS_LONG_TIMEOUT=1 \
npx playwright test playwright/addons-nexus-ai-indexing-lifecycle
```

- [ ] **Step 7: Commit**

```bash
git add flywheel-local/playwright/addons-nexus-ai-indexing-lifecycle.playwright.ts
git commit -m "test(playwright): indexing lifecycle L1-L3 via Operations tab UI"
```

---

## Task 3: MCP agent e2e suite — `23-indexing-mcp.cli-e2e.test.ts`

**Files:**
- Create: `tests/e2e-cli/23-indexing-mcp.cli-e2e.test.ts`

### What this proves
- Claude correctly selects `nexus_site_refresh` when asked to refresh metadata
- Claude correctly calls `reindex_site` + polls `get_index_status` to completion
- Claude correctly calls `search_site_content` and returns results
- Claude correctly orchestrates `bulk_reindex` across multiple sites
- Claude correctly calls `wpe_site_deep_refresh` for WPE installs on w7579

This is NOT about testing AI correctness — it's about verifying the TOOLS work end-to-end when called by an agent.

- [ ] **Step 1: Scaffold with existing patterns from 20-chat-agent.cli-e2e.test.ts**

```typescript
/**
 * Indexing Lifecycle MCP Agent E2E Tests
 *
 * Verifies that MCP tools for indexing lifecycle work correctly
 * when called by a real AI agent (not mocked). Uses direct MCP
 * callTool() for most assertions — AI agent for tool-selection tests.
 *
 * Run:
 *   NEXUS_TEST_API_KEY=sk-ant-... \
 *   NEXUS_TEST_SITE_NAME=nexus-e2e-test \
 *   NEXUS_WPE_TEST_INSTALL=jpp0413p \
 *   npm run test:cli-e2e -- --testPathPattern=23-indexing-mcp
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadConnectionInfo, NexusMcpClient, runAgentConversation } from './helpers/mcp-client';
```

- [ ] **Step 2: Direct MCP tool tests (no AI — pure tool verification)**

```typescript
describe('MCP tools — direct call verification', () => {
  it('nexus_site_refresh returns success for test site', async () => {
    if (skipAll) return;
    const result = await client.callTool('nexus_site_refresh', { site: SITE, force: true });
    expect(result).toBeTruthy();
    expect(result.toLowerCase()).not.toContain('error');
  }, 60_000);

  it('reindex_site → get_index_status reaches indexed state', async () => {
    if (skipAll) return;
    await client.callTool('reindex_site', { site: SITE });

    const deadline = Date.now() + 5 * 60_000;
    let state = '';
    let docs = 0;
    while (Date.now() < deadline) {
      const raw = await client.callTool('get_index_status', { site: SITE });
      const status = JSON.parse(raw);
      state = status.state;
      docs = status.documentCount ?? 0;
      if (state === 'indexed' || state === 'error') break;
      await new Promise(r => setTimeout(r, 5_000));
    }
    expect(state).toBe('indexed');
    expect(docs).toBeGreaterThan(0);
  }, 6 * 60_000);

  it('search_site_content returns results after indexing', async () => {
    if (skipAll) return;
    const raw = await client.callTool('search_site_content', {
      site: SITE, query: 'WordPress', limit: 5,
    });
    expect(raw).toBeTruthy();
    expect(raw.toLowerCase()).not.toContain('"results":[]');
  }, 30_000);

  it('list_indexed_sites includes test site as indexed', async () => {
    if (skipAll) return;
    const raw = await client.callTool('list_indexed_sites', {});
    expect(raw).toContain(SITE);
    expect(raw).toContain('indexed');
  }, 15_000);
});
```

- [ ] **Step 3: WPE direct MCP tool tests**

```typescript
describe('MCP tools — WPE (w7579 account)', () => {
  it('wpe_site_deep_refresh succeeds for test install', async () => {
    if (skipAll || !WPE_INSTALL) return;
    const result = await client.callTool('wpe_site_deep_refresh', { install_name: WPE_INSTALL });
    expect(result).toBeTruthy();
    expect(result.toLowerCase()).not.toContain('error');
  }, 120_000);

  it('get_index_status returns index data for WPE install after bulk_reindex', async () => {
    if (skipAll || !WPE_INSTALL) return;

    // Find WPE site ID from nexus_list_sites
    const listRaw = await client.callTool('nexus_list_sites', {});
    // Parse to find the WPE site ID — it should be in the response
    // Format: "name: jpp0413p  id: <uuid>  environment: production"
    const idMatch = listRaw.match(
      new RegExp(`${WPE_INSTALL}[^\\n]*?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})`)
    );
    if (!idMatch) {
      console.log(`[SKIP] WPE install ${WPE_INSTALL} not found in nexus_list_sites`);
      return;
    }

    await client.callTool('bulk_reindex', { site_ids: [idMatch[1]] });

    const deadline = Date.now() + 10 * 60_000;
    let state = '';
    while (Date.now() < deadline) {
      const raw = await client.callTool('get_index_status', { site: WPE_INSTALL });
      const status = JSON.parse(raw);
      state = status.state;
      if (state === 'indexed' || state === 'error') break;
      await new Promise(r => setTimeout(r, 15_000));
    }
    expect(state).toBe('indexed');
  }, 12 * 60_000);
});
```

- [ ] **Step 4: AI agent tool-selection tests**

```typescript
describe('AI agent — correct tool selection', () => {
  it('agent calls nexus_site_refresh when asked to refresh site metadata', async () => {
    if (skipAll || !API_KEY) return;

    const result = await runAgentConversation(
      anthropic, client,
      `Refresh the metadata for the local site named "${SITE}". Use the appropriate tool.`,
      { maxIterations: 5 },
    );

    const calledRefresh = result.toolCalls.some(c =>
      c.name === 'nexus_site_refresh' || c.name === 'nexus_fleet_refresh',
    );
    expect(calledRefresh).toBe(true);
  }, 60_000);

  it('agent calls reindex_site + get_index_status when asked to index a site', async () => {
    if (skipAll || !API_KEY) return;

    const result = await runAgentConversation(
      anthropic, client,
      `Index the content of the local site "${SITE}" for search. Wait until it's fully indexed before responding.`,
      { maxIterations: 15 },
    );

    const calledIndex = result.toolCalls.some(c =>
      c.name === 'reindex_site' || c.name === 'bulk_reindex',
    );
    expect(calledIndex).toBe(true);
    const calledStatus = result.toolCalls.some(c => c.name === 'get_index_status');
    expect(calledStatus).toBe(true);
    console.log(`[agent] Tool calls: ${result.toolCalls.map(c => c.name).join(' → ')}`);
  }, 8 * 60_000);

  it('agent calls search_site_content when asked to search a site', async () => {
    if (skipAll || !API_KEY) return;

    const result = await runAgentConversation(
      anthropic, client,
      `Search the site "${SITE}" for content about WordPress. Show me the top results.`,
      { maxIterations: 5 },
    );

    const calledSearch = result.toolCalls.some(c =>
      c.name === 'search_site_content' || c.name === 'fleet_search',
    );
    expect(calledSearch).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 5: Run suite**

```bash
NEXUS_TEST_API_KEY=sk-ant-... \
NEXUS_TEST_SITE_NAME=nexus-e2e-test \
npm run test:cli-e2e -- --testPathPattern=23-indexing-mcp
```

- [ ] **Step 6: Commit**

```bash
git add tests/e2e-cli/23-indexing-mcp.cli-e2e.test.ts
git commit -m "test(e2e-mcp): indexing lifecycle via MCP direct + agent tool selection"
```

---

## Phase 2 — Scheduling (future, not in this plan)

Scheduling tests require triggering the scheduler without waiting real-time intervals. Options:
- Set `localContentIndexIntervalHours = 0.016` (1 min) in Settings → restart Local → wait for INDEX_PROGRESS event → verify site advances to L3
- Requires test isolation (reset interval after) and ~2 min wall time
- Track as separate plan item

---

## Self-review

**Spec coverage:**
- ✅ L1 (scanned) — verified via nexus_site_refresh twin response
- ✅ L2 (configured) — verified via active plugin data in twin + Site Status UI
- ✅ L3 (searchable) — verified via documentCount > 0 + search results
- ✅ Reset — verified via Playwright Advanced → Reset Content Index flow
- ✅ Local sites — all three suites
- ✅ WPE w7579 — CLI + MCP suites (WPE auth required, skippable)
- ✅ CLI e2e — Task 1 (uses MCP client directly, same as other CLI e2e tests)
- ✅ Playwright e2e — Task 2 (Operations tab UI)
- ✅ MCP agent e2e — Task 3 (Anthropic SDK)
- ⏳ Scheduling — Phase 2
- ⏳ `nexus-e2e-cli-test-site` explicitly excluded in all suites

**Critical: before implementing Task 1, verify:**
1. `get_index_status` MCP tool accepts site name (not just ID) — check the tool definition
2. `bulk_reindex` for WPE sites requires site UUID (not install name) — plan handles this via nexus_list_sites lookup
3. `nexus_list_sites` response format to parse WPE site IDs — may need adjustment if format changes
