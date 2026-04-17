# Feature Completeness Analysis

**Date:** April 16, 2026  
**Version:** Nexus AI v0.x (post-WPE Full Coverage)  
**Status:** Comprehensive feature audit with actionable gap prioritization  

---

## Executive Summary

Nexus AI is feature-rich in **read-heavy operations** (query, report, diagnose, compare) across both Local and WPE environments. However, several capability gaps exist in:

1. **Discoverability** — New users can't discover what's possible without docs or a guided tour
2. **CLI/MCP parity** — Some operations only exist in CLI or MCP, not both
3. **Dashboard action gaps** — Dashboard is observation-only; most mutations require CLI/MCP
4. **Error recovery** — Generic error messages in many flows; no recovery suggestions for common failures
5. **Team workflows** — Assumes single-user machine; no role-based access control or audit logging
6. **Integration surface** — Limited REST API exposure; no webhooks or event feeds for automation
7. **Onboarding automation** — Manual steps required for multi-site setup; no batch onboarding

---

## 1. Capability Matrix: CLI / MCP / UI Coverage

This matrix shows which interface supports each major feature area.

### Legend
- ✅ Fully implemented
- ⚠️ Partial or limited implementation
- ❌ Not implemented
- 🔄 In progress (as of Apr 10)

| Capability | CLI | MCP | UI Dashboard | Notes |
|---|---|---|---|---|
| **Site Discovery & Status** |||||
| List local + WPE sites | ✅ | ✅ | ✅ | All three interfaces supported |
| Get site metadata (versions, plugins, posts) | ✅ | ✅ | ✅ | Full twin data available everywhere |
| Site health check (DB, filesystem, posts) | ✅ | ✅ | ⚠️ | DB health visible in Overview; site-specific health via CLI only |
| **Local Site Operations** |||||
| Create/delete/rename sites | ✅ | ✅ | ❌ | CLI + MCP only; UI requires external Local app |
| Start/stop/restart | ✅ | ✅ | ❌ | CLI + MCP only |
| Clone/export/import | ✅ | ✅ | ❌ | CLI + MCP only |
| Configure PHP/SSL/Xdebug | ✅ | ✅ | ❌ | CLI + MCP only |
| **WPE Install Operations** |||||
| List installs (all accounts) | ✅ | ✅ | ⚠️ | Listed in dashboard; no account-level drill-down |
| Create/delete installs | ✅ | ✅ | ❌ | CLI + MCP only |
| Promote environment | ✅ | ✅ | ❌ | Tier 3 destructive; CLI + MCP only |
| **Domain Management** |||||
| List domains per install | ✅ | ✅ | ❌ | CLI + MCP only |
| Create/delete domains | ✅ | ✅ | ❌ | Tier 2 + 3 ops; CLI + MCP only |
| Check DNS status | ✅ | ✅ | ❌ | CLI + MCP only |
| **SSL Certificate Management** |||||
| List certificates | ✅ | ✅ | ❌ | CLI + MCP; expiry flagged in fleet health |
| Request/import certs | ✅ | ✅ | ❌ | CLI + MCP only |
| Check expiry status | ✅ | ✅ | ⚠️ | Fleet-wide rollup in dashboard; per-cert details CLI only |
| **Backup & Disaster Recovery** |||||
| List backups | ✅ | ✅ | ❌ | CLI + MCP only |
| Create backup | ✅ | ✅ | ❌ | CLI + MCP only |
| Verify backup integrity | ✅ | ✅ | ❌ | CLI + MCP only |
| **Plugin Management** |||||
| List (local + remote) | ✅ | ✅ | ⚠️ | Fleet plugin inventory in dashboard; single-site via CLI/MCP |
| Update single / bulk | ✅ | ✅ | ❌ | CLI + MCP; no UI button for bulk update |
| Activate/deactivate | ✅ | ✅ | ❌ | CLI + MCP only |
| Install/uninstall | ✅ | ✅ | ❌ | CLI + MCP only |
| **Content Indexing & Search** |||||
| Semantic search across fleet | ✅ | ✅ | ✅ | Full parity; UI has search tab |
| Index a site | ✅ | ✅ | ⚠️ | UI shows index status; no button to reindex |
| Reindex fleet | ✅ | ✅ | ⚠️ | UI shows indexed count; CLI can batch reindex |
| AI context extraction | ✅ | ✅ | ✅ | All interfaces for indexing; MCP has deep extraction |
| **WordPress Core & WP-CLI** |||||
| Check WP version | ✅ | ✅ | ⚠️ | Visible in site details; no comparison tool in UI |
| Update WP core | ✅ | ✅ | ❌ | CLI + MCP only |
| Run WP-CLI commands | ✅ | ✅ | ❌ | CLI + MCP; no direct eval in UI |
| Database operations (export/import) | ✅ | ✅ | ❌ | CLI + MCP only |
| **Reporting & Analytics** |||||
| Fleet health summary | ✅ | ✅ | ✅ | Dashboard cards + CLI detailed report |
| WPE usage metrics (bandwidth, storage) | ✅ | ✅ | ⚠️ | Monthly rollup in dashboard; CLI has month drill-down |
| Plugin audit (outdated, unused) | ✅ | ✅ | ❌ | CLI command exists; not in UI |
| Version distribution analysis | ✅ | ✅ | ⚠️ | Fleet summary shows count; CLI has full distribution |
| **Account & User Management** |||||
| Manage WPE account users | ✅ | ✅ | ❌ | CLI + MCP only (Tier 2/3 operations) |
| View SSH keys | ✅ | ✅ | ❌ | CLI + MCP only |
| **Workflow Tools** |||||
| Go-live checklist | ✅ | ✅ | ❌ | CLI + MCP; no wizard in UI |
| Environment diff | ✅ | ✅ | ❌ | CLI + MCP only |
| Site diagnostics | ✅ | ✅ | ❌ | CLI + MCP; UI has health but not troubleshooting |
| Bulk operations (multi-site actions) | ✅ | ✅ | ❌ | CLI + MCP; UI has no batch action UI |

