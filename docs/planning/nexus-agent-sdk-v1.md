# Nexus Agent SDK — v1 Specification

> **Status:** Draft  
> **Target:** External platform launch  
> **Reference implementation:** `security-sentinel`  
> **Execution model:** Trust + review (v1) → WASM/Extism (v2)

---

## Design Principles

1. **Agents declare, the platform enforces.** Permissions are declared in the manifest and enforced by `AgentRunner` at every tool call — agents cannot self-escalate.
2. **Structured output, not parsed text.** Agents return typed domain data. The platform renders it. No markdown-to-HTML parsing.
3. **Log events are first-class.** `log.finding()` / `log.action()` / `log.phase()` produce structured events the runtime captures. Freeform strings are still supported but unstructured.
4. **The sentinel is the reference.** Every API decision here must be expressible by the current sentinel without loss of capability.

---

## 1. Agent Package Structure

```
security-sentinel/
  nexus.agent.yaml   ← manifest (required)
  agent.js           ← entry point (required)
  package.json       ← optional, for npm distribution
  README.md
```

For npm distribution: `package.json` `main` points to `agent.js`. The platform reads `nexus.agent.yaml` from the package root.

---

## 2. Agent Manifest (`nexus.agent.yaml`)

```yaml
# ── Identity ──────────────────────────────────────────────────────────────────
name: security-sentinel
version: 1.0.0
description: Fleet-wide security surveillance — detects compromise and pre-breach exposure
author:
  name: WP Engine
  verified: true          # WPE-signed agents get this flag

# ── Triggers ──────────────────────────────────────────────────────────────────
triggers:
  - type: event
    pattern: wpe:sync.completed     # fires when WPE refresh delivers new data
  - type: cron
    expression: "*/15 * * * *"
  # future:
  # - type: webhook
  #   path: /sentinel/alert

# ── Tool Access ───────────────────────────────────────────────────────────────
# Exhaustive list. Runtime blocks any tool call not declared here.
tools:
  - fleet_sql                 # read fleet graph DB
  - wpe_site_deep_refresh     # SSH WP-CLI data pull
  - local_create_site         # sandbox creation
  - local_wpe_pull            # pull prod → sandbox
  - local_operation_status    # poll pull progress
  - wp_eval                   # WP-CLI eval on local sites
  - local_wpe_push            # (Tier 3) push sandbox → prod

# ── Permissions ───────────────────────────────────────────────────────────────
permissions:
  tier: 3           # 1=read-only | 2=reversible | 3=production mutation
  scope: fleet      # fleet=all sites | site=declared sites only

# ── Runtime Targets ───────────────────────────────────────────────────────────
runtime:
  - local           # requires Local for sandbox creation
  # - wpe           # future: cloud runtime (no sandbox support)

# ── UI Contract ───────────────────────────────────────────────────────────────
# Platform renders these without agent-specific UI code.
ui:
  autonomy_description: "Investigates on its own • you approve anything on production"
  kpis:
    - label: Sites monitored
      query: "SELECT COUNT(*) FROM sites WHERE source='wpe'"
      color: default
    - label: Clean
      query: >
        SELECT COUNT(*) FROM sites WHERE source='wpe'
        AND id NOT IN (
          SELECT DISTINCT site_id FROM agent_security_sentinel_findings
          WHERE severity IN ('critical','high') AND resolved=0
        )
      color: green
    - label: Active threats
      query: >
        SELECT COUNT(DISTINCT site_id)
        FROM agent_security_sentinel_findings
        WHERE severity IN ('critical','high') AND resolved=0
      color: red
    - label: Pending review
      query: >
        SELECT COUNT(*) FROM agent_security_sentinel_plans
        WHERE status='pending'
      color: amber
```

### Permission Tier Semantics

| Tier | Capability | User consent |
|------|-----------|--------------|
| 1 | Read-only — `fleet_sql`, `wp_option_get`, site metadata | At install |
| 2 | Reversible writes — create sandbox, pull to local, WP-CLI on staging | At install |
| 3 | Production mutation — `local_wpe_push`, `wp_user_delete`, `wp_plugin_delete` on live installs | **Per-execution approval gate** in UI — platform inserts this, agent cannot bypass |

---

## 3. TypeScript Type Contracts

### 3.1 `AgentDefinition`

