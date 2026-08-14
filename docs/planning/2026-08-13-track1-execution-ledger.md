# SDD ledger — plan: docs/planning/2026-08-13-fleet-identity-provenance-plan.md

Repo: `/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai`
Branch: `design/native-fleet-workspace` (not main; no separate worktree — the
branch is the isolation, and the repo already carries 15 stale worktrees)
Spec: `docs/planning/2026-08-13-nexus-native-fleet-workspace-design.md` (read)
Plan base commit: 09a1d7da

## Pre-flight conflict scan

### Cross-task rows (tasks sharing a file or interface)

| Tasks | Produced → consumed | Finding |
|---|---|---|
| T1 → T2 | `site_links` DDL → `SiteLinkStore` SQL | Columns match exactly (local_site_id PK, wpe_install_id, wpe_install_name, link_source, verified_at). T2's test re-declares the DDL by hand for unit isolation — deliberate duplication, not drift. Clean |
| T2 → T3 | `get` / `put` / `remove` | Used exactly as produced. Clean |
| T2 → T5 | `getByInstall` | Used exactly as produced. Clean |
| T3 → T4 | `resolveOne` | `reconcileAll` calls it per site. Clean |
| T4 → T7 | `reconcileAll(Record<string,{id,name}>)` ← `SiteDataAccessor.getSites(): Record<string,LocalSiteInfo>` | `LocalSiteInfo` is `{id,name,path,domain}` — structurally assignable. Clean |
| T5 → T6 | `FleetAssembler.listFleet` | Reached via `NexusServices.fleetAssembler`. Clean |
| T3,T5 → T6 | Two optional fields on `NexusServices` | T6 Files list includes `src/main/mcp/types.ts` (added during plan self-review). Clean |
| T5 → T7 | `FleetAssembler` 3-arg constructor | T7 passes `(graphService, siteLinkStore, siteDataAccessor)`. Clean (the 2-arg form was corrected during plan self-review) |
| T6 → T7 | `registerFleetLinkTools(registry)` | Called with the other register calls. Clean |
| T1, T5 | Both touch `GraphService` | T1 writes a migration; T5 only calls `listSites`. No write conflict. Clean |
| **T7 → index.ts** | Assumes identifier `localServices` | **CONFLICT — the bridge variable is `localServicesBridge` (index.ts:301). `localServices` does not exist** |
| **T7 → index.ts** | "after `graphService.initialize()` in the async init IIFE" | **CONFLICT — there are two such call sites, index.ts:233 (early-init IIFE) and index.ts:678 (main async IIFE)** |

### Self-consistency rows (does each task's own text agree with itself)

| Task | Finding |
|---|---|
| T1 | Test asserts columns, index and idempotency; impl creates all three. Clean |
| T2 | 6 tests cover all 5 produced methods plus the empty and replace cases. Clean |
| T3 | 5 tests cover resolve, unresolvable, user precedence, manual set, clear. Clean |
| T4 | 2 tests cover the happy sweep and the per-site throw. Clean |
| T5 | 5 tests cover grouping, attachment, absence, all three provenance levels, and the `listSites` filter. `SITE_DATA` fixture added during plan self-review so the sandbox-name assertion is meaningful. Clean |
| T6 | 5 tests cover 3 handlers plus both missing-service and missing-arg paths. Clean |
| T7 | 2 tests; the extracted helper is pure, so the untestable `index.ts` edit is kept to wiring only. Clean |

### Rulings

Ruling: Task 7's `localServices` is corrected to `localServicesBridge` — that
is the actual identifier at `src/main/index.ts:301`, and the plan's name would
not compile. Cost if wrong: the implementer wires the resolver to the wrong
object and CAPI resolution silently returns null for every site.

Ruling: Task 7 wires at the `graphService.initialize()` call site at
`src/main/index.ts:678`, not the one at :233 — `localServicesBridge` (301),
`nexusServices` (375) and `registry` (401) are all defined after the early-init
IIFE, so the :233 site cannot compile. Cost if wrong: a TDZ/undefined-variable
crash at addon load, which fails loudly rather than silently.

Ruling: implementation proceeds on branch `design/native-fleet-workspace`
rather than a fresh git worktree. It is not main, which is the binding
constraint, and the repo already carries 15 stale worktrees. Cost if wrong:
design docs and implementation share a branch, so they must be reviewed and
merged together rather than separately.

Both plan-text conflicts were corrected in the plan file before Task 1 was
dispatched, so extracted task briefs carry the ruling.

## Progress

