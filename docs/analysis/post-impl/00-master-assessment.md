# Nexus AI — Post-Sprint Assessment
*April 2026 — after mvp-next implementation*

---

## Executive Summary

The mvp-next sprint executed all four planned phases of the forward roadmap and delivered 28 of 31 committed items. That is an accurate description of the output. It is not the same as saying the product is ready to ship.

The sprint was correctly sequenced — Phase 0 addressed security and correctness issues that were genuine blockers (plain-text API keys, untested BulkOperationManager, SQL injection patterns), and Phase 1 repaired the most damaging UX failures that made the product unusable by new users. That work was real and necessary. Usability scores improved from an average of 2.2/10 to 7.9/10 across nine measured dimensions. That delta matters. Before the sprint, a new user confronted 18 unlabeled rows of data per site with no tooltips, no feedback on button clicks, and no onboarding. After the sprint, they see three clearly labeled rows, every action produces a toast, and a first-run card walks them through setup.

The security picture is more nuanced than the first-pass analysis suggested. This product runs on the user's own machine — the threat model is not a multi-tenant server. SSRF concerns about webhooks pointing to localhost are moot when the user is the one configuring their own webhook URLs. The REST API token lives in the same storage as the WPE password and everything else. One genuine hygiene item: the audit log should redact sensitive field names before writing, so that exporting a log for debugging doesn't accidentally include an API key. That's 30 minutes of work.

Below the security issues, the sprint's most significant structural gap is that several features were built to 50-60% completion rather than finished. The audit log exists but `nexus audit` is not wired into the CLI router, so users cannot actually query it. Webhooks deliver but there is no retry queue, no delivery history, and no way to know whether an event was received. The REST API has five GET endpoints but deliberately rejects every write method, which means the "external integrations" use case it was built to serve (CI/CD triggering backups, GitHub Actions creating reports) is not actually enabled. These half-finished features are more disorienting than missing features — users will find them, expect them to work end-to-end, and be confused when they hit the wall.

The product is genuinely better than it was before the sprint. The usability work alone was worth it. One hygiene fix (audit log redaction, 30 min) and it is ready for GA from a security standpoint. The remaining gaps are feature completeness, not safety blockers.

---

## What Improved (with evidence)

### Usability: 2.2/10 to 7.9/10 across nine dimensions

Pre-sprint, buttons were labeled with action fragments ("Sync Keys", "Setup AI", "Index Now") that gave no indication of what they did or how they differed. Post-sprint, all five major buttons use clear action verbs with parallel structure: "Sync AI Credentials", "Install AI Tools", "Index Content", "Update Index", "Refresh Metadata". Every button has a hover tooltip of one to two sentences. The divergence between CLI and UI terminology — `nexus content reindex` mapping to "Index Now" — was resolved by making `index` the primary CLI command and adding a deprecation warning to `reindex`.

Before the sprint, every button action was silent — clicking "Sync Keys" showed "Syncing..." and returned to normal with no confirmation of success or failure. The sprint implemented a toast system that provides operation-specific feedback: "Indexed 1,234 documents in 45s", "Metadata updated — WordPress 6.5.2, 23 plugins", "Credentials sync failed. Your API key may be invalid. Re-enter it in Preferences." This is the difference between a product that users can operate and one they have to guess at.

The Preferences screen changed from a wall of 40+ settings in undifferentiated vertical scroll to five collapsible sections with the AI Provider section expanded by default. A new user can find the API key field in under 30 seconds without scrolling past WP Engine SSH configuration they do not yet understand.

Progressive disclosure collapsed the per-site panel from 18 unconditional rows to 3 always-visible rows (index status, AI provider, WordPress version) with the rest behind a "Show details" expander. This is the correct information hierarchy — the most important state at a glance, depth available on request.

### Security: three material improvements

API key encryption via KeyVault is a genuine security upgrade. Keys that were previously stored as plain JSON (readable with any text editor on the filesystem) are now encrypted using Electron's `safeStorage.encryptString()` — hardware-backed on macOS and Windows. Legacy plaintext keys are automatically migrated on first read. The fallback to plaintext for headless environments is logged with a warning. This closes the Medium severity issue documented in the pre-sprint assessment.

SQL injection patterns in GraphService were eliminated. The `pragma_table_info` queries that previously used template string interpolation for column names now use a `hasColumn()` helper with parameterized queries. This is low severity in practice because column names came from a hardcoded list, but the pattern would have been reused incorrectly.

GraphService schema migrations are now wrapped in transactions with version checks before each step. A failed migration no longer leaves the database in a partially-migrated state.

### Decomposition: measurable reduction in file size and complexity

