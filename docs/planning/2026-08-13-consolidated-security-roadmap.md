# Consolidated Security & Quality Roadmap

**Date:** 2026-08-13 · **Branch:** `fixes-0812` · **Reviewed at:** v0.5.2

This reconciles **two independent reviews** into one prioritized, de-duplicated list.
Both reviews independently reused the labels `P0-1…P1-8`, so the git log has *colliding*
IDs (two different "P1-7"s, etc.). This document is the single source of truth; it maps
each underlying issue to its status and commit(s), regardless of which review named it.

- **Review A ("earlier")** — captured in `docs/planning/2026-08-12-p0-security-tickets.md`,
  `2026-08-12-p1-plan.md`, `2026-08-13-p2-plan.md`. Its P0 + P1 are essentially all shipped.
- **Review B ("current")** — the 12-dimension artifact review (2026-08-13). Adds refinements,
  a prompt-injection contract, hermetic-build details, budgets/kill-switch, perf specifics,
  a11y, and docs.

Legend: ✅ Done · ⛔ Declined (with reason) · ☐ Todo

---

## ✅ Done — shipped on `fixes-0812` (34 items)

| Area | Issue | Review(s) | Commit(s) |
|---|---|---|---|
| Agent safety | Agent Tier-3 self-approval chain closed (agents hard-refuse Tier-3) | A P0-1 | `0f073505` |
| Agent safety | `nexus_update_settings` gated (schema + permission-key protection) | A P0-2 | `0f073505` |
| Supply chain | Release signing — sign in CI, verify before install (fail-closed) | A P0-3 | `29fce1f2`,`071876a4`,`20ce5dba` |
| Supply chain | Tarball extraction hardened vs link-poisoning | A P0-3 | `fd5e03f0` |
| Supply chain | Rollback guard — reject version-mismatched (downgraded) tarball | B P1-5 | `064ca913` |
| Supply chain | Model download sha256 pinned + verified (both arches) | B P1-5 | `30a852e3` |
| Build | ACF PRO redistribution guarded (root cause + `prepublishOnly`) | A P0-4 / B P0-4 | `80d9ba96`,`55eed726` |
| Build | node-abi patch automated into `rebuild` | A P1-4 | `7b1520e9` |
| Security | `~/.ssh/config` write path validated (directive injection) | A P0-5 | `685b1e87` |
| Agent safety | Privilege-granting WPE ops (account-user/SSH-key) → Tier 3 | A P0-6 | `1acd7291` |
| Agent safety | WPE CAPI **create/provision** family (install/site/domain/SSL/offload) → Tier 3 | B P1-1 | `393d41a0` |
| Agent safety | `wp_eval` sandbox bypass fixed (unrestricted/no-tools agents) | B P1-3 | `6789bfbc` |
| Privacy | `event_queue` prune fixed (real terminal statuses) + scheduled | A P0-7 | `63faa15f` |
| Privacy | PII masked outbound to LLM — per-handler (fleet_sql, user lists) | A P1-6 | `8d52b5d5` |
| Privacy | PII masked outbound to LLM — **global backstop** (all tool results) | B P0-5 | `5af12330` |
| Privacy | Consent/disclosure — chat footer wording + one-time agent-enable notice | B P0-5 | `7a87c776` |
| Privacy | WPE user-email harvest stopped (`--fields`, store null) | B P1-6 | `08bfaace` |
| Privacy | `NEXUS_TELEMETRY=false` (and no/off/…) honored, not only `=0` | B P0-6 (part) | `78b8cc08` |
| Privacy | Committed PII eval-result files removed + gitignored | B P0-2 | `470ff0b4` |
| Security | Credential-at-rest — `graph.db`/`vectors.db` chmod 0600 | B P1-4 | `f28dd0c3` |
| Security | Credential-at-rest — gateway/webhook bearer tokens encrypted | B P1-4 | `85289867` |
| Security | AI-gateway server hardened (anti-rebinding, CORS, `/models` auth) | A P1-5 | `6b6d9541` |
| Security | Loopback Host/CORS applied to McpServer + AiProxyServer (the other 2 of 3) | B P1-8 (part) | `514b6847` |
| Reliability | Scheduler re-entrancy guard (external refresh / WPE refresh / content-index) | B P1-7 (part) | `8e3387b1` |
| Incident resp. | `nexus creds rotate` (+`--force-now`) + runbook + `recordError` wired | A P1-7 | `49cc77ae`,`27c07614`,`fef79418`,`92dd203e`,`d5154168`,`9a2a3936` |
| CI | ESLint config + secret scanning (CI job + pre-commit) | A P1-2 | `8c01f9f7` |
| CI | PR quality gate (lint/typecheck/jest), gates release; 11 excluded suites cleared | A P1-1 | `ce6d15b7`,`4d0c5a62` |
| Docs | Retract false "production-ready security" claims; attack-surface table + trust diagram | A P1-8 | `d90985bc` |
| Legal | MIT LICENSE (WP Engine) + `license`/`repository` in package.json + accurate THIRD_PARTY_LICENSES (GPL plugins documented) | B P0-3 / A P1-3 | `f01bd070` |
| Supply chain | `tar` 6→7.5.22 (clears CRITICAL path-traversal advisories on the update path); unused lodash removed (clears HIGH) | B P1-8 / A SC-4 | `e244de14` |
| Agent safety | Remote kill switch — CLI block warning + main-process agent-disable via `latest.json` (fail-safe) | B P1-7 / IR-1 | `08979753`,`e5edad43` |
| Agent safety | Daily USD spend ceiling on the agent LLM path (opt-in; per-local-day, auto-rollover) | B P1-7 / AB-4 | `3aa0f644` |
| Agent safety | Prompt-injection trust contract — approval gate for `wp_eval`/`wp_search_replace` (agents sandbox-refuse) + untrusted-data labeling | B P1-2 | `1c36a19f`,`cc5bb902` |
| Supply chain | Hermetic build — `npm ci` (staged lockfile) + all GitHub Actions pinned to commit SHAs (incl. 2 third-party) | B P1-5 #2/#3 | `a86c0035` |