---

## 2. Local vs WPE Parity Gaps

Each operation category should work on both local sites and WPE installs (with appropriate adaptations).

| Operation | Local Support | WPE Support | Gap |
|---|---|---|---|
| **Metadata retrieval** | ✅ (WP-CLI when running; filesystem fallback) | ✅ (SSH WP-CLI) | None — good fallback behavior |
| **Plugin operations** | ✅ Direct WP-CLI | ✅ SSH WP-CLI | None — transparent parity |
| **Database operations** | ✅ Local DB access | ⚠️ SSH limited to export only | **Gap:** No selective import for WPE; no raw SQL execution remote |
| **Environment promotion** | ✅ Clone site | ✅ Promote environment | Different workflows; documented parity OK |
| **Backup operations** | ⚠️ Export snapshots only | ✅ Native WPE backups | **Gap:** Local has no native backup; only export |
| **Domain management** | N/A (localhost) | ✅ Full domain CRUD | **Gap:** Local sites have no domain concept; WPE-only feature |
| **SSL certificates** | ⚠️ Self-signed via Xdebug | ✅ LetsEncrypt native | **Gap:** Local self-signed; WPE managed — can't compare |
| **Usage metrics** | ⚠️ Disk usage only | ✅ Bandwidth, storage, visits | **Gap:** Local has no bandwidth/traffic metrics |
| **Version constraints** | ✅ User-controlled | ✅ Account-limited | **Gap:** Different constraint models; no unified version planning tool |

---

## 3. Dashboard vs CLI Gaps

The dashboard (`NexusOverview.tsx`) shows: Overview, Activity, Operations tabs.  
Below are the action-oriented capabilities CLI has that dashboard lacks.

### Overview Tab
**What's shown:**
- Fleet stats (total sites, running/halted, WPE connected)
- MCP server status (tools, port, version)
- Embedding model (ready/not ready, dimensions)
- Index coverage (local, WPE, total docs/chunks, last indexed)