ipc-handlers.ts was reduced from 4,001 lines to 3,397 lines with three domain modules extracted: `credentials.ts` (65 lines), `bulk.ts`, and `wpe-sync.ts`. resolvers.ts (4,613 lines) was split into five domain files covering sites, twin, wpe, wp-cli, and an index orchestration layer. The extracted modules are independently testable in a way the monolithic files were not.

The `:any` count dropped from 1,161 to 821, a 29% reduction. Empty catch blocks dropped from 997 to 213, a 78% reduction. These are real improvements in the compiler's ability to catch errors and in the signal-to-noise ratio of error handling.

### New infrastructure: REST API, webhooks, audit log, fleet health scheduler

The REST API, webhook emitter, fleet health scheduler, and audit log are all new and represent genuine additions to the product's integration surface. The REST API binds to localhost only, requires Bearer token authentication, and returns structured JSON. The webhook emitter uses HMAC-SHA256 signatures for payload verification. The audit log writes append-only JSONL with file mode 0o600 and synchronous writes for crash safety. These are correct implementations of the designs they were based on.

### Test coverage expanded

Test files increased from 167 to 178, adding dedicated suites for KeyVault, RestApiServer, WebhookEmitter, OperationAuditLog, and bulk operations integration. These cover the new security-critical paths that lacked any testing before the sprint.

---

## What's Still Broken

### Three security issues that block GA (detailed in next section)

### Audit log is not accessible

`OperationAuditLog` appends to disk and `OperationAuditLog.list()` exists, but `nexus audit` is not wired into the CLI router. Users cannot query who ran what. The compliance value of logging operations without providing a way to read the log is minimal. This is a one-hour fix that was not completed.

### Webhook delivery has no reliability guarantees

Fire-and-forget with a 5-second timeout is the correct starting point, but the current implementation has no persistent queue, no retry on failure, no delivery history, and no UI to register or inspect webhooks. If the webhook receiver is down when `site.health.degraded` fires, the event is lost with no indication to the user. This is acceptable for an early integration surface; it is not acceptable for an integration surface being positioned to agency operators managing 200 client sites.

### REST API is read-only but was positioned for external automation

The REST API was explicitly designed to serve "external tools: monitoring dashboards, Slack bots, GitHub Actions, cron-based reporting scripts." Read-only endpoints enable the monitoring use case. They do not enable the automation use case. A GitHub Action cannot trigger a backup via REST. A CI/CD pipeline cannot verify a backup was created. The current implementation delivers half of the positioned value.

### BulkOperationManager concurrency is still partially unfixed

The requirements analysis reported replacing `Promise.race()` with `Promise.allSettled()`. The tech debt analysis shows the `Promise.race()` call still present at lines 120-126 of BulkOperationManager.ts. Integration tests were added but cover only 3 concurrent sites, not the 50+ that represent real-world agency usage. The memory accumulation issue (unbounded `results: new Map()`) remains unaddressed.

### Operations tab label mismatch persists

The group label "Refresh Site Data" contains a button labeled "Refresh local sites" — two different phrasings for the same concept in a three-word span. This is exactly the kind of inconsistency the terminology normalization work was meant to eliminate. It survived because the label cleanup addressed SiteNexusSection buttons but not NexusOverview group headers. Fix time: 30 minutes.

### Details toggle state does not persist

The per-site "Show details" expander is stored in component state, not RegistryStorage. Every time a user navigates away from a site and returns, the expanded state is lost. Users who habitually check details must click the expander on every visit. This is a friction point that could be fixed in two hours.

### `any` count at 821 against a target of below 200

Type safety was identified as a critical issue in the pre-sprint assessment. The sprint reduced `:any` by 29%. The target for GA was below 200 instances. At 821, the compiler still cannot catch a large class of type errors — particularly in GraphQL resolvers for WPE objects, which still use `any` for `wpeConnection` lookups.

### Domain handler modules lack unit tests

Three substantial handler modules were extracted (bulk.ts, credentials.ts, wpe-sync.ts) but none have dedicated unit tests. The extraction enabled testability; the tests were not written. The value of modular extraction is only realized when the modules are tested independently.

---

## Security: Right-Sizing the Threat Model

This product runs on the user's own machine. That changes the threat model significantly compared to a server-side application. The right lens: what could harm the user or their data, given that the user is a trusted operator on their own device?

**What that means in practice:**
- Other processes on the machine are also the user's processes — SSRF to localhost is not an attack surface, it's the user talking to their own services
- RegistryStorage is already readable by the user on their own machine — storing a REST token there is no worse than anything else stored there
- The real risks are: (1) data leaving the machine unintentionally, and (2) renderer compromise via XSS calling IPC handlers

**Three items — reframed honestly:**

### 1. REST API token — same storage as everything else (consistency, not blocker)

**Reframed:** The token lives in RegistryStorage alongside the user's WPE password, AI model preference, and everything else. The user can already read RegistryStorage with a text editor. Using KeyVault here would be consistent with how API keys are stored, but it's not a unique risk — anyone who can read RegistryStorage already owns the machine.

