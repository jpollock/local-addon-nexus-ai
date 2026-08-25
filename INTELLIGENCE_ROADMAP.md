# Intelligence Layer — Roadmap

*Branch: `poc/nexintelligence-data` (chain: `main` ← `poc/nexintelligence` ←
`poc/nexintelligence-ux` ← `poc/nexintelligence-data`, strictly linear) ·
updated 2026-08-25 · Companion docs:
[`docs/intelligence/architecture.md`](docs/intelligence/architecture.md) (ADRs 1–24, adopted),
[`docs/intelligence/reconciliation-site-environment-model.md`](docs/intelligence/reconciliation-site-environment-model.md),
[`docs/intelligence/implementation-audit-three-layer.md`](docs/intelligence/implementation-audit-three-layer.md),
[`docs/intelligence/TESTING_STRATEGY.md`](docs/intelligence/TESTING_STRATEGY.md),
packet detail in [`docs/intelligence/WORK_PACKETS.md`](docs/intelligence/WORK_PACKETS.md)*

The thesis, one line: intelligence for AI actors is five kinds of knowledge (state,
semantic, procedural, policy, episodic) drawn from nine sources, each with its own
supply chain — and the platform's job is to run those supply chains with provenance,
freshness, and governance built in. The LLM supplies reasoning; the layer supplies
everything situational.

---

## Done

**Milestone 1 — honest reads everywhere** *(closed, live-smoked).* The spine
(envelopes, append-only ledger, twins, SLOs, seam-linted); producers (webhook
tap, graph-sync chokepoint, backfill — all three proven in production);
six migrated readers + `verify_site_live`; Site Finder provenance; jest/CI
wiring; review sweep. User-visible: answers carry observation age and trust,
disclose staleness, and offer the live re-check.

**Milestone 2 — governance + assembly** *(CLOSED 2026-08-17 — owner sitting
judged: 5 of 6 E-01 criteria at pass³, the sixth recorded as standing
evidence for WP-20; zero FAIL across the eval corpus; every blocked
criterion owned by a registered packet).* Entity service wired as `site_links` consumer; policy & runbook repo
v0 (law loader, permissions mirror — translation, not enforcement); four
owner-reviewed runbooks; Ask/Tell recon; **context assembler v0 live in the
Docked Panel** — every chat turn mints a TaskId and writes a
`task.context.assembled` manifest to the ledger; R1 security fix (rehydrated
sessions get their system prompt back).

**Decided, governing what's next:** the three-layer model (Site / Environment
/ Working copy, per-type routing, two flows — candidate ADRs 21–23 pending
adoption); the id-freeze ruling; the implementation audit (A1–A9) proving the
model adopts additively; the nine-layer testing strategy.

## Earlier waves — complete (see WORK_PACKETS for the record)

*The rule for this phase: agents build what's already named; words get named
before wave-2 code freezes them; the owner clears the small decision queue.*

**Track A · Agents — Wave 1 (all parallel, launch together):**
- [ ] **WP-16** verify_site_live identity fix *(confirmed live defect; smallest packet)*
- [ ] **WP-13** eval spec runner → runs B-03/E-01/E-02 = **M2 formally closed**
- [ ] **WP-12b** vacuous chat-history test port *(optional filler, any tier)*

**Track B · Architect — words before schemas (gates Wave 2):**
- [ ] Shipped-behavior user docs — help articles for what M1/M2 already does
      (ages, re-check, proposals). Anything unwritable = a product finding.