**What's missing (CLI has):**
- 🔴 **No action buttons** — can't start a rescan, reindex, or refresh from dashboard
- 🔴 **No drill-down** — can't click a plugin to see which sites use it
- 🔴 **No wizard** — no guided flow for first-time setup (e.g. "link your WPE account")

### Activity Tab
**What's shown:**
- Event timeline (site starts, stops, sync events)
- Storage health (per-site disk usage trends)
- Top issues panel (stale twins, indexing failures)
- AI gateway usage (by caller)

**What's missing (CLI has):**
- 🔴 **No operation polling UI** — long-running tasks (fleet deep refresh, bulk reindex) don't show progress in dashboard
- 🔴 **No retry buttons** — if a sync fails, user must go to CLI
- 🔴 **No event filtering** — can't filter timeline by site or event type

### Operations Tab
**What's shown:**
- Bulk operations (plugin update, health check, compare sites)
- Site groups (create, manage)
- WPE sync controls (manual trigger, status)
- Database health scanner

**What's missing (CLI has):**
- 🔴 **No backup management** — can't list, create, or verify backups
- 🔴 **No domain/SSL UI** — go-live checklist is CLI-only
- 🔴 **No account management** — can't add/remove WPE users
- 🔴 **No promote workflow** — can't stage environment promotion in UI

---

## 4. Missing User Journeys

These end-to-end workflows lack UI support and require CLI or MCP chaining.

### A. Onboarding New Project (Local site → WPE)

**Ideal flow:**
1. Create local site
2. Run AI setup (plugins, features)
3. Index content
4. Create WPE staging + production
5. Link local to staging
6. Sync content
7. Go-live checklist
8. Promote to production

**What's available:**
- Step 1: UI (Local app) or CLI `nexus sites create`
- Step 2: CLI `nexus ai setup mysite` (MCP available)
- Step 3: CLI / MCP (Dashboard shows index status, no trigger)
- Steps 4-8: CLI / MCP only

**Gap:** UI should have a "New Project" wizard that chains these steps with progress tracking.

### B. Multi-Site Plugin Update with Verification

**Ideal flow:**
1. Find all sites with outdated plugin X
2. Preview what would change (versions, dependencies)
3. Batch update with dry-run first
4. Run health check after each update
5. Rollback if failures detected

**What's available:**
- Step 1: CLI `nexus fleet plugins` (MCP available)
- Step 2: CLI `nexus fleet compare` for pairs (MCP available; no batch diff)
- Step 3: CLI `nexus fleet plugin-update --dry-run` (MCP available)
- Step 4: CLI `nexus fleet health-check` (MCP available)
- Step 5: CLI requires manual rollback (no `--rollback-on-health-failure` flag)

**Gap:** No batch diff tool (compare 3+ sites at once). No automatic rollback trigger.

### C. Environment Diff → Promote → Verify

**Ideal flow:**
1. Show diffs: production vs staging (WP, PHP, plugins, domains, SSL)
2. Stage promotion (dry-run)
3. Execute with confirmation
4. Verify both environments post-promotion
5. Route traffic (update DNS or domain primary flag)

**What's available:**
- Step 1: CLI `nexus wpe environment-diff` (MCP available)
- Step 2: No dry-run for promotion; `wpe promote-environment` is Tier 3 only
- Step 3: CLI `nexus wpe promote --confirm` (MCP available; one-shot, no rollback)
- Step 4: CLI `nexus sites refresh` + `nexus sites get` (MCP available)
- Step 5: CLI `nexus wpe domain-add` + CLI `nexus wpe update-domain --primary` (MCP available)

**Gap:** No dry-run for promotion. No integrated post-promotion verification. No domain routing automation.

### D. Troubleshooting + Recovery (Failed Sync or Backup)

**Ideal flow:**
1. User reports: "Site X won't sync to WPE"
2. Run diagnosis (connectivity, permissions, conflicts, last successful state)
3. Get recovery options (retry, rollback, manual export)
4. Execute and confirm resolution