```typescript
interface AgentDefinition {
  name: string;
  version: string;
  description?: string;
  triggers: Trigger[];
  tools?: string[];
  permissions?: AgentPermissions;
  runtime?: ('local' | 'wpe')[];
  ui?: AgentUIContract;
  timeoutMs?: number;   // default: 20 minutes
  model?: string;       // override default AI model
  run(context: AgentRunContext): Promise<AgentResult>;
}

interface AgentPermissions {
  tier: 1 | 2 | 3;
  scope?: 'fleet' | 'site';
}

interface AgentUIContract {
  autonomyDescription?: string;
  kpis?: KPIDeclaration[];
}

interface KPIDeclaration {
  label: string;
  query: string;         // fleet_sql SELECT returning a single number
  color?: 'default' | 'green' | 'red' | 'amber';
  description?: string;
}
```

### 3.2 `AgentRunContext` — what `run()` receives

```typescript
interface AgentRunContext {
  event?: NexusEvent;      // the event that triggered this run, if any
  tools: AgentTools;       // permission-gated tool proxy
  ai: AgentAIClient;       // LLM access
  log: AgentLogger;        // structured + freeform logging
  state: AgentStateClient; // persistent key-value + agent-scoped tables
  notify: AgentNotifier;   // in-app and (future) external notifications
}
```

### 3.3 `AgentResult` — what `run()` returns

```typescript
interface AgentResult {
  verdict: 'clean' | 'findings' | 'escalated' | 'plan_ready' | 'error';

  // Per-site outcomes — drives RunStore siteStatus in the UI
  sites: Record<string, SiteOutcome>;

  // Fleet-level findings (all sites combined)
  findings?: Finding[];

  // Structured remediation plan — replaces markdown report files
  plan?: RemediationPlan;

  // Optional metrics for KPI queries that need runtime data
  // Key matches kpi.label in the manifest
  metrics?: Record<string, number>;

  error?: string;
}

interface SiteOutcome {
  status: 'clean' | 'findings' | 'escalated' | 'plan_ready' | 'error';
  findings: Finding[];
  plan?: RemediationPlan;
  error?: string;
}
```

### 3.4 `Finding`

```typescript
interface Finding {
  id: string;                    // e.g. 'ABS-05', 'FS-02'
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category?: 'active-compromise' | 'pre-breach' | 'misconfiguration' | 'informational';
  title: string;                 // short, human-readable
  description?: string;          // plain-language explanation
  site?: string;                 // install name this finding belongs to
  evidence?: Record<string, unknown>; // supporting data
  remediated?: boolean;          // true after execution
}
```

### 3.5 `RemediationPlan`

```typescript
interface RemediationPlan {
  site: string;
  sandbox?: string;              // sandbox site name if Tier 2 was used
  verified: boolean;             // all steps passed sandbox verification
  verdict: 'ready' | 'blocked'; // ready = safe to push, blocked = manual review needed
  summary?: string;              // LLM-generated synthesis
  steps: RemediationStep[];
}

interface RemediationStep {
  id: string;                    // e.g. 'step-1'
  label: string;                 // "Remove attacker plugins"
  command: string;               // actual command: "wp plugin delete fileorganizer"
  description?: string;
  tier: 1 | 2 | 3;
  requiresApproval: boolean;     // true = platform inserts approval gate
  verificationResult?: 'ok' | 'failed' | 'skipped';
  verificationOutput?: string;
}
```

---

## 4. `AgentLogger` — Structured Log Events

```typescript
interface AgentLogger {
  // ── Freeform (existing, keep) ───────────────────────────────────────────────
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;

  // ── Structured events (new) ─────────────────────────────────────────────────

  // Emit a finding — captured in AgentResult.findings, shown in RunDrawer
  finding(finding: Finding): void;

  // Emit an action taken — captured as children in the Fleet activity ledger row
  action(action: AgentAction): void;

  // Mark the start of an investigation phase — shown as labeled section in RunDrawer
  phase(name: string, description?: string): void;

  // Set a site's status — drives RunStore.siteStatus directly (no regex parsing)
  siteStatus(site: string, status: 'running' | 'clean' | 'findings' | 'escalated' | 'error'): void;
}

interface AgentAction {
  label: string;               // "Delete webshell"
  command?: string;            // "rm wp-content/mu-plugins/index.php"
  site?: string;               // install name
  result?: 'ok' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}
```

**How the runtime uses these:**
- `log.finding()` → appended to `AgentResult.findings` automatically, shown in RunDrawer as amber finding rows
- `log.action()` → appended to the Fleet activity event's `children` array (audit trail)
- `log.phase()` → displayed as a labeled section divider in the RunDrawer log console
- `log.siteStatus()` → directly updates RunStore siteStatus map — no log-line regex in the renderer

