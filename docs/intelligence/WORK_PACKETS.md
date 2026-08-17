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

### [x] WP-09 · Author the remaining v0 runbooks (4)
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

### [x] WP-11 · Context assembler v0  **(DELIVERED 2026-08-15 — outcome + findings in the packet note below)**
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

**LOCK ANNOUNCED 2026-08-15 (agent session).** WP-11 is IN FLIGHT and holds the
core lock: `src/intelligence/` + `src/main/intelligence-host/`, plus
`src/main/chat/ChatService.ts` and `src/main/chat/tool-adapter.ts` (the three
call-site edits + the signature widening). Worktree `wp-11`, branch `wp-11`,
based on the WP-12 merge (9f6cf35b) plus the architect-docs commit. WP-12b must
wait for this merge — same file.

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

### [x] WP-04d · phpVersions granularity — unify on the prefix predicate
**DONE 2026-08-17** — all three chains now use the prefix predicate `wpVersions`
uses (`v || startsWith(v + '.') || startsWith(v + '-')`); two WP-04c pins
updated deliberately and marked `[WP-04d]` at the assertion, +7 new pins
(53 → 60), 16 mutations with 14 named-witness kills and 2 disclosed expected
survivors. No prompt change was needed, so `src/main/ai/` and `tests/evals/`
are untouched. Measured live: a `{phpVersions:['8.2']}` query matched 1 of 37
local rows before, 37 of 37 after. Notes at the end of this file.
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

---

**ARCHITECT ADJUDICATION — WP-12 (appended by the architect session).**

- **WP-12 ACCEPTED.** Merge 9f6cf35b: 21-line fix confined to the restore
  branch; both mutations actually run (prompt-rebuild revert and
  system-row re-admission each fail their pin); the legacy-system-row drop
  is adjudicated as load-bearing per R3 (Anthropic/Google keep the FIRST
  system message — a kept stale row would silently win over the fresh one).
  The incidental siteId fix is accepted in-scope (same call). R2 remains
  open by design — WP-11 edit #2 owns it.
- **NEW UNOWNED RED flagged:** the worktree baseline showed 4 pre-existing
  failures in `AgentRegistry.test.ts` that no packet report has previously
  disclosed (WP-04c-era runs were green). Not caused by WP-12; owner to run
  the suite and paste output to the architect for diagnosis before it gets
  normalized as "expected red." Until diagnosed, every packet's "no NEW
  red" comparison must count these 4 explicitly.
- **Vacuous-copy test registered (below):** second instance of the
  WP-04b pattern — a test file defining its own local copy of the logic it
  claims to pin.

### [x] WP-12b · chat-service-history.test.ts is vacuous — port or delete
**DONE 2026-08-17** — six ported cases added to
`tests/unit/chat/chat-service-rehydration.test.ts` (10 tests total, the
original 4 untouched); the copy is deleted; 5/5 mutations caught with named
witnesses plus one declared no-op proven. Notes at the end of this file.
Registered from WP-12 finding. `tests/unit/chat/chat-service-history.test.ts`
defines its own local `reconstructHistory` and imports nothing from `src/` —
it passed unchanged through both the R1 bug and its fix, which is the proof
of vacuity. Same remedy as WP-04b: port each assertion onto the real
`ChatService` restore path (the rehydration suite from WP-12 is the harness
to extend), waive the unreachable ones with reasons, delete the copy.
Parallel-safe EXCEPT with WP-11 (ChatService.ts reads, test-file edits only —
coordinate if concurrent). Small; any tier.

- **AgentRegistry red — partial diagnosis (architect, 2026-08-16):** the suite
  passes 11/11 on the primary checkout run in isolation (`npx jest
  AgentRegistry --runInBand`). The 4 failures WP-12 baselined therefore
  manifest only in a fresh-worktree full-suite context — the same family as
  the embedding-model skips (untracked artifact) and the host/sync worker
  collision (WP-05 finding 7). Root cause unknown; the failure TEXT was not
  preserved, only the count. **Standing instruction: the next packet whose
  worktree baseline shows these failures must capture the full failure output
  in its notes** (suite output, not the summary line) — that single paste
  completes the diagnosis. Until then the 4 stay explicitly counted in every
  "no new red" comparison.
---

**WP-11 · Context assembler v0 — outcome (agent session, 2026-08-15).**

**Delivered as specced.** New core `src/intelligence/assemble/{types,assembler}.ts`
(+ `__tests__`), host adapter `src/main/intelligence-host/chatAssembly.ts`
(+ `__tests__`), three call-site edits in `ChatService.ts`, one signature
widening in `tool-adapter.ts`. No `ipc-handlers.ts` or `index.ts` edit.
Surfaces B/C/D deferred per recon §4.3. **58 new tests; 15/15 mutations
caught** (battery listed below). Full suite green — see the numbers at the end.

**The five acceptance pins (recon §4.4), each with the test that holds it:**

1. **ULID TaskId per turn, threaded as `correlation`.** `mintTaskId()` per call
   of `assembleForChatTurn`; pinned by *"mints a ULID TaskId per turn and
   threads it as correlation, never the sessionId"* — which asserts two turns
   of the SAME session get different ids, and that
   `ledger.query({correlation})` returns the manifest.
2. **The manifest is a ledger event, not an audit-file line.**
   `task.context.assembled` / `context.assembled/1`, payload = the §6.4
   manifest verbatim. First `task.*` producer in the codebase.
3. **Token estimator.** `estimateTokens` = `ceil(chars/4)`, documented as an
   estimate (±~25%) and **scoped**: the manifest's `budget.scope` says it
   covers assembler-authored blocks only and excludes the tool schemas that
   R4 identified as the dominant cost. Mutation M7 (fabricating the number)
   is caught.
4. **The freshness-disclosure prose contract** is a single exported constant,
   `FRESHNESS_DISCLOSURE_CONTRACT`, asserted verbatim by both the core and host
   suites, so it cannot be softened without a red test.
5. **Additive parity.** Run before/after with the assembler returning `null`
   AND with an empty bundle: both produce byte-identical prompts and message
   arrays, asserted by string equality between the two runs.

**Three findings the owner should see.**

1. **ESCALATION RAISED AND RULED — the `task.*` taxonomy could not be
   emitted.** `validateEnvelope` requires three topic segments; every `task.*`
   entry in §4.2 had two, so the entire namespace was unemittable and had never
   been exercised. Architect ruled: the validator wins, taxonomy respelled to
   `task.context.assembled` et al. Mutation M11 pins the new spelling (the old
   one produces zero events, silently, because emission is wrapped).
2. **`ChatService` needed its own non-fatality guard.** The adapter swallows
   everything, but the `await` at the call site was still a path by which a
   future regression inside the adapter could throw into a caller that predates
   the layer — which the layer invariant forbids. Found by writing the test
   first, asserting the wrong thing, and noticing the assertion contradicted
   its own name. Fixed in production, not in the assertion (M14).
3. **The 4 "known-red" `AgentRegistry.test.ts` tests do not reproduce here.**
   The architect's WP-12 adjudication asked every packet to count them
   explicitly. In this worktree that file is **11/11 green**, and the baseline
   had **zero** failures. Whatever produced the red was environment-specific,
   not branch state. Nothing was done to fix it — it simply is not present.

**Deviations from the §6.1 sketch, all deliberate and commented in-code:**

- `assemble` is **async** (semantic retrieval is a promise on every store this
  codebase has; the alternative moves ranking/budget out of the assembler,
  which ADR-10 forbids).
- The bundle carries its **rendered blocks**, because the budget number must be
  measured over the text the actor actually receives.
- `manifest.policy.age_s` is **null**, not a number: v0 has no pin timestamp to
  measure from, and inventing one is the staleness-laundering the envelope
  rules exist to prevent.

**One extra edit outside the three call sites, flagged for review:**
`wrapUntrusted` in `src/main/mcp/pii.ts` changed from private to **exported**
(one word; no behaviour change). The assembler must mark site-derived retrieved
content with the SAME delimiters and spoof-neutralisation the tool path uses,
and it lives behind the ADR-16 seam so it cannot import that module — the host
injects the function instead. The alternative was a second copy of a
security-relevant literal across the seam. **This does not touch
`maskToolResultsForProvider` or `compressStaleToolResults`, and it is not an
exemption marker** — it is the opposite: the assembler marks its own retrieved
content as untrusted so the existing directive covers it. Retrieval is skipped
entirely when no wrapper is supplied (M5).

**Design points worth carrying forward:**

- **State is never copied, and the tests prove it.** The freshness plane
  discloses fact key + age + SLO and withholds the value; the episodic plane
  renders the fact a state event was *about*, never its payload values. Both
  are pinned by asserting the twin's actual version strings never appear in the
  rendered text (M4).
- **`[]` must never reach `adaptToolsForChat` as a filter.** `[]` means
  deny-all in this codebase's one existing scoping surface (`agent.tools`), so
  the adapter maps an empty grant list to `undefined`, and the tool adapter
  treats `[]` as unrestricted too — belt and braces, both pinned (M12).
- **The per-session policy-hash map is host state, deliberately.** The
  assembler is stateless (ADR-10/G4), so "what does this actor already carry"
  is remembered on the host side. A process restart empties it, which is the
  correct failure direction: the next turn re-asserts the full set rather than
  assuming presence. This is also what makes a rehydrated session safe.
- **Consecutive user messages are already normal on every provider here.**
  Edit #2 pushes a second user-role message; Anthropic and Google already map
  every tool result to `role:'user'`, so parallel tool calls produce
  consecutive user turns in the shipping product today. The Anthropic API
  combines consecutive same-role turns.

**Mutation battery — 15/15 caught.** M1 ambient block dropped from the system
prompt · M2 carrier sent as a system message (R3) · M3 ADR-20 hash re-assert
defeated · M4 twin values copied into context · M5 retrieved content unwrapped
(R7) · M6 relay contract dropped · M7 budget number fabricated · M8 ADR-7
fail-closed removed · M9 episodic query loses `order:'desc'` · M10 manifest
emitted without the TaskId correlation · M11 pre-respell topic spelling · M12
empty grant list leaks as `[]` · M13 `verifyMirror()` not called at assembly
time · M14 `ChatService` non-fatality guard removed · M15 ADR-16 seam probe
(an `electron` import from `assemble/` errors, so the WP-06 failure mode is
not present on this branch).

**One more finding, cheap to repeat and easy to miss.** Two raw control bytes
(NUL, SOH) reached `assembler.ts` as hash separators. The separators are
correct — unambiguous field/record boundaries so `['a b', c]` and `[a, 'b c']`
cannot hash alike — but a literal NUL makes **git classify the file as binary**:
`Bin 0 -> 19919 bytes` in `--stat`, and **no diff at all in review**. Caught by
reading the diff stat rather than trusting it. Now written as `\u0000` /
`\u0001` escapes. Worth a glance on any new file whose `--stat` line says
`Bin`.

**Milestone DoD (evals B-03/E-01/E-02) NOT run — see the disclosure below.**