---

## ⛔ Declined — with reason (confirm you agree)

| Issue | Review(s) | Decision & reason |
|---|---|---|
| **Git-history rewrite** (purge disabled Anthropic key, Google-shaped key, 419 eval files, 133 MB model from history) | B P0-1/P0-2/P0-7, A P0-4/P2-7 | **Declined.** Repo is already public → the data is already cloneable/forked/cached; a rewrite reduces future discoverability, it does not un-leak. The Anthropic key is disabled; keys are inert once dead. Forward-fixes are done (eval PII deleted + gitignored; no new commits). **Residual for you:** confirm the Google-shaped key is dead. Revisit only if you loudly open-source/publicize. |
| **Google OAuth client-id → sentinel** | B P0-7 | **Won't-fix.** It's a *desktop-app* OAuth client ID — non-secret by design, already shipped in every tarball; the client *secret* is not in the repo. Swapping in the sentinel would break Google-Analytics OAuth for every end user. |
| **P1-5 `--ignore-scripts`** (part of hermetic build) | B P1-5 | **Amended, not as written.** `--ignore-scripts` would skip building the `better-sqlite3` native binary → broken addon. Shipped as `npm ci --omit=dev` *without* `--ignore-scripts` (`a86c0035`). |
| **T-CI-HERMETIC #4** — scope R2 creds to upload steps | B P1-5 | **Deferred by decision (2026-08-13).** It is the one CI change that breaks the release if mis-edited and is unverifiable without a release run. Do it deliberately at the next release. (#2/#3 shipped.) |

---

## ☐ Todo — remaining, prioritized

### Release / consent blockers (was P0)
| ID | Item | Review(s) | Effort | Notes |
|---|---|---|---|---|
| T-TELEMETRY-UI | Telemetry consent: first-run prompt (`hasBeenPrompted` has 0 callers) + Settings toggle + `nexus telemetry` command | B P0-6 remainder | Med | Env-flag half already done. Product/UX wording needed. |
| T-UNBUNDLE-AI | Stop bundling the third-party `ai` plugin; install it from WordPress.org on demand instead | New (2026-08-13) | Low–Med | The `ai` plugin is a **copy of the WP.org plugin** (GPL-2.0-or-later, not ours). Installing from wp.org at setup time removes the GPL-**redistribution** obligation for someone else's code entirely — only our own `nexus-ai-connector` (MIT) and the team-authored `ai-provider-*` plugins would ship. Verify the setup flow can pull it from wp.org, then drop it from `wp-plugins/`/`lib/wp-plugins/`. (The `ai-provider-*` plugins are the team's own GPL work and are fine to ship.) |

### Security & safety hardening (P1) — ✅ COMPLETE

All P1 items are shipped (see Done above): T-INJECTION, T-DEPS, T-KILLSWITCH, T-BUDGETS,
T-CI-HERMETIC #2/#3. Two deliberate residuals remain:

| ID | Item | Review(s) | Effort | Notes |
|---|---|---|---|---|
| T-BUDGET-CHAT | Extend the daily USD budget to the interactive **chat** path (ChatService), not just agents | B P1-7 | Low | Agent path is guarded; chat is user-driven (a human is watching), so lower risk. Same `SpendTracker`/`DailyBudgetGuard`, wired at `ChatService`'s `streamChat`. |
| T-CI-HERMETIC #4 | Scope R2 creds to upload steps | B P1-5 | Low | **Deferred** — see Declined. Do at the next release. |