**What's available:**
- Step 1: User must describe the problem
- Step 2: CLI `nexus wpe diagnose <installId>` (MCP available; limited to pre-checks)
- Step 3: CLI has no recovery options menu; user must chain calls
- Step 4: Manual steps required

**Gap:** No diagnosis wizard in UI or CLI. No recovery assistant. No rollback tracking.

---

## 5. Onboarding & Discoverability Issues

### Problem 1: Hidden capabilities
- **CLI commands not listed in UI** — User opens Local addon, sees Overview/Activity/Operations tabs, has no idea `nexus fleet plugins`, `nexus wpe diagnose`, `nexus ai setup` exist
- **MCP tools not listed in help** — Running `nexus mcp setup` gives URL + auth token, but no tool directory
- **No in-app guidance** — Dashboard has no tooltips, popovers, or "Learn more" links

### Problem 2: Unclear what's needed first
- **Onboarding fork** — "Path A (MCP)" vs "Path B (AI in WordPress)" creates confusion
  - What if user wants both?
  - Are they mutually exclusive?
  - Which should you do first?
- **WPE auth not surfaced** — User installs addon, dashboard shows "0 WPE sites" with no prompt to "Link WPE account"
- **AI provider config hidden** — User might want AI features but doesn't see the "Configure AI" option in Preferences

### Problem 3: No guided setup flows
- **No wizard for first sync** — First `nexus fleet refresh --deep` with 10+ sites can take 5+ minutes; user has no status visibility
- **No bulk setup** — `nexus ai setup` works on one site; there's no `--all` flag for multi-site onboarding
- **No link suggestion** — Dashboard doesn't suggest "You could link this local site to WPE staging for safer testing"

### Problem 4: Discoverability in CLI
- **`nexus --help` is overwhelming** — Lists 13 command groups (sites, fleet, wp, wpe, ai, content, audit, doctor, mcp, sync, skills, blueprints, update) with no "getting started" path
- **No interactive tutorial mode** — `nexus tutorial` doesn't exist; no guided walkthrough of common workflows
- **Examples are scattered** — Multi-site examples are in docs, not in `--help` of individual commands

### Recommended fixes

| Issue | Quick win | Medium effort | Full solution |
|---|---|---|---|
| Hidden capabilities | Add "Tools" tab to dashboard listing all MCP tools | CLI tool directory command | In-app command search + help |
| Unclear needs | Add 1-minute setup quiz ("Are you syncing to WPE?") | Detect setup state and show prompts | Adaptive onboarding flow per journey |
| No guided setup | Add `--no-deep` flag to avoid long hangs | Progress bar for fleet refresh | "Setup wizard" command with checkpoints |
| CLI help overwhelm | Reorganize `--help` by use case | Add examples to each subcommand | Interactive tutorial mode (`nexus learn`) |

---

## 6. Error Handling Gaps

Nexus has good error detection but limited recovery guidance.

### A. Silent Failures
| Scenario | Current behavior | What users see | Should do |
|---|---|---|---|
| SSH key expired (WPE) | SSH call fails; tool returns generic error | "Failed to get install details" | Parse SSH error, suggest "run `nexus wpe diagnose` to check SSH connectivity" |
| WPE CAPI rate limit | HTTP 429 response | "API error" | Suggest "Wait 60s and retry; or switch focus to local sites" |
| Site halted when WP-CLI needed | Subprocess times out | "Plugin list failed" | Detect "not running" in metadata, suggest "start site with `nexus sites start` first" |
| Indexing OOM | Vector DB write fails | "Indexing failed" | Suggest "Reduce --batch-size or index fewer sites at once" |
| Missing install ID | User passes wrong site name | "Install not found" | Show 5 closest matches from `nexus wpe sites` |

### B. Partial Failures Not Surfaced
- **Fleet bulk operations** — `nexus fleet plugin-update mysite1 mysite2 mysite3` fails on site2; user gets "1/3 succeeded" with no rollback or retry logic
- **Multi-account WPE sync** — Account A syncs OK, Account B hits auth error; user doesn't know which one failed until checking the final summary
- **Batch indexing** — Sites 1-5 indexed, 6 OOM'd, 7-10 skipped; no obvious way to retry just site 6

