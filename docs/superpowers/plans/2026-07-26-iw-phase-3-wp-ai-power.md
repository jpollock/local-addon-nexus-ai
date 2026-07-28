# IW Phase 3 — WP AI Setup with Power + KB Search + Fleet Overlay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a site is Hub-connected (Phase 2), let Nexus complete the WP AI setup with Power in one click — automating Hub's manual steps 3+4. Also add KB read/search MCP tools and fleet overlay for IW connection status.

**Architecture:**
- `setup-ai.ts` gets a new `'power'` provider branch: installs WP AI plugin, Nexus connector, enables AI experiments, approves the `'wpengine'` connector — but skips provider plugin install and credential sync (Hub auth already in WP DB from Phase 2 connect).
- `NexusSiteTab` adds a "Setup WP AI" button inside the IW card when Hub is connected but WP AI not yet set up with Power.
- Three new MCP tools for KB read/search: `iw_list_kb_collections`, `iw_get_kb_collection`, `iw_search_kb`.
- Fleet overlay: `iw_fleet_status` MCP tool reads IW binding from `STORAGE_KEYS.IW_SITE_BINDINGS` and joins with site list.

**Tech Stack:** TypeScript, Node.js, WP-CLI via `localServices.wpCliRun`, React (class-based, no JSX, no hooks), `fetch` for Power KB API

## Global Constraints

- `'wpengine'` is the connector ID constant (`WPE_AI_CONNECTOR_PROVIDER_ID`) registered by the Hub Plugin's bundled `wpe-ai-connector`. Approval format: `$approvals[$caller_basename]['wpengine'] = true`.
- Callers to approve: `'ai/ai.php'`, `'nexus-ai-connector/nexus-ai-connector.php'`, `'wpe-hub/wpe-hub.php'`.
- Power setup path **skips provider plugin install** — Hub's WP Engine connector is already registered by the active Hub Plugin. No `ai-provider-for-*` plugin to install.
- Power setup path **skips credential sync** — Hub's `wpe_auth_client_id` + EdDSA keypair are already in WP DB from Phase 2 connect. The `wpe_` Full Access key NEVER enters the WP database.
- Power setup path **requires Hub to be connected** (`iwStatus.connected === true`) before it can be offered. Gate the UI button and the IPC handler on this.
- KB API base URL: `https://api.ai.wpengine.com/v1` — same as PowerProvider. Auth: `Authorization: Bearer {wpe_key}` from KeyVault. Project scoped via `wpe_auth_project_id` read from WP DB.
- Q9 decision (inline): Hub Plugin owns KB sync for connected sites. Nexus only **reads and searches** — no indexing, no collection creation.
- D3 invariant: Power / WP AI setup is user's choice. No auto-setup on Hub connect. Button appears but nothing runs without a click.
- Commit trailer: `Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>`
- No `git push`, `npm version`, `git tag`, releases.
- All npm/npx/jest/tsc commands: prefix `fnm exec --using=22.16.0`

## Key interfaces from prior phases

**`IwConnectionStatus`** (`src/common/types.ts`):
```typescript
{ hubInstalled: boolean; connected: boolean; copyReset: boolean;
  clientId: string | null; projectId: string | null; accountId: string | null; }
```

**`IwSiteBinding`** (`src/common/types.ts`):
```typescript
{ siteId: string; clientId: string; projectId: string; accountId: string; connectedAt: number; }
```

**`readIwBinding(siteId, storage)`** — `src/main/mcp/modules/iw/hub-connect.ts`

**`getConnectionStatus(siteId, localServices)`** — same file

**`STORAGE_KEYS.IW_SITE_BINDINGS`** — `src/common/constants.ts`

**`setupSiteForAI(siteId, localServices, registryStorage, logger, options)`** — `src/main/mcp/modules/wp-connector/setup-ai.ts`
- `options.provider: AIProvider` — determines which branch runs
- Currently handles: `'anthropic'`, `'openai'`, `'google'`, `'ollama'`, `'local-gateway'`
- **New**: `'power'` branch to add in Task 1

**`AI_EXPERIMENT_IDS`** — array of experiment strings in setup-ai.ts (lines 107–123)

