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

### [ ] WP-04 · Site Finder plugin/version filters read twins
Pattern: reader-migration, adapted — this is the NL→filter surface, so the
change is in the filter ENGINE, not a chat tool. Scout `filterEngine` service
first (services registry in `src/main/mcp/types.ts`; SF eval cases in
`tests/evals/cases/SF-*.yaml` define expected behavior). Serialized-with-owner
if the engine lives near core services; otherwise parallel-safe.
Accept: plugin-presence and plugin-version filters answer from
`twins.byFact`/`search` with the graph as fallback; SF-01/05/06 eval
expectations unchanged; result payload gains observed_at per row where the UI
can carry it. Escalate before changing any SF eval expectation.

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

### [ ] WP-06 · Review sweep
No pattern. Read-mostly. Parallel-safe (but run last, after WP-01..05 merge).
Accept: lint clean on all intelligence files; no leftover scaffold-isms
(`(e: any)` casts justified or typed properly against real `NexusServices`);
every new file has its header comment; a draft PR description exists at
`docs/intelligence/PR_DESCRIPTION.md` telling the story (model → ADRs → spine
→ readers → live re-check) with verification steps for a reviewer.

---

## Milestone 2 — designed and speccable now

### [ ] WP-07 · Wire entity service v0  **(REWRITTEN per reconciliation — read `reconciliation-entity-identity.md` first)**
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

### [ ] WP-08 · Policy & runbook repo v0 — translate permissions
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

### [ ] WP-09 · Author the remaining v0 runbooks (4)
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

### [ ] WP-10 · Recon: the Ask/Tell context path  *(Explore-shaped — touch nothing)*
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

### [blocked] WP-11 · Context assembler v0
Blocked on WP-10's recon + owner review of its proposal. Contract:
architecture.md §6 (AssembleRequest → ContextBundle, manifest as audit
artifact, fail-closed rule ADR-7). Definition of done for the milestone: evals
B-03/E-01/E-02 against the real ledger (harness rules H-01/H-02).

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
