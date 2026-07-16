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

## Appendix: Event Catalog (published triggers)

| Event | Pattern | Payload |
|-------|---------|---------|
| WPE sync complete | `wpe:sync.completed` | `{ installName, installId, siteId }` |
| Plugin activated | `wp:plugin.activated` | `{ siteId, slug, version }` |
| User created | `wp:user.created` | `{ siteId, userId, role }` |
| Site indexed | `nexus:site.indexed` | `{ siteId, documentCount }` |
| Agent run complete | `nexus:agent.completed` | `{ agentName, verdict, runId }` |