**`IPC_CHANNELS.SETUP_AI`** — `'nexus-ai:setup-ai'` (already registered; Task 2 adds `'power'` as valid provider)

**Power KB API endpoints:**
- `GET  /v1/kb/collections` — list collections for the project
- `GET  /v1/kb/collections/{id}` — get collection details
- `POST /v1/kb/collections/{id}/search` — body: `{ query: string; top_k?: number }`

---

## Task 1: Add `'power'` provider branch to `setup-ai.ts`

**Files:**
- Modify: `src/main/mcp/modules/wp-connector/setup-ai.ts`
- Test: `tests/unit/mcp/setup-ai-power.test.ts`

**Interfaces:**
- Consumes: `setupSiteForAI` (existing), `AI_EXPERIMENT_IDS`, `getConnectionStatus` from `../iw/hub-connect`
- Produces: `setupSiteForAI` handles `provider === 'power'` — skips provider plugin and credential sync, approves `'wpengine'` connector

**What the `'power'` branch does differently from other providers:**
1. Checks Hub is connected (`wpe_auth_registered` truthy AND `wpe_auth_client_id` non-empty) — returns early with error if not.
2. Steps 1 and 1b unchanged: install WP AI plugin + Nexus AI Connector.
3. Step 2b (`providerPlugins`): **skip** — Hub's WP Engine connector already registered. Result: `'skipped'`.
4. Step 2c (`gatewayProvider`): **skip** — not using Local Gateway. Result: `'skipped'`.
5. Step 2d (`ollamaProvider`): **skip**. Result: `'skipped'`.
6. Step 3 (enable AI features): unchanged.
7. **New step 3b**: approve `'wpengine'` connector in `wpai_connector_approvals`. PHP:
   ```php
   $approvals = get_option('wpai_connector_approvals', array());
   $callers = array('ai/ai.php', 'nexus-ai-connector/nexus-ai-connector.php', 'wpe-hub/wpe-hub.php');
   foreach ($callers as $caller) {
     if (!isset($approvals[$caller])) { $approvals[$caller] = array(); }
     $approvals[$caller]['wpengine'] = true;
   }
   update_option('wpai_connector_approvals', $approvals, false);
   echo 'ok';
   ```
8. Step 4 (credential sync): **skip** — Hub auth already in WP DB. Result: `'skipped'`.
9. Persist per-site AI config with `provider: 'power'`.

- [ ] **Step 1: Write failing test**

Create `tests/unit/mcp/setup-ai-power.test.ts`:

```typescript
import { setupSiteForAI } from '../../../src/main/mcp/modules/wp-connector/setup-ai';

// Mock KeyVault — no OS keychain under Jest
jest.mock('../../../src/main/security/KeyVault', () => ({ getApiKey: jest.fn(() => null) }));
// Mock hub-connect — control connection status
jest.mock('../../../src/main/mcp/modules/iw/hub-connect', () => ({
  getConnectionStatus: jest.fn(),
}));
import { getConnectionStatus } from '../../../src/main/mcp/modules/iw/hub-connect';
const mockGetConnectionStatus = getConnectionStatus as jest.MockedFunction<typeof getConnectionStatus>;

const connectedStatus = {
  hubInstalled: true, connected: true, copyReset: false,
  clientId: 'client_abc', projectId: 'proj_xyz', accountId: 'acct_111',
};

const mockLocalServices = {
  getWpVersion: jest.fn().mockResolvedValue('7.0.2'),
  getPlugins: jest.fn().mockResolvedValue([
    { name: 'ai', status: 'active', version: '1.0.0', title: 'AI' },
    { name: 'nexus-ai-connector', status: 'active', version: '1.0.0', title: 'Nexus AI' },
  ]),
  wpCliRun: jest.fn().mockResolvedValue({ stdout: 'ok', success: true }),
  resolveSiteObject: jest.fn().mockReturnValue({ paths: { webRoot: '/tmp/test-site' } }),
} as any;

const mockStorage = {
  get: jest.fn().mockReturnValue({}),
  set: jest.fn(),
} as any;

const mockLogger = { info: jest.fn(), error: jest.fn() };

describe('setupSiteForAI — power provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnectionStatus.mockResolvedValue(connectedStatus);
  });

  it('skips provider plugin, skips credential sync, approves wpengine connector', async () => {
    const result = await setupSiteForAI('site_1', mockLocalServices, mockStorage, mockLogger, { provider: 'power' });

    expect(result.providerPlugins).toBe('skipped');
    expect(result.gatewayProvider).toBe('skipped');
    expect(result.credentials).toBe('skipped');

    // wpengine approval PHP should have been run
    const evalCalls = mockLocalServices.wpCliRun.mock.calls
      .filter((c: string[]) => c[0] === 'eval' || c[1]?.[0] === 'eval');
    const approvalCall = mockLocalServices.wpCliRun.mock.calls.find(
      (c: any) => Array.isArray(c[1]) && c[1][0] === 'eval' && c[1][1]?.includes('wpengine'),
    );
    expect(approvalCall).toBeDefined();
  });

  it('returns error when Hub is not connected', async () => {
    mockGetConnectionStatus.mockResolvedValue({ ...connectedStatus, connected: false, clientId: null });
    const result = await setupSiteForAI('site_1', mockLocalServices, mockStorage, mockLogger, { provider: 'power' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Hub Plugin/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
fnm exec --using=22.16.0 npx jest tests/unit/mcp/setup-ai-power.test.ts --no-coverage
```

