# Vision coverage review — where the intelligence layer stands

*2026-08-26 · independent deep-dive over `docs/intelligence/`, `INTELLIGENCE_ROADMAP.md`, and the tree on `fixes-082526`. Method: every WP number in `WORK_PACKETS.md` traced to its last recorded state (checkbox headings are stale past WP-33 — the lock-announce → gate → merge entries are the record); claims spot-checked against `src/main/intelligence-host/`, `tests/intelligence-evals/`, `law/`, and the 2026-08-25 truth-sweep ground table.*

---

## The short answer

The vision's **core loop is built and live**: all five knowledge kinds have supply chains, the ledger is the durable record, every gated act emits, chat *and* (since WP-59, 2026-08-25) agent runs assemble context and write manifests, the deny-flip governance law is real in code, and the procedure plane (registry → grants → delivery → attestation → eval) is complete end to end with B-03 passed at the owner sitting. Milestones 1–3 are closed with sittings on the record; the eval registry stood at **50 PASS / 0 FAIL / 18 BLOCKED / 10 OWNER-PENDING** at the 2026-08-25 review, with zero FAILs and every non-green naming its owner.

What's genuinely left falls into three buckets: **(a) registered packets that never landed** (a short, findable list below), **(b) shipped-with-named-residuals** — things packets deliberately declared "not done" that nothing has since picked up, and **(c) vision aspects with no packet at all** — mostly the deliberately-deferred hub/instrument half of the architecture, plus two quieter gaps worth naming.

---

## 1 · Packet ledger

### Delivered and accepted (the record is consistent)

WP-01→18 (M1/M2 spine, readers, entity service, policy repo, assembler v0, eval runner, sync producer, comparator, health surface, e2e harness), WP-19/19b, WP-20 **complete including phase 2 a–e** (the `[ ]` checkboxes on 20/20c/20d/20e in WORK_PACKETS.md are stale — all five sub-packets merged 2026-08-17 and B-03 passed at the 2026-08-18 sitting), WP-20f (deny-flip shipped), WP-20g (merged 2026-08-19 — "BUILD ACCEPTED at the merge boundary"), WP-21/21b, WP-22/22b, WP-23, WP-24, WP-25 (incident producer, live-smoked), WP-26/27/28 (procedure surfaces — the `[ ]` on WP-26 and the first WP-27 heading are stale; both merged `fe9e36d8`/`0d14db03`), WP-30 (session registry), WP-31→39, WP-41→50 (comparator, registry bundle, Govern matrix, law review, arrival/re-entry, shell frame, Now verdicts, front door, producers-pay), WP-51, WP-52, WP-54/54a/54b, WP-55 (Now screen end to end), WP-56/56a, WP-57 (agent task spine), WP-58 (collision decline), WP-59 (agent assembly + refusal bind, **COMPLETE 2026-08-25**), WP-60/61/62 (tool-claims instrument, remedy honesty, truncation fixes), WP-64 (figure verification), WP-65 (data-holdings doc + `documented-topics.test.ts`), WP-67/68 (bulk honesty, install-name resolution — with their two filed follow-ups paid on `fixes-082526`: badge colour + external read-failure honesty).

Plus the non-WP campaigns the roadmap records: the fleet collapse (Properties IS the sites list), the D7–D25 remote-indexing defect campaign, the docs truth sweep (phases 1–7 complete, strict build green), and the 2026-08-26 `fixes-082526` packet (agent-addressed grants, account write bound, Tier A 1–8, the merged permissions pane — closing owner items 7/8).

**Numbering note:** WP-53 and WP-66 do not appear anywhere in the record — they were never used. Not lost work, just gaps in the sequence.

### Registered but NOT landed (bucket a — the honest open list)

| Packet | What it is | Last state in the record |
|---|---|---|
| **WP-29** | The stage (main-app chat) consumes the procedure stream — same emitter, N subscribers; promotion pin family | Registered 2026-08-18; still open. Sequenced behind the phase-1.5/comparator-surface family. A strict runbook arming in main-app chat is still prose + a tool row today. |
| **WP-58b** | Thread the collision arm to the ~51 "not found" callers + the GraphQL decline | Registered at WP-58 merge; named in the roadmap's Next locks; no build entry. |
| **WP-51a** | The fold must never supersede a resolved incident's opening event | Registered; observation pinned in `sentinelCausation.test.ts` as a starting fact; no build entry. |
| **The comparator surface / UX build 2** | Needs-you rows + audit view — **owns most of the 18 BLOCKED eval criteria**; substrate shipped (WP-25 data + WP-30 query side both done) | Designed and ratified (XD-23, eleven pins); the roadmap's top Next lock; not built. |
| **WP-30b** | Contract-widening items accepted as measured limits at WP-46 (incl. "no act" absence statement) | Registered, rides with the designer bundle; no build entry. |
| **Micros** (WP-34-era) | citation-peek supply, grant-fold, verdict mechanization/empty-match remainder, `--json`/stdout | Last listed as registered ~2026-08-19/20; no landing entries found. Small, but they're still on the books. |
| **Pipeline observability phases 2–4** | The 2026-08-23 keystone plan; phase 1 pulled forward (pipeline.run line + Background Work activity) on fixes-082526 | Phases 2–4 open; the e2e harness gates the incremental-indexing flip. |
| **Platform benchmark P3/P4 (+P5 ranking in flight)** | v2 comparison-first design (2026-08-25) | P1/P2 midstream on this branch; latest commit is the 207-tool bucket assignment for P5. |
| **Shell inversion — phase A close-out** | The shell sitting (owner boots mode-ON, walks all six moments, pass³) + demo assembly; then phase B is product territory | WP-46–49 all merged, so the build half of phase A is done; the sitting and the demo artifact are the missing acceptance. |