---

## 5. `AgentAIClient` Extensions

```typescript
interface AgentAIClient {
  // Existing — keep
  run(prompt: string): Promise<string>;

  // New — structured output (replaces markdown parsing)
  // Uses the configured provider's structured output / tool-use capability.
  // Returns a validated, typed object — the agent never parses LLM text for data.
  generateObject<T>(options: {
    prompt: string;
    schema: ZodSchema<T>;     // Zod schema for validation
    system?: string;
    temperature?: number;
  }): Promise<T>;
}
```

**Sentinel usage — Tier 2 synthesis before/after:**

```javascript
// BEFORE (current): parse markdown, fragile
const synthesis = await ai.run(synthPrompt);
// ... regex parse synthesis for plan steps ...

// AFTER (SDK): typed, validated
const plan = await ai.generateObject({
  schema: RemediationPlanSchema,   // Zod schema declared by sentinel
  prompt: synthPrompt,
  system: synthSystem,
});
// plan is typed RemediationPlan — no parsing
```

---

## 6. `AgentStateClient`

```typescript
interface AgentStateClient {
  // ── Key-value (existing, keep) ───────────────────────────────────────────────
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;

  // ── Cooldown helpers (new — replaces manual timestamp management) ─────────────
  // Returns true if a cooldown is still active (durationMs hasn't elapsed)
  isCoolingDown(key: string, durationMs: number): boolean;
  // Records a cooldown start for key
  setCooldown(key: string): void;

  // ── Agent-scoped tables (new) ─────────────────────────────────────────────────
  // Access or create an agent-scoped SQLite table.
  // Table name is namespaced: agent_{agentName}_{tableName}
  // Schema is created on first access based on the row shape.
  table(name: string): AgentTable;
}

interface AgentTable {
  insert(row: Record<string, unknown>): void;
  upsert(keyCol: string, row: Record<string, unknown>): void;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  deleteWhere(condition: string, params?: unknown[]): number;
}
```

**Sentinel usage — cooldown before/after:**

```javascript
// BEFORE:
const lastEscalation = state.get(`tier2-last:${install.id}`);
const hoursAgo = lastEscalation ? (Date.now() - lastEscalation) / 3_600_000 : Infinity;
if (hoursAgo < 24) { /* skip */ }
state.set(`tier2-last:${install.id}`, Date.now());

// AFTER:
if (state.isCoolingDown(`tier2:${install.id}`, 24 * 60 * 60 * 1000)) { /* skip */ }
state.setCooldown(`tier2:${install.id}`);
```

**Sentinel usage — agent-scoped findings table:**

```javascript
// Store finding in structured table (queryable by manifest KPIs)
state.table('findings').upsert('id', {
  id: `${install.id}:${finding.id}`,
  site_id: install.id,
  signal_id: finding.id,
  severity: finding.severity,
  title: finding.title,
  detected_at: Date.now(),
  resolved: 0,
});
```

---

## 7. `AgentNotifier`

```typescript
interface AgentNotifier {
  // In-app toast (always available)
  toast(message: string, level?: 'info' | 'warning' | 'critical'): void;

  // OS notification (fires when app is backgrounded)
  push(title: string, body: string): void;

  // External — declared in manifest, injected by platform (future)
  // Agents cannot construct these directly
  slack?(channel: string, message: string): Promise<void>;
  email?(to: string, subject: string, body: string): Promise<void>;
  webhook?(payload: unknown): Promise<void>;
}
```

---

## 8. `AgentTools` — Permission-Gated Proxy

The `tools` object passed to `run()` is a proxy. Every call is intercepted by `AgentRunner`:

1. Check the tool name against the manifest's `tools` list → block if not declared
2. Check the tool's required tier against the manifest's `permissions.tier` → block if insufficient
3. For Tier 3 tools: check that the user has approved this execution in the UI → block if not

The agent cannot bypass this. If it calls `tools.invoke('local_delete_site', ...)` and `local_delete_site` is not in its manifest, the call throws `AgentPermissionError` before any execution occurs.