### Reliability / performance / correctness (P2) — the 300–500-install user hits these
| ID | Item | Review(s) | Effort |
|---|---|---|---|
| T-PERF-THREAD | Move embeddings + vector store off Local's main thread (utilityProcess/worker) — a fleet-wide search freezes the UI | A P2-1 | 1–2 wk |
| T-PERF-DISK | Reclaim ~1 GB disk — vec0 `chunk_size=8`, delete legacy LanceDB dir, FTS5 contentless, VACUUM behind a "reclaim space" action | B P2-1 / A P2-2 | Med |
| T-PERF-SYNC | Un-transacted `synchronous=FULL` SQLite writes block the main thread during sync — `NORMAL`+`busy_timeout`, transaction bulk upserts, hoist `prepare()`, stream content | B P2-2 | Med |
| T-PERF-RENDER | Renderer jank — batch/guard NexusOverview subscriptions (~331 unbatched re-renders), Set-based selection (O(n²)→O(n)), virtualize SitesTab (react-window is a dep), memoize chat markdown | B P2-3 | Med |
| T-DELTA-INDEX | Delta indexing on site start (currently re-embeds every chunk) + vectors.db orphan sweep + close-on-quit | A P2-2 | 2–3 d |
| T-MIGRATE-SAFETY | Migration safety net — `PRAGMA integrity_check`, backup-before-migrate, corrupt-DB rename-and-rebuild, version the vector schema | B P2-4 / BM-2/BM-3 | Med |
| T-RETENTION | Retention/reset completeness — drop vector tables for swept sites, fix `RESET_AND_REFRESH` IndexRegistry orphan, FACTORY_RESET leftovers, missing `idx_sites_account` | B P2-5 | Low |
| T-BACKUP-GATE | Destructive ops require a real backup — `local_wpe_pull` overwrites a local site at Tier 2 with no backup; wire `backup_and_verify` as an actual gate (not advisory strings) | B P2-6 / BM-1/BM-4 | Med |
| T-HEALTH-PIN | Pin the duplicated `externalScoreable` health-scoring rule (resolvers.ts vs get-site-health.ts) + remove `\|\| '8.0'` php fabrication | A P2-4 / T-4 | Low |

### Sustainability / velocity debt (P3)
| ID | Item | Review(s) | Effort |
|---|---|---|---|
| T-SERVICE-LAYER | Extract the triplicated business logic (fleet summary ×3, fleet plugins ×4, health banding, name resolution, version compare) into one module + thin adapters, pinned by shared-case tests | B P3-1 / A P2-3/P2-5 | High |
| T-MEGAFILES | Decompose `ipc-handlers.ts` (6.6k) + `resolvers.ts` (6.3k); move service construction to `index.ts`; one `SiteSource` type + `fleetSourceFilter()` | B P3-2 / A P2-3 | High |
| T-SERVICES-TYPE | Merge the two `NexusServices` interfaces; type the 8 `any` core services; startup assertion | A P2-5 | 2–3 d |
| T-CI-TIERS | Integration + CLI-e2e in a pipeline (nightly headless Local), un-exclude bootstrap signing tests, enforce coverage, revive stale evals | B P3-3 / A P2-6 | Med |
| T-DOCS | Rebuild human-facing docs — fix safety-critical inversions (Tier-3 count 2→15, inverted WP-CLI gate), fix the 3-deleted-tabs nav, write the 404'd `docs/security.md`, mirror CLAUDE.md sections | B P3-4 | Med |
| T-A11Y | Keyboard/screen-reader operability — 3 shared primitives (modal w/ focus-trap+Escape, toggle, tab), error boundary, live regions (14 overlays have zero dialog semantics) | B P3-5 | High |
| T-DEADWEIGHT | Delete dead weight — ~2,000 lines shadow resolvers, unused `apache-arrow`, `recording_session_file_hashes` (70k rows, 0 refs), junk zips/build/, tighten ESLint to `--max-warnings 0` | B P3-6 / A P2-7 | Low |

### Not tasks — "also worth reviewing" (Review B §05)
Crash reporting/self-observability · upgrade-path & data-migration testing · release/rollback operability drill · legal review of AI-generated-content paths · native-module/Electron durability · dependency-freshness automation (Renovate/Dependabot).

---

## Status: all P0 + P1 done or deliberately declined

Every P0 and P1 item across both reviews is shipped, declined with reason, or a
deliberate low-risk residual (T-BUDGET-CHAT, T-CI-HERMETIC #4). What remains is
reliability/perf (P2) and velocity debt (P3).

### Suggested order for what's left

1. **T-TELEMETRY-UI** + **T-UNBUNDLE-AI** — the two small non-P2 items (consent UI; drop the wp.org `ai` plugin).
2. **P2 perf set** — biggest user-facing wins (reclaim ~1 GB disk, unblock the main thread, renderer jank). Needs the better-sqlite3 rebuild dance to test.
3. **P2 correctness** — migration safety net, backup gates, retention completeness, health-rule pin.
4. **P3** — service-layer extraction, megafile decomposition, a11y, docs. As capacity allows.
5. Small residuals — **T-BUDGET-CHAT** (chat budget), **T-CI-HERMETIC #4** (do at next release).