**Worth doing eventually:** Use KeyVault for consistency. But it's not a blocker and not a security gap unique to this token.

**Priority:** Low. Nice-to-have consistency.

---

### 2. Webhook URL — localhost is fine, cloud metadata is worth blocking (low priority)

**Reframed:** The user configures their own webhook URLs. If they point to `http://localhost:3000`, that's intentional — they're sending events to their own local service. This is not SSRF in any meaningful sense.

**What IS worth doing (hygiene, not blocker):** Block cloud metadata endpoints like `169.254.169.254` (AWS) and `metadata.google.internal` (GCP). If a developer on an AWS instance somehow gets a malicious webhook URL in their config, this prevents credential leakage. One line of validation, 30 minutes.

**Priority:** Low. Not a GA blocker. Not even a security issue for most users.

---

### 3. Audit log writes parameters without redaction

**What:** `OperationAuditLog.log()` accepts a `parameters` object and writes it directly to the JSONL file without filtering. Callers that log credential operations may — and in at least one case do — pass the raw API key as a parameter.

**Where:** `src/main/audit/OperationAuditLog.ts`, the `log()` method. The dangerous call pattern is in `ipc-handlers.ts` credential logging.

**Why it matters:** The audit log file is stored at `~/Library/Application Support/Local/nexus-ai/audit.log` with mode 0o600. An entry like `{"operation": "credential.save", "parameters": {"apiKey": "sk-ant-secret123", "provider": "anthropic"}}` exposes the API key in a local file. If the log is exported for compliance review — which the `nexus audit export` command is designed to support — the key travels outside the machine.

**Fix:** Implement a `redactSensitiveFields()` helper that strips known sensitive keys before logging:
```typescript
const SENSITIVE_KEYS = ['apiKey', 'key', 'token', 'secret', 'password', 'credential', 'auth'];
function redactSensitiveFields(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s)) ? '[REDACTED]' : v,
    ])
  );
}
```

Apply in `log()` before writing.

**Estimated hours:** 4-6 (helper implementation, unit tests, audit of all existing log callers to confirm no keys are passed).

**Acceptance criteria:** Run `nexus audit list` after saving an API key — no key value appears in output. The log file contains `[REDACTED]` in place of any field with a sensitive name.

---

## The Sprint in One Sentence

The sprint fixed what was genuinely broken (security, UX, architecture) and delivered real new infrastructure (webhooks, audit log, fleet health scheduler). The one hygiene item worth doing before export/compliance use: redact sensitive fields in the audit log. Everything else flagged as a security issue was either already working correctly or overstated given the localhost threat model.

---

## Where We Are vs the Original Vision

The STRATEGIC_ANALYSIS.md describes a 10x opportunity: ship in Local core (10M users overnight), monetize enterprise fleet management at $99/month, position as WP Engine's AI platform. The pre-sprint assessment described getting there as requiring first fixing what was built — the UX failures, the security issues, the architectural fragility — before pushing toward that vision.

The sprint advanced that agenda meaningfully. The product is now demonstrably usable by a new user. The security foundation is materially stronger. The architecture is more decomposed and testable. The REST API and webhooks create an integration surface that did not exist before.

But the strategic gap remains. The product is not yet in Local core. The enterprise tier features (approval workflows, role-based access, shared audit log query) are not started. The "agency operator managing 200 client sites" target user can now create a backup from the dashboard and run bulk operations with error recovery — but cannot trigger a backup from CI/CD, cannot query the audit log to answer "who promoted staging to production last week", and cannot assign sites to team members.

The six "Aha Moments" defined in the requirements documents were all delivered according to the requirements coverage analysis. That verdict is accurate at the capability level. At the experience level, the honest position is:

- Fleet discovery works. A user with 50 sites can find the one that needs attention. (Delivered.)
- AI-powered fleet management works. 92 MCP tools covering the full WPE/Local surface. (Delivered, possibly over-delivered — 92 tools is hard to navigate.)
- Conversational automation works. CLI bulk operations with error recovery and --resume. (Delivered.)
- Unified site mental model works. The Digital Twin with freshness tracking gives coherent state. (Delivered with caveats around staleness and CAPI fallbacks.)
- Cross-site visibility works. Fleet health dashboard, stats, scheduled checks. (Delivered.)
- Effortless WordPress AI works for the Local-only case. (Delivered. Less seamless for WPE remote sites.)

Where the original vision positioned a platform ready for agency pilots at scale, the current product is better described as production-ready for a technically sophisticated single user, with the foundation for agency scale present but not yet complete. That is not a failure of the sprint — it is an accurate reading of what one sprint can accomplish. The next sprint's scope is clear.
