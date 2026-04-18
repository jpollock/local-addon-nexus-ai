# Nexus AI — Next Roadmap
*Starting from post-mvp-next state, April 2026*

---

## Guiding Principles (updated)

**Finish before extending.** The mvp-next sprint built infrastructure to 50-60% completion in three areas: REST API (read-only, no writes), webhooks (delivery with no retry), audit log (logging with no query interface). The temptation is to count these as done and move to the next feature. The correct call is to finish them. Half-finished infrastructure that users can discover and hit the wall on is worse for trust than a feature that simply does not exist yet.

**Security debt compounds fast.** Three issues identified in the tech debt analysis (SSRF in webhooks, plaintext REST token, audit log parameter exposure) were not fixed before shipping. Each sprint that passes without fixing them increases the blast radius — more users hitting the API, more audit log entries written with potential key exposure, more webhook configurations that could point to internal endpoints. Security issues do not age well. Fix them before anything else.

**The agency operator is the north star user.** Every prioritization decision should be evaluated from the perspective of someone managing 200 WP Engine sites with a team of three developers. Can they audit who ran a destructive operation? Can they trigger a backup from their CI/CD pipeline? Can they prevent a junior developer from promoting staging to production without approval? If not, those capabilities rank above any solo-developer quality-of-life improvements.

**Stop adding MCP tools.** At 92 tools, the MCP surface is already beyond what most AI agents can efficiently navigate. The gap is not tool count — it is tool quality, discoverability, and the dozen features that are built but not exposed. Adding tool 93 is worse than making tools 1-92 work reliably with good error messages. Hold the line at 92 until the rationalization work in Sprint N+3 is done.

**Type safety is not optional anymore.** At 821 `:any` instances, refactoring is still dangerous — the compiler cannot catch type errors across large parts of the codebase. Each sprint that touches a file should reduce the `:any` count in that file as a byproduct of the feature work. This is not a separate cleanup sprint; it is a discipline applied continuously. The target is below 200 before the product goes to GA.

**Every sprint ends with a measurable user test.** Before marking a sprint done, someone who has not used the product before should be able to complete the target task without reading documentation. If they cannot, the sprint is not done.

---

## Immediate (This Week — Security Blockers)

These three issues must be fixed before any other work begins. They introduce real risk — credential exposure, SSRF, and key leakage — that grows with each day the product is in use. Total estimated time: one focused day.

### Security Fix 1: Encrypt REST API token with KeyVault

**What it is:** The REST API authentication token is generated with `crypto.randomBytes()` and stored via `registryStorage.set()` — plaintext in the RegistryStorage JSON file. Every other secret in the system now goes through KeyVault. This is the one exception.

**Exact location:** `src/main/ipc-handlers.ts` line 3387.

**Fix:**
```typescript
// Before
const token = crypto.randomBytes(32).toString('hex');
registryStorage.set(STORAGE_KEYS.REST_API_TOKEN, token);

// After
const token = crypto.randomBytes(32).toString('hex');
keyVault.setKey('rest_api_token', token);
// In RestApiServer.ts, read via: keyVault.getKey('rest_api_token')
```

**Acceptance criteria:** `cat ~/Library/Application\ Support/Local/nexus-ai/config.json` (or wherever RegistryStorage writes) shows no plaintext token. Restarting Local regenerates or loads the encrypted token without error. REST API requests with the token still authenticate correctly.

**Estimated hours:** 2.

---

### Security Fix 2: Add SSRF protection to WebhookEmitter

**What it is:** `WebhookEmitter.ts` accepts any URL as a webhook endpoint without validating the hostname. A user (or an attacker with access to Preferences) can configure a webhook pointing to `http://169.254.169.254/latest/meta-data/` (AWS instance metadata), `http://127.0.0.1:3000/admin`, or any other internal endpoint. The Local process will faithfully POST to it.

**Exact location:** `src/main/webhooks/WebhookEmitter.ts`, the URL parsing section in `deliverPayload()`.