- [ ] Working-backwards docs for the three-layer model ("your copy and the
      live site", "why can't I just push everything?") → yields the
      **controlled vocabulary** that WP-14/15/17 naming must conform to.
- [ ] Concept mockups (HTML) of the four new surfaces: where-am-I status ·
      safe-split offer · health report · grouped-Site listing — the briefing
      packet for real docs/design people when they join.

**Track C · Owner — the decision queue (~30 minutes):**
- [ ] Commit the pending docs (`git add docs/intelligence/ && git commit`)
- [ ] js-yaml → `dependencies` (recommended yes; latent packaging defect)
- [ ] Adopt ADRs 21–23 into architecture.md, or let the reconciliation sit
- [ ] Housekeeping: `git worktree remove .worktrees/wp-05; git branch -d wp-05 wp-7`
- [ ] After WP-13 reports: the consolidated eval sitting (SF parse + M4 +
      whatever lands OWNER-PENDING)

## Wave 2 — COMPLETE (2026-08-17)

1. [x] **WP-17** health surface + degradation tests
2. [x] **WP-14** sync-event producer + lineage edges — [x] **WP-18** e2e
       harness + real-ledger replay (parallel)
3. [x] **WP-15** divergence comparator + lineage-aware drift

**Exit state REACHED: lineage recorded (and the ledger IS the only durable
record — WP-14 finding), divergence measurable per flow in the controlled
vocabulary, pipeline watching itself with WARN-on-degradation.** Wave 1
(WP-16/13/12b + 13b/13c) and the M2 sitting closed earlier the same day.

## Now — Wave 3 (M3 opens)

**Parallel, launch together:**
- [x] **WP-19** gateway emission — DONE 2026-08-17 (E-02: 2→6 PASS, 0 spec-defects remain)
      *(unblocks 7 E-02 criteria; ChatService/registry seams)*
- [x] **WP-04d** phpVersions granularity — DONE 2026-08-17 (local match 1/37 → 37/37; 2 pins flipped on purpose, 7 added)
- [x] **WP-12b** vacuous chat-history test port — DONE 2026-08-17 (copy deleted; 6 ported; the R1-recreating pin waived)

**Then, sequential on the core lock:**
- [x] **WP-21** assembler task frame + per-type routing — DONE 2026-08-17
      (ADR-22 implemented; `nexus_where_am_i` ships the four-line status)
- [x] **WP-20** procedure distribution — phase 1 (design note: 7 positions,
      6 escalations, all ruled) + phase 2 four-fifths MERGED, all on
      2026-08-17:
  - [x] **20a** runbook registry (canonical-doc hash + ceiling; 3 loaded /
        2 refused live; ceiling basis ratified at adjudication)
  - [x] **20b** grants + arming (capabilityGrants additive v0; three P1
        paths; `nexus_load_procedure`; first `control.grant.*` producer;
        always-on index ratified — parity floor is now "no grants")
  - [x] **20c** delivery (runbook rides the trusted turn — whole once,
        hash+cursor after; four refusal vocabularies; **the two
        over-ceiling strict runbooks SPLIT at authority seams**:
        incident→containment+remediation, promotion→preflight+execute;
        ceiling raised 8→10 KB at the gate, both originals still refuse)
  - [x] **20d** attestation + sequencing (cursor folded from existing
        topics — no new topic needed; guard at BOTH chokepoints;
        narrative checkpoints named un-gateable; six judgement calls
        ratified)
  - [x] **20e** eval flip + UI seam — DONE 2026-08-17 (B-03: 4 PASS
        programmatic via a real end-to-end procedure probe, 7
        OWNER-PENDING on `NEXUS_EVAL_API_KEY`, 0 BLOCKED, 0 fabricated;
        `procedureView.ts` = the derivation seam, audit columns shared
        with the eval sheet at compile time). **WP-20 phase 2 is
        COMPLETE.**
- [x] **B-03 owner sitting** — JUDGED 2026-08-18: **B-03 PASSES** (4
      programmatic + 7 owner-judged, all pass³) — **WP-20 is accepted end
      to end; the anchor-slice acceptance eval is green.** E-01 re-sat on
      the new substrate: 5/6 pass³; K3 at 2/3 pending one re-sit after
      the harness arming-leakage fix (sitting adjudication in
      WORK_PACKETS). **Re-sit judged 2026-08-18: K3 pass³ — E-01 CLOSED
      at 6/6 judgeable; the seventh criterion waits on WP-25's incident
      producer.**

- [x] **WP-23** AgentRegistry fixture — DONE 2026-08-17 (fixture reads
      `src/` `__dirname`-relative; the uncompiled-worktree four-red trap is
      retired; the "residual" was a documentation error, dissolved by one
      `ls`)

**Docs & design (Track B, same day):** designer loop v4/v5 fully
reconciled — §6 capabilities answered 12/12, §7 questions 8/8, permissions
matrix verified against the shipped model verbatim; Controlled Vocabulary
**v1.1** (procedure rows, install/environments, synced, locative
phrasing); **the site-at-places matrix ratified** (environment-detail page
dies; divergence = comparator verdict, never cell inequality) — next
designer cycle waits on 20e's seam. ADR-17 amended (10 KB
canonical-document ceiling), ADR-20 amended (procedure re-assert instance,
policy-before-procedure order).

