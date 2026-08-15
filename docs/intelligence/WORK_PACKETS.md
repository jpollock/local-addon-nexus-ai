# Work Packets — intelligence layer

*Assignable units for AI engineering agents. Read `PARALLEL_PROTOCOL.md` first,
then the packet's named pattern. Scope: all of Milestone 1 + the designed
portion of Milestone 2. M3/M4 are deliberately unpacketized (open decisions —
see `INTELLIGENCE_ROADMAP.md`).*

*Status legend: `[ ]` open · `[~]` claimed (add agent/worktree) · `[x]` done
(add one-line outcome). Append notes; never delete them.*

---

## Milestone 1 — honest reads everywhere

### [ ] WP-01 · Migrate `fleet_summary` to twin enrichment
Pattern: `patterns/reader-migration.md` (report-shaped — follow the
find-outdated-sites variant). Files: `src/main/mcp/modules/fleet/fleet-summary.ts`
(+ new test). Parallel-safe.
Accept: summary carries an observations/freshness header; per-population counts
unchanged; drift between ledger fleet-size and cache fleet-size surfaced as a
hint, not silently reconciled (mind CLAUDE.md "Fleet counts — what is real").

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

### [~] WP-03 · Reconcile `detect_drift` with ledger drift events  *(wp-03 worktree)*
Pattern: reader-migration + read `stateTwinFold.ts` drift hook first.
Files: `fleet/detect-drift.ts` (+ test). Parallel-safe.
Accept: tool reports BOTH its legacy computed drift and `state.drift.detected`
events from the ledger (`ledger.query({topicPrefix:'state.drift.'})`), labeled
by origin; discrepancies between the two detection paths are themselves listed.
This packet has extra value: it tests our own drift pipeline against the
existing detector.

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

### [ ] WP-05 · Jest roots + CI wiring  **(PREREQUISITE — elevated by calibration finding WP-02.1)**
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

### [ ] WP-06 · Review sweep
No pattern. Read-mostly. Parallel-safe (but run last, after WP-01..05 merge).
Accept: lint clean on all intelligence files; no leftover scaffold-isms
(`(e: any)` casts justified or typed properly against real `NexusServices`);
every new file has its header comment; a draft PR description exists at
`docs/intelligence/PR_DESCRIPTION.md` telling the story (model → ADRs → spine
→ readers → live re-check) with verification steps for a reviewer.

---

## Milestone 2 — designed and speccable now

### [ ] WP-07 · Wire entity service v0
Patterns: none exact — read `src/intelligence/entity/entityService.ts` (draft,
reviewed design in architecture.md §5) + `add-a-producer.md` for the wiring
discipline. **Serialized (core lock).**
Steps: (1) host bootstrap constructs `EntityService`, exposes on
`IntelligenceCore`; (2) producers call `ensure()` instead of raw
`provisionalEnvironmentId` (ids are identical by construction — assert that in
a test); (3) `local_wpe_link` data (see graph) imported as `pull_lineage`
aliases/links; (4) a `propose_site_pairings` MCP tool (read-only) surfaces
`proposePairings()` output with evidence.
Accept: all existing tests still green (ids unchanged proves adoption);
pairing proposals visible via the tool; no automatic pairing anywhere.

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