### C. Recovery Paths Missing
| Failure mode | Current recovery | Ideal recovery |
|---|---|---|
| Plugin install fails (disk full) | User must manually free space | CLI detects space, suggests cleanup commands |
| WPE login expired | User must re-run `nexus wpe login` | Tools auto-detect 401, suggest re-auth in next step |
| Backup not found for promotion | Promotion blocked; user exports manually | Tool warns of backup age in pre-confirmation, offers to create one |
| Site domain conflicts | Create domain fails; user checks manually | Tool suggests available domain variations |

### Recommended fixes

**Tier 1 (do soon):**
1. Add `--verbose` flag to all tools; emit actionable hints on errors
2. Prefix error messages with recovery action: `"❌ Plugin install failed (disk full) — run: df -h && rm -rf /path/to/old/backups"`
3. Add `nexus troubleshoot` command that re-runs failed operations with debugging enabled

**Tier 2 (next sprint):**
1. Parse common SSH/API/subprocess errors and map to troubleshooting guides
2. Add `--on-error` flag for bulk ops: `--on-error=rollback` or `--on-error=continue`
3. Save partial results in case of failure; allow `--resume` to retry failed items

**Tier 3 (future):**
1. Add anomaly detection: flag unusual failure patterns (e.g., all WPE installs failing → likely auth issue)
2. Implement automatic retry with exponential backoff for transient failures
3. Add telemetry for common errors; surface in `nexus doctor` as "Your account typically has X% success rate on bulk updates; here's how to improve it"

---

## 7. Integration Opportunities Not Yet Seized

### A. REST API Exposure
**Current state:** MCP tools are internal; no public REST API.

**Opportunities:**
1. **Read-only REST API** for dashboard or external tools
   - `GET /api/v1/sites` — list all sites + twins
   - `GET /api/v1/fleet/health` — fleet summary
   - `GET /api/v1/search?q=...` — semantic search results
   - Would enable: third-party dashboards, monitoring tools, Slack integrations

2. **Event webhooks** for automation
   - `site.indexed` — when content indexing completes
   - `site.health.degraded` — when health check fails
   - `backup.created` — after backup succeeds
   - Would enable: Slack/Discord alerts, Zapier recipes, CI/CD triggers

### B. WordPress Native Integrations
**Current state:** AI features installed per-site via plugin; limited to title/summary/excerpt generation.

**Opportunities:**
1. **WP-CLI command set** registered as a real package
   - Users could run: `wp nexus fleet-health`, `wp nexus search "foo"` from any machine with WP-CLI
   - Would enable: cron jobs, post-hooks, server-side automation

2. **WordPress REST API endpoints** (per-site)
   - `GET /wp-json/nexus/v1/content-index` — search endpoint for custom blocks
   - `POST /wp-json/nexus/v1/generate-meta` — AI-powered meta generation for posts
   - Would enable: headless CMS workflows, third-party block plugins

3. **WordPress hooks** in Nexus plugin
   - `do_action('nexus_before_index_site')` — customize what gets indexed
   - `apply_filters('nexus_search_results', $results)` — post-process search
   - Would enable: plugin authors to extend Nexus behavior

### C. External Tool Integrations
**Current state:** Isolated system; no outbound integrations.

**Opportunities:**
1. **Slack App** for status notifications
   - `/nexus sites` — list sites
   - `/nexus plugin-audit` — outdated plugin report
   - Webhook for sync failures, SSL expiring, etc.

2. **GitHub Actions** for deployments
   - Trigger `nexus wpe promote production staging` from PR merge
   - Auto-update plugins after production promotion
   - Conditional based on site health

3. **Stripe integration** for billing-aware operations
   - Show MRR per site in `nexus wpe portfolio`
   - Warn when bulk operations affect high-revenue sites
   - Only allow critical ops during off-peak hours

4. **Datadog / New Relic agent** for APM
   - Surface Nexus operations in APM traces
   - Correlate plugin updates with performance changes
   - Alert on operations that degrade performance

