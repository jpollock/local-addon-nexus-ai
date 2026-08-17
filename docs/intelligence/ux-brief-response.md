# Architecture response — to the intelligence-layer UX brief

*2026-08-17 · From the architect + owner, responding to `handoff/Architecture
brief` §6 ("what you must provide") and §7 ("open questions"). Verdict up
front: the prototype is built on the real model, most of §6 already ships,
and three of its ideas are good enough that we are adopting them into the
architecture record. Recalibrations are listed last and are small.*

---

## 1. What we are adopting FROM the prototype

**A1 · Derived, never authored.** Your §3 invariant — "no sentence about
data may be authored where the data exists" — is the UI-side statement of
what the ledger does below (receipts are events; manifests are emitted, not
written). We are adopting it as a named surface principle beside S1–S4, with
your fifteen-rounds provenance as its justification. When these surfaces get
built, `SITE_READS`-style derivation maps are the spec, not the screenshots
— exactly as your README warns.

**A2 · Ceremony scales with consequence, not turn count.** Reads quiet and
quieting; writes loud every time, no decay. This is better-stated than
anything in our docs and it resolves a tension we had left implicit (the
freshness chips habituation problem). Adopted as surface doctrine.

**A3 · The four clocks.** Moment-true / period-accumulating / daily-closing
/ streaming, each with its own sentence, and a source-class clock never
claiming to be fresher than the records beneath it. This is a genuine
contribution to the M4 instruments design (ADR-13 territory) — today the
layer only implements the first clock (state observations age continuously
against per-class SLOs). The other three become requirements on the
instrument conductors when they are built. Registered as a candidate ADR for
the instruments milestone.

**A4 · "I won't offer to skip the backup."** That sentence is our
unwaivable-gate doctrine (BackupGate, rb.promotion-execute ab.backup-failed
— the execute half of the WP-20c split of rb.staging-promotion)
rendered in the first person. Keeping it verbatim.

## 2. Section 6, answered — the capability scorecard