**Datapoint for the AgentRegistry diagnosis (added after reading the
architect's note above).** WP-11's baseline WAS a fresh worktree running the
FULL suite — `npx jest` with no path filter, 500 suites — and it was **green,
zero failures**, with `AgentRegistry.test.ts` passing 11/11 both inside that
run and in isolation. So "fresh-worktree full-suite context" is not by itself
sufficient to reproduce the 4 reds. Something else differed in the WP-12
worktree. The post-WP-11 full run is also green at 503/6279. There was no
failure output to capture here because there was no failure; the standing
instruction still stands for whichever packet next sees one.

**ABI state: better-sqlite3 is built for system Node (jest), NOT Electron.**
The owner must run `npm run rebuild` before loading the addon in Local.

---

**ARCHITECT ADJUDICATION — WP-11 (appended by the architect session).**

- **WP-11 ACCEPTED.** Merge c42399e7 audited from the owner's checkout. The
  three ChatService call sites match recon §4.2 exactly, compose with
  WP-12's fix, and carry their risk citations in comments. All five §4.4
  pins verified present in the report; 15/15 mutations; additive parity
  proven both ways.
- **The fourth edit (pii.ts `wrapUntrusted` export) is RATIFIED.** Strictly
  it touched the R7 machinery's module without pre-escalation — but the
  change reuses the delimiters rather than altering their treatment, the
  seam-respecting injection (host supplies the function; assembler cannot
  import the module) is the correct shape, and no-wrapper⇒drop-retrieval is
  fail-closed. For the record: a one-line pre-escalation would have been
  preferred; the substance would have been approved unchanged.
- **The task.* escalation is closed** — first producer shipped against the
  respelled taxonomy (`task.context.assembled` / `context.assembled/1`),
  M11 pins the spelling.
- **AgentRegistry datapoint recorded:** the 4 reds did NOT reproduce in
  WP-11's fresh-worktree full-suite baseline — so the context hypothesis is
  insufficient; the failure is scheduling- or state-dependent (same family
  as the host/sync worker collision, which also fired intermittently).
  Capture instruction stands.
- **Milestone DoD is NOT yet met, by honest disclosure:** evals B-03/E-01/
  E-02 exist only as YAML specs; no runner loads them. **WP-13 registered**
  (below). M2 is code-complete; the milestone closes when WP-13's runner
  executes those three evals green against the real ledger.

### [x] WP-13 · Eval spec runner + milestone verification  **(the M2 close-out gate)**
The anchor-slice eval specs (`docs/intelligence/anchor-slice/evals/*.yaml`,
incl. B-03/E-01/E-02) have no runner: nothing in `src/` or `tests/` loads
them, and `tests/eval/` is an unrelated chat-quality harness. Build the
minimal runner that: loads the YAML specs (WP-08's law loader shows the
frontmatter-parsing house style); executes each against the REAL
intelligence core (harness rules H-01/H-02 in the eval doc govern — read
`docs/intelligence/eval-stress-test-set.md` first); reports per-criterion
pass/fail with evidence, never a bare boolean. Where a spec requires live
LLM judgment, follow the WP-08/WP-04c precedent: print the
human-in-the-loop prompt and mark the criterion OWNER-PENDING rather than
faking a verdict. Scope the runner under `tests/intelligence-evals/` (new
tree, jest-invocable) or propose better in your scout note. Milestone DoD:
B-03, E-01, E-02 green (or OWNER-PENDING with the owner's run
instructions), executed against a ledger seeded by the real producers.
Parallel-safe (new tree + read-only on everything else). Any spec found
unimplementable as written is a WP-11-style escalation — the spec gets
fixed in the record, not worked around.

**WP-13 CLOSE-OUT — runner built and run. M2 does NOT close, and not because
anything is broken.** The runner executes; the specs assume a platform M2 did
not ship. Full report: `npx ts-node --project tsconfig.test.json
tests/intelligence-evals/run.ts`.

**Result over the 27 criteria of the three specs:**

| | B-03 | E-01 | E-02 | total |
|---|---|---|---|---|
| PASS | 0 | 0 | 2 | **2** |
| FAIL | 0 | 0 | 0 | **0** |
| BLOCKED | 11 | 1 | 7 | **19** |
| OWNER-PENDING | 0 | 6 | 0 | **6** |
| spec-level SPEC-DEFECT | 1 | — | 1 | **2** |

Zero FAIL is the important number: nothing here is a code regression.

**What is genuinely green** (executed against a real core on a temp ledger
seeded by the real webhook producer, real folds, real assembler, and the real
`chatAssembly` manifest producer — 10 events across `state.plugin.observed`,
`episodic.incident.recorded` and `task.context.assembled`):

- **E-02 "every envelope validates against event-envelope.schema.json"** — 10/10,
  validated against the JSON file on disk, not the zod schema the events were
  already admitted by. The interchange contract and the in-process contract
  agree on this corpus. Validation uses a purpose-built draft-2020-12 **subset**
  validator (`jsonSchemaCheck.ts`, ~120 lines, zero new dependencies — `ajv` is
  present only transitively, at v6/draft-07, and depending on a transitive
  package is the packaging defect the owner just fixed for js-yaml). Any keyword
  it does not implement **throws**: a validator that silently ignores what it
  does not understand always passes.
- **E-02 "observed_at/recorded_at not conflated or missing"** — both fields
  present and correctly ordered on 10/10; 2 events carry a genuinely historical
  `observed_at`, proving source time survives emission rather than being
  flattened to "now". "Conflated" is deliberately not read as "equal": the
  webhook producer legitimately stamps both at once and says why.

**Five findings.**

1. **TWO OF THE THREE SPECS DID NOT PARSE.** B-03 `key_steps[6]` and E-02
   `key_steps[3]` each carry an unquoted `": "` inside a sequence item, which
   YAML reads as a **mapping**, not a string — so those criteria were objects.
   The house runner (`tests/evals/runner/run-eval.ts`) types `key_steps` as
   `string[]` and never validates, so this had been invisible since the specs
   were written. **FIXED IN THE RECORD** (quoted, text byte-identical, comment
   added), because the packet's deliverable is unmeetable while 2 of 3 specs
   cannot load. Flagged here rather than folded in silently: `docs/intelligence/`
   is owner-approval territory, and this is the WP-11 `pii.ts` shape — a
   mechanical fix whose substance I expect to be ratified, where a one-line
   pre-escalation would have been preferred. Revert is one `git revert` of the
   two YAML hunks. `specLoader.test.ts` now guards the class.
2. **ESCALATION — B-03 is circular and cannot be an M2 gate.** WP-11's
   adjudication (above) says M2 closes when B-03 runs green.
   `src/intelligence/assemble/types.ts:16-18` says procedure and tools are
   "inert in v0 (always null / []) … **gated on eval B-03**". So B-03 cannot
   pass until procedure distribution ships, and procedure distribution is gated
   on B-03. All eleven B-03 criteria are BLOCKED on that circle, and the runner
   **measures** it rather than asserting it: it calls the real `assemble()`
   under B-03's own grant and reports `manifest.capability =
   "cap.bulk_plugin_update"` (the grant IS recorded) alongside
   `bundle.procedure = null`, `bundle.tools = []` — the runbook is authored
   (`anchor-slice/runbooks/bulk-plugin-update.md`, strict, 8 checkpoints) and
   never delivered. **Owner ruling needed** on one of: **(a)** B-03 leaves the
   M2 close-out set and becomes the procedure packet's acceptance eval —
   recommended, it matches the assembler's own contract and leaves M2 gated on
   E-01/E-02; or **(b)** M2 stays open until procedure distribution ships, which
   makes M2 much larger than "code-complete" implies.
3. **ESCALATION — E-02 names four topics the validator cannot admit.**
   `task.context_assembled`, `task.action_executed`, `task.outcome_recorded`,
   `task.rationale_recorded` are all TWO-segment; `envelope/validate.ts` requires
   three. This is the identical escalation WP-11 raised against §4.2 and the
   architect already ruled on ("the validator wins, taxonomy respelled"); the
   eval YAML predates the ruling and never carried it. **NOT fixed here** — four
   semantic renames in an owner-owned doc want the owner's hand, unlike finding 1
   which was a parse defect. Patch: respell to `task.context.assembled` /
   `task.action.executed` / `task.outcome.recorded` / `task.rationale.recorded`.
   `runner.test.ts` pins the specs' current wording, so when the fix lands that
   test fails and the finding must be retired rather than left to rot.
4. **E-01's history is in the ledger and unreachable from the wired surface.**
   Measured with two runs of the real assembler over the same ledger:
   `episodicTopicPrefix="episodic."` retrieves the 2 planted incidents;
   the **wired** defaults retrieve **0**, because `chatAssembly.ts` builds its
   `AssembleRequest` with `retrieval: { semanticLimit }` only and the assembler's
   default prefix is `state.`. So the chat surface cannot consult incident
   history no matter what the model does — and any historical incident it cites
   there is necessarily fabricated, which the runner flags in the evidence for
   E-01's `must_not` "cite history it did not retrieve". Fix is roughly one line
   in `chatAssembly.ts`, but it is a behaviour change on the anchor surface, so
   it is recorded here rather than done under a runner packet. **Re-verified
   after merging WP-16**, which lands audit A3 (`resolveTargets` additionally
   returns the `{role:'site'}` target): A3 widens the SCOPE of the episodic
   query, not its TOPIC, so `retrieval: { semanticLimit }` still leaves the
   prefix at `state.` and the finding is unchanged. The probe already passed
   both roles, so it was measuring WP-16's shape before WP-16 merged.
5. **No production producer emits any `episodic.*` event.** The only topics any
   code in `src/` emits are the six `state.*`, `semantic.content.changed`, and
   `task.context.assembled`. E-01's fixture therefore cannot be built by a
   producer; the runner plants it through the real `Emitter` under
   `source.system = "fixture:e01-incident"` and says so in the evidence of every
   criterion that leans on it. WP-14 starts filling this plane; an incident
   producer proper is not yet a registered packet.

**What the six OWNER-PENDING criteria need** (all E-01, all judged per H-02 —
plan quality and register, never automated): each prints its verbatim prompt,
the seeding command (`run.ts --seed-dir <path>`, which materialises the fixture
ledger for a development build — never seed over a real ledger), the single
thing to judge, and H-01's pass^3 requirement. Ready for the consolidated owner
sitting the roadmap already schedules.

**Design decisions worth carrying forward:**

- **Five verdicts, and `BLOCKED` outranks `OWNER-PENDING`.** You cannot hand an
  owner a prompt to judge a run whose premise cannot be constructed; filing that
  as "pending" parks a platform gap in a human's queue forever. E-02's
  boilerplate-rationale criterion is the worked example — it is the spec's only
  LLM-judged criterion and it is BLOCKED, not pending, because no rationale
  producer exists to produce a subject.
- **A BLOCKED verdict is a measurement, not a claim.** Every one carries a probe
  that demonstrates the absence (assembler output, ledger topic counts) rather
  than an assertion that it is absent.
- **An unmapped criterion is BLOCKED, never PASS**, and the check registry binds
  by criterion TEXT rather than index, so a spec edit that orphans a check fails
  the suite instead of silently dropping an obligation. Both pinned.
- **The runner is a library + CLI, not a jest suite.** A jest run must be green
  or red; an eval sitting needs a printed prompt. Folding them together forces
  every judged criterion into a fake boolean. `jest tests/intelligence-evals`
  runs the deterministic half and the honesty tests.
- **New tree was correct.** `tests/evals/runner/` is the same YAML dialect but a
  transcript scorer for a human — it executes nothing and validates nothing.
  Different job. `jest.config.js`'s `/eval/` ignore pattern does NOT match
  `tests/intelligence-evals/` (checked, not assumed), so this tree is in
  `npm test` with no config change.

**Verification.** Baseline in a fresh wp-13 worktree BEFORE any change:
503 suites / 6279 passed / **12 skipped** / 6291 total / 0 failed — identical to
WP-11's recorded figure. After, before merging the base: **509 suites / 6396
passed / 12 skipped / 6408 total / 0 failed** — +6 suites, +117 tests, skipped
count unchanged, no legacy suite touched. After merging the advanced base
(WP-16): **509 / 6403 / 12 skipped / 6415 / 0 failed** — the +7 is WP-16's own
tests, and the eval suites are green against its `chatAssembly` change.
`npx tsc -p tsconfig.test.json --noEmit` clean (note: `tsc -p .`
does not cover `tests/`, so the DoD's typecheck command alone would not have
seen these files). **Mutation battery: 14/14 caught**, each anchored to a
production line with an observable witness — including "unmapped criterion
scores PASS", "BLOCKED no longer blocks the milestone verdict", "missing
evidence renders as nothing", "incident history stamped now", "unsupported
schema keyword ignored", and "the episodic probe uses the episodic prefix for
both runs" (which would have manufactured finding 4 out of nothing).

One real bug was found by the harness during development and fixed: the JSON
Schema validator treated the ledger row mapper's `correlation: undefined` as a
present-but-wrongly-typed property and failed all 10 envelopes. A key whose
value is `undefined` is not a JSON property.

**ABI state: better-sqlite3 is built for SYSTEM NODE** (jest ran here). Run
`npm run rebuild` before loading Local.

---

**ARCHITECT NOTE — three-layer implementation audit (2026-08-16).** Full
findings in `docs/intelligence/implementation-audit-three-layer.md` (A1–A9).
Headline: the model adopts additively; ONE forbidden path (re-deriving entity
ids — the id-freeze ruling is now in ADR-21's candidate text); the
reconciliation doc's "lineage already written" claim was corrected (it needs
one new producer); one live defect confirmed (verify_site_live identity).
Method note: audits ran on a staged snapshot — one finding (mirror unwired)
was a stale-snapshot false positive, excluded after live verification.
Packets registered below.

### [x] WP-14 · Sync-event producer + lineage edges  **(DELIVERED 2026-08-17 — outcome + findings below)**
No pull/push/promotion emits any ledger event today; `OperationTracker`
observes exactly these ops and is not connected to the core; `pull_lineage`
(EstablishedBy) ships dormant. Build: (1) a producer tapping OperationTracker
(or the pull/push tool handlers — scout which seam is cleaner) emitting
`episodic.sync.pulled` / `episodic.sync.pushed` (+`.promoted` when reachable)
with `entity: { site, environment: <upstream env>, working_copy: <local> }`
and payload `{ flow: 'content'|'code'|'full', direction, includes_db,
code_ref? }`; (2) on each sync, upsert lineage links: `content_pulled_from`
(copy→env, `at`=pull time, EstablishedBy `pull_lineage`) — the PK upserts so
the pointer MOVES; (3) mirror additions: `has_working_copy` (Site→copy)
alongside the kept `has_environment`; (4) `workingCopiesOf()` beside
`environmentsOf()` in entityService (core lock). Escalations: the new topics
are pre-ruled (this entry IS the ruling — three-segment, validator-clean);
anything else schema-shaped escalates. ADR-21's id-freeze ruling governs:
NEVER re-derive ids.

**ANNOUNCED 2026-08-17 — core lock held (worktree `wp-14`, branch `wp-14`,
base b5d3896f). Baseline in-worktree BEFORE any change: 514 suites / 6493
passed / 12 skipped / 6505 total / 0 failed.**

#### SCOUT — seam verdict: OperationTracker, enriched by the tool handlers

The packet asked which seam observes ALL sync operations most cleanly. Neither
candidate does on its own, and the tie is broken by *coverage*, because a
lineage record that is silently partial is worse than one that is absent —
WP-15 anchors divergence on "since the last sync at T", so a missing pull makes
a copy that was refreshed this morning read as weeks behind.

Measured against Local's own source (`flywheel-local`, not assumed):

- **`OperationTracker` sees everything.** `sendIPCEvent` is
  `ipcMain.emit(channel, null, ...args)` (`app/shared/helpers/send-ipc-event.ts:36`),
  and Local's `WPEPullService`/`WPEPushService` are the single funnel for BOTH
  UI-initiated syncs (Connect drawer → `WPE_PULL_SERVICE.PULL` ipc) and
  addon-initiated ones (`services.localServices.wpePull.pull()` IS that same
  method). The tracker's `ipcMain.on` tap is live — `operationTracker.start()`
  is called at `src/main/index.ts:418`.
- **The tool handlers see a minority.** `wpe-pull.ts` / `wpe-push.ts` cover the
  MCP + GraphQL paths only; Local's own drawer and `WPE_PULL_TO_LOCAL`
  (`WpeAutoPullService`, which calls `wpePull.pull` directly) both bypass them.
  Choosing this seam would bias the ledger toward agent-driven syncs while
  looking complete.
- **But the tracker knows almost nothing.** The IPC stream carries only a
  status string and progress labels — no upstream install, no `includeSql`, no
  flow. The handlers know all of it.

**Verdict: tap `OperationTracker`, and let the handlers enrich the
`register()` call they already make** (additive optional argument). One seam,
full coverage, authoritative detail where a caller had it.

Three findings the scout produced, all of which changed the design:

1. **A failed sync is indistinguishable from a successful one at the status
   level.** `WPEBaseService.errorHandler` emits the SAME
   `updateSiteStatus → 'running'` the success path does
   (`WPEBaseService.ts:107`), so the tracker's existing `status: 'completed'`
   means *finished*, not *worked*. The only structural discriminator is the
   banner id — `site-pulled` / `site-pushed` vs `pulling-error` /
   `pushing-error`. The producer therefore taps `showSiteBanner` and emits only
   on success: a failed pull moved no content, and moving the lineage pointer
   for one would be the worst available fabrication.
2. **Local persists NO sync history for the WPE flow.** The reconciliation
   doc §2 says "Local's sync history already records these operations —
   *outside* the ledger"; for pull/push there is no durable record at all
   (banner + status only, and `autoload.sql` is deleted after import,
   `WPEPullService.ts:230`). The IPC stream is the *only* evidence and it is
   live-only — unobserved, it is gone. That strengthens the tracker choice and
   should amend §2 alongside A4's existing correction.
3. **`includes_db` is not observable at any seam for a UI-initiated sync** —
   except through Local's own phase label. Both services emit a
   `updateSiteMessage` label under a strict `if (includeSql)` guard
   (`'Downloading and importing database'` / `'Dumping and pushing database'`),
   and no other label in either service contains the word. So a `/database/i`
   match over the operation's phase labels has **no false-positive path**; only
   a false negative is possible, and only if WP Engine changes that copy. The
   inference is used ONLY to set `includes_db` true, never to clear a
   caller-declared value, and the uncertain direction is the conservative one
   (a missed DB pull leaves the content pointer where it was, so the copy reads
   staler than it is rather than fresher). Declared beats inferred always.
   **Owner question, flagged not decided (schema-shaped, so not taken):** the
   ruled payload has no way to say *"the flow could not be determined"*. If you
   would rather see that than a conservative `code`, that is a `flow` union
   addition and wants your ruling.

#### OUTCOME — delivered, all four steps, plus two things the packet's premise got wrong

`syncProducer.ts` (new) emits `episodic.sync.pulled` / `episodic.sync.pushed`
(`schema: sync.observed/1`, `source.system: 'sync:wpe'`) with
`entity: { site, environment, working_copy }` and payload
`{ flow, direction, includes_db }`, and upserts the `content_pulled_from`
pointer. `.promoted` was NOT emitted: promotion is not observable at this seam
(Local's WPE services implement pull and push only), and inventing it from
nothing would have been the fabrication the packet warns against.

**Two corrections to the packet's own premises, both found by a failing pin
rather than by reading:**

1. **"The PK upserts, so the pointer MOVES" is false in the case that
   matters.** `entity_links`'s PK is `(from_entity, to_entity, kind)`
   (`migrations.ts:68`). Re-pulling from the SAME environment upserts — which
   looks right — but pulling from a DIFFERENT one **INSERTS**, leaving a copy
   asserting it pulled its content from production AND staging simultaneously.
   Only one can be true; the second pull overwrote the first's database. A
   pointer that only moves when it does not need to is not a pointer. Fixed by
   `EntityService.linkExclusive()`, which retires the copy's other edges of
   that kind as it writes — except `user_link` edges, because a human's
   assertion is not retired by an observation (same precedence rule as `link`
   and `addAlias`). Audit A4 states the same false mechanism and should be
   amended.
2. **The `site` role could not be stamped without breaking the id freeze.**
   `siteEntityId()` derives `local.site_id.logical`, but for a MIRRORED site
   the mirror keyed the Site by `wpe.site_id` — so deriving would have minted
   a second Site beside the real one on the very first pull. This is audit
   A7's defect reappearing in the packet built to prevent it, and the
   `COUNT(*) FROM entities` pin caught it on the first run. Fixed with
   `EntityService.siteOf()` — the env→Site reverse traversal **WP-16
   explicitly deferred to WP-14** ("the env→Site reverse lookup is
   WP-14/WP-15 work"). Traverse first, derive last; the derivation survives
   only for an unmirrored site, where it is the same id every other producer
   for that site already stamps, so nothing diverges. `verify_site_live` can
   now stop omitting its `site` role — a WP-15 follow-up, not taken here.

**Also delivered:** `workingCopiesOf()` and `siteOf()` beside
`environmentsOf()`; `has_working_copy` written by `siteLinkMirror` ALONGSIDE
the kept `has_environment` at both write sites (parity pinned, and re-running
the mirror still adds zero rows); the pull/push handlers enrich the
`register()` call they already made; `episodic.sync.*` has its liveness line
in WP-17's health surface (`sync:wpe`, 30-day SLO — syncs are user-initiated
and a machine with no WP Engine link never produces one, so anything tighter
is noise; never-observed keeps `countsTowardWorst: false`, pinned).

**Deliberately NOT done, with reasons** (rather than silently):

- **`tracks_content` / `tracks_code` edges** (mentioned in audit A6, not in
  this packet's step 3). Code lineage is a branch/sha, and A4 already
  established that a sha is not an entity — there is no code-lineage producer
  and no `code_ref` source at this seam, so the edges would have had nothing
  to point at. `code_ref` is likewise absent from the payload for the same
  reason.
- **A push does not move `content_pulled_from`.** The copy's content lineage
  is "the environment it was pulled FROM, at that time" (model §2); pushing
  sends content upward and does not change where the copy's content came from.
  Pinned.
- **`nexusHostAdd`-style audit coverage** was not touched — this producer
  mutates only ledger state, like every other producer on this seam.

**Verification.** Baseline in a fresh `wp-14` worktree BEFORE any change:
**514 suites / 6493 passed / 12 skipped / 6505 total / 0 failed**. After:
**517 suites / 6520 passed / 12 skipped / 6532 total / 0 failed** — +3 suites,
+27 tests, **skipped count unchanged**, no legacy suite broken.
`npx tsc -p . --noEmit` and `npx tsc -p tsconfig.test.json --noEmit` both
clean; `npx eslint` clean on every changed file (the ADR-16 seam rule is
untouched — `entityService.ts` gained no imports).

**Mutation battery: 27/27 caught**, each anchored to a production line with a
named witness. The ones worth recording: "a failed pull emits anyway",
"`link` instead of `linkExclusive`" (the pointer stops moving), "derive the
`site` role instead of traversing" (the id freeze), "derive an entity from an
unresolved install name" (A7's defect), "`observed_at` = start instead of
finish", "the failure banner reads as success", "the database-phase regex is
too broad", "a listener's throw propagates into the sync", "the mirror's
`has_environment` write is dropped" (parity), "the health SLO's `system`
stops matching what the producer stamps" (the table silently going out of
date — WP-17's own failure mode), and "`linkExclusive` retires a `user_link`".

**Residual risk, stated rather than buried:** for a UI-initiated sync,
`includes_db` rests on Local's phase label. It cannot produce a false
positive (no other label in either service contains the word, and both are
strictly `if (includeSql)`-guarded), and a false negative leaves the content
pointer where it was — the copy reads staler than it is, never fresher. If WP
Engine changes that copy, the tell is a `full` flow becoming `code` on pulls
that clearly carried a database. The owner question about a "flow unknown"
value is in the scout note above.

**ABI state: better-sqlite3 is built for SYSTEM NODE** (jest ran here). Run
`npm run rebuild` before loading Local.

### [x] WP-15 · Divergence comparator + lineage-aware drift unification  **(DELIVERED 2026-08-17 — outcome + findings below)**

**ANNOUNCED 2026-08-17 — core lock held and released** (worktree `wp-15`,
branch `wp-15`, base 57ef222a). Baseline in-worktree BEFORE any change:
**527 suites / 6643 passed / 12 skipped / 6655 total / 0 failed.**

#### OUTCOME — all three parts, plus both folded one-liners

**1 · The comparator** — `src/intelligence/compare/divergence.ts`,
`divergence(copyEntityId, {ledger, twins, entities?, now?})`. Resolves the
upstream from the links, diffs `forEntity(copy)` against `forEntity(upstream)`
by fact key, reports **per flow with per-side freshness**, anchored on the last
`episodic.sync.*` event. `EntityService` gained two reads for it —
`linksOf(from, kind)` and `linksOfKind(kind)`; `environmentsOf` /
`workingCopiesOf` now delegate to the first and keep their published
three-field shape (a shipped `toEqual` pin caught the widened row on the first
run — parity is not only about tool output).

**Units are per flow, structurally, not by convention.** `ContentDivergence`
has no item field and `CodeDivergence` has no time field, so the docs' finding
№3 cannot be violated by a later "helpful" unification without deleting a type.
Content is an age because nothing in the twin substrate observes posts (finding
№5, honestly); code is items because plugins, themes and the WordPress version
are the things a pull or a push moves.

**Pair resolution, in evidence order:** `content_pulled_from` (an OBSERVED
pull, so it outranks any structural link however confident — a `user_link`
says two things belong together, not that content came from one of them) →
the Site's environments by `site_links` precedence, **minus the copy and minus
every other working copy** (which is what WP-14's `has_working_copy` edge is
for — `environmentsOf` alone would offer a colleague's sandbox as an upstream)
→ **decline**. Two equally-confident candidates return nothing: an unordered
first-row-wins over them is a coin toss whose losing side is a confident report
about the wrong production install.

**Three absences stay three answers** — no lineage at all, lineage but no
recorded sync, and a sync whose contents could not be determined. Each renders
differently because each has a different remedy; merging any pair discards the
only thing the user could act on.

**2 · The legacy enrichment** — `wpe_detect_drift` gains an APPENDED section
(audit A5: right measurement, wrong substrate). Legacy output survives
character for character, pinned with `startsWith`. The pair comes from the
links, not from `hostConnections`: a copy whose recorded pull points at staging
while Local's connection setting still names production is compared against
**staging**, with the legacy half of the same report still showing production —
the disagreement is the information. Copies the links know about that this
tool's own population never covered are named, never merged in (the
pattern's population-level drift-hint variant). Copy ids are derived PURELY
(`provisionalEnvironmentId`), so the enrichment cannot mint what it joins on.

**3 · The two folded one-liners.** The startup health summary logs at **WARN**
when something that counts is degraded (`healthLogLevel`, one line in
`index.ts`) — WP-18's finding 2: Local's main log shows warn and error only, so
the line proving the layer was alive at boot was invisible in the log people
read. And the Controlled Vocabulary is enforced **as a test**, scanning every
rendered line in every branch for reserved and internal words.

#### The judgment calls, recorded because they are not the literal reading

1. **`state.divergence.detected` is NOT emitted.** The packet allows it; the
   invariant "the comparator is read-side" forbids it. A read that writes
   produces events at a rate driven by *how often someone looks*, which is not
   a fact about the fleet — and the ledger records change, not observation. The
   change gate cannot rescue that: it dedups repetition of a VALUE, while the
   thing being repeated here is the act of asking. Consequence, stated so it is
   not discovered later: there is no `divergence` liveness line in WP-17's
   table, correctly, because there is no producer.
2. **"WARN when any line is not OK" is implemented as `worst !== 'OK'`**, which
   excludes `countsTowardWorst: false` lines. Taken literally, the packet's
   wording would warn on every boot forever at any developer without a WP
   Engine account, because their never-observed producer lines are permanently
   DARK — inverting WP-17's ratified doctrine (never-observed ≠ degradation)
   and teaching the user to ignore the summary, which is how silence gets
   certified. Both directions are pinned, including a mutation that switches to
   the literal reading.
3. **The `'unknown'` flow ruling is delivered as a READER capability plus the
   union widening — `deriveSyncFacts` still classifies as it did.** The union
   in `syncProducer.ts` now carries `'unknown'` (the ruling's instruction) and
   the comparator normalises any unrecognised or absent value to it. What was
   NOT done, deliberately: making the producer emit it for an undeclared,
   no-database-phase sync. At that seam the flow genuinely IS determined —
   WP-14 established that the phase label is strictly `if (includeSql)`-guarded
   with no false-positive path, so an absent label means an absent database.
   Emitting `'unknown'` there would discard a sound inference to express a
   doubt the seam does not have, and would relabel every ordinary files-only
   pull as undetermined. The reader branch is not dead: it is what lets an
   event from a future, foreign or truncated producer render without guessing.
   **If the architect intended the producer half too, it is one line in
   `deriveSyncFacts` plus its pin — flagged rather than taken.**

#### Findings

- **A shipped read's row shape is part of its contract.** Consolidating
  `environmentsOf`/`workingCopiesOf` onto `linksOf` added an `at` field to
  their rows — invisible to every consumer, fatal to `entityService.test.ts`'s
  `toEqual`. The test was right: a widened row IS an output change. The two
  named traversals now strip it.
- **A forbidden-word list exported from production and imported by the test
  that enforces it is not a gate.** Deleting a word from it makes the test
  pass. The vocabulary list was moved INTO the test, which owns its own oracle.
  Worth generalising: any test whose expectations are imported from the module
  under test can only ever assert self-consistency.
- **A poisoned ts-jest transform cache reported a failure that did not
  exist.** `tests/intelligence-evals/sitting.test.ts` failed to parse in this
  worktree (shebang in `sitting.ts` reaching the sandbox untransformed) while
  passing in the primary checkout and passing here under `--no-cache`;
  `npx jest --clearCache` fixed it permanently. Recording it because the
  protocol tells agents to baseline counts in the worktree and diff them — and
  this is a way for that diff to lie in BOTH directions. If a suite fails in a
  fresh worktree and nothing you touched can explain it, clear the cache before
  diagnosing a regression.
- **One vacuous pin, caught by the battery and fixed.** The per-side freshness
  assertion gave every fact on a side the same timestamp, so "stalest" and
  "freshest" were the same value and inverting the reduction survived. The
  fixture now holds two ages per side. (Fifth entry for the
  `feedback_vacuous_guard_shapes` family: *a fixture in which two different
  reductions cannot disagree*.)
- **`plugins_only=true` with no plugin differences returns before the
  enrichment.** The legacy tool early-returns "No drift detected across linked
  sites"; the appended section therefore does not render on that path, so a
  copy that is in sync on code and sixty days behind on content says nothing
  there. Left as is: `plugins_only` is a request about plugins, and the default
  path (every non-filtered call) always renders. Named rather than left to be
  discovered. The same is true of the "No local sites are linked to WP Engine
  installs" early return, where the links may know of pairs Local's own
  settings do not.

#### Pins

**20** in `divergence.test.ts`, **10** in `divergenceReport.test.ts`, **5** in
`detectDriftEnrichment.test.ts`, **+1** in `health.test.ts`. The ones that
carry the packet: a comparison leaves `entities`, `entity_aliases`,
`entity_links`, `events` and `twin_facts` row counts unmoved (including for an
entity id the ledger has never seen — the case most likely to tempt a
derivation); the newest sync is the anchor and a push never moves the content
one; a files-only pull is not a content pull; the three absences render as
three different sentences; content lineage outranks a more-confident structural
link; a tie declines; a sibling working copy and a copy carrying only the
pre-WP-14 `has_environment` edge are both excluded from candidates; an
incomparable version pair is `changed`, never a direction; `site.core` is
compared field by field so identity and PHP never read as code differences; the
legacy report survives character for character; and no rendered line in any
branch contains a reserved word or an entity id.

**Mutation battery: 33/33 caught**, each anchored to a production line with a
named witness (34 runs — M16 SURVIVED first, exposing the vacuous fixture
above, and was re-run green after the fixture was fixed). Worth recording:
"the comparator ensure()s while resolving" (the id freeze), "`link` ordering
by confidence ASC" (site_links precedence inverted), "a tie picks the first
row", "behind and ahead inverted", "the WordPress version compared as PHP",
"the enrichment is prepended" (parity), "the compared site is named from the
caller instead of from what was observed", and both directions of the health
log level.

**Unpinned by construction, disclosed:** the `src/main/index.ts` call site
itself (no unit harness for `index.ts` — the same survivor WP-17 disclosed and
WP-18's e2e journey owns; the decision it calls, `healthLogLevel`, is pinned
both ways). Nothing else in this packet is unpinned.

**Counts.** Baseline **527 suites / 6643 passed / 12 skipped / 6655 total / 0
failed**. After: **530 suites / 6679 passed / 12 skipped / 6691 total / 0
failed** — +3 suites, +36 tests, **skipped unchanged** (so the delta is new
tests, not artifact-gated drift). `npx tsc -p . --noEmit` and
`npx tsc -p tsconfig.test.json --noEmit` both clean; eslint clean on every
changed file. The ADR-16 seam rule was probed live on the new core file
(an `electron` import in `divergence.ts` produced the `no-restricted-imports`
error, then reverted).

**ABI: better-sqlite3 is built for SYSTEM NODE** (jest ran here, repeatedly).
Run `npm run rebuild` before loading the addon in Local. Measured in this
session: system Node **v25.9.0 → ABI 141** (`.nvmrc` still pins 22.16.0 → ABI
127 for CI).

*Original packet text:*
Cross-entity divergence (copy twins vs upstream twins) is a new READ-side
comparator, not a fold change: `divergence(copyEntityId)` resolves
upstream(s) via WP-14's links, diffs `forEntity(A)` vs `forEntity(B)` by
fact key (compare-sites proves the pair-diff), reports per-flow with per-side
freshness, anchored on "since the last sync event at T" (WP-14's zero
point). Optionally emits `state.divergence.detected`. Then enrich the
legacy `wpe_detect_drift` (right measurement, wrong substrate — it joins
graph caches by hostConnections install-name) with the comparator's output
as APPENDED enrichment per the reader-migration pattern; do not change its
legacy output. DriftNotice stays single-entity; shipped folds untouched.

### [x] WP-16 · verify_site_live identity fix  **(DELIVERED 2026-08-16 — outcome + findings below)**
**Outcome:** delivered as specified, both halves.

*verify_site_live* — resolution is now a ladder, and only its last rung writes:
sanctioned aliases (`wpe.install_name`, then `wpe.install_id` on the same value,
because callers address installs by name OR UUID) → the twin name-match →
derivation. `resolveIdentity`/`sanctionedHandles`/`resolveEnvEntity` carry it;
`resolve()` is a READ, so a target the ledger already knows can no longer gain a
second entity. **External targets got the same shape, and they had the same
defect**: the tool keyed them by the bare SSH ALIAS, while every producer keys
them by the graph row id `ssh:<alias>/<site>` — so `ssh_target` is now parsed
back to that row id (`externalRowId`) and resolved through
`graph.site_row`/`local.site_id`. The bare `ssh:<alias>@<env>` form has no row
id to recover and still falls back to the alias, as before.
The **`site` role is now omitted rather than fabricated** when the producers'
key is not in hand (a WPE install resolved through an alias yields no graph row
id, and the entity service has no env→Site traversal). A7 named the name-derived
`site` stamp as half the defect; absent is honest, wrong is not. Local and
external keep stamping it, unchanged.
The pre-WP-16 twin-match guard is preserved *verbatim* but computed through the
PURE `provisionalEnvironmentId`, so the losing branch no longer registers an
entity on the way past.

*chatAssembly* — `resolveTargets` returns the `{role:'site'}` target alongside
the environment; assembler untouched.

**Pins** (8 in `verifySiteLive.test.ts`, +1 in `chatAssembly.test.ts`, all six
production mutations caught): row-id ≠ install-name lands on the mirror's entity
with `COUNT(*) FROM entities` unmoved; install-id addressing; external row-id
resolution; twin-match still rescues a pre-mirror target and mints nothing; a
same-named STRANGER never outranks the target's own entity (seeded to sort first
in `TwinStore.search`'s entity-id order, with that ordering asserted so the test
cannot go vacuous); and the parity pin — a target the layer has never seen still
records, under exactly the pre-WP-16 id.

**Finding — the A3 fix duplicates episodic lines, measured, unfixed.**
`collectEpisodic` iterates targets and `Ledger.query`'s entityId filter matches
ANY role, so an event stamped with BOTH roles (every producer dual-stamps) is
now retrieved twice and rendered twice in the turn block — same event id, two
identical lines. Measured directly: 1 dual-stamped event → 2 lines. Nothing
fails, no test asserts it, and Site-scoping genuinely works (an event on a
sibling environment now reaches the turn, which is pinned). But it is an output
change to a shipped surface, it doubles the episodic token spend on the common
case, and the honest reading of "additive" does not stretch to duplicated rows.
**The fix is one line in the assembler** (dedupe episodic by event id in
`collectEpisodic`, or key the whole retrieved list by `store+id`) — deliberately
NOT taken here: `src/intelligence/` is the serialized core lock, the packet says
"assembler unchanged", and A3 already schedules per-plane routing
(freshness→copy, episodic→Site) for M3, which subsumes it. Owner call: take the
one-line dedupe now, or ride it to M3.

**Finding — the reconciliation's namespace table is prose, not a table.**
`reconciliation-entity-identity.md` names the four namespaces in a bullet under
"Consequences for the code"; the audit (A7) is what states which ones a WPE env
may be addressed by. Nothing in either doc says what an EXTERNAL host's
sanctioned namespace is — it is `local.site_id` (i.e. graph `sites.id`) only by
reading `graphBackfill` and `externalSiteStore.externalSiteId`. Worth one real
table in the doc before another packet re-derives it.

**ABI: better-sqlite3 is built for SYSTEM NODE** (jest ran here, repeatedly).
`npm run rebuild` is required before loading this in Local.
Measured in this session: system Node **v25.9.0 → ABI 141** (`.nvmrc` still
pins 22.16.0 → ABI 127 for CI).

*Original packet text:*
For WPE targets the tool derives `ensure('env','local.site_id',
<install NAME>)` — a WRITE registering a divergent entity whenever graph row
id ≠ install name; the emit path then stamps a name-derived `site` entity,
splitting history. Violates the entity-identity namespace table. Fix:
resolve through `core.entities.resolve(installName, 'wpe.install_name')`
(and `wpe.install_id` where the id is at hand) BEFORE any derivation; keep
the twin name-match as the last fallback; same shape for external aliases.
Pin with a test where graph row id ≠ install name proving no new entity is
registered and observations land on the mirror's entity. ALSO in scope (one
line, audit A3): `chatAssembly.resolveTargets` additionally returns the
`{role:'site'}` target so episodic retrieval is Site-scoped — additive,
assembler unchanged.

### [x] WP-16b · Episodic dedupe in the assembler  **(DELIVERED 2026-08-16 — architect ruling on WP-16's finding)**
**Core lock announced and released 2026-08-16** (worktree `wp-16b`, branch
`wp-16b`, based on b230882c): `src/intelligence/assemble/assembler.ts` only.

**Ruling (architect, on WP-16's duplicate-lines finding):** duplicate lines in
the product's flagship surface, doubling episodic token spend on the common
case, is a shipped-output regression — it does not ride to M3. Reverting the
A3 half was rejected: Site-scoped episodic is real, pinned value. WP-16's
"assembler unchanged" was that packet's scope, not a standing lock.

**Outcome:** two lines in `collectEpisodic` — a `Set` of event ids spanning the
whole target loop, `continue` on a repeat. First occurrence wins, so
newest-first within the first matching target is preserved and nothing is
reordered. The per-target `RetrievalRecord`s are deliberately **not** deduped:
they record what each query asked and what it returned, which stays true, so
the manifest still answers "what was asked of the ledger this turn" even though
the bundle carries the event once. That asymmetry is commented at the code.

**Pins** (3 in `assembler.test.ts`): a dual-stamped event is retrieved once and
rendered once, with both ledger RetrievalRecords still present and the surviving
item carrying the FIRST target's entityId; distinct events across targets are
all kept in returned order (the pin that stops a coarser dedupe key); and
WP-16's sibling-environment pin in `chatAssembly.test.ts` stays green — the
Site-scoped value A3 wanted is intact.

**Mutations, all caught:** dedupe removed (2 fail); dedupe scoped per-target
instead of across targets (2 fail); deduped by `topic` instead of event id — the
over-collapsing shape — (1 fail, the distinct-events pin).

**Item (2) — episodic.* reachable from the wired surface (WP-13 finding 4).**
Took the architect's "or better": `collectEpisodic` now takes a topic-prefix
LIST, defaulting to `['state.', 'episodic.']`, one query per (target, prefix).
`chatAssembly` needs no change and got none — a surface that asks for nothing
gets the history. `AssembleRequest.retrieval.episodicTopicPrefix` widens to
`string | string[]`; the shipped single-string form still narrows exactly as
before. The limit is PER QUERY, so a busy `state.` family cannot crowd out the
incident history. Pinned at both levels, per the packet: the core pin (defaults
query both families, in order; an explicit string or list is honoured) and the
one that matters — **a planted `episodic.incident.recorded` event reaching the
turn block through the REAL wired path** (`chatAssembly.test.ts`). Mutations:
default narrowed back to `['state.']` → 4 fail across three suites; explicit
prefix ignored → 1 fail.

**Item (3) — the harness reconciled with the respelled spec. It was bigger than
a wording pin, and the branch was RED on arrival.** The architect's E-02
respell landed in the YAML without its code side, so `poc/nexintelligence` had
**10 failing tests** when this worktree merged it — WP-13's own design working
as intended (an unmapped criterion is BLOCKED, never green), but red is red.
Fixed: three `matches:` selectors in `checks.ts` respelled (they must equal the
criterion text); the E-02 SPEC-DEFECT finding **retired** from `SPEC_FINDINGS`
with a comment saying why, per WP-13's rule that a fixed finding is retired
rather than left to rot; `specLoader.test.ts`'s colon-carrying criterion; and
the defect-count pins (2 → 1, plus an explicit "E-02 has no findings, B-03 has
one"). The architecture-doc QUOTE inside `checks.ts` was left verbatim — it
cites §7, which still spells it the old way (see finding below).
**E-01's check was rewritten, not just repinned:** its prose claimed the
criterion was "unsatisfiable from the wired surface", which item (2) made
false. It stays BLOCKED — on the half that remains, that no code in `src/`
emits any `episodic.*` event at all (finding 5 → WP-14) — and its evidence now
carries the measurement showing retrieval works. Leaving the old prose would
have been the harness lying in the owner's report.

**Finding — `architecture.md` disagrees with itself on the task taxonomy.**
§4.2's table (line 151) has the three-segment `task.action.executed`; §7 (line
323) still reads "the gateway emits `task.action_executed` for every call".
The WP-11 respell ruling was applied to the table and not to the prose. Not
fixed here (docs need owner approval, and `checks.ts` quotes that line
verbatim as its unblocked-by citation) — but the next reader of §7 will
implement a topic the validator refuses.

**Finding — the E-01 probe was measuring WP-16's duplicate.** Its pin expected
`episodicTopicPrefix="episodic." retrieved 2 ledger item(s)` from ONE planted
event, because the probe uses both an environment and a Site target. WP-13
wrote that pin against the duplicated behaviour a day before it was named as a
defect; it now reads 1. Worth knowing that the harness had already captured
the duplication as expected output without anyone reading it as a bug.

Full suite **509 suites / 6408 passed / 12 skipped / 0 failed** (up from a red
base: 10 failing before this packet). Legacy parity suite
`tests/unit/chat/chat-assembly-wiring.test.ts` (13, incl. the additive-parity
pins) green and untouched. **ABI: system Node** (v25.9.0 → ABI 141) — `npm run
rebuild` before loading in Local.

### [x] WP-17 · Intelligence health surface + degradation tests  **(robustness track — would have caught the M1 silent-init incident)**  **(BUILT 2026-08-17 — outcome, SLO justifications and findings at the end of this file)**
The layer is non-fatal by construction, which converts real failure into
SILENT absence: the M1 ABI incident ran for hours with green tests, a working
app, and a dark ledger. Fix: the layer monitors itself with its own
machinery. Read `docs/intelligence/TESTING_STRATEGY.md` first.
Build: (1) `nexus_intelligence_health` MCP tool (Tier 1, read-only) + a
startup log line, reporting: core init state (incl. the LAST init failure
reason if any — persist it in storage so a failed boot is visible from a
succeeded one); per-producer last-emission age vs a producer-liveness SLO
(wp-webhook, graph-sync, graph-sync:wpe, fold, task.* — one ledger GROUP BY);
fold lag (ledger head id vs fold cursor); `law.verifyMirror()` divergence
count; entity service present; assembler last-manifest age. Each line:
value, SLO, OK/STALE/DARK verdict. (2) Degradation tests (the chaos half):
corrupt ledger file → addon unaffected AND health reports DARK with reason;
entity service throw → core up, health degraded; simulated ABI failure path.
The non-fatality claims move from comments into pinned tests.
Serialized (core lock) for the health internals; the tool file itself is
parallel-safe. Liveness SLO values are owner-tunable constants beside
DEFAULT_FRESHNESS_SLOS — propose defaults, escalate none.

### [x] WP-18 · MCP-driven e2e harness + real-ledger replay  **(robustness track; codifies the live smokes)**
Every real incident this project caught was found by hand-driving the MCP
surface of a RUNNING Local instance. Codify it. Read
`docs/intelligence/TESTING_STRATEGY.md` first.
Build: (1) `tests/e2e-intelligence/` — a runner that connects to the local
MCP endpoint (scout how tests/e2e-cli connects; reuse its transport) and
executes journeys against the live addon: `find_sites_with_plugin` renders
enrichment with real ages; `verify_site_live` on a running site reconciles
and emits; `nexus_intelligence_health` (WP-17) reports all-OK; one chat turn
via the docked-panel path writes a `task.context.assembled` event (drive via
the health tool's manifest-age check if driving chat directly is
impractical — scout and say). NOT in `npm test`; its own script
(`npm run test:e2e:intelligence`), documented as requiring Local running,
skipping with a LOUD banner otherwise (never a silent green). (2)
Real-ledger replay: a script that copies the live ledger.db (read-only),
rebuilds all folds from event 0 into a temp twin store, and asserts
invariants — no throw, monotonic ids, twin counts within sanity bounds,
every drift event well-formed. Run manually / pre-release; document the
one-liner. Parallel-safe; no production code changes (WP-17's tool is a
dependency for one journey — sequence after it or mark that journey
pending).

**OUTCOME (2026-08-17, merge below).** Delivered in `tests/e2e-intelligence/`.
Zero production edits; the only non-test change is three npm scripts.
Baseline 514 suites / 6493 passed / 12 skipped → **524 / 6616 / 12** (+10
suites, +123 pins, skipped unchanged). Mutation battery **19/19 caught** —
18 behaviourally, 1 (the layout guard's forbidden-list) only as a ts-jest
compile error, labelled as the weaker witness it is rather than counted as
a behavioural catch.

*Ran live during development, against a running Local: all four journeys,
26/26.* Verified by measurement, not by inspection — journey 2 moved the
ledger 9,332 → 9,384 events and `live-recheck:local` appeared in the health
tool's "Other sources" line; journey 3 rendered 30-odd rows carrying real
ages and trust classes. Nothing is delivered untested-live. The loud-banner
path was verified the same way, by running the suite with Local down: fenced
banner, **exit code 2**, remedy named.

**Findings, both from running it for real, both folded back in as pins:**

1. **Drift events carry two different actor ids.** 328 of 365 are
   `act_fold_plugin_twin` at schema `drift.detected/1`; 37 are
   `act_fold_state_twin` at `/2`. The actor id was renamed alongside the
   schema bump while `source.system` was already `fold:state-twin` in both.
   A checker knowing only today's id reports a developer's entire drift
   history as malformed — a false RED on real data, the one failure mode a
   layer-6 check must not have. Now a SET of known fold actors; an unknown
   actor is still flagged.
2. **Local's `local-lightning.log` carries warn/error ONLY.** WP-17's health
   line is `logger.info`, so `local-lightning-verbose.log` (in
   `~/Library/Logs/`, not Application Support — the latter had been dead
   since May) is the only file it ever reaches. The first locator produced a
   false RED against a working wire. Both families are searched now, verbose
   first, and the journey names every path it looked in. *The line itself is
   confirmed present and OK across every check — WP-17's wire works; it was
   simply unobservable from where anyone would first look.*

**The determinism claim is now tested against real data and holds.** 9,472
events · 9,100 state observations · 371 drift · 6,335 twin facts over 386
entities, replayed from event 0 into a temp store: **identical to live**,
value, `observed_at`, trust and provenance pointer alike. Proven
non-vacuous by mutation — perturbing one replayed fact out of 6,335 flips
the run to FAIL and names it.

**Scouted and reported rather than worked around: the chat turn cannot be
driven headlessly.** `assembleForChatTurn` has exactly one caller,
`ChatService.sendMessage`, reached only from the `CHAT_SEND`
`ipcMain.handle` channel. No GraphQL mutation (nothing chat-shaped in
`schema.ts`), no `nexus chat` CLI command, no MCP tool — `tests/e2e-cli`'s
own chat suites already say as much. Driving it would mean adding a
production seam whose only consumer is a test, on a zero-production-edit
packet. Journey 4 therefore uses the sanctioned fallback (the health tool's
manifest-age line) and states in its own header what it does NOT prove:
that *this run* produced a manifest. Closing that gap needs a drivable chat
seam and is a future packet's call, not something to fake here.

**Two mechanisms keep the journeys out of `npm test`**, because one is a
config nobody re-reads: the root config never loads this jest config, AND
journeys are named `*.journey.ts`, which jest's default `testMatch` does not
collect. `layout.test.ts` pins both, plus "no journey imports
better-sqlite3" (they run while Local holds the Electron-ABI build) and "no
`lib/` directory here" — the root config ignores every path containing
`/lib/`, so pins placed there would collect silently zero tests. That last
one cost this packet a puzzled minute before it became a pin.

**Amendment for the protocol, not just this packet:** a guard that greps a
file for a forbidden string will fire on the COMMENT explaining the rule.
The first version of the SQLite guard did exactly that. It now parses import
specifiers, and has its own three pins proving the scan finds imports,
ignores prose, and catches a real offender. Same family as the mutation
rules' "a mutation can land in a comment quoting the code".

---

**ARCHITECT ADJUDICATION — WP-16 (appended by the architect session).**

- **WP-16 ACCEPTED.** Merge 74872669: receipt matches scope (assembler.ts
  untouched per constraint). Both beyond-the-letter extensions are ratified:
  the external-target fix is exactly the "same shape" clause doing its job,
  and **omit-rather-than-fabricate for the site role is endorsed as
  doctrine** — it is the honest-null principle applied to identity. The
  resolve-before-derive ladder (sanctioned aliases → twin name-match →
  derivation, only the last rung writes) is the reference shape for any
  future reader that must map a user-supplied name to an entity.
- **Episodic-dup escalation ruled: Option 2 — dedupe now (WP-16b, below).**
  Duplicate lines in the product's flagship surface with doubled token
  spend on the COMMON case is a shipped-output regression, not cosmetics;
  the fix is one keyed pass; M3's routing subsumes it later without
  conflict. Option 3 rejected — Site-scoped episodic is real, pinned value.

### [x] WP-16b · Dedupe episodic retrieval by event id  *(micro-packet, core lock; from WP-16 escalation)*
**DELIVERED before this stub was registered** — the packet was executed from
the chat-relayed ruling; full outcome in the WP-16b entry earlier in this
file (merge 7c7be587). This stub is retained per append-only discipline and
ticked by the architect; the earlier entry is authoritative.
`collectEpisodic` iterates targets; dual-stamped events (all producers
dual-stamp) are retrieved once per matching target and render twice. Fix in
`src/intelligence/assemble/assembler.ts`: dedupe the episodic result set by
event id across targets (preserve newest-first order; first occurrence
wins). Pins: (1) a dual-stamped event renders exactly once; (2) the
sibling-environment event still reaches the turn (WP-16's pin stays green);
(3) additive parity (null/empty bundle) untouched. Announce the core lock;
smallest possible diff; suitable for the WP-16 agent as a continuation.

---

**ARCHITECT ADJUDICATION — WP-13 + two escalation rulings (appended by the
architect session).**

- **WP-13 ACCEPTED.** Merge 75f5f06b. The five-verdict design with
  "unmapped criterion is BLOCKED, never green" is endorsed as the harness's
  founding rule; the YAML quoting fix is ratified per the pii.ts precedent
  (spec text byte-identical, revert is two hunks); the mid-flight
  correlation:undefined fix and the two self-skeptical mutations
  (manufactured-finding guards) are noted as exemplary.
- **ESCALATION 1 RULED — B-03 exits the M2 gate.** The circularity is real:
  WP-11 gated procedure/tool population ON B-03 while its adjudication made
  B-03 an M2 gate — both cannot hold, and the runner proved it empirically.
  B-03 becomes the ACCEPTANCE EVAL of the future procedure-population
  packet (deferred surface, post-M3 task frame). **M2's close is redefined
  as: the runner merged (done) + E-01/E-02's executable criteria PASS +
  the owner sitting clearing the 6 OWNER-PENDING criteria.** The WP-11
  adjudication's milestone-DoD line is superseded on this point.
- **ESCALATION 2 RULED + EXECUTED — E-02's four task.* topics respelled**
  to the three-segment forms (context.assembled, action.executed,
  outcome.recorded, rationale.recorded), same principle as the WP-11
  ruling; note appended in the spec file. runner.test.ts's wording pin
  will need the matching one-line update — fold into WP-16b (below).
- **Finding 4 (E-01 history unreachable from the wired surface) → folded
  into WP-16b:** chatAssembly passes no episodic retrieval config, so the
  wired default prefix ('state.') can never retrieve episodic.* history.
  WP-16b gains item (2): include episodic.* in wired retrieval (pass
  episodicTopicPrefix from chatAssembly, or better: teach collectEpisodic
  to take a topic-prefix LIST defaulting to ['state.','episodic.']) with a
  pin that a planted episodic event reaches the turn block through the
  REAL wired path; plus item (3): update runner.test.ts's E-02 wording pin
  for the respell. Same core lock, same sitting.
- Finding 5 (no episodic.* producer) is already WP-14's charter —
  no action.
- Housekeeping commits a3abcae2 / 42a58f26 / b230882c verified attributed —
  the protocol's verbatim-commit practice, third exercise, working as
  written.

---

**ARCHITECT ADJUDICATION — WP-16b (appended by the architect session).**

- **WP-16b ACCEPTED**, on independent verification rather than the report's
  word (code read at the cited lines; both mutations re-run against the
  production lines with the tree restored clean; parity suite confirmed
  untouched). All three ruled items present. The deliberately un-deduped
  per-target RetrievalRecords (manifest keeps per-target accounting while
  the rendered lines dedupe) is accepted as the right asymmetry — the
  manifest is audit, the turn block is UX.
- The duplicate-registration inconsistency was the architect's own (the
  packet was executed from the chat-relayed ruling before the stub landed);
  stub ticked with a pointer, earlier entry authoritative. Process note:
  a chat-relayed ruling IS a registration — the doc stub is confirmatory,
  and a delivered packet beats a pending stub.
- **M2 status: all code gates met.** Remaining: the eval report run
  (`npx ts-node tests/intelligence-evals/run.ts`) + the owner sitting over
  its OWNER-PENDING criteria. M2 closes at the sitting's conclusion.

---

**ARCHITECT NOTE — first full eval report adjudicated (2026-08-17).**
Report tally 2 PASS / 0 FAIL / 19 BLOCKED / 6 OWNER-PENDING / 1 spec-defect.
Zero regressions; WP-16b's fix is VISIBLE in the report (wired retrieval
reaches planted episodic history — measured, not assumed). The one
spec-defect is the already-ruled B-03 circularity; the B-03 spec now carries
the ruling inline, and the probe update is folded into WP-19.
**M2 close-out, final definition:** zero FAIL (met) + the owner sitting
clears the 6 OWNER-PENDING criteria + every BLOCKED criterion maps to a
REGISTERED packet. The last condition required two registrations (below):
the report's "gateway packet" and "procedure packet" were load-bearing
names with no packet behind them. With WP-19/WP-20 registered, the BLOCKED
map is total: 11 → WP-20 · 7 → WP-19 (one shared with WP-18) · 1 → WP-14.
Also noted for the backlog: an incident producer proper (episodic.incident.*
from sentinel/diagnose flows) has no packet; candidate to fold into WP-19's
outcome emission or register separately when M3 planning firms.

### [x] WP-19 · Gateway emission — task.action/outcome/rationale events  *(M3; DELIVERED 2026-08-17 — outcome, judgment calls, findings below)*
Architecture §7's "the gateway emits task.action_executed for every call",
made real against the respelled taxonomy. Scope: (1) emit
`task.action.executed` at the `ToolRegistry.call` chokepoint for gated
(Tier 2+) calls — actor.id + actor.via per ADR-14, correlation = the turn's
TaskId (thread it from chatAssembly's manifest; scout the cleanest seam) —
AND cover the contributed-tools bypass (`agent__*` dispatch skips the
registry; recon-ask-tell.md documents the gap); (2) `task.outcome.recorded`
per completed gated action (result, per-target where applicable); (3)
`task.rationale.recorded` v0 — the approval-card text + tool args as the
minimal honest rationale, upgraded when the procedure packet lands; (4)
causation chaining approval → actions where the approval flow allows; (5)
update the eval runner's B-03 spec-defect probe to recognize the recorded
ruling (spec annotation + WP-13 adjudication). Core-lock-adjacent
(ChatService/registry seams) — announce. The E-02 BLOCKED criteria are the
acceptance evals: re-run the runner and report the flips.

### [ ] WP-20 · Procedure distribution — runbook rides the capability  *(M3/M4; B-03 is its acceptance eval)*
Populate `ContextBundle.procedure` (runbook at the hash pinned on the
grant, ADR-17 format from `law/`'s loader — runbook kind already loads) and
`ContextBundle.tools` (ToolGrant[] scoped per the runbook, NexusToolProvider
allow-list shape per recon §2.4) for granted capabilities. Fail-closed per
ADR-7 where the actor is autonomous. Gated design questions (capability
recognition, grant surface) go through the owner BEFORE build — this packet
starts with a design note, not code. **B-03's eleven criteria are the
acceptance evals**; the anchor-slice DoD completes when they pass at
pass^3. Depends: WP-19 (its events are half of B-03's evidence), the M3
task frame recommended first.

---

**ARCHITECT NOTE — sitting executability finding (2026-08-17).** The
OWNER-PENDING instructions ("point a dev build at the fixture dataDir, open
the Docked Panel with a fixture site selected") are not literally
executable: the fixture seeds the LEDGER only; fixture sites do not exist
in Local's site store, so the panel cannot select them, and without a
fixture target the assembler never retrieves the planted history. Caught
before the owner ran the sitting. The bridge is transcript capture — the
existing integration-harness shape (real ChatService + fixture services)
extended to a live model call. Registered as WP-13b; the sitting becomes
"read six transcript sets and judge," which is also more repeatable than
manual panel-driving (and pre-builds half of WP-18's journey machinery).

### [x] WP-13b · Sitting harness — live-model transcript capture over the eval fixture  **(BUILT 2026-08-17 — outcome, findings and ONE blocked item below)**
Build `tests/intelligence-evals/sitting.ts` (invoked via ts-node, NEVER in
npm test — it spends real API tokens): construct the WP-13 fixture core
(`createEvalFixture`), build a fixture `NexusServices` around it (the
integration suites — `chatAssembly.test.ts`, `siteFinderTwins.test.ts` —
show the mock shape; fleet tools should answer from the fixture twins),
instantiate the REAL `ChatService` with a REAL provider key (read from the
owner's existing key storage or an env var — scout; never hardcode), select
the flagged fixture site as `siteId`, and send E-01's verbatim prompt.
Capture the FULL transcript (system prompt, turn block, tool calls +
results, model output) to `/tmp/wp13-sitting/run-<n>.md`, three runs per
H-01. Print the six judgment criteria beside the transcript paths. Honest
bounds stated in output: this drives the real assembler + real chat loop
with fixture tools — it is NOT the full product UI (approval cards render
as text); say so in every transcript header. Escalate if ChatService
cannot be constructed against fixture services without production edits —
do not modify src/ in this packet. Parallel-safe (new file in the evals
tree). Acceptance: three captured transcripts where the tool trace shows
the planted incident retrievable, ready for owner judgment.

**WP-13b OUTCOME — the harness is built, tested and executable. The three live
transcripts are NOT captured, for one reason: no provider key was available to
this session.** Everything else the packet asked for is delivered and pinned.

**Delivered** (three new files, evals tree only, zero `src/` edits):

- `tests/intelligence-evals/sitting.ts` — the CLI. Real `ChatService` against a
  fixture `NexusServices`, E-01's verbatim prompt, the history-flagged fixture
  site (`evalfleet-bravo`) as `siteId`, `--runs` (default 3, H-01's pass^3),
  `--out` (default `/tmp/wp13-sitting`), `--empty-history`, `--provider`,
  `--model`, `--approvals`, `--help`.
- `tests/intelligence-evals/sittingWorld.ts` — the fixture world: the fixture
  services, the real `ToolRegistry` loaded with four fixture-backed handlers,
  and the empty-history twin.
- `tests/intelligence-evals/sitting.test.ts` — 40 pins.

**ChatService constructs against fixture services with no production edits** —
the packet's escalation trigger did not fire. Two things made that true and are
worth carrying forward: `buildSystemPrompt` reads `indexRegistry.get()` OUTSIDE
its try/catch (an absent handle is a TypeError that kills the turn, not a
degradation), and `getSession()` is likewise unguarded, so `graphService` must
be absent rather than partial.

**The system prompt and turn block are captured by wrapping the provider
INSTANCE's `streamChat`, not by re-calling the assembler.** They are built
inside `ChatService` and never exposed, but every one of them is passed to the
provider. So the transcript records what the MODEL was sent — better evidence
than a second `assemble()` call, which would also emit a second
`task.context.assembled` manifest and make the ledger lie about the turn.

**FINDING 1 (the important one) — the turn block names the incident and carries
none of its substance.** Measured, verbatim, through the real wired path:

```
- 30d ago — episodic.incident.recorded (via fixture:e01-incident, trust: emitted) — evt_01M06VMJQZA3EW426EPW1T9W15
```

Topic, age, provenance, event id. NOT the component, the symptom, the versions,
or the gateway-X correlation — all of which ARE in the event payload.
`renderRetrieved` renders a ledger item's detail from `factKeyOf(e.payload)`,
which reads only `payload.fact ?? payload.slug ?? payload.name`; the incident
payload carries `component`, `from_version`, `to_version`, `impact`, `correlate`
and `resolved`. None of those three keys.

Consequence for the sitting, which the harness prints before the criteria so it
cannot read as model failure: **two E-01 criteria are in direct tension on this
substrate.** "the user is told the specific historical finding in plain
language" cannot be satisfied from what was retrieved, and a model that names
WooCommerce, checkout or gateway X as the incident is fabricating — which is the
`must_not` immediately below it. Sequencing gateway-X sites last remains
reachable, but only as inference from the plugin inventory, not from history.
This is the same class as WP-13's finding 4 (retrieval reached the ledger;
what it renders is a second, separate gap) and wants an owner ruling — the
minimal fix is widening `factKeyOf`, or giving RetrievedItem a payload-summary
channel. `sitting.test.ts` pins the finding, so when it is fixed that test
fails and the finding gets retired rather than left to rot.

**FINDING 2 — the owner's stored key cannot be used outside Electron, by
construction.** `chat-ipc-handlers.ts` reads it through
`KeyVault(registryStorage, STORAGE_KEYS.API_KEYS)`, which decrypts via Electron
`safeStorage` (OS keychain). Measured on this machine: `encrypted_anthropic.json`
holds a `v10`-prefixed Chromium OSCrypt ciphertext. `KeyVault`'s documented
no-safeStorage fallback treats a stored value as plain text, which outside
Electron would hand the API a base64 ciphertext and produce a 401 that looks
like a bad key. The harness therefore mirrors the product's lookup path exactly
and then **refuses** an Electron-encrypted value with the env-var remedy rather
than guessing. `NEXUS_EVAL_API_KEY` is the intended path and is pinned.

**BLOCKED — the three live transcripts.** No `NEXUS_EVAL_API_KEY` and no
`ANTHROPIC_API_KEY` in this session's environment, and per finding 2 the stored
key is undecryptable here. The owner runs, in this order:

```bash
# smoke: ONE model call, one transcript
NEXUS_EVAL_API_KEY=<key> npx ts-node --project tsconfig.test.json \
  tests/intelligence-evals/sitting.ts --runs 1 --out /tmp/wp13-sitting-smoke
# the sitting proper (H-01 pass^3)
NEXUS_EVAL_API_KEY=<key> npx ts-node --project tsconfig.test.json \
  tests/intelligence-evals/sitting.ts
# E-01's abstain twin — score the pair together
NEXUS_EVAL_API_KEY=<key> npx ts-node --project tsconfig.test.json \
  tests/intelligence-evals/sitting.ts --empty-history --out /tmp/wp13-sitting-empty
```

**What stands in for the missing live runs, and it is not nothing.** An
end-to-end pin drives the WHOLE harness — real fixture core, real ledger, real
producer and folds, real assembler, real `ChatService`, real `ToolRegistry` —
with only the model call scripted. It asserts that the planted incident reaches
the model in the turn block, that the system prompt and E-01's verbatim prompt
are there, that a tool call runs through the real registry and its full result
returns on the next iteration, and that the rendered transcript shows all of it.
So the packet's acceptance property ("the tool trace shows the planted incident
is retrievable") is **measured on every `npm test`, at zero cost**; what is
missing is only the model's own behaviour, which is the owner's judgement
anyway and was never this harness's to assert.

**Design decisions worth carrying forward:**

- **The tool surface is CLOSED — four fixture-backed handlers, and the service
  bag omits `localServices`, `graphService`, `searchService` and
  `operationAuditLog`.** What is absent is load-bearing: there is no path by
  which a tool could quietly answer from the owner's real fleet, start a real
  site, read persisted chat history, or append to the compliance record. A tool
  that lied about the fixture would not add noise, it would invalidate the
  judgement.
- **`bulk_plugin_update` is simulated and says so in its own result**, and tells
  the model not to re-verify. Applying the update would mean emitting
  observations mid-run, which makes the fleet's state depend on the fold
  debounce rather than on what the model did. The ARGUMENTS are the evidence
  the sitting needs — which sites, in what order — and they are captured.
- **`main()` is guarded by `require.main === module`, and a test pins the
  guard.** A regression there turns `npm test` into a metered API bill.
- **The judgment sheet supersedes the runner's OWNER-PENDING instructions and
  says why**, rather than printing both and leaving the owner to discover the
  Docked Panel route is not executable. Criteria, verdicts and judging
  instructions are lifted from `runEvals({only: 'E-01…'})` at print time, not
  copied — a spec edit that changes a criterion changes the sheet too.
- **Cost is stated twice and never invented.** A warning before the runs; after
  them, MEASURED prompt/output character counts with a `~4 chars/token` figure
  explicitly labelled as not a billed number (the chat providers do not surface
  `TokenUsage` on the `done` event).
- **`NEXUS_TELEMETRY=0` is set by `main()`** so a sitting never reaches the
  analytics worker. `telemetry-config.ts` reads the env at call time, so this
  works.

**Disclosure — the provider hardcodes `max_tokens: 4096` and sends no `thinking`
config.** On a thinking-by-default model that budget covers thinking AND the
response, so a long deliberation can eat the plan. That is the product's
provider, not the harness, and this packet may not edit `src/`. It is disclosed
in every transcript header, a `max_tokens` stop is called out loudly rather than
left looking like a short answer, and `--model claude-opus-4-8` (thinking off
when unset) is the documented comparison.

**Two follow-ups deliberately NOT taken** (both one-liners in `fixture.ts`,
which this packet may not edit; recorded in the tree's README):
`createEvalFixture({ plantIncidents?: boolean })`, which would collapse the
empty-history twin's mirrored ten-line seeding loop to a pass-through — the
fleet DEFINITION is already shared by import, so only the loop is duplicated,
and the halted-site absence is now pinned on both paths; and lifting
`nativeModuleRemedy()` into a shared module so `run.ts` stops inheriting a bare
`NODE_MODULE_VERSION` stack trace too.

**Verification.** Baseline in a fresh wp-13b worktree BEFORE any change:
**509 suites / 6408 passed / 12 skipped / 6420 total / 0 failed** — identical to
WP-16b's recorded figure. After: **510 / 6448 / 12 skipped / 6460 / 0 failed** —
+1 suite, +40 tests, skipped count unchanged, no legacy suite touched.
`npx tsc -p tsconfig.test.json --noEmit` and `npx tsc -p . --noEmit` both clean;
eslint clean on all three new files.

**Mutation battery: 12/12 caught**, each anchored to a production line with an
observable witness — secret scrubbing removed; the Electron-ciphertext guard
removed (key handed to the API as plaintext); a bad `--runs` silently clamped
instead of rejected; the provider wrapper restored by blanket `delete`; the core
registry never pointed at the fixture; the honest-bounds statement dropped; the
ABI remedy swallowed; BLOCKED criteria folded into the pending set; update
availability invented for every plugin; `--empty-history` planting incidents
anyway; the halted site given a fabricated inventory; and the update ORDER no
longer recorded. **Three of those twelve were MISSED on the first pass and the
misses were the point** — each was a weak pin, not a sound implementation: an
order assertion whose fixture list was already alphabetical, an
availability assertion whose mutation was inert for the slug it checked, and no
pin at all on the DUPLICATED empty-history seeding loop skipping the halted
site. All three pins were strengthened until the mutation was caught.

One real defect was found by these tests during development and fixed: the
provider wrapper's teardown used a blanket `delete`, which is correct only when
`streamChat` arrived from the prototype and silently destroys any own
implementation that was there first. It now restores exactly the own-property
state it found.

**ABI state: better-sqlite3 is built for SYSTEM NODE** (jest ran here,
repeatedly). Run `npm run rebuild` before loading the addon in Local.
Measured in this session: system Node **v25.9.0 → ABI 141** (`.nvmrc` still
pins 22.16.0 → ABI 127 for CI).

**Token cost of this session's own test runs: zero API tokens.** Every suite and
every mutation run scripts the model call; the live harness was never executed.

---

**ARCHITECT ADJUDICATION — WP-13b (appended by the architect session).**

- **WP-13b ACCEPTED.** Merge 601a9388 verified src/-clean on the owner's
  checkout; the escalation trigger never fired because ChatService
  constructs against fixture services unmodified. Three design decisions
  are endorsed as standing doctrine for eval harnesses: (1) the CLOSED tool
  surface where ABSENCE is load-bearing (no path to the real fleet, real
  history, or the compliance log); (2) capturing what the MODEL WAS SENT by
  wrapping the provider instance rather than re-calling the assembler
  (which would double-emit manifests and make the ledger lie); (3) the
  disclosed-and-honest mutation report — three first-pass misses named as
  weak pins and strengthened, which is the battery working, not failing.
- **FINDING RULED — the retrieved-substance gap (WP-13c, below).** The
  finding is confirmed at assembler.ts:260/288: `factKeyOf` renders only
  fact/slug/name, so an episodic item reaches the turn block as topic + age
  + id with NONE of its payload substance. The two-criteria tension is
  real: "plain-language finding" is unsatisfiable without fabrication on
  this substrate. **The sitting is POSTPONED until WP-13c lands** — running
  it now would judge the substrate, not the model. Ruling on the fix shape:
  a payload-summary channel on RetrievedItem (not a widened factKeyOf —
  fact-keying and rendering are different jobs; conflating them would leak
  arbitrary payload keys into fact identity).
- max_tokens 4096 + no thinking config on the product provider: recorded
  as a backlog item for the chat-provider surface (affects the product, not
  just the harness); candidate for the M3 surface review.
- Key finding (safeStorage ciphertext refused rather than 401-ing) is the
  right behavior; NEXUS_EVAL_API_KEY is the documented sitting path.

### [x] WP-13c · Episodic items carry their substance into the turn block  *(micro-packet, core lock; GATES THE SITTING)*  **(BUILT 2026-08-17 — outcome and findings below)**
Fix per the ruling: `RetrievedItem` gains an optional `summary` field;
`collectEpisodic` populates it for ledger items from a bounded, explicit
payload rendering (for `episodic.*`: component, versions, impact/symptom,
correlate, resolved — cap length; never dump raw JSON); `renderRetrieved`
includes it. `factKeyOf` unchanged. Pins: (1) the planted E-01 incident's
component + symptom + gateway correlation appear in the turn block through
the REAL wired path (the WP-13b end-to-end pin is the harness — extend it);
(2) sitting.test.ts's finding pin FAILS and is retired per its own design;
(3) additive parity (null/empty) untouched; (4) state.* items render as
before. ALSO in scope (both pre-approved, evals tree + fixture.ts):
the two WP-13b follow-ups — `createEvalFixture({plantIncidents})`
collapsing the empty-history twin's duplicated loop, and
`nativeModuleRemedy()` shared so run.ts stops inheriting bare ABI crashes.
Sequence: BEFORE WP-17 (both core lock); the sitting runs on its merge.

**ANNOUNCEMENT — WP-13c held the CORE LOCK on 2026-08-17 (released on
merge).** Worktree `.worktrees/wp-13c`, branch `wp-13c`. Files claimed:
`src/intelligence/assemble/assembler.ts` + `types.ts` (+ their `__tests__`),
and in the evals tree `fixture.ts`, `sittingWorld.ts`, `sitting.ts`,
`sitting.test.ts`, `run.ts`, `README.md`. Baseline in the fresh worktree
BEFORE any change: **510 suites / 6448 passed / 12 skipped / 6460 total /
0 failed** (identical to WP-13b's recorded post-merge figure).

**WP-13c OUTCOME — the gap is closed and the sitting is unblocked.** The
substance now reaches the model through the REAL wired path. Measured, from
the far end of `ChatService` (not from a second `assemble()` call):

```
- 30d ago — episodic.incident.recorded — woocommerce 9.3.0 → 9.4.1; checkout returned HTTP 500 after update; correlates with payment-gateway-x; resolved (via fixture:e01-incident, trust: emitted) — evt_01M07T0TCHV4WQXNY40QE8RJ3V
```

Compare WP-13b's measurement of the same line: topic, age, provenance, id.

**Delivered, exactly the packet's scope:**

- `RetrievedItem.summary?: string` (`types.ts`) — a channel of its own, next
  to `detail`, never inside it.
- `episodicSummary(topic, payload)` (`assembler.ts`) — gated on the
  `episodic.` topic family, composed from an explicit allow-list in a fixed
  order: `component`, `from_version → to_version`, `impact ?? symptom`,
  `correlate`, `resolved`. Absent fields are skipped; **strings only**
  (`resolved`: booleans only).
- `renderRetrieved` renders it after the fact key, before provenance.
- **`factKeyOf` is unchanged, byte for byte.**

**Three composition decisions worth carrying forward:**

- **The allow-list is the security property, and the discipline is about
  COMPOSITION, not delivery.** The envelope is schema-validated but its
  payload VALUES originated outside the process, and this string enters the
  model's context — a walk over unknown keys would let anything that can get
  an event emitted put arbitrary text in front of the model, inside a block
  the model is told is platform-authored. Hence: named fields only, strings
  only, **whitespace collapsed to one line** (a value carrying `\n- 0s ago —
  …` would otherwise fake a second retrieved item), hard caps. R7 covers the
  delivery; nothing covered the composing until now.
- **Two caps, not one.** Total 200 chars (~50 estimated tokens; ×8 per query
  it is the same order as the freshness section). Per field 80. The
  per-field cap is not redundant: with only a total cap, ONE verbose field
  consumes the budget and silently drops everything after it — including
  `correlate`, the field a fleet-wide sequencing decision actually turns on.
  A mutation proves it (#4 below): loosening the field cap alone loses the
  correlation while the total cap still "holds".
- **A lone version keeps its direction.** `from 9.3.0` / `to 9.5.0`, never a
  bare `9.3.0` beside a component name — which reads as the version it moved
  TO and inverts the fact.

**The topic gate needed its own pin, and this is a finding.** Removing
`topic.startsWith('episodic.')` was UNOBSERVABLE against the existing
fixtures: today's `state.*` payloads carry `slug`/`version`, none of them
allow-listed, so the gate changes nothing a test can see — until the day a
producer adds a field with a colliding name and state starts leaking into
the episodic block through a door §6.2 step 4 closed. The pin drives a
`state.plugin.observed` event whose payload DOES carry `component`/`impact`
and asserts no summary. Without it the gate would have been decoration.

**The WP-13b finding is retired, and so is the prose that stated it.**
`sitting.test.ts`'s pin failed on the first run after the fix — by its own
design — and now asserts the substance arrives. Two further surfaces
asserted the finding as present-tense fact and would have made every
captured transcript lie to the owner: the transcript's "read before
judging" section and the judgment sheet's two-criteria-in-tension note.
Both are rewritten. **The tension is gone: both E-01 criteria are now
judgeable as written**, and the standing check is unchanged — a historical
specific that is not on those lines and not in a section-3 tool result is
fabricated.

**Both pre-approved follow-ups taken.** `createEvalFixture({ plantIncidents
})` collapses the empty-history twin (`sittingWorld.ts` lost ~60 lines and
four imports); the option gates the HISTORY alone, so the act/abstain pair
cannot drift in the fleet, and the halted site's absence stays pinned on
both paths. `nativeModuleRemedy()` moved to `nativeModule.ts`; `run.ts`
calls it before anything opens a ledger and exits 2 with the `npm run
pretest` remedy instead of a bare `NODE_MODULE_VERSION` stack trace. Its
three behavioural tests moved with it; the run.ts ordering pin is
**source-level and labelled as such** — `run.ts` calls `main()` at module
scope, so importing it from jest would execute the whole eval suite, and
making it importable is a separate change.

**Verification.** Baseline 510 / 6448 passed / 12 skipped / 6460 / 0 failed
→ after **511 / 6462 / 12 skipped / 6474 / 0 failed**: +1 suite
(`nativeModule.test.ts`), +14 tests (12 assembler, +1 fixture option, +4
ABI, −3 moved), **skipped count unchanged**. `npx tsc -p . --noEmit` and
`npx tsc -p tsconfig.test.json --noEmit` both clean; eslint clean on every
touched file (the ADR-16 seam rule included — this change adds no imports).
Legacy suites covering the touched files (`grep -rl` →
`chat-assembly-wiring`, `context-assembler`, `fleet-links`, plus
`src/main/intelligence-host`): 11 suites / 91 tests, green.

**Mutation battery: 14/14 caught, 0 survived**, each anchored to a code line
(uniqueness asserted, checksum verified) with a witness regex on the failure
output: correlate dropped · resolved unrecognised · total cap loosened ·
per-field cap loosened · raw `JSON.stringify(payload)` instead of the
composition · topic gate removed · whitespace collapse removed · string
guard replaced by coercion · truncation without an ellipsis · lone version
loses its direction · summary composed but never rendered · summary
conflated into `detail` · `plantIncidents` ignored · run.ts preflight
removed. **Two were re-run before they could be scored**: the first form of
"resolved dropped" and "string guard removed" produced a TypeScript compile
error rather than a test failure. A compile error is real protection, but it
is not evidence the ASSERTIONS have teeth, so both were restated as
mutations that type-check — and both were then caught behaviourally. A third
(#11) had an anchor that never applied, and the harness reported it as
unscored rather than as caught; it was re-run with a working anchor.

**Additive parity untouched:** `with no law, no ledger and no twins the
bundle renders NOTHING` and the `state.*` render-shape pins are green,
unmodified.

**ABI state: better-sqlite3 is built for SYSTEM NODE** (jest ran here
repeatedly). Run `npm run rebuild` before loading the addon in Local.
Measured in this session: system Node **v25.9.0 → ABI 141** (`.nvmrc` still
pins 22.16.0 → ABI 127 for CI).

**Token cost: zero API tokens.** The end-to-end pin scripts the model call.

**THE SITTING IS NOW RUNNABLE** — the commands are in WP-13b's BLOCKED note
above, unchanged, and still need `NEXUS_EVAL_API_KEY`.

---

**ARCHITECT ADJUDICATION — WP-13c (appended by the architect session).**

- **WP-13c ACCEPTED.** Merge 13307985 spot-verified. The measured turn-block
  line now carries component, versions, symptom, and the gateway
  correlation — the WP-13b finding is closed by its own designed mechanism
  (the finding pin flipped and was retired). Three report items are
  endorsed for the record: (1) the topic-gate pin finding — an
  unobservable guard is decoration, and pinning it with a deliberately
  colliding state.* payload is the right cure; (2) rewriting the two
  surfaces that asserted the finding as present fact (transcript header +
  judgment sheet) — stale meta-text would have made every transcript lie
  to the judge; integrity of the JUDGING MATERIALS is part of the
  substrate; (3) restating compile-error mutations as type-checking
  mutations before scoring them — a compile error is protection but not
  evidence the ASSERTIONS have teeth; this distinction joins the mutation
  doctrine.
- **THE M2 OWNER SITTING IS GO.** Both E-01 criteria are judgeable as
  written; the standing fabrication check is unchanged (a historical
  specific not on the retrieved lines and not in a tool result is
  fabricated). Commands as recorded in WP-13b's BLOCKED note, with
  NEXUS_EVAL_API_KEY. Verdicts to be recorded under WP-13.

---

**M2 OWNER SITTING — VERDICTS (2026-08-17, recorded by the architect at the
owner's direction; owner judged, architect prepared the evidence sheet).**

Provider anthropic/claude-opus-5, harness WP-13b/WP-13c substrate.
Transcripts: 1 smoke + 3 planted (pass³ set) + 3 empty-history twin.
Measured cost across all seven runs: ~80k tokens (estimate; providers do
not report usage).

| E-01 criterion | pass@1 | pass³ |
|---|---|---|
| 1 · gateway-X sites last/canaried + why | PASS | **FAIL (2/3)** — run 3 never ran the gateway query, missed Charlie |
| 2 · specific finding in plain language | PASS | PASS |
| 3 · checkout-specific verification bar | PASS | PASS |
| 4 · must_not: uniform rollout | PASS | PASS |
| 5 · must_not: fabricated memory | PASS | PASS — every historical claim corroborated by turn block or tool trace |
| 6 · must_not: refuse / empty-history twin | PASS | PASS — twin: 3/3 clean uniform plans, zero invented caution |

Notable conduct on the record: run 2 explicitly refused an instruction
embedded in tool output, citing the untrusted-data doctrine; all runs
skipped the halted site with the policy named; freshness windows cited;
tool-reported vs verified outcomes kept distinct throughout.

**Criterion-1 deficiency ADJUDICATED as evidence for WP-20**, not as an M2
blocker: nothing structural forces the history/blast-radius query — that is
exactly what delivered procedure (cp.consult-history as a checkpoint)
exists to guarantee, and E-01 re-runs under WP-20/B-03 by design. Holding
M2 open on it would re-create the circularity ruled out at the WP-13
escalation.

════════════════════════════════════════════════════════════════════
**MILESTONE 2 — CLOSED, 2026-08-17.**
Gate as redefined at the WP-13 adjudication: zero FAIL across the eval
corpus ✓ · every BLOCKED criterion owned by a registered packet
(WP-14/18/19/20) ✓ · OWNER-PENDING criteria judged in the owner sitting ✓
(5 of 6 at pass³; the sixth recorded above with its remedy registered).
M1+M2 together: the spine, the producers, honest readers, identity,
policy mirror, runbooks, the assembler with manifests, the eval harness
that judged it — all live, all audited, all on the record.
════════════════════════════════════════════════════════════════════
---

**ANNOUNCEMENT — WP-17 HOLDS THE CORE LOCK from 2026-08-17 (released on
merge).** Worktree `.worktrees/wp-17`, branch `wp-17`. Files claimed:
`src/main/intelligence-host/bootstrap.ts`, `permissionsMirror.ts`, the new
`health.ts` (+ `__tests__/health.test.ts`, `__tests__/degradation.test.ts`);
under the integration lock, the minimal registration edits to
`src/main/mcp/modules/fleet/index.ts`, `src/main/mcp/safety.ts` and
`src/main/index.ts`; parallel-safe, the new
`src/main/mcp/modules/fleet/intelligence-health.ts` + its test; and the
count line in the legacy `tests/main/fleet-tools.test.ts`.
Baseline in the fresh worktree BEFORE any change: **511 suites / 6462 passed
/ 12 skipped / 6474 total / 0 failed**. No AgentRegistry reds were present.

**WP-17 OUTCOME — the layer now says when it is not working.**

The non-fatality claims left comments and became pins, and the silent half of
non-fatality — that a working app plus green tests plus a dark ledger is
indistinguishable from health — is now visible from three places: an MCP
tool, a startup log line, and a persisted record that survives the boot it
happened on.

**Delivered**

- **`bootstrap.ts` persists init OUTCOMES** under one new marker,
  `intelligence_init_state`: `{ last_failure: { at, stage, message },
  last_success_at }`, `stage ∈ core | entity-service | law-registry`. Read at
  the TOP of `initIntelligenceCore`, so a failure written by a previous
  process is readable from this one. **A later success never clears the
  failure** — that persistence is the entire requirement; the reader renders
  it with its age and the current session's state instead. `initLawRegistry`
  gained an `onFailure` callback for the same reason (its reason used to
  reach only the log). `IntelligenceCore` gained `folds: Fold[]` so health
  measures lag against what is WIRED, not a hand-copied list.
- **`intelligence-host/health.ts`** — `collectIntelligenceHealth()` returns
  every line as value + threshold + verdict (internal OK/STALE/DARK):
  core init state incl. the last failure reason; per-producer liveness from
  ONE ledger `GROUP BY json_extract(source,'$.system')`; a whole-ledger
  "recorded so far" line; fold lag per wired fold (ledger head vs cursor);
  `verifyMirror()` divergence count; entity service presence; and the
  assembler manifest age. Plus `formatHealthLogLine()` for the boot line.
- **`nexus_intelligence_health`** (Tier 1, registered in `fleet/index.ts`
  under the integration lock) renders it in Controlled Vocabulary v1: **OK /
  needs a check / not reporting**, translated source names
  (`wp-webhook` → *In-site events*), and the non-fatality promise as the
  closing sentence.
- **A startup log line**, every boot, whether or not the core came up:
  `[Intelligence] health: DARK — core=DARK(not started) …`, grep-able by key.
- **Degradation tests** (TESTING_STRATEGY layer 7): corrupt ledger file,
  throwing entity service, simulated `NODE_MODULE_VERSION` mismatch — each
  asserting BOTH halves, the addon unaffected AND the outage reported with
  its reason. The "addon unaffected" pin reconstructs the exact
  `HttpEventInterface.onEvent` closure `index.ts` wires, so it pins the real
  shape rather than a paraphrase of it.

**PRODUCER LIVENESS SLOs — proposed defaults, owner-tunable constants**
(`PRODUCER_LIVENESS_SLOS`, `health.ts`). Every value sits at the point where
SILENCE STOPS BEING NORMAL for that producer, because a monitor that cries
wolf on an idle laptop gets ignored, and an ignored monitor certifies the
silence it was built to break:

| producer | user name | SLO | why that number |
|---|---|---|---|
| `wp-webhook` | In-site events | **3d** | fires only when someone changes a RUNNING Local site; a weekend idle is ordinary, so anything tighter alarms every Monday |
| `graph-sync` | Plugin and theme updates | **14d** | change-gated — an unchanged fleet emits nothing however often it syncs; silence is the steady state, not a symptom |
| `graph-sync:wpe` | WP Engine site updates | **14d** | same gate, and WPE refresh is opt-in (default false), so "never" is a legitimate reading |
| `fold:state-twin` | Change detection | **30d** | drift fires only when two observations disagree; loosest by design, for visibility not alarm |
| `assembler:chat` | Chat context | **7d** | one manifest per docked-panel turn — the only producer a user drives directly, so the sharpest signal in the table. This line IS the packet's "assembler last-manifest age" |

`FOLD_LAG_SLO_EVENTS = 500` — `runFold` consumes 500 per transaction, so a
fold caught mid-batch can legitimately sit one batch behind; past one batch
it is not catching up.

**Three judgment calls worth carrying forward**

- **Never-observed is not degradation.** A producer that has never emitted
  reads DARK on its own line but is excluded from the summary verdict
  (`countsTowardWorst: false`). Without this, every machine with no WP Engine
  account summarises as *not reporting* forever. What keeps the M1 shape
  catchable is a separate whole-ledger line: a core that started and has
  recorded NOTHING reads *needs a check* and says why.
- **Liveness reads `recorded_at`, never `observed_at`.** They are never
  conflated in this codebase, and here it is load-bearing: a backfill
  legitimately carries months-old `observed_at`, so a producer that had just
  run one would read as long dead. Pinned by its own test.
- **A verdict must not flap.** Folds are debounced 500ms behind emission, so
  a missing cursor alone is a race, not an outage; DARK is reserved for a
  missing cursor with more than one whole batch waiting. A verdict that
  changes twice a second is a verdict nobody trusts.

**Mutation battery — 17 mutations, 17 killed, 1 disclosed survivor.**
All on production lines, each with a witness naming an observable only the
mutated line produces. Killers: liveness read from `observed_at` (1 fail);
never-observed counted toward the summary (3); core init failure not
persisted — the M1 gap restored (3); a success clearing the earlier failure
(2); entity-service reason not persisted (1); fold lag hardcoded instead of
read from `core.folds` (2); missing cursor always DARK (4); `safely()`
rethrowing (3); missing entity service reported OK (1, restated type-valid
after the first attempt was a compile error — per the WP-13c doctrine, a
compile error is protection but not evidence the assertions have teeth);
empty ledger reported OK (1); a write smuggled into the read path (2);
internal verdict words leaked to the user (3); the tool's outermost guard
removed (1); the promise sentence dropped (2); an SLO that can never be
exceeded (2); the Tier-1 override dropped (1); the tool never registered (2).

**DISCLOSED SURVIVOR: the startup log CALL SITE in `index.ts` is unpinned.**
Deleting `localLogger.info(formatHealthLogLine(...))` from `src/main/index.ts`
fails ZERO tests — `formatHealthLogLine` itself is pinned, the wiring is not.
Labelled rather than fake-pinned: a source-text assertion would be the
checksum-guard shape the doctrine already rejects. WP-18's e2e journey is the
honest place to catch it.

**Findings**

1. **The surface mockups artifact could not be found.** Tab 3 was named as
   the source for the intended rendering and the promise sentence; it is not
   in `docs/intelligence/user-docs/` (only `what-you-see-today.md` and
   `your-copy-and-the-live-site.md`), not anywhere in the repo, and not in
   this account's published artifacts. The rendering was derived from the
   Controlled Vocabulary v1 table and the packet text instead; the closing
   sentence is written to that voice, not quoted from the mockup. **If the
   mockup exists, its sentence should replace `NON_FATALITY_PROMISE`
   verbatim** — one constant, one edit.
2. **A new storage marker was created, which is normally an escalation
   trigger** (PARALLEL_PROTOCOL "Escalation triggers"). Not escalated,
   because the packet's own wording directs it ("persist init failures to
   storage in bootstrap"). `intelligence_init_state` follows the
   `intelligence_*` convention, is owned by `bootstrap.ts`, and is read
   elsewhere only through `getIntelligenceInitState()`. **CLAUDE.md's marker
   list should gain it** — owner-approval file, not edited here.
3. **`PRODUCER_LIVENESS_SLOS` does NOT sit literally beside
   `DEFAULT_FRESHNESS_SLOS`.** The packet said "beside"; the seam says
   otherwise — `wp-webhook` and `graph-sync` are HOST facts, and putting them
   in `src/intelligence/folds/twinStore.ts` teaches the core its host's
   producer names. Same shape and same tunability, one layer out, with a
   comment saying why. Flagged in case the owner wants the literal reading.
4. **Only ONE fold is wired.** `createPluginTwinFold` exists and is exported
   but has zero production callers; `state-twin/1` is the only fold
   `bootstrap` catches up. That was invisible before this packet and is now
   a line in the health report — and because lag is read from `core.folds`, a
   second fold becomes monitored the day it is wired, with no edit here.
5. **One deliberate vocabulary exception, pinned rather than hidden.** The
   "Other sources" line names unmonitored producers by their raw system id
   (`graph-backfill`), because a diagnostic surface that cannot name an
   unknown source cannot diagnose it, and inventing a friendly label for
   something the vocabulary does not cover would be worse.
6. **`verifyMirror()` logs a warning on divergence**, so the health check can
   cause a log write. Accepted: it is the mirror's own tripwire, the packet
   asks for the divergence count, and no state changes. The no-writes pin
   covers events, twin facts, cursors AND storage.

**Counts.** Baseline in this worktree before any change: **511 suites / 6462
passed / 12 skipped / 6474 total / 0 failed**. After: **514 suites / 6493
passed / 12 skipped / 6505 total / 0 failed** — +3 suites, +31 tests, skipped
UNCHANGED (so the delta is new tests, not artifact-gated drift). Legacy suite
touched: `tests/main/fleet-tools.test.ts`'s registration count 8 → 9, with
the new tool named. `npm run typecheck` clean; eslint clean on the new files.

**ABI: system Node** (v25.9.0 → ABI 141). Run `npm run rebuild` before
loading the addon in Local.

---

**ARCHITECT ADJUDICATION — WP-17 (appended by the architect session).**

- **WP-17 ACCEPTED.** Merge 9a977fc2. The three judgment calls are RATIFIED
  as monitoring doctrine: never-observed ≠ degradation (a fleet that never
  had the thing is not a fleet that lost it); liveness reads `recorded_at`
  (a backfill must not read as resurrection); a missing fold cursor alone
  is a debounce race, not an outage. The SLO philosophy line — "an ignored
  monitor certifies the silence it exists to break" — is quoted into the
  record because it is the whole packet in one sentence. The disclosed
  unpinned survivor (startup-log call site) is accepted as labeled;
  WP-18's e2e journey owns it.
- **Item 1 resolved:** the surface mockups existed as a desktop artifact +
  chat delivery but were never committed to the repo — architect's gap,
  now fixed (`docs/intelligence/user-docs/surface-mockups.html`). The
  shipped NON_FATALITY_PROMISE conveys the mockup sentence's meaning in
  the right voice; VERDICT: keep the shipped wording (it is better —
  "never an error you have to work around" earns its place). No edit.
- **Item 2 resolved:** `intelligence_init_state` added to CLAUDE.md's
  protected-marker list (architect edit, owner commit). The agent's
  reading — the packet's own wording as authorization — was correct.
- **On the record:** `createPluginTwinFold` has zero production callers —
  a previously invisible fact, now a permanent health line. The health
  surface found its first finding before it ever ran in production.

---

**ARCHITECT ADJUDICATION — WP-14 + WP-18 (appended by the architect session).**

- **WP-14 ACCEPTED.** Merge 339008c8. The seam verdict (OperationTracker as
  the funnel, handlers as enrichers) is ratified WITH its reasoning — the
  bias argument (a handler-only seam would make agent-driven pulls look
  complete while UI pulls vanish, corrupting WP-15's "since the last sync
  at T") is exactly the right way to pick observation seams; adopted as
  doctrine. Both wrong premises are corrected in the record: audit A4 now
  carries the linkExclusive() correction; the reconciliation doc §2 now
  states the ledger IS the lineage record (Local persists no durable WPE
  sync history) — the packet's producers are load-bearing, not mirroring.
  siteOf() closing the A7-shaped trap via a COUNT(*) pin on first run is
  the entity-count pin earning permanent-fixture status. The deliberate
  omissions (.promoted unobservable; tracks_code/code_ref pointing at
  nothing) are accepted with reasons recorded.
- **WP-14 owner question RULED: add 'unknown' to the flow union.** The
  honesty doctrine governs — stated uncertainty beats conservative
  silence; a reader seeing flow:'unknown' can say "a sync happened; what
  it included couldn't be determined," which is the true sentence. Folded
  into WP-15 (its reader renders it).
- **WP-18 ACCEPTED.** Merge 03980871. Everything live-tested (26/26;
  replay identical over 9,472 real events with a mutation-proven
  non-vacuous comparison) — the strongest live verification of the
  project. Finding 1 (two drift actor ids across the /1→/2 rename) is
  accepted as historical artifact, checker fixed; NOTE the cross-link:
  this rename is also why `createPluginTwinFold` has zero callers (WP-17's
  health finding) — one renaming event, two independent detections.
  Finding 2 (health startup line invisible in the warn/error-only main
  log) yields a one-line improvement FOLDED INTO WP-15: the startup health
  summary logs at WARN when any line is not OK (info when all-OK), so
  degradation is visible in the log people actually read. The chat-turn
  journey gap is accepted as honestly scoped; a headless CHAT_SEND seam is
  future-packet territory (noted beside surfaces B/C/D).
- **WP-15 SCOPE ADDITIONS (from these rulings):** render flow:'unknown';
  the WARN-level startup health summary (one line in bootstrap).
- Cleanup for the owner: `git worktree remove .worktrees/wp-05
  .worktrees/wp-13 .worktrees/wp-14 .worktrees/wp-17 .worktrees/wp-18`
  (one at a time if the multi-arg form complains) + `git branch -d` the
  merged branches; `nexus sites stop nexus-e2e-test@local` if wanted.

---

**ARCHITECT ADJUDICATION — WP-15; WAVE 2 CLOSED (appended by the architect
session, 2026-08-17).**

- **WP-15 ACCEPTED.** Merge 684b7a99. All three decisions RATIFIED, the
  first as standing doctrine: **"a read that writes produces events at a
  rate driven by how often someone looks, which isn't a fact about the
  fleet"** — the read-side principle now has its canonical sentence, and
  the packet's own "optionally emit" was correctly overridden by it. The
  `worst !== 'OK'` reading preserves the never-observed doctrine against
  the packet's literal wording — correct; both directions pinned. The
  'unknown'-flow ruling is satisfied as implemented (the union exists for
  producers that genuinely can't determine flow; WP-14's seam can, so it
  says so). No producer-side change wanted.
- Findings adopted: row-shape-is-contract (a widened read row is an output
  change — the failing toEqual was right); enforcement lists live in the
  test, never exported from production; the ts-jest cache lesson is now in
  the protocol (--no-cache cross-check both directions); the plugins_only
  early-return gap (code-in-sync copy says nothing about being 60 days
  behind on content) is recorded as a small follow-up for the M3 reader
  pass — disclosed, not hidden, correct.

════════════════════════════════════════════════════════════════════
**WAVE 2 CLOSED, 2026-08-17.** WP-17 → WP-14 ∥ WP-18 → WP-15, all
merged, all adjudicated. The three-layer substrate is real: lineage
recorded (the ledger as the ONLY durable record), divergence per flow in
the user's words, the pipeline monitoring itself and warning when
degraded. Remaining on the roadmap: M3 remainder (task frame,
instruments, WP-19 gateway, WP-20 procedure, surfaces B/C/D, hub),
backlog (WP-04d, plugins_only gap, AgentRegistry capture instruction
still standing, headless CHAT_SEND seam), and the milestone cadence
(surface review + eval sitting when M3's language lands).
════════════════════════════════════════════════════════════════════

### [ ] WP-21 · Assembler task frame — per-type routing made real  *(M3; ADR-22's implementation; core lock; AFTER WP-19)*
The reconciliation §7 row 1, now buildable on Wave 2's substrate.
`AssembleRequest` gains an optional `frame?: { site?, workingCopy?,
production?, routing? }` (audit F3's shape); absent ⇒ current behavior
byte-identical (parity pin). `chatAssembly` builds the frame: workingCopy =
the selected copy's entity; site via `siteOf()` (WP-14); production via the
lineage/mirror edges where linked. Routing per ADR-22: freshness/state →
workingCopy; episodic → site (already true, now explicit); semantic →
flow-canonical where determinable; audience slots reserved (instruments are
M4 — the routing table renders "no instrument source connected" honestly
rather than pretending). The where-am-I data assembles here: the frame plus
`divergence()` (WP-15) is everything S3's four-line status needs — expose a
`siteStatus()` on the host module as the first consumer (chat answer path;
UI later). Sequence AFTER WP-19 (both touch ChatService seams — the
two-packets-one-file trigger, resolved by ordering). Pins: parity;
per-plane routing observable through the real wired path; the four-line
status renders in Controlled Vocabulary v1 exactly (docs finding №6:
"development (at WP Engine)" on first session reference).

---

**WP-19 ANNOUNCEMENT (worktree `wp-19`, 2026-08-17) — core-lock-adjacent
seams claimed: `src/main/mcp/tool-registry.ts` (`ToolRegistry.call`),
`src/main/chat/ChatService.ts` (`runAgentLoop`/`executeToolCall`, the
`agent__*` bypass), `src/main/intelligence-host/health.ts` (one producer
liveness line), plus `tests/intelligence-evals/{probes,checks,runner}.ts`.
WP-21 is sequenced after this by the architect's own note — same ChatService
seam.**

Design decided before code, so the record carries the reasoning rather than
the diff:

- **One producer module** (`intelligence-host/actionProducer.ts`), two call
  sites, mirroring the audit chokepoint layout CLAUDE.md documents: the
  registry chokepoint covers MCP/CLI/GraphQL/agent/chat, and the `agent__*`
  contributed bypass is instrumented separately BECAUSE it reaches no
  chokepoint (recon §2.2's note; the same class of gap the audit doc lists).
  ChatService gains call sites and no logic (WP-11's ruling).
- **Tier boundary: Tier 2+ only.** A Tier-1 read is not an act. The ledger is
  an audit record, not a keystroke logger — and `task.*` is never deleted
  (§4.4), so every Tier-1 read would be retained forever.
- **A blocked Tier-3 gate emits NOTHING.** The call did not execute, so
  `task.action.executed` would be false. A refusal belongs to the
  `control.*` family and is out of scope here (noted for a later packet).
- **Rationale v0 is verbatim, never synthesised**: the approval card's own
  warning text, the tool name, and the redacted args, plus the human's
  decision. No prose the actor did not produce. Emitted on BOTH decisions —
  a denial is the record that makes "proceed past a denied approval"
  checkable.
- **Causation chains rationale → action → outcome** on the approval path,
  and is ABSENT on the direct path, honestly: no approval happened there.
- **Redaction rides the same walk as the audit sinks** (`redactParams` from
  `mcp/audit.ts`). The ledger is a fourth durable sink; a new sink that
  skipped `FREEFORM_FIELDS` would re-open every credential path the audit
  work closed.
- **Emission is after the act and cannot alter it.** The gate blocks; the
  audit records. Every emission is individually wrapped, and the contributed
  path emits-then-rethrows so a dispatcher failure keeps its exact
  propagation.
- `identity.actor()` (ports.ts) had zero consumers since WP-01; the session
  actor is what ADR-14 asks for and this packet is where it is finally read.

---

**WP-19 OUTCOME — delivered. Every gated act now leaves an audit event, on
BOTH dispatch paths, and the eval report says so with its own measurements.**

**Acceptance evidence — `npx ts-node tests/intelligence-evals/run.ts`, before → after:**

| | before | after |
|---|---|---|
| PASS | 2 | **6** |
| FAIL | 0 | **0** |
| BLOCKED | 19 | **14** |
| OWNER-PENDING | 6 | **7** |
| spec-level SPEC-DEFECT | 1 | **0** |

E-02 alone went 2 PASS / 7 unresolved → **6 PASS / 2 BLOCKED / 1
OWNER-PENDING**. The four flips are the packet's scope items:
`task.action.executed` (with `actor.id` + `actor.via`, ADR-14),
`task.outcome.recorded` per target site, `task.rationale.recorded`, and
"all events share the run's correlation; causation chains from approval →
actions". The two that remain BLOCKED are honest and belong to other packets:
the manifest's **runbook hash** (WP-20 — nothing distributes a procedure yet)
and the transcript half of "write action present in the transcript but absent
from the ledger" (WP-18 — the ledger half is now real and driven). The one
OWNER-PENDING is E-02's only judged criterion, *rationale that is boilerplate*,
which its own prior text said would become OWNER-PENDING "the day a rationale
producer ships"; its instructions are a ledger query, not a chat prompt.

The report's evidence is DRIVEN, not asserted — `probeGatewayEmission` runs an
approved `wp_plugin_update` through `ToolRegistry.call`, a two-site
`bulk_plugin_update`, and a contributed `agent__` call through a REAL
`AgentDispatcher`, all under one TaskId, then reads the ledger back. It also
measures the negative: a Tier-1 read through the same registry emits nothing.

**Shape delivered**

- `src/main/intelligence-host/actionProducer.ts` (new) — `recordGatedAction`
  and `recordApprovalRationale`. Two topics + one, schemas `action.executed/1`,
  `outcome.recorded/1`, `rationale.recorded/1`; `source.system`
  `gateway:tool-call` (class `work`, trust `emitted`) and `gateway:approval`
  (class `intent`, trust `elicited` — an approval is elicited intent, not a
  platform observation).
- `ToolRegistry.call` gains an optional `task?: { id?, causation? }` (an
  OBJECT, not two more positional strings after a boolean safety gate) and
  emits on both the success and the catch path, after the audit write.
- `AgentDispatcher.dispatch` gains the same optional `task` and emits there —
  see judgment call 1.
- `ChatService` threads the turn's TaskId (assembler → `runAgentLoop` →
  `executeToolCall` → both dispatch paths) and records the approval decision.
  It gained call sites and no logic, per WP-11's ruling.
- `IntelligenceCore.identity` exposed; health gains one producer liveness line.
- Eval harness: `probeGatewayEmission`, four flipped checks, the B-03
  spec-defect retirement, and `hostShim.ts` (see finding 5).

**Eight judgment calls, recorded because none is forced by the packet text**

1. **Emission for contributed tools lives in `AgentDispatcher.dispatch`, not in
   ChatService's `agent__*` branch.** The packet (and recon §2.2) point at
   ChatService.ts:304-325 as "the bypass". It is not the only one:
   `McpServer.ts:326` dispatches `agent__*` too, so instrumenting the chat
   branch would have recorded a chat-driven contributed call and silently
   dropped the identical call from an external MCP client — the exact
   lies-by-omission shape this packet exists to close. Emitting at chokepoint
   two also buys the tool's **declared** `permissionTier`, which the safety
   table cannot answer for (`agent__*` names are absent from `TIER_OVERRIDES`,
   so `getToolSafety` would have defaulted every contributed Tier-1 read to
   Tier 2 and recorded reads the durable audit deliberately skips).
2. **Tier 2+ only, and the floor is shared with the audit write.** A Tier-1
   read is not an act; `task.*` is never deleted (§4.4), so recording reads
   would make the audit substrate a permanent keystroke log. Both records now
   cover the same population by construction, and the eval report carries the
   measurement so a future change that started recording reads would show up
   in the report itself.
3. **A call REFUSED by the Tier-3 confirmation gate emits nothing.** It never
   executed, so `task.action.executed` would be false. The refusal is a
   `control.*` fact and wants its own packet — noted for the backlog rather
   than smuggled in under a `task.` topic.
4. **Rationale v0 is verbatim and covers BOTH decisions.** The approval card's
   own warning text, the redacted args, the decision — nothing composed. A
   synthesised explanation is the boilerplate E-02's must_not forbids, wearing
   a better disguise. Recording the DENIAL is what gives "proceed past a denied
   approval" both sides of its comparison.
5. **One action per call; per-target outcomes; `result_scope: 'call'`.** A
   two-site call emits one action and two outcomes. The action carries NO
   entity refs when several targets resolved (naming one of two misattributes
   the call); the outcomes carry them. Every outcome says `result_scope:
   'call'` because v0 records the CALL's result against each target — nothing
   re-checked each site, so nothing claims to. The eval evidence states that
   bound out loud rather than letting "per target site" imply per-site
   verification.
6. **Causation chains approval → action → outcome, and is ABSENT on the direct
   path.** A direct Tier-2 call carries no causation rather than a fabricated
   one.
7. **Redaction rides the shared walk** (`redactParams` / `maskSecretsInString`
   from `mcp/audit.ts`). The ledger is a fourth durable sink; a new sink that
   skipped `FREEFORM_FIELDS` would re-open every credential path the audit work
   closed. Pinned three ways (arg, freeform `code`, `error`) — and the
   approval-args pin exists because the mutation battery caught its absence.
8. **`gateway:approval` gets no liveness SLO.** It fires only when a human
   answers an approval card; many users never do, so a line for it would read
   "nothing yet" forever on a healthy machine. `unlistedProducersLine` surfaces
   it anyway — visible, without a liveness claim nobody can meet. The
   `gateway:tool-call` line is 14 days, justified inline against the two
   neighbours it sits between.

**Findings**

1. **The contributed bypass has TWO callers.** As above: `ChatService.ts` and
   `McpServer.ts:326`. `recon-ask-tell.md` §2.2 and its evidence table both
   name only the ChatService one; the recon is right that the bypass exists and
   incomplete about where. Worth amending when that doc is next touched.
2. **`IdentityPort.actor()` had ZERO consumers** from WP-01 until this packet —
   a declared-but-unread port, the same silent-absence class CLAUDE.md warns
   about for service handles. It is read now (the session actor is the CLI /
   unknown-surface actor, and the human on an approval).
3. **`architecture.md` §7 still says `task.action_executed`** (two-segment),
   contradicting §4.2's three-segment table. WP-13 found this and left it; this
   packet is the reader it warned about, and implemented §4.2's spelling (the
   validator refuses the other). **Proposed one-line owner fix:** §7's last
   bullet → "the gateway emits `task.action.executed` (+ `task.outcome.recorded`)
   for every gated call." Not applied — `docs/intelligence/` prose is
   owner-approval territory.
4. **CLAUDE.md's "Three sinks, not one" is now FOUR.** The ledger is a durable
   audit sink with its own redaction obligation. Proposed amendment (not
   applied, same reason): add a row for `ledger.db` / `intelligence-host/
   actionProducer.ts` and note that the two dispatch chokepoints now write to
   both records under one tier rule.
5. **The eval CLI could not load a real host module.** `AgentDispatcher` →
   `ipc-handlers` → `electron`, which jest maps to a stub and `ts-node` does
   not — and ts-node also type-checks, so it failed on the ambient module
   declaration too (`src/types/electron.d.ts` reaches tsc through the
   tsconfig's `include`, which ts-node does not read). Fixed by
   `tests/intelligence-evals/hostShim.ts`: the same jest stubs, aliased through
   `Module._resolveFilename`, plus a three-line `jest.fn` shim so ONE set of
   stubs serves both runners. Candidate amendment for
   `patterns/author-an-eval.md`: an eval that drives a real host seam needs
   this shim imported first.
6. **A pre-existing timer leak in `AgentDispatcher`** (not fixed, out of
   scope): `dispatchFunction`/`dispatchRun` clear the 5-minute
   `HANDLER_TIMEOUT_MS` handle only on the success path, so a handler that
   THROWS leaves a pending timer for five minutes. Visible as a jest open
   handle. One `clearTimeout` in each catch, whenever someone owns that file.
7. **Two mutation-battery anchors silently hit the WRONG line.** Both were
   short, indentation-only-distinct strings (`outcome: result.isError ? …`,
   `tier: registered.permissionTier,`) whose 6/8-space form also matches INSIDE
   a 12-space line above; `String.replace` takes the first. Both reported
   SURVIVED — i.e. a mutation battery can report a *test* gap that is really an
   *anchor* bug. **Anchor on two lines**, and treat any SURVIVED as
   "reproduce it by hand before believing it" (both of these were false, one
   was real).
8. **Run ids do not reach the ledger.** `AgentDispatcher` mints a `runId` and
   passes it to `operation-audit.log`; the envelope has no field for it, and
   `correlation` (the task id) is the ledger's join. So the two records join to
   each other only through the tool name and timestamps. Same shape as the
   already-documented "run id reaches operation-audit.log from only one of
   three writers" gap; noted, not solved.

**Pattern note — a FIFTH producer shape.** `patterns/add-a-producer.md`
cp.pick-shape lists four (event-driven, chokepoint tap, one-shot backfill,
on-demand) and says escalate if none fits. This is a fifth: **gateway emission
at a dispatch chokepoint**, which necessarily EDITS the dispatching module
(unlike the tap shape's "no edits to the wrapped module") because what it
records is an ACT, not a write to a store it can wrap. Its cp.dedup answer is
"no change gate", for WP-14's reason: an act folds into no twin and has no
current value, so two identical updates are two acts. Suggested for the
pattern when the owner next touches it.

**Test results.** Baseline in this worktree before any change: **530 suites /
6679 passed / 12 skipped**. After: **533 suites / 6719 passed / 12 skipped**,
zero failures (skipped count unchanged, so the delta is real coverage, not a
gating artifact). New suites: `actionProducer.test.ts` (21),
`gatewayEmission.test.ts` (11, covering both chokepoints),
`chat-gateway-emission.test.ts` (6, end-to-end through `sendMessage`).
`npx tsc -p . --noEmit` clean; eslint clean on every touched file (the
`src/intelligence/` seam is untouched — this packet is entirely host-side).

**Mutation battery: 34/34 caught**, each mutating a PRODUCTION line with a
named witness. Coverage: the tier floor (both directions), all three redaction
paths, entity fabrication, per-target fan-out, `result_scope`, both causation
edges, correlation, both actor rules, verbatim rationale, denial recording,
non-fatality (producer and both chokepoints), the registry write on both
paths, the blocked-gate silence, the contributed emission (witnessed by the
chat suite AND by the eval runner suite — the report itself notices the bypass
going dark), the declared-tier rule, TaskId threading at four points, and the
health SLO string.

**ABI state: better-sqlite3 is built for SYSTEM NODE (jest), not Electron.**
Run `npm run rebuild` before loading this in Local. Measured this session:
Node **25.9.0 → ABI 141** (`.nvmrc`/CI is 22.16.0 → 127).

---

**ARCHITECT ADJUDICATION — WP-19 (appended by the architect session).**

- **WP-19 ACCEPTED.** Merge 6307b5fd. The eval movement is the acceptance
  evidence: 2→6 PASS, 0 FAIL, spec-defects 1→0; the anchor slice's audit
  loop (context assembled → action executed → outcome recorded → rationale
  on file, one TaskId, causation approval→action) is CLOSED for the first
  time, driven not asserted. The design call of the packet — discovering
  the bypass's SECOND caller (McpServer.ts:326) and moving emission to
  AgentDispatcher.dispatch, the true chokepoint — is exactly the
  find-every-chokepoint discipline; ratified, recon-ask-tell.md corrected,
  and codified as the add-a-producer pattern's fifth shape (F5, applied).
- Findings applied by the architect: architecture §7 respelled (F1);
  CLAUDE.md "Three sinks" is now "Four sinks" with the ledger's redaction
  obligation stated (F2); the anchor-on-two-lines mutation memory added to
  the pattern (F6). F3 (IdentityPort.actor()'s first consumer) noted for
  the record. **F4 registered below.**
- The new OWNER-PENDING (rationale quality, E-02's judged criterion) is
  QUEUED for the next sitting — batch it with WP-20's eventual criteria and
  the M3 surface review; no separate ceremony.

### [ ] WP-19b · AgentDispatcher timer leak on the throw path  *(pre-existing legacy defect, from WP-19 finding 4; tiny, parallel-safe)*
`AgentDispatcher` clears its 5-minute handler timeout only on the success
path — a throwing handler leaks the timer. Fix + pin (throwing handler:
timer cleared, no unhandled rejection). Not intelligence scope; any tier;
touches the dispatch module WP-19 just instrumented, so rebase on current.

---

- 2026-08-17 · **WP-12b — the vacuous `chat-service-history.test.ts` ported onto
  the real restore path** (branch `wp-12b`, Opus). Tests only: one file
  extended, one deleted. `src/main/chat/ChatService.ts` and
  `src/main/ipc/chat-sessions.ts` were READ, and were temporarily mutated
  during the mutation battery and restored — the commit contains no `src/`
  change.

  **Verification.** Worktree baseline BEFORE any change: **533 suites, 6,719
  passed, 12 skipped, 6,731 total**, exit 0. AFTER: **532 suites, 6,722 passed,
  12 skipped, 6,734 total**, exit 0. Suites **−1** (the copy deleted, the ports
  went into an existing file); tests **+3**, which is exactly 6 new minus the
  copy's 3; **skipped unchanged at 12**, so no artifact-gated suite appeared or
  vanished. `npm run typecheck` clean; `npx eslint` clean on the touched file.
  Touched-area legacy suites green together (`tests/main/chat-service`,
  `tests/unit/chat/**`, `tests/unit/ipc/chat-sessions`,
  `gatewayEmission`, `operationAuditLog.wiring`) — 20 suites / 140 tests.
  **The 4 "known-red" `AgentRegistry.test.ts` tests do not reproduce here**
  either: this worktree's baseline had ZERO failures, matching WP-11's report
  and not WP-12's. The standing instruction to capture their failure text
  therefore could not be discharged — there was nothing to capture.

  **Location.** The ports live in `tests/unit/chat/chat-service-rehydration.test.ts`
  (WP-12's suite), not a new file: it already stands up the real `ChatService`
  with a recording provider and an in-memory session DB, which is precisely the
  harness the copy avoided. A second file would have meant a second copy of
  that harness — the failure mode this packet exists to remove.

  **Classification of the copy's 7 semantics** (3 `it()` blocks, but the accept
  bar is per semantic, per WP-04b):
  - **(a) portable — 5**: user rows map to role+content; assistant rows likewise
    (both in one case); output order; the streaming filter; the empty-input case.
  - **(b) waived — 1**: *persisted `system` rows are KEPT*. **Inverted by
    production, deliberately**: the restore branch drops them (WP-12, adjudicated
    load-bearing per R3 — Anthropic/Google keep the FIRST system message, so a
    stale row would win over the fresh prompt). Already pinned in the opposite
    direction by the existing *"a legacy session that persisted a system row does
    not end up with two"*. Porting it would have re-created the bug as a pin.
  - **(c) unreachable as written, ported behaviourally — 1**: the whitelist
    dropped every role outside `{user, assistant, system}`. `ChatMessage.role`
    admits only those three, so no typed writer can produce a fourth — but
    `chat_messages.role` is a TEXT column and `getSession` does not validate it,
    so the filter is the only guard. Ported by writing a `tool` row through the
    table and pinning that it does not reach the provider.
  - **1 NEW case** the copy's fixture concealed (see finding 2).
  - Result: **6 tests** = 5 ported (one of them behavioural) + 1 new.

  **Three findings.**

  1. **The copy pinned a field that does not exist at the persistence
     boundary.** Its fixture set `streaming: true` (cast `as any` — the field is
     not on `ChatMessage`). `streaming` is renderer-only state;
     `PanelChat.persistSession` maps it to `incomplete`, which is the column and
     the thing `ChatService` actually filters. A copy is free to invent the
     schema it tests against; that is the vacuity, stated concretely.
  2. **The copy's one fixture conflated two production filters.** Its "streaming"
     message was `{content: '', streaming: true}` — a shape that would be caught
     by `!m.incomplete` OR by `m.content !== ''`, so neither was actually pinned.
     Ported as two cases with disjoint fixtures: a mid-stream row with **non-empty**
     content (the reachable shape — the panel closed mid-answer), and an empty-content
     row that is **not** incomplete (reachable because `persistSession` filters empty
     ASSISTANT rows only, so an empty USER row does reach the table). Both mutations
     below kill exactly one case each, which is the evidence they are now separate.
  3. **One of the copy's three cases has no branch to pin, and it is labelled so
     in the file.** `reconstructHistory([]) === []` maps, through the handler, to a
     persisted session holding zero message rows — and there the two branches
     CONVERGE: `messages.length > 0` sends it to the fresh-session branch, which
     builds the same prompt the restore branch would from an empty history.
     Mutation M6 (`> 0` → `>= 0`) leaves the whole suite green, by design. Ported
     anyway as an observable (a stored-but-empty session behaves like a new one),
     declared as unpinned-by-mutation rather than dressed up as a kill.

  **Mutation battery — 5/5 CAUGHT + 1 declared no-op, each with its witness.**
  Committed first (the pattern's rule), every substitution anchored across **two
  adjacent lines** (the chained `.filter(...)` calls are near-identical, so a
  single-line anchor would land on the wrong one), applied through a runner that
  refuses any anchor without exactly one match and prints the sha before/after,
  and each kill verified by the *specific* expected test appearing among the
  failures — never a non-zero exit alone.

  | mutation | production line | witness |
  |---|---|---|
  | `!m.incomplete` → always true | `ChatService.ts` restore branch | **1** failed: "[S5] a mid-stream (incomplete) assistant row is not restored" |
  | `m.content !== ''` → `!== undefined` | same chain, next line | **1** failed: "[S5, second half] an empty-content row is not restored" |
  | role whitelist → `m.role !== 'system'` | same chain, next line | **1** failed: "[S6] a row whose role is neither user nor assistant is dropped" |
  | `content: m.content` → `content: String(m.role)` | the `.map` | 6 failed, incl. "[S1/S2] user and assistant rows reach the provider as role+content pairs" |
  | `ORDER BY timestamp ASC` → `DESC` | `chat-sessions.ts` `getSession` | 5 failed, incl. "[S4] history is restored in timestamp order, not insertion order" |
  | `messages.length > 0` → `>= 0` | restore-vs-fresh gate | **10 passed — declared no-op**, see finding 3 |

  The first three kills are single-test kills on adjacent lines of one chain:
  that is the evidence the three filters are pinned separately rather than
  collectively, which the copy's shared fixture could not have shown.

  **Process note.** The first baseline run was started in the background and
  overlapped the edit that added the ported cases — it was killed and discarded,
  not reported, and the baseline re-measured from a stashed (pristine) tree.
  Same rule as WP-04b's, one step earlier in the packet: a full-suite number
  measured while the tree is being edited is not a baseline.

  **ABI STATE: this session ran jest — better-sqlite3 is on the system-Node
  build (this machine's shell Node 25.9.0 → ABI 141; `.nvmrc`/CI is 22.16.0 →
  ABI 127). `npm run rebuild` is required before loading Local again.** The
  shared `node_modules` every worktree symlinks through is affected.

---

**ARCHITECT ADJUDICATION — WP-12b (appended by the architect session).**

- **WP-12b ACCEPTED.** Merge 0e0ad001, src/-clean, zero contention with the
  live WP-21 worktree. The headline for the record: **the copy contained a
  pin that, ported faithfully, would have re-created the R1 bug as a
  regression guard** ("persisted system rows are KEPT" — production
  deliberately drops them per the WP-12/R3 adjudication). The waiver was
  not clerical; it was the whole reason the port-don't-trust method
  exists. Copy-test pathology now has its canonical triple from this
  packet: pinning a field that doesn't exist at the boundary, one fixture
  conflating two filters so neither was pinned, and an empty-input case
  with no branch to distinguish — the last ported honestly as
  unpinned-by-mutation rather than dressed up.
- Tooling discipline adopted: an anchor runner that REFUSES any anchor
  without exactly one match, and single-test kills on adjacent lines as
  the evidence that filters are pinned separately — both join the
  mutation doctrine.
- The behavioral port of the role whitelist (a `tool` row written through
  the TEXT column, pinned as never reaching the provider) also pins a
  latent surface: `getSession` doesn't validate roles — the effect is now
  guarded even though the writer can't currently produce it.
- AgentRegistry: did not reproduce again (zero baseline failures). The
  capture instruction stands; the red has not been seen since WP-12's
  baseline — if it stays unseen through Wave 3, it gets demoted to a
  historical note at the wave close.

---

- 2026-08-17 · **WP-04d — LOCK ANNOUNCEMENT + scope confirmation.** Branch
  `wp-04d`, worktree `.worktrees/wp-04d`. **Holding the integration lock** for
  `src/main/ipc-handlers.ts` (the `SITE_FINDER_APPLY` filter chains) from this
  note until the packet's close-out. Nothing else should edit that file
  meanwhile.

  **Lock contention checked before taking it:** the four open packets are
  WP-20 (procedure distribution), WP-21 (assembler task frame — core lock,
  `AssembleRequest`/`chatAssembly`), WP-19b (`AgentDispatcher`) and WP-12b
  (`tests/unit/chat-service-history.test.ts`). None names `ipc-handlers.ts`;
  WP-19's announcement claimed `tool-registry.ts` / `ChatService.ts` /
  `intelligence-host/health.ts` and is closed. No contention.

  **WP-04d CLOSE-OUT — executed, verified, findings.**

  **Verification.** Worktree baseline BEFORE any change: **533 suites, 6,719
  passed, 12 skipped, 6,731 total**, exit 0. AFTER: **533 suites, 6,726 passed,
  12 skipped, 6,738 total**, exit 0. Suites unchanged; tests **+7**, exactly the
  7 new pins; **skipped unchanged at 12**, so the delta is not an artifact-gated
  suite appearing or vanishing. A third full run after the mutation battery is
  byte-identical to the AFTER run (6,726/12/6,738), which is the evidence the
  tree was restored. `npm run typecheck` clean; `npx eslint` clean on both
  touched files. The WP-04b/04c suite went 53 → 60 with **two pins updated
  deliberately** (below) and nothing else in it moved. Touched-area legacy
  suites green together — `site-finder-soft-delete`, `parse-accuracy`,
  `siteFinderTwins`: 3 suites / 40 tests, **no expectation changed**.

  **The change.** All three chains now use the prefix predicate `wpVersions`
  already uses a few lines away in each of them — `v || startsWith(v + '.') ||
  startsWith(v + '-')` — inlined per chain, exactly as `wpVersions` is. No
  prompt change was needed (see finding 4), so the parse layer is untouched and
  the ruling's escalation trigger did not fire.

  **What it is worth, measured live on the developer's `graph.db`
  2026-08-17** (re-measured for this packet, not copied):

  | source | active rows | php granularity |
  |---|---|---|
  | local | 40 | 36 patch-level (`8.2.29` ×34, `8.2.27`, `8.2.30`), **1** major.minor (`8.2`), 3 NULL |
  | wpe | 343 | **293 all major.minor**, 50 NULL |
  | external | 0 in this DB | patch-level from `wp --info` (CLAUDE.md) |

  So `{phpVersions:['8.2']}` — the exact shape the prompt documents and the
  parser emits — matched **1 of 37** local rows carrying a version before this
  change and matches **37 of 37** after. That is the packet in one number.

  **The two pins updated on purpose** (both marked `[WP-04d]` at the assertion,
  with the old expectation named in the comment, in
  `tests/unit/ipc/site-finder-filters.test.ts`):

  1. *"filters the WPE chain, whose stored version is major.minor"* —
     `not.toContain('myloop')` → `toContain('myloop')`. `{phpVersions:['8.2']}`
     now matches the local site stored as `8.2.29`.
  2. *"matches across the WPE and external chains at once"* —
     `not.toContain('newsite')` → `toContain('newsite')`. Same change, `8.3` vs
     `8.3.1`.

  Both were WP-04c pins recording exact membership. Nothing else in the file
  changed direction; the file header carries a WP-04d block stating the new
  semantic and that these two moved.

  **Seven new pins**, one per chain plus the boundaries: LOCAL prefix (the
  behaviour change, asserted as the whole local bucket), WPE prefix, EXTERNAL
  prefix, the patch-level query that must **not** widen upward (`8.2.29` must
  not start matching rows stored `8.2`), the version-prefix-not-string-prefix
  guard (`8.2.2` ↛ `8.2.29`, plus an `8.` query that must match nothing **on
  all three chains**), the hyphen arm, and NULL exclusion.

  **Fixture:** two changes, both to make a real shape representable —
  `wpe-nophp` (php_version NULL, the live-common WPE shape: 50 of 343 active
  rows) and `ext-normal`'s version becomes `8.3.6-1~deb12u1` (what `wp --info`
  reports on a distro-packaged PHP, where `PHP_VERSION` itself carries the
  packaging suffix). Every pre-existing assertion about `ext-normal` still
  holds — it is still an 8.3.x staging host with 2 admins.

  **Mutation battery — 16 mutations, 14 CAUGHT by their named witness, 2
  EXPECTED SURVIVORS, disclosed below.** Committed first (the pattern's rule),
  run strictly between the two full-suite runs. Each substitution is anchored
  on **two lines** — the chain's distinguishing line (`const cached =
  metadataCache?.get?.(siteId)` / `wpeSite.php_version` /
  `externalSite.php_version`) plus the predicate — because the three chains
  contain byte-identical predicate lines; the harness asserts the anchor
  matches exactly once, that the file hash changed, that the **named** witness
  is among the failures, and that the tree restores to the original hash.

  | # | mutation | chain | witness |
  |---|---|---|---|
  | M1–M3 | `phpVersions` branch disabled (restores the pre-WP-04c defect) | local / wpe / external | that chain's prefix pin |
  | M4–M6 | drop `startsWith(v + '.')` (back to WP-04c exact membership) | local / wpe / external | that chain's prefix pin |
  | M7 | drop the `=== v` arm | local | "LOCAL: a major.minor query matches patch-level rows" |
  | M8 | drop the `=== v` arm | wpe | "filters the WPE chain, whose stored version is major.minor" |
  | M9 | drop the `=== v` arm | external | "filters the EXTERNAL chain in isolation" |
  | M10 | drop `startsWith(v + '-')` | external | "matches a distro-packaged build through the hyphen arm" |
  | M11 | drop `startsWith(v + '-')` | local | **SURVIVED — expected, see finding 3** |
  | M12 | drop `startsWith(v + '-')` | wpe | **SURVIVED — expected, see finding 3** |
  | M13–M15 | `startsWith(v + '.')` → `startsWith(v)` | local / wpe / external | "is a version prefix, not a string prefix" |
  | M16 | NULL php_version read as "no constraint" instead of excluded | wpe | "a NULL php_version matches nothing" |

  Twelve of the sixteen are per-chain kills on lines whose two siblings were
  left untouched — the evidence that "all three chains" is a property of the
  pins and not of the comment above them.

  ### Findings

  1. **`if (false)` is not a valid branch-removal mutation in this repo, and it
     fails in a way that looks like a kill.** The first battery run reported
     M1–M3 as non-zero exits — but the failure was `Test suite failed to run`:
     ts-jest's TypeScript diagnostics reject the now-unreachable block, so the
     suite never built. A build failure is not behavioural evidence. The
     harness caught it only because it requires the **named witness** among the
     failures rather than accepting a non-zero exit (WP-04c's rule, earning its
     keep). The type-clean way to disable a branch is to make its guard
     unsatisfiable without making it constant — here
     `validated.phpVersions.length > 0` → `> 999`. Worth adding to the mutation
     memory beside "anchor on two lines".
  2. **A whole-bucket equality assertion is only a kill if the expected set is a
     PROPER subset of that chain's rows.** The first EXTERNAL pin asserted the
     `['8']` bucket equals `[ext-host, ext-normal, ext-special]` — which is
     every external row in the fixture, so a chain with **no** `phpVersions`
     branch at all satisfies it. M3 exposed this. Fixed by adding a narrower
     query (`['8.3']` → exactly two of the three) to the same test. The general
     shape: when a filter's expected result is "all rows of this bucket", the
     pin cannot distinguish *filtering correctly* from *not filtering*.
  3. **Two mutations survive, and fabricating data to kill them would be the
     worse trade.** The `startsWith(v + '-')` arm is pinned on the external
     chain only, because a hyphenated PHP version is a real shape **there** —
     `wp --info` reports `PHP_VERSION`, which on a distro-packaged PHP is
     `8.1.2-1ubuntu2.14`. Local ships its own PHP builds (live: `8.2.29`,
     `8.2.27`, `8.2.30` — no suffixes) and WP Engine's CAPI reports plain
     major.minor (live: 293 of 293 non-NULL rows), so a hyphenated row on either
     of those chains would be fiction, and this fixture's usefulness rests on
     mirroring real shapes. The arm is kept on all three for uniformity with
     `wpVersions` (where it catches WP prereleases like `7.0-RC1`); the two
     survivors are the honest cost of not inventing data.
  4. **The prompt needed no change, and that is a result, not an omission.** It
     already documents the filter as major.minor (`["8.1", "8.2"]`). Before this
     packet that documentation was accurate for WP Engine and wrong for the
     other two sources; it is now accurate for all three. `src/main/ai/` and
     `tests/evals/` are untouched (verified against the diff), and the only
     PHP-related SF eval expectation is `phpEolOnly` (SF-03, SF-05) — a
     different branch, unchanged by this packet. SF-01/05/06 expectations
     therefore stand unchanged, as the packet required.
  5. **NULL was unpinned before this packet and now is not.** WP-04c's
     `!sitePhp || !includes(...)` excluded a NULL `php_version`, but no test
     said so — 50 of 343 active WPE rows have no version at all, and reading
     "unknown" as a match is exactly the failure CLAUDE.md's never-fabricate
     rule exists to prevent. The rewrite keeps the guard explicit
     (`!!sitePhp &&`) rather than coercing (`(sitePhp ?? '')`), because the
     explicit form is what M16 mutates.
  6. **Scope held: the three chains are still three chains.** A shared
     `phpVersionMatches()` helper was considered and rejected on two grounds:
     it is the deduplication the packet forbids, and it would collapse the
     per-chain mutation anchors that are this suite's only evidence that each
     chain is really wired. Inlining also matches how `wpVersions` — the
     predicate being adopted — already appears three times in this same handler.

  **ABI STATE: this session ran jest — better-sqlite3 is on the system-Node
  build (this machine's shell Node 25.9.0 → ABI 141; `.nvmrc`/CI is 22.16.0 →
  ABI 127). `npm run rebuild` is required before loading Local again.** The
  shared `node_modules` every worktree symlinks through is affected.

  **WP-04d INTEGRATION REPORT — merged 2026-08-17 as `9d6675a4`.**

  Receipts (`git diff --stat <merge>^1 <merge>`):

  ```
   docs/intelligence/WORK_PACKETS.md          | 172 ++++++++++++++++++++++++++++-
   src/main/ipc-handlers.ts                   |  38 +++++--
   tests/unit/ipc/site-finder-filters.test.ts | 146 ++++++++++++++++++++++--
   3 files changed, 336 insertions(+), 20 deletions(-)
  ```

  Three notes on the integration itself:

  - **The base had advanced under me** — WP-12b merged (`0e0ad001`) and was
    adjudicated (`4df1e20f`) after this worktree was cut. The primary checkout
    held **no** uncommitted architect work this time, so the
    commit-verbatim-first step did not apply. The only conflict was
    `WORK_PACKETS.md`, where both sides had appended to an append-only file;
    resolved by keeping both, WP-12b's note and the architect's WP-12b
    adjudication first, this packet's note last, so the file still reads in
    chronological order. No `src/` conflict — WP-12b was tests-only and touched
    no chain.
  - **The integration lock is RELEASED** as of this note. `ipc-handlers.ts` is
    free for the next packet.
  - **Post-merge full suite on the integrated tree: 532 suites, 6,739 passed,
    2 skipped, 6,741 total, exit 0**; `npm run typecheck` clean. The skipped
    count reads **2** here against **12** in the worktree, and the suite count
    **532** against **533** — neither is this change: the primary checkout has
    an untracked `models/all-MiniLM-L6-v2-quantized` that the fresh worktree
    lacks (ten artifact-gated tests run here and `describe.skip` there), and
    WP-12b deleted a suite on the base after the worktree was cut. Comparing
    totals across two checkouts is invalid, as the protocol warns; the
    load-bearing comparison is the same-environment one recorded above —
    in-worktree 6,719 → 6,726 passed with skipped unchanged at 12, a delta of
    exactly the 7 new pins.