**Fix:**
```typescript
function validateWebhookUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS');
  }
  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = [
    'localhost', '127.0.0.1', '::1', '0.0.0.0',
    '169.254.169.254', '169.254.170.2', 'metadata.google.internal',
  ];
  const blockedPrefixes = ['10.', '172.16.', '172.17.', '172.18.', '172.19.',
    '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
    '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
    '192.168.'];
  if (blockedHosts.includes(hostname) ||
      blockedPrefixes.some(p => hostname.startsWith(p))) {
    throw new Error(
      'Webhook URL cannot point to localhost, internal IPs, or cloud metadata endpoints'
    );
  }
}
```

Call `validateWebhookUrl(url)` when a webhook is saved in Preferences and again in `deliverPayload()` as a defense-in-depth check. Add tests for each blocked case.

**Acceptance criteria:** Saving a webhook URL with hostname `localhost`, `127.0.0.1`, or `169.254.169.254` produces a validation error in Preferences. No HTTP request is made to those hosts. External HTTPS URLs (e.g., `https://hooks.slack.com/...`) continue to work.

**Estimated hours:** 3 (including tests for blocked/allowed cases).

---

### Security Fix 3: Add parameter redaction to OperationAuditLog

**What it is:** `OperationAuditLog.log()` writes the `parameters` object directly to JSONL without filtering. At least one call site passes API key values in the parameters object. The audit log is designed to be exported for compliance review, which means these keys can leave the machine.

**Exact location:** `src/main/audit/OperationAuditLog.ts`, the `log()` method. Also review all callers in `ipc-handlers.ts` that pass credential-related parameters.

**Fix:**
```typescript
const SENSITIVE_PARAMETER_KEYS = [
  'apiKey', 'api_key', 'key', 'token', 'secret',
  'password', 'credential', 'auth', 'authorization',
];

function redactSensitiveFields(
  params: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => {
      const keyLower = k.toLowerCase();
      const isSensitive = SENSITIVE_PARAMETER_KEYS.some(
        s => keyLower.includes(s)
      );
      return [k, isSensitive ? '[REDACTED]' : v];
    })
  );
}

// In log():
const safeParams = params ? redactSensitiveFields(params) : undefined;
// Write safeParams to JSONL, not params
```

Also audit every call site that passes parameters to `log()` and confirm no sensitive values reach the function even before redaction.

**Acceptance criteria:** Save an API key via Preferences. Run `nexus audit list`. No key value appears in output. The JSONL file contains `[REDACTED]` for the apiKey field. Exporting the log via `nexus audit export` produces the same redacted output.

**Estimated hours:** 4-6 (implementation plus caller audit plus tests).

---

## Sprint N+1: Close the Gaps (2 weeks)

These are the features that were built in the mvp-next sprint but left at 50-60% completion. None of them require new design — they require finishing what was started.

### Wire `nexus audit` CLI command into the router (1 hour)

`OperationAuditLog.list()` and `OperationAuditLog.export()` exist. `audit.ts` exists with the command definitions. The command is not registered in the CLI router.

**What to do:** Find where the CLI router registers commands (likely in `src/cli/index.ts` or equivalent) and add the audit command. Run `nexus audit list` — it should show recent entries. Run `nexus audit export` — it should write a JSONL file.

**Acceptance criteria:** `nexus audit list` returns entries. `nexus audit export --output /tmp/audit.jsonl` creates a file with correct JSONL format. `nexus audit list --operation backup --limit 20` filters correctly.

---

### Add REST write endpoint: POST /api/v1/sites/:id/backup (4 hours)

The REST API was positioned as an external automation surface. Read-only endpoints enable monitoring. Write endpoints enable automation. The single most requested automation use case is triggering a backup from CI/CD.

**What to do:** Add a POST handler in `src/main/rest/RestApiServer.ts` (or a new route file `src/main/rest/routes/backup.ts`):

