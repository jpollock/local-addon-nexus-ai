# Security Sentinel Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fleet-wide security sentinel agent that detects active compromise and pre-breach exposure across all WPE installs, escalates autonomously through Tier 1 (graph query) → Tier 2 (Local sandbox investigation) → Tier 3 (human-confirmed remediation + push).

**Architecture:** The agent reads from `graph.db` via `fleet_sql` for Tier 1 (no SSH, no OAuth dependency). On Critical signals it creates an isolated Local sandbox via `local_create_site` + `local_wpe_pull` and runs filesystem checks via `wp_eval`. Tier 3 generates a remediation plan, reconciles against any existing local copy, and waits for human confirmation before `local_wpe_push`. A new `wpe:sync.completed` event is emitted from `WpeRefreshScheduler` to give the agent a real-time trigger when graph data is refreshed.

**Tech Stack:** Plain JS agent (no TypeScript — ts-node doesn't resolve in the Electron runtime), Jest for tests, existing Nexus Agent SDK tools.

## Global Constraints

- Agent file must be **plain JavaScript** (`agent.js`) — no `require('@nexus-ai/agent-sdk')`, use object literal (see `hello-nexus` pattern)
- Agent lives in repo under `agents/security-sentinel/agent.js`, installed to `~/Library/Application Support/Local/nexus-ai/agents/security-sentinel/`
- `fleet_sql` queries use the exact column names from the schema: `users.username`, `users.email`, `users.roles`, `sites.post_count`, `sites.settings_json`, `sites.ssh_last_sync_at`, `sites.environment`
- `tools.invoke(toolName, args)` — not `tools.call()`
- `ctx.ai.run(prompt)` — returns a string
- `ctx.state.get(key)` / `ctx.state.set(key, value)` — per-agent SQLite KV
- Sandbox site naming: `sentinel-{installName}-{timestamp}` where timestamp is `Date.now()`
- Signal severity levels: `'critical'` | `'high'` | `'medium'` | `'low'`
- Tests go in `tests/unit/agents/security-sentinel/sentinel.test.js`
- Run tests: `npx jest tests/unit/agents/security-sentinel/ --no-coverage`
- Build check: `npm run compile 2>&1 | head -5`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/main/startup/WpeRefreshScheduler.ts` | Modify | Add `agentEventBus?` option, collect `DISALLOW_FILE_EDIT`/`WP_DEBUG`, emit `wpe:sync.completed` |
| `src/main/index.ts` | Modify | Pass `agentEventBus` to `WpeRefreshScheduler` constructor |
| `agents/security-sentinel/agent.js` | Create | The agent — all logic in one file |
| `tests/unit/agents/security-sentinel/sentinel.test.js` | Create | Unit tests for all check functions |

---

### Task 1: `wpe:sync.completed` event + settings expansion

**Files:**
- Modify: `src/main/startup/WpeRefreshScheduler.ts`
- Modify: `src/main/index.ts` (line ~736)
- Test: `tests/unit/startup/WpeRefreshScheduler.test.ts` (existing, add one test)

**Interfaces:**
- Consumes: `AgentEventBus.publish(event: NexusEvent)` from `src/main/agent-event-bus/AgentEventBus.ts`
- Produces: `wpe:sync.completed` event with payload `{ installName: string; installId: string; siteId: string }`

- [ ] **Step 1: Add `agentEventBus?` to `WpeRefreshSchedulerOptions` and store it**

In `src/main/startup/WpeRefreshScheduler.ts`, add to the `WpeRefreshSchedulerOptions` interface and constructor:

```typescript
// Add to the import at top of file
import type { AgentEventBus } from '../agent-event-bus/AgentEventBus';

// Add to WpeRefreshSchedulerOptions interface (after logger):
  agentEventBus?: AgentEventBus;

// Add private field to class (after logger):
  private readonly agentEventBus?: AgentEventBus;

// Add to constructor body:
    this.agentEventBus = options.agentEventBus;
```

- [ ] **Step 2: Add `DISALLOW_FILE_EDIT` and `WP_DEBUG` to the settings collection**

In `refreshInstall()`, find the `wpSettingsMap` loop (around line 277). Add two more entries to the array:

```typescript
      ['DISALLOW_FILE_EDIT', 'DISALLOW_FILE_EDIT'],
      ['WP_DEBUG', 'WP_DEBUG'],
```

The full array becomes:
```typescript
    for (const [optionName, mapKey] of [
      ['blogname', 'blogname'], ['blogdescription', 'blogdescription'],
      ['blog_public', 'blog_public'], ['show_on_front', 'show_on_front'],
      ['posts_per_page', 'posts_per_page'], ['default_comment_status', 'default_comment_status'],
      ['permalink_structure', 'permalink_structure'], ['timezone_string', 'timezone_string'],
      ['users_can_register', 'users_can_register'], ['default_role', 'default_role'],
      ['WPLANG', 'WPLANG'],
      ['DISALLOW_FILE_EDIT', 'DISALLOW_FILE_EDIT'],
      ['WP_DEBUG', 'WP_DEBUG'],
    ] as [string, string][]) {
```

Note: `DISALLOW_FILE_EDIT` is a PHP constant, not a WP option. `wp option get` won't return it. Instead use `wp config get` via the WP-CLI bridge. Replace the two new entries in the loop with a separate call after the loop:

```typescript
    // Check wp-config constants (not options — need 'wp config get')
    const fileEditResult = await this.localServices
      .remoteWpCliRun(installName, ['config', 'get', 'DISALLOW_FILE_EDIT'])
      .catch(() => ({ success: false, stdout: null }));
    if (fileEditResult.success && fileEditResult.stdout?.trim()) {
      wpSettingsMap['DISALLOW_FILE_EDIT'] = fileEditResult.stdout.trim();
    }
    const wpDebugResult = await this.localServices
      .remoteWpCliRun(installName, ['config', 'get', 'WP_DEBUG'])
      .catch(() => ({ success: false, stdout: null }));
    if (wpDebugResult.success && wpDebugResult.stdout?.trim()) {
      wpSettingsMap['WP_DEBUG'] = wpDebugResult.stdout.trim();
    }
```

- [ ] **Step 3: Emit `wpe:sync.completed` after successful refresh**

In `runNow()`, after the `await this.refreshInstall(site.name, site.id)` call succeeds (at line ~243), add:

```typescript
        await this.refreshInstall(site.name, site.id);
        result.scanned++;
        // Notify agents that fresh graph data is available for this install
        this.agentEventBus?.publish({
          namespace: 'wpe',
          type:      'sync.completed',
          key:       'wpe:sync.completed',
          siteId:    site.id,
          payload:   { installName: site.name, installId: site.id, siteId: site.id },
          createdAt: Date.now(),
        });
```

- [ ] **Step 4: Wire `agentEventBus` in `main/index.ts`**

In `src/main/index.ts` around line 736, add `agentEventBus` to the constructor call:

```typescript
      wpeRefreshScheduler = new WpeRefreshScheduler({
        graphService,
        localServices: localServicesBridge,
        intervalMs: wpeRefreshHours * 60 * 60 * 1000,
        agentEventBus: agentEventBus,   // ADD THIS LINE
        getAccountFilter: () => {
          const s = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeAccountFilter?: string[] | null } | null;
          return s?.wpeAccountFilter ?? null;
        },
        logger: localLogger,
      });
```

- [ ] **Step 5: Build to verify no TypeScript errors**

```bash
npm run compile 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 6: Write a unit test**

In an existing or new test file `tests/unit/startup/WpeRefreshScheduler.test.ts`, add:

```typescript
it('emits wpe:sync.completed after a successful install refresh', async () => {
  const publishMock = jest.fn();
  const scheduler = new WpeRefreshScheduler({
    graphService: mockGraphService,
    localServices: mockLocalServices,
    agentEventBus: { publish: publishMock } as any,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  // trigger one refresh cycle (mock graph to return one site)
  await scheduler.runNow();
  expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
    key: 'wpe:sync.completed',
    namespace: 'wpe',
    type: 'sync.completed',
  }));
});
```

Run: `npx jest tests/unit/startup/ --no-coverage 2>&1 | tail -10`

- [ ] **Step 7: Commit**

```bash
git add src/main/startup/WpeRefreshScheduler.ts src/main/index.ts
git commit -m "feat(agent): emit wpe:sync.completed after each WPE install refresh; collect DISALLOW_FILE_EDIT and WP_DEBUG in settings sync"
```

---

### Task 2: Agent scaffold + fleet data collection

**Files:**
- Create: `agents/security-sentinel/agent.js`
- Create: `tests/unit/agents/security-sentinel/sentinel.test.js`

**Interfaces:**
- Produces: `module.exports` — agent definition object consumed by AgentRegistry
- Produces: `collectFleetData(tools, scopeInstallId?)` — returns array of install data objects

- [ ] **Step 1: Create the agents directory and scaffold**

```bash
mkdir -p agents/security-sentinel
```

Create `agents/security-sentinel/agent.js`:

```javascript
'use strict';

// ─── Signal schema ───────────────────────────────────────────────────────────
// severity: 'critical' | 'high' | 'medium' | 'low'
// category: 'active-compromise' | 'pre-breach' | 'misconfiguration'

// ─── Fleet data collection ────────────────────────────────────────────────────

async function collectFleetData(tools, scopeInstallId) {
  // Get all WPE installs (or just the one that triggered the event)
  const siteFilter = scopeInstallId
    ? `AND s.id = '${scopeInstallId}'`
    : '';

  const sitesResult = await tools.invoke('fleet_sql', {
    query: `
      SELECT s.id, s.name, s.environment, s.ssh_last_sync_at,
             s.post_count, s.user_count, s.settings_json,
             s.wp_version, s.php_version
      FROM sites s
      WHERE s.source = 'wpe'
      ${siteFilter}
      ORDER BY s.name
    `,
  });

  const rows = parseSqlResult(sitesResult);
  const installs = [];

  for (const site of rows) {
    // Handle unsynced installs — trigger a fresh sync first
    if (!site.ssh_last_sync_at) {
      try {
        await tools.invoke('wpe_site_deep_refresh', { install_name: site.name });
      } catch (err) {
        // Continue — the site may not be SSH-accessible; we'll flag it
      }
    }

    const pluginsResult = await tools.invoke('fleet_sql', {
      query: `SELECT slug, name, version, is_active FROM plugins WHERE site_id = '${site.id}'`,
    });
    const usersResult = await tools.invoke('fleet_sql', {
      query: `SELECT username, email, roles, created_at FROM users WHERE site_id = '${site.id}'`,
    });

    installs.push({
      id:              site.id,
      name:            site.name,
      environment:     site.environment,
      sshLastSyncAt:   site.ssh_last_sync_at,
      postCount:       Number(site.post_count) || 0,
      userCount:       Number(site.user_count) || 0,
      settings:        site.settings_json ? JSON.parse(site.settings_json) : {},
      wpVersion:       site.wp_version,
      phpVersion:      site.php_version,
      plugins:         parseSqlResult(pluginsResult),
      adminUsers:      parseSqlResult(usersResult).filter(u => {
        try { return JSON.parse(u.roles || '[]').includes('administrator'); } catch { return false; }
      }),
    });
  }

  return installs;
}

// Parses the markdown table output from fleet_sql into an array of objects
function parseSqlResult(result) {
  if (!result || typeof result !== 'string') return [];
  const lines = result.split('\n').filter(l => l.startsWith('|') && !l.startsWith('| ---'));
  if (lines.length < 2) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  return lines.slice(1).map(line => {
    const vals = line.split('|').map(v => v.trim()).filter(Boolean);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? null; });
    return obj;
  });
}

// ─── Scope determination ──────────────────────────────────────────────────────

function getScanScope(event) {
  if (!event) return { installId: null }; // cron = sweep all
  if (event.namespace === 'wpe' && event.type === 'sync.completed') {
    return { installId: event.payload?.siteId ?? null };
  }
  return { installId: null };
}

// ─── Agent definition ─────────────────────────────────────────────────────────

module.exports = {
  name: 'security-sentinel',
  version: '1.0.0',
  description: 'Fleet-wide security surveillance — detects compromise and pre-breach exposure across all WPE installs',
  triggers: [
    { type: 'cron', expression: '*/15 * * * *' },
    { type: 'event', pattern: 'wpe:sync.completed' },
    { type: 'event', pattern: 'wp:plugin.activated' },
    { type: 'event', pattern: 'wp:user.created' },
    { type: 'event', pattern: 'local:site.started' },
  ],
  tools: [
    'fleet_sql', 'wpe_site_deep_refresh', 'wp_user_list',
    'local_create_site', 'local_wpe_pull', 'local_wpe_push',
    'compare_sites', 'wp_plugin_list', 'wp_eval',
  ],

  async run({ event, tools, ai, log, state }) {
    const scope = getScanScope(event);
    log.info(`security-sentinel: starting sweep${scope.installId ? ` for install ${scope.installId}` : ' (fleet)'}`);

    const installs = await collectFleetData(tools, scope.installId);
    log.info(`security-sentinel: collected data for ${installs.length} install(s)`);

    // Tier 1, Tier 2, Tier 3 — added in Tasks 3–10
    for (const install of installs) {
      const signals = [];

      // Absolute checks (Tasks 3, 4)
      signals.push(...runAbsoluteChecks(install));
      signals.push(...runExposureChecks(install));

      // LLM-assisted user audit if admin signals present (Task 4)
      const adminSignals = signals.filter(s => s.id === 'ABS-01' || s.id === 'ABS-02');
      if (adminSignals.length > 0) {
        const audit = await llmUserAudit(install.adminUsers, ai);
        signals.push(...audit.signals);
      }

      // Relative checks — requires baseline (Task 6)
      const baseline = loadBaseline(install.id, state);
      signals.push(...runRelativeChecks(install, baseline));

      const criticalCount = signals.filter(s => s.severity === 'critical').length;
      const highCount     = signals.filter(s => s.severity === 'high').length;

      if (criticalCount >= 1 || highCount >= 2) {
        log.warn(`security-sentinel: escalating ${install.name} to Tier 2 (${criticalCount} critical, ${highCount} high)`);
        await tier2Investigate(install, signals, tools, ai, log);
      } else if (signals.length === 0) {
        storeBaseline(install, state);
        log.info(`security-sentinel: ${install.name} — clean`);
      }
    }

    // Fleet correlation (Task 7)
    // Added in Task 7

    log.info('security-sentinel: sweep complete');
  },
};

// Stubs — replaced in each task below
function runAbsoluteChecks(install) { return []; }
function runExposureChecks(install) { return []; }
async function llmUserAudit(adminUsers, ai) { return { signals: [] }; }
function loadBaseline(installId, state) { return null; }
function runRelativeChecks(install, baseline) { return []; }
function storeBaseline(install, state) {}
async function tier2Investigate(install, signals, tools, ai, log) {}
```

- [ ] **Step 2: Create the test file scaffold**

Create `tests/unit/agents/security-sentinel/sentinel.test.js`:

```javascript
'use strict';

const agent = require('../../../../agents/security-sentinel/agent');
const { parseSqlResult, collectFleetData, getScanScope } = agent; // will need to export helpers

// We'll add specific test blocks in each task
describe('security-sentinel', () => {
  it('has correct name and version', () => {
    expect(agent.name).toBe('security-sentinel');
    expect(agent.version).toBe('1.0.0');
  });

  it('has all required trigger types', () => {
    const types = agent.triggers.map(t => t.type);
    expect(types).toContain('cron');
    expect(types).toContain('event');
  });

  it('parseSqlResult handles empty input', () => {
    expect(agent._test.parseSqlResult('')).toEqual([]);
    expect(agent._test.parseSqlResult(null)).toEqual([]);
  });

  it('getScanScope returns installId for wpe:sync.completed event', () => {
    const event = { namespace: 'wpe', type: 'sync.completed', payload: { siteId: 'wpe-abc123' } };
    expect(agent._test.getScanScope(event)).toEqual({ installId: 'wpe-abc123' });
  });

  it('getScanScope returns null installId for cron (no event)', () => {
    expect(agent._test.getScanScope(null)).toEqual({ installId: null });
  });
});
```

Note: the agent needs to export `_test` for testability. Add to `module.exports`:

```javascript
  _test: { parseSqlResult, getScanScope },
```

- [ ] **Step 3: Run tests**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 4: Install the agent**

```bash
mkdir -p ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel
cp agents/security-sentinel/agent.js ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel/
./bin/nexus.js agent validate security-sentinel
```

Expected: `security-sentinel: agent.js (no TypeScript validation)` — that's correct for plain JS.

- [ ] **Step 5: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(agent): add security-sentinel scaffold with fleet data collection and scope determination"
```

---

### Task 3: Absolute checks — active compromise (ABS-01 to ABS-06)

**Files:**
- Modify: `agents/security-sentinel/agent.js`
- Modify: `tests/unit/agents/security-sentinel/sentinel.test.js`

**Interfaces:**
- Consumes: `install` object from `collectFleetData()`
- Produces: `runAbsoluteChecks(install)` → `Signal[]`

- [ ] **Step 1: Write failing tests first**

Add to `tests/unit/agents/security-sentinel/sentinel.test.js`:

```javascript
describe('runAbsoluteChecks', () => {
  const { runAbsoluteChecks } = require('../../../../agents/security-sentinel/agent')._test;

  const baseInstall = {
    id: 'wpe-test', name: 'testsite', environment: 'production',
    postCount: 16, adminUsers: [], plugins: [], settings: {},
  };

  it('ABS-01: flags admin username', () => {
    const install = { ...baseInstall, adminUsers: [{ username: 'admin', email: 'j@example.com', roles: '["administrator"]' }] };
    const signals = runAbsoluteChecks(install);
    expect(signals.find(s => s.id === 'ABS-01')).toBeDefined();
    expect(signals.find(s => s.id === 'ABS-01').severity).toBe('high');
  });

  it('ABS-01: does not flag non-admin username', () => {
    const install = { ...baseInstall, adminUsers: [{ username: 'jeremy', email: 'j@wpengine.com', roles: '["administrator"]' }] };
    expect(runAbsoluteChecks(install).find(s => s.id === 'ABS-01')).toBeUndefined();
  });

  it('ABS-02: flags admin count > 3 on small site', () => {
    const admins = ['a','b','c','d'].map(u => ({ username: u, email: `${u}@x.com`, roles: '["administrator"]' }));
    const install = { ...baseInstall, adminUsers: admins };
    const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-02');
    expect(signal).toBeDefined();
    expect(signal.severity).toBe('high');
  });

  it('ABS-02: does not flag 2 admins on small site', () => {
    const admins = ['a','b'].map(u => ({ username: u, email: `${u}@x.com`, roles: '["administrator"]' }));
    const install = { ...baseInstall, adminUsers: admins };
    expect(runAbsoluteChecks(install).find(s => s.id === 'ABS-02')).toBeUndefined();
  });

  it('ABS-03: flags @example.com email on admin', () => {
    const install = { ...baseInstall, adminUsers: [{ username: 'admin', email: 'admin@example.com', roles: '["administrator"]' }] };
    const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-03');
    expect(signal).toBeDefined();
    expect(signal.severity).toBe('critical');
  });

  it('ABS-04: flags active file manager plugin', () => {
    const install = { ...baseInstall, plugins: [{ slug: 'fileorganizer', is_active: '1' }] };
    const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-04');
    expect(signal).toBeDefined();
    expect(signal.severity).toBe('high');
  });

  it('ABS-04: does not flag inactive file manager', () => {
    const install = { ...baseInstall, plugins: [{ slug: 'fileorganizer', is_active: '0' }] };
    expect(runAbsoluteChecks(install).find(s => s.id === 'ABS-04')).toBeUndefined();
  });

  it('ABS-05: flags wp-compat slug', () => {
    const install = { ...baseInstall, plugins: [{ slug: 'wp-compat', is_active: '1' }] };
    const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-05');
    expect(signal).toBeDefined();
    expect(signal.severity).toBe('critical');
  });

  it('ABS-06: flags default auth salts', () => {
    const install = { ...baseInstall, settings: { AUTH_KEY: 'put your unique phrase here' } };
    const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-06');
    expect(signal).toBeDefined();
    expect(signal.severity).toBe('high');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | grep "FAIL\|● ABS" | head -20
```

Expected: tests fail with "runAbsoluteChecks is not a function" or similar.

- [ ] **Step 3: Implement `runAbsoluteChecks`**

Replace the stub `function runAbsoluteChecks(install) { return []; }` in `agent.js` with:

```javascript
const FILE_MANAGER_SLUGS = new Set([
  'fileorganizer', 'filester', 'file-manager-advanced',
  'wp-file-manager', 'wp-filemanager',
]);

const KNOWN_BACKDOOR_SLUGS = new Set(['wp-compat']);

function runAbsoluteChecks(install) {
  const signals = [];
  const { adminUsers, plugins, settings, postCount } = install;

  // ABS-01: 'admin' username
  if (adminUsers.some(u => u.username === 'admin')) {
    signals.push({
      id: 'ABS-01', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: "Default 'admin' username exists",
      detail: "An administrator account with username 'admin' was found. This is the most commonly brute-forced username.",
      fix: "Create a new administrator account with a unique username, reassign content, then delete the 'admin' account.",
    });
  }

  // ABS-02: Admin count > 3 on a small site (< 100 posts)
  if (adminUsers.length > 3 && postCount < 100) {
    signals.push({
      id: 'ABS-02', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `Excessive administrators (${adminUsers.length}) on a ${postCount}-post site`,
      detail: `${adminUsers.length} administrator accounts on a site with only ${postCount} posts is anomalous.`,
      fix: 'Audit each administrator account. Remove or demote accounts that should not have full access.',
    });
  }

  // ABS-03: @example.com email on admin
  if (adminUsers.some(u => u.email && u.email.toLowerCase().endsWith('@example.com'))) {
    const matched = adminUsers.filter(u => u.email && u.email.toLowerCase().endsWith('@example.com'));
    signals.push({
      id: 'ABS-03', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Admin account with @example.com email: ${matched.map(u => u.username).join(', ')}`,
      detail: "@example.com is the WordPress installer placeholder email. No legitimate admin retains it.",
      fix: 'This account was likely created by the WordPress installer or an attacker. Verify and delete if not legitimate.',
    });
  }

  // ABS-04: Active file manager plugins
  const activeFileManagers = plugins.filter(p => FILE_MANAGER_SLUGS.has(p.slug) && String(p.is_active) === '1');
  if (activeFileManagers.length > 0) {
    signals.push({
      id: 'ABS-04', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `File manager plugin(s) active: ${activeFileManagers.map(p => p.slug).join(', ')}`,
      detail: 'File manager plugins provide full filesystem write access from WP Admin. They are the primary mechanism for deploying webshells.',
      fix: 'Deactivate and delete these plugins unless actively required. Filesystem access should go through SFTP/SSH.',
    });
  }

  // ABS-05: Known backdoor plugin slugs
  const backdoors = plugins.filter(p => KNOWN_BACKDOOR_SLUGS.has(p.slug));
  if (backdoors.length > 0) {
    signals.push({
      id: 'ABS-05', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Known backdoor plugin detected: ${backdoors.map(p => p.slug).join(', ')}`,
      detail: `Plugin slug(s) match known malware from the June 2026 incident: ${backdoors.map(p => p.slug).join(', ')}`,
      fix: 'Delete immediately via SSH: wp plugin delete <slug>. Do not deactivate — delete.',
    });
  }

  // ABS-06: Default auth salts
  const settingsValues = Object.values(settings);
  if (settingsValues.some(v => typeof v === 'string' && v.includes('put your unique phrase here'))) {
    signals.push({
      id: 'ABS-06', severity: 'high', category: 'misconfiguration',
      installName: install.name,
      title: 'Default WordPress authentication salts in use',
      detail: "Auth salts still contain the placeholder 'put your unique phrase here'. Session cookies can be forged.",
      fix: 'Run: wp config shuffle-salts. All users will be logged out.',
    });
  }

  return signals;
}
```

Also add `runAbsoluteChecks` and all helpers to `_test` export:
```javascript
  _test: { parseSqlResult, getScanScope, runAbsoluteChecks },
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(agent): implement Tier 1 absolute checks ABS-01 through ABS-06"
```

---

### Task 4: LLM-assisted user audit + exposure checks (EXP)

**Files:**
- Modify: `agents/security-sentinel/agent.js`
- Modify: `tests/unit/agents/security-sentinel/sentinel.test.js`

**Interfaces:**
- Produces: `llmUserAudit(adminUsers, ai)` → `{ signals: Signal[] }`
- Produces: `runExposureChecks(install)` → `Signal[]`

- [ ] **Step 1: Write failing tests**

Add to the test file:

```javascript
describe('llmUserAudit', () => {
  const { llmUserAudit } = require('../../../../agents/security-sentinel/agent')._test;

  it('returns empty signals for clearly legitimate usernames', async () => {
    const fakeAi = { run: jest.fn().mockResolvedValue('These usernames all appear legitimate.') };
    const users = [{ username: 'jeremy', email: 'j@wpengine.com' }];
    const result = await llmUserAudit(users, fakeAi);
    expect(result.signals).toHaveLength(0);
  });

  it('returns a critical signal when LLM flags synthetic usernames', async () => {
    const fakeAi = { run: jest.fn().mockResolvedValue('SUSPICIOUS: admin_MT6ZqT appears programmatically generated; oxhuhafz is a random string.') };
    const users = [
      { username: 'admin_MT6ZqT', email: '' },
      { username: 'oxhuhafz', email: '' },
    ];
    const result = await llmUserAudit(users, fakeAi);
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.signals[0].severity).toBe('critical');
    expect(result.signals[0].id).toBe('LLM-USER-01');
  });

  it('calls ai.run with the username list', async () => {
    const fakeAi = { run: jest.fn().mockResolvedValue('Looks fine.') };
    const users = [{ username: 'testuser', email: 't@t.com' }];
    await llmUserAudit(users, fakeAi);
    expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('testuser'));
  });
});

describe('runExposureChecks', () => {
  const { runExposureChecks } = require('../../../../agents/security-sentinel/agent')._test;

  it('EXP-03: flags missing DISALLOW_FILE_EDIT on production', () => {
    const install = { name: 'test', environment: 'production', settings: { DISALLOW_FILE_EDIT: 'false' }, plugins: [] };
    const signal = runExposureChecks(install).find(s => s.id === 'EXP-03');
    expect(signal).toBeDefined();
    expect(signal.severity).toBe('medium');
  });

  it('EXP-03: does not flag when DISALLOW_FILE_EDIT is true', () => {
    const install = { name: 'test', environment: 'production', settings: { DISALLOW_FILE_EDIT: '1' }, plugins: [] };
    expect(runExposureChecks(install).find(s => s.id === 'EXP-03')).toBeUndefined();
  });

  it('EXP-05: flags WP_DEBUG true on production', () => {
    const install = { name: 'test', environment: 'production', settings: { WP_DEBUG: 'true' }, plugins: [] };
    const signal = runExposureChecks(install).find(s => s.id === 'EXP-05');
    expect(signal).toBeDefined();
    expect(signal.severity).toBe('medium');
  });

  it('EXP-05: does not flag on non-production environments', () => {
    const install = { name: 'test', environment: 'development', settings: { WP_DEBUG: 'true' }, plugins: [] };
    expect(runExposureChecks(install).find(s => s.id === 'EXP-05')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | grep "● " | head -10
```

- [ ] **Step 3: Implement `llmUserAudit`**

Replace the stub `async function llmUserAudit(adminUsers, ai)` with:

```javascript
async function llmUserAudit(adminUsers, ai) {
  if (!adminUsers || adminUsers.length === 0) return { signals: [] };

  const userList = adminUsers.map(u => `  - username: ${u.username}, email: ${u.email || '(none)'}`).join('\n');

  const response = await ai.run(`You are a WordPress security analyst. Examine these administrator usernames and identify any that appear to be attacker-created accounts.

Administrator accounts:
${userList}

Attacker-created accounts typically look like:
- Programmatically generated suffixes: admin_MT6ZqT, admin_ABC123
- Random strings: oxhuhafz, xkzpqrst
- Misspellings of system words: adminbockup (backup), adminsysem (system)
- Generic placeholders with no legitimate purpose

If you find suspicious usernames, start your response with "SUSPICIOUS:" followed by the usernames and why.
If all usernames appear legitimate, start with "CLEAN:".`);

  const suspicious = response.startsWith('SUSPICIOUS:');

  if (!suspicious) return { signals: [] };

  return {
    signals: [{
      id: 'LLM-USER-01',
      severity: 'critical',
      category: 'active-compromise',
      installName: adminUsers[0]?.installName ?? 'unknown',
      title: 'LLM identified synthetic/attacker-pattern administrator usernames',
      detail: response.slice('SUSPICIOUS:'.length).trim(),
      fix: 'Delete each flagged administrator account after verifying it is not legitimate: wp user delete <id> --reassign=<legitimate-admin-id>',
    }],
  };
}
```

- [ ] **Step 4: Implement `runExposureChecks`**

Replace the stub with:

```javascript
const KNOWN_SECURITY_PLUGINS = new Set([
  'wordfence', 'all-in-one-wp-security', 'ithemes-security',
  'better-wp-security', 'disable-xml-rpc', 'disable-json-api',
  'wpengine-security-auditor',
]);

function runExposureChecks(install) {
  const signals = [];
  const { settings, plugins, environment } = install;
  const isProduction = environment === 'production';

  if (!isProduction) return signals; // Exposure checks only matter on production

  // EXP-03: Theme/plugin editor enabled (DISALLOW_FILE_EDIT not set or false)
  const fileEditValue = settings['DISALLOW_FILE_EDIT'];
  const fileEditDisabled = fileEditValue === '1' || fileEditValue === 'true';
  if (!fileEditDisabled) {
    signals.push({
      id: 'EXP-03', severity: 'medium', category: 'pre-breach',
      installName: install.name,
      title: 'Theme and plugin file editor is enabled',
      detail: 'DISALLOW_FILE_EDIT is not set to true. A compromised admin account can inject PHP code directly from WP Admin.',
      fix: "Add `define('DISALLOW_FILE_EDIT', true);` to wp-config.php",
    });
  }

  // EXP-05: WP_DEBUG enabled on production
  const wpDebug = settings['WP_DEBUG'];
  if (wpDebug === 'true' || wpDebug === '1') {
    signals.push({
      id: 'EXP-05', severity: 'medium', category: 'pre-breach',
      installName: install.name,
      title: 'WP_DEBUG is enabled on production',
      detail: 'Debug mode exposes PHP errors, file paths, database queries, and internal architecture to page visitors.',
      fix: "Set `define('WP_DEBUG', false);` in wp-config.php",
    });
  }

  // EXP-01 heuristic: user enumeration likely enabled if no known protection
  const hasProtection = plugins.some(p => KNOWN_SECURITY_PLUGINS.has(p.slug) && String(p.is_active) === '1');
  if (!hasProtection) {
    signals.push({
      id: 'EXP-01', severity: 'high', category: 'pre-breach',
      installName: install.name,
      title: 'User enumeration likely enabled (no security plugin detected)',
      detail: 'No known security plugin is active. The REST API likely exposes usernames unauthenticated via /wp-json/wp/v2/users, enabling targeted brute-force attacks.',
      fix: 'Install a security plugin that blocks user enumeration, or add a filter to require authentication on the /users REST endpoint.',
    });
  }

  return signals;
}
```

Add both to `_test` export.

- [ ] **Step 5: Run tests**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(agent): add LLM-assisted user audit and exposure checks EXP-01, EXP-03, EXP-05"
```

---

### Task 5: Baseline management + relative checks (REL-01 to REL-05)

**Files:**
- Modify: `agents/security-sentinel/agent.js`
- Modify: `tests/unit/agents/security-sentinel/sentinel.test.js`

**Interfaces:**
- Produces: `loadBaseline(installId, state)` → `InstallBaseline | null`
- Produces: `storeBaseline(install, state)` → `void`
- Produces: `runRelativeChecks(install, baseline)` → `Signal[]`

```
InstallBaseline = {
  capturedAt: number,
  syncedAt: string | null,
  pluginSlugs: string[],         // sorted array of slug:version:active triples
  adminUserIds: string[],        // sorted array of usernames
  adminCount: number,
}
```

- [ ] **Step 1: Write failing tests**

```javascript
describe('baseline management', () => {
  const { loadBaseline, storeBaseline, runRelativeChecks } = require('../../../../agents/security-sentinel/agent')._test;

  const mockState = (() => {
    const store = {};
    return { get: k => store[k] ?? null, set: (k, v) => { store[k] = v; } };
  })();

  const install = {
    id: 'wpe-test', name: 'testsite',
    plugins: [{ slug: 'woocommerce', version: '8.0', is_active: '1' }],
    adminUsers: [{ username: 'jeremy' }],
    settings: {},
  };

  it('loadBaseline returns null when no baseline stored', () => {
    const freshState = { get: () => null, set: jest.fn() };
    expect(loadBaseline('wpe-test', freshState)).toBeNull();
  });

  it('storeBaseline then loadBaseline returns stored data', () => {
    storeBaseline(install, mockState);
    const baseline = loadBaseline(install.id, mockState);
    expect(baseline).not.toBeNull();
    expect(baseline.adminCount).toBe(1);
    expect(baseline.pluginSlugs).toContain('woocommerce:8.0:1');
  });

  it('REL-01: flags new plugin not in baseline', () => {
    const baseline = {
      capturedAt: Date.now() - 1000,
      pluginSlugs: ['woocommerce:8.0:1'],
      adminUserIds: ['jeremy'],
      adminCount: 1,
    };
    const installWithNew = { ...install, plugins: [
      { slug: 'woocommerce', version: '8.0', is_active: '1' },
      { slug: 'evil-plugin', version: '1.0', is_active: '1' },
    ]};
    const signals = runRelativeChecks(installWithNew, baseline);
    expect(signals.find(s => s.id === 'REL-01')).toBeDefined();
  });

  it('REL-03: flags new admin user not in baseline', () => {
    const baseline = { capturedAt: Date.now() - 1000, pluginSlugs: [], adminUserIds: ['jeremy'], adminCount: 1 };
    const installWithNew = { ...install, adminUsers: [{ username: 'jeremy' }, { username: 'hacker' }] };
    const signals = runRelativeChecks(installWithNew, baseline);
    const signal = signals.find(s => s.id === 'REL-03');
    expect(signal).toBeDefined();
    expect(signal.severity).toBe('critical');
    expect(signal.detail).toContain('hacker');
  });

  it('runRelativeChecks returns empty array when no baseline', () => {
    expect(runRelativeChecks(install, null)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement baseline functions**

Replace the stubs in `agent.js`:

```javascript
function storeBaseline(install, state) {
  const baseline = {
    capturedAt: Date.now(),
    syncedAt:   install.sshLastSyncAt ?? null,
    pluginSlugs: install.plugins
      .map(p => `${p.slug}:${p.version || ''}:${p.is_active}`)
      .sort(),
    adminUserIds: install.adminUsers.map(u => u.username).sort(),
    adminCount: install.adminUsers.length,
  };
  state.set(`baseline:${install.id}`, baseline);
}

function loadBaseline(installId, state) {
  return state.get(`baseline:${installId}`) ?? null;
}

function runRelativeChecks(install, baseline) {
  if (!baseline) return []; // Cold start — suppress all relative checks

  const signals = [];
  const currentSlugs = new Set(install.plugins.map(p => `${p.slug}:${p.version || ''}:${p.is_active}`));
  const baselineSlugs = new Set(baseline.pluginSlugs);

  // REL-01: New plugin appeared
  const newPlugins = install.plugins.filter(p =>
    !baselineSlugs.has(`${p.slug}:${p.version || ''}:${p.is_active}`) &&
    !baseline.pluginSlugs.some(s => s.startsWith(`${p.slug}:`))
  );
  if (newPlugins.length > 0) {
    signals.push({
      id: 'REL-01', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `New plugin(s) appeared since last scan: ${newPlugins.map(p => p.slug).join(', ')}`,
      detail: `These plugins were not present in the last clean baseline: ${newPlugins.map(p => `${p.slug} v${p.version}`).join(', ')}`,
      fix: 'Verify each new plugin was intentionally installed. If not, delete immediately.',
    });
  }

  // REL-02: Previously-inactive plugin activated
  const nowActive = install.plugins.filter(p => {
    const baselineEntry = baseline.pluginSlugs.find(s => s.startsWith(`${p.slug}:`));
    if (!baselineEntry) return false;
    const wasActive = baselineEntry.split(':')[2] === '1';
    return !wasActive && String(p.is_active) === '1';
  });
  if (nowActive.length > 0) {
    signals.push({
      id: 'REL-02', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `Plugin(s) activated since last scan: ${nowActive.map(p => p.slug).join(', ')}`,
      detail: `These plugins were installed but inactive in the baseline and are now active: ${nowActive.map(p => p.slug).join(', ')}`,
      fix: 'Verify the plugin activation was intentional.',
    });
  }

  // REL-03: New admin user
  const currentUsernames = new Set(install.adminUsers.map(u => u.username));
  const baselineUsernames = new Set(baseline.adminUserIds);
  const newAdmins = install.adminUsers.filter(u => !baselineUsernames.has(u.username));
  if (newAdmins.length > 0) {
    signals.push({
      id: 'REL-03', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `New administrator account(s) created since last scan: ${newAdmins.map(u => u.username).join(', ')}`,
      detail: `New admin users: ${newAdmins.map(u => `${u.username} (${u.email || 'no email'})`).join(', ')}`,
      fix: 'Delete each unauthorized admin account: wp user delete <id> --reassign=<legitimate-id>',
    });
  }

  // REL-04: Admin count increased
  if (install.adminUsers.length > baseline.adminCount) {
    // Only add if not already covered by REL-03
    if (newAdmins.length === 0) {
      signals.push({
        id: 'REL-04', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Admin count increased from ${baseline.adminCount} to ${install.adminUsers.length}`,
        detail: 'Administrator count increased but new accounts may be hidden from WordPress Users screen.',
        fix: 'Check for hidden admin accounts by querying the database directly.',
      });
    }
  }

  return signals;
}
```

Add to `_test` export: `loadBaseline, storeBaseline, runRelativeChecks`.

- [ ] **Step 3: Run tests**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(agent): add baseline management and relative checks REL-01 through REL-04"
```

---

### Task 6: Fleet correlation

**Files:**
- Modify: `agents/security-sentinel/agent.js`
- Modify: `tests/unit/agents/security-sentinel/sentinel.test.js`

**Interfaces:**
- Produces: `runFleetCorrelation(allResults)` → `Signal[]`
  - `allResults` = `Array<{ install, signals: Signal[] }>`

- [ ] **Step 1: Write failing tests**

```javascript
describe('runFleetCorrelation', () => {
  const { runFleetCorrelation } = require('../../../../agents/security-sentinel/agent')._test;

  it('flags same unknown plugin slug across 2+ installs in same account', () => {
    const results = [
      { install: { id: 'wpe-1', name: 'site1', plugins: [{ slug: 'wp-compat', is_active: '1' }] }, signals: [] },
      { install: { id: 'wpe-2', name: 'site2', plugins: [{ slug: 'wp-compat', is_active: '1' }] }, signals: [] },
    ];
    const signals = runFleetCorrelation(results, new Set(['wp-compat']));
    expect(signals.find(s => s.id === 'FLEET-01')).toBeDefined();
    expect(signals.find(s => s.id === 'FLEET-01').severity).toBe('critical');
  });

  it('does not flag common legitimate plugins appearing on multiple installs', () => {
    const results = [
      { install: { id: 'wpe-1', name: 'site1', plugins: [{ slug: 'woocommerce', is_active: '1' }] }, signals: [] },
      { install: { id: 'wpe-2', name: 'site2', plugins: [{ slug: 'woocommerce', is_active: '1' }] }, signals: [] },
    ];
    expect(runFleetCorrelation(results, new Set())).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement `runFleetCorrelation`**

```javascript
// Slugs seen in ABS-05 findings across this sweep — passed from the main run loop
function runFleetCorrelation(allResults, suspiciousSlugsFound) {
  const signals = [];

  // FLEET-01: Same suspicious plugin slug on 2+ installs
  const slugToInstalls = {};
  for (const { install } of allResults) {
    for (const plugin of install.plugins) {
      if (suspiciousSlugsFound.has(plugin.slug) || plugin.slug === 'wp-compat') {
        if (!slugToInstalls[plugin.slug]) slugToInstalls[plugin.slug] = [];
        slugToInstalls[plugin.slug].push(install.name);
      }
    }
  }
  for (const [slug, installNames] of Object.entries(slugToInstalls)) {
    if (installNames.length >= 2) {
      signals.push({
        id: 'FLEET-01', severity: 'critical', category: 'active-compromise',
        installName: installNames.join(', '),
        title: `Suspicious plugin '${slug}' found on ${installNames.length} installs`,
        detail: `Same suspicious plugin slug '${slug}' on: ${installNames.join(', ')}. This suggests account-level compromise or a shared attack vector.`,
        fix: 'This is likely a coordinated attack. Audit all listed installs immediately and check WPE portal for unauthorized SSH key additions.',
      });
    }
  }

  // FLEET-02: New admin accounts with matching email domains across installs
  const emailDomainToInstalls = {};
  for (const { install, signals: instSignals } of allResults) {
    const newAdminSignal = instSignals.find(s => s.id === 'REL-03');
    if (!newAdminSignal) continue;
    for (const user of install.adminUsers) {
      const domain = (user.email || '').split('@')[1];
      if (!domain || domain === 'example.com') continue;
      if (!emailDomainToInstalls[domain]) emailDomainToInstalls[domain] = [];
      emailDomainToInstalls[domain].push(install.name);
    }
  }
  for (const [domain, installNames] of Object.entries(emailDomainToInstalls)) {
    if (installNames.length >= 2) {
      signals.push({
        id: 'FLEET-02', severity: 'critical', category: 'active-compromise',
        installName: installNames.join(', '),
        title: `New admin accounts with same email domain @${domain} across ${installNames.length} installs`,
        detail: `Matching email domain @${domain} on new admin accounts across: ${installNames.join(', ')}`,
        fix: 'Account-level compromise suspected. Audit portal access and SSH keys immediately.',
      });
    }
  }

  return signals;
}
```

Update the main `run()` function to collect suspicious slugs and call fleet correlation:

```javascript
    // After the per-install loop, add:
    const suspiciousSlugsFound = new Set(
      allInstallResults
        .flatMap(r => r.signals)
        .filter(s => s.id === 'ABS-05')
        .map(s => s.title.match(/'([^']+)'/)?.[1])
        .filter(Boolean)
    );
    const fleetSignals = runFleetCorrelation(allInstallResults, suspiciousSlugsFound);
    if (fleetSignals.length > 0) {
      log.warn(`security-sentinel: fleet correlation found ${fleetSignals.length} cross-site signal(s)`);
      fleetSignals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.title}`));
    }
```

Also store `allInstallResults` as each install's `{ install, signals }` in the loop.

Add `runFleetCorrelation` to `_test` export.

- [ ] **Step 3: Run tests**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(agent): add fleet correlation for cross-site plugin and admin email patterns"
```

---

### Task 7: Tier 2 — sandbox creation + filesystem checks

**Files:**
- Modify: `agents/security-sentinel/agent.js`
- Modify: `tests/unit/agents/security-sentinel/sentinel.test.js`

**Interfaces:**
- Produces: `tier2Investigate(install, signals, tools, ai, log)` → `{ filesystemSignals: Signal[], adminMismatch: boolean }`

- [ ] **Step 1: Write failing tests**

```javascript
describe('tier2Investigate', () => {
  const { tier2Investigate } = require('../../../../agents/security-sentinel/agent')._test;

  it('creates a sandbox site with correct naming pattern', async () => {
    const createSiteMock = jest.fn().mockResolvedValue('OK');
    const pullMock = jest.fn().mockResolvedValue('OK');
    const evalMock = jest.fn().mockResolvedValue('[]');
    const tools = {
      invoke: jest.fn().mockImplementation((name, args) => {
        if (name === 'local_create_site') return createSiteMock(args);
        if (name === 'local_wpe_pull') return pullMock(args);
        if (name === 'wp_eval') return evalMock(args);
        return Promise.resolve('');
      }),
    };
    const install = { id: 'wpe-94b2', name: 'theawfulpmtest' };

    await tier2Investigate(install, [], tools, { run: jest.fn().mockResolvedValue('CLEAN') }, { info: jest.fn(), warn: jest.fn() });

    expect(createSiteMock).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringMatching(/^sentinel-theawfulpmtest-\d+$/),
    }));
    expect(pullMock).toHaveBeenCalledWith(expect.objectContaining({
      remote_install_id: 'wpe-94b2',
      include_database: true,
    }));
  });
});
```

- [ ] **Step 2: Implement `tier2Investigate`**

Replace the stub `async function tier2Investigate(...)` with:

```javascript
async function tier2Investigate(install, tier1Signals, tools, ai, log) {
  const sandboxName = `sentinel-${install.name}-${Date.now()}`;
  log.info(`[Tier 2] Creating sandbox: ${sandboxName}`);

  // Create isolated sandbox — uses remote_install_id, NOT a formal link
  await tools.invoke('local_create_site', { name: sandboxName });
  await tools.invoke('local_wpe_pull', {
    site:              sandboxName,
    remote_install_id: install.id,
    include_database:  true,
  });

  log.info(`[Tier 2] Sandbox ready. Running filesystem checks...`);

  // Filesystem checks via wp_eval (runs inside Local sandbox, not live site)
  const fsSignals = [];

  // FS-01: PHP files in mu-plugins/
  const muPluginResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `
      $dir = WPMU_PLUGIN_DIR;
      $files = glob("$dir/*.php") ?: [];
      $unexpected = array_filter($files, function($f) {
        $basename = basename($f);
        // WPE managed mu-plugins are expected
        $known = ['wpe-wp-sign-on-plugin.php','wpe-cache-plugin.php',
                  'wpengine-security-auditor.php','mu-plugin.php',
                  'slt-force-strong-passwords.php','wpe-update-source-selector.php',
                  'nexus-ai-connector-config.php','site-compat-layer.php'];
        return !in_array($basename, $known);
      });
      return json_encode(array_values($unexpected));
    `,
  });
  try {
    const muFiles = JSON.parse(muPluginResult || '[]');
    if (muFiles.length > 0) {
      fsSignals.push({
        id: 'FS-01', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `PHP file(s) in mu-plugins/: ${muFiles.map(f => f.split('/').pop()).join(', ')}`,
        detail: `Unexpected PHP files in mu-plugins/ load on every request and cannot be deactivated: ${muFiles.join(', ')}`,
        fix: `Remove via SSH: rm ${muFiles.join(' ')}`,
      });
    }
  } catch {}

  // FS-02: Obfuscation chains
  const obfuscationResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `
      $dirs = [WP_CONTENT_DIR . '/plugins', WP_CONTENT_DIR . '/mu-plugins', WP_CONTENT_DIR . '/themes'];
      $patterns = [
        '/eval\\s*\\(\\s*base64_decode/',
        '/eval\\s*\\(\\s*gzinflate\\s*\\(\\s*base64_decode/',
        '/eval\\s*\\(\\s*str_rot13/',
        '/base64_decode.*base64_decode/',
      ];
      $found = [];
      foreach ($dirs as $dir) {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
          if ($file->getExtension() !== 'php') continue;
          $content = file_get_contents($file->getPathname());
          foreach ($patterns as $pattern) {
            if (preg_match($pattern, $content)) {
              $found[] = $file->getPathname();
              break;
            }
          }
        }
      }
      return json_encode(array_unique($found));
    `,
  });
  try {
    const obfFiles = JSON.parse(obfuscationResult || '[]');
    if (obfFiles.length > 0) {
      fsSignals.push({
        id: 'FS-02', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Obfuscated code (eval+base64/gzinflate/rot13) found in ${obfFiles.length} file(s)`,
        detail: `Files containing obfuscation chains: ${obfFiles.join(', ')}`,
        fix: 'Investigate each file. These patterns hide malicious payloads. Compare with original plugin/theme source.',
      });
    }
  } catch {}

  // FS-04: PHP files in uploads/
  const uploadsResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `
      $uploads = wp_upload_dir();
      $dir = $uploads['basedir'];
      $phpFiles = [];
      foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
        if ($file->getExtension() === 'php') $phpFiles[] = $file->getPathname();
      }
      return json_encode($phpFiles);
    `,
  });
  try {
    const phpUploads = JSON.parse(uploadsResult || '[]');
    if (phpUploads.length > 0) {
      fsSignals.push({
        id: 'FS-04', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `PHP file(s) found in uploads/: ${phpUploads.map(f => f.split('/').pop()).join(', ')}`,
        detail: `PHP files in uploads/ can be executed by visiting their URL directly: ${phpUploads.join(', ')}`,
        fix: 'Delete all PHP files from uploads/. Add .htaccess rule to deny PHP execution in uploads.',
      });
    }
  } catch {}

  // Admin count mismatch (DB direct vs WP API — bypasses wp-compat style hooks)
  const dbCountResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `
      global $wpdb;
      $count = $wpdb->get_var("SELECT COUNT(DISTINCT u.ID) FROM {$wpdb->users} u JOIN {$wpdb->usermeta} m ON u.ID = m.user_id WHERE m.meta_key = 'wp_capabilities' AND m.meta_value LIKE '%administrator%'");
      $wpCount = count(get_users(['role' => 'administrator']));
      return json_encode(['db' => (int)$count, 'wp' => (int)$wpCount]);
    `,
  });
  let adminMismatch = false;
  try {
    const counts = JSON.parse(dbCountResult || '{}');
    if (counts.db && counts.wp && counts.db !== counts.wp) {
      adminMismatch = true;
      fsSignals.push({
        id: 'FS-MISMATCH', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Admin count mismatch: ${counts.db} in DB vs ${counts.wp} visible via WordPress`,
        detail: `Direct DB query found ${counts.db} admins but WordPress reports ${counts.wp}. A plugin is hiding ${counts.db - counts.wp} account(s).`,
        fix: "The wp-compat backdoor plugin hooks WordPress to hide accounts. Delete wp-compat first, then audit all admin accounts.",
      });
    }
  } catch {}

  log.info(`[Tier 2] Filesystem scan complete: ${fsSignals.length} finding(s)`);

  // LLM synthesis (Task 8) — runs after filesystem checks
  await llmSynthesis(install, tier1Signals, fsSignals, tools, ai, log, sandboxName);

  return { filesystemSignals: fsSignals, adminMismatch, sandboxName };
}
```

- [ ] **Step 3: Run tests**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(agent): implement Tier 2 sandbox creation and filesystem checks FS-01/02/04 + admin count mismatch"
```

---

### Task 8: Tier 2 LLM synthesis + Tier 3 remediation

**Files:**
- Modify: `agents/security-sentinel/agent.js`
- Modify: `tests/unit/agents/security-sentinel/sentinel.test.js`

**Interfaces:**
- Produces: `llmSynthesis(install, tier1Signals, fsSignals, tools, ai, log, sandboxName)` → `void` (logs classified result, triggers Tier 3)
- Produces: `tier3Remediate(install, synthesis, sandboxName, tools, log)` → `void`

- [ ] **Step 1: Write failing tests**

```javascript
describe('llmSynthesis', () => {
  const { llmSynthesis } = require('../../../../agents/security-sentinel/agent')._test;

  it('calls ai.run with all signals and site metadata', async () => {
    const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: active-compromise\nREMEDIATION: delete wp-compat') };
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const tools = { invoke: jest.fn().mockResolvedValue('') };
    const install = { id: 'wpe-1', name: 'testsite', postCount: 16, environment: 'production', adminUsers: [] };

    await llmSynthesis(install, [{ id: 'ABS-05', title: 'wp-compat found' }], [], tools, fakeAi, log, 'sentinel-testsite-123');

    expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('wp-compat found'));
    expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('testsite'));
  });
});
```

- [ ] **Step 2: Implement `llmSynthesis` and `tier3Remediate`**

Add to `agent.js`:

```javascript
async function llmSynthesis(install, tier1Signals, fsSignals, tools, ai, log, sandboxName) {
  const allSignals = [...tier1Signals, ...fsSignals];

  const prompt = `You are a WordPress security analyst completing an investigation of a WP Engine production site.

Site: ${install.name} (${install.environment}, ${install.postCount} posts)
Sandbox for investigation: ${sandboxName}

Security signals found:
${allSignals.map(s => `[${s.severity.toUpperCase()}] ${s.id}: ${s.title}`).join('\n')}

Signal details:
${allSignals.map(s => `${s.id}: ${s.detail}`).join('\n\n')}

Based on these signals:
1. Classify the situation: active-compromise | high-risk | misconfiguration | false-positive
2. List the top 3 immediate remediation steps in priority order, with exact WP-CLI commands
3. Identify anything that should be checked next that was not covered above
4. Recommend whether to escalate to Tier 3 (fix + push) or monitor only

Format:
CLASSIFICATION: <one of the four values>
IMMEDIATE ACTIONS:
1. <action>
2. <action>
3. <action>
NEXT CHECKS: <what to verify next>
TIER3: yes | no`;

  const synthesis = await ai.run(prompt);
  log.warn(`[Tier 2 Synthesis] ${install.name}:\n${synthesis}`);

  const shouldEscalateToTier3 = synthesis.includes('TIER3: yes') ||
    allSignals.some(s => s.severity === 'critical');

  if (shouldEscalateToTier3) {
    log.warn(`[Tier 3] Preparing remediation plan for ${install.name}`);
    await tier3Remediate(install, synthesis, allSignals, sandboxName, tools, log);
  }
}

async function tier3Remediate(install, synthesis, allSignals, sandboxName, tools, log) {
  // Step 1: Apply remediations in sandbox
  const maliciousPlugins = allSignals
    .filter(s => ['ABS-04', 'ABS-05', 'REL-01'].includes(s.id))
    .flatMap(s => {
      const match = s.title.match(/plugin[^:]*:\s*(.+)/i);
      return match ? match[1].split(',').map(p => p.trim()) : [];
    });

  if (maliciousPlugins.length > 0) {
    log.warn(`[Tier 3] Quarantining plugins: ${maliciousPlugins.join(', ')}`);
    await tools.invoke('wp_eval', {
      site: sandboxName,
      code: `
        $quarantine = WP_CONTENT_DIR . '/quarantine/' . date('Y-m-d-His');
        wp_mkdir_p($quarantine);
        $plugins = ${JSON.stringify(maliciousPlugins)};
        $moved = [];
        foreach ($plugins as $slug) {
          $src = WP_PLUGIN_DIR . '/' . $slug;
          if (is_dir($src)) {
            rename($src, $quarantine . '/' . $slug);
            $moved[] = $slug;
          }
        }
        return json_encode($moved);
      `,
    });
  }

  // Step 2: Delete backdoor admin accounts
  const backdoorSignals = allSignals.filter(s => ['REL-03', 'ABS-03', 'LLM-USER-01'].includes(s.id));
  if (backdoorSignals.length > 0) {
    log.warn(`[Tier 3] Flagged suspicious admin accounts — manual review required before deletion`);
    log.warn(`  Run on sandbox: wp user list --role=administrator`);
  }

  // Step 3: Shuffle salts
  await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `return shell_exec('wp config shuffle-salts 2>&1');`,
  }).catch(() => {});

  // Step 4: Apply hardening
  await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `
      // Disable file editor
      $config = file_get_contents(ABSPATH . 'wp-config.php');
      if (strpos($config, 'DISALLOW_FILE_EDIT') === false) {
        $config = str_replace("/* That's all", "define('DISALLOW_FILE_EDIT', true);\n/* That's all", $config);
        file_put_contents(ABSPATH . 'wp-config.php', $config);
      }
      return 'hardening applied';
    `,
  }).catch(() => {});

  // Step 5: Reconciliation — check for existing local copy before push
  log.warn(`[Tier 3] Remediation prepared in sandbox: ${sandboxName}`);
  log.warn(`[Tier 3] MANUAL STEP REQUIRED:`);
  log.warn(`  1. Review sandbox: ${sandboxName}`);
  log.warn(`  2. Check reconciliation: nexus agent run security-sentinel-reconcile`);
  log.warn(`  3. If clean, push: nexus agent run security-sentinel-push`);
  log.warn(`  Synthesis:\n${synthesis}`);

  // Note: the actual local_wpe_push requires human confirmation — logged above
  // A future Tier 3 interactive flow will present this through the Nexus UI
}
```

- [ ] **Step 3: Run tests**

```bash
npx jest tests/unit/agents/security-sentinel/ --no-coverage 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(agent): add Tier 2 LLM synthesis and Tier 3 remediation preparation with quarantine + hardening"
```

---

### Task 9: Agent integration + install + demo against `theawfulpmtest`

**Files:**
- Modify: `agents/security-sentinel/agent.js` (wire everything into `run()`)
- No new test file — this is the end-to-end verification

**Interfaces:**
- Consumes: all functions from Tasks 2–8
- Produces: working agent that detects `theawfulpmtest` compromised state

- [ ] **Step 1: Finalize the `run()` function**

Replace the `run()` body in the agent definition with the complete wired version:

```javascript
  async run({ event, tools, ai, log, state }) {
    const scope = getScanScope(event);
    log.info(`security-sentinel: starting sweep${scope.installId ? ` for ${scope.installId}` : ' (fleet-wide)'}`);

    const installs = await collectFleetData(tools, scope.installId);
    log.info(`security-sentinel: ${installs.length} install(s) to check`);

    const allInstallResults = [];

    for (const install of installs) {
      const signals = [];

      // Tier 1: Absolute checks
      signals.push(...runAbsoluteChecks(install));
      signals.push(...runExposureChecks(install));

      // Phase 1.5: LLM user audit if admin signals present
      if (signals.some(s => s.id === 'ABS-01' || s.id === 'ABS-02')) {
        const audit = await llmUserAudit(install.adminUsers, ai);
        signals.push(...audit.signals);
      }

      // Relative checks
      const baseline = loadBaseline(install.id, state);
      signals.push(...runRelativeChecks(install, baseline));

      allInstallResults.push({ install, signals });

      const criticalCount = signals.filter(s => s.severity === 'critical').length;
      const highCount = signals.filter(s => s.severity === 'high').length;

      if (signals.length === 0) {
        storeBaseline(install, state);
        log.info(`security-sentinel: ${install.name} — ✓ clean`);
      } else if (criticalCount >= 1 || highCount >= 2) {
        log.warn(`security-sentinel: ${install.name} — ESCALATING to Tier 2 (${criticalCount} critical, ${highCount} high)`);
        signals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.id}: ${s.title}`));
        await tier2Investigate(install, signals, tools, ai, log);
      } else {
        log.warn(`security-sentinel: ${install.name} — ${signals.length} finding(s):`);
        signals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.id}: ${s.title}`));
      }
    }

    // Fleet correlation
    const suspiciousSlugs = new Set(
      allInstallResults.flatMap(r => r.signals)
        .filter(s => s.id === 'ABS-05')
        .map(s => { const m = s.title.match(/'([^']+)'/); return m ? m[1] : null; })
        .filter(Boolean)
    );
    const fleetSignals = runFleetCorrelation(allInstallResults, suspiciousSlugs);
    if (fleetSignals.length > 0) {
      log.warn(`security-sentinel: FLEET CORRELATION — ${fleetSignals.length} cross-site signal(s):`);
      fleetSignals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.id}: ${s.title}`));
    }

    log.info('security-sentinel: sweep complete');
  },
```

- [ ] **Step 2: Install the updated agent**

```bash
cp agents/security-sentinel/agent.js ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel/agent.js
```

- [ ] **Step 3: Reload and verify registration**

```bash
./bin/nexus.js agent list
```

Expected: `security-sentinel v1.0.0 [cron, event, event, event, event]` — registered.

- [ ] **Step 4: Run against the demo fleet**

Run manually to trigger a sweep of all installs (takes a few minutes due to graph queries):

```bash
./bin/nexus.js agent run security-sentinel
```

Monitor logs:

```bash
./bin/nexus.js agent logs security-sentinel --follow
```

Expected output for `theawfulpmtest`:
```
[WARN] security-sentinel: theawfulpmtest — ESCALATING to Tier 2 (2 critical, 2 high)
[WARN]   [CRITICAL] ABS-05: Known backdoor plugin detected: wp-compat
[WARN]   [HIGH] ABS-04: File manager plugin(s) active: fileorganizer, filester
[WARN]   [HIGH] ABS-02: Excessive administrators (5) on a 16-post site
[WARN]   [CRITICAL] ABS-03: Admin account with @example.com email: admin
[WARN] [Tier 2] Creating sandbox: sentinel-theawfulpmtest-{ts}
```

- [ ] **Step 5: Confirm clean sites short-circuit**

Check that known-clean installs (e.g., `localwpe`, `elasticapi`) log `✓ clean` without triggering Tier 2. If the LLM is called on clean sites, the exposure check calibration (EXP-01) is too aggressive — adjust the threshold.

- [ ] **Step 6: Full test suite pass**

```bash
npm run compile 2>&1 | head -5
npx jest tests/unit/ --no-coverage 2>&1 | tail -8
```

Expected: TypeScript clean, all unit tests passing.

- [ ] **Step 7: Final commit**

```bash
git add agents/security-sentinel/agent.js
git commit -m "feat(agent): wire security-sentinel run() — full Tier 1/2/3 pipeline operational"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| `wpe:sync.completed` event | Task 1 |
| Graph-first Tier 1 | Task 2 (`collectFleetData`) |
| Unsynced install handling | Task 2 |
| Absolute checks ABS-01 to ABS-06 | Task 3 |
| LLM-assisted user audit | Task 4 |
| Exposure checks EXP-01/03/05 | Task 4 |
| Relative checks REL-01 to REL-04 | Task 5 |
| Baseline management | Task 5 |
| Fleet correlation FLEET-01/02 | Task 6 |
| Tier 2 sandbox (non-linked pull) | Task 7 |
| Filesystem checks FS-01/02/04 | Task 7 |
| Admin count mismatch | Task 7 |
| LLM synthesis | Task 8 |
| Tier 3 quarantine + hardening | Task 8 |
| Reconciliation vs existing local copy | Task 8 (logged for manual step — full `compare_sites` wiring is v2) |
| Demo acceptance test | Task 9 |

**Known gaps vs spec (intentional for v1):**
- EXP-02 (XML-RPC), EXP-04 (version exposure), EXP-06 (wp-config.php accessible via HTTP) — require HTTP checks not available in current tool set; flagged for v2
- FS-05 (`wp core verify-checksums`), FS-06 (.htaccess), FS-07 (mtime clustering), FS-08/09 — can be added to Task 7 as additional `wp_eval` calls without changing task structure
- `compare_sites` reconciliation step is prepared but requires human review for content conflicts — a future interactive Nexus UI flow will present this
- Activity log querying — requires detecting and querying Simple History/WP Activity Log; deferred to v2
