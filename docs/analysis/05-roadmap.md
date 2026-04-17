# Nexus AI — Forward Roadmap
*Starting from April 2026 state*

---

## Guiding Principles

**User value over feature count.** We have 127 CLI commands and 92 MCP tools. Adding more is not the problem. The problems are: users can't discover what's already there, errors don't tell users what to do, and the UI doesn't expose the operations that matter most. Prioritize finishing what's already built before extending the surface area further.

**Stability before scale.** The BulkOperationManager is untested and has known issues. The IPC handler file is 4,000 lines. API keys are stored in plain text. These are not cosmetic — they are blockers to safely running at agency scale (50-500 sites). Stabilization work is not optional maintenance; it is prerequisite to growth.

**Target the agency operator, not the solo developer.** The solo developer will figure things out; they read docs, they tolerate rough edges, they debug. The agency operator managing 200 client sites needs the product to teach itself. Every UX improvement should be evaluated from the perspective of someone who has 300 WPE sites and limited time to learn tooling.

**CLI-first is correct. Maintain it.** MCP tool proliferation is a real risk — 92 tools is already hard to navigate. The CLI gives AI agents a fallback when MCP is unavailable and gives human operators a reproducible, scriptable interface. Resist pressure to build UI for every operation; resist equally the pressure to keep adding MCP tools. The right interface for most operations is CLI.

**Tech debt is not a separate track.** Debt paydown must be woven into every sprint, not saved for a dedicated "cleanup sprint" that never arrives. Each phase below explicitly includes debt items alongside features.

---

## Phase 0: Stabilize (2 weeks)

**Goal:** Fix what's actively broken or dangerous before any new feature work.

### Security: Encrypt API keys at rest

**What:** Replace plain-text key storage in `RegistryStorage` with Electron's `safeStorage.encryptString()` / `safeStorage.decryptString()`. Stop transmitting full key values over IPC — renderer should only receive a masked version (e.g., `sk-ant-...xxxx`) and a boolean `isSet`. Store keys server-side only.

**Files:** `src/main/chat/chat-ipc-handlers.ts`, `src/renderer/components/NexusPreferences.tsx`, key-reading paths throughout ipc-handlers.ts.

**Acceptance:** API keys cannot be read from the Local data directory with a text editor. DevTools IPC inspection does not show full key values.

**Estimated days:** 3

**Debt paydown:** Eliminates Medium severity security issue. Wires AuditLogger to credential operations as part of implementation.

---

### Fix BulkOperationManager correctness issues

**What:** Replace `Promise.race()` with `Promise.allSettled()` in the concurrency loop so that all active promises are tracked correctly. Add a result cap (maximum stored results = MAX_CONCURRENCY × MAX_HISTORY) with LRU eviction. Add at least 10 unit tests covering: concurrency limit enforcement, per-site error isolation, memory does not grow unboundedly over 50+ operations, cancellation works mid-flight.

**Files:** `src/main/bulk/BulkOperationManager.ts`, new test file `tests/unit/bulk/BulkOperationManager.test.ts`.

**Acceptance:** 50-site bulk operation runs without memory growth observable between runs. Concurrent operations respect the MAX_CONCURRENCY limit. One failing site does not abort others. Tests pass.

**Estimated days:** 2

---

### Fix SQL column name interpolation in GraphService

**What:** Replace the two template-string SQL queries in `GraphService.ts` that interpolate column names into `pragma_table_info` queries with parameterized queries or a safe wrapper function.

**Files:** `src/main/events/GraphService.ts` lines 207-208 and 244.

**Acceptance:** No template string interpolation in SQL queries. The `hasColumn()` helper uses parameterized sqlite3 calls.

**Estimated days:** 0.25 (a few hours)

---

### Add GraphService migration safety

**What:** Wrap each `ALTER TABLE` migration in a transaction. Add a test suite that creates a fresh SQLite database, runs all migrations in order, and verifies the schema matches the expected structure after each step. Add a version check before running migrations to prevent double-application.

**Files:** `src/main/events/GraphService.ts`, new test file `tests/unit/events/GraphService.migrations.test.ts`.

**Acceptance:** Tests pass covering all 8+ migration steps. A failed migration does not leave the database in a partially-migrated state.

**Estimated days:** 2

