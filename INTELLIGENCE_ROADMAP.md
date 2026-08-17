# Intelligence Layer — Roadmap

*Branch: `poc/nexintelligence` · updated 2026-08-16 · Companion docs:
[`docs/intelligence/architecture.md`](docs/intelligence/architecture.md) (ADRs 1–20 + candidates 21–23),
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

## Now — three tracks, one page

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
