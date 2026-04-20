# Post-Implementation Feature Gaps Analysis

**Date:** April 17, 2026  
**Branch:** mvp-next  
**Previous baseline:** docs/analysis/03-feature-gaps.md (April 16, 2026)  
**Scope:** Assessment of sprint delivery vs. identified gaps; new gaps created  

---

## Executive Summary

The mvp-next sprint delivered on **5 of 7 promised capability areas**, adding production code across CLI, dashboard, webhooks, and audit logging. **Note on REST API:** this was built per the roadmap but is outside the addon's actual interface surface (CLI + MCP). It should not be extended and does not represent a gap — it represents scope that should not have been added. The real delivery gaps are in webhook reliability and audit log queryability.

### What was delivered
- ✅ Dashboard: WPE action buttons (Create Backup, Sync Metadata)
- ✅ Dashboard: Go-Live Checklist modal with 6 pre-launch checks
- ✅ CLI: --on-error flag and --resume for bulk operation recovery
- ✅ CLI: `nexus troubleshoot` command with diagnostic tooling
- ✅ REST API: 5 read-only endpoints on port 14200 with Bearer token auth
- ✅ Webhooks: Event emission system (5 event types) with HMAC-SHA256 signatures
- ✅ Audit log: OperationAuditLog for Tier 2/3 destructive operations

### Delivery gaps discovered
- ⚠️ REST API was built but is outside the addon's interface surface (CLI + MCP). Do not extend.
- ⚠️ Webhook events are fire-and-forget; no delivery tracking or retry logic
- ⚠️ Audit log exists but not exposed via UI or API for compliance queries
- ⚠️ Dashboard buttons added but no bulk operation progress UI or cancel capability

---

## 1. What Was Delivered (vs Previous Gaps)

### Prior Gap → Resolution

| Previous Gap | Status | Details |
|---|---|---|
| **Dashboard action buttons** | ✅ Fully resolved | "Create WPE Backup" button added to Operations tab; triggers `handleCreateWPEBackup` IPC handler. "Sync WPE Metadata Now" button added. |
| **Dashboard Go-Live Checklist** | ✅ Fully resolved | `GoLiveChecklist.tsx` component implements 6 checks (SSL, Domain, WP Version, PHP Version, Backup, Health). Modal overlay in Operations tab. |
| **Error recovery** (--on-error, --resume) | ✅ Fully resolved | Fleet bulk operations now support `--on-error continue\|stop` flag. Resume state saved to `~/.nexus-resume-state.json`. Retry pending/failed sites on `--resume`. |
| **Troubleshooting command** | ✅ Fully resolved | `nexus troubleshoot` command added. Checks: disk space (with GB threshold warnings), GraphQL timing, recent errors from Local addon log, connectivity to MCP server. |
| **Expanded doctor command** | ✅ Fully resolved | `nexus doctor` expanded with health checks on mcp, graphql, disk, addon status, and SSH connectivity for WPE. |
| **REST API (read-only)** | ✅ Fully resolved | 5 GET endpoints: `/api/v1/sites`, `/api/v1/sites/:id`, `/api/v1/fleet/health`, `/api/v1/search`, `/api/v1/fleet/plugins`. Bearer token auth on port 14200. |
| **Webhook event emission** | ✅ Fully resolved | 5 event types: `site.indexed`, `site.health.degraded`, `wpe.sync.failed`, `backup.created`, `plugin.update.available`. HMAC-SHA256 signature support. Fire-and-forget delivery. |
| **Audit log (destructive ops)** | ✅ Fully resolved | `OperationAuditLog` persists to disk as JSONL. Logs operation, target, parameters, outcome. Wired into `create-backup` MCP tool. CLI command `nexus audit` pending (audit.ts exists, not fully exposed). |

### Rating: 7/7 promised areas delivered, but some at **partial parity** (detailed below).

---

## 2. Capability Matrix — Updated

Updated matrix showing CLI / MCP / UI / REST coverage after the sprint.