```typescript
// AgentRunner wraps tool invocation
async function invokeWithPermissionCheck(
  toolName: string,
  args: unknown,
  agentDef: AgentDefinition,
  approvalState: ApprovalState,
): Promise<unknown> {
  const declared = agentDef.tools ?? [];
  if (!declared.includes(toolName)) {
    throw new AgentPermissionError(`Tool '${toolName}' not declared in manifest`);
  }
  const toolTier = TOOL_TIER_MAP[toolName] ?? 1;
  if (toolTier > (agentDef.permissions?.tier ?? 1)) {
    throw new AgentPermissionError(`Tool '${toolName}' requires Tier ${toolTier}; agent is Tier ${agentDef.permissions?.tier}`);
  }
  if (toolTier === 3 && !approvalState.approved) {
    throw new AgentPermissionError(`Tier 3 tool '${toolName}' requires user approval`);
  }
  return actualToolInvoke(toolName, args);
}
```

---

## 9. Sentinel Refactor — Before/After Summary

| Concern | Before (current) | After (SDK v1) |
|---------|-----------------|----------------|
| Findings output | `log.warn('[CRITICAL] ABS-05: ...')` | `log.finding({ id, severity, title, site })` |
| Site status | Parsed from log text by regex | `log.siteStatus(site, 'escalated')` |
| Investigation phases | `log.info('[Tier 2] ...')` | `log.phase('Tier 2', 'Deep investigation')` |
| Executed actions | Not captured | `log.action({ label, command, result, durationMs })` |
| LLM synthesis | `ai.run(prompt)` → parse markdown | `ai.generateObject({ schema, prompt })` → typed |
| Report output | Write `.md` file, parse later | `return { verdict, findings, plan }` |
| Cooldown management | `state.get/set('tier2-last:...')` manually | `state.isCoolingDown() / state.setCooldown()` |
| Findings persistence | Ad-hoc JSON in `agent_state` | `state.table('findings').upsert(...)` |
| KPI data | Hardcoded in UI | `kpis[].query` in manifest, executed by platform |
| Permissions | Implicit (agent uses any tool) | `tools` list in manifest, enforced by proxy |

---

## 10. Migration Path

1. **Publish type package** — `@nexus-ai/agent-sdk` with all interfaces above. Sentinel and future agents import from it.
2. **Update `AgentRunner`** — intercept `log.finding()` etc., capture in `AgentResult`, enforce tool permissions.
3. **Add `AgentStateClient.isCoolingDown()` / `table()`** — implement against existing `agent_state` table + new agent-scoped tables.
4. **Add `AgentAIClient.generateObject()`** — thin wrapper around provider structured-output APIs.
5. **Refactor sentinel** — update to emit structured events, return typed result, use `generateObject` for synthesis. Sentinel ships as v1.0.0 of the reference implementation.
6. **Remove markdown report files** — `AgentResult.plan` replaces `.md` files. `parseSentinelReport` is deleted. `SentinelReviewOverlay` is refactored to render from `RemediationPlan` type.

---

## 11. Durable Follow-Up / Multi-Phase Jobs

**Motivation:** The post-deploy traffic analyzer must run immediately after a push (T+0) *and* again at T+24h and T+48h as part of the same logical job. A single `run()` call cannot span 48 hours. The runtime must persist the job and call `run()` again at the scheduled time.

### `AgentRunContext.schedule`

```typescript
interface AgentScheduler {
  // Schedule a follow-up run of this agent.
  // The runtime persists the job across Local restarts.
  // `payload` is passed back as `event.payload` on the follow-up call.
  followUp(durationMs: number, payload?: Record<string, unknown>): void;

  // Cancel a pending follow-up (identified by payload key)
  cancel(payloadKey: string, payloadValue: unknown): void;
}
```

**Usage — post-deploy analyzer:**

```javascript
async run({ event, tools, log, schedule }) {
  const phase = event?.payload?.phase ?? 'immediate';
  const installName = event?.payload?.installName;

  if (phase === 'immediate') {
    // T+0: check site accessibility
    const health = await checkPageAccessibility(tools, installName);
    log.action({ label: 'Accessibility check', result: health.ok ? 'ok' : 'failed' });

    // Schedule T+24h follow-up
    schedule.followUp(24 * 60 * 60 * 1000, { phase: 'day1', installName });
    schedule.followUp(48 * 60 * 60 * 1000, { phase: 'day2', installName });

    return { verdict: health.ok ? 'clean' : 'findings', sites: { [installName]: health } };
  }

  if (phase === 'day1' || phase === 'day2') {
    // T+24h / T+48h: traffic comparison
    const comparison = await compareTraffic(tools, ai, installName, phase);
    return { verdict: comparison.anomalous ? 'findings' : 'clean', ... };
  }
}
```