**Owner, standing (refreshed 2026-08-18 evening):** commit cadence on
`docs/intelligence/` (agents verbatim-commit anything uncommitted —
fidelity verified md5-faithful on every occurrence, most recently
six-for-six and two-for-two); worktree/branch housekeeping (merged
worktrees parked); the sixth must-not's sitting + pass³ on the two sat
must-nots (next Local session, one script); the WP-20f code packet on
your word. Earlier standing items ALL CLEARED: B-03 sat and passed,
first-real-pull smoked, WP-25 live-smoked, WP-20f ruled. **Registered,
not now:** WP-20g, guided-runbook ceiling (vacuous at 10 KB today),
pre-commit YAML parse for law docs, `arms_on:` authoring on the
shipped set, sentinel report-template finding (fabricated remediation
checklist — filed at the WP-25 smoke).

## Wave 4 — the incident closed, the evals bound, the episodic family real (all 2026-08-18)

- [x] **WP-24** sitting-harness rot retired by cause (lazy imports; stub deleted)
- [x] **WP-31** the live half-adherence incident CLOSED — exclusive tool scope
      (rule 5: a write the runbook declares nowhere is refused), capability-tense
      ack (attest words rewritten: "the platform can verify…"), arming-gap harness
      variant, refusal payload carries the governDoor. Regression-proved by the
      t1/t2 replay (below).
- [x] **WP-32** the scope carrier — selection→scope through arming (XD-15's eight
      pins), `ArmingRequest.scope?` widening ratified, and the derived fixture
      generator (`design-fixtures/declared-procedures.json`) that ended hand-built
      design fixtures forever.
- [x] **WP-33** the five journey evals in the registry, transcribed verbatim from
      the committed designer positions — BLOCKED-never-green applied to the
      experience. **WP-33b** re-transcribed J-Refusal from its governing text
      (8→12 criteria), mechanized the sitting verdicts, proved the stale-pin
      divergence UNREACHABLE. Runner: 17 PASS / 0 FAIL / 40 BLOCKED / 15
      OWNER-PENDING — every non-green names its owner.
- [x] **WP-25** the incident producer — sentinel findings + procedure aborts
      become `episodic.incident.recorded` (payload ratified field-by-field;
      SEVERITY_FLOOR high; resolution stricter than the note; version pair
      honest-empty pending a WP-19 micro). **Live-smoked on a real compromised
      test site: four real incidents folded, retrieved on the next chat turn —
      and the model caught the sentinel report's fabricated remediation
      checklist against the ledger, unprompted.** The episodic family is
      complete: all five knowledge kinds now have live supply chains.
- [x] **The first design sitting** (J-Refusal, the t1/t2 replay): both judged
      criteria PASS at pass@1 on the owner's answers; the incident's ask now
      produces two reads, an empty plan, and a held refusal. One copy-drift
      finding ("or tell me to") filed and independently confirmed by the
      designer's sixth must-not the same day.