### D. Mobile/Remote Access
**Current state:** CLI + desktop app only.

**Opportunities:**
1. **Mobile web dashboard** (read-only, authentication required)
   - Check fleet health while mobile
   - View alerts and failed operations
   - Would prevent: urgent support issues during off-hours

2. **Slack bot for emergencies**
   - `@nexus status mysite` → show health + recent activity
   - `@nexus rollback staging production` → with confirmation workflow
   - Would enable: faster incident response

---

## 8. Missing Capabilities by Feature Area

### A. Backup & Disaster Recovery
| Gap | Impact | Difficulty | Workaround |
|---|---|---|---|
| No backup scheduling | Can't automate pre-deployment backups | Medium | Manual `nexus wpe backup-verify` before each promote |
| No backup rotation policy | Manual cleanup needed; backup storage grows | Medium | CLI script to delete old backups |
| No point-in-time restore | Can't restore DB without exporting/importing manually | High | Export from WPE, import locally |
| No backup encryption at rest | WPE backups not encrypted on Nexus side | High | Use WPE account-level encryption settings |

### B. Content Staging & Preview
| Gap | Impact | Difficulty | Workaround |
|---|---|---|---|
| No content diffing across environments | Can't see what changed between staging/production | Medium | Manual inspection via WP admin |
| No content sync (posts only) | Can't sync posts without full database | Medium | Custom script using `wp post export` |
| No visual regression detection | Can't catch theme/CSS breaking changes | High | Manual testing or third-party screenshot tool |

### C. Performance Tuning
| Gap | Impact | Difficulty | Workaround |
|---|---|---|---|
| No plugin performance audit | Can't rank plugins by impact on load time | Medium | Manual testing with Query Monitor |
| No cache invalidation tracking | After update, unclear if caches cleared | Low | Manual `nexus wpe purge-cache` after each step |
| No slow query detection | Can't identify DB bottlenecks | Medium | SSH into WPE, run MySQL slow query log manually |

### D. Multi-Tenancy & Team Workflows
| Gap | Impact | Difficulty | Workaround |
|---|---|---|---|
| No role-based access (local machine) | Anyone with Local can run `nexus wpe promote` | Medium | Run on single-user machine; doc the risk |
| No audit log for destructive ops | Can't track who deleted what | Medium | Manual grep of CLI history |
| No approval workflows | Tier 3 ops don't require peer review | High | Manual code review + approval before running |
| No team site groups | Can't assign owners or on-call engineers | Medium | Manage via site naming convention |

### E. Monitoring & Alerting
| Gap | Impact | Difficulty | Workaround |
|---|---|---|---|
| No health check scheduler | Stale data between manual checks | Low | `0 */4 * * * nexus fleet health` in cron |
| No alert rules engine | Can't auto-notify on specific conditions | Medium | External monitoring tool polling the API (when available) |
| No SLA tracking | Can't report on uptime/update compliance | High | Manual spreadsheet |

---

## 9. Priority Matrix: Impact vs Effort

Addressing each gap by urgency and cost.

```
HIGH IMPACT + LOW EFFORT (DO FIRST)
├── Add reindex button to dashboard
├── Show error recovery suggestions (update error messages)
├── Add "Link WPE account" wizard to Preferences
├── Expose MCP tool directory in `nexus mcp list-tools`
└── Add `nexus troubleshoot` command for common failures

HIGH IMPACT + MEDIUM EFFORT (NEXT)
├── Dashboard Actions Tab (backup create, domain add, promote staging)
├── Fleet health auto-refresh (cron scheduler)
├── Batch diff tool for 3+ sites
├── CLI tool directory with search/filter
├── Error recovery decision tree (`--on-error=rollback` for bulk ops)
└── Webhook event emission (basic HTTP POST)

HIGH IMPACT + HIGH EFFORT (FUTURE)
├── UI wizard for "New Project" (local → WPE onboarding)
├── Role-based access control (machine-level or account-level)
├── Read-only REST API with auth
├── Slack integration (alerting + commands)
├── Point-in-time restore with backup versioning
└── Multi-site content diffing and selective sync

LOW IMPACT + LOW EFFORT (NICE-TO-HAVE)
├── Mobile-responsive dashboard
├── CLI examples in each command's help
├── Tool description improvements (fix critical ones in mcp-tool-context-quality.md)
└── More descriptive progress bars for long operations
```