Expected: FAIL — `provider === 'power'` not handled yet.

- [ ] **Step 3: Add `'power'` branch to `setup-ai.ts`**

At the top of `setupSiteForAI`, after resolving `provider`, add the Power connection check:

```typescript
// Power path: verify Hub is connected before proceeding
if (provider === 'power') {
  const { getConnectionStatus } = await import('../iw/hub-connect');
  const iwStatus = await getConnectionStatus(siteId, localServices);
  if (!iwStatus.connected) {
    const msg = 'Hub Plugin is not connected to Power. Complete the Hub connect flow first.';
    logger.error(`${tag} ${msg}`);
    return {
      success: false, aiPlugin: 'failed', connectorPlugin: 'failed',
      providerPlugins: 'skipped', gatewayProvider: 'skipped', ollamaProvider: 'skipped',
      aiFeatures: 'skipped', credentials: 'skipped', acfAbilities: 'skipped', message: msg,
    };
  }
}
```

In the provider plugin step (Step 2b), add to the skip condition:

```typescript
const isRemoteProvider = providerSlug && provider !== 'ollama' && provider !== 'local-gateway' && provider !== 'power';
```

In the gateway provider step (Step 2c):

```typescript
if (useLocalGateway && provider !== 'power') {
```

After the AI features step (Step 3) and before the credential sync step (Step 4), add the WP Engine connector approval for the `'power'` path:

```typescript
if (provider === 'power' && aiPlugin !== 'failed') {
  try {
    const approvalPhp = [
      "$approvals = get_option('wpai_connector_approvals', array());",
      "$callers = array('ai/ai.php', 'nexus-ai-connector/nexus-ai-connector.php', 'wpe-hub/wpe-hub.php');",
      'foreach ($callers as $caller) {',
      '  if (!isset($approvals[$caller])) { $approvals[$caller] = array(); }',
      "  $approvals[$caller]['wpengine'] = true;",
      '}',
      "update_option('wpai_connector_approvals', \$approvals, false);",
      "echo 'ok';",
    ].join(' ');
    await localServices.wpCliRun(siteId, ['eval', approvalPhp]);
    logger.info(`${tag} WP Engine connector approved on site ${siteId}`);
  } catch (err) {
    logger.error(`${tag} Connector approval failed: ${err}`);
    // Non-fatal — user can approve manually in WP Admin
  }
}
```

In the credential sync step (Step 4), skip for Power:

```typescript
if (!useLocalGateway && providerKey && PROVIDER_TO_WP_OPTION[provider] && provider !== 'power') {
```

- [ ] **Step 4: Run test to confirm pass**

```bash
fnm exec --using=22.16.0 npx jest tests/unit/mcp/setup-ai-power.test.ts --no-coverage
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Compile**

```bash
fnm exec --using=22.16.0 npx tsc -p . --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/modules/wp-connector/setup-ai.ts tests/unit/mcp/setup-ai-power.test.ts
git commit -m "feat(iw): add 'power' provider branch to setup-ai

