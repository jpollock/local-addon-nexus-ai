# Work Packets — intelligence layer

*Assignable units for AI engineering agents. Read `PARALLEL_PROTOCOL.md` first,
then the packet's named pattern. Scope: all of Milestone 1 + the designed
portion of Milestone 2. M3/M4 are deliberately unpacketized (open decisions —
see `INTELLIGENCE_ROADMAP.md`).*

*Status legend: `[ ]` open · `[~]` claimed (add agent/worktree) · `[x]` done
(add one-line outcome). Append notes; never delete them.*

---

## Milestone 1 — honest reads everywhere

### [x] WP-01 · Migrate `fleet_summary` to twin enrichment
Outcome: additive `> Observations:` header (coverage + freshness over the
tool's own site population) + `> Drift hint:` line naming ledger-observed
environments the population never counted at all (fleet-size disagreement,
not per-fact); per-population counts (WP/PHP distributions, plugin
inventory, integrations) untouched; legacy output byte-identical with the
core absent, pinned by a strip-and-compare parity test (see finding 2 below
for why a plain `startsWith`/`toContain` doesn't work for this shape).
Pattern: reader-migration (report variant, find-outdated-sites). Files:
`fleet/fleet-summary.ts` (+ test). Parallel-safe.
**Done 2026-08-15 (branch `wp-01`, worktree `.worktrees/wp-01`). ABI left on
system-Node (jest ran; `npm run rebuild` needed before next loading Local).**

**WP-01 calibration findings** (proposals only — no pattern amended by this packet):

1. **cp.output's "consider a live re-check" phrase is not in the report
   exemplar it's describing.** cp.output says every stale-carrying tool must
   include that exact phrase, but `find-outdated-sites.ts`'s own `>
   Observations:` line says "treat their version data as provisional"
   instead — no live-recheck phrase anywhere in the file. Followed the
   exemplar verbatim per this packet's explicit instruction to match the
   report variant; the pattern's stated rule and its own named exemplar
   disagree, and someone should reconcile them (amend the rule to exempt
   fleet-wide aggregates — a live re-check isn't a single-target action at
   that scope — or amend the exemplar).
2. **The additive-parity pin (`enriched.startsWith(baseline)`) only works
   for footer-style enrichment, and the pattern doesn't say so.**
   `compare_sites`' `### Observation Ages` section is appended at the very
   end, so `startsWith` fits. `find-outdated-sites`' (and now
   `fleet_summary`'s) `> Observations:` header is inserted near the TOP,
   between existing legacy lines — a mid-document splice that breaks not
   just `startsWith` but whole-string `toContain` too, since neither survives
   content inserted in the *middle* of the compared string. Resolved by
   filtering the enrichment's own added lines (identified by their `> `
   prefix) back out of the enriched text and asserting the remainder equals
   the baseline exactly. Worth a line in cp.test: "for header-shaped
   (mid-document) enrichment, strip the added lines back out and compare,
   rather than startsWith/toContain."
3. **A `let` accumulator (`stalest`) reassigned inside a nested closure
   type-checks to `never` at its later read site**, under this repo's
   tsconfig, even with an explicit union type annotation on the `let`.
   `find-outdated-sites.ts` avoids this because its assignment happens
   directly in a top-level `for` loop, not inside a separate helper function
   — the first draft of this packet mirrored that shape into a helper
   closure (`observeSite(...)`) for the two source loops (indexed local +
   wpe) and tsc failed with `TS2339: Property 'name' does not exist on type
   'never'`. Fixed by building a flat list of `{entityId, name}` first, then
   observing in a single inline loop in the same scope as the declaration.
   Worth a note on cp.enrich: don't wrap the observation loop in a helper
   closure if it also updates a stalest-style accumulator declared outside it.
4. **cp.drift-hint's two named shapes (single-fact-missing and
   observation-age skew) don't cover this packet's shape: a POPULATION-level
   disagreement.** `find_sites_with_plugin`'s drift hint is per-matched-fact
   ("this plugin fact exists in the ledger but not in today's match set");
   `compare_sites`' skew warning is per-dimension. `fleet_summary`'s is
   coarser than either: once per run, `core.twins.byFact('site.core')` minus
   the tool's own known-entity-id set, naming environments the *aggregate's
   site population itself* never counted — this packet's literal accept
   criterion ("drift between the ledger's fleet-size and the cache's
   fleet-size"). Worth naming as a third drift-hint variant in cp.drift-hint
   so a future report-shaped migration doesn't have to re-derive it from
   CLAUDE.md's "Fleet counts" section.
5. **Which population "fleet size" means was a judgment call the packet
   left implicit.** `fleet_summary` already tracks two local-site counts:
   `localSiteCount` (Local's own store, used only for the printed "Total
   sites" line) and `indexed.length` (indexRegistry entries with
   `structure`, the population the WP/PHP/plugin distributions actually
   aggregate over). The drift hint and `> Observations:` header compare
   against the latter (`indexed.length + wpeSites.length`, named
   `summaryPopulation` in the diff) — the population the report body itself
   counts — not the former. A stricter reading of "fleet-size" could have
   meant the printed Total-sites figure instead. Flagging for review rather
   than silently picking one; if the answer should be the Total-sites
   figure, this is a one-line change (`summaryPopulation` → `totalSites`) but
   changes which sites can trigger the drift hint (an un-indexed local site
   with a ledger fact would then also count as drift, which today it does
   not — it's simply outside the report's own population, not a
   disagreement with it).

### [x] WP-02 · Migrate `compare_sites` to twin enrichment
Outcome: additive `### Observation Ages` section (per-side age/trust/stale per
compared dimension) + per-fact SLO-skew warning + freshness footer; legacy
output pinned byte-identical by a `startsWith` parity assertion in the new test.
Pattern: reader-migration. Files: `fleet/compare-sites.ts` (+ test). Parallel-safe.
Accept: each compared dimension shows per-side observation age; a comparison
where the two sides' data ages differ by >1 SLO carries an explicit warning
(comparing fresh vs stale is the tool's chief footgun).
**Done 2026-08-15 (calibration run, Opus, branch `wp-02` — pending merge).**
Per-side ages + SLO-derived skew warning shipped; 10 calibration findings
recorded; two justified deviations (no per-row column in a two-sided report;
drift hint unreachable for explicit-target tools) — both folded back into the
pattern.

### [x] WP-03 · Reconcile `detect_drift` with ledger drift events
Outcome: appends the ledger's `state.drift.detected` records `[origin: ledger]`
plus a four-class reconciliation (explained / stable / coverage-gap /
ledger-only). The two detectors measure different axes — spatial vs temporal —
so the reconciliation classifies by FACT rather than diffing the two sets;
"coverage gap" and "ledger-only" are the classes that actually test our
pipeline against the existing detector.
Pattern: reader-migration + read `stateTwinFold.ts` drift hook first.
Files: `fleet/detect-drift.ts` (+ test). Parallel-safe.
Accept: tool reports BOTH its legacy computed drift and `state.drift.detected`
events from the ledger (`ledger.query({topicPrefix:'state.drift.'})`), labeled
by origin; discrepancies between the two detection paths are themselves listed.
This packet has extra value: it tests our own drift pipeline against the
existing detector.

### [x] WP-03b · detect_drift consumes drift.detected/2 + desc-order query
Pattern: reader-migration (amendment-aware). Files: `fleet/detect-drift.ts`
(+ its existing test). Parallel-safe. Natural fit: the session that built
WP-03. Two changes its own findings asked for, now unblocked by the core
fixes: (1) render `previous_observed_at` — "diverged for Xh before the change
was observed" per drift row; (2) switch the ledger query to `order: 'desc'`
so the 2000-event cap drops oldest events, not newest — which also makes the
disclosed truncation warning honest-and-boring instead of load-bearing.
Accept: both rendered/behaving with tests; additive parity holds; no schema
or core changes (already landed).
**Done 2026-08-15 (Opus, branch `wp-03b`).** The ledger change table gains a
`Diverged for` column from `previous_observed_at` — the interval between the
observation that recorded the previous value and the one that saw it change —
with a line saying what the number is, because it bounds how long that value
held and is NOT a measured site-to-site gap. Three renderings of "no honest
number" are kept distinct: `—` for unknown (v1 events, unparseable or negative
timestamps), `<1m` for known-and-tiny, and a real duration otherwise. The
ledger query is now `order: 'desc'` and the truncation-disclosure branch is
gone. 4 findings below; 9/9 mutations caught after the battery itself was
fixed (finding 1). No core, schema, topic or envelope changes.

### [x] WP-04 · Site Finder plugin/version filters read twins
Pattern: reader-migration, adapted — this is the NL→filter surface, so the
change is in the filter ENGINE, not a chat tool. Scout `filterEngine` service
first (services registry in `src/main/mcp/types.ts`; SF eval cases in
`tests/evals/cases/SF-*.yaml` define expected behavior). Serialized-with-owner
if the engine lives near core services; otherwise parallel-safe.
Accept: plugin-presence and plugin-version filters answer from
`twins.byFact`/`search` with the graph as fallback; SF-01/05/06 eval
expectations unchanged; result payload gains observed_at per row where the UI
can carry it. Escalate before changing any SF eval expectation.

**Scout note — 2026-08-15 (Opus, branch `wp-04`). Verdict:
SERIALIZED-WITH-OWNER. Awaiting ack before phase 2.**

*S1 — `services.filterEngine` is NOT the Site Finder filter engine.* The
registry entry (`src/main/mcp/types.ts:132`) resolves to
`src/main/search/FilterEngine.ts`, which is the eight smart-filter *chips*
engine (security / maintenance / activity / health) behind `fleet_filter` and
the fleet-discovery UI. It has **no plugin-presence and no plugin-version
filter** — its nearest neighbour is `filterSecurityUpdates` ("sites with >10
plugins"), and three of its eight filters (`large-db`, `low-disk`,
`low-health`) are hardcoded `return []` placeholders. Nothing in this packet's
accept criteria can be satisfied there. The packet's "scout `filterEngine`
first" instruction points at the wrong object; the name collides.

*S2 — the real engine is the `SITE_FINDER_APPLY` IPC handler, inlined in
`src/main/ipc-handlers.ts` (~L3567–4215).* That is where `plugins: [...]` and
`pluginVersion: {slug, olderThan}` — the two filters SF-01/05/06 assert — are
actually evaluated. It is one ~650-line handler with **three near-duplicate
copies** of the whole filter chain (local sites L3661+, WPE L3855+, external
L4010+); `pluginVersion` alone appears three times (L3766, L3940, L4096), each
with its own inline `norm()` zero-padded semver comparator. The result payload
built at L4162–4210 is three arrays (`local` / `wpe` / `external`) of flat row
objects — that is the surface that would gain `observedAt`.

*S3 — ownership test result: near core services, so serialized.*
`ipc-handlers.ts` is ~4,700 lines and holds essentially every IPC channel,
`__agentSettingsCache`, the `FilterEngine` construction (L2566), and the
`nexusServices` assignment block (L3168). It is not the packet-per-file shape
the ownership map calls parallel-safe (`fleet/<one-tool>.ts`), and any other
packet that needs an IPC edit lands in the same file. Two packets needing the
same file is itself an escalation trigger in PARALLEL_PROTOCOL.md, so this one
takes the owner lock rather than racing for it.

*S4 — the SF filter suite does not execute the production filter code.*
`tests/unit/site-finder/filter-apply.test.ts` (523 lines, the largest SF
artifact) declares its own `applyFilter(db, filter)` at L91 and asserts against
**that** re-implementation; it imports `better-sqlite3` and nothing from
`src/`. So the filter semantics SF-01/05/06 encode are pinned to a copy, not to
`ipc-handlers.ts`. A regression in the real handler is invisible to it. This is
a vacuous-guard shape and it is pre-existing — flagging, not fixing, in this
packet. The one suite that *does* drive the real handler is
`tests/unit/ipc/site-finder-soft-delete.test.ts` (MockIpcMain +
`registerIpcHandlers` with a partial deps object); that is the harness a WP-04
test should extend.

*S5 — the twin side is ready; no core change needed.* `graphBackfill.ts:130-150`
emits `plugin:<slug>` with value `{version?: string, active: boolean}` — both
the presence and the version predicate are answerable from
`twins.byFact('plugin:<slug>')`. `sloFor` already carries `/^plugin:/ → 8h`, so
`freshness().sloSeconds` is available and nothing needs a hardcoded SLO.
Entity join is clean: local rows key on the Local store site id and remote rows
on graph `sites.id`, which is exactly what `provisionalEnvironmentId` takes in
the exemplar (`find-sites-with-plugin.ts:67,103`) — no display names anywhere
in the join.

*S6 — eval-expectation risk is low but not nil.* SF-01/05/06 assert
`expected_filter_json` (the NL→filter mapping, produced by
`site-finder-prompt.ts` / `SITE_FINDER_AI_PARSE`) plus result-set membership.
Enrichment touches neither: the plan is twin-answered predicates with the graph
as fallback, additive `observedAt` on rows, membership unchanged. The live
question for the owner is S7.

*S7 — one genuine design question for the owner (blocks phase 2).*
"Answer from twins with the graph as fallback" can mean two different things
for a *filter*, and they differ in observable behaviour:
  (a) **enrich-only** — the graph continues to decide membership; twins add
      `observedAt`/trust/staleness per row. Strictly additive, zero eval risk.
  (b) **twins-decide-with-graph-fallback** — a twin fact, where present, is the
      authority for the predicate, and the graph answers only where the ledger
      has not observed. This is what the accept text reads like literally, but
      it *can* change result-set membership (a twin observed more recently than
      the graph row, or a `plugin:` fact the graph has since lost), which is the
      `ab.no-legacy-parity` abort condition and touches SF-01/05/06's
      `expected_sites`.
Recommendation: **(a) plus a drift hint** naming the twin-only population — the
same shape as the exemplar, which enriches rows and reports ledger-vs-cache
disagreement rather than merging it ("enrich, don't replace; disagreement is a
signal", CLAUDE.md). That satisfies "answer from twins" in the pattern's sense
while keeping membership — and therefore every SF eval expectation — untouched.
Requesting ack on the lock and a ruling on (a) vs (b) before any edit.

**Owner ruling — 2026-08-15 (architect). Lock GRANTED; semantics = (a).**

*Lock.* `src/main/ipc-handlers.ts` is granted to WP-04 as **integration-lock
class** — the ownership map predates this file's involvement, so it is treated
under the same rule as `src/main/index.ts`: wiring edits only, minimal import +
call, done as the packet's final step, no opportunistic refactoring. No
contention at grant time (WP-03b owns `detect-drift.ts` only).

*Proposed ownership-map amendment (for the next doc pass — PARALLEL_PROTOCOL.md
§Ownership map):*

| `src/main/ipc-handlers.ts` | Same lock as index.ts. Wiring edits only, as a packet's final step. It is ~4,700 lines and holds every IPC channel plus the `nexusServices` assignment block — an opportunistic refactor here collides with every future packet. |

*Semantics.* Option (a), **enrich-only + drift hint**, as the only reading
consistent with the pattern:
- **Membership := graph predicate, unchanged.** Option (b) changes matching
  semantics, which is literally `ab.no-legacy-parity`, and resolves the
  SF-expectation escalation in the wrong direction. SF-01/05/06 must hold **by
  construction**, not by coincidence of the current data.
- **Twins add, never subtract:** `row.observedAt` from the twin fact,
  `row.trust` / `row.stale` from `freshness()` — `sloSeconds`, never hardcoded.
- **The drift hint is required, not optional** (this is what rules out the
  no-hint variant). Per-fact variant: environments the ledger shows carrying
  the plugin that the graph-driven results missed. Skip `active: false` /
  `removed: true` facts. Keep the two absences distinct — never-observed is a
  *coverage gap*, observed-but-diverged is *stable divergence*.
- **Version filters (SF-05/06) follow the same rule.** The version predicate
  evaluates against the graph, unchanged. Where the twin's observed version
  disagrees with the graph's on a row that already matched, surface it as a
  per-row drift marker — do **not** re-evaluate membership against the twin
  value. If that is a fourth drift-hint variant, add it to the pattern's
  variant list with a code comment, per the pattern's own instruction.
- The additive-parity pin must make "SF unchanged by construction" a **failing
  test** if it is ever violated.

**Done 2026-08-15 (Opus, branch `wp-04`, worktree `.worktrees/wp-04`).**
Outcome: `SITE_FINDER_APPLY` result rows gain optional `observedAt` /
`observedTrust` / `observedStale`, plus a top-level `intelligence` block
(freshness counts, `twinOnly`, `versionDrift`, `coverageGap`, rendered
`notes`). All logic lives in the new
`src/main/intelligence-host/siteFinderTwins.ts`; the integration-locked
`ipc-handlers.ts` takes **39 lines** — one import, one call, three
`...provenance(id)` spreads, three row-type widenings, one payload block, no
refactoring. `SidebarSearchPanel.tsx`'s three row interfaces extend a shared
optional `SiteResultProvenance` so the UI can carry the fields; no rendering
changed. Membership is the graph predicate throughout, so SF-01/05/06 are
unchanged by construction — **no eval expectation was touched.**

*Verification.* `npm run typecheck` clean. `npm test` 492 suites / 6146 passed
/ 12 skipped, against a base-branch baseline of 491 / 6144 / 2 measured on the
primary checkout at `303474c3` — reconciles exactly as +12 mine, −10 skipped
for the worktree's missing model (finding 4). Legacy suites for the touched
files: 192 suites / 2048 tests green (`tests/unit/{site-finder,ipc,audit,main,
fleet,agent-runtime,renderer,chat,common,events}`), which includes both real
SF suites. Base (WP-03b) was merged into `wp-04` before the final run.

*Mutation testing.* 7 of 7 caught after two fixture gaps were closed: wrong
entity-id source (6 fail), hardcoded SLO (2), merged absences (1), no
`active:false` skip (2), no version-drift report (1), freshest-instead-of-
stalest (1), and — the one that matters — **twins-decide membership**, injected
at the `ipc-handlers.ts` call site, which fails exactly the two parity tests.
The ruling's "failing test, not a judgment call" requirement is met.

**WP-04 calibration findings:**

1. **The packet's own scout pointer was wrong, and the name collision is the
   trap.** "Scout `filterEngine` (services registry in `src/main/mcp/types.ts`)"
   leads to `src/main/search/FilterEngine.ts`, which has no plugin filter at
   all; the Site Finder filter engine is the `SITE_FINDER_APPLY` handler inlined
   in `ipc-handlers.ts`. A packet that names a service handle should name the
   file it expects, or a symbol that only exists in one place. Full detail in
   the scout note above (S1/S2).
2. **`cp.drift-hint`'s per-fact variant assumes a single-predicate tool, and
   silently misfires on a composite one.** The exemplar computes the twin-only
   population as "ledger entities with the fact, minus the result set" —
   sound when the result set IS the fact's population. Site Finder composes many
   predicates, so a site excluded by `phpEolOnly` would have been reported as a
   ledger-vs-cache disagreement it is not. Fixed by defining the disagreement
   against the **cache's own plugin rows** rather than the result set. Worth a
   sentence in cp.drift-hint: *for a multi-predicate tool, subtract the cache
   population for that fact, never the tool's result set.*
3. **Fourth drift-hint variant, per the pattern's request to record one:
   VALUE MISMATCH ON A MATCHED ROW.** The three listed variants are all
   absences (per-fact missing, per-dimension skew, population-level). A plugin
   fact carries a version, so a row can be present in both populations and still
   disagree about *what* is installed — reported as `versionDrift`, never acted
   on. Named and commented at its definition in `siteFinderTwins.ts`.
4. **A fresh worktree silently runs 10 FEWER tests than the primary checkout.**
   `tests/main/embedding-service.test.ts` gates on
   `models/all-MiniLM-L6-v2-quantized/{model.onnx,vocab.txt}`, which is a
   downloaded, untracked artifact — absent in every new worktree, so the suite
   `describe.skip`s and reports green. This produced a phantom 10-test delta
   while comparing against the primary checkout. PARALLEL_PROTOCOL's setup
   section should say so: *green in a worktree is a smaller set than green in
   the primary checkout; diff skipped counts, not just failures.*
5. **`.gitignore`'s `node_modules/` does not match the symlink the protocol's
   own setup step creates.** The trailing slash means directories only, so
   `ln -s ../../node_modules node_modules` produces a tracked-able symlink that
   a `git add -A` commits (this packet did, and reverted it in `4a6…`). Either
   the protocol should say "`git add` explicit paths in a worktree", or the
   ignore rule should lose its trailing slash.
6. **Extend WP-01's finding 2 to non-text surfaces.** The parity pin for a
   JSON/IPC payload cannot use `startsWith` or `toContain` at all: strip exactly
   the keys the enrichment adds (per row, plus the top-level block) and assert
   **deep equality**. Only that catches a row appearing, vanishing, or changing
   order — which is precisely what a twins-decide regression does.
7. **Sequence the parity baseline AFTER every fixture mutation.** The first
   draft captured the pre-core baseline before deleting the cache row that
   creates the drift scenario, so the pin compared two different graph states
   and failed on the fixture rather than the code. `initIntelligenceCore` does
   not register the core (`setIntelligenceCore` does), so the baseline run can
   sit anywhere between them — put it last.
8. **The base branch moved mid-packet and a naive baseline comparison invented
   a regression.** WP-03b landed on `poc/nexintelligence` while this packet was
   in flight, so `detectDrift.test.ts` differed 5-vs-8 tests against current
   HEAD. Compare against the worktree's **merge-base**, or merge the base in
   first (done here) — never against a HEAD that has advanced.
9. **Pre-existing, flagged not fixed: the largest SF test artifact does not
   execute the code it appears to guard.**
   `tests/unit/site-finder/filter-apply.test.ts` (523 lines) declares its own
   `applyFilter()` at L91 and imports nothing from `src/`, so the filter
   semantics SF-01–08 encode are pinned to a copy. A regression in the real
   handler is invisible to it. Out of scope here (fixing it means porting 500
   lines of assertions onto `registerIpcHandlers`), but it is the reason this
   packet's test drives the real handler instead.
10. **Observed once, not reproduced:** one `npm test` run failed
    `tests/unit/cli/commands/sync.test.ts` (10 tests, CLI, untouched by this
    diff) immediately after a mutation-testing loop. It did not recur in three
    isolated runs or four subsequent full runs. Most likely stale ts-jest cache
    from the mutation churn; recorded rather than dismissed.

**ABI state: system-Node (jest was run). `npm run rebuild` is required before
loading the addon in Local again.**

### [x] WP-05 · Jest roots + CI wiring  **(PREREQUISITE — elevated by calibration finding WP-02.1)**
Outcome: `roots: ['<rootDir>/tests', '<rootDir>/src']` — one list, so `npm test`
includes the intelligence suites by default; `test:ci` names the third tree
positionally so both CI workflows pick them up unchanged. +10 suites / +15
tests, nothing else added or dropped.
No pattern needed. Files: `jest.config.js`, `jest.ci.config.js` and/or
`package.json` scripts. Parallel-safe, but land BEFORE trusting any other
packet's "green": `jest.config.js` has `roots: ['<rootDir>/tests']`, so the
intelligence suites under `src/**/__tests__/` never run without an explicit
`--roots src`. Fix: add `<rootDir>/src` to roots (decide with the owner
whether `npm test` should now include them — probably yes) or wire dedicated
scripts; then include the suites in `test:ci`.
Accept: `npm test` and `npm run test:ci` both execute the intelligence suites
without extra flags; green run demonstrated; no other suites disturbed; the
`--roots src` workaround notes in PARALLEL_PROTOCOL.md, CLAUDE.md, and the
reader-migration pattern updated to the final command.
**Done 2026-08-15 (Opus, branch `wp-05` — pending merge).** Decision recorded:
`npm test` DOES run the intelligence suites (one `roots` list) rather than a
separate opt-in script — a second script is a second thing to forget, which is
the failure mode this packet exists to remove. 8 calibration findings recorded
below, one of them fixed in-packet (the vacuous `pretest` ABI guard).

### [x] WP-06 · Review sweep
No pattern. Read-mostly. Parallel-safe (but run last, after WP-01..05 merge).
Accept: lint clean on all intelligence files; no leftover scaffold-isms
(`(e: any)` casts justified or typed properly against real `NexusServices`);
every new file has its header comment; a draft PR description exists at
`docs/intelligence/PR_DESCRIPTION.md` telling the story (model → ADRs → spine
→ readers → live re-check) with verification steps for a reviewer.
**Done 2026-08-15 (Opus, branch `wp-06`).** All six inherited items closed:
the `lib/` tsconfig question is RULED (exclude — the trade was largely
illusory), the CLAUDE.md ABI drift is fixed as a two-values fact rather than
a new constant, the `(e: any)` hunt found three real regressions against
`main` and fixed them, the "intermittent" host/sync abort turned out to have
a **deterministic repro**, and WP-03b's cp.test fixture proposal is CONCURRED
with an added constraint. 12 findings recorded below.

### [x] WP-04b · Port SF filter-apply assertions onto the real handler  *(registered from WP-04 finding; not intelligence-layer work)*
**DONE** — `tests/unit/ipc/site-finder-filters.test.ts` (40 tests) drives the
real handler; the copy is deleted; two live chain divergences found and
escalated, not fixed. Notes at the end of this file.
`tests/unit/site-finder/filter-apply.test.ts` (523 lines, the largest SF test
artifact) declares its OWN `applyFilter()` and imports nothing from `src/` —
the Site Finder filter semantics are pinned to a copy, so a regression in the
real `SITE_FINDER_APPLY` handler is invisible to it. WP-04's
`siteFinderTwins.test.ts` drives `registerIpcHandlers` directly and is the
template. Port the ~500 lines of assertions onto the real handler (or prove a
given assertion is unreachable through it and say so). Parallel-safe;
`ipc-handlers.ts` is READ here, not edited — no lock needed. Legacy-test
debt, not intelligence scope: can run any time, does not block M1 close.
Accept: every semantic currently pinned by the copy is pinned against the
real handler (or explicitly waived with a reason); the copy is deleted or
reduced to pure input-fixture helpers; SF-01/05/06 eval expectations
unchanged.

### [x] WP-04c · Fix the three SF filter-chain divergences  *(registered from WP-04b escalations; legacy bugfix, not intelligence scope)*
**DONE 2026-08-15** — all three now apply per-chain: `phpVersions` extended to
WPE + external (exact membership, beside `phpEolOnly`); `wpeEnvironment`
honoured on WPE + external and pinned as matching nothing on local (owner
ruling); `minAdminCount` honoured on all three from `sites.user_count_by_role`,
NULL excluded. Both previously-dead filters wired into the Site Finder prompt.
40/40 WP-04b tests green untouched, +13 new pins, 8/8 mutations caught with
named per-chain witnesses. The three chains remain three chains. Notes at the
end of this file.
Two live defects in `SITE_FINDER_APPLY` (`src/main/ipc-handlers.ts`),
measured against the WP-04b fixture: **(1)** `phpVersions` is applied on the
local chain only — WPE/external chains return every site regardless
(`phpEolOnly`, same column, IS applied on all three, so this is an omission,
not a policy); **(2)** `wpeEnvironment` and `minAdminCount` pass `hasFilter`
but NO chain implements them — either filter alone returns all sites, the
exact outcome the empty-filter guard exists to prevent.
**Step 1 is an owner ruling, blocking:** for `wpeEnvironment`/`minAdminCount`
— implement them, or remove them from `hasFilter` + the UI? (Implementing
needs the data to exist on the remote chains; check what the graph actually
carries before choosing.) `phpVersions` needs no ruling: extend to all three
chains, matching `phpEolOnly`'s placement.
This packet EDITS `ipc-handlers.ts` filter chains → integration-lock class:
serialized, announce before starting, no opportunistic refactor of the three
chains (dedup of the chains is explicitly out of scope — tempting, separate
decision). On completion, flip WP-04b's deliberately-withheld assertions into
real pins in `tests/unit/ipc/site-finder-filters.test.ts`.
Accept: `phpVersions` filters all three chains (pinned per-chain);
`wpeEnvironment`/`minAdminCount` either implemented (pinned per-chain) or
fully removed (hasFilter + UI + a pin that they no longer pass the guard);
all 40 existing WP-04b tests still green; SF eval expectations unchanged
unless the owner ruling says otherwise (escalate if so).

---

## Milestone 2 — designed and speccable now

### [x] WP-07 · Wire entity service v0  **(REWRITTEN per reconciliation — read `reconciliation-entity-identity.md` first)**
*Done 2026-08-15 — entity service wired as a `site_links` consumer: mirror sweep
after startup reconciliation, both-alias env entities, ensure()-adopted ids
(all pre-existing tests green, unchanged), `nexus_pairing_proposals` scoped to
the unresolved report. Track-1 files untouched. See packet notes below.*
Patterns: `add-a-producer.md` for wiring discipline; the governing decision is
`docs/intelligence/reconciliation-entity-identity.md` (Track 1 keeps runtime
ownership; the entity service is a consumer of `site_links`, never a
competitor). **Serialized (core lock).**
Steps: (1) add `'host_connection'` to `EstablishedBy`; (2) host bootstrap
constructs `EntityService`, exposes on `IntelligenceCore`; (3) mirror
`site_links` one-way into entity aliases/links per the mapping table in the
reconciliation note (user→user_link 1.0, hostConnection→host_connection 0.95,
inferred→name_heuristic ≤0.5; `verified_at` = freshness), idempotent, re-run
per sweep; (4) alias env entities under BOTH `graph.site_row` and
`wpe.install_id` (the id-mismatch trap in the note's "subtle trap" section),
and Site entities under `wpe.site_id`; (5) producers call `ensure()` instead
of raw `provisionalEnvironmentId` — ids identical by construction, assert it
in a test; (6) `proposePairings()` gains `unresolvedOnly` and runs ONLY over
the resolver's unresolved report; proposals surface beside `nexus_link_site`,
not as a new parallel queue.
Accept: all existing tests green (unchanged ids prove adoption); site_links
rows visible as entity aliases with correct established_by; a user link in
site_links always outranks any heuristic in entity resolution; proposals
appear only for unresolved sites; NO automatic pairing anywhere; Track-1
files (`src/main/fleet/*`) untouched except any agreed hook, which requires
owner sign-off first.

### [x] WP-08 · Policy & runbook repo v0 — translate permissions
*(Done 2026-08-15: `law/` loader + ConstraintRegistry + settings mirror shipped
under `src/intelligence/law/`; host adapter `permissionsMirror.ts` computes
every matrix cell BY CALLING `isOperationAllowed` — zero reimplemented
semantics, zero diffs on the enforcement surface. See packet notes.)*
Pattern: none — spec IS `docs/intelligence/anchor-slice/policy/ops-default.md`
+ architecture.md ADR-5/§7. **Serialized (core lock), and every M4 eval case
is the regression harness: they must stay green untouched.**
Steps: (1) a `law/` directory format loader (markdown + frontmatter →
constraint registry in memory); (2) generate `law/policy/ops-default.md`'s
gateway-enforced constraints FROM current `wpeOperationPermissions` semantics
(translation, not reimplementation — the settings stay authoritative in v0,
the registry mirrors them and records origin); (3) constraint lookup API for
future assembler use.
Accept: registry loads and mirrors live settings; M4-04..12 behaviors
unchanged; unit tests for the loader; divergence between registry and settings
logs a warning (it should be impossible in v0).

### [review] WP-09 · Author the remaining v0 runbooks (4)
*Authored on branch `wp-09`, docs-only, NOT merged — strict runbooks bind future
agents, so the human owner reviews and merges. Outcome + judgment calls in the
packet note dated 2026-08-15 below.*
Pattern: the format spec is ADR-17 + the exemplar
`docs/intelligence/anchor-slice/runbooks/bulk-plugin-update.md`. Parallel-safe
(one runbook per agent if desired). Human review required before merge (strict
runbooks bind future agents).
Deliver: `staging-promotion.md` (strict — mine eval 05 + M4-08/09 semantics),
`wpe-pull.md` (guided — mine eval 04's friction notes), `diagnose-site.md`
(guided — mine evals 06/10), `incident-response.md` (strict — mine the
sentinel eval's ground truth + eval doc D-02).
Accept: each has frontmatter that validates (checkpoints enumerated for
strict), a `requires_sources` bill, abort paths, and a communication block.

### [x] WP-10 · Recon: the Ask/Tell context path  *(Explore-shaped — touch nothing)*
**Outcome:** `docs/intelligence/recon-ask-tell.md` delivered — four actor
surfaces mapped, injection points per distribution pattern, 10 risks, a
three-call-site wiring proposal confined to `src/main/chat/ChatService.ts`.
**Awaiting owner review of §4 before WP-11 is unblocked.**

No pattern. Read-only reconnaissance; any model tier. Parallel-safe.
Map how the in-product agent surface builds context today: where the system
prompt is assembled, where tools are granted, where conversation state lives,
what enters context per turn (files under `src/main/assistant/`, `src/main/chat/`,
`src/main/ai-context/`, `src/main/agent-runtime/` — start with whatever
`ipc-handlers.ts` routes chat turns to).
Deliver: `docs/intelligence/recon-ask-tell.md` — the context assembly call
graph, injection points where an assembler bundle could enter (ambient policy,
pushed runbook, retrieval), risks, and a proposed minimal wiring. **This
unlocks writing the assembler packet (WP-11).**

### [ ] WP-11 · Context assembler v0  **(UNBLOCKED 2026-08-16 — recon reviewed, four owner rulings recorded below)**
Contract: architecture.md §6 (AssembleRequest → ContextBundle, manifest as
audit artifact, fail-closed ADR-7) **as amended by ADR-20** (hash re-assert).
The implementation skeleton IS `recon-ask-tell.md` §4 — new files
`src/intelligence/assemble/*` + `src/main/intelligence-host/chatAssembly.ts`,
exactly three call-site edits in `src/main/chat/ChatService.ts` (unlocked
file), one signature widening in `tool-adapter.ts`. No `ipc-handlers.ts` or
`index.ts` edit. §4.3's deferrals (surfaces B/C/D, ToolGrant population, R1)
are adopted as scope law; §4.4's five pins are acceptance criteria verbatim
(TaskId-per-turn as `correlation`; manifest emitted as
`task.context_assembled` to the LEDGER, not operation-audit.log; a token
estimator; the freshness-disclosure prose contract; the additive-parity pin —
empty bundle ⇒ byte-identical prompt).
Owner rulings (2026-08-16): demo surface = Docked Panel; ambient cadence =
version-hash per turn, full set on change/absence (ADR-20); staleness =
model-must-relay in prose, no new UI channel; R1 = fixed separately (WP-12).
**Serialized (core lock), and MUST NOT run concurrently with WP-12 — both
edit ChatService.ts. Sequence: WP-12 first.**
Definition of done for the milestone: evals B-03/E-01/E-02 against the real
ledger (harness rules H-01/H-02).

### [x] WP-12 · Fix R1 — rehydrated chat sessions lose the system prompt  *(registered from WP-10 review; live security gap, runs BEFORE WP-11)*
**Outcome:** fixed as specified — the restore branch now rebuilds the prompt
via `buildSystemPrompt(siteId)` and prepends it; nothing new is persisted, and
the renderer is untouched. One extra change the packet asked to be considered:
persisted `system` rows are now **dropped** from the restored history (the
filter at ChatService.ts:135 keeps `user|assistant` only), so a session written
by an older build cannot carry two system messages — which matters because
`anthropic.ts` and `google.ts` keep the FIRST and silently discard the rest
(R3), so the stale copy would have won. 21-line diff confined to that one
branch. 4 pins in `tests/unit/chat/chat-service-rehydration.test.ts`,
mutation-checked both ways. **WP-11 is now unblocked.**
`ChatService.sendMessage`'s persisted-history branch (ChatService.ts:130-138)
restores without ever calling `buildSystemPrompt`, and the renderer strips the
system message when persisting (PanelChat.tsx:540-550) — so a Docked Panel
session reopened after a restart runs with NO fleet context, NO tool
doctrine, and NO `UNTRUSTED_DATA_DIRECTIVE` (the prompt-injection defense).
Fix shape (agent to confirm): on the restore branch, rebuild the system
prompt fresh and prepend it — never persist it (a stored prompt goes stale;
rebuilding is the R2-friendly direction). Renderer persistence stays as-is
unless the agent shows why not. Pin with a test that rehydrates a session and
asserts `messages[0].role === 'system'` and contains the untrusted-data
directive; ChatTab (never persists) must be unaffected.
Parallel-safe with everything EXCEPT WP-11 (same file). Not intelligence
scope; normal protocol applies.

---

## Packet notes (append-only)

- 2026-08-15 · Pack created. WP-01..06 executable immediately; WP-07..09 need
  the core lock and/or human review as marked; WP-10 is the bridge to WP-11.

- 2026-08-15 · **WP-02 calibration findings** (first packet executed by an agent
  other than the pack's author; recorded as a docs-quality signal, not as
  complaints). Proposals only — no pattern was amended by this packet.

  **(a) Wrong, blocking, or missing**

  1. **The Definition of Done's test command matches zero tests.**
     `jest.config.js` sets `roots: ['<rootDir>/tests']`, so
     `npx jest src/intelligence src/main/intelligence-host src/main/mcp/modules/fleet/__tests__`
     — the exact command in PARALLEL_PROTOCOL §DoD-2 *and* in CLAUDE.md's
     intelligence section — exits `No tests found`. Every suite this layer has
     written has therefore never run via its own documented command; they only
     run with an explicit `--roots`. This is the single highest-value fix in the
     pack and it makes WP-05 (CI wiring) a prerequisite for trusting any
     packet's "green" claim, not a tidy-up at the end.
  2. **The worktree setup command in PARALLEL_PROTOCOL §Isolation cannot run
     as written.** `git worktree add .worktrees/<id> poc/nexintelligence` fails
     with "already used by worktree" because the branch is checked out in the
     primary worktree. `-b <packet-id>` is required.
  3. **The intelligence layer is not committed on `poc/nexintelligence`.**
     `src/intelligence/`, `src/main/intelligence-host/`, `docs/intelligence/`,
     `INTELLIGENCE_ROADMAP.md` and `fleet/__tests__/` were all untracked, and
     the four migrated fleet readers were unstaged modifications. A worktree
     created per the protocol contains *none of the layer* — the agent lands in
     a checkout where the pattern's exemplars do not exist. This packet
     committed the working state verbatim as its first commit to get a real
     base.
  4. **`npm test` cannot run against the tree as shipped.** `better-sqlite3`
     was built for Electron (ABI 146) and every intelligence suite died on
     `NODE_MODULE_VERSION`. CLAUDE.md documents the two-context rule in a
     different section; the protocol's "House rules" mention `npm run rebuild`
     for the *Electron* direction only. **`npm rebuild better-sqlite3` was run
     to get tests green — Local needs `npm run rebuild` before it will load
     the addon again.** The protocol should say which direction a packet is
     expected to leave the tree in.

  **(b) Learned from the exemplar, not stated in the pattern**

  5. **The pattern has two output shapes and `compare_sites` is neither.**
     cp.output covers "table tools" (replace the last column) and "report
     tools" (`> Observations:` header). This tool is a *two-sided* report: no
     per-row column exists to replace, and a single header line cannot carry
     per-side ages. Resolved with an additive `### Observation Ages` section,
     justified in a code comment per cp.read-exemplar. Pattern should name the
     two-sided shape as a third case.
  6. **cp.drift-hint is not universally applicable, and the pattern states it
     as though it is.** "Twin facts with no cache result" presupposes the tool
     *discovers* a match set. `compare_sites` is handed two sites by the
     caller, so twin-only-environment is unreachable. The genuine analogue is
     the skew warning. The pattern should say: if the tool does not discover
     its own result set, identify what the ledger-vs-cache disagreement *is*
     for that tool rather than skipping the checkpoint.
  7. **The entity-join id source is under-specified for resolver-based tools.**
     cp.entity-join names IndexRegistry `siteId` and `s.id` from graph queries.
     Tools that resolve through `resolveAnySite` get the right id for free
     (local store id for local, graph `sites.id` for remote), but the pattern
     doesn't say so, and getting it wrong is silent — the join just returns
     nothing and enrichment vanishes with no error.
  8. **`freshness()` already returns `sloSeconds`.** The pattern only mentions
     `.fresh`, so an agent implementing anything SLO-relative (like this
     packet's acceptance criterion) will reach for `sloFor()` or hardcode a
     constant. Worth one line: read the SLO off the `Freshness` result so it
     tracks the fact, not the tool.
  9. **cp.test says "one test file per tool", but two of the three named
     exemplars have no test** (`find-sites-with-theme`, `find-outdated-sites`).
     Either they are owed tests or the checkpoint means "per migrated tool from
     now on" — worth disambiguating so an agent doesn't assume it is looking at
     an incomplete checkout.
  10. **No exemplar pins the additive-parity claim.** `findSitesWithPlugin.test.ts`
      asserts enrichment renders, but nothing asserts the legacy output is
      unchanged — which is the pattern's own abort condition (`ab.no-legacy-parity`).
      This packet ran the tool once *before* registering the core and asserted
      `enriched.startsWith(legacyText)`. Cheap, and it turns the hard rule into
      a test instead of a comment.

  **(c) Suggested one-line amendments**

  - PARALLEL_PROTOCOL §Isolation: `git worktree add -b <packet-id> .worktrees/<packet-id> poc/nexintelligence`.
  - PARALLEL_PROTOCOL §DoD-2 + CLAUDE.md: `npx jest --roots src/intelligence src/main/intelligence-host src/main/mcp/modules/fleet/__tests__` until WP-05 lands.
  - PARALLEL_PROTOCOL §House rules: "Tests need the system-Node build (`npm rebuild better-sqlite3`); restore with `npm run rebuild` before loading Local."
  - reader-migration cp.output: add a third shape — "Two-sided tools: an additive `### Observation Ages` section, one row per compared dimension, one column per side."
  - reader-migration cp.drift-hint: "If the tool does not discover its own match set, name the tool's real ledger-vs-cache disagreement instead of skipping this."
  - reader-migration cp.enrich: "`freshness()` returns `sloSeconds` as well as `fresh` — use it for any SLO-relative logic."
  - reader-migration cp.test: "Assert legacy parity directly: run the tool once before `setIntelligenceCore`, then assert the enriched output starts with it."

  **Out-of-scope defect observed, not fixed:** `tests/main/fleet-tools.test.ts`
  ("all 6 fleet tools are registered") fails on the baseline — `verify_site_live`
  made it 7 and the legacy count was never updated. Verified pre-existing by
  stashing this packet's diff. Belongs to whoever owns `fleet/index.ts`
  (integration lock).

- 2026-08-15 · WP-02 calibration run complete (Opus, branch `wp-02`). Verdict:
  zero design-comprehension failures; every blocker was repo-state drift from
  the docs (untracked layer files, jest roots, worktree -b, ABI). Amendments
  applied by the integration-lock holder: PARALLEL_PROTOCOL (worktree -b +
  tracked-files precheck + ABI disclosure + corrected DoD test commands),
  CLAUDE.md section (test command), reader-migration pattern (three output
  shapes incl. two-sided skew warning; drift-hint applicability; sloSeconds;
  shared-test-file allowance; additive-parity pin canonized), WP-05 elevated
  to prerequisite. Also fixed: `tests/main/fleet-tools.test.ts` count 6→7
  (verify_site_live), a pre-existing break owned by the fleet/index.ts lock.
  OWNER ACTIONS OUTSTANDING: (1) commit the intelligence layer + docs on
  `poc/nexintelligence` (currently untracked in the primary checkout — the
  wp-02 branch carries a verbatim base commit if useful); (2) `npm run rebuild`
  before next loading Local (tests left better-sqlite3 on system-Node ABI);
  (3) review + merge `wp-02`.

- 2026-08-15 · **WP-03 calibration findings** (second packet; docs had already
  absorbed the WP-02 round). Proposals only — nothing amended by this packet.

  **Docs held up well.** The WP-02 amendments all paid off in practice: the
  `-b` worktree command worked first try, the layer was tracked so the worktree
  contained its own exemplars, `--roots src` ran, and cp.entity-join's
  `resolveAnySite` note answered the id question without a detour. cp.test's
  additive-parity pin was directly reusable. Nothing in the three documents was
  wrong. Findings below are gaps rather than errors.

  **(a) The packet's framing hides a semantic mismatch**

  1. **The two detectors measure different axes, and the packet's wording
     ("discrepancies between the two detection paths") reads as though they
     measure the same one.** Legacy `detect_drift` finds SPATIAL drift
     (baseline vs another site, one moment). `state.drift.detected` records
     TEMPORAL drift (one environment's fact changing over time). Neither is a
     subset of the other, so a set-difference between them is meaningless —
     it would report every temporal change as a "missed" spatial drift and
     vice versa. Resolved by classifying each legacy finding against what the
     ledger knows about the same FACT (four classes; see the outcome note).
     Worth stating in the packet so the next reader doesn't implement the
     naive diff, which looks right and produces noise.
  2. **The genuinely valuable classes were not the ones the packet named.**
     "Discrepancies" turned out to mean two distinct things worth separating:
     a fact the ledger has NEVER observed (a real pipeline coverage gap) vs. a
     fact it has observed but never seen change (stable divergence). Merging
     them — the obvious implementation — hides exactly the signal this packet
     was commissioned to surface.

  **(b) Ledger/API sharp edges a reader-migration author will hit**

  3. **`ledger.query()` is `ORDER BY id ASC LIMIT n`, so hitting the limit
     drops the NEWEST events.** For any "what changed recently" reader that is
     backwards, and the failure mode is silent: a truncated result reads as
     "nothing changed." There is no `order` or `beforeId` option. This tool
     discloses the cap in its output; a general fix belongs in the core (owner
     call — `src/intelligence/` is under the serialized lock, and it is an
     escalation trigger, so this packet did not touch it).
  4. **`DriftNotice` carries `previousObservedAt`; the emitted
     `drift.detected/1` payload drops it.** So a reader can say "changed to X,
     observed 1h ago" but cannot say "diverged for 20h before that" — the most
     useful number for a drift report. Adding it is a payload schema change
     (escalation trigger), so it is recorded here rather than done.
  5. **`state.drift.detected` is emitted by the fold but skipped by it.**
     `stateTwinFold`'s EXTRACTORS have no entry for it, so drift events never
     become twin facts — correct, and the file says so, but it means drift is
     readable ONLY via `ledger.query`, never via `twins.*`. Worth one line in
     the pattern: the twin store is not a complete view of the ledger.

  **(c) Process finding — mine, not the docs'**

  6. **Mutation-testing an UNCOMMITTED file destroyed the work.** The battery's
     `git checkout <file>` restore step reverts to HEAD, not to the pre-mutation
     working state, so the first restore silently wiped the migration and the
     next five mutations ran against the original file — all reporting
     "failures" that were really the absence of the feature. Cost: a full
     reconstruction. Two cheap guards, now used here and worth adding to the
     pattern if mutation testing becomes standard practice: **commit before
     mutating**, and **assert the substitution actually changed the file**
     (checksum before/after) so a non-applying regex reports itself instead of
     masquerading as a caught mutation.

  **(d) Suggested one-line amendments**

  - WP-03 packet text: "NB: the detectors measure different axes (spatial vs
    temporal) — classify legacy findings against ledger facts; do not diff the
    two event sets."
  - reader-migration cp.drift-hint: "Separate 'ledger never observed this fact'
    (pipeline coverage gap) from 'observed but never changed' (stable
    divergence) — merging them hides the coverage gap."
  - reader-migration cp.enrich: "`ledger.query()` returns OLDEST-first and
    truncates at `limit`; disclose the cap in output rather than presenting a
    truncated result as complete."
  - reader-migration cp.test: "If you mutation-test your assertions, commit
    first — `git checkout` restores from HEAD, not from your working tree — and
    verify each mutation actually applied."

  **Known-untested branch, disclosed rather than faked:** the
  `DRIFT_QUERY_LIMIT` truncation warning. Reaching it needs 2000 drift events;
  a fixture that large would dominate suite runtime. Mutating
  `truncated = false` does NOT fail the suite. Every other branch added by this
  packet is pinned (mutation battery: classification inversion, baseline-side
  match, matched-fact bookkeeping, append-vs-prepend, staleness detection,
  change direction, scope filter, and the twins.get baseline fallback all fail
  the suite when broken).

  ABI STATE: this session ran jest — better-sqlite3 is on the **system-Node**
  build. `npm run rebuild` before loading Local.
- 2026-08-15 · **WP-07 reconciliation complete** (owner-requested, architect
  session). The Track-1 fleet-identity system (`site_links`, SiteLinkResolver,
  FleetAssembler) and entity service v0 were independent solutions to the same
  problem. Decision recorded in `reconciliation-entity-identity.md`: Track 1
  keeps runtime ownership; the entity service consumes `site_links` one-way,
  adopts `wpe_site_id` as the logical-Site alias, demotes `proposePairings()`
  to gap-filler over the resolver's unresolved report, and aliases env
  entities under both `graph.site_row` and `wpe.install_id` (id-mismatch
  trap). WP-07 rewritten accordingly. The convergence of the two designs on
  "user links outrank inference, provenance on every join" is treated as
  validation, not accident.

- 2026-08-15 · **WP-05 calibration findings** (branch `wp-05`, Opus). Same
  spirit as WP-02's: proposals, not complaints. One was fixed in-packet because
  `package.json` scripts are inside this packet's scope and the defect made the
  packet's own acceptance criterion unreachable; the rest are reported only.

  **(a) Fixed in-packet**

  1. **The `pretest` ABI guard was vacuous — it could never fire.** It ran
     `node -e "try{require('better-sqlite3')}catch(e){process.exit(1)}"`, but
     `require()` only resolves the JS wrapper; better-sqlite3 calls `bindings()`
     lazily inside the `Database` constructor, so the native `.node` file is
     never opened and the guard passes against an Electron-ABI build. Measured:
     the guard exited 0 while the binary was ABI 146, `npm test` then ran, and
     51 suites died on `NODE_MODULE_VERSION`. This is precisely WP-02 finding
     (a)(4) — and the reason CLAUDE.md's "the `pretest` hook handles it" was
     false. Now `new (require('better-sqlite3'))(':memory:').close()`.
     *(CLAUDE.md's intelligence bullet still says the hook handles it; that
     sentence was outside this packet's three authorized doc lines, so it is
     left for the integration-lock holder — it is now TRUE, but only because of
     this fix.)*

  **(b) Repo/protocol drift a worktree agent hits immediately**

  2. **A fresh worktree has no `node_modules` and no `lib/`, and the protocol
     mentions neither.** `node_modules` was symlinked to the primary checkout
     (`ln -s ../../node_modules node_modules`) — needed because
     `moduleNameMapper` resolves `<rootDir>/node_modules/marked/...`, which
     plain Node ancestor-resolution does not cover. Note the symlink shows as
     untracked in `git status` (`.gitignore` has `node_modules/`, and the
     trailing slash does not match a symlink), so never `git add -A` in a
     worktree.
  3. **Missing `lib/` makes a legacy suite fail in a way that reads as a branch
     regression.** `tests/unit/agent-runtime/AgentRegistry.test.ts` writes a
     temp agent that requires the *compiled* `<rootDir>/lib/main/agent-sdk`; in
     a fresh worktree that path does not exist and 4 tests fail. Running the
     same suite in the primary checkout (which carries a stale `lib/` from an
     old build) passes. `npm run compile` in the worktree fixes it. Proposed
     PARALLEL_PROTOCOL §Isolation addition: after `git worktree add`, run
     `ln -s ../../node_modules node_modules && npm run compile` before trusting
     any baseline.
  4. **Consequence of 3 for the real CI gate, not fixed here.** CI runs
     `npm ci` then `npm run test:ci` with **no build step** and there is no
     `prepare` script, so `lib/` does not exist in CI either — those 4
     AgentRegistry tests should be failing on CI today, and pass locally only
     by accident of a stale `lib/`. Fix belongs to the test/build owner, not to
     jest roots: either compile before `test:ci`, or stop a unit test depending
     on build output (map the absolute `lib/main/agent-sdk` require the way
     `@nexus-ai/agent-sdk` is already mapped to `src`).

  **(c) Observed, out of scope, reported**

  5. **`tests/main/wpe-tools.test.ts` › `local_wpe_push` › "queues push for
     linked running site (direct handler)" fails on the base commit** — in the
     worktree, in the primary checkout, and under Node 22.16.0 (the `.nvmrc`/CI
     version) as well as the machine's Node 25.9.0. `result.isError` is `true`
     where the test expects `undefined`. So the `test:ci` gate is red on
     `poc/nexintelligence` independently of this packet; it is the one failure
     present in every measurement above.
  6. **`src/**/__tests__` compiles into `lib/`** — `npm run compile` emits 10
     `.js` test files under `lib/intelligence/__tests__` and
     `lib/main/**/__tests__`. Tests-beside-code means test code ships in the
     published package. Proposed: add `**/__tests__/**` to `tsconfig.json`'s
     `exclude`. (`tsconfig.json` was outside this packet's scope.)
  7. **A rare suite-level abort exists in the full run, and it is not caused by
     this change.** Across 8 full runs on the new config and 7 on the baseline,
     one suite once ran 0 of its tests and reported as failed:
     `tests/unit/cli/commands/host.test.ts` (1 of 8, new config) and
     `tests/unit/cli/commands/sync.test.ts` (1 of 7, **baseline** config). Both
     pass in isolation. Config-independent, worth a look by whoever owns the
     worker/open-handle configuration; recorded here so the next agent does not
     mistake it for their own regression.
  8. **`.github/workflows/ci.yml:46`'s comment still says "unit + main
     suites".** It now also runs `src/`. One-word doc fix, workflow file was
     out of scope.

  **CLAUDE.md fact that has drifted (not amended — outside the authorized
  lines):** "System Node: 22.16.0 ... MODULE_VERSION 127" matches `.nvmrc` and
  CI but not this machine, which is on Node 25.9.0 → ABI 141. The two-context
  rule is unchanged; only the literal numbers are machine-specific. Suggest
  phrasing it as "whatever `node -p process.versions.modules` reports" rather
  than a constant.

  **ABI state left behind:** `npm rebuild better-sqlite3` was run, so the
  binary is on the **system-Node ABI (141)**. Local needs `npm run rebuild`
  before it will load the addon again. Note this rebuild affects the shared
  `node_modules` that the `wp-01` and `wp-03` worktrees also resolve through.

- 2026-08-15 · Supersession: the "OWNER ACTIONS OUTSTANDING" items in the
  WP-02 note above are ALL COMPLETE (layer committed on poc/nexintelligence,
  `npm run rebuild` cycle observed, wp-02 reviewed and merged). Kept per the
  append-only rule; superseded by this entry.
- 2026-08-15 · Adjudications (architect): WP-01's `summaryPopulation` choice
  (drift hint compares against the population the report body aggregates,
  not the printed Total-sites figure) — CONFIRMED correct. WP-03's untested
  `DRIFT_QUERY_LIMIT` branch — accepted as disclosed; WP-03b retires the
  concern. WP-05's "test:ci green" criterion — amended to "no NEW red;
  intelligence suites green" given the pre-existing `wpe-tools` failure
  (tracked separately; suspected stale fixture vs access-control v2
  defaults). WP-05 merge audited by diff against first parent: exactly in
  scope, all seven files accounted for.

- 2026-08-15 · **WP-03b calibration findings** (branch `wp-03b`, Opus).
  Proposals only — nothing amended by this packet. The docs held up: the
  worktree recipe in §Isolation (symlink + `npm run compile`) worked first try
  and `npm test` picked the intelligence suites up with no flag, both of which
  were previous packets' findings paying off.

  **(a) The mutation battery lied, in a way the existing guard does not catch**

  1. **A mutation can apply to PROSE and report as SURVIVED.** WP-03 finding 6
     added "verify each mutation actually changed the file (checksum)". That
     guard passed and the result was still wrong: `s/order: 'desc'/order:
     'asc'/` matched the **comment** that quotes the option — the comment
     immediately above the call, which this codebase's house style makes
     near-certain to exist — so the file changed, the code did not, the suite
     passed, and the battery reported the assertion as weak. It is not; an
     anchored re-run caught the mutation immediately. Proposed cp.test
     amendment: *checksum proves a mutation applied; it does not prove it
     applied to code. Anchor each substitution on syntax a comment cannot have
     (leading indentation, trailing comma), or assert a witness string that
     only the mutated CODE line can produce.* This battery now does the latter.
     Cost of not doing it: a real pin gets deleted as "vacuous".
  2. **A removal has no honest mutation pin, and saying so beats faking one.**
     The retired `DRIFT_QUERY_LIMIT` truncation warning cannot be pinned:
     `not.toContain('event cap')` passes identically whether the branch exists
     or not, because the fixture cannot reach 2000 events — the same reason
     WP-03 could not test the branch when it added it. The assertion is kept as
     a cheap guard against someone re-adding a warning that *does* fire, and is
     labelled in the test as exactly that, not as a pin.

  **(b) A cheaper fixture shape for reader-migration tests**

  3. **When the behaviour under test is how a reader RENDERS a ledger event,
     emit the event straight through `core.emitter` — no backfill, no fold, no
     debounce wait.** The pattern's standard fixture (`runGraphBackfill` + two
     700ms sleeps) costs ~1.4s per test and is only necessary when the event's
     *production* is part of what is being tested. The two tests added here run
     in 4ms and 2ms. It also buys **deterministic ledger id order** (ULIDs are
     monotonic within a process), which the newest-first test depends on and
     which a backfill-driven fixture cannot promise — the fold's emission order
     over gamma/alpha/beta is an implementation detail, and the newest event in
     that fixture is out of the report's scope. Proposed as a cp.test note.
  4. **Ordering was pinned behaviourally by clamping the limit, not by counting
     to 2000.** The test wraps `core.ledger.query` to force `limit: 1` while
     passing the caller's `order` through, so the real Ledger SQL decides which
     event survives: `desc` renders the newest change, `asc` renders the oldest
     — verified by running the mutation with the opts-spy assertion disabled,
     so the behavioural half is proven to stand on its own. This is the general
     shape for testing a cap-interaction whose real cap is too large to reach.

  **(c) Found while reviewing the diff, fixed in-packet (own defect)**

  - `fmtDuration` floors at `1m`, which is right for the ages it was written
    for and wrong for a measured interval. A **zero** interval is reachable —
    `stateTwinFold`'s out-of-order guard is a strict `>`, so two values
    observed inside one timestamp granule both fold and drift fires with
    `previousObservedAt === observedAt` — so the first draft printed "1m" for a
    minute nobody observed. Now `<1m`, kept distinct from `—` (unknown).
    Caught by reading the new code against the packet's own "no fabricated
    duration" clause, not by a test; the test came after and now pins it.

  **ABI STATE: this session ran jest — better-sqlite3 is on the system-Node
  build. `npm run rebuild` before loading Local.**

---

**ARCHITECT ADJUDICATIONS — post WP-03b + WP-04 merges (appended by the
architect session; supersedes nothing, closes both packets).**

- **WP-03b ACCEPTED.** Merge 303474c3 audited against its receipt: three
  files, all in scope. The unknown/`<1m`/duration three-way split and the
  zero-interval discovery (strict-`>` fold guard ⇒ interval 0 is reachable)
  are accepted as-designed. The mutation-battery comment-collision finding is
  folded into `patterns/reader-migration.md` (cp.test) — the checksum guard
  is now documented as necessary but not sufficient; witness assertions
  required.
- **WP-04 ACCEPTED.** Merge 474cd7d1 audited: `ipc-handlers.ts` diff is
  exactly the granted lock scope (import + call + provenance spreads + type
  widenings + payload block, logic in `siteFinderTwins.ts`);
  `SidebarSearchPanel.tsx` is type-only widening, ruled in scope under
  "payload gains observed_at per row where the UI can carry it".
- **cp.drift-hint amended** per WP-04: fourth variant
  (value-mismatch-on-a-matched-row) added; composite-predicate caveat added
  (twin-only must be computed against the single predicate's own cache rows,
  never the composed result set).
- **Protocol amended** per WP-04 findings: `ipc-handlers.ts` added to the
  ownership map as integration-lock class; worktree setup now warns that
  artifact-gated suites (`embedding-service.test.ts`) skip silently in fresh
  worktrees — diff SKIPPED counts, not just failures; `.gitignore`
  `node_modules/` → `node_modules` so the protocol's own symlink is ignored
  (the WP-04 `git add -A` trap, reverted in 1db0d2a9, can't recur).
- **WP-04b registered** (Milestone 1 section): port the 523-line
  `filter-apply.test.ts` copy-pinned assertions onto the real handler.
  Legacy-test debt; does not block M1 close.
- **WP-06 is now unblocked** — every other M1 packet is merged. Its
  inheritance pile, consolidated: (1) the `lib/` test-shipping tsconfig
  decision; (2) CLAUDE.md Node/ABI number drift; (3) `(e: any)` scaffold
  casts; (4) the intermittent host/sync TS-redeclaration abort (WP-05 finding
  7, seen again in WP-03b — characterize or ticket, don't chase); (5) WP-03b's
  proposed cp.test fixture note (emit via `core.emitter` for render-only
  tests: ~4ms and deterministic id order vs ~1.4s backfill+fold) — adopt into
  the pattern if the sweep agrees; (6) PR_DESCRIPTION.md drift: packet count
  and reader list predate WP-03b/WP-04 (Site Finder surface + `versionDrift`
  are absent), wpe-tools known-issue is now RESOLVED (BackupGate root cause).

---

- 2026-08-15 · **WP-06 review sweep — findings** (branch `wp-06`, Opus).
  Read-mostly packet; edits confined to casts, comments, `CLAUDE.md`, and
  `PR_DESCRIPTION.md`. Nothing here changes behavior.

  **Verification baseline.** `npm run typecheck` clean. `npx jest src/` →
  **14 suites / 34 tests**, all pass. Full `npm test` → **492 suites, 6,146
  passed, 12 skipped, 6,158 total**, exit 0. Recording the SKIPPED count per
  the protocol amendment: **12**, in this worktree, with the local ONNX model
  files absent. WP-05 measured 488/6139 and did not record its skipped count,
  so the 488→492 / 6139→6158 delta is the WP-03b and WP-04 merges landing
  after that measurement, not a change from this packet.

  1. **The seam lint rule was verified to FIRE, not merely to exist.** `npx
     eslint src/intelligence src/main/intelligence-host` exits 0 — but a
     zero-error run proves nothing about a rule that might not be loaded at
     all. The repo is on eslint 8 with `.eslintrc` cascade (no flat config),
     so the nested `src/intelligence/.eslintrc.json` does apply; confirmed by
     a throwaway probe file importing `electron` and `../main/index`, which
     produced exactly two `no-restricted-imports` errors with the ADR-16
     messages. **Anyone re-verifying the seam should re-run that probe rather
     than trusting a clean exit code** — the day this repo moves to eslint's
     flat config, the nested `.eslintrc.json` becomes dead and the seam
     silently stops being enforced while lint still reports clean.

  2. **Scaffold-ism hunt: the intelligence layer itself is clean; the
     regressions were in the readers it touched.** Zero `any` of any shape in
     non-test code under `src/intelligence/` or
     `src/main/intelligence-host/`. But three reader files had `(e) =>
     e.structure` on `main` and `(e: any) => e.structure` on this branch —
     `find-sites-with-plugin.ts`, `find-sites-with-theme.ts`,
     `find-outdated-sites.ts`. A widening, introduced by the migrations, of a
     parameter TypeScript was already inferring correctly from
     `IndexRegistry.listAll()`. Reverted to `(e)`; typecheck stays clean,
     which is itself the proof the annotation was never load-bearing.
     *Method note for the next sweep: grep the branch's ADDED lines
     (`git diff main...HEAD | grep '^+'`), not the working tree. A tree-wide
     grep buries three real regressions in ~40 pre-existing hits.*

  3. **`(services as any).graphService` is NOT a scaffold-ism and was left
     alone** — six occurrences, all pre-existing on `main`. It is also
     already redundant: `graphService?: any` is a declared member of the MCP
     `NexusServices` (`src/main/mcp/types.ts:120`), so the cast is an `any`
     applied to an `any`. Typing it properly means giving `GraphService` a
     real type on the interface, which changes a shared type used far beyond
     these readers — out of scope for a review packet, and registered here
     rather than done quietly.

  4. **Header comments: all production files had them; ten test files did
     not.** Every file under `src/intelligence/` and
     `src/main/intelligence-host/` that ships behavior already carried a
     header. Added headers to the ten intelligence-layer test files that
     lacked one (4 core, 3 host, 3 fleet-module), each stating what the suite
     *pins* rather than what it does. One draft header was wrong and rewritten
     before commit: it claimed `overnightMigrations.test.ts` pinned the
     "outdated counts are `null`, never `0`" rule, which is a real repo
     invariant but not what that test asserts — it exercises ledger gap-fill.
     Worth repeating because it is the failure this project keeps producing:
     **a plausible claim about a test, written without reading its
     assertions, survives review and then propagates.**

  5. **Track-1 files are new on this branch and have no headers**
     (`src/main/fleet/*` ×5, `src/main/mcp/modules/fleet-links/*` ×4,
     `src/main/safety/BackupGate.ts`). Deliberately NOT touched — outside the
     intelligence layer, different owner, and a review packet should not
     sprawl into an adjacent body of work. Registered, not fixed.

  6. **RULING on the `lib/` test-shipping tsconfig question (WP-05 finding 6):
     exclude them.** Add `"src/**/__tests__/**"` to `tsconfig.json`'s
     `exclude`. **The trade this was held open for is largely illusory**, and
     that is the finding:
     - **Cost today:** 56 files / ~158 KB of compiled test code (14 `.js`, 14
       `.d.ts`, plus maps) ship in the published package, because
       `package.json`'s `files[]` lists `lib` wholesale.
     - **The supposed loss — `tsc --noEmit` coverage of tests — is already
       partial and asymmetric.** `tsconfig.json` excludes `tests/`, so the
       5,000+ legacy tests have NEVER been under `tsc --noEmit`. The only
       tests it covers are the 14 `src/**/__tests__` files, and only by
       accident of where the intelligence layer put them.
     - **ts-jest type-checks every test file it runs**, diagnostics on,
       against `tsconfig.test.json` (which includes both `src/**` and
       `tests/**`). Measured both directions rather than assumed: an injected
       `const x: number = "s"` in `ulid.test.ts` is **missed** by `tsc -p`
       with the exclude applied and **caught** by ts-jest (suite fails,
       0 tests run). Finding 7 below is the same mechanism observed in the
       wild.
     - **Residual gap, stated honestly:** ts-jest only checks a file it
       actually runs, so a test excluded by a `-t`/path filter goes
       unchecked; `tsc` checked it unconditionally. `npm run test:ci` runs
       them all, so this costs nothing in the gate that matters.
     - Alternative considered and rejected: a fourth tsconfig
       (`tsconfig.build.json` for `compile`, `tsconfig.json` for
       `typecheck`). It preserves both properties, but buys coverage ts-jest
       already provides at the price of another config file to keep in sync
       in a repo that has three.
     - **Not applied in this packet** — a build-config change is outside a
       review sweep's edit scope and wants its own commit.

  7. **The "intermittent" host/sync abort is NOT intermittent — it has a
     deterministic repro, and it silently loses 10 tests.** WP-05 finding 7
     recorded it as rare (1 in 8 runs), config-independent, passing in
     isolation. Root cause found:

         npx jest tests/unit/cli/commands/host.test.ts \
                  tests/unit/cli/commands/sync.test.ts --runInBand

     fails **every time** with four `TS2451 Cannot redeclare block-scoped
     variable` errors. **Neither file has a single top-level `import` or
     `export`**, so TypeScript treats both as global *scripts*, not modules —
     and both declare `ExitError`, `out`, `err` and `exitCodes` at top level,
     into the same global scope. ts-jest type-checks with a language service
     **per worker process**, so the collision materializes only when jest's
     scheduler happens to place both files in the same worker. That is the
     entire "intermittence": the bug is deterministic, its *trigger* is
     worker assignment. It also explains every other reported symptom — 0
     tests run (a compile error, not a test failure), passes in isolation (no
     second file), config-independent (nothing to do with jest config).
     Severity is higher than "flaky suite" suggests: in the repro, the run
     reports 20 passing tests where 30 exist — `host.test.ts`'s 10 tests
     vanish while the run still looks like it covered them.
     **Fix (verified, then reverted — out of this packet's edit scope):**
     append `export {};` to each of the two files. With it, the same command
     gives 2 passed / 30 tests. One line per file.
     **Blast radius:** 14 test files repo-wide are global scripts (scan in the
     packet transcript); today exactly one pair collides, so this is the only
     live instance — but the other 12 are one duplicated top-level name away
     from the same failure, and it will present as "a flaky suite" again.
     Recommend the two-line fix plus, optionally, a lint rule requiring test
     files to be modules.

  8. **CONCUR with WP-03b's cp.test fixture proposal, with one added
     constraint. Proposed pattern text is in item 9.** Measured this session
     from `npx jest src/ --verbose`, which settles it:
     - `runGraphBackfill` + a 700 ms debounced-fold wait: **709–745 ms** per
       seeding; tests that seed twice cost **1,413–1,471 ms**.
     - Tests that emit through `core.emitter` directly: **6–29 ms**
       (`detect_drift`'s v1-duration and newest-first-cap tests are the live
       examples).
     - **A third technique already in the tree beats both, and the proposal
       should name it:** `siteFinderTwins.test.ts` seeds ONCE in `beforeAll`
       and then runs **12 assertions at 0–1 ms each**. The real cost driver
       is not backfill-vs-emitter, it is *seeding per test*.
     - **The constraint:** a test that emits directly must derive its entity
       id with `provisionalEnvironmentId()` — the same function the producers
       use — never a literal. Hand-written ids pass against a join production
       never mints. (`overnightMigrations.test.ts` sidesteps this by looking
       the id back out of a backfill-seeded twin; that works but re-imports
       the 700 ms cost it was trying to avoid.)
     - **And the boundary:** direct emission does not exercise
       `runGraphBackfill`. That is acceptable *because* `graphBackfill.test.ts`
       owns that path — but a migration whose suite goes all-emitter must not
       also be the only coverage of how twins get populated.

  9. **Proposed text for `patterns/reader-migration.md` § cp.test — NOT
     applied (pattern files are owner-approval).** Insert after the existing
     "Follow `findSitesWithPlugin.test.ts` …" paragraph:

     > **Pick the cheapest fixture that still proves what you're asserting.**
     > Seeding twins via `runGraphBackfill` + a ~700 ms debounced-fold wait
     > costs ~710 ms *per seeding* and is the right shape when the test is
     > about the backfill→twin path itself. It is the wrong shape for the
     > render-only assertions that make up most of a migration's suite, and
     > it compounds: a test that seeds twice runs ~1.4 s.
     >
     > Two cheaper shapes, both already in the tree:
     > - **Seed once, assert many** — one `beforeAll` doing the backfill, then
     >   render-only tests against the shared core.
     >   `siteFinderTwins.test.ts` runs 12 assertions at 0–1 ms each this way.
     >   Prefer this when the assertions share a fixture.
     > - **Emit directly** — `core.emitter.emit({...})` then
     >   `core.scheduleFolds()`, ~6–29 ms, with explicit control over event
     >   order and `observed_at`. Prefer this when a test needs a *specific*
     >   ledger shape (an out-of-order pair, a v1-schema event, a cap
     >   boundary) that a backfill can't express.
     >
     > When you emit directly, derive the entity id with
     > `provisionalEnvironmentId(localSiteId)` — the same function the
     > producers call. A literal `ent_env_…` id makes the test assert a join
     > production never mints, and it will pass.
     >
     > Direct emission does not exercise `runGraphBackfill`. That is fine —
     > `graphBackfill.test.ts` owns that path — but don't let an all-emitter
     > suite become the only place a migration's twin population is covered.

  10. **CLAUDE.md ABI drift fixed as a two-valued fact, not a new constant.**
      The old text ("System Node: 22.16.0 … MODULE_VERSION 127") was not
      simply wrong: it is exactly what `.nvmrc` pins and what every CI job
      reads. It is wrong only at a developer's terminal — measured here,
      Node **25.9.0 → ABI 141**. Rewriting it to a fresh constant would have
      re-created the same trap for the next Node upgrade, so the section now
      names **both** values, says which is which, and gives the three
      commands that measure them. Electron 42.2.0 → ABI 146 was verified
      against `Local.app`'s own `Electron Framework.framework` plist and the
      patched `node-abi` registry, and is unchanged.

  11. **PR_DESCRIPTION.md rewritten against measured branch state.** What was
      stale: "5 fleet tools migrated" (**6**, and its own prose already listed
      six — the count and the list disagreed inside one sentence); "Six work
      packets" (**seven**, counting WP-03b and this one); "10 intelligence
      suites (~15 tests)" (**14 suites / 34 tests**); "Two integration-point
      diffs" (**four** — `ipc-handlers.ts` and `SidebarSearchPanel.tsx` joined
      after WP-04); "~5k facts" backfilled (**7,012**). Absent entirely: the
      Site Finder surface, `versionDrift`, and detect_drift's divergence
      duration and newest-first query. The wpe-tools RESOLVED note was
      verified line-by-line against commit `c9fbe423` and is accurate — the
      only thing it omitted was that the fix carries a 15 s timeout for the
      gate's real 2 s poll, now stated.
      Two things added that were not on the inherited list:
      - **A scope note at the top.** The branch is 113 files, and the
        intelligence layer is 71 of them; Track 1 (fleet identity, BackupGate,
        Fleet tab — 44 files, ~6,100 insertions) landed before the
        intelligence baseline and the description did not acknowledge it at
        all. A reviewer opening this PR would have seen half the diff
        undescribed.
      - **The live ledger table** from this machine (8,614 events / 6,308
        twin facts), because it is the only evidence in the document that the
        layer runs outside tests — and because it surfaces the honest weak
        spot in finding 12.

  12. **The `wp-webhook` producer has fired exactly ONCE in production.**
      Live ledger, 2026-08-15: `graph-backfill` 7,012 events, `graph-sync*`
      1,273, `fold:state-twin` 328 drift events — and `wp-webhook` **1**. The
      other two producers are demonstrably exercised; the webhook tap is
      unit-tested (`wiring.test.ts`) and effectively unproven in the field.
      Disclosed in the PR description rather than left for a reviewer to
      discover. Not a defect and not fixed here — but it is the piece of this
      branch most likely to have a problem nobody has met yet.
      *(Corollary worth keeping: the 1,273 `graph-sync*` events are also the
      best evidence the change gate works. A producer without dedup would
      have written a multiple of that on every sync cycle.)*

  **ABI STATE: this session ran jest — better-sqlite3 was found on the
  Electron build (146) and was rebuilt to the system-Node ABI (141) via
  `npm rebuild better-sqlite3`. `npm run rebuild` is required before loading
  Local again.** Note this touches the shared `node_modules` that every
  worktree symlinks through.

---

- 2026-08-15 · **WP-04b — SF filter-apply assertions ported onto the real
  handler** (branch `wp-04b`, Opus). Tests only: one file added under
  `tests/`, one deleted. `src/main/ipc-handlers.ts` was READ, and was
  temporarily mutated during the mutation battery and restored — the commit
  contains no `src/` change.

  **Verification.** Worktree baseline BEFORE any change: **492 suites, 6,146
  passed, 12 skipped, 6,158 total**, exit 0 (identical to WP-06's recorded
  baseline). AFTER: **492 suites, 6,158 passed, 12 skipped, 6,170 total**,
  exit 0. Suites unchanged (one deleted, one added); tests **+12**, which is
  exactly 40 new minus the copy's 28; **skipped unchanged at 12**, so the
  delta is not an artifact-gated suite appearing or vanishing. `npm run
  typecheck` clean — but note it proves nothing about the new file:
  `tsconfig.json` excludes `tests`, so the type check that covers it is
  ts-jest's, under `tsconfig.test.json`, at suite run time. Touched-area
  legacy suites green together: `site-finder-soft-delete`, `parse-accuracy`,
  `siteFinderTwins`, plus the new file — 4 suites / 80 tests. SF-01/05/06 eval
  YAML untouched (they are LLM-driven cases under `tests/evals/cases/`, not
  jest, and nothing in them referenced the deleted file).

  **Location.** `tests/unit/ipc/site-finder-filters.test.ts`, beside
  `site-finder-soft-delete.test.ts` — the other suite that drives the real
  `SITE_FINDER_APPLY` through `registerIpcHandlers`. `grep -rl
  SITE_FINDER_APPLY tests/` now returns both real-handler suites from one
  directory. `tests/unit/site-finder/` keeps `parse-accuracy.test.ts`, which
  is about AI filter *parsing*, not filter *application*.

  **Classification of the copy's 28 cases** (accept bar: every semantic pinned
  or explicitly waived):
  - **(a) portable — 27**, ported one-to-one.
  - **(b) unreachable — 1**: the empty-filter guard case asserted a
    *re-declared* `hasFilter()` predicate directly. The real one is a
    closure-local `const` inside the handler and is not exported, so the unit
    shape cannot be reached; ported behaviourally as 4 cases over the same
    four inputs, asserted through the handler's result.
  - **(b) partially unreachable as written — 1** (also counted in (a)): the
    `maxUserCount` case read `sites.user_count` for every source. The real
    handler reads that column on the LOCAL chain only; WPE and external count
    rows in the `users` table. The assertion's intent is ported by giving
    wpe-stg two `users` rows; the copy's data source is not reachable for that
    chain.
  - **(c) already covered — 1** (ported anyway): `pluginVersion` membership on
    local+WPE is also pinned by `siteFinderTwins.test.ts`. That suite exists to
    pin the intelligence enrichment and its fixture is free to change for
    reasons unrelated to filter semantics, so filter membership should not
    depend on it alone.
  - **9 NEW cases** (marked `[new]` in the file), all pinning branches the
    handler already has and the copy left unpinned: three boundary values
    (`>=` vs `>` on maxPostCount, maxUserCount, wpVersionOlderThan), the NULL
    `last_post_at` asymmetry between stale/recent, the missing-settings-key
    branch, the settings_json-absent branch, the `plugins`-vs-`pluginVersion`
    `is_active` asymmetry, and the per-source result bucket.
  - Result: **40 tests** = 31 ported (27 + the guard's 4) + 9 new.

  **Every ported assertion runs against the chain the original targeted, and
  most against all three.** The handler has three near-duplicate filter chains
  (local / WPE / external) and the copy had one, so chain divergence was
  structurally invisible to it. Two live divergences fell out of that
  comparison. **Both are code defects. Neither is fixed here (the packet
  forbids editing the handler) and neither is given a test, because a test
  asserting today's output would convert a defect into a regression guard:**

  1. **`phpVersions` is applied on the LOCAL chain only.** Neither the WPE loop
     nor the external loop has a `phpVersions` branch at all. Measured live
     against the new fixture (throwaway probe, not committed): a
     `{phpVersions:['8.2.29']}` query filtered the local sites correctly (3 of
     7 matched) and returned **5 of 5 WPE installs and 3 of 3 external hosts**,
     none of which is on 8.2.29. The Site Finder UI offers this filter, so
     "show me sites on PHP X" silently reports every remote site as a match.
     Note `phpEolOnly` — the same data, a different predicate — IS applied on
     all three chains, so this is an omission, not a policy.
  2. **`wpeEnvironment` and `minAdminCount` pass the `hasFilter` guard but no
     chain implements them.** Measured live: either one alone returns **all 15
     fixture sites**. That is precisely the outcome `hasFilter` exists to
     prevent ("an empty filter means the AI couldn't map the query — returning
     everything is misleading"), reached through a filter the schema accepts
     and the guard blesses.

  A third asymmetry is deliberate and documented in the handler, so it is
  pinned rather than reported: user counts come from `sites.user_count` on the
  local chain and from `COUNT(*) FROM users` on the remote chains.

  **Mutation battery — 8/8 CAUGHT, each with its witness.** Committed first
  (the pattern's rule), each substitution anchored to a code line with enough
  surrounding syntax that a comment quoting it cannot match, sha256 verified
  changed before running, and the *specific* expected test asserted to be among
  the failures — a non-zero exit alone was not accepted as a kill. Three
  substitutions were occurrence-indexed to reach a specific chain, since the
  three chains contain byte-identical lines:

  | mutation | chain | witness |
  |---|---|---|
  | `recentPostDays` `<` → `>` | local | 5 failed, incl. "within 7 days" |
  | `recentPostDays` `<` → `>` | external | 3 failed, incl. "within 7 days" |
  | `maxPostCount` `>=` → `>` | wpe | "exactly on the cap, on all three chains" |
  | `source !== 'external'` → `'wpe'` | external | "source=external returns only external hosts" |
  | `blog_public === '0'` → `!==` | external (3rd occurrence) | "sites blocking search engines" |
  | `pluginVersion` drops `AND is_active=1` | wpe (2nd occurrence) | "requires the plugin to be ACTIVE" |
  | `if (!hasFilter)` → `if (false)` | handler entry | "an empty filter returns no results" |
  | `minPostCount` `<` → `>` | local | "recently active large sites" |

  The two per-chain kills (local and external `recentPostDays`, and the
  occurrence-indexed wpe/external ones) are the evidence that "exercises all
  three chains" is a real property of the suite and not just a comment.

  **Process note worth keeping.** The first full-suite run was started in the
  background and overlapped the mutation battery, which was rewriting
  `ipc-handlers.ts` underneath it. That run was killed and discarded, not
  reported: a full-suite number measured while the source tree is being mutated
  is not a baseline comparison, it is noise that happens to be shaped like one.
  Never let a mutation battery and a verification run share a worktree in time.

  **ABI STATE: this session ran jest — better-sqlite3 is on the system-Node
  build (this machine's shell Node 25.9.0 → ABI 141; `.nvmrc`/CI is 22.16.0 →
  ABI 127). `npm run rebuild` is required before loading Local again.** The
  shared `node_modules` every worktree symlinks through is affected.

---

**ARCHITECT ADJUDICATION — WP-04b (appended by the architect session).**

- **WP-04b ACCEPTED.** Merge ea2c092b audited: `git diff --stat` against
  first parent shows tests + docs only; `src/` diff confirmed empty on the
  owner's checkout. Classification (27 ported / 2 unreachable-as-written,
  both ported behaviourally / 1 already-covered, ported anyway) is complete —
  all 28 accounted for. The per-chain occurrence-indexed mutation kills are
  accepted as the standard for testing duplicated code paths.
- **The two escalated divergences are adjudicated as REAL DEFECTS, not
  behavior to pin.** The agent's refusal to write tests asserting today's
  broken output is endorsed — a test would have promoted each defect to a
  regression guard. **WP-04c registered** (Milestone 1 section) to fix both,
  with the wpeEnvironment/minAdminCount implement-vs-remove question raised
  to an owner ruling as its blocking first step.
- **Process note endorsed:** discarding the full-suite run that overlapped
  the mutation battery's transient `ipc-handlers.ts` rewrite was correct —
  a green (or red) run against a mutated tree is not evidence. Future
  batteries: run the battery strictly between full-suite runs, never
  concurrently; this is now part of the mutation guidance's spirit even
  though the pattern text doesn't spell it out.
- 2026-08-15 · **WP-07 executed** (entity service v0 wired as a `site_links`
  consumer; serialized core-lock packet). All six steps landed; Track-1 files
  (`src/main/fleet/*`, `fleet-links/*`) untouched — no hook inside them was
  needed, so no escalation. Findings and judgment calls:

  1. **Where each mapped assertion lives.** A `site_links` row lands as a
     `has_environment` link from the install's logical Site entity to the
     local env entity, carrying the mapped `established_by`/confidence
     (user→`user_link` 1.0, hostConnection→`host_connection` 0.95,
     inferred→`name_heuristic` 0.5) with `verified_at` as `created_at`. The
     identities themselves (row id, install id, install name, wpe_site_id)
     land as aliases at `derivation`/1.0 — the DoD's "rows visible as aliases
     with correct established_by" is satisfied across aliases + links
     together, because an alias is (namespace, value)→entity and cannot
     itself express "X is the sandbox of Y".
  2. **The Site container is keyed by `wpe.site_id` when CAPI provides one**
     (`ensure('site','wpe.site_id', …)`), else the row's own provisional
     logical-site id. Keying it off the local site instead would let two
     installs of one wpe_site_id fight over the `wpe.site_id` alias (UNIQUE
     namespace+value repoints on conflict). Consequence, disclosed: the
     per-row provisional site ids already stamped on WPE events remain
     placeholders — v0 does not merge them into the wpe_site_id-keyed
     entity. That unification is the note's post-WP-07 item.
  3. **user_link precedence is now enforced ledger-side too**, not just
     ordered: `addAlias`/`link` upserts carry a `WHERE existing != 'user_link'
     OR incoming = 'user_link'` guard, mirroring SiteLinkResolver's
     short-circuit. Nothing in the current mirror flow can trigger it (Track-1
     protects upstream), but the entity tables are now safe against a future
     careless writer. Pinned in `entityService.test.ts`.
  4. **Producers adopt `ensure()` through fallback helpers**
     (`environmentEntityId`/`siteEntityId` in `provisionalEntity.ts`): ensure
     when the service is up, pure derivation when it is not (or throws) — ids
     identical by construction, asserted in `siteLinkMirror.test.ts`, and the
     entire pre-existing suite passing unchanged is the adoption proof. The
     fleet READERS deliberately keep the pure helper: a read surface must not
     create entities as a side effect.
  5. **Re-mirror cadence judgment call:** subscribing to individual link
     changes needs a hook inside Track-1's `SiteLinkStore.put` (frozen), so
     the mirror re-runs per sweep (wired after `runStartupReconciliation` in
     `index.ts` — the reconciliation note's sanctioned alternative). A link
     made via `nexus_link_site` mid-session mirrors at next startup; the
     proposals tool reads Track-1's report directly, so its output is never
     stale with respect to what is unresolved.
  6. **Proposals surface judgment call:** `nexus_fleet_list`/`link-site.ts`
     are frozen, so proposals surface as a NEW read-only Tier-1 tool
     (`nexus_pairing_proposals`) whose every proposal spells out the exact
     `nexus_link_site` acceptance call — information beside the flow, not a
     parallel queue; executing it writes nothing (pinned).
  7. **Two guard tests updated for deliberate additions:** the fleet-module
     count pin (7→8), and `external-visibility.test.ts` gained a
     `wpe-by-nature:` inline-marker exemption — the proposals tool's install
     mapping keys on `remote_install_id` (WPE by definition, per CLAUDE.md
     source semantics), and the marker forces the justification onto the
     query line instead of an allowlist that drifts. The scan is otherwise
     unweakened.
  8. **Pattern note (add-a-producer):** the mirror is not an event producer —
     it writes entity tables, no envelopes, so cp.envelope/cp.dedup/cp.fold
     don't apply; cp.nonfatal and cp.test do and were followed. If a future
     packet wants link changes as ledger *events* (identity.linked topic),
     that is an ab.new-topic-namespace escalation, deliberately not done here.
  9. Verification: typecheck clean; full suite **494 suites / 6,158 passed /
     12 skipped** (baseline before changes: 6,145 passed / 12 skipped — the
     delta is exactly the new pins); seam-rule probe re-fired post-change;
     lint clean on all touched trees.

  **ABI STATE: this session ran jest — better-sqlite3 is on the system-Node
  ABI. `npm run rebuild` is required before loading Local again.** (Shared
  `node_modules`, symlinked by every worktree.)

- 2026-08-15 · **WP-08 lock announcement.** WP-08 (policy & runbook repo v0 —
  translate permissions) starting now on worktree `wp-08`. Holding the core
  lock (`src/intelligence/` + `src/main/intelligence-host/`) until this note
  is superseded by the packet's close-out. No `wpeOperationPermissions`
  semantics will change; M4-04..12 is the regression harness.

- 2026-08-15 · **WP-08 close-out** (policy & runbook repo v0 — translate
  permissions). Supersedes the lock announcement above; core lock released on
  merge.

  **What shipped.** (1) `src/intelligence/law/` — `loader.ts` (markdown +
  YAML frontmatter → `LawDocument`s; zod-validated, js-yaml-parsed, never
  throws: malformed documents are rejected with recorded errors and siblings
  still load), `registry.ts` (`ConstraintRegistry` — small read-only lookup
  surface for WP-11: `byId`, `constraints(filter)`, `documents()`),
  `permissionsTranslation.ts` (`PermissionsSnapshot` → derived constraints;
  `comparePermissionMirror` divergence check). (2) `law/policy/ops-default.md`
  at the repo root — verbatim copy of the reviewed anchor-slice spec, now the
  first citizen of the policy & runbook repo (ADR-5). (3)
  `src/main/intelligence-host/permissionsMirror.ts` — builds the snapshot from
  live settings and stands up the registry; wired into `bootstrap.ts` as
  optional `core.law` (no `src/main/index.ts` edit needed — the integration
  lock was not touched).

  **Translation, not reimplementation — how that was made structural.** Every
  matrix cell in the snapshot is computed by calling `isOperationAllowed`
  itself against `getEffectiveSettings` — the exact functions enforcement
  uses — so resolution order, defaults, environment normalisation and both
  legacy migrations are exercised, never restated. The derived constraints
  overlay the authored ops-default ids (`c.write-default-deny`,
  `c.production-writes-off`, `c.delete-promote-opt-in`): the human-reviewed
  rule text is KEPT, the overlay attaches `derivedFrom:
  'wpeOperationPermissions'` and the live values as `parameters`. A fourth,
  registry-only `c.permissions-mirror` carries the complete resolved matrix +
  exceptions. The ONE deliberate duplication is the two-line `?.length`
  exception-list precedence (which list is live), pinned by a test that first
  proves the gate honours the legacy list in that exact state
  (empty `remoteSiteExceptions` + populated `wpeSiteExceptions`) and then
  demands the mirror list it too.

  **The tripwire.** `core.law.verifyMirror()` rebuilds a fresh snapshot and
  compares; each divergence logs a warning naming the constraint id AND both
  values (registry vs live). Clean-and-silent while settings are unchanged
  (pinned); mutation-tested (dropping the live value from the message fails
  the test). v0 divergence is possible only if settings change after build —
  the registry does not re-mirror on settings updates, deliberately: that
  wiring wants the `onSettingsUpdated` block in index.ts (the integration
  lock) and is left for WP-11, whose assembler should call `verifyMirror()`
  at assembly time anyway (fail-closed per ADR-7 is that packet's decision).

  **M4 regression evidence — disclosed honestly.** The M4 eval cases are
  human-in-the-loop LLM evals (`tests/evals/runner/run-eval.ts` prints
  prompts for a reviewer to paste into Claude; promptfoo mode needs live
  provider keys + real WPE accounts), so they were NOT executed in this
  autonomous session. What was verified instead: (a) `git diff` on the
  enforcement surface (`src/main/mcp`, `src/main/graphql`,
  `src/main/transport`, `src/main/sentinel`, `src/common`) is EMPTY —
  `operation-permissions.ts` and every caller are byte-identical; (b) the six
  deterministic suites that pin `isOperationAllowed` semantics all green:
  operation-permissions, gate-scoping, remote-permissions-migration,
  surface-equivalence, settings-permissions, safety — 156 tests; (c) full
  suite before vs after (below). Since the registry is write-only with
  respect to enforcement (nothing reads it in an allow/deny), M4-04..12
  behaviors are unchanged by construction; a human run of the eval family
  remains available as belt-and-braces.

  **Findings.**
  1. **js-yaml is a devDependency imported by production code** — pre-existing
     (`AgentRegistry.ts` since the agent-manifest work); `law/loader.ts` is
     now a second site. The build is plain tsc (no bundler), so the published
     package resolves js-yaml from whatever node_modules ships. Worth an owner
     decision: promote js-yaml to `dependencies` (one-line) or vendor a
     frontmatter parser. Not done here — dependency changes need owner
     approval per protocol.
  2. **`law` added to package.json `files[]`** so the published addon carries
     its law directory (it was absent → the runtime default path would 404 in
     a packaged install). Markdown only; does not re-list `wp-plugins`, so the
     ACF prepublish hazard is untouched. A missing law dir degrades
     gracefully regardless: registry still builds with the derived mirror
     (pinned by test).
  3. **Runbook kind is accepted but minimally modelled** — `kind: runbook`
     loads with raw frontmatter preserved and constraints optional, so WP-09's
     authored runbooks will load without loader changes; the ADR-17 contract
     fields (checkpoints, aborts) are NOT yet validated. WP-09 should extend
     `frontmatterSchema` rather than fork it.
  4. **Mutation testing:** 3 production-line mutations (negate the
     `isOperationAllowed` call; flip exception precedence to `??`; drop the
     live value from the divergence warning) — all 3 caught by the intended
     test, each failing exactly one pin.
  5. **Escalation triggers:** none fired. No new event topic, envelope field,
     or storage marker; no `wpeOperationPermissions` semantics touched; no
     legacy-parity question arises (the registry is additive and read by
     nothing yet).

  **Verification.** Typecheck clean; lint clean on all touched files; seam
  probe re-fired (electron import into `law/types.ts` → 1
  `no-restricted-imports` error, then removed); intelligence set 21 suites /
  80 tests green; worktree baseline before changes **494 suites / 6,170
  passed / 12 skipped / 6,182 total**, after: see merge report (expected
  delta: exactly the 5 new suites / 34 new tests).

  **ABI STATE: this session ran jest — better-sqlite3 is on the system-Node
  ABI. `npm run rebuild` is required before loading Local again.**

---

**ARCHITECT ADJUDICATION — WP-08 (appended by the architect session).**

- **WP-08 ACCEPTED.** Merge c9be9b52 audited on the owner's checkout:
  enforcement surface (`src/main/mcp`, `src/main/graphql`, `src/common`)
  diff is EMPTY; the `package.json` touch is exactly one `files[]` line
  (`"law"`) — packaging necessity, not a dependency or version change;
  the integration lock was never taken (core.law wired in bootstrap, no
  index.ts edit). The translate-don't-reimplement approach — computing every
  matrix cell by calling `isOperationAllowed` itself — is endorsed as the
  strongest possible form of "settings stay authoritative."
- **M4 disclosure adjudicated:** the by-construction argument (registry is
  write-only w.r.t. enforcement; enforcement diff empty; 156 deterministic
  pins green) is accepted for merge. A human M4 eval run is scheduled as a
  belt-and-braces item BEFORE the M2 PR is opened, not per-packet.
- **js-yaml finding — owner decision pending:** production code imports a
  devDependency (pre-existing via AgentRegistry.ts; the law loader is now a
  second site). Architect recommendation: promote to `dependencies` — this
  is a latent packaging defect independent of WP-08, not a new dependency.
  Awaiting owner approval; one-line change when granted.
- Re-mirroring on settings change deferred to WP-11 is endorsed —
  `verifyMirror()` at assembly time is the better invariant anyway
  (fail-closed at the moment of use, per ADR-7's spirit).
---

- 2026-08-15 · **WP-04c — LOCK ANNOUNCEMENT + Phase 1 scout report (BLOCKING:
  awaiting owner ruling).** Branch `wp-04c`, worktree `.worktrees/wp-04c`.
  **Holding the integration lock** for `src/main/ipc-handlers.ts` (the
  `SITE_FINDER_APPLY` filter chains) from this note until the packet's
  close-out. Nothing else should edit that file meanwhile. No `src/` change is
  committed yet — this note is the Phase 1 stop.

  **Worktree baseline BEFORE any change: 494 suites, 6,170 passed, 12 skipped,
  6,182 total, exit 0.** (WP-07's recorded 6,158 plus WP-04b's 40-test suite
  landing between them; skipped unchanged at 12, so no artifact-gated suite
  moved.)

  ### Finding 1 — the surfaces the packet's "remove from hasFilter + the UI"
  option refers to: **the UI surface does not exist.**

  `wpeEnvironment` and `minAdminCount` appear in exactly three places in `src/`:
  `src/common/schemas.ts:466-467` (the zod `SiteFinderFiltersSchema` accepts
  them), and `ipc-handlers.ts:3598-3599` (`hasFilter` blesses them). That is
  all. Measured by grep across `src/`:

  - **Zero** references in any renderer component — `SiteFinderPanel.tsx`,
    `SidebarSearchPanel.tsx`, `AISiteFinderPanel.tsx` all have none. There is
    no control, chip, or manual filter for either.
  - **Zero** references in `src/main/ai/site-finder-prompt.ts`, the live system
    prompt that tells the parsing LLM which filters exist. Neither field is
    documented to the model, so the only way either reaches the handler is a
    hallucinated key that the schema then happens to accept — or a direct IPC
    caller.
  - Three schema-shape tests in `tests/unit/site-finder/parse-accuracy.test.ts`
    (accepts `wpeEnvironment`, rejects an invalid one, accepts `minAdminCount`).

  So the removal option costs: schema lines + `hasFilter` lines + those three
  tests. It is cheaper than the packet assumed. Correspondingly, the
  *implement* option's user-visible payoff requires also adding each field to
  the prompt — otherwise the filter stays unreachable in practice whichever way
  the ruling goes. **Flagging that as part of the ruling: "implement" should be
  read as "implement in the chains AND document in the prompt," or it is a
  no-op with extra code.**

  ### Finding 2 — `wpeEnvironment`: the data exists, and is complete on both
  remote chains.

  `sites.environment` is a real column (`GraphService.ts:276`), backfilled by
  migration (`:1514-1516`) and written on every upsert. `graphService.listSites()`
  already returns it (`:554`), so the WPE and external loops have it **in hand
  with no extra query** — same shape as the `php_version` that `phpEolOnly`
  reads.

  Live coverage, measured on the developer's `graph.db` 2026-08-15:

  | source | active rows | rows carrying `environment` |
  |---|---|---|
  | wpe | 342 | **342** — 233 production, 66 staging, 43 development |
  | local | 40 | **40** — all `development` |
  | external | 0 in this DB | populated by construction: `nexusHostAdd` writes it at registration (defaults `production`), and it is the write gate documented in CLAUDE.md |

  The LOCAL chain is the asymmetric one: it iterates Local's OWN store
  (`siteData.getSites()`), not graph rows, so environment for a local site is
  reachable only through a graph lookup **and only for indexed sites** — live,
  40 graph rows against 113 sites in Local's store. Local coverage is partial
  by nature, and every local site's answer is the same constant anyway.

  **RECOMMENDATION — implement, on the WPE and external chains; exclude on
  local.** Reasons:
  - It is a one-line predicate on data already loaded, mirroring exactly how
    `source` is handled per-chain.
  - Including **external** rather than WPE-only is the reading this codebase's
    own doctrine demands: CLAUDE.md states repeatedly that "fleet means local +
    WPE + SSH" and that `source='wpe'` alone is the bug class this project keeps
    removing. An external host's environment label is first-class here — it is a
    *write gate*, set by the user at `host add`. A user asking for "staging" who
    silently misses their staging SSH host is the same defect in a new place.
  - Excluding **local** because a `wpeEnvironment` filter against a Local site is
    a category error (and its data is both constant and partially missing). This
    is the shape `{source:'wpe'}` already has on the local chain.
  - Cost of this reading: the field NAME then under-describes it (it would
    accept external hosts too). Renaming is a schema change with its own
    migration question and is NOT proposed here.
  - **Conservative alternative if the owner prefers the name taken literally:**
    WPE chain only, external and local both exclude. Say the word and it is a
    one-line difference.

  ### Finding 3 — `minAdminCount`: there IS a cross-source admin count, and the
  query is already canonical in this repo.

  Two candidate sources were checked; only one works across sources.

  - **`users.roles`** (JSON array per user row) — **WPE-only in practice.**
    Measured live: all **2,175** user rows belong to `source='wpe'` sites;
    **zero** rows for local or external. `EventProcessor.processUserEvent`
    (the MU-plugin webhook path) could populate local, but has not. This source
    cannot serve two of the three chains.
  - **`sites.user_count_by_role`** (`GraphService.ts:273`) — JSON TEXT,
    `{"administrator":N,"editor":N,…}` — **written by all three sources**:
    local via `src/main/content/lifecycle-hooks.ts:335-408`, WPE via
    `WpeRefreshScheduler.ts:349` and `mcp/modules/wpe/deep-refresh.ts:337`,
    external via `startup/writeExternalHostData.ts:126-157`.

  And the exact predicate is already the documented house answer: MCP
  `server-instructions.ts:200` answers *"Which sites have N+ admins?"* with
  `CAST(json_extract(user_count_by_role,'$.administrator') AS INTEGER) >= N`,
  and `fleet-sql.ts:34` publishes the column's shape to the model. Implementing
  `minAdminCount` therefore invents no semantic — it gives Site Finder the same
  answer `fleet_sql` already gives.

  Live coverage 2026-08-15: local **36 of 40** active rows carry the column,
  wpe **123 of 342**, external n/a (no rows in this DB).

  **RECOMMENDATION — implement on all three chains**, with NULL treated as
  *unknown → excluded*, matching the rule the settings_json branch already
  states in a comment on all three chains ("Sites without settings_json have
  unknown state — exclude from all settings filters"). **Disclosure the owner
  should weigh:** that means `minAdminCount` silently misses the 219 WPE
  installs never deep-refreshed. Excluding them is the honest direction (a site
  whose admin count is unknown must not be reported as having ≥N admins) and is
  the same call the codebase already makes for unknown settings — but it is a
  real coverage limit, not a full-fleet answer, and the same one `fleet_sql`
  has today.

  ### Finding 4 — `phpVersions` needs no ruling, but its PREDICATE has a data
  mismatch the owner should see (raised now so this is one stop, not two).

  The packet rules `phpVersions` extends to all three chains. Placement is
  clear (beside `phpEolOnly`, reading the same `php_version` column). The open
  detail is which predicate. The local chain uses **exact membership**
  (`sitePhpVersions.includes(v)`), and the three sources store different
  granularities. Measured live:

  | source | stored `php_version` |
  |---|---|
  | wpe | **major.minor** — `8.2` ×183, `8.4` ×105, `7.4` ×5, NULL ×49 |
  | local | **full patch** — `8.2.29` ×34, `8.2.30`, `8.2.27`, `8.2` ×1, NULL ×3 |
  | external | **full patch** — from `wp --info`, e.g. `8.3.33` (CLAUDE.md) |

  The prompt documents the filter as major.minor (`["8.1", "8.2"]`). So exact
  membership is *correct for WPE* and *misses* local and external, where the
  stored value carries a patch segment.

  **What I intend to do (no ruling needed, flagging for visibility):** mirror
  the local chain's exact-membership predicate onto WPE and external. That
  keeps the diff a fix rather than a redesign, and it makes no site match that
  the local chain wouldn't. Net effect of the fix: a `{phpVersions:['8.2']}`
  query goes from "3 of 7 local correct + **all 5 WPE + all 3 external
  returned unfiltered**" to correctly-filtered on every chain.
  **Separate follow-up I recommend but am NOT doing here:** unify all three
  chains on the prefix predicate `wpVersions` already uses in this same handler
  (`v || startsWith(v+'.') || startsWith(v+'-')`), which would handle both
  granularities. It changes LOCAL behaviour, so it is its own decision and its
  own packet.

  ### The ruling I need, in one line each

  1. `wpeEnvironment` — **implement on WPE + external, exclude on local**
     (recommended) / implement on WPE only / remove entirely?
  2. `minAdminCount` — **implement on all three via
     `user_count_by_role.$.administrator`, NULL excluded** (recommended) /
     remove entirely?
  3. If either is "implement": also add it to
     `src/main/ai/site-finder-prompt.ts` so it is actually reachable? (I
     recommend yes; without it the filter stays dead in practice.)

  Standing by. No handler edit will be made until this is answered.

  **RULING RECEIVED (architect, endorsed for owner) — Phase 1 unblocked.**

  1. **`wpeEnvironment` → implement on WPE + external; local pinned to match
     nothing.** The deciding detail is the scout's own: with zero renderer and
     zero prompt references, the only consumer is the NL→filter parse — a user
     saying *"my staging sites"*. For that intent, silently missing a staging
     SSH host is the same defect class this packet exists to fix, and the
     CLAUDE.md fleet doctrine settles external's inclusion. Local is excluded
     because a Local site has no meaningful environment axis: the value is a
     constant `development` AND 65% of Local's sites lack a graph row, so
     matching on it would be matching on an artifact of **indexing coverage**,
     not on a fact. Conditions: (a) pin the category-error choice explicitly —
     a per-chain test asserting local matches nothing, commented as deliberate,
     so a future reader sees a decision and not a gap; (b) the two
     parse-accuracy schema tests stay as-is (the schema surface does not
     change); (c) the name-under-describes concern is real but **renaming is
     OUT of scope** — it would churn the NL parser schema and the SF evals for
     zero user-visible gain. Recorded as a note, not a change.
  2. **`minAdminCount` → implement on all three chains, NULL excluded.** The
     semantic already exists as the house-documented canonical query, so
     implementing invents nothing and *removing* would leave the filter surface
     contradicting the MCP server's own instructions; NULL-as-excluded follows
     the settings_json precedent already stated on all three chains, so no new
     unknown-handling rule enters the codebase. Conditions: (a) pin the
     NULL-exclusion per chain, in the style of WP-04b's `last_post_at`
     asymmetry pins, commented with the settings_json precedent as the rule
     being followed; (b) the 219 never-deep-refreshed WPE installs are a real
     coverage gap and the disclosure instinct is right, but surfacing it is out
     of scope for a legacy bugfix — recorded as a named follow-up below;
     (c) the one schema test stays as-is.
  3. **Both filters are wired into the prompt.** An implemented-but-unpromptable
     filter fails this packet's own purpose: the defect was "filter selected
     returns everything," and a filter nobody can select is the same
     user-facing nothing with more code behind it. The prompt addition is part
     of the fix, not scope creep. Conditions: (a) mirror the existing
     description style of the other filters exactly, including
     `wpeEnvironment`'s local-matches-nothing caveat in one clause so the parser
     does not emit it for queries about local sites; (b) **the verification bar
     rises**: parse-accuracy green AND the SF evals green, and since prompt text
     can shift parse behaviour subtly, **any** change to an existing
     parse-accuracy or SF expectation is an ESCALATION, not a test update.

  **FOLLOW-UP REGISTERED (not done here):** `minAdminCount` silently excludes
  never-refreshed installs; candidate for the intelligence layer's
  `coverageGap` surfacing — the WP-04 payload block already has the vocabulary.

  **WP-04c PHASE 2 CLOSE-OUT — executed, verified, findings.**

  **Verification.** Worktree baseline BEFORE: **494 suites, 6,170 passed, 12
  skipped, 6,182 total**, exit 0. AFTER: **494 suites, 6,183 passed, 12
  skipped, 6,195 total**, exit 0. Suites unchanged; tests **+13**, exactly the
  13 new pins; **skipped unchanged at 12**, so the delta is not an
  artifact-gated suite appearing or vanishing. `npm run typecheck` clean;
  `npx eslint` clean on all three touched files. All **40** WP-04b tests green
  and unmodified (the suite is now 53). Touched-area legacy suites green
  together: `parse-accuracy`, `site-finder-soft-delete`, `siteFinderTwins` —
  3 suites / 40 tests, **with no expectation changed**, so the ruling's
  escalation trigger did not fire on the jest side.

  **Mutation battery — 8/8 CAUGHT, each with its named witness.** Committed
  first (the pattern's rule). Each substitution is anchored to the production
  line with enough surrounding syntax that a comment quoting it cannot match;
  the harness asserts the anchor matches **exactly once**, that the file hash
  actually changed, that the *named* witness test is among the failures (a
  non-zero exit alone was not accepted as a kill), and that the tree restores
  to the original hash afterwards. Because the three chains contain
  byte-identical lines, `minAdminCount` was anchored through its differing
  `.get(siteId)` / `.get(wpeSite.id)` / `.get(externalSite.id)` argument rather
  than by occurrence index — a sharper anchor than WP-04b could use.

  | # | mutation | chain | witness |
  |---|---|---|---|
  | M1 | delete the `phpVersions` branch (restores the original defect) | wpe | "no longer returns every remote site unfiltered" |
  | M2 | delete the `phpVersions` branch | external | "filters the EXTERNAL chain in isolation" |
  | M3 | `environment !==` → `===` | wpe | "returns only staging, across BOTH remote chains" |
  | M4 | `environment !==` → `===` | external | "returns only staging, across BOTH remote chains" |
  | M5 | the deliberate local no-match becomes a no-op | local | "matches NO local site, on purpose" |
  | M6 | `minAdminCount` `<` → `>` | local | "at least 2 administrators, on all three chains" |
  | M7 | NULL becomes "no constraint" instead of excluded | wpe | "excludes a NULL user_count_by_role as UNKNOWN" |
  | M8 | `minAdminCount` `<` → `>` | external | "at least 2 administrators, on all three chains" |

  Six of the eight are per-chain kills on lines whose siblings were left
  untouched, which is the evidence that "exercises all three chains" is a real
  property of the new pins and not a comment. The battery ran strictly between
  the two full-suite runs, never concurrently — WP-04b's process note, now
  followed as standing practice.

  ### Findings

  1. **The local `phpVersions` predicate was already the odd one out, and this
     packet did not change that.** The predicate is exact membership on all
     three chains now, but the three sources store different granularities —
     measured live 2026-08-15: WP Engine stores **major.minor** (`8.2` ×183,
     `8.4` ×105, `7.4` ×5), Local stores a **full patch** version (`8.2.29`
     ×34), and external SSH hosts store full patch too (from `wp --info`). The
     prompt documents the filter as major.minor (`["8.1","8.2"]`). So after
     this fix a `{phpVersions:['8.2']}` query is *correct* on the WPE chain and
     *misses* local and external sites that are on 8.2.x. Mirroring the local
     chain's predicate was chosen deliberately over inventing a new one: it
     keeps the diff a fix, and it makes no site match that the local chain
     wouldn't. **Recommended follow-up (not done, needs its own decision
     because it changes LOCAL behaviour):** unify all three chains on the
     prefix predicate `wpVersions` already uses *in this same handler*
     (`v || startsWith(v+'.') || startsWith(v+'-')`), which handles both
     granularities. The fixture's PHP column is deliberately mixed-granularity
     so that whoever takes that packet has the discriminating cases already.
  2. **How this state arose, so the next schema addition doesn't repeat it.**
     `wpeEnvironment` and `minAdminCount` were two schema keys with **neither a
     prompt line nor a chain implementation behind them** — speculative
     scaffolding that survived precisely because nothing could ever exercise
     it: the zod schema accepted them, `hasFilter` blessed them, and the only
     tests were schema-shape tests that passed on an empty implementation. The
     rule that would have caught it: **a filter key lands with its chain, its
     prompt line, and its pins in the same commit, or it does not land.** A key
     that only a hallucinating parser could emit is not a feature behind a
     flag, it is a guard-passing path to "returns everything".
  3. **`minAdminCount`'s coverage gap is real and is now a named follow-up.**
     It silently excludes never-refreshed installs (live: 219 of 342 active WPE
     rows have no `user_count_by_role`). Excluding them is the honest direction
     and matches the settings_json precedent, but the user cannot see the
     difference between "no site has 3+ admins" and "we never looked". Recorded
     above as a candidate for the intelligence layer's `coverageGap` surfacing
     — the WP-04 payload block already has the vocabulary. Note the same limit
     already applies to `fleet_sql`'s documented answer to this question, so
     this packet did not introduce it.
  4. **`wpeEnvironment`'s name now under-describes it** — it accepts external
     SSH hosts too, which is the ruled behaviour. Renaming was ruled OUT of
     scope (it would churn the NL parser schema and the SF evals for zero
     user-visible gain). Recorded here so a future reader finds a decision
     rather than an inconsistency. The prompt line names the behaviour
     explicitly ("WP Engine installs and external SSH hosts") so the parser is
     not misled by the key name.
  5. **Scope held: the three chains are still three chains.** Deduplicating
     them was tempting on every one of the nine insertions — the
     `minAdminCount` block is byte-identical across all three but for its `id`
     argument — and was left alone per the packet. The diff makes the chains
     *more* consistent (each now carries the same three predicates in the same
     order) without making them *fewer*, which is what a future dedup packet
     needs as its starting point.
  6. **What I could NOT mechanically verify: the SF evals.** The ruling raised
     the bar to "parse-accuracy green AND the SF evals green". The jest half is
     done and clean. The SF eval half is **human-in-the-loop by construction** —
     `tests/evals/runner/run-eval.ts` prints a prompt for a reviewer to paste
     into Claude and `score-eval.ts` asks the reviewer for scores; there is no
     deterministic pass/fail I can execute, and `auto-eval.ts` needs a live LLM
     against the real fleet. So, precisely: **`tests/evals/` is untouched by
     this packet** (verified against the diff), and **no SF case's
     `expected_filter_json` or `expected_result_count` references
     `phpVersions`, `wpeEnvironment` or `minAdminCount`** (verified by grep
     across all eight SF-*.yaml) — the eight cases exercise plugins, phpEolOnly,
     pluginVersion, recentPostDays, settings and post counts only. The residual
     risk the ruling was guarding against is that four added prompt lines shift
     an existing parse; the nearest case is SF-07 ("outdated plugins" →
     needsClarification) and my additions mention neither plugins nor PHP. That
     residual is **not zero and is not verified** — an eval run is the owner's
     to make. I am not claiming those evals green; I am claiming their inputs
     unchanged and their subject matter disjoint from the change.

  **ABI STATE: this session ran jest — better-sqlite3 is on the system-Node
  build (this machine's shell Node 25.9.0 → ABI 141; `.nvmrc`/CI is 22.16.0 →
  ABI 127). `npm run rebuild` is required before loading Local again.** The
  shared `node_modules` every worktree symlinks through is affected.

  **WP-04c INTEGRATION REPORT — merged 2026-08-15 as `388e996b`.**

  Receipts (`git diff --stat <merge>^1 <merge>`):

  ```
   docs/intelligence/WORK_PACKETS.md          | 337 ++++++++++++++++++++++++++++-
   src/main/ai/site-finder-prompt.ts          |  14 ++
   src/main/ipc-handlers.ts                   |  75 +++++++
   tests/unit/ipc/site-finder-filters.test.ts | 243 ++++++++++++++++++---
   4 files changed, 633 insertions(+), 36 deletions(-)
  ```

  Two notes on the integration itself:

  - **The base had advanced under me** — WP-08 merged (`c9be9b52`) after this
    worktree was cut, and the primary checkout additionally held *uncommitted*
    architect work (the WP-08 adjudication and an ADR-17 authoring-vocabulary
    amendment). Both were committed **verbatim** as `699a8121` before merging,
    following the precedent set by `4dc50b21`. The only merge conflict was
    `WORK_PACKETS.md`, where both sides had appended to an append-only file;
    resolved by keeping both, WP-08's first. No `src/` conflict.
  - **Post-merge full suite on the integrated tree: 499 suites, 6,227 passed,
    2 skipped, 6,229 total, exit 0.** Note the skipped count reads **2** here
    against **12** in the worktree, and that is NOT something this change did:
    the primary checkout has an untracked `models/all-MiniLM-L6-v2-quantized`
    that the fresh worktree lacks, so ten artifact-gated tests `describe.skip`
    there and run here. This is precisely the WP-04 finding the protocol warns
    about, observed again — **a skipped-count delta across two checkouts is an
    environment difference, and comparing test totals across them is invalid.**
    The load-bearing comparison is the same-environment one recorded above:
    in-worktree 6,170 → 6,183 passed with skipped unchanged at 12, a delta of
    exactly the 13 new pins.

---

**ARCHITECT ADJUDICATION — WP-04c (appended by the architect session).**

- **WP-04c ACCEPTED.** Merge 388e996b audited from the owner's checkout:
  four files, exactly the three ruled fixes + prompt wiring + pins + notes.
  All 40 WP-04b tests unmodified and green; the per-chain mutation kills and
  the `.get(...)`-argument anchor (sharper than occurrence-indexing) are
  noted as the new best practice for duplicated chains.
- **SF-eval residual risk adjudicated:** the human-in-the-loop SF parse run
  is CONSOLIDATED with WP-08's M4 belt-and-braces run into ONE owner eval
  session before the M2 PR opens. Until then, the four added prompt lines
  are the only unverified surface; `tests/evals/` untouched is accepted as
  the merge bar.
- **699a8121 (agent committing architect work) endorsed** — the practice is
  now written into PARALLEL_PROTOCOL's Communication section as standard.
- **WP-04d registered** (below): phpVersions granularity unification —
  follow-up, changes local behaviour, needs its own packet. The
  land-together rule from the process finding (a filter key ships with its
  chain, prompt line, and pins in one commit, or not at all) is adopted as
  Site Finder convention.

### [ ] WP-04d · phpVersions granularity — unify on the prefix predicate
Registered from WP-04c finding. WPE rows store PHP as major.minor ("8.2");
local/external store patch-level ("8.2.29"); the current exact-membership
predicate therefore under-matches across sources depending on which
granularity the user queried. Recommended fix: the prefix predicate
`wpVersions` already uses, applied uniformly. **Changes local-chain
behaviour**, so it is its own packet with its own parity analysis — the
WP-04b/04c suite (53 tests) is the harness; expect to UPDATE some pins
deliberately and say which. Integration-lock class (edits the chains).
Low urgency; do not run concurrently with other ipc-handlers work.
- 2026-08-15 · **WP-10 recon delivered** — `docs/intelligence/recon-ask-tell.md`.
  Read-only packet: no production file touched, no test run, **ABI state
  unchanged** (this session ran no jest; whatever the tree was in, it still is).

  Headline findings the owner should see before approving WP-11's scope:

  1. **There are four actor surfaces, not one.** Docked-Panel/Chat-tab →
     `ChatService` (the ADR-19 anchor, tools, ~190 of them); AssistantPanel →
     `ASSISTANT_QUERY` (single-shot, no tools, stateless — and it already does a
     hand-rolled retrieval + grounding pass); the agent runtime (no system
     message at all, `agent.tools` allow-list is the only scoping); and external
     MCP clients (`initialize` instructions + a live fleet snapshot — the only
     existing ambient-shaped mechanism in the tree, but session-scoped).
  2. **A rehydrated chat session runs with no system prompt at all.** The
     renderer strips `role:'system'` when persisting (`PanelChat.tsx:541`) and
     `ChatService` takes the restore branch *instead of* building a prompt
     (`ChatService.ts:130-141`). Reopening an old Docked-Panel session after a
     Local restart loses the fleet context, the tool doctrine, **and the
     untrusted-data directive**. This is a pre-existing live defect, out of
     WP-11's scope, but it means an assembler that injects only into
     `messages[0]` would be fail-*open* on the most ordinary resumption path.
     Recorded as R1; wants its own packet.
  3. **A second system message is silently dropped on Anthropic and Google**
     (`anthropic.ts:43-44`, `google.ts:72-73` — `find` + `filter`), passed
     through on OpenAI. "Append the bundle as a new system message" is a
     provider-dependent no-op that would test green on OpenAI and fail
     invisibly on the default path. R3.
  4. **The untrusted-data directive and a pushed runbook are in direct
     tension.** Tool results are wrapped in `<untrusted_data>` and the model is
     told never to obey instructions inside them (`pii.ts:39-44`). Authored,
     signed procedure therefore cannot ride the `tool` role. R7 — this is the
     sharpest constraint on the procedure injection point.
  5. **Nothing measures tokens, and the tool schemas dominate.** ~190 tool
     schemas are re-sent on each of up to 25 loop iterations
     (`ChatService.ts:182-185`, `constants.ts:450`); `search_tools` exists
     because the list is already unmanageable (`search-tools.ts:3-5`).
     `AssembleRequest.budget` and the manifest's `budget` block have no
     existing source of truth — WP-11 must bring an estimator. R4.
  6. **No `task.*` event has ever been produced.** All ten `emitter.emit(` call
     sites emit `state.*`; `sessionId` is renderer-minted and not a ULID, so it
     cannot serve as `correlation`. WP-11 must mint a real `TaskId` per turn.
     R6.
  7. **`src/main/ai-context/` is a red herring** — it generates an
     `AI-CONTEXT.md` file inside a WordPress site for third-party coding
     assistants and never touches a chat turn. Named in the packet; checked so
     nobody re-checks.

  Proposal (§4, awaiting owner review): **three call sites, all in
  `src/main/chat/ChatService.ts`** (:574 ambient block, :157 per-turn bundle
  carrier as a `user`-role message, :185 tool-grant pass-through), plus an
  optional third parameter on `tool-adapter.ts:10`. All assembler logic lands in
  new files — `src/intelligence/assemble/` (behind the ADR-16 seam) and one host
  adapter `src/main/intelligence-host/chatAssembly.ts`. **No edit to
  `ipc-handlers.ts` or `index.ts`**, so the integration lock is not needed.
  Anchoring the per-turn carrier at `:157` rather than only at the system-prompt
  builder is deliberate: it is the one injection point where "the bundle was
  present" is a property of the turn rather than of how the session started —
  which is what makes it immune to finding 2 without depending on that fix.

  Deferred with reasons stated in §4.3: surfaces B/C/D, populating
  `ToolGrant[]` (needs B-03 as its gate), and fixing R1.

  Four open questions for the owner are in §5 — the load-bearing one is whether
  the anchor-slice demo runs in the Docked Panel or the Chat tab, since they are
  separate components with different persistence behaviour and only one is
  affected by R1.

---

**ARCHITECT ADJUDICATION — WP-10 + owner rulings (appended by the architect
session, 2026-08-16).**

- **WP-10 ACCEPTED** — the strongest artifact any packet has produced. Every
  claim cited; the four-surface map, the `ai-context/` red herring, and R1–R10
  are adopted as WP-11's ground truth. §4's proposed wiring is endorsed as the
  WP-11 skeleton unchanged.
- **The four §5 questions were put to the owner and ruled** (recorded in the
  WP-11 entry above): Docked Panel; hash-re-assert (now **ADR-20**, with the
  ADR-19 refinement naming the Docked Panel); model-must-relay staleness;
  R1 fixed now as its own packet (**WP-12**, registered above).
- Sequencing constraint recorded: WP-12 → WP-11, never concurrent (both edit
  ChatService.ts — the protocol's two-packets-one-file trigger, resolved in
  advance by ordering).

---

**WP-12 execution note (agent session, 2026-08-15).**

- **The recon's diagnosis was accurate as written** — both citations verified
  against the code before implementing: `ChatService.sendMessage`'s restore
  branch (ChatService.ts:130-138) never called `buildSystemPrompt`, and
  `PanelChat.persistSession` (PanelChat.tsx:541) filters `m.role !== 'system'`.
  No reason to deviate from the packet's proposed fix shape was found.
- **The restore branch was also ignoring `siteId`** — a second-order effect of
  the same defect, since `siteId` reaches `buildSystemPrompt` and nothing else
  in that branch. A rehydrated session therefore had no site context even when
  the renderer sent one. Rebuilding fixes both with one call. (R2 — context
  computed once per session, never refreshed per turn — is NOT fixed here; it is
  WP-11's edit #2 and remains open.)
- **Dropping persisted system rows is load-bearing, not tidying.** Prepending a
  fresh prompt while keeping the filter's `system` arm would have produced two
  system messages on any legacy session; per R3, Anthropic and Google keep the
  first and discard the rest with no error, so the *stale* prompt would have
  been the one in force — a silent partial revert of this fix. Pin 2 fails if
  the `system` arm is restored (verified by mutation).
- **Test infrastructure:** `tests/main/chat-service.test.ts`'s conventions were
  followed (jest.mock of `chat/providers/index` + a mock provider), extended
  with a provider that records the message array it was handed — asserting on
  what actually reaches the provider, rather than on service internals. The DB
  is a real in-memory better-sqlite3 with `createSessionTables`/`saveSession`,
  matching `tests/unit/chat/chat-unread.test.ts`.
- **Note for whoever touches this next:** `tests/unit/chat/chat-service-history.test.ts`
  is vacuous — it defines its own local copy of `reconstructHistory` and tests
  that, importing nothing from `src/`. It passed unchanged through both the bug
  and the fix. Not touched (out of scope), but it is not coverage.
- **Counts (worktree `wp-12`, measured, not recalled).** Baseline before the
  change: 499 suites (498 passed, 1 failed), 6229 tests — 6213 passed, 4 failed,
  12 skipped. After: 500 suites (499 passed, 1 failed), 6233 tests — 6217
  passed, 4 failed, 12 skipped. Delta is exactly +1 suite / +4 passing tests.
  The 4 failures are pre-existing and unrelated
  (`tests/unit/agent-runtime/AgentRegistry.test.ts`); skipped count unchanged,
  so no suite silently dropped out. `npm run typecheck` clean; eslint clean on
  both touched files.
- **ABI state: better-sqlite3 is built for system Node (jest), NOT Electron.**
  The owner must run `npm run rebuild` before loading the addon in Local.