---

### Begin type safety remediation — root types

**What:** Define three missing root-level interfaces that propagate `any` throughout the codebase: `NexusServices` (full interface for the service container), `SiteData` (Local's site data API surface), and typed `IpcHandlerDeps`. These three are the source of most downstream `any` usage.

**Files:** `src/main/types/nexus-services.ts` (new), `src/main/types/site-data.ts` (new), `src/main/ipc-handlers.ts`.

**Acceptance:** TypeScript compiler catches type errors in IPC handler code without casting. `any` count in ipc-handlers.ts and resolvers.ts reduced by at least 30%.

**Estimated days:** 3

**Debt paydown:** First step in eliminating the 1,161 `: any` instances. Enables the IPC handler decomposition in Phase 1 to be done safely.

---

### Phase 0 total: ~10 days (2 engineers, 1 week each)

---

## Phase 1: Usability Repair (4 weeks)

**Goal:** Fix the user-facing problems that cause the most friction for existing users. No new capabilities — only making what's already built accessible and comprehensible.

### Terminology normalization

**What:** Rename UI labels and CLI commands to use consistent, unambiguous language throughout.

Specific changes:
- "Sync Keys" → "Sync AI Credentials" (SiteNexusSection button)
- "Index Now" → "Index Content" (SiteNexusSection button)
- "Re-index" → "Update Index" (SiteNexusSection button)
- "Refresh" → "Refresh Metadata" (SiteNexusSection button)
- "Setup AI" → "Install AI Tools" (SiteNexusSection button)
- "WP Engine Auto-Sync" → "Auto-Sync WP Engine Metadata" (Preferences section header)
- "WPE SSH Refresh" → "Auto-Update WP Engine Site Info" (Preferences section header)
- "Halted Site Refresh" → "Refresh Offline Sites" (Preferences section header)
- CLI: `nexus content reindex` → `nexus content index` (with `reindex` as deprecated alias)
- CLI: remove "Twin data: None" messaging; replace with "Site data: Not available"
- CLI: remove all user-facing "twin" terminology; use "site data" or "site snapshot"

**Files:** `SiteNexusSection.tsx`, `NexusPreferences.tsx`, `src/cli/commands/content.ts`, `src/cli/commands/sites.ts`.

**Acceptance:** A user who reads the UI labels can correctly predict what each button does without reading documentation. CLI and UI use the same verb for each operation.

**Estimated days:** 2

---

### Add action confirmations and status feedback

**What:** Every button action and toggle change in the UI produces visible feedback. Implement a lightweight toast system if Local doesn't provide one, or use Local's native toast if available.

Specific feedback to add:
- "Index Content" completion → "Indexed 1,234 documents in 2 min 18 sec"
- "Refresh Metadata" completion → "Metadata updated — WordPress 6.5.2, 23 plugins"
- "Sync AI Credentials" completion → "Credentials synced successfully" (or error with count)
- "Install AI Tools" completion → "AI tools installed and ready"
- Any Preferences toggle → brief "Saved" indicator (3 seconds)
- Any Preferences field save → "Saved" (3 seconds, dismisses automatically)

**Files:** `SiteNexusSection.tsx`, `NexusPreferences.tsx`, `NexusOverview.tsx`, `BulkOperationsPanel.tsx`.

**Acceptance:** Every button action produces visible confirmation within 500ms of completion. No action silently succeeds or silently fails without user notification.

**Estimated days:** 2

---

### Add inline tooltips to all interactive elements

**What:** Add hover tooltip text to every button, toggle, and status label in the UI. Content should be 1-2 sentences describing what the operation does and when to use it.

Priority tooltips:
- "Index Content: Creates a searchable database of posts, pages, and products using AI. Run after adding content to your site."
- "Refresh Metadata: Updates WordPress version, plugin list, themes, and admin email from the live site."
- "Sync AI Credentials: Sends your AI provider API key to this WordPress site so AI features work in wp-admin."
- "Install AI Tools: Installs the WordPress AI plugin and configures it with your provider credentials. Requires WordPress 7.0+."
- Status label "Stale": "This data is more than 24 hours old. Click Refresh Metadata to update it."
- Status label "Indexed": "Content is indexed for semantic search. Re-index if you've published new content."

**Files:** `SiteNexusSection.tsx`, `NexusPreferences.tsx`, `BulkOperationsPanel.tsx`.

**Acceptance:** Hovering over any button or status label shows a descriptive tooltip. A new user can understand what each control does without leaving the UI.

**Estimated days:** 2

---

### Add error recovery guidance

**What:** For the 12 most common error scenarios, add actionable guidance to error messages. The pattern is: state what failed, identify the likely cause, suggest the specific next step.

Priority errors to handle:
- "Install AI Tools" fails → "Check that the site is running. Start it from Local, then try again. If it's running, check that the plugins directory is writable."
- "Sync AI Credentials" fails with auth error → "Your API key may be invalid. Re-enter it in Preferences."
- SSH authentication failure → "Run `nexus wpe diagnose <install-id>` to check your WP Engine SSH connectivity."
- WPE CAPI rate limit (429) → "WP Engine rate limit reached. Wait 60 seconds and try again, or switch to local site operations."
- Site halted when WP-CLI needed → "This operation requires the site to be running. Start it from Local first."
- "Index Content" fails with OOM → "Try indexing fewer sites at once, or reduce the batch size with `nexus content index --batch-size 50`."
- WPE auth expired → "Your WP Engine session has expired. Run `nexus wpe login` to re-authenticate."
- Plugin install fails (disk full) → "Your disk may be full. Run `df -h` to check available space."

**Files:** `SiteNexusSection.tsx`, IPC handler error responses, MCP tool error responses.

**Acceptance:** All 12 target error scenarios show actionable guidance. User does not need to search documentation to recover from a common failure.

**Estimated days:** 2

---

### Add first-run onboarding card

**What:** When the addon loads for the first time (or has never completed setup), show a dismissible "Getting Started" card in the Dashboard Overview tab. Show it only until dismissed; never show again after dismissed.

Card content:
- Step 1: Configure your AI provider in Preferences (link to Preferences)
- Step 2: Enable auto-indexing so new content is indexed automatically (link to Preferences)
- Step 3: Go to a site and click "Install AI Tools" to set up WordPress AI features

Track completion state in `RegistryStorage` as `onboardingDismissed: boolean`.

**Files:** `NexusOverview.tsx`, IPC channels for onboarding state, `RegistryStorage`.

**Acceptance:** New users see the card on first load. Card links work. Card is dismissible and does not reappear after dismissal. Returning users never see it.

**Estimated days:** 1.5

---

### Preferences reorganization

**What:** Group Preferences settings into logical sections with visual separation. Collapse lower-priority sections by default.

Section structure:
- Section 1: "AI Provider" — provider picker, model picker, API key input, key validation (always visible)
- Section 2: "Local AI Gateway" — gateway toggle (collapsed by default)
- Section 3: "Auto-Indexing" — enable toggle, excluded sites list (collapsed by default)
- Section 4: "WP Engine" — credentials, auto-sync, SSH update interval, offline site refresh (collapsed by default)
- Section 5: "Advanced" — any remaining settings (collapsed by default)

**Files:** `NexusPreferences.tsx`.

**Acceptance:** A new user can find the AI provider settings within 30 seconds without scrolling. Section groupings make the logical organization obvious.

**Estimated days:** 1.5

---

### Fix "Requires WP 7.0+" button text

**What:** When `canSetupAI` is false, render a disabled button with label "Install AI Tools" and a tooltip explaining the requirement. Remove "Requires WP 7.0+" as button label text.

**Files:** `SiteNexusSection.tsx` line 705.

**Acceptance:** The Setup AI button is always labeled "Install AI Tools". When unavailable, it is visually disabled with a tooltip: "Requires WordPress 7.0 or later. Upgrade WordPress first."

**Estimated days:** 0.5

---

### Per-site panel progressive disclosure

**What:** Collapse the lower-priority rows in SiteNexusSection behind an expandable "More Details" section. Always visible: index status, AI provider state, WordPress version. Collapsed by default: document count, chunk count, last indexed timestamp, database health row, AI plugin status detail, gateway status, AI context file.

**Files:** `SiteNexusSection.tsx`.

**Acceptance:** The per-site panel shows 3-4 rows by default. Advanced details are available but not forced on users who don't need them.

**Estimated days:** 1.5

---

### IPC handler decomposition (partial)

**What:** As part of Phase 1 (not separate cleanup sprint), extract 20-30 of the highest-risk IPC handlers from `ipc-handlers.ts` into modular files. Priority: all credential-related handlers, all bulk operation handlers, all WPE sync handlers.

**Files:** New `src/main/ipc/handlers/credentials.ts`, `src/main/ipc/handlers/bulk.ts`, `src/main/ipc/handlers/wpe.ts`. Update `ipc-handlers.ts` to import from these.

**Acceptance:** The three extracted modules can be unit tested independently. `ipc-handlers.ts` decreases in line count by at least 500 lines.

**Estimated days:** 3

**Debt paydown:** First increment of the 4,000-line IPC handler decomposition.

---

### Phase 1 total: ~20 days (4 weeks with 1 engineer)

---

## Phase 2: Feature Completeness (6-8 weeks)

**Goal:** Deliver the capability gaps that matter most for the target user — an agency managing 50-500 WPE sites. Focus on workflows that are currently CLI-only but belong in the dashboard, and on error recovery that requires backend changes.

### Week 1-2: Dashboard action buttons

**What:** Add action buttons to the Operations tab for the operations users most frequently need to trigger manually. Each button should confirm before executing, show progress while running, and show result on completion.

Actions to add:
- "Reindex All Running Sites" — triggers fleet-wide indexing, shows per-site progress
- "Create WPE Backup" — prompts for install selection, creates backup, shows confirmation
- "Sync WPE Metadata Now" — triggers immediate WPE sync rather than waiting for cron

For each button: loading state, progress display, success toast, error display with recovery guidance.

**Files:** `NexusOverview.tsx`, relevant IPC handlers, new progress tracking components as needed.

**Acceptance:** Agency user can trigger the three most common fleet operations from the dashboard without opening the CLI.

---

### Week 2-3: Go-live checklist UI

**What:** Implement the go-live checklist as an interactive modal in the dashboard. The checklist covers: SSL certificate status, domain configuration, PHP version, WordPress version, plugin security audit, backup verification, environment diff.

Each item shows: pass/fail status, what was checked, link to fix if failing. The checklist can be run per-site or per-install.

**Files:** New `GoLiveChecklist.tsx` component, backing MCP tools already exist for most checks.

**Acceptance:** User can launch checklist for any WPE install from the dashboard. All items show clear pass/fail with fix guidance. Checklist result can be exported as a text summary.

---

### Week 3-4: Fleet-level plugin operations in UI

**What:** Add a plugin management panel to the Operations tab that lists outdated plugins across the fleet, allows selecting which sites to update, and runs batch updates with health checks.

Flow:
1. Show table: plugin name, current version, latest version, affected sites, update available
2. User selects plugins and sites to update
3. Dry-run shows what would change
4. Execute with per-site progress tracking
5. Post-update health check per site
6. Summary: succeeded, failed (with reason), health check results

**Files:** `NexusOverview.tsx`, `BulkOperationsPanel.tsx`, new plugin fleet panel component.

**Acceptance:** Agency user can identify and batch-update outdated plugins across 10+ sites without CLI. Dry-run works before committing.

---

### Week 4-5: `--on-error` flag for bulk CLI operations

**What:** Add `--on-error=continue|rollback|stop` flag to all `nexus fleet` bulk commands. Default: `continue` (current behavior). `stop` halts the fleet operation on first failure. `rollback` is a stretch goal for operations that support it.

Also add `--resume` support: if a bulk operation is interrupted, save the list of completed/failed/pending sites to a state file, allow re-running with `--resume` to retry only failed/pending sites.

**Files:** `src/cli/commands/fleet.ts`, `BulkOperationManager.ts`.

**Acceptance:** `nexus fleet plugin-update --on-error=stop` halts on first failure. `nexus fleet plugin-update --resume` retries only sites that didn't succeed in the previous run.

---

### Week 5-6: Improved WPE sync error reporting

**What:** The WPE sync dashboard panel currently shows sync progress but minimal error detail. Add:
- Per-account error display (which account failed, with what error)
- Per-site error display (which sites within an account failed)
- Direct retry button for failed accounts/sites
- "Copy error details" for support escalation

**Files:** WPE sync UI components in `NexusOverview.tsx`, WPESyncService error handling.

**Acceptance:** When WPE sync partially fails, user can see exactly which account/sites failed and why, and retry just the failures without re-running the entire sync.

---

### Week 6-7: `nexus troubleshoot` CLI command

**What:** A new CLI command that re-runs the most recent failed operation with verbose debugging enabled, shows expanded diagnostics, and suggests specific remediation steps.

Also expand `nexus doctor` to include:
- Check for disk space (warn if < 1GB available)
- Check for WPE CAPI rate limit history
- Check for stale twins (fleet-wide count)
- Check for any IPC handler errors in the last session log
- Recovery suggestion for every warning/failure

**Files:** `src/cli/commands/doctor.ts`, new `src/cli/commands/troubleshoot.ts`.

**Acceptance:** `nexus doctor` output includes a specific fix command for every warning and failure. `nexus troubleshoot` reproduces the last failure with debug logging.

---

### Week 7-8: Type safety and IPC decomposition completion

**What:** Complete the IPC handler decomposition started in Phase 1. Extract remaining handlers into modular domain files. Complete type annotation for the five highest-`any`-density files.

Target by end of Phase 2:
- `ipc-handlers.ts` below 1,500 lines (from 4,001)
- `resolvers.ts` split into queries/mutations/helpers
- `any` count reduced from 1,161 to below 500
- BulkOperationManager, GraphService, WPESyncService each have integration tests

**Debt paydown:** These are not background cleanup tasks — they are prerequisite to safely extending the product in Phase 3. Do not start Phase 3 without completing this work.

---

### Phase 2 total: 6-8 weeks with 1-2 engineers

---

## Phase 3: Scale & Integration (Quarter 2)

**Goal:** Deliver the features that change who can use Nexus and how. REST API unlocks external automation. Team features unlock enterprise agency sale. Scheduled health checks unlock proactive monitoring.

### Read-only REST API

**What:** Expose a read-only REST API from the Electron main process. Initial endpoints:

- `GET /api/v1/sites` — list all sites (local + WPE) with twin completeness
- `GET /api/v1/sites/:id` — single site detail
- `GET /api/v1/fleet/health` — fleet health summary
- `GET /api/v1/search?q=...&limit=...` — semantic search results
- `GET /api/v1/fleet/plugins` — all plugins across fleet with versions

Authentication: Bearer token (same mechanism as MCP server). The token is generated in Preferences and shown once.

The API is intended for external tools: monitoring dashboards, Slack bots, GitHub Actions, cron-based reporting scripts.

**Not in scope for initial REST API:** Write operations, bulk mutations, site management. Those stay CLI/MCP.

**Files:** New `src/main/rest/RestApiServer.ts`, endpoint handlers per domain, auth middleware.

**Estimated effort:** 2 weeks

---

### Webhook event emission

**What:** Allow users to configure HTTP webhook endpoints that receive a POST request when key events occur. Initial event types:

- `site.indexed` — content indexing completed (payload: site ID, doc count, duration)
- `site.health.degraded` — health score dropped below threshold (payload: site ID, score, issues)
- `wpe.sync.failed` — WPE metadata sync failed for an account (payload: account, error)
- `backup.created` — WPE backup completed (payload: install ID, backup ID)
- `plugin.update.available` — new plugin update detected during fleet scan

Webhook configuration: URL + optional secret for HMAC signature verification. Store in Preferences.

**Files:** New `src/main/webhooks/WebhookEmitter.ts`, Preferences UI additions.

**Estimated effort:** 1 week

---

### Fleet health scheduler

**What:** Allow users to configure automatic fleet health checks on a schedule (every 4h, 8h, 24h). Health check results are stored in the event log and trigger webhooks if configured. Show scheduled check history in the Activity tab.

This replaces the suggestion in feature-gaps to use cron — it should be built into the product.

**Files:** New scheduler service, `NexusPreferences.tsx` additions, Activity tab updates.

**Estimated effort:** 1 week

---

### Basic audit log for destructive operations

**What:** Log all Tier 2 and Tier 3 operations (create backup, delete domain, promote environment, install/uninstall, etc.) to a local audit file at `~/Library/Application Support/Local/nexus-ai/audit.log`. Include: timestamp, operation, site/install target, parameters, outcome.

Expose with `nexus audit list` and `nexus audit export`.

This does not require user accounts or network — it is a local audit trail for teams that share a machine or need change records for client accountability.

**Files:** New `src/main/audit/OperationAuditLog.ts`, wire into MCP tools for Tier 2/3 operations, CLI commands.

**Estimated effort:** 1 week

---

### WPE deeper integration: environment diff and promote workflow

**What:** The promote workflow is currently a single Tier 3 command with no dry-run and no post-promotion verification. Build a guided promote flow:

1. Show environment diff: WP version, PHP version, plugin list delta, domain list, SSL status
2. Pre-promotion checklist: backup exists? domains pointing correctly? health check passes?
3. Confirmation with explicit warning about irreversibility
4. Execute promotion
5. Post-promotion verification: health check on both environments

Both CLI (`nexus wpe promote --guided`) and dashboard wizard.

**Files:** New promote workflow components, environment diff tool (partial exists, needs completion).

**Estimated effort:** 2 weeks

---

### Digital twin roadmap completion

**What:** Complete the remaining items from `docs/planning/digital-twin-roadmap.md`:

- **Phase 2.3:** `canAnswer()` adoption in all tools that read twin data — tools surface confidence level and staleness reason to user rather than presenting old data as current.
- **Phase 3.3:** Staleness check in `siteStarted` lifecycle hook — skip full WP-CLI enrichment if twin is < 4 minutes old.
- **Phase 3.4:** Surface `site_usage` data (bandwidth/visits/storage) in `nexus sites get` for WPE-linked sites.
- **Phase 4:** `nexus fleet summary`, `nexus fleet plugins`, `nexus fleet plugins --search` all answered from twin cache without live WP-CLI or CAPI calls.
- **Phase 5 remaining:** Unified `nexus sites list` showing local + WPE in one list. Scheduled SSH refresh for WPE sites. MySQL version from SSH for WPE twins.

**Files:** Multiple tools, `SiteDigitalTwinService.ts`, CLI command files.

**Estimated effort:** 3 weeks total across Phase 3

---

### Phase 3 total: approximately one quarter with 1-2 engineers

---

## Phase 4: Platform (Quarter 3+)

These items change the nature of the product. They are worth planning now but should not be started until Phase 3 is complete and the user base has validated demand.

### Ship in Local core

**What:** Move Nexus from third-party addon to first-party feature in Local. User experience: "Enable AI Features" checkbox in Local Preferences. No separate npm install. Auto-configures MCP for Claude Desktop on enable. Downloads platform-specific binary on first enable.

This requires internal alignment with the Local product team, agreement on the quality bar for first-party features, and coordination with Local release cycles. The strategic case is clear (10M+ instant users, no installation friction) but the organizational path requires separate work.

**Prerequisite:** Phase 0-2 complete. Product must be stable and have minimal onboarding friction before shipping to 10M users.

---

### Enterprise tier: team features

**What:** Features that unlock the enterprise agency sale:

- **Approval workflows:** Tier 3 operations require a second confirmation from a designated approver before executing. Approver can be the same machine (PIN-based) or a separate device (webhook-based).
- **Role-based access:** Define "operator" vs "admin" roles with different operation permissions.
- **Shared site groups:** Site group configuration stored in a shared config file (git-committable) rather than local machine state.
- **White-label dashboards:** Agency can configure their brand name and color in a client-facing export of fleet health reports.

**Prerequisite:** REST API and audit log from Phase 3.

---

### CLI as product: `nexus learn` and interactive onboarding

**What:** An interactive tutorial mode that walks users through common workflows with real examples on their actual sites. Not a demo — actual operations with undo support.

```
nexus learn
> Welcome to Nexus AI. Let's try 3 things together.
> 1. Finding sites that need updates
> 2. Running a fleet health check
> 3. Setting up AI on a site
> Press Enter to start, or Ctrl+C to exit.
```

**Prerequisite:** Stable CLI API (don't build tutorials for an API that will change).

---

### Ollama integration deepening

**What:** The current Ollama integration detects and lists models. Expand to:
- Recommended models by use case (code, content, analysis)
- Hardware-aware model selection (detect RAM, GPU, recommend accordingly)
- Integration with the fleet search workflow (use local model for classification, not just chat)
- Auto-download recommended models on first Ollama enable

---

### MCP tool rationalization: "Nexus Lite" path

**What:** As STRATEGIC_ANALYSIS.md notes, 92 MCP tools is a lot. Identify the 20 tools that deliver 80% of the value and mark the others as "advanced". Build a `nexus mcp setup --lite` option that configures only the core 20 tools. This improves AI agent context efficiency and reduces confusion for new MCP users.

The strategic analysis is correct: don't over-invest in MCP tooling when CLI + REST API cover most use cases.

---

## What NOT to Build

**Mobile app / mobile-responsive dashboard.** The target users are on desktops with Local running. A mobile app is a distraction. The REST API enables mobile access for those who want it without building a native app.

**Stripe billing integration.** Interesting but a product management distraction. If billing-aware operations become necessary, it belongs in the enterprise tier after validating demand.

**Competing with ManageWP/MainWP on their terms.** We do not need a full hosting control panel with every WPE operation exposed in the UI. The dashboard should show what needs attention and allow the most common actions. Complex operations belong in the CLI where they can be scripted.

**More MCP tools until the existing ones are better.** The gap is not tool count. The gap is tool quality (descriptions, error messages, recovery guidance) and discoverability. Fix existing tools before adding more.

**WordPress plugin ecosystem features.** The AI Experiments plugin and provider plugin are sufficient. Nexus is not a WordPress plugin framework.

**Incremental indexing.** Full reindex is fast enough (2.7 seconds for 500 posts). Incremental indexing adds significant complexity for marginal benefit. The event system handles real-time updates adequately.

---

## Success Metrics

### Phase 0 success
- API keys are encrypted at rest (verifiable: `cat` the storage file, no plaintext keys)
- BulkOperationManager test suite passes; known `Promise.race` issue resolved
- Zero template-string SQL interpolation in GraphService
- TypeScript compiler finds at least 5 previously-invisible type errors after root type definitions

### Phase 1 success
- A new user can complete "index a site and find content in semantic search" in under 10 minutes without reading documentation
- Every button action produces visible feedback within 500ms
- When "Install AI Tools" fails, user sees the specific likely cause and concrete next step
- CLI and UI use the same verb for every common operation

### Phase 2 success
- Agency operator can trigger fleet-wide plugin updates from the dashboard without CLI
- `ipc-handlers.ts` is below 1,500 lines with modular handler files
- `any` annotation count below 500
- BulkOperationManager, GraphService, WPESyncService each have integration test coverage

### Phase 3 success
- At least one external integration is live using the REST API (Slack bot, GitHub Action, or monitoring dashboard)
- All Digital Twin roadmap phases 2.3 through 5 are complete
- Fleet health check runs automatically on user-configured schedule

### Phase 4 success
- Nexus is available as a first-party Local feature (requires separate organizational milestone)
- Enterprise tier has at least one paying agency customer

---

## Tech Debt Paydown Plan

Tech debt is distributed across phases rather than isolated in a cleanup sprint:

**Phase 0 (2 weeks):** Security (key encryption), correctness (BulkOperationManager), database safety (migration tests, SQL injection pattern), type foundations (NexusServices, SiteData types).

**Phase 1 (4 weeks):** IPC handler decomposition begins — 500+ lines extracted to domain modules. Type annotation continues — `any` reduced in handler and resolver files as a natural part of modifying those files for UX work.

**Phase 2 (6-8 weeks):** IPC handler decomposition completes. Resolver decomposition. Integration tests for BulkOperationManager, GraphService, WPESyncService. `any` count below 500 target. LocalServicesBridge split begins.

**Phase 3 (1 quarter):** LocalServicesBridge split completes. REST API and webhooks introduce clean new abstractions that set the pattern for new code. `any` count continues downward organically.

**Ongoing:** Every PR that touches a file with `any` annotations reduces the count in that file. Every new handler is written in the modular directory structure. No new tech debt is introduced deliberately — debt grows only when speed genuinely requires it, and is logged when it does.

The target by end of Phase 2 is a codebase where the most dangerous risks (untested concurrency, plain-text keys, type-unsafe interfaces) are resolved and the most unmaintainable structures (4,000-line files) are decomposed. Perfect is not the goal; safe and maintainable is.