Automates Hub's manual steps 3+4 after Hub connect:
- Checks Hub is connected before proceeding
- Skips provider plugin install (Hub's WP Engine connector already registered)
- Approves 'wpengine' connector in wpai_connector_approvals
- Skips credential sync (Hub auth already in WP DB, wpe_ key never enters WP)

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: "Setup WP AI" button in NexusSiteTab IW card

**Files:**
- Modify: `src/renderer/components/NexusSiteTab.tsx`
- Test: `tests/unit/renderer/iw-setup-ai-button.test.ts`

**Interfaces:**
- Consumes: `IPC_CHANNELS.SETUP_AI` (`'nexus-ai:setup-ai'`), `IwConnectionStatus` from state, `IPC_CHANNELS.IW_GET_STATUS`
- Produces: "Setup WP AI" button visible in `renderIwCard` when `connected === true` and WP AI not yet set up with Power

**State to add to `NexusSiteTabState`:**
```typescript
iwAiSetupStatus: 'unknown' | 'ready' | 'setting_up' | 'done' | 'failed';
iwAiSetupError: string | null;
```

The `'ready'` state means Hub is connected but Power WP AI setup has not been run yet. Nexus detects this by checking whether the `'wpengine'` connector is approved:

```php
$approvals = get_option('wpai_connector_approvals', array());
$approved = false;
foreach (array('ai/ai.php', 'wpe-hub/wpe-hub.php') as $caller) {
  if (!empty($approvals[$caller]['wpengine'])) { $approved = true; break; }
}
echo $approved ? 'approved' : 'not_approved';
```

Run this via `IPC_CHANNELS.IW_GET_STATUS` response... actually, this check belongs in the `IW_GET_STATUS` handler. Extend the handler to also return `wpAiReady: boolean` when connected.

Wait — cleaner: add a new field `wpEngineConnectorApproved: boolean` to `IwConnectionStatus`, populated by `getConnectionStatus` in `hub-connect.ts`.

**Updated `IwConnectionStatus`** (add one field):
```typescript
/** True when 'wpengine' connector is approved in wpai_connector_approvals — WP AI is set up with Power. */
wpEngineConnectorApproved: boolean;
```

**Updated `getConnectionStatus` STATUS_PHP** — add to the PHP snippet:
```php
$approvals = get_option('wpai_connector_approvals', array());
$wpe_approved = false;
foreach (array('ai/ai.php', 'wpe-hub/wpe-hub.php') as $caller) {
  if (!empty($approvals[$caller]['wpengine'])) { $wpe_approved = true; break; }
}
```
And add `'wpe_approved' => $wpe_approved ? '1' : ''` to the JSON.

In `renderIwCard`, when `connected === true && !iwStatus.wpEngineConnectorApproved`:
- Show a "Setup WP AI with Power" button alongside the Disconnect button
- On click → call `handleIwSetupAI`

`handleIwSetupAI`:
```typescript
handleIwSetupAI = async (): Promise<void> => {
  this.setState({ iwAiSetupStatus: 'setting_up', iwAiSetupError: null });
  try {
    const result = await this.props.electron.ipcRenderer.invoke(
      IPC_CHANNELS.SETUP_AI, this.props.site.id, { provider: 'power' }
    ) as { success: boolean; message: string } | null;
    if (result?.success) {
      this.setState({ iwAiSetupStatus: 'done' });
      // Re-fetch IW status to update the card
      const status = await this.props.electron.ipcRenderer
        .invoke(IPC_CHANNELS.IW_GET_STATUS, this.props.site.id).catch(() => null);
      if (this.mounted && status) this.setState({ iwStatus: status });
    } else {
      this.setState({ iwAiSetupStatus: 'failed', iwAiSetupError: result?.message ?? 'Setup failed' });
    }
  } catch (err: any) {
    this.setState({ iwAiSetupStatus: 'failed', iwAiSetupError: String(err?.message ?? err) });
  }
};
```

- [ ] **Step 1: Write failing test**

Create `tests/unit/renderer/iw-setup-ai-button.test.ts`:

```typescript
import type { IwConnectionStatus } from '../../../src/common/types';
import { IPC_CHANNELS } from '../../../src/common/constants';

describe('IW WP AI setup button contract', () => {
  it('IwConnectionStatus has wpEngineConnectorApproved field', () => {
    const s: IwConnectionStatus = {
      hubInstalled: true, connected: true, copyReset: false,
      clientId: 'c', projectId: 'p', accountId: 'a',
      wpEngineConnectorApproved: false,
    };
    expect(typeof s.wpEngineConnectorApproved).toBe('boolean');
  });

  it('SETUP_AI IPC channel exists', () => {
    expect(IPC_CHANNELS.SETUP_AI).toBe('nexus-ai:setup-ai');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
fnm exec --using=22.16.0 npx jest tests/unit/renderer/iw-setup-ai-button.test.ts --no-coverage
```

Expected: FAIL — `wpEngineConnectorApproved` not on `IwConnectionStatus`.

- [ ] **Step 3: Add `wpEngineConnectorApproved` to `IwConnectionStatus` in `src/common/types.ts`**

```typescript
/** True when 'wpengine' connector is approved in wpai_connector_approvals. */
wpEngineConnectorApproved: boolean;
```

- [ ] **Step 4: Update `STATUS_PHP` in `hub-connect.ts`**

Add to the PHP snippet (after the existing `copy_reset` line):
```php
$approvals = get_option('wpai_connector_approvals', array());
$wpe_ok = false;
foreach (array('ai/ai.php', 'wpe-hub/wpe-hub.php') as $c) {
  if (!empty($approvals[$c]['wpengine'])) { $wpe_ok = true; break; }
}
```
Add `'wpe_approved' => $wpe_ok ? '1' : ''` to the JSON object.

In `getConnectionStatus`, extract `raw.wpe_approved` and set:
```typescript
wpEngineConnectorApproved: Boolean(raw.wpe_approved),
```

Also update the non-hub-installed early return to include `wpEngineConnectorApproved: false`.

- [ ] **Step 5: Update `IW_GET_STATUS` IPC handler early-return in `ipc-handlers.ts`**

The early return (site not running) must also include `wpEngineConnectorApproved: false`.

- [ ] **Step 6: Add state, handler, and button to `NexusSiteTab.tsx`**

Add to `NexusSiteTabState`:
```typescript
iwAiSetupStatus: 'unknown' | 'setting_up' | 'done' | 'failed';
iwAiSetupError: string | null;
```

State initializer:
```typescript
iwAiSetupStatus: 'unknown',
iwAiSetupError: null,
```

Add `handleIwSetupAI` method (code above).

In `renderIwCard`, after the Disconnect button and before closing the button row:
```typescript
// Show "Setup WP AI" when connected but WP Engine connector not yet approved
connected && iwStatus && !iwStatus.wpEngineConnectorApproved
  ? React.createElement('button', {
      style: {
        fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
        border: 'none', background: '#0ECAD4', color: '#fff', fontFamily: 'inherit',
        opacity: iwAiSetupStatus === 'setting_up' ? 0.7 : 1,
      },
      disabled: iwAiSetupStatus === 'setting_up',
      onClick: this.handleIwSetupAI,
    }, iwAiSetupStatus === 'setting_up' ? 'Setting up…' : 'Setup WP AI')
  : connected && iwStatus?.wpEngineConnectorApproved
    ? React.createElement('span', { style: { fontSize: 11, color: UI_COLORS.STATUS_RUNNING } }, '✓ WP AI ready')
    : null,
iwAiSetupError ? React.createElement('div', {
  style: { marginTop: 4, fontSize: 11, color: UI_COLORS.STATUS_ERROR },
}, iwAiSetupError) : null,
```

- [ ] **Step 7: Run tests and compile**

```bash
fnm exec --using=22.16.0 npx jest tests/unit/renderer/iw-setup-ai-button.test.ts --no-coverage
fnm exec --using=22.16.0 npx tsc -p . --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add src/common/types.ts src/main/mcp/modules/iw/hub-connect.ts \
        src/main/ipc-handlers.ts src/renderer/components/NexusSiteTab.tsx \
        tests/unit/renderer/iw-setup-ai-button.test.ts
git commit -m "feat(iw): 'Setup WP AI' button in IW card — automates Hub steps 3+4

When Hub is connected but wpengine connector not yet approved, shows
'Setup WP AI' button. One click: installs WP AI plugin, enables experiments,
approves wpengine connector. No provider plugin install, no credential sync.

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: KB read/search MCP tools

**Files:**
- Create: `src/main/mcp/modules/iw/kb-tools.ts`
- Modify: `src/main/mcp/modules/iw/index.ts`
- Test: `tests/unit/mcp/iw-kb-tools.test.ts`

**Interfaces:**
- Consumes: `McpToolHandler`, `McpToolResult` from `../../types`; `resolveSite` from `../../site-resolver`; `ok`, `error` from `../wp-cli/preflight`; `readIwBinding` from `./hub-connect`; `getApiKey` from `../../../security/KeyVault`; `STORAGE_KEYS` from `../../../../common/constants`
- Produces: `iwListKbCollectionsHandler`, `iwGetKbCollectionHandler`, `iwSearchKbHandler` — exported, registered in `index.ts`

**Power KB API:**
- Base: `https://api.ai.wpengine.com/v1`
- Auth header: `Authorization: Bearer {wpe_key}` (from KeyVault, provider `'power'`)
- `GET /v1/kb/collections` — returns `{ collections: Array<{id, name, status, document_count}> }`
- `GET /v1/kb/collections/{id}` — returns collection details
- `POST /v1/kb/collections/{id}/search` — body: `{ query: string; top_k?: number }` — returns `{ results: Array<{id, score, content, metadata}> }`

**Project ID source:** `readIwBinding(siteId, registryStorage)?.projectId` — set from Hub connect.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/mcp/iw-kb-tools.test.ts`:

```typescript
import {
  iwListKbCollectionsHandler,
  iwGetKbCollectionHandler,
  iwSearchKbHandler,
} from '../../../src/main/mcp/modules/iw/kb-tools';

describe('IW KB MCP tool definitions', () => {
  it('iw_list_kb_collections — name and required fields', () => {
    expect(iwListKbCollectionsHandler.definition.name).toBe('iw_list_kb_collections');
    expect(iwListKbCollectionsHandler.definition.inputSchema.required).toContain('site');
  });

  it('iw_get_kb_collection — name and required fields', () => {
    expect(iwGetKbCollectionHandler.definition.name).toBe('iw_get_kb_collection');
    expect(iwGetKbCollectionHandler.definition.inputSchema.required).toContain('site');
    expect(iwGetKbCollectionHandler.definition.inputSchema.required).toContain('collection_id');
  });

  it('iw_search_kb — name and required fields', () => {
    expect(iwSearchKbHandler.definition.name).toBe('iw_search_kb');
    expect(iwSearchKbHandler.definition.inputSchema.required).toContain('site');
    expect(iwSearchKbHandler.definition.inputSchema.required).toContain('collection_id');
    expect(iwSearchKbHandler.definition.inputSchema.required).toContain('query');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
fnm exec --using=22.16.0 npx jest tests/unit/mcp/iw-kb-tools.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/mcp/modules/iw/kb-tools.ts`**

```typescript
import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error } from '../wp-cli/preflight';
import { readIwBinding } from './hub-connect';
import { getApiKey } from '../../../security/KeyVault';

const KB_BASE = 'https://api.ai.wpengine.com/v1';

async function kbFetch(path: string, apiKey: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(`${KB_BASE}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`KB API ${res.status}: ${body}`);
  }
  return res.json();
}

export const iwListKbCollectionsHandler: McpToolHandler = {
  definition: {
    name: 'iw_list_kb_collections',
    description:
      'List Knowledge Base collections for the Power project associated with a local site. ' +
      'Requires the site to have an active Hub Plugin connection (iw_get_connection_status). ' +
      'Nexus reads collections only — it does not create or sync them (Hub Plugin owns that).',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { registryStorage } = services;
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site not found: ${args.site}`);

    const binding = readIwBinding(site.id, registryStorage!);
    if (!binding?.projectId) return error(`No Hub connection found for ${site.name}. Run iw_connect_site first.`);

    const apiKey = getApiKey(registryStorage!, 'power') ?? '';
    if (!apiKey) return error('No Power API key configured. Add your wpe_ key in Nexus Preferences.');

    try {
      const data = await kbFetch(`/kb/collections?project_id=${encodeURIComponent(binding.projectId)}`, apiKey);
      const collections: any[] = data.collections ?? data.items ?? [];
      if (!collections.length) return ok(`No KB collections found for project ${binding.projectId}.`);

      const lines = [`KB Collections — ${site.name} (project: ${binding.projectId}):`];
      for (const c of collections) {
        lines.push(`  ${c.id}  ${c.name ?? ''}  [${c.status ?? 'unknown'}]  ${c.document_count ?? '?'} docs`);
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return error(`KB API error: ${String(err.message ?? err)}`);
    }
  },
};

export const iwGetKbCollectionHandler: McpToolHandler = {
  definition: {
    name: 'iw_get_kb_collection',
    description: 'Get details for a specific Knowledge Base collection.',
    inputSchema: {
      type: 'object',
      properties: {
        site:          { type: 'string', description: 'Local site name, ID, or domain' },
        collection_id: { type: 'string', description: 'KB collection ID' },
      },
      required: ['site', 'collection_id'],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { registryStorage } = services;
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site not found: ${args.site}`);

    const apiKey = getApiKey(registryStorage!, 'power') ?? '';
    if (!apiKey) return error('No Power API key configured.');

    try {
      const data = await kbFetch(`/kb/collections/${encodeURIComponent(args.collection_id as string)}`, apiKey);
      return ok(JSON.stringify(data, null, 2));
    } catch (err: any) {
      return error(`KB API error: ${String(err.message ?? err)}`);
    }
  },
};

export const iwSearchKbHandler: McpToolHandler = {
  definition: {
    name: 'iw_search_kb',
    description:
      'Search a Knowledge Base collection using semantic similarity. ' +
      'Returns ranked results with content excerpts and scores.',
    inputSchema: {
      type: 'object',
      properties: {
        site:          { type: 'string', description: 'Local site name, ID, or domain' },
        collection_id: { type: 'string', description: 'KB collection ID to search' },
        query:         { type: 'string', description: 'Search query' },
        top_k:         { type: 'number', description: 'Max results to return (default: 5)' },
      },
      required: ['site', 'collection_id', 'query'],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { registryStorage } = services;
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site not found: ${args.site}`);

    const apiKey = getApiKey(registryStorage!, 'power') ?? '';
    if (!apiKey) return error('No Power API key configured.');

    try {
      const body = { query: args.query, top_k: args.top_k ?? 5 };
      const data = await kbFetch(
        `/kb/collections/${encodeURIComponent(args.collection_id as string)}/search`,
        apiKey,
        { method: 'POST', body: JSON.stringify(body) },
      );
      const results: any[] = data.results ?? data.items ?? [];
      if (!results.length) return ok('No results found.');

      const lines = [`KB Search results for "${args.query}" in ${args.collection_id}:`];
      for (const r of results) {
        lines.push(`\n  Score: ${r.score?.toFixed(3) ?? '?'}`);
        if (r.content) lines.push(`  ${String(r.content).slice(0, 200).replace(/\n/g, ' ')}`);
        if (r.metadata?.url) lines.push(`  URL: ${r.metadata.url}`);
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return error(`KB API error: ${String(err.message ?? err)}`);
    }
  },
};
```

- [ ] **Step 4: Register in `src/main/mcp/modules/iw/index.ts`**

```typescript
import { iwListKbCollectionsHandler, iwGetKbCollectionHandler, iwSearchKbHandler } from './kb-tools';

// In registerIwTools():
registry.register(iwListKbCollectionsHandler);
registry.register(iwGetKbCollectionHandler);
registry.register(iwSearchKbHandler);
```

- [ ] **Step 5: Run tests and compile**

```bash
fnm exec --using=22.16.0 npx jest tests/unit/mcp/iw-kb-tools.test.ts --no-coverage
fnm exec --using=22.16.0 npx tsc -p . --noEmit
```

Expected: 3 tests pass, 0 compile errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/modules/iw/kb-tools.ts src/main/mcp/modules/iw/index.ts \
        tests/unit/mcp/iw-kb-tools.test.ts
git commit -m "feat(iw): KB read/search MCP tools — iw_list_kb_collections, iw_get_kb_collection, iw_search_kb

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fleet overlay MCP tool

**Files:**
- Create: `src/main/mcp/modules/iw/fleet-tools.ts`
- Modify: `src/main/mcp/modules/iw/index.ts`
- Test: `tests/unit/mcp/iw-fleet-tools.test.ts`

**Interfaces:**
- Consumes: `McpToolHandler`, `McpToolResult` from `../../types`; `ok` from `../wp-cli/preflight`; `readIwBinding` from `./hub-connect`; `STORAGE_KEYS` from `../../../../common/constants`; `SiteDataAccessor` from `../../types`
- Produces: `iwFleetStatusHandler` — lists all local sites with their IW connection status from stored bindings (no WP-CLI, no live API calls — reads from `IW_SITE_BINDINGS` storage)

- [ ] **Step 1: Write failing test**

Create `tests/unit/mcp/iw-fleet-tools.test.ts`:

```typescript
import { iwFleetStatusHandler } from '../../../src/main/mcp/modules/iw/fleet-tools';

describe('iw_fleet_status tool definition', () => {
  it('has correct name', () => {
    expect(iwFleetStatusHandler.definition.name).toBe('iw_fleet_status');
  });

  it('has no required fields — works across all sites', () => {
    expect(iwFleetStatusHandler.definition.inputSchema.required ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
fnm exec --using=22.16.0 npx jest tests/unit/mcp/iw-fleet-tools.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/mcp/modules/iw/fleet-tools.ts`**

```typescript
import { McpToolHandler, McpToolResult } from '../../types';
import { ok } from '../wp-cli/preflight';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { IwSiteBinding } from '../../../../common/types';

export const iwFleetStatusHandler: McpToolHandler = {
  definition: {
    name: 'iw_fleet_status',
    description:
      'Show IW connection status across all local sites — which sites are connected to ' +
      'a Power project, their project ID, and when they connected. Reads from stored ' +
      'bindings (no WP-CLI calls). Sites not yet connected are shown as Not connected.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    isAvailable: (services) => !!services.registryStorage,
  },

  async execute(_args, services): Promise<McpToolResult> {
    const { registryStorage, siteData } = services;
    const bindings = (registryStorage!.get(STORAGE_KEYS.IW_SITE_BINDINGS) ?? {}) as Record<string, IwSiteBinding>;
    const sites = Object.values(siteData.getSites());

    const lines: string[] = ['IW Fleet Status:'];
    let connectedCount = 0;

    for (const site of sites) {
      const binding = bindings[site.id];
      if (binding?.projectId) {
        connectedCount++;
        const connectedAt = new Date(binding.connectedAt).toISOString().split('T')[0];
        lines.push(`  ✓ ${site.name.padEnd(30)} ${binding.projectId}  (connected ${connectedAt})`);
      } else {
        lines.push(`  ○ ${site.name}`);
      }
    }

    lines.push(`\n${connectedCount}/${sites.length} sites connected to Power.`);
    return ok(lines.join('\n'));
  },
};
```

- [ ] **Step 4: Register in `index.ts`**

```typescript
import { iwFleetStatusHandler } from './fleet-tools';
// In registerIwTools():
registry.register(iwFleetStatusHandler);
```

- [ ] **Step 5: Run tests and compile**

```bash
fnm exec --using=22.16.0 npx jest tests/unit/mcp/iw-fleet-tools.test.ts --no-coverage
fnm exec --using=22.16.0 npx tsc -p . --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/modules/iw/fleet-tools.ts src/main/mcp/modules/iw/index.ts \
        tests/unit/mcp/iw-fleet-tools.test.ts
git commit -m "feat(iw): iw_fleet_status MCP tool — IW connection overlay across all local sites

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Sequencing

```
Task 1 (setup-ai power branch) — independent
Task 2 (Setup WP AI button) — depends on Task 1 (needs wpEngineConnectorApproved field + setup-ai power path)
Task 3 (KB tools) — independent of Tasks 1–2
Task 4 (fleet overlay) — independent of all others
```

Tasks 1 and 2 are sequential. Tasks 3 and 4 can be done in any order and in parallel with Tasks 1–2.