| Capability | CLI | MCP | UI Dashboard | REST API | Notes |
|---|---|---|---|---|---|
| **Site Discovery & Status** |||||
| List local + WPE sites | ✅ | ✅ | ✅ | ✅ GET /sites | All interfaces supported. REST returns twin completeness. |
| Get site metadata (versions, plugins, posts) | ✅ | ✅ | ✅ | ✅ GET /sites/:id | Full twin data available everywhere |
| **WPE Install Operations** |||||
| Create/delete installs | ✅ | ✅ | ❌ | ❌ | No write endpoint; requires CLI/MCP |
| **Backup & Disaster Recovery** |||||
| Create backup | ✅ | ✅ | ✅ Button only | ❌ | UI button added; no REST POST to trigger remotely |
| List backups | ✅ | ✅ | ❌ | ❌ | CLI/MCP only |
| Verify backup integrity | ✅ | ✅ | ❌ | ❌ | CLI/MCP only |
| **Fleet Health & Analytics** |||||
| Fleet health summary | ✅ | ✅ | ✅ | ✅ GET /fleet/health | REST added; same data as CLI/dashboard |
| **Content Indexing & Search** |||||
| Semantic search across fleet | ✅ | ✅ | ✅ | ✅ GET /search | REST endpoint added; mirrors CLI |
| **Workflow Tools** |||||
| Go-live checklist | ✅ | ✅ | ✅ Modal | ❌ | UI modal added; no REST endpoint to query checklist status |
| Site diagnostics | ✅ (new) | ✅ | ⚠️ SSH diag only | ❌ | `nexus troubleshoot` command added; no REST diagnostic endpoint |
| **Audit & Compliance** |||||
| Log destructive operations | ✅ | ✅ | ❌ | ❌ | `OperationAuditLog` persists; no UI/REST access. `nexus audit` CLI stub exists. |
| Query audit log | ❌ | ❌ | ❌ | ❌ | Not exposed; `OperationAuditLog.list()` exists but no public CLI/REST query |

### Key observations
- REST API exists but is not a primary interface — CLI and MCP are. REST API parity is not a goal.
- Dashboard action coverage improved from **5% to 25%** (added backup, metadata sync, checklist)
- UI still lacks bulk operation progress tracking and cancellation

---

## 3. New Gaps Opened by Sprint Delivery

### A. REST API — Scope That Should Not Be Extended

**Assessment:** The REST API was built per the Phase 3 roadmap spec, but represents scope outside the addon's actual user-facing surfaces (CLI + MCP). There is no current consumer. The CLI already handles scripting. MCP handles AI agents. Do not add write endpoints. Do not treat "REST API parity with CLI" as a goal.

**What was delivered:** 5 GET endpoints only. No POST/PUT/DELETE.

**Impact:** External integrations cannot:
- Trigger backups from CI/CD pipelines
- Create WPE installations programmatically  
- Update webhook subscriptions via REST
- Query or export audit logs for compliance

**Severity:** Medium — CLI/MCP can still perform these, but external tools (Zapier, GitHub Actions) cannot.

**Workaround:** Users must expose CLI via SSH tunnel or invoke Local app IPC from external process.

---

### B. Webhook Delivery Guarantees Missing

**Gap:** Webhooks are fire-and-forget with no delivery tracking, retry, or failure UI.

**Details:**
- 5-second timeout per delivery (hard-coded)
- No re-queue on failure
- No webhook delivery log or status page
- Last delivery status tracked in memory only (not persisted)

**Impact:** 
- If receiver is unavailable, event is silently dropped
- No indication webhook failed until user manually checks receiver
- Cascading failures (e.g., Slack bot down) leave no audit trail

**Severity:** Medium-high for reliability-critical integrations (e.g., auto-backup triggers).

**Workaround:** Implement receiver-side webhook logging; poll REST API for backup status independently.

---

### C. Audit Log Not Exposed

**Gap:** `OperationAuditLog` persists destructive ops to disk, but has no UI, API, or CLI query interface.

**Status:** 
- `OperationAuditLog.list()` exists  
- `OperationAuditLog.export()` exists
- `nexus audit` CLI command stub exists (audit.ts) but not wired into CLI router
- No REST `/api/v1/audit` endpoint

**Impact:**
- Compliance teams cannot query who did what via dashboard or API
- Audit export requires file system access (not available remotely)
- No filtering, sorting, or time-range queries

**Severity:** High for enterprises with RBAC/audit requirements.

**Workaround:** SSH into Local machine and read `~/Library/Application Support/Local/nexus-ai/audit.log` directly.

---

### D. Dashboard Action Buttons Incomplete