| # | You need | Status | Where it lives |
|---|---|---|---|
| 1 | Per-fact provenance + age | **SHIPS** | Twin facts carry `observed_at`, trust class, source system, per fact — this is M1's whole thesis. |
| 2 | Source-class clock semantics | **PARTIAL** | Moment-true ships (with per-class SLOs — see recalibration R1). The other three clocks arrive with instruments (M4); your taxonomy is now their requirement (A3). |
| 3 | Read-only verify path | **SHIPS** | `verify_site_live`: per-site, real transport, records observations only, unreachable reports as unreachable. Per-site timeout surfacing: partial — verify before committing that promise. |
| 4 | Stored vs observed as separate records; correction supersedes without deleting | **SHIPS BY CONSTRUCTION** | The ledger is append-only; nothing is ever deleted; a correction is a new observation that outranks by recency + trust, and the old value remains queryable forever. |
| 5 | Task-level audit, one correlation id, reconstructable, local | **SHIPS** | TaskId per turn; `task.context.assembled` manifest (sources read, budget, freshness); `task.action.executed` / `outcome.recorded` / `rationale.recorded` on every gated act, both dispatch paths; causation chains approval→action. All local SQLite. |
| 6 | Capability model: standing policy, per-site resolvable, stricter-never-looser, spend has no code path | **PARTIAL + ONE CONFLICT** | Standing policy ships (`wpeOperationPermissions`, per-environment, per-site exceptions; mirrored into the constraint registry). "Spend money has no code path" is true today. **Conflict: our shipped per-site exceptions LOOSEN (grant production writes where the default denies) — your rule says sites may only be stricter. Owner ruling required; see §4.** |
| 7 | Gate enforcement below the UI | **SHIPS** | BackupGate runs inside the tool handler, not the UI; the model cannot proceed past it, and the M4 eval family is its regression harness. |
| 8 | Write results update the model | **SHIPS (mostly)** | Writes emit observations through the tap, so stored state revises. The "later live check doesn't attribute our own change to an outside actor" half: actor identity is on every event, so it is *expressible* — but no reader currently renders "this change was ours." Small, real gap; noted for the reader pass. |
| 9 | Structured refusal (not-connected / not-permitted / not-known) | **PARTIAL** | The three states exist separately (health's "not reporting"; gate denials naming the settings path; honest-null in readers) but no unified refusal shape ties them. Good candidate for a small packet once your refusal surface is firm. |
| 10 | Session-scoped context, enumerable, per-item "used here" | **PARTIAL** | The manifest enumerates what was retrieved and its freshness — that is "available." Your "used here" (did the model's answer actually draw on it) is Q4; answered below. |
| 11 | Session state as data | **PARTIAL** | Turn history and durable action counts ship; pending approvals are in-memory today. Enumerable-for-Home needs a thin query surface — cheap, unbuilt. |
| 12 | Change history with hold duration | **SHIPS** | `previous_observed_at` on drift events; change reports already render "held for 11 days." Your change-report screen has its data waiting. |

Net: 6 ship, 1 ships-by-construction, 4 partial with named gaps, 1 conflict
needing an owner ruling. Nothing in §6 requires redesign; nothing is
infeasible.

## 3. Section 7 — the eight questions, answered

**Q1 · Does draft-publish-to-live exist?** No — and you independently
re-derived our docs pressure-test finding №4, which is confirmation the
dead-end is real. It is not yet scoped; it is now formally on the M3/M4
boundary list as the prerequisite for shipping the safe-split dialog
(the offer must not dead-end). Until it is built, the split's
"shouldn't go up" half ends at *"publish these on the live site — here's
where"* (a pointer, not an action). Cost: moderate (a content-flow write
path with its own gates); decision is the owner's at M3 planning.

**Q2 · What may move scope?** Your rule (narrow-only, announced, reversible)
is accepted as the contract. "Those two" resolution: the entity references
in prior turns are ids in the transcript's tool results, so it is
mechanically derivable — but treat it as assist-with-confirmation, not
silent narrowing ("Narrowing to Alpha and Delta — say 'all sites' to widen
again"), which also answers reversibility: scope is per-turn state in the
task frame, never destructive.

**Q3 · Is the freshness threshold global?** **No — and this is the one
place the prototype must change.** The shipped layer has per-fact-class
SLOs (`DEFAULT_FRESHNESS_SLOS`: plugin state 8h, core version 24h, others
per class; owner-tunable constants). It is policy, not heuristic — the
constraint registry mirrors settings, and SLOs sit beside it. Wire the ⚠
markers to the per-class SLO the layer reports, not a single 6h rule; the
layer already exposes `sloSeconds` per fact so the UI never hardcodes.

**Q4 · How is "used here" determined?** Honestly derivable at two levels,
and the UI should distinguish them rather than promise one: *supplied* (in
the manifest — certain) and *cited* (the answer references it — checkable
against the trace, the same mechanism our fabrication eval uses). "The
model silently relied on it" is NOT derivable and must never be claimed.
Recommended rendering: "supplied to this answer" / "quoted in this answer";
drop "used here" as a third unprovable state.

**Q5 · Correction lifetime?** Falls out of the ledger's construction: a
correction is an observation (human actor, high trust) — it persists across
sessions because everything does. A later contradicting sync does not
silently overwrite it; it produces a NEW observation and a drift event, and
the disagreement is surfaced (that is what drift is for). So: corrections
survive; contradictions become visible conflicts, not reversions. The
"disputed" marker itself is session-state today; making disputes durable is
a small addition if the design wants it — say so.

**Q6 · Partial failure mid-write?** Ruled by the shipped runbook doctrine:
per-site outcomes are already recorded (`task.outcome.recorded` per
target), aborts stop the batch without retrying (`ab.promotion-failed`
forbids retry; a second attempt on a half-written target compounds), and
rollback is never automatic — the abort names the backup id and hands the
restore decision to the owner. So: halt-and-report at the failing site,
completed sites stand (each has its own backup), UI presents per-site
results with the restore path named. Not per-batch rollback, not a silent
continue.

**Q7 · Cost of the honest path?** Where it binds, measured: audit writes
are local SQLite appends — negligible at any fleet size. Per-fact
provenance is already paid (it is how the store works). Live checks are the
expensive promise: they are per-site real connections, so the design is
right to scope them to named sites and never fleet-wide by default; at 367
environments a "check everything" affordance must not exist (offer "check
these N" with N visible). Context assembly measures its own token budget in
the manifest — surface it if you want a cost affordance.

**Q8 · Local-only storage?** True today and enforced by construction:
ledger, audit, entities, attachments-as-staged all live on this machine;
tenant is literally `'local'` (ADR-11), nothing syncs anywhere. The honest
caveat for the UI's promise: the hub milestone (M3+) introduces *opt-in*
sync flows (episodic up, policy down). The wording that stays true across
both worlds: "stored on this Mac" today, and when the hub exists the
sentence becomes a setting, not a violation. A second machine today =
independent record (satellite identity is per-machine, by design).

## 4. Recalibrations (small) + the one owner ruling

**R1** — per-class SLOs, not a 6h global (Q3 above). One derivation-map
change (`STALE_AFTER_HOURS` becomes per-class, fed by the layer).
**R2** — the tool behind "Currently in" is `nexus_where_am_i` (the
`site_status` name was taken by a shipped tool; both phrasings blessed).
**R3** — "used here" splits into supplied/cited (Q4).
**R4 · OWNER RULING NEEDED** — exception directionality (§2 item 6): the
designer's capability model says a site may be *stricter* than the default,
never looser; our shipped per-site exceptions exist precisely to LOOSEN
(enable production writes on one install while the global default denies).
Both models are coherent; they cannot both be the story the Settings screen
tells. Options: (a) keep loosening exceptions and the design's Settings
copy changes ("the default denies; exceptions grant"); (b) adopt
stricter-only and migrate the exception semantics (a breaking policy
change with M4-eval implications). **RULED (owner, 2026-08-17): option (a).** Deny-by-default with explicit
narrow grants IS the stricter posture, expressed per-site. Semantics
unchanged, no M4-eval churn; the UI concept renames "exceptions" → "site
grants" and the Settings copy tells the grant story ("the default denies;
grants allow, narrowly"). Designer: adjust §5's capability-model row and
the Settings screen copy accordingly.

## 5. Direction — where we'd point the next design cycle

1. **Procedure surfaces (WP-20 is next on our board).** A strict runbook
   executing means checkpoint-by-checkpoint attestation in the transcript:
   what does cp.backup → cp.approval → cp.promote look like as turns? Your
   gate treatment is the foundation; the runbook adds *named, ordered*
   gates with abort paths. This is the highest-leverage unbuilt surface,
   and B-03's eleven criteria are effectively its acceptance script.
2. **Environment detail + the grouped-Site row** (your not-built list):
   now buildable against real data — lineage edges, divergence per flow,
   `nexus_where_am_i` — worth designing from live shapes rather than
   fixtures.
3. **The health surface** (`nexus_intelligence_health` ships: OK / needs a
   check / not reporting, translated producer names): where does it live in
   your IA — Settings? A quiet row on Home when degraded?
4. **Correction durability** (Q5): if disputes should persist, say so and
   we'll spec the small addition.
5. **Scenario switch as a keeper:** your Backup-fails / Sites-unreachable
   scenario harness is the UI twin of our degradation tests (TESTING_
   STRATEGY layer 7) — keep it alive as the design-side chaos rig, and
   we'll keep the failure semantics in sync with the eval fixtures.

*Response prepared from the shipped tree at `poc/nexintelligence`
(M1+M2 closed, Wave 3 near-complete). Everything cited is merged code or a
recorded ruling, referenced by packet in `docs/intelligence/WORK_PACKETS.md`.*

---

## 6. Loop closed — designer v2 received (2026-08-17, same day)

The revised package landed with every recalibration implemented in the
build, not just acknowledged:

- **R1** — `STALE_AFTER_HOURS` deleted; per-class SLOs fed by the layer
  (plugin 8h, core/PHP 24h, certificates 168h), with the behavioral proof
  visible on the Site screen (a 6-day-old SSL read unflagged beside a
  flagged 3-day-old plugin read — exactly the semantics the layer ships).
- **R3** — "used here" replaced by the three honest states: supplied /
  quoted-in-this-answer / connected-but-neither. Silent reliance never
  claimed.
- **R4** — Settings tells the grant story; "Allow just this install" is
  now "Grant this install."
- **Q1** — the safe split's content half ends in a pointer, not a
  dead-end action.
- **Q2** — narrowing announces itself with the widening phrase offered.

**Status: the design and architecture records are fully reconciled — no
open disagreements, no unanswered questions on either side.** The next
design cycle's target stands as §5.1: the procedure/runbook execution
surfaces, in time to meet WP-20's build. The prototype's scenario switch
remains the design-side chaos rig, to be kept in sync with the eval
fixtures.