```
POST /api/v1/sites/:id/backup
  Body: { "type": "full" | "incremental", "description": string }
  Response: { "backupId": string, "status": "queued" }
  Auth: Bearer token required
  Audit: Logged to OperationAuditLog as Tier 2 operation
```

This operation is equivalent to clicking "Create WPE Backup" in the dashboard. Wire it through the same IPC handler. Log it via OperationAuditLog.

**Acceptance criteria:** `curl -X POST -H "Authorization: Bearer <token>" -d '{"type":"full"}' http://127.0.0.1:14200/api/v1/sites/<id>/backup` returns 202 with a backup ID. The operation appears in `nexus audit list`. The backup appears in the WPE dashboard.

---

### Add REST read endpoint: GET /api/v1/audit (2 hours)

Compliance teams and enterprise customers need to query the audit log programmatically. The audit log exists. The REST API exists. Wire them together.

```
GET /api/v1/audit?operation=backup&limit=50&since=2026-04-01
  Response: { "entries": [...], "total": number }
  Auth: Bearer token required
```

**Acceptance criteria:** REST query returns audit entries matching filter. Pagination works with `limit` and `offset`. Response format matches `nexus audit list` output.

---

### Add webhook delivery queue and history (1 day)

Fire-and-forget is not acceptable for an integration surface positioned to agency operators who need to know whether their backup alerts reached their monitoring system.

**What to do:**

1. Persist last N delivery attempts per webhook URL to RegistryStorage (not in memory). Store: URL, event type, timestamp, status code, success boolean, error message if failed.
2. Add exponential backoff retry: on 5-second timeout or non-2xx response, queue for retry at 1 minute, then 5 minutes, then 1 hour. Maximum 3 retries.
3. Add a webhook delivery history view in Preferences — a small table showing last 10 deliveries per webhook with status.
4. Add `GET /api/v1/webhooks/deliveries` REST endpoint for external monitoring.

**Acceptance criteria:** When a webhook receiver returns 500, the delivery is retried twice more with backoff. After all retries fail, the failure appears in Preferences delivery history. `nexus audit list --operation webhook.delivery.failed` shows the failure. The REST endpoint returns delivery history.

---

### Fix Operations tab label mismatch (30 minutes)

Group label "Refresh Site Data" contains button "Refresh local sites" — inconsistent naming in a single-line span.

**What to do:** In `NexusOverview.tsx` lines 1690-1722, rename group labels to match button text:
- "Refresh Site Data" → "Refresh Sites"
- "Index for Search" → "Index Sites"
- Remove standalone "Maintenance" label, inline the database health scan button under an existing group.

**Acceptance criteria:** A new user reading the Operations tab sees no case where the group label and button label use different words for the same concept.

---

### Persist details toggle state per site (2 hours)

The "Show details" expander in SiteNexusSection resets on every navigation. Users who always want details must click the expander on every visit.

**What to do:** Store `detailsExpanded` state in RegistryStorage keyed by site ID. On mount, read from storage. On toggle, write to storage.

```typescript
const storageKey = `site_details_expanded_${site.id}`;
// On mount
const savedExpanded = registryStorage.get(storageKey);
this.state = { detailsExpanded: savedExpanded === 'true' };
// On toggle
registryStorage.set(storageKey, String(!this.state.detailsExpanded));
```

**Acceptance criteria:** Open a site, expand details, navigate to another site, return — details are still expanded. Open a second site — it starts collapsed (state is per-site, not global).

---

### Sprint N+1 success metrics

- `nexus audit list` returns entries with correct filtering — no documentation required
- `curl POST /api/v1/sites/<id>/backup` triggers a WPE backup
- A webhook delivery failure appears in Preferences UI within 2 minutes of the failed attempt
- Operations tab group labels and button labels use identical terminology throughout
- Details toggle state survives navigation for 10 consecutive site-switching actions

---

## Sprint N+2: Team and Platform (4 weeks)

