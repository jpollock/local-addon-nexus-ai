# Intelligence Layer — Roadmap

*Branch: `poc/nexintelligence` · 2026-08-15 · Companion docs: [`docs/intelligence/architecture.md`](docs/intelligence/architecture.md) (19 ADRs), [`docs/intelligence/eval-stress-test-set.md`](docs/intelligence/eval-stress-test-set.md), anchor-slice specs in [`docs/intelligence/anchor-slice/`](docs/intelligence/anchor-slice/)*

The thesis, one line: intelligence for AI actors is five kinds of knowledge (state,
semantic, procedural, policy, episodic) drawn from nine sources, each with its own
supply chain — and the platform's job is to run those supply chains with provenance,
freshness, and governance built in. The LLM supplies reasoning; the layer supplies
everything situational.

---

## Done (this branch)

- **Model & docs** — the conceptual model (interactive artifact), the eval
  stress-test set, the architecture doc with ADRs 1–19, and the anchor-slice
  spec pack (strict runbook, policy v0, envelope schema, DoD evals).
- **Step 1: the spine** — `src/intelligence/`: event envelopes (nine sources,
  nine trust classes, `observed_at` ≠ `recorded_at`), append-only SQLite ledger,
  emission middleware (satellite identity per ADR-14), twins as folds, freshness
  SLOs. Extraction seam enforced by lint (ADR-16).
- **Phase A: observation taps** — WP webhook events and every
  `GraphService.upsertSite/upsertPlugin` (CAPI sync, WP-CLI refresh) emit
  change-deduped, provenance-stamped observations. Drift between observers
  surfaces as `state.drift.detected` events.
- **Phase B: seeding + first reader** — one-shot backfill of graph.db
  (~5k facts, honest `observed_at` from row timestamps, soft-deletes excluded);
  fleet twin reads (`byFact`/`search`); `find_sites_with_plugin` migrated —
  answers now carry observation age, trust class, stale flags vs SLO, and
  drift hints. User-visible result: the assistant discloses "data is ~9h old
  (cached); I can run a live check before you act."

## Milestone 1 — Honest reads everywhere

Finish the satellite read path.

- [ ] Migrate remaining fleet readers on the established template
      (`find_sites_with_theme`, `find_outdated_sites`, fleet health, Site
      Finder filters): entity join via provisional ids, optional core via
      `coreRegistry`, enrich-don't-replace, drift-as-signal.
- [ ] **Live re-check path**: gateway action that pulls live state, emits the
      fresh observation, updates the twin — the pull-live gate (eval B-01)
      behind the "I can run a live check" offer.
- [ ] Team review of this branch; new test suites into `test:ci`.

## Milestone 2 — The anchor slice end to end (ADR-18/19)

"Update WooCommerce across my staging sites" runs the full journey:
policy ambient → runbook pushed → history consulted → state pulled live →
gated execution → outcome + rationale emitted.

- [ ] **Entity service v0** (migration step 3): aliases table, local↔WPE
      pairing queue (pull-lineage > user-link > heuristics, each with
      confidence + established_by), adoption of the provisional ids.
- [ ] **Policy & runbook repo v0** (step 4): translate
      `wpeOperationPermissions` + site exceptions into the constraint
      registry (M4 evals stay green as the regression harness); author the
      five v0 runbooks in the ADR-17 format (bulk-update, promotion, pull,
      diagnose, incident response).
- [ ] **Context assembler + bundle manifests** (step 5), wired into the
      product's own agent surface (ADR-19). Fail-closed on stale law for
      autonomous actors (ADR-7); mandatory consult-history retrieval on
      risky capabilities.
- [ ] **Definition of done**: evals B-03, E-01, E-02 pass against the real
      ledger at pass^3 (harness rules H-01/H-02).

## Milestone 3 — The hub

- [ ] Reopen tenancy (ADR-11 watch item) with real compliance requirements.
- [ ] Hub stores: ledger, entity graph, policy & runbook repo canonical copies;
      control plane (grants, thresholds, audit views).
- [ ] The four sync flows: episodic ↑ append-only · policy/procedure ↓
      version-pinned, fail-closed · state federated · semantic lazy.
- [ ] Multi-actor grants + session auth on the satellite (watch item 4).

## Milestone 4 — Instruments, feeds, and the adjacent jobs

- [ ] GA4/GSC + vulnerability-feed conductors (summaries-in, raw
      query-through — ADR-13; `state.instrument.summarized`).
- [ ] Adjacent jobs from the use-case gallery become products: vulnerability
      triage against live plugin inventory · monthly client report ·
      traffic-drop correlation (instruments × episodic) · safe-update
      orchestration with clone rehearsal.

## Continuous

- Eval families land with the components they test: Family A (source/trust)
  with the re-check path; C (governance) with the policy registry; E (loop)
  with the assembler; F (injection) before any autonomous mode ships.
- Harness: pass^k on gated writes, programmatic end-state verification,
  cost-of-pass tracking (H-01…H-07).
- Loop plane: distillation of runs into runbook drafts + PR-based review
  arrives with the runbook repo (it is literally a pull-request workflow).

## Sequencing logic

Each milestone makes the next one's data or decisions exist: readers needed
twins (done) → the slice needs entities and law (M2) → the hub needs a slice
worth syncing (M3) → instruments need a hub to conduct from (M4). Nothing
waits on anything it doesn't actually depend on.
