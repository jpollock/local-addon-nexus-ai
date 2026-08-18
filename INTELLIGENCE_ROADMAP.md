# Intelligence Layer — Roadmap

*Branch: `poc/nexintelligence` · updated 2026-08-17 · Companion docs:
[`docs/intelligence/architecture.md`](docs/intelligence/architecture.md) (ADRs 1–23, adopted),
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

**Owner, standing:** commit cadence on `docs/intelligence/` (agents
verbatim-commit anything uncommitted, verified md5-faithful twice);
worktree/branch housekeeping (many merged worktrees parked);
`NEXUS_EVAL_API_KEY` for the B-03 sitting (seven OWNER-PENDING once 20e
lands); the first-real-pull live smoke (chip + sync producer + health
line + where_am_i at once — needs ABI ELECTRON: `npm run rebuild` first,
last measurement left the tree on system Node). **Registered, not now:**
WP-20f deny-flip (MANDATORY ruling attached: shipped-enabled must not
survive the flip for the two production-scoped capabilities), WP-20g, guided-runbook ceiling (vacuous at 10 KB
today, revived by any full-body guided delivery), pre-commit YAML parse
for law docs, `arms_on:` authoring on the shipped set.

## UX implementation — four phases (ruled 2026-08-18)

"The UX per design" is four builds with four gates, in order:

1. [x] **Procedure surfaces in the Docked Panel — DONE 2026-08-18**
   (WP-26 `fe9e36d8` + WP-27 `0d14db03`): stream emission, the approval
   card as `canary_policy`'s producer (with the derived
   platform-can't-verify line), declared-procedure block, RB-A2
   collapsing checklist, abort groups. **Phase 1 complete** — the
   anchor slice's visible half is in the product.
2. **Next — audit view + Home needs-you rows**: after WP-25 (incident
   producer) and a session-state query micro. Includes the corroboration
   render (the sitting-economics surface).
3. **After the WP-20f ruling — Settings/grants pages**: the designer's
   copy is written for the deny-by-default destination; build once,
   against the ruled flip, never twice.
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