These features change who can use the product. Without them, Nexus is a single-user tool. With them, it can be used by a team at an agency where different people have different permissions and accountability matters.

### Approval workflows for Tier 3 operations

**Target user:** Agency technical lead who needs to prevent junior developers from promoting staging to production without review.

**What to build:** A confirmation gate for operations in the Tier 3 set (promote environment, delete install, bulk domain changes). Two modes:

1. **Local approval:** Before executing, show a modal that requires the user to type the site name to confirm. Log the confirmation in the audit log. This prevents accidents; it does not prevent a determined bad actor on the same machine.

2. **Webhook-based approval (stretch):** When a Tier 3 operation is requested, emit a `operation.requires_approval` webhook. The receiver (Slack bot, ticketing system) returns an approval token. The operation proceeds only if the token is provided. This enables async approval from a different machine.

Start with local approval. Webhook-based is Phase 4 material.

**Acceptance criteria:** Running `nexus wpe promote --install <id>` without `--confirm-site-name <name>` prompts for confirmation. Proceeding logs the confirmation in the audit log with the username. Canceling exits cleanly with no change.

**Estimated effort:** 1 week.

---

### Role-based site access (local, file-based)

**Target user:** Agency with three developers where one senior developer manages WPE settings and two junior developers work on local sites only.

**What to build:** A role configuration file at `~/.nexus/roles.json` that defines:
- Which CLI commands are available to the current OS user
- Which MCP tools are exposed in this session
- Whether the REST API exposes write endpoints

This is not network-enforced RBAC — it is an honor system for teams that share a machine or share a role config via git. It is sufficient for the agency use case where the goal is preventing accidents, not preventing adversarial access.

```json
{
  "roles": {
    "operator": {
      "allowedCommands": ["nexus sites", "nexus content", "nexus wp", "nexus doctor"],
      "blockedCommands": ["nexus wpe promote", "nexus wpe delete"],
      "allowedMcpTools": ["nexus_site_status", "nexus_search", "nexus_wp_*"],
      "blockedMcpTools": ["nexus_wpe_promote", "nexus_wpe_delete_install"]
    }
  },
  "currentRole": "operator"
}
```

**Acceptance criteria:** With role set to "operator", `nexus wpe promote` exits with "This operation is not permitted in the current role. Ask an admin to run it." The blocked MCP tools return an error response if invoked. Audit log records the blocked attempt.

**Estimated effort:** 1.5 weeks.

---

### Shared audit log query via REST

Enterprise customers need to pull audit data into their existing SIEM or compliance tooling. The `GET /api/v1/audit` endpoint added in Sprint N+1 covers point queries. This sprint adds:

- Time-range filtering: `since` and `until` query parameters accepting ISO 8601 timestamps
- Pagination with `cursor`-based navigation for large result sets
- Export endpoint: `GET /api/v1/audit/export?format=jsonl` returns a downloadable file
- Webhook for new audit entries: `audit.entry.created` event type (opt-in)

**Acceptance criteria:** A Splunk forwarder can poll `/api/v1/audit?since=<last_cursor>` every 5 minutes and receive new entries with no duplicates. The export endpoint returns the complete log as a downloadable JSONL file.

**Estimated effort:** 3 days.

---

### WPE promote workflow with guided diff and dry-run

This was deferred from Phase 3 of the previous roadmap. It is the most complex operation in the product and the one most likely to cause irreversible damage if run incorrectly.

**What to build:**

1. **Environment diff view:** Before promoting, show a table comparing staging and production: WP version, PHP version, plugin list delta (added/removed/version changed), domain list, SSL status, last backup age.

2. **Pre-promotion checklist:** Verify: a backup exists in the last 24 hours, SSL is valid on both environments, health score is above 70 on staging.

3. **Dry-run mode:** `nexus wpe promote --install <id> --dry-run` shows what would happen without executing. Output includes the diff table and checklist results.