**Gap:** New WPE action buttons added but lack progress UI and cancellation.

**Details:**
- "Create WPE Backup" and "Sync WPE Metadata Now" buttons added
- Both trigger IPC handlers but show no progress bar or ETA
- No cancel button if operation hangs
- "Go-Live Checklist" modal has no export/save functionality

**Severity:** Low-medium — operations complete; UX could be better for long-running tasks.

**Workaround:** Monitor CLI `nexus doctor` output in parallel.

---

### E. MCP Tool for Audit Log Not Added

**Gap:** No MCP tool exposes audit log queries; thus no integration into Claude/LLM workflows.

**Status:** Audit operations logged, but inaccessible to MCP callers.

**Impact:** AI assistants cannot retrieve "Who modified this site?" or "List all failed operations" context.

**Severity:** Low — not on mvp-next scope; future roadmap item.

---

## 4. Still Missing (Unchanged from Before)

These gaps remain **unaddressed** and were **not** in the mvp-next sprint scope.

### A. Team Features & RBAC
- ❌ No role-based access control (local machine assumes single user)
- ❌ No approval workflows for Tier 3 operations
- ❌ No site group ownership assignment
- ❌ No audit trail viewer in dashboard

**Blocker for:** Multi-team organizations, SaaS platforms.

### B. Content Staging & Sync
- ❌ No selective post/page sync between environments (WPE only → Local)
- ❌ No content diff viewer
- ❌ No visual regression detection
- ❌ No automatic schema migration post-promotion

**Blocker for:** Agency content staging workflows.

### C. Backup & Point-in-Time Restore
- ❌ No point-in-time restore (WPE only)
- ❌ No backup scheduling or rotation policy
- ❌ No cross-account backup replication
- ❌ No encrypted backup export

**Blocker for:** Disaster recovery scenarios; retention compliance.

### D. Performance Tuning
- ❌ No per-plugin performance audit (load time impact)
- ❌ No slow query detection
- ❌ No cache invalidation tracking
- ❌ No APM integration (Datadog, New Relic)

**Blocker for:** Performance engineering teams.

### E. Mobile & Remote Access
- ❌ No mobile-responsive dashboard
- ❌ No read-only mobile web interface
- ❌ No Slack bot for emergency operations
- ❌ No native mobile app

**Blocker for:** On-call engineers, remote teams.

---

## 5. The Target User Test: Agency Operator (200 WPE Sites)

**Scenario:** Manager of a digital agency running 200 WordPress sites across WP Engine.

### What they can NOW do (that they couldn't before)
1. ✅ **See fleet health in real-time** via REST API → external dashboard (e.g., Grafana, custom React app)
   - `curl http://localhost:14200/api/v1/fleet/health` with Bearer token
   - Returns healthy/warning/critical counts, average score

2. ✅ **Search across all 200 sites** via REST API 
   - `GET /api/v1/search?q=vulnerability&limit=50`
   - Route results to Slack bot or external ticketing system

3. ✅ **Create on-demand backups from dashboard**
   - Click "Create WPE Backup" button, select install, watch progress
   - Wired to audit log for compliance reporting

4. ✅ **Run bulk operations with recovery**
   - `nexus fleet plugin-update --on-error=continue --resume`
   - If 3/200 sites fail midway, save state and retry just those 3 later

5. ✅ **Diagnose issues faster**
   - `nexus troubleshoot` checks disk, GraphQL, SSH, Local addon status
   - Suggests actionable recovery steps

6. ✅ **Get pre-launch checklist**
   - Modal in dashboard shows SSL, Domain, WP Version, PHP, Backup, Health
   - Can't export or share checklist (UX gap)

### What they are STILL BLOCKED ON
1. ❌ **Approve deployments** — Tier 3 ops (promote environment) have no approval workflow
   - Workaround: manual CLI review with peer before running

2. ❌ **Assign sites to team members** — No site group ownership or on-call rotation
   - Workaround: naming convention + spreadsheet

3. ❌ **Compliance audit** — No way to query audit log via REST or UI
   - Who promoted staging to prod last week?
   - Workaround: SSH into Local machine and grep `audit.log`

4. ❌ **Remote operations** — REST API read-only; cannot trigger backups from CI/CD
   - No GitHub Actions integration
   - Workaround: SSH tunnel + CLI invocation