---

## 10. Recommendation: Phased Closure Plan

### Phase 0 (This week)
**Goal:** Reduce friction for new users and improve error messaging.
- [ ] Update error messages with recovery suggestions (12 most common errors)
- [ ] Add `nexus mcp list-tools --filter plugin` to browse available MCP tools
- [ ] Fix critical tool descriptions (from `mcp-tool-context-quality.md`)
- [ ] Add "First run" detection: show setup wizard in dashboard on first load

### Phase 1 (Sprint N+1)
**Goal:** Improve dashboard usability and add missing CLI/UI bridging.
- [ ] Add reindex button to Index section of dashboard
- [ ] Add "Link WPE account" prompt in Preferences when CAPI unavailable
- [ ] Implement `--on-error` flag for `nexus fleet` bulk ops
- [ ] Add `nexus troubleshoot` command
- [ ] Improve WPE sync error reporting in dashboard

### Phase 2 (Sprint N+2)
**Goal:** Add missing action workflows in UI.
- [ ] "Backup & Verify" action in Operations tab
- [ ] "Create Domain" + "Manage SSL" in Operations tab
- [ ] "Go Live Checklist" as interactive modal
- [ ] "Promote Environment" with dry-run support
- [ ] Fleet-wide plugin update UI with health check integration

### Phase 3 (Sprint N+3+)
**Goal:** External integrations + team workflows.
- [ ] Read-only REST API (`/api/v1/sites`, `/api/v1/fleet/health`, `/api/v1/search`)
- [ ] Webhook event emission (site indexed, health failed)
- [ ] Slack integration (alerts + `/nexus` slash commands)
- [ ] Basic audit log (log all Tier 2/3 operations to file)

---

## 11. Appendix: Files Needing Updates

| File | Update type | Justification |
|---|---|---|
| `docs/planning/mcp-tool-context-quality.md` | Execute Phase 1 | Fix critical tool descriptions |
| `src/renderer/components/NexusOverview.tsx` | Add action buttons | Enable reindex, backup, domain creation in UI |
| `src/cli/commands/fleet.ts` | Add `--on-error` flag | Enable batch operation recovery |
| `src/cli/commands/doctor.ts` | Expand checks | Add recovery suggestions to all warnings |
| `docs-site/docs/getting-started/index.md` | Improve onboarding | Add setup quiz and clearer path selection |
| `src/main/mcp/instructions/server-instructions.ts` | Add workflow templates | Reference in instructions what workflows are available |
| `src/cli/commands/mcp.ts` | Add `list-tools` command | Enable tool discovery without docs |

---

## Summary Table: What's Missing

| Category | Missing | Who wants it | When | Impact |
|---|---|---|---|---|
| **UI/Dashboard** | Action buttons (reindex, backup, promote) | Power users, daily operators | Week 1 | High—moves from CLI-only to dashboard |
| **CLI/MCP parity** | Batch diff (3+ sites), dry-run promote | Staging teams, QA | Week 2 | Medium—mostly workaroundable |
| **Error recovery** | Actionable error messages, retry logic | Everyone | Week 1 | High—prevents user frustration |
| **Onboarding** | Setup wizard, guided flows | New users | Week 2 | Medium—affects first-day experience |
| **Integration** | REST API, webhooks, Slack bot | DevOps, automation users | Month 2 | Medium—unlocks external workflows |
| **Team features** | RBAC, audit log, approval workflows | Enterprise, multi-team orgs | Month 3 | Low—single-user majority happy |

---

**Report generated:** April 16, 2026  
**Completion status:** ~70% of core features; ~40% of integrations; ~10% of team/automation features  
**Suggested next review:** After Phase 1 closure (1-2 weeks)