4. **Confirmation gate:** After dry-run review, the user must provide `--confirm-site-name <name>` to proceed.

5. **Post-promotion verification:** After promote, run a health check on both environments and report results.

**Acceptance criteria:** `nexus wpe promote --install <id> --dry-run` shows the environment diff and checklist without executing. A promote that fails the checklist (no recent backup) is blocked with a clear error. Post-promote health check runs automatically and results appear in the activity log.

**Estimated effort:** 2 weeks.

---

### Sprint N+2 success metrics

- An agency can run `nexus wpe promote` and the diff view shows all material differences between environments before execution
- A team with "operator" role cannot run Tier 3 operations from CLI or MCP
- A Splunk or Datadog integration can pull audit entries via REST on a recurring poll
- Approval modal prevents accidental execution of promote on 10/10 test attempts

---

## Sprint N+3: Distribution and Growth (Quarter)

These features change how the product reaches users and how many it can serve.

### Ship in Local core (internal milestone)

This is the strategic inflection point. Moving from third-party addon to first-party feature in Local changes the addressable user base from hundreds to potentially millions.

**Prerequisites before proposing to Local product team:**
- Phase 0 security issues resolved (done after Security week)
- Sprint N+1 gaps closed (audit log, webhook reliability, REST write)
- Usability score sustained above 7/10 on independent user test
- Zero open P0 or P1 bugs on main branch
- Install time under 30 seconds on a clean machine
- Documentation at minimum covering: installation, first-run, AI provider setup, fleet health check

**Internal pitch framing:** "Enable AI Features" checkbox in Local Preferences. Downloads platform-specific binary on first enable. Configures MCP for Claude Desktop automatically. Requires WPE account for fleet features; works standalone for local-only features.

**Timeline:** This is a quarter-long organizational effort, not a sprint deliverable. The sprint deliverable is the pitch deck, the quality bar documentation, and the first internal demo to the Local product team.

---

### `nexus learn` interactive tutorial

**Target:** A developer who just installed Nexus and wants to understand what it can do in 10 minutes without reading 40 pages of documentation.

**What to build:**
```
nexus learn
> Welcome to Nexus AI. Let's try 3 things together.
> Your sites: mysite-local (running), client-site-local (halted)
>
> Step 1: Check fleet health
> Running: nexus sites health
> [output scrolls]
> 1 site needs attention: client-site-local (halted)
>
> Step 2: Search your content
> Running: nexus content search "contact form"
> [output scrolls]
> Found in: mysite-local/contact-us
>
> Step 3: Ask Claude about your sites
> [opens MCP context with current fleet state]
> Try: "Which sites have outdated plugins?"
>
> You're ready. Run `nexus --help` to see everything.
```

The tutorial runs real commands against the user's actual sites. It does not use demo data. It does not require a mock environment.

**Acceptance criteria:** A first-time user who runs `nexus learn` can complete the tutorial in under 10 minutes. After completion, they can run `nexus sites health` independently and interpret the output. Survey score: 8/10 "I understand what Nexus can do."

**Estimated effort:** 2 weeks.

---

### MCP tool rationalization — identify the core 20

At 92 tools, the MCP surface is a cognitive burden for AI agents and a maintenance burden for the team. The goal is not to delete 72 tools — it is to identify the 20 that deliver 80% of the value and make those discoverable first.

**What to build:**
- Audit tool usage via telemetry (which tools are called, from which context, with what success rate)
- Identify the 20 highest-frequency, highest-success tools
- Add `"tier": "core" | "advanced"` metadata to tool definitions
- Build `nexus mcp setup --lite` that configures only core tools in the MCP server
- Update tool descriptions for the core 20 to include examples, expected inputs, and common failure modes
- Document the "advanced" tools with cross-references ("Use nexus_wpe_promote only after nexus_wpe_diff confirms readiness")

**Acceptance criteria:** An AI agent configured with `--lite` tools can complete 80% of common fleet management tasks. The core 20 tools each have at least one usage example in their description. Telemetry shows the rationalization did not reduce task success rate.