- [x] **WP-20f RULED** (owner): the two production-scoped capabilities flip to
      DENY with no carve-out; remaining enablements materialize as visible
      `control.grant.issued` grants; new capabilities arrive denied.
      Additive-v0 is over. (Code packet registered, prompts on the owner's word.)

**In flight:** WP-34 — the citation convention (span syntax with the trailing-door
consuming contract, carrier instruction block at gate hold, the one
claim→record join, adherence evals + fixtures against from-designer-07's state
table). **Registered, sequenced:** the WP-20f code packet; WP-30 session
registry (J-Return's owner); WP-29 stage-consumes-seam; the M5 corroboration
surface packet (after WP-34); UX build 1.5 (the companion surface, eleven+nine
pins waiting); micros: WP-19 version-pair widening, renderer-safe extraction,
run.ts telemetry line.

## Wave 5 — the citation contract end to end, and the loop correcting itself (2026-08-19)

- [x] **WP-34** the citation convention — `cnv_6c2b1195` in the carrier
      (ratified verbatim), the ONE claim→record join, adherence evals, the
      `citation` manifest field (absent/null discriminator family).
- [x] **WP-35** the companion surface (UX build 1.5) — the fold's composite at
      the shipped 380px; designed, ratified, built, merged in one day.
- [x] **WP-36** the consent-binding investigation — a phantom incident
      dissolved by reading every channel; three real defects found and fixed
      (consent bound to its checkpoint, PanelChat reads isError, the card's
      subject is the checkpoint). The guard had held all along.
- [x] **WP-20f** the deny-flip SHIPPED — layer 1 deleted not filtered, three
      grants materialized visible, the two production caps deny with no
      carve-out, new capabilities arrive denied. Additive-v0 is over in code.
- [x] **WP-39** the harness/host seam retired with the guard that ends the
      class; **WP-37** scope + zero-eligible + planCheckpoint served on the
      stream (consumer micro WP-40 owed); **WP-38** the M5 corroboration
      render IN THE PRODUCT — ADR-24's three states drawn, no classifier,
      allowlist-of-one earned by measurement.
- [x] **WP-13b** the citation adherence sitting: nine runs, 113 markers, ZERO
      unresolvable, zero invented ids; document-presence finding filed to
      ADR-20's watch (full text changes behavior, not just audit).

**The night's theme, worth keeping:** the record corrected its own
architect twice (the phantom incident; the mis-billed harness diagnosis),
agents refused two briefs on measurement and were ratified both times, and
the protocol gained six rules — every one from a live occurrence, none from
speculation.

**Next wave (three disjoint locks):** the COMPARATOR SURFACE (scope's
ratified producer — unlocks the empty-run state, J-Inspect's eight, UX
build 2) · WP-20g (ToolGrant reach half; B-03's gate long satisfied) · the
registry micro bundle (verdict mechanization + empty-match MET). Micros:
WP-40 plan-line consumption, citation-peek supply, grant-fold. Owner:
sixth-must-not sitting + fold-in-place smoke. Designer: cycle four (the
Govern matrix against the deny-flip law).

## Waves 6+ — the packet cadence at scale (2026-08-19 → 2026-08-25)

*This section is a summary written at the 2026-08-25 review; WORK_PACKETS.md
is the record and wins any disagreement.*

- [x] **WP-41 → WP-56** — session registry (WP-30), arrival/re-entry surfaces
      (WP-46), the shell frame (WP-47), tier hierarchy and law work, the
      resolver groundwork. Each with lock-announce → gate → merge in the
      record.
- [x] **WP-58** — collision-safe site resolution (`resolveLocalSite`, required
      graph handle; the live collision-set test). Merged ahead of WP-57 by
      owner ruling.
- [x] **WP-57 + WP-59** — the agent task spine (`task.run.assigned`/
      `task.run.completed` bracket every run, `agentTaskFrame.ts`) and
      assembly on the agent path (bundles, manifests, ADR-7 fail-closed
      refusal binding at tier). **Merged 2026-08-25** — the merge WP-58's
      ruling sequenced, executed four days late; the 122-commit drift cost one
      resolver rename and one doc-pin expiry, both reconciled same day.
- [x] **WP-60/61/62** — tool-surface claims registered as an instrument (99
      claims, 191 sites), remedy-string honesty, bulk extraction.
- [x] **WP-63/64/65** — figure corrections (the published architecture
      artifact owes a republish from `wp64-figure-corrections.md`), the
      documented event-topic set pinned to source
      (`documented-topics.test.ts`).
- [x] **WP-67/68** — bulk outcome honesty and install-name resolution; the
      WPE false-reason sentence and the greener-than-the-run badge remain
      filed as the next packet's first items.
- [x] **The fleet collapse** — Properties IS the sites list; Installs and
      Fleet tabs retired; needs-you column; search-becomes-filters (designer
      rounds through 9, one touchpoint still open).
- [x] **The D7–D25 defect campaign** on the remote indexing pipeline (FTS
      quoting, SSH connection leak, double-indexing, ACF meta, CPT counts).
- [~] **The platform benchmark** — v1 built and corrected, v2 designed
      (comparison-first, rubric grading, ground truth as a program), P1/P2
      implementation midstream on this branch.
- [x] **The 2026-08-25 architecture review** — implementation verified against
      ADRs 1–24 (9 confirmed, 2 partial), test-authenticity audit (verdict:
      real), fresh eval tally 50/0/18/10, `rowTimeToIso` fabrication fixed
      (backfill skips, tap says why).

**Next locks (as of 2026-08-25):** UX build 2 (needs-you rows + audit view —
owns most of the 18 BLOCKED eval criteria; substrate shipped at WP-25/WP-30) ·
WP-58b (thread the collision arm to the 51 "not found" callers + the GraphQL
decline) · the comparator surface · pipeline observability phases 2–4 (the
e2e harness gates the incremental-indexing flip) · bench P3/P4 · the shell
phase A sitting. Standing owner items: the sixth must-not's sitting; the
version/release decision for the merge to `main`.

## The design workstream (consolidated 2026-08-18)

*Method docs: `moments-model.md` (the taxonomy, 1.3) ·
`DESIGN_DECISIONS.md` (the register, XD-1..19) · `DESIGN_PROTOCOL.md`
(how the loop runs) · journey evals J-Glance/J-Inspect/J-Act-small/
J-Return/J-Refusal bound at designer §1 (+ J-Act-big=B-03,
J-Investigate=D-02).*

**Designer cycles — 1, 2, 3 all CLOSED (2026-08-18), every artifact
ratified:** 1 — the two densities + the fold (digest rule,
fact-identity amendment, J-Refusal's governing text) · 2 — the ambient
triage + deferral affordance (badge-as-instrument, three recorded
ends, vocabulary v1.2: deferred/wake/end-the-deferral) · 3 — the
corroboration render against ADR-24 (trailing door, legacy state; the
first cycle where the contract preceded the drawing). Register at
**XD-1..24**; positions committed verbatim under `from-designer/`
(protocol's "both committed" made whole); fixtures generated, never
hand-built (the swap pattern, three applications). **Cycle 4 (NOW):
the Govern matrix + grants pages against the WP-20f law** — carries
the deferral's Settings side and the split-scope second run.

**Instruments, standing:** journey evals LIVE in the registry (WP-33/
33b); design sitting #1 done; owed the sixth must-not's sitting +
pass³ (owner's next Local session); the walks fold when
instrumentation is next touched.

## UX implementation — four phases (ruled 2026-08-18)

**Governing frame (2026-08-18): the moments model** — six working
moments (Glance, Inspect, Act-small, Act-big, Investigate, Return) +
Govern, with per-moment center/edge/never-shows and the complexity
budget as the fourth law beside the vocabulary, the rank model, and
derived-never-authored. `moments-model.md` + the designer companion
(worked walk, prototype audit, journey-eval skeletons). Phase 1.5 = M4's
two densities; needs-you/Return = M6 after WP-25; corroboration render =
M5's center. Journey evals precede surfaces, per the B-03 discipline.

"The UX per design" is four builds with four gates, in order:

1. [x] **Procedure surfaces in the Docked Panel — DONE 2026-08-18**
   (WP-26 `fe9e36d8` + WP-27 `0d14db03`): stream emission, the approval
   card as `canary_policy`'s producer (with the derived
   platform-can't-verify line), declared-procedure block, RB-A2
   collapsing checklist, abort groups. **Phase 1 complete** — the
   anchor slice's visible half is in the product.
2. **Next — audit view + Home needs-you rows**: WP-25 is DONE and
   live-smoked (the data exists); the triage design is ratified (eleven
   pins, XD-23); waits on WP-30 (session registry) for its query side.
   The corroboration render (M5) is designed (XD-24) and builds after
   WP-34's convention + eval half.
3. **Settings/grants pages — the WP-20f ruling is MADE (2026-08-18)**:
   deny-flip law is real; the designer is drawing the matrix against it
   NOW (cycle 4); build follows the ratified sheet + the WP-20f code
   packet. Build once, against the ruled flip — as planned, never twice.
4. **Last, with product buy-in — the full shell inversion** (rail, Sites
   matrix, sessions-by-consequence): ruled a rendering change on the
   entity graph, but it reimagines Local's main surface — product
   territory beyond this POC branch. The prototype stays the contract;
   the phase-1 demo is what sells it.

## Later — deliberately not now

- **M3 remainder:** assembler task frame (per-type routing), instruments
  (GA4/GSC summaries-in, audience→production routing), `code_ref` on
  git-backed observations, surfaces B/C/D (agent runtime = where ADR-7
  fail-closed bites), hub + tenancy + sync flows.
- **Backlog:** WP-04d phpVersions granularity; ToolGrant population (gated on
  eval B-03); reader Site-grouping enrichments; the flat-count semantics
  version change.
- **Post-M4 / product:** the UI inversion (one Site card, N environments,
  copies as tracked snapshots) — the entity graph makes it a rendering
  change, not a migration.

## Process cadence (standing)

Per packet: protocol DoD (TDD, mutation witnesses, parity pins, baselines).
Pre-merge/release: e2e journeys + real-ledger replay (once WP-18 lands).
Continuous: the health surface (once WP-17 lands). Per milestone: the eval
sitting **and the surface review** — docs + design review any new
user-visible language against the controlled vocabulary.

## Sequencing logic

Unchanged in spirit, updated in content: Wave 1 closes what's open; Track B
names things while agents can't collide with it; Wave 2 builds the
three-layer substrate on frozen ids and reviewed words; instruments and the
task frame then route through machinery that already describes itself.
Nothing waits on anything it doesn't actually depend on — and nothing ships
a name the docs couldn't write first.