**Trigger for the post-deploy analyzer:**
```yaml
triggers:
  - type: event
    pattern: nexus:site.pushed   # new event, fired by local_wpe_push on success
```

**Runtime behavior:** `schedule.followUp()` writes a `pending_followup` record to `agent_state`. On each startup and periodically, `AgentScheduler` checks for due follow-ups and fires `runner.run(agent, followUpEvent)`. Survives Local restarts.

---

## 12. HTTP Client Tool

**Motivation:** Page accessibility checks, link auditing, vulnerability database lookups (WPScan, NVD), and external analytics APIs all require outbound HTTP. Currently no tool exposes this.

### Manifest declaration

```yaml
permissions:
  tier: 1
  network:
    - "*.wpengine.com"
    - "api.wordpress.org"
    - "wpscan.com"
    - "api.nvd.nist.gov"
```

Agents declare the domains they need. The runtime enforces this — `tools.fetch()` to an undeclared domain throws `AgentPermissionError`.

### `tools.fetch()`

```typescript
interface AgentTools {
  // ... existing tools ...

  // HTTP client — sandboxed to declared network domains
  fetch(url: string, options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<{
    status: number;
    ok: boolean;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
  }>;
}
```

**Usage — page accessibility check:**

```javascript
const res = await tools.fetch(`https://${installName}.wpengine.com/checkout`);
log.action({
  label: `Accessibility: /checkout`,
  result: res.ok ? 'ok' : 'failed',
  error: res.ok ? undefined : `HTTP ${res.status}`,
});
```

**Usage — vulnerability lookup:**

```javascript
const vulns = await tools.fetch(
  `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=woocommerce`,
).then(r => r.json());
```

---

## 13. Continuous / Daemon Agents

**Motivation:** Uptime monitoring and SSL expiry checking need to run continuously — not on a cron tick or event, but as a long-running process that checks every N seconds and alerts immediately on failure.

### Manifest

```yaml
triggers:
  - type: stream        # long-running daemon
    interval: 60000     # heartbeat every 60s
```

### `AgentDefinition` extensions

```typescript
interface AgentDefinition {
  // ... existing fields ...

  // Called once when the daemon starts
  onStart?(context: AgentRunContext): Promise<void>;

  // Called every `interval` ms — the heartbeat
  run(context: AgentRunContext): Promise<AgentResult>;

  // Called when the daemon is stopped (Local quit, agent unregistered)
  onStop?(context: AgentRunContext): Promise<void>;
}
```

**Usage — uptime monitor:**

```javascript
module.exports = {
  name: 'uptime-monitor',
  triggers: [{ type: 'stream', interval: 60_000 }],

  async onStart({ state }) {
    // Load monitored pages from state
  },

  async run({ tools, log, notify, state }) {
    const pages = state.get('monitored_pages') ?? [];
    const failures = [];

    for (const page of pages) {
      const res = await tools.fetch(page.url);
      if (!res.ok) {
        failures.push({ url: page.url, status: res.status });
        log.finding({ id: 'UP-01', severity: 'critical', title: `${page.url} returned ${res.status}` });
      }
    }

    if (failures.length > 0) {
      notify.toast(`${failures.length} page(s) down`, 'critical');
    }

    return { verdict: failures.length > 0 ? 'findings' : 'clean', sites: {} };
  },
};
```

**Runtime behavior:** `AgentScheduler` starts a `setInterval` loop for stream agents. `onStop` fires when Local quits or the agent is disabled. The `run()` return value feeds the Fleet activity ledger like any other run, but only when `verdict !== 'clean'` (to avoid flooding the ledger with "all ok" entries).

---

## 14. Agent-to-Agent Data Sharing

**Motivation:** The vulnerability scanner's findings should be visible to the dependency coordinator and the security sentinel. The dependency coordinator's "safe to update" signals should feed the sentinel's baseline checks. Agent-scoped tables are private by default — this defines how agents grant cross-agent read access.

### Manifest declaration

```yaml
# In the reading agent (e.g. security-sentinel):
permissions:
  tier: 3
  reads_from:
    - agent: vulnerability-scanner
      table: findings        # reads agent_vulnerability_scanner_findings
    - agent: dependency-coordinator
      table: update_status   # reads agent_dependency_coordinator_update_status
```

### `AgentStateClient` extension

```typescript
interface AgentStateClient {
  // ... existing methods ...