**Estimated effort:** 3 weeks (telemetry analysis, description rewrites, lite mode implementation).

---

### Sprint N+3 success metrics

- Local product team has received the first-party integration pitch with a live demo
- `nexus learn` user test: 8 out of 10 users complete the tutorial and can run fleet health independently
- MCP lite mode: Claude can complete "find all sites with outdated plugins and update them" using only the core 20 tools
- Fleet management demo running live at one internal WPE event

---

## What NOT to Build Next

**More MCP tools.** The problem is not the number of tools — 92 is already too many to navigate. Every engineering hour spent on tool 93 would be better spent making tools 1-92 more reliable, better documented, and more discoverable. Do not add MCP tools until the rationalization work in Sprint N+3 is done.

**A mobile app.** The REST API enables mobile access for anyone who wants to build a mobile interface. Building a native mobile app would consume 6+ months of engineering and reach a small fraction of the user base. The target user is at a desktop with Local running.

**Incremental indexing.** Full reindex runs in 2.7 seconds for 500 posts. The event system handles real-time updates adequately. Incremental indexing adds significant complexity for marginal benefit and introduces cache coherence risks. This has been on the "not needed" list since the original assessment — keep it there.

**Competing features with ManageWP/MainWP.** The differentiation is AI-first and WPE-native, not feature parity with every hosting control panel. Adding every WPE control plane operation to the dashboard (DNS editing, raw cPanel, CDN config) would make Nexus a worse version of what WPE's own dashboard already does. Keep the dashboard focused on the operations that benefit from AI context — fleet health, bulk operations, content search, go-live verification.

**Stripe billing integration.** Interesting but premature. If the enterprise tier reaches 50 paying agencies, billing automation becomes worth the investment. Before that, manual invoicing through WPE's existing billing infrastructure is sufficient.

**A separate compliance product.** Enterprise audit, role-based access, and approval workflows are sprint N+2 features — built into the existing product, not a separate SKU. Do not spin up a separate "Nexus Enterprise" product with its own codebase. The complexity cost of maintaining two products exceeds the revenue upside at this stage.

**GraphQL API for external access.** The REST API covers the external access use case. GraphQL would provide more flexible queries but at the cost of a much larger API surface to secure, document, and maintain. REST + specific endpoints is the correct choice for this phase.

---

## Success Metrics for Each Sprint

### Security week
- `cat RegistryStorage file` — no plaintext REST token
- Configure webhook to `http://localhost` — validation error before any HTTP request
- Run `nexus audit list` after saving API key — no key value in output
- All three fixes have corresponding unit tests

### Sprint N+1 (Close the Gaps)
- `nexus audit list` works without reading documentation
- `curl POST /api/v1/sites/<id>/backup` triggers a real backup on WPE
- A failed webhook delivery appears in Preferences history within 2 minutes
- Operations tab: no label/button naming inconsistencies (measured by reading each group)
- Details toggle persists across 10 consecutive site-switching actions

### Sprint N+2 (Team and Platform)
- Promote dry-run correctly identifies all plugin differences between staging and production on a test install
- Role-based access: "operator" role blocks Tier 3 commands on 10/10 test attempts with correct error message
- REST audit endpoint: a script polling `/api/v1/audit?since=<cursor>` receives all entries with no duplicates over a 1-hour period
- Post-promote health check: runs automatically and results appear in activity log within 3 minutes of promotion completing

### Sprint N+3 (Distribution and Growth)
- `nexus learn` tutorial: 8/10 first-time users complete it in under 10 minutes and rate understanding at 8/10 or higher
- MCP lite mode: Claude completes "find outdated plugins across all sites" task using only core-tier tools with no tool-not-found errors
- Internal: Local product team has scheduled a first-party integration review meeting (binary milestone)
- Telemetry: after MCP rationalization, tool invocation success rate on core-20 tools is above 90%