5. ❌ **Webhook monitoring** — No delivery tracking or failure alerts
   - If `site.indexed` event fails to post to Slack, no indication
   - Workaround: poll REST API for index status independently

6. ❌ **Content staging** — Cannot selectively sync posts between staging/production
   - Workaround: manual export/import via WP admin

### Roadblock Summary
- **Tier 1 pain (high frequency, high impact):** Audit log queries, approval workflows, content staging
- **Tier 2 pain (medium frequency):** Team assignment, webhook monitoring
- **Tier 3 pain (low frequency, high impact if it happens):** Point-in-time restore, performance audit

---

## 6. Technical Debt & Implementation Notes

### A. Dashboard Implementation Observations

**File:** `src/renderer/components/NexusOverview.tsx`

- **Strengths:**
  - WPE action buttons (`handleCreateWPEBackup`, `handleSyncWPEMetadataNow`) properly wired
  - Go-Live Checklist modal cleanly integrated as overlay
  - Button state management clear (running, disabled states)

- **Gaps:**
  - No progress bar for long-running operations (Create Backup can take 30+ seconds)
  - No cancel button for operations once started
  - Go-Live Checklist modal has no export/email functionality

**Recommendation:** Add progress UI wrapper (ETA, percent complete) and cancel handler before scaling to high-latency operations.

---

### B. REST API Implementation Observations

**File:** `src/main/rest/RestApiServer.ts`

- **Strengths:**
  - Bearer token auth enforced
  - 127.0.0.1 binding (localhost only; safe)
  - Structured JSON responses with metadata
  - Content-Length headers set (no chunked encoding issues)

