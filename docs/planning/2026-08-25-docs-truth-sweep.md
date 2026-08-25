# Docs Truth Sweep — plan of record

**STATUS (2026-08-25 ~12:45):** Phases 1–5 EXECUTED and committed
(`93845f2a` CLAUDE.md · `f0733831` repo docs · `f6d43cba` archive ·
`6eeaddf8` retirements · `b8dfd866` sweeps + ui-quick-start rewrite,
pulled forward from Phase 6). All Phase 4–5 gates green, incl.
`mkdocs build --strict`. **The pre-push gate is satisfied.** Phases 6–7 core
executed at `162074fd` (cli-command-reference regenerated from src/cli;
ai-context/features corrected; architecture/overview gains the
intelligence layer; net-new: docked-panel, agents, procedures,
external-hosts, whats-new-august-2026 — all nav'd). Trailing, non-gating:
depth rewrites of ui-addon/preferences.md and wpe-management.md, and
richer first-scan / first-ai-query walkthroughs (falsehoods already
swept; what remains is completeness).

*2026-08-25 · branch `poc/nexintelligence-data` (= local `main` at plan time) ·
Author: the 2026-08-25 review session. Every finding below was verified by
direct command against the tree on this date; the evidence column names the
check. Re-run the check before acting if this plan is picked up later.*

## Why now, and the one hard gate

`.github/workflows/docs.yml` deploys `docs-site/` to GitHub Pages **on any
push to main that touches `docs-site/**`** — and the merged chain touched
`docs-site/docs/index.md` (2026-08-12). The first push of main therefore
republishes the stale user docs verbatim. **Phases 4–5 (retire + sweep) are a
pre-push gate. Everything else is ordered work.**

## Ground truth (verified 2026-08-25)

| Fact | Evidence |
|---|---|
| UI tabs are `now / sites / record / agents / settings`; `sites` renders `PropertiesTab` | `src/renderer/components/NexusOverview.tsx:137-149` |
| Removed surfaces: Dashboard, Ask/Tell, Operations, Activity, Discover, Search tab, Fleet Overview, Inbox, Installs, Fleet | same file; retired components unrendered |
| Vector store is sqlite-vec; LanceDB removed | `src/main/vector-store/SqliteVecStore.ts`; CLAUDE.md sqlite-vec section |
| 191 `registry.register(` calls under `src/main/mcp/modules/` (docs claim "160+"/"161"/"45+") | `grep -rE "registry\.register\(" src/main/mcp/modules/ --include="*.ts" \| grep -v test \| wc -l` → 191 |
| 22 top-level CLI commands (all via `.addCommand` in `src/cli/index.ts`): agent ai audit blueprints content creds doctor fleet gateway host mcp pipeline reset settings sites skills sync system troubleshoot update wp wpe | `grep -oE "\.addCommand\([a-zA-Z]+" src/cli/index.ts` → 22 |
| `engines.node: "22.x"` | `package.json:11` |
| security-sentinel triggers: cron `0 3 * * *` + `wp:plugin.activated` + `wp:user.created`; `wpe:sync.completed` removed as incident cause | `agents/security-sentinel/agent.js:589-595` and the comment above it |
| Eval registry: 50 PASS / 0 FAIL / 18 BLOCKED / 10 OWNER-PENDING | `tests/intelligence-evals/run.ts`, run 2026-08-25 |
| Full suite 675 suites / 9,317 passed at `1bca1975` | `npm test`, 2026-08-25 |

---

## Phase 1 — CLAUDE.md corrections (~1h)

*The binding instruction file. 57 claims audited: 39 hold, 9 wrong, 9 drifted.
Its own rule applies: "If you close a gap, delete it from the list."*

| # | Location (grep for it) | Fix | Evidence |
|---|---|---|---|
| 1.1 | "Run id reaches `operation-audit.log` from only ONE of three audit writers" | → TWO of three: `ToolRegistry.call()` and (since WP-57) `AgentDispatcher.dispatch()`; only `auditDirectOperation()` omits it | `AgentDispatcher.ts:122,150` |
| 1.2 | "`agent_runs.run_id` is written but not read back" | → `getRunHistory()` returns `runId`+`taskId` (WP-57); `getLastRun()` still drops it | `AgentStateStore.ts:190-193` |
| 1.3 | "A renderer UI row for `externalRefreshAutoEnabled` now exists (`SettingsTab.tsx`)" | → row lives in `settings/derived.ts` `JOB_SPECS`, rendered by `BackgroundWorkSection.tsx` | `derived.ts:38`; `SettingsTab.tsx` grep = 0 |
| 1.4 | "`externalContentIndexAutoEnabled` … is genuinely CLI-only today" | → false; it has a renderer row too | `derived.ts:39` |
| 1.5 | "the `\|\| '8.0'` fallback at `get-site-health.ts:83` is structurally unreachable" | → the fallback is DELETED (`\|\| undefined`, C3 comment); only the local path `:51` keeps `'8.0'` | `get-site-health.ts:81-83` |
| 1.6 | "the 8 GraphQL resolvers that call `registry.call(...)`" | → six resolvers (7 call sites; `nexusFleetCompare` calls twice) | `resolvers.ts:1450,1464,1479,2042,2156,3615-3616` |
| 1.7 | Known Pitfalls link `feedback_smart_search_mu_plugin.md` | repo-relative link resolves nowhere; the file lives in the session memory dir. Inline the two-line warning instead of linking | `ls` both locations |
| 1.8 | L1081 header "— branch `poc/nexintelligence`" | → drop the branch suffix (main-line code now) | `git branch --contains 1bca1975` |
| 1.9 | L1088 "(ADRs 1–19)" | → "(ADRs 1–24)" | architecture.md §9 |
| 1.10 | Drifted-but-defended anchors (batch): `index.ts:525`→`:654` · `safety.ts:283`→`:341` · `resolvers.ts:2950`→`:3003` · `types.ts:299`→`:343` · `schemas.ts:77`→`:106` · `NexusToolProvider.ts:92`→`:156` · "roughly thirty paths"→"~23 distinct operations (~47 call sites)" · "11 call sites" for upsertPlugin→"9 live (10 with dead twin.ts)" | update numbers, keep the "grep, don't trust" phrasing | audit table D/H |

**Gate:** re-read each edited paragraph against its cited source; no test exists for CLAUDE.md.

## Phase 2 — repo docs, misleading tier (~2-3h)

| # | File | Action | Evidence |
|---|---|---|---|
| 2.1 | `docs/user-guide.md` | Rewrite the tab walkthrough around now/sites/record/agents/settings + Docked Panel. It currently teaches five tabs, zero of which exist | `:37` "five tabs"; `:39` Dashboard |
| 2.2 | `agents/security-sentinel/README.md` | Fix "15-minute cron and … WPE sync completed" → daily 03:00, two wp events; note the sync trigger was removed deliberately | `:9` vs `agent.js:589-595` |
| 2.3 | `docs/agents/security-sentinel.md` | Same fix at `:60-61` and `:793`; ALSO soften `:399` "each step executed via wp_eval, verified ✅" — the WP-25 smoke falsified this (fabricated-checklist finding, registered) | grep output; INTELLIGENCE_ROADMAP.md:151-153 |
| 2.4 | `agents/security-sentinel/nexus.agent.yaml` | Reconcile `tools:` with `agent.js:596-606` (drop `local_restart_site`; add the four missing); add `wp:user.created` trigger row | audit C#25 |
| 2.5 | `README.md` | Node 18+ → 22.x (`:231`); tool table → regenerate per-category counts from the registry (191 registrations); replace tab references (`:69`,`:105`,`:390`); add the intelligence layer + agents + procedures to the feature list; fix test counts or drop them | batches 9, 4/6 |
| 2.6 | `src/renderer/components/NexusOverview.tsx:4` | Fix the docblock ("six tabs: Overview, Inbox…" → the real five) | code comment vs `:137-149` |
| 2.7 | `CHANGELOG.md` | Add an `[Unreleased]` entry summarizing the merge: intelligence spine, agents+procedures, fleet collapse, external SSH hosts, sqlite-vec migration, defect campaign, benchmark harness | last entry `[0.5.2] 2026-07-27` |
| 2.8 | `docs/intelligence/architecture.md` §4.2 (`:343`) | Execute the WP-65-filed correction: `episodic.*` is no longer reserved — name the four live producers, keep the "imported histories" note as origin | grep :343; WP-65 adjudication |
| 2.9 | same, §6.2 step 7 (`:480`) | `task.context_assembled` → `task.context.assembled` | §4.2's own respelling note |
| 2.10 | `docs/architecture/data-levels.html` | Add a dated status banner; fix the WPE-L3 "manual only, no scheduler" row (`startWpeContentIndexScheduler` exists, off by default); add an external-hosts note or a pointer to digital-twin-data.md; mark the 284-count figures as a July snapshot | `index.ts:593-611`; grep "external" = 0 |
| 2.11 | `docs/architecture/data-gaps-design.html` | Put the ruled disclaimer ON the artifact: "a proposal, not a description — read for rationale; never as a statement of behaviour" | grep = 0 hits |
| 2.12 | `docs/digital-twin-data.md` | Sweep the two residual "Operations tab" strings (`:274`, `:318`) → current surface names | audit #14 |

**Gate:** `npx jest tests/unit/docs --no-cache` green (the doc-pin suite);
`grep -rn "Operations tab\|Discover tab\|Fleet Overview\|Ask/Tell" docs/*.md README.md` returns only historical/plan documents.

## Phase 3 — root status-file housekeeping (~30m, needs owner OK to delete)

Move to `docs/archive/2026-03/` (git mv, preserving history):
`PRODUCTION_READY_STATUS.md`, `ROADMAP_STATUS.md`, `docs/IMPLEMENTATION_STATUS.md`,
`docs/PRODUCTIONALIZATION_SUMMARY.md`, `docs/DOCUMENTATION_INVENTORY.md`,
`docs/DOCUMENTATION_ROADMAP_COMPLETE.md` — all dated 2026-03, all claiming
"complete" states that contradict `INTELLIGENCE_ROADMAP.md`. Root-level
`*_STATUS.md` is where a newcomer looks first; in aggregate these mislead.
Also: `docs/analysis/` and `nexus-state-management-status.html` gain a one-line
dated banner ("point-in-time analysis, YYYY-MM-DD") rather than a rewrite.

## Phase 4 — docs-site retirements (~1h) · PRE-PUSH GATE

*Delete before rewriting: 75 → ~52 pages, and most dead vocabulary vanishes free.*

| Set | Files | Verified by |
|---|---|---|
| 13 TODO stubs (48-55 words each) | `cli/`: authentication, commands, local-sites, wpe-sites, wp-cli, bulk-operations, error-handling, performance · `mcp-tools/`: local-sites, search, telemetry, tool-matrix · `reference/faq.md` | `grep -rl "Work in Progress" docs-site/docs/` |
| Removed-surface pages | `ui-addon/fleet-overview.md` (22 dead hits), `ui-addon/site-finder.md`, `ui-addon/bulk-operations.md`, `ui-addon/keyboard-shortcuts.md`, `ui-addon/search-tab.md` (orphan) | per-file grep |
| Fictional reference | `reference/tool-reference.md` — 5/5 sampled tool names have 0 src hits (incl. word-boundary `scan_site`) | batch 3/3b |
| Wrong-engine page | `architecture/vector-database.md` (title + 14 hits = LanceDB) | grep |
| Superseded | `reference/wpe-access-control.md` → redirect stub to `permissions-access-control-v2.md` | audit |
| Orphan snippet | `snippets/value-proposition.md` (zero includes) | grep `--8<--` = 0 |
| Archive | `reference/whats-new-may-2026.md`, `whats-new-july-2026.md` → `reference/archive/` | orphan check |

Update `mkdocs.yml` nav accordingly. **Delete the committed `docs-site/site/`
build dir** from the repo if CI builds fresh (verify `docs.yml` runs
`mkdocs build` — it does; the committed copy is a stale artifact).

## Phase 5 — docs-site sweeps + nav (~1-2h) · PRE-PUSH GATE

1. **LanceDB → sqlite-vec** across the 23 files (`grep -rli lancedb docs-site/docs/` — 23 verified; retirement removes ~5 of them first). Where a page documents LanceDB *mechanics* (index files, `.lance` paths), rewrite the sentence, don't substitute the word.
2. **Tool counts**: "160+", "161", "45+" → "≈190 registrations" (or omit the number; prefer "see the tool index").
3. **Node 18 → 22.x**: `getting-started/cli-quick-start.md`, `cli/installation.md`.
4. **Version pins**: `v0.2.1`/`v0.4.0`/`0.1.3` refs → current or unpinned.
5. **Nav-add the four accurate orphans**: `reference/permissions-access-control-v2.md`, `architecture/wpe-sync-architecture.md`, `ui-addon/preferences-wpe-access.md`, `reference/model-catalog.md`.

**Gate (all must return 0 in docs-site/docs):**
`grep -rli "lancedb"` · `grep -rl "Fleet Overview\|Operations tab\|Discover tab\|Search tab\|Ask/Tell"` · `grep -rl "160+\|Node.js 18"` — then `mkdocs build --strict` (from `docs-site/`, `pip install -r requirements.txt`) passes.

## Phase 6 — docs-site rewrites (~1-2 days, ordered by user value)

1. `index.md` — landing page: counts, LanceDB, feature list incl. the spine.
2. `getting-started/ui-quick-start.md` — rewrite around the real tab strip and Docked Panel (currently 15 refs to a removed panel).
3. `reference/cli-command-reference.md` — REGENERATE from `src/cli/index.ts` (22 commands; currently documents 12, of which 5 exist). This page absorbs the deleted CLI stubs.
4. `getting-started/first-scan.md` — indexing walkthrough on sqlite-vec + ledger vocabulary.
5. `ai-context/features.md` — "only features that actually exist" must become true again; AI clients treat it as ground truth. Regenerate from the tab strip + `src/intelligence/` + `agents/`.
6. `architecture/overview.md` — add the intelligence layer; the other architecture pages inherit from it.
7. `getting-started/first-ai-query.md` — the Docked Panel query arc.
8. `ui-addon/preferences.md` + `wpe-management.md` — rewrite against the Settings tab and Properties view.

## Phase 7 — net-new pages (~1 day)

1. **Docked Panel & citations** — the primary chat surface; provenance, freshness, live re-check, citation states.
2. **Agents** — the four shipped agents, schedules, the agents tab, agent settings honesty (no-schedule line).
3. **Procedures & capability grants** — 7 runbooks, strict/guided, deny-by-default, the Remediate permission story (`SentinelExecutor` error guidance).
4. **External SSH hosts** — `nexus host add`, target syntax, refresh/index opt-ins.
5. **What's new (August 2026)** — in nav, first entry = the merge.

## Phase 8 — close-out

- Full `npm test` green; `mkdocs build --strict` green.
- Re-run every Phase-gate grep; paste outputs into the commit message.
- One commit per phase (1, 2, 3, 4, 5 separately; 6-7 per page or per section).
- Update `docs/digital-twin-data.md`'s pointer table if artifact statuses changed (data-levels/data-gaps rows).
- THEN main is safe to push (docs deploy will publish the refreshed site) — push itself remains owner-word-gated.

## Explicitly out of scope

- The WP-64 architecture-artifact republish (Figure B) — owner-owned, needs the artifact URL.
- WORK_PACKETS.md, PARALLEL_PROTOCOL.md, docs/planning/* — records, not documentation.
- `docs-site/site/` regeneration locally — CI owns the build.

## Owner decision points

1. Phase 3 deletions vs archive (plan says archive — confirm).
2. Phase 6/7 depth: pre-push, or push after Phase 5 with rewrites following? (The gate only *requires* 4-5.)
3. Whether `docs-site/site/` (committed build output) should leave the repo.