  // Read another agent's shared table (declared in manifest reads_from)
  readFrom(agentName: string, tableName: string): AgentTable;
}
```

**Usage — sentinel reading vulnerability findings:**

```javascript
// In security-sentinel's run():
const vulnFindings = state
  .readFrom('vulnerability-scanner', 'findings')
  .query(
    'SELECT * FROM findings WHERE site_id = ? AND severity IN (?,?) AND resolved = 0',
    [install.id, 'critical', 'high']
  );

if (vulnFindings.length > 0) {
  // Elevate severity — known CVE on this site
  for (const f of vulnFindings) {
    log.finding({ id: f.signal_id, severity: 'critical', title: f.title, site: install.name });
  }
}
```

**Runtime enforcement:** `AgentRunner` checks `reads_from` at call time. If `security-sentinel` tries to `readFrom('some-other-agent', 'secrets')` and it's not in its manifest, `AgentPermissionError` is thrown. The owning agent's table is still read-only to the requesting agent — `readFrom()` returns a table with no `insert/upsert/delete` methods.

---

## 15. Extended Manifest — Full Example

Incorporating all additions (post-deploy analyzer as the full reference):

```yaml
name: post-deploy-analyzer
version: 1.0.0
description: Checks site health and traffic immediately after a WPE push, then monitors for 48h
author:
  name: WP Engine
  verified: true

triggers:
  - type: event
    pattern: nexus:site.pushed

tools:
  - fleet_sql
  - wpe_get_install_usage   # traffic data

permissions:
  tier: 1                   # read-only — no production changes
  scope: site               # only the site that was pushed
  network:
    - "*.wpengine.com"      # page accessibility checks

runtime:
  - local
  - wpe                     # can run in cloud — no sandbox needed

ui:
  autonomy_description: "Monitors health automatically after every push — no approval needed"
  kpis:
    - label: Pushes analyzed
      query: "SELECT COUNT(*) FROM agent_post_deploy_analyzer_runs"
      color: default
    - label: Issues detected
      query: "SELECT COUNT(*) FROM agent_post_deploy_analyzer_findings WHERE resolved=0"
      color: red
```

---

## Appendix: Event Catalog (published triggers)

| Event | Pattern | Payload | Status |
|-------|---------|---------|--------|
| WPE sync complete | `wpe:sync.completed` | `{ installName, installId, siteId }` | ✅ Implemented |
| Plugin activated | `wp:plugin.activated` | `{ siteId, slug, version }` | ✅ Implemented |
| User created | `wp:user.created` | `{ siteId, userId, role }` | ✅ Implemented |
| Site indexed | `nexus:site.indexed` | `{ siteId, documentCount }` | ✅ Implemented |
| Agent run complete | `nexus:agent.completed` | `{ agentName, verdict, runId }` | ✅ Implemented |
| Site pushed to WPE | `nexus:site.pushed` | `{ localSite, installName, includeDatabase }` | 🔜 Needed |
| Post published | `wp:post.published` | `{ siteId, postId, postType, url }` | 🔜 Needed |
| SSL expiring | `nexus:ssl.expiring` | `{ installName, domainId, daysRemaining }` | 🔜 Needed |
| Push failed | `nexus:site.push_failed` | `{ localSite, installName, error }` | 🔜 Needed |

## Appendix: Agent Catalog

| Agent | Tier | Triggers | Key tools | SDK gaps it exercises |
|-------|------|----------|-----------|----------------------|
| Security Sentinel | 3 | `wpe:sync.completed`, cron | fleet_sql, wp_eval, sandbox | — (reference impl) |
| Post-Deploy Analyzer | 1 | `nexus:site.pushed` | fleet_sql, wpe_get_install_usage, fetch | Durable follow-up, HTTP client, new event |
| Database Cleaner | 3 | cron, on-demand | fleet_sql, wp_eval | — (fits v1) |
| Plugin Vulnerability Scanner | 1 | cron, `wpe:sync.completed` | fleet_sql, fetch | HTTP client, shared tables |
| Dependency Coordinator | 2 | cron | fleet_sql, sandbox, local_wpe_push | Shared tables |
| SSL / Domain Monitor | 1 | cron, stream | wpe_get_ssl_certificates, wpe_get_domains, fetch | HTTP client |
| Post-Publish Content Auditor | 1 | `wp:post.published` | fleet_sql, fetch | HTTP client, new event |
| Uptime Monitor | 1 | stream | fetch | Daemon/stream trigger, HTTP client |