### Shipped with named residuals nothing has picked up (bucket b)

These are the "NOT DONE, and named rather than implied" lines inside accepted packets — the record's own honesty, collected in one place:

- **WP-59:** no agent **consumes** the context bundle (zero change to any model call — by ruling, pending evidence); the refusal **bind has no UI** (a bound run reports only via error path + ledger); **v0 holds no capability grant for agents** — the procedure plane stays dark on agent runs until "phase 3" of the agent-actor plan lands. This is the biggest open seam in the closed loop: agents now *write* full history but still don't *read* the assembled intelligence.
- **fixes-082526 packet residuals (recorded in its spec):** no direct pane→agent-workspace door; account-refusal copy not enriched at call sites; capability-keyed issuance retained for the one-row matrix.
- **WP-67's held finding:** the WPE false-reason sentence was filed as a next-packet item; the badge-colour half was paid on fixes-082526 — verify the reason-sentence half was too (the Tier-A note names "external read-failure honesty," which reads like it, but the record doesn't say so explicitly).
- **WP-64:** the **published architecture artifact still owes a republish** from `wp64-figure-corrections.md` (roadmap says so as of 08-25).
- **Owner standing items (roadmap, 08-25):** the sixth must-not's sitting + pass³; the version/release decision for the merge to `main` (note the docs-truth-sweep finding: first push of main republishes `docs-site/` via GitHub Pages — the sweep cleared the gate, but the release decision is still open).

---

## 2 · Vision aspects with no packet coverage (bucket c)

Measured against architecture.md's own frame — five types · nine sources · control plane + enforcement fabric · four distribution patterns · closed loop — and its §3A "system as built" honesty section:

**Deliberately deferred, and the docs say so (no surprise, listed for completeness):**

- **Hub ↔ satellite sync, tenancy, multi-machine** — §8 exists at contract level only. §3A states it plainly: *there is no hub and no Postgres; the satellite is the whole system.* Everything hub-shaped (canonical ledger at hub, policy repo sync, `via: gw_hub` actors) is unstarted. This is the largest structural distance between the vision doc and the tree, and it's a G1 (topology-as-profile) claim that has never been exercised beyond the all-local profile.
- **Instruments as a source class** — `state.instrument.summarized` (GA4/GSC-class conductor rollups, trust: measured) is documented and carries a declared unbuilt-allowance in `documented-topics.test.ts`. The web-analytics/SEO agents exist, but their data never enters the ledger/assembler — the "audience → production routing" idea has no supply chain. The nine-source taxonomy is therefore live for platform/agent/human classes and dark for the instrument/audience classes.
- **`code_ref` on git-backed observations**; **surfaces B/C/D** of the M3 remainder — named "Later" in the roadmap, no packets.
- **Multi-org federation, collaborative runbook editing, workflow engine** — explicit non-goals; correctly absent.

**Quieter gaps the docs *don't* headline (worth a decision each):**

1. **`semantic.content.indexed` is documented but genuinely never emitted** (a WP-65 finding). Semantic intelligence flows Local-walk → graph.db → vectors.db entirely *outside* the event backbone — so indexing has no provenance envelope, no lineage, and the closed loop doesn't see it. The pipeline-observability plan (phases 2–4) would largely close this; worth stating that mapping explicitly when that work starts.
2. **The episodic import story.** §4.2 reserved `episodic.*` for imported histories; four live producers now write it (corrected in the doc 08-25), but *actual* imported histories — the original meaning — have no path at all.
3. **The closed loop for agents is half-closed** (WP-59's residual above): emission is structural, consumption is not. G5 says intelligence survives model swaps; true for storage, untested for use, since no agent prompt ever includes the bundle.
4. **The remaining 10 OWNER-PENDING eval criteria** need `NEXUS_EVAL_API_KEY` sittings — they're gated on you, not on code.
5. **ADR audit:** the 08-25 review's "9 confirmed, 2 partial" verdict is cited in the roadmap but I could not find *which two* are partial written anywhere in docs/ — if that lives only in a session transcript, it's worth a line in architecture.md §3A before it's lost.

---

## 3 · Record hygiene (small, cheap to fix)

- **Stale checkboxes in WORK_PACKETS.md:** WP-20, 20c, 20d, 20e, 20f, 20g, 26, 29, 30 and the first WP-27 heading still read `[ ]`/unresolved while later entries mark them merged (except WP-29, which really is open). Anyone grepping `"[ ] WP-"` gets 7 false positives and misses real opens like WP-58b/WP-51a, which have no checkbox at all. One pass flipping headings — or a one-line "checkboxes end at WP-33; the gate entries are the record" note at the top — would make the file greppable again.
- `docs/GROUND_TRUTH_AUDIT.md` correctly self-flags as stale and points to the 08-25 sweep — fine as is.
- The roadmap (updated 08-25) is accurate against the packet record everywhere I checked; its "Next locks" list matches this review's bucket (a) almost exactly, which is itself good evidence the record is honest.

---

## Suggested order, if you want one

1. **The comparator surface / UX build 2** — it single-handedly owns the 18 BLOCKED criteria and the substrate has been ready since WP-30; nothing else moves the eval tally as much.
2. **Agent bundle consumption** (WP-59's phase-3 seam) — the loop's read side for unattended actors; it's the vision's G5 made real, and it unblocks the agent half of the procedure plane.
3. **WP-58b + WP-51a + the micro bundle** — small, registered, and each protects an already-shipped guarantee.
4. **The two sittings you owe yourself** (sixth must-not; shell phase A) + the OWNER-PENDING evals — ~an afternoon on the record.
5. **Pipeline observability 2–4** — also quietly closes the semantic-provenance gap (§2.1).