- **Gaps:**
  - No write endpoints (POST, PUT, DELETE) — hard-coded rejection at line 108
  - No rate limiting
  - No request logging (security audit trail)
  - No CORS headers (browser-only clients can't access from same origin policy)

**Recommendation:** Future sprint should add POST endpoints for:
- `/api/v1/sites/:id/backup` — create backup
- `/api/v1/webhooks` — manage subscriptions
- `/api/v1/audit` (GET only for now) — query logs

---

### C. Webhook Implementation Observations

**File:** `src/main/webhooks/WebhookEmitter.ts`

- **Strengths:**
  - HMAC-SHA256 signature support (security best practice)
  - Fire-and-forget design (non-blocking)
  - Configurable event subscription per webhook

- **Gaps:**
  - No persistent delivery queue (events lost on Local app restart)
  - No retry backoff (hard timeout of 5s, then silent drop)
  - No delivery log stored (lastDeliveryStatus in memory, not persisted)
  - No webhook management UI (no way to see registered webhooks, test delivery)

**Recommendation:** Add WebhookDeliveryQueue and OperationWebhookLog similar to OperationAuditLog; expose via `/api/v1/webhooks` endpoints.

---

### D. Audit Log Implementation Observations

**File:** `src/main/audit/OperationAuditLog.ts`

- **Strengths:**
  - Append-only JSONL (durability, auditability)
  - Synchronous write (ensures flush before operation returns)
  - UUID and timestamp on every entry
  - Supports filtering and export

- **Gaps:**
  - No access control (file mode 0o600 is user-only, but local machine assumes single user)
  - No querying via REST or UI
  - No retention policy or rotation (log grows unbounded)
  - Not integrated with dashboard or CLI `nexus audit` command

**Recommendation:** Expose via `nexus audit list`, `nexus audit export`, and REST `/api/v1/audit` (read-only, requires bearer token).

---

### E. CLI Error Recovery Observations

**Files:** `src/cli/commands/fleet.ts`, `src/cli/commands/troubleshoot.ts`

- **Strengths:**
  - `--on-error` flag defaults to `continue` (user-friendly)
  - `--resume` loads state from `~/.nexus-resume-state.json` (portable)
  - Resume state includes completed/failed/pending lists (clear sorting)
  - Error messages include recovery suggestions

- **Gaps:**
  - Resume state stored in home directory (no project-specific state isolation)
  - No TTL on resume state (stale state not cleaned up)
  - No UI for viewing/editing resume state (CLI-only)
  - `--on-error=rollback` not implemented (mentioned in prior roadmap but missing)

**Recommendation:** Add `nexus fleet resume-status` to view pending retries; add TTL (7 days) with auto-cleanup.

---

## 7. Delivery Status Scorecard

| Component | Promised | Delivered | Completeness | Notes |
|---|---|---|---|---|
| **Dashboard Buttons** | WPE actions | Backup, Metadata Sync | 75% | Missing: cancel, progress bar, domain mgmt |
| **Go-Live Checklist** | Interactive modal | 6 checks, modal | 100% | Works; missing: export/email |
| **Error Recovery (CLI)** | --on-error, --resume | Both flags, resume state file | 95% | Missing: `--on-error=rollback`, UI for state |
| **Troubleshoot Command** | Diagnostic toolkit | Disk, GraphQL, addon checks | 100% | Functional; could expand to WPE diagnostics |
| **Doctor Expansion** | Enhanced checks | SSH, MCP, addon status | 100% | Comprehensive |
| **REST API** | Read-only endpoints | 5 GET endpoints | 50% | All promised GET; no POST/PUT/DELETE |
| **Webhooks** | Event emission | 5 event types, HMAC sigs | 60% | Missing: delivery tracking, retry, UI |
| **Audit Log** | Destructive op logging | Logs to disk | 40% | Missing: UI/API/CLI exposure, retention policy |

**Overall Sprint Delivery: 75%** (delivered scope, but with partial implementations in 3 areas)

---

## 8. Recommendations for Next Steps

### Immediate (This Week)
1. **Wire `nexus audit` CLI command** into router — expose list/export subcommands
2. **Add progress UI** to WPE action buttons (ETA, percent complete, cancel)
3. **Document REST API** with cURL examples and webhook test endpoint

### Short-term (Next Sprint)
1. **Add REST write endpoints:**
   - `POST /api/v1/sites/:id/backup` → trigger backup
   - `POST /api/v1/webhooks` → register webhook
   - `GET /api/v1/audit` → query audit log with filters

2. **Enhance webhook reliability:**
   - Persistent delivery queue (SQLite)
   - Exponential backoff retry (up to 3 attempts over 1 hour)
   - Delivery log exposed via REST

3. **Dashboard improvements:**
   - Go-Live Checklist export to PDF/email
   - Bulk operation cancellation UI
   - Audit log viewer (read-only, requires admin)

### Medium-term (Month 2)
1. **Team features** — Site group ownership, on-call rotation, approval workflows
2. **Content staging** — Selective post sync, diff viewer
3. **Webhook UI** — Dashboard panel to register/test/monitor webhooks

---

## Appendix A: Implementation Checklist

| Task | File(s) | Effort | Priority |
|---|---|---|---|
| Expose `nexus audit list` | audit.ts, main CLI router | 1h | P1 |
| Add audit REST endpoint | RestApiServer.ts, new route | 2h | P1 |
| Progress bars for dashboard ops | NexusOverview.tsx | 2h | P2 |
| Webhook delivery queue | WebhookEmitter.ts, new Queue | 3h | P2 |
| REST write endpoints (backup, webhook) | RestApiServer.ts | 4h | P2 |
| Go-Live Checklist export | GoLiveChecklist.tsx | 1h | P3 |

---

## Appendix B: Baseline Comparison

### Previous Assessment (April 16, 2026)
- **Completion:** ~70% core features; ~40% integrations; ~10% team features
- **Priority:** Dashboard action buttons, error recovery, onboarding automation
- **Biggest gap:** Observation-only dashboard; no mutations in UI

### Current Assessment (April 17, 2026)
- **Completion:** ~75% core features; ~50% integrations; ~10% team features
- **New accomplishments:** Action buttons added, error recovery in CLI, REST API foundation
- **New gaps:** REST API read-only, audit log not exposed, webhook no delivery tracking
- **Next priority:** Audit log access, REST write endpoints, team features

---

## Conclusion

The mvp-next sprint delivered a solid foundation for external integrations and error recovery. The REST API, webhooks, and audit log are in place but incomplete — read-only constraints and missing query interfaces limit their utility for enterprises. The 200-site agency operator can now create backups from the dashboard and recover from bulk operation failures, but cannot programmatically trigger backups from CI/CD or audit who deployed what. 

**Next sprint should prioritize:** Audit log access via REST/CLI, webhook delivery guarantees, and REST write operations to enable the external automation that REST API originally promised.

