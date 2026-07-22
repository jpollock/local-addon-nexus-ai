# Sentinel v2.3 — File Content Surfacing, protectedEmails Wiring, fleet_sql Parameterization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent improvements to the security sentinel: surface what web-root PHP intrusion files actually contain (v2.3), wire the admin-account protection list to the WPE portal account owner instead of the (attacker-writable) WordPress admin_email option, and parameterize fleet_sql to eliminate the SQL delimiter attack surface.

**Architecture:** All three tasks touch `agents/security-sentinel/agent.js`. Task 1 adds a new `runRootFileAnalysis` function called in `tier2Investigate`. Task 2 adds WPE API calls to `collectFleetData` to populate `protectedEmails` from the portal account owner. Task 3 adds a `params` field to the fleet_sql MCP tool and updates the two agent.js callers that interpolate `site.id` into SQL strings.

**Tech Stack:** CommonJS JS (agent.js), TypeScript (fleet-sql.ts), PHP via wp_eval, better-sqlite3 parameterized queries.

## Global Constraints

- All new agent functions: `async`, accept `(fsSignals, sandboxName, tools, log)` pattern, wrapped in try/catch — never crash `tier2Investigate`.
- Evidence enrichment appends to existing `.evidence` arrays with `  → ` prefix.
- PHP code in wp_eval: `skip_plugins: true, skip_themes: true` for all DB/filesystem reads.
- Tests: `npm test -- --testPathPattern="sentinel" 2>&1 | tail -10`. All 137 must still pass.
- fleet_sql change: backward-compatible — callers that omit `params` work exactly as before.
- No new npm dependencies.

---

### Task 1: Web Root File Content Analysis (FS-03 deep read)

`runContentExamination` already reads FS-03 files but only captures 200 chars and a function list. This task adds `runRootFileAnalysis` — a deeper, classification-aware read specifically for web-root PHP files that outputs a structured finding per file: full decoded content, attack category, and extracted IOCs. It runs immediately after `runContentExamination` in `tier2Investigate`.

**Files:**
- Modify: `agents/security-sentinel/agent.js` — add `runRootFileAnalysis` function, call it, export it

**Interfaces:**
- Consumes: `fsSignals` (array with FS-03 entry already enriched by `runContentExamination`), `sandboxName`, `tools`, `log`
- Produces: `async function runRootFileAnalysis(fsSignals, sandboxName, tools, log)` — mutates FS-03 `.evidence` in place, adds FS-03 signal if missing, returns void

**Attack categories to detect:**

| Pattern | Category |
|---------|----------|
| `eval(base64_decode`, `eval(gzinflate`, `goto` obfuscation | `obfuscated-dropper` |
| `$_POST[`, `$_REQUEST[`, `$_GET[` used in `exec`/`system`/`eval` | `webshell` |
| casino/gambling keywords in output strings | `seo-spam-injector` |
| `$_FILES`, `move_uploaded_file` | `file-uploader` |
| `mail(`, `header('Location:` with attacker domains | `mailer` |
| None of the above, but PHP file in root | `unknown-php` |

- [ ] **Step 1: Write the failing tests**

Add inside `describe('security-sentinel')` in `tests/unit/agents/security-sentinel/sentinel.test.js`:

```javascript
describe('runRootFileAnalysis', () => {
  const makeFs03 = (evidence) => ({
    id: 'FS-03', severity: 'critical', category: 'active-compromise',
    installName: 'test', title: 'test', detail: '', fix: '', evidence,
  });

  it('classifies a webshell and appends analysis to FS-03 evidence', async () => {
    const { runRootFileAnalysis } = agent._test;
    const signal = makeFs03(['goods.php (unknown PHP in web root)']);
    const content = '<?php eval($_POST["cmd"]); ?>';
    const mockResult = JSON.stringify({
      'goods.php': { content, size: content.length, category: 'webshell', iocs: [] },
    });
    const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runRootFileAnalysis([signal], 'sandbox-abc', tools, log);

    expect(signal.evidence.some(e => e.includes('webshell'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('goods.php'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('eval($_POST'))).toBe(true);
  });

  it('no-ops when no FS-03 signal present', async () => {
    const { runRootFileAnalysis } = agent._test;
    const tools = { invoke: jest.fn() };
    const log = { info: jest.fn(), warn: jest.fn() };
    await runRootFileAnalysis([], 'sandbox-abc', tools, log);
    expect(tools.invoke).not.toHaveBeenCalled();
  });

  it('decodes a base64/gzinflate obfuscated payload', async () => {
    const { runRootFileAnalysis } = agent._test;
    const signal = makeFs03(['shop.php (unknown PHP in web root)']);
    const decoded = '<?php system($_GET["c"]); ?>';
    const mockResult = JSON.stringify({
      'shop.php': { content: '<?php eval(base64_decode("xyz")); ?>', size: 40, category: 'obfuscated-dropper', iocs: [], decodedPayload: decoded },
    });
    const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runRootFileAnalysis([signal], 'sandbox-abc', tools, log);
    expect(signal.evidence.some(e => e.includes('obfuscated-dropper'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('system($_GET'))).toBe(true);
  });

  it('does not throw when tools.invoke rejects', async () => {
    const { runRootFileAnalysis } = agent._test;
    const signal = makeFs03(['goods.php (unknown PHP in web root)']);
    const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
    const log = { info: jest.fn(), warn: jest.fn() };
    await expect(runRootFileAnalysis([signal], 'sandbox-abc', tools, log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Root file analysis failed'));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep "runRootFileAnalysis"
```
Expected: `TypeError: runRootFileAnalysis is not a function`

- [ ] **Step 3: Implement `runRootFileAnalysis`**

Add this function immediately after `runContentExamination` in `agent.js`:

```javascript
async function runRootFileAnalysis(fsSignals, sandboxName, tools, log) {
  const fs03 = fsSignals.find(s => s.id === 'FS-03');
  if (!fs03 || !fs03.evidence || fs03.evidence.length === 0) return;

  const rootFiles = fs03.evidence
    .map(e => e.split(' ')[0])
    .filter(p => p && p.endsWith('.php') && !p.includes('/') && !p.startsWith('  '));
  if (rootFiles.length === 0) return;

  const pathsJson = JSON.stringify(rootFiles);
  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $files = ${pathsJson};
        $out = [];
        foreach ($files as $f) {
          $full = ABSPATH . $f;
          if (!file_exists($full)) continue;
          $raw = @file_get_contents($full) ?: '';
          $size = strlen($raw);

          // Attempt one-level decode for obfuscated files
          $decoded = null;
          preg_match_all('/base64_decode\\s*\\(\\s*[\'"]([A-Za-z0-9+\\/=]{20,})[\'"]/', $raw, $m);
          foreach ($m[1] as $b64) {
            $d = @base64_decode($b64);
            if ($d !== false && strlen($d) > 10) {
              $ungz = @gzinflate($d);
              $decoded = substr($ungz ?: $d, 0, 500);
              break;
            }
          }

          // Classify attack category
          $category = 'unknown-php';
          if (preg_match('/eval\\s*\\(\\s*(\\$_POST|\\$_REQUEST|\\$_GET|\\$_COOKIE)/', $raw) ||
              preg_match('/(system|exec|passthru|shell_exec)\\s*\\(\\s*(\\$_POST|\\$_GET|\\$_REQUEST)/', $raw)) {
            $category = 'webshell';
          } elseif (preg_match('/\\$_FILES|move_uploaded_file/', $raw)) {
            $category = 'file-uploader';
          } elseif (preg_match('/eval\\s*\\(\\s*(base64_decode|gzinflate|str_rot13|goto)/', $raw) ||
                    preg_match('/goto\\s+[a-zA-Z_]/', $raw)) {
            $category = 'obfuscated-dropper';
          } elseif (preg_match('/casino|gambling|slots|poker|bet\b|wagering/i', $raw)) {
            $category = 'seo-spam-injector';
          } elseif (preg_match('/\\bmail\\s*\\(|header\\s*\\(\\s*[\'"]Location:/i', $raw)) {
            $category = 'mailer';
          }

          // Extract IOCs: IPs and external URLs
          preg_match_all('/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/', $raw, $ips);
          preg_match_all('/https?:\\/\\/[^\\s\'"<>]+/', $raw, $urls);

          $out[$f] = [
            'content' => substr($raw, 0, 1000),
            'size' => $size,
            'category' => $category,
            'iocs' => array_values(array_unique(array_merge($ips[0], $urls[0]))),
            'decodedPayload' => $decoded,
          ];
        }
        echo json_encode($out);
      `,
    });

    const parsed = JSON.parse(typeof result === 'string' ? result : JSON.stringify(result) || '{}');

    for (const [file, info] of Object.entries(parsed)) {
      if (!info) continue;
      fs03.evidence.push(`  → ${file} [${info.category}] (${info.size} bytes)`);
      if (info.decodedPayload) {
        fs03.evidence.push(`  → decoded: ${info.decodedPayload.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
      if (info.content && !info.decodedPayload) {
        fs03.evidence.push(`  → content: ${info.content.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
      if (info.iocs && info.iocs.length > 0) {
        fs03.evidence.push(`  → IOCs: ${info.iocs.slice(0, 5).join(', ')}`);
      }
    }
    log.info(`[Tier 2] Root file analysis: ${Object.keys(parsed).length} file(s) classified`);
  } catch (err) {
    log.warn(`[Tier 2] Root file analysis failed: ${err.message}`);
  }
}
```

- [ ] **Step 4: Call it and export it**

In `tier2Investigate`, immediately after `await runContentExamination(...)`:
```javascript
  await runRootFileAnalysis(fsSignals, sandboxName, tools, log);
```

Add `runRootFileAnalysis` to the `_test` export object at line ~315.

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | tail -10
```
Expected: 141 passing (137 + 4 new).

- [ ] **Step 6: Sync and commit**

```bash
npm run sync-agents 2>&1 | tail -2
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(sentinel-v2.3): runRootFileAnalysis — deep content read + classification for web-root PHP files (FS-03)"
```

---

### Task 2: protectedEmails from WPE Portal Account Owner

Currently `install.protectedEmails` contains only the graph.db `admin_email` (the WordPress admin email, which is attacker-writable post-compromise). For WPE production installs, the actual owner is the WPE portal account owner — a different person entirely, sourced from outside the compromised site. This task wires `wpe_get_accounts` + `wpe_get_account_users` into `collectFleetData` to populate `protectedEmails` from the portal for WPE installs.

WPE role code for account owner: `'o'` (the `wpe_get_account_users` response returns `roles: "o"` for owner — see `feedback_wpe_role_codes.md`).

**Files:**
- Modify: `agents/security-sentinel/agent.js` — `collectFleetData` only
- Modify: `agents/security-sentinel/nexus.agent.yaml` — add tools to manifest

**Interfaces:**
- `install.protectedEmails: string[]` — already consumed by `buildRemediationChecklist`

- [ ] **Step 1: Write the failing test**

In `tests/unit/agents/security-sentinel/sentinel.test.js`, add inside the existing `describe`:

```javascript
describe('collectFleetData protectedEmails', () => {
  it('populates protectedEmails from WPE portal owner for WPE installs', async () => {
    const { collectFleetData } = agent._test;
    // fleet_sql returns one WPE install; wpe_get_accounts and wpe_get_account_users follow
    const tools = {
      invoke: jest.fn().mockImplementation(async (name, args) => {
        if (name === 'fleet_sql' && (args.query || '').includes('FROM sites')) {
          return '| id | name | source | environment | ssh_last_sync_at | post_count | user_count | settings_json | wp_version | php_version | admin_email |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| s1 | mysite | wpe | production | 123 | 10 | 1 | {} | 6.5 | 8.2 | wp@mysite.com |';
        }
        if (name === 'fleet_sql') return ''; // plugins/users queries
        if (name === 'wpe_get_accounts') return JSON.stringify([{ id: 'acct1', name: 'My Account' }]);
        if (name === 'wpe_get_account_users') return JSON.stringify([
          { email: 'owner@company.com', roles: 'o' },
          { email: 'billing@company.com', roles: 'b' },
        ]);
        return '[]';
      }),
    };
    const log = { info: jest.fn(), warn: jest.fn() };
    const installs = await collectFleetData(tools, null, null, log);
    expect(installs[0].protectedEmails).toContain('owner@company.com');
    expect(installs[0].protectedEmails).not.toContain('billing@company.com');
  });

  it('falls back to admin_email for local installs (no WPE API call)', async () => {
    const { collectFleetData } = agent._test;
    const tools = {
      invoke: jest.fn().mockImplementation(async (name, args) => {
        if (name === 'fleet_sql' && (args.query || '').includes('FROM sites')) {
          return '| id | name | source | environment | ssh_last_sync_at | post_count | user_count | settings_json | wp_version | php_version | admin_email |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| s2 | localsite | local | NULL | NULL | 5 | 1 | {} | 6.5 | 8.2 | admin@local.com |';
        }
        if (name === 'fleet_sql') return '';
        return '[]';
      }),
    };
    const log = { info: jest.fn(), warn: jest.fn() };
    const installs = await collectFleetData(tools, null, null, log);
    expect(installs[0].protectedEmails).toContain('admin@local.com');
    expect(tools.invoke).not.toHaveBeenCalledWith('wpe_get_accounts', expect.anything());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep "protectedEmails"
```
Expected: test failures (collectFleetData does not call wpe_get_accounts).

- [ ] **Step 3: Implement**

In `collectFleetData`, before the `for (const site of rows)` loop, add:

```javascript
  // For WPE installs: resolve portal account owner emails to use as protectedEmails.
  // These come from OUTSIDE the compromised site (the WPE portal), so they can't be
  // overwritten by an attacker who has compromised WordPress.
  const wpeOwnerEmailsByAccount = {};
  try {
    const accountsResult = await tools.invoke('wpe_get_accounts', {});
    const accounts = Array.isArray(accountsResult) ? accountsResult : [];
    for (const acct of accounts) {
      if (!acct.id) continue;
      try {
        const usersResult = await tools.invoke('wpe_get_account_users', { account_id: acct.id });
        const users = Array.isArray(usersResult) ? usersResult : [];
        const ownerEmails = users
          .filter(u => u.roles === 'o' && u.email)
          .map(u => u.email.toLowerCase());
        if (ownerEmails.length > 0) wpeOwnerEmailsByAccount[acct.id] = ownerEmails;
      } catch { /* account may not be accessible */ }
    }
  } catch { /* WPE not authenticated — fall back to admin_email */ }
```

Then in the `installs.push({...})` block, replace the current `protectedEmails` line:

```javascript
      // For WPE installs: use portal account owner email (outside attacker reach).
      // For local installs: use graph.db admin_email (synced before scan, not live).
      // wpeOwnerEmailsByAccount is keyed by account ID — look up via settings_json if available.
      protectedEmails: (() => {
        if (site.source === 'wpe') {
          const settings = site.settings_json ? JSON.parse(site.settings_json) : {};
          const accountId = settings.account_id || null;
          const portalEmails = accountId ? (wpeOwnerEmailsByAccount[accountId] || []) : [];
          // If we found portal owner emails, use them; otherwise fall back to admin_email
          if (portalEmails.length > 0) return portalEmails;
        }
        return site.admin_email ? [site.admin_email.toLowerCase()] : [];
      })(),
```

- [ ] **Step 4: Add tools to manifest**

In `agents/security-sentinel/nexus.agent.yaml`, add under `tools:`:
```yaml
  - wpe_get_accounts
  - wpe_get_account_users
```

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | tail -10
```
Expected: 143 passing (141 + 2 new).

- [ ] **Step 6: Sync and commit**

```bash
npm run sync-agents 2>&1 | tail -2
git add agents/security-sentinel/agent.js agents/security-sentinel/nexus.agent.yaml tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(sentinel): protectedEmails from WPE portal account owner — sourced outside attacker reach"
```

---

### Task 3: fleet_sql Parameterization

The fleet_sql tool currently returns a markdown table, and `parseSqlResult` parses it. Pipe chars in column values break parsing (Fix C surfaces this but can't prevent it). The root fix: add an optional `params: unknown[]` field to fleet_sql that binds values via SQLite's native parameterized query API instead of string interpolation. Callers pass `?` placeholders in the query and values in `params`.

`agent.js` has two queries that interpolate `site.id` (a UUID) — low risk today, but parameterizing them closes the door permanently and serves as the reference implementation.

**Files:**
- Modify: `src/main/mcp/modules/fleet-intelligence/fleet-sql.ts` — add `params` field
- Modify: `agents/security-sentinel/agent.js` — update two queries to use params
- Test: `tests/unit/mcp/fleet-sql.test.ts` (create if not exists) or add to existing

**Interfaces:**
- `fleet_sql({ query: string, params?: unknown[] })` — backward-compatible; omitting `params` works exactly as before

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp/fleet-sql.test.ts`:

```typescript
import { fleetSqlHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-sql';

describe('fleet_sql parameterization', () => {
  const makeServices = (rows: Record<string, unknown>[]) => ({
    graphService: {
      getDb: () => ({
        prepare: (sql: string) => ({
          all: (...args: unknown[]) => rows,
        }),
      }),
    },
  });

  it('passes params to prepared statement when provided', async () => {
    let capturedSql = '';
    let capturedArgs: unknown[] = [];
    const services = {
      graphService: {
        getDb: () => ({
          prepare: (sql: string) => {
            capturedSql = sql;
            return { all: (...args: unknown[]) => { capturedArgs = args; return []; } };
          },
        }),
      },
    };

    await fleetSqlHandler.execute(
      { query: "SELECT name FROM sites WHERE id = ?", params: ['abc-123'] },
      services as any
    );

    expect(capturedSql).toBe("SELECT name FROM sites WHERE id = ?");
    expect(capturedArgs).toEqual(['abc-123']);
  });

  it('works without params (backward compatible)', async () => {
    let capturedArgs: unknown[] = [];
    const services = {
      graphService: {
        getDb: () => ({
          prepare: (sql: string) => ({
            all: (...args: unknown[]) => { capturedArgs = args; return []; },
          }),
        }),
      },
    };

    await fleetSqlHandler.execute(
      { query: "SELECT name FROM sites" },
      services as any
    );

    expect(capturedArgs).toEqual([]);
  });

  it('rejects non-array params', async () => {
    const services = makeServices([]);
    const result = await fleetSqlHandler.execute(
      { query: "SELECT name FROM sites WHERE id = ?", params: 'not-an-array' as any },
      services as any
    );
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --testPathPattern="fleet-sql" 2>&1 | tail -10
```
Expected: `passes params` fails — `capturedArgs` is `[]` (current code never passes params).

- [ ] **Step 3: Update fleet-sql.ts**

In `src/main/mcp/modules/fleet-intelligence/fleet-sql.ts`:

```typescript
// Add params to inputSchema properties:
        params: {
          type: 'array',
          description: 'Optional bind parameters for ? placeholders in the query. Values are bound in order. Use this instead of string interpolation to prevent delimiter injection.',
          items: {},
        },

// In execute():
    const params = args.params as unknown[] | undefined;
    if (params !== undefined && !Array.isArray(params)) {
      return error('params must be an array when provided.');
    }

    try {
      const stmt = db.prepare(query);
      const rows = (params ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];
```

- [ ] **Step 4: Update two queries in agent.js**

Replace the plugins query (around line 73):
```javascript
    const pluginsResult = await tools.invoke('fleet_sql', {
      query: `SELECT slug, name, version, is_active FROM plugins WHERE site_id = ?`,
      params: [site.id],
    });
```

Replace the users query (around line 76):
```javascript
    const usersResult = await tools.invoke('fleet_sql', {
      query: `SELECT username, email, roles, created_at FROM users WHERE site_id = ?`,
      params: [site.id],
    });
```

- [ ] **Step 5: Run all tests**

```bash
npm test -- --testPathPattern="fleet-sql|sentinel" 2>&1 | tail -10
```
Expected: fleet-sql 3 passing, sentinel 143 passing.

- [ ] **Step 6: Build and commit**

```bash
npm run build 2>&1 | grep -E "error|Done"
npm run sync-agents 2>&1 | tail -2
git add src/main/mcp/modules/fleet-intelligence/fleet-sql.ts agents/security-sentinel/agent.js tests/unit/mcp/fleet-sql.test.ts
git commit -m "feat: fleet_sql params field — parameterized queries eliminate SQL delimiter attack surface"
```