Task 1: complete (commits 09a1d7d..b3f99ce, review clean)
Task 2: complete (commits b3f99ce..ab1231f, review clean)
Task 3: complete (commits ab1231f..f29f173, review clean)
Task 4: minor (deferred): SiteLinkResolver.ts:62 bare catch discards the error, so an unresolved site carries no reason. Suggested fix: optional `reason?: string` on UnresolvedSite, or log the error. Not a correctness defect — failures are still reported.
Task 4: complete (commits f29f173..821235f, review clean, 1 minor deferred)
Task 5: minor (deferred): FleetAssembler.ts:110 group `name` (domain ?? name) is untested — no assertion on group.name.
Task 5: minor (deferred): FleetAssembler.ts:83 getByInstall(...)[0] silently picks the first of multiple links; undocumented, untested.
Task 5: complete (commits 821235f..c7a2be0, review clean, 2 minor deferred)
Task 6: Ruling: reviewer's Important finding — `(services as any)` casts in all three handlers — is upheld against the plan text, which mandated those casts. The plan contradicted itself: it added properly typed optional fields to NexusServices in the same task, then cast them away. The spec's intent is typed access; the casts are avoidable and defeat the typing added in the same commit. Entering the fix loop. Cost if wrong: none material — removing a cast on an optional typed field is behaviour-preserving, and the existing tests cover the missing-service paths.
Task 6: minor (deferred): link-site.ts:67-75 checks resolver availability before validating arguments; fail-fast would validate first. Style only — the required behaviour (resolver untouched on invalid args) already holds.
Task 6: fix round 1/5 (1 addressed, 0 open — `(services as any)` casts removed from all three handlers; commits 1783e19..1e072aa)
Task 6: note: commit 1e072aa also contains a 16-line edit to the plan document. That was the controller's uncommitted pre-flight ruling (localServicesBridge / index.ts:678), swept in by the implementer's `git add`. Content is correct; only the commit boundary is untidy. Not worth a fix round.
Task 6: complete (commits c7a2be0..1e072aa, review clean after 1 fix round, 1 minor deferred)
Task 7: Ruling: reviewer's ⚠️ "cannot verify DB null safety at index.ts:699 getDb()!" resolved by the controller as NOT a gap. GraphService.initialize() (line 151) either early-returns with this.db already set, or assigns `this.db = new Database(...)`, which throws on failure rather than yielding null. The wiring runs immediately after `await graphService.initialize()` succeeds, so getDb() cannot be null there; the adjacent runOrphanSweep uses the same assumption. The enclosing async IIFE also catches, so even a throw degrades startup rather than crashing it. Cost if wrong: a TypeError at addon load, which fails loudly and is caught by the IIFE's handler.
Task 7: complete (commits 1e072aa..fe1ea26, review clean, 1 warn resolved by controller)

## Final whole-branch review (opus, 55987ff3..fe1ea262)

Verdict: Fix before merge. 1 Critical, 6 Important, 7 Minor, plus 3 cross-task coherence findings.

Ruling: ONE fix wave covering the Critical, all six Important, and two cheap Minors
(ORDER BY on getByInstall; setStartupPhase for the new block). Remaining Minors deferred.
Cost if wrong: the deferred Minors are cosmetic or type-hygiene; none changes behaviour.

Ruling: coherence finding #1 (site_links has one reader — remote-exec.ts and
get-site-changes.ts still use the old hostConnections inference) is REAL and is NOT fixed
in this wave. It is a scope gap in the plan, not a defect in the code written. Recorded as
an explicit follow-up: the replacement of the inference path belongs with Track 3, which is
what actually routes remote execution. Cost if wrong: a user who corrects a link sees the
fleet list change but remote WP-CLI still routes by the broken inference — misleading until
Track 3 lands. Documented in the plan's out-of-scope section as part of this wave.

Ruling: coherence finding #2 (the unresolved list goes nowhere) IS in the fix wave, via
surfacing it in nexus_fleet_list rather than a new tool. The design calls the reconciliation
surface "required, not a fallback"; shipping a list nothing can read fails the track's own
deliverable. Cost if wrong: slightly wider fix wave than a pure defect fix.

Final fix wave re-review: All 9 findings ADDRESSED, no new Critical/Important breakage.
Re-reviewer amended one fixer claim: the eval character-ceiling failure is pre-existing but
was *worsened* by ~4% (instructions 37.7k -> 39.2k), not purely pre-existing. Accepted — the
ceiling was already 2.5x breached at the branch point.
TRACK 1 COMPLETE (55987ff3..f81c154a, 17 commits).

## Track 3 Stage 1 (backup gate)

Ruling: the implementer's NEEDS_CONTEXT is upheld and the Track 3 plan was WRONG.
It specified "backup completion is after the last mutation to the target", but no
last-mutation signal exists — local sites have per-file mtimes and no DB change
timestamp; CAPI installs carry no updated_at. Corrected design: the gate CREATES the
backup as part of itself rather than looking for one, so the ordering holds by
construction and no comparison is needed. Simpler and strictly safer than specified.
Cost if wrong: 1-5 min added per destructive op. That cost lands on the sandbox loop
and weakens the case for ephemeral sandboxes (D8) — flagged in the plan for revisit.
Plan text corrected before re-dispatch.
Track 3 Stage 1 (backup gate): complete (9bfe5a4..88138b5). First review: DO NOT MERGE
(1 Critical: fixed filename meant a second pull destroyed the first pull's recovery point;
5 Important). Fix round 1: all addressed, re-review clean.
Task 3 Stage 1: minor (deferred): BackupGate.ts:201 dead `timeoutMinutes` in the local
error path — local backups no longer time out since the poll loop was removed.
