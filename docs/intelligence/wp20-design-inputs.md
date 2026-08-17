# WP-20 design inputs — from the designer's §5b (v3) + architect responses

*2026-08-17. The designer's procedure-execution surfaces (brief §5b, prototype
runbook session, RB-A/A2/B/C candidates) arrived while WP-20's design note is
being drafted. This doc is the bridge: §5b digested for the WP-20 agent, the
designer's open item answered, and the RB-B ruling. The WP-20 design note's
item 7 (the UI seam) should be written AGAINST this, not alongside it.*

## 1. §5b's decisions (designer, adopted as the surface contract for procedure execution)

- **The procedure is declared before the run** — named, versioned, strict,
  every checkpoint listed while approval is pending. Consequence for the
  layer: half-adherence (B-03's central must_not) becomes *visible structure*
  — a checkpoint with no attestation — rather than a transcript confession.
  The declaration is the bundle's `procedure` rendered; its version is the
  hash ADR-20's mechanism extends to.
- **Unasked-for steps are badged** — "runbook added this," each with its own
  reason line. The canary's reason line is a scored transcript check (the
  eval and the surface share the criterion).
- **Completion shrinks the run** — attested checkpoint → one line; finished
  run → one row; the summary GENERATED from the attestation, never authored
  beside it (derived-never-authored, again).
- **Canary policy is chosen at approval** — pause-after-canary (default) vs
  continue-if-clean, decided once in the approval rather than interrupting
  mid-run. Consequence: the approval event's payload carries the policy;
  attestation of cp.canary references it.
- **Exclusions are stated** — the halted site appears in the dry run as
  "halted — skipped" with the explicit promise not to start it.

## 2. The designer's open item, ANSWERED — the per-site outcome shape ships

The abort affordance needs to say which sites are done and what restoring
each means. That shape exists in the ledger since WP-19; render from it:

**Per target site, from `task.outcome.recorded` (one event per target,
`result_scope: 'call'`):**

```
{ site: <entity id → rendered name>,
  result: 'updated' | 'skipped' | 'failed',
  from_version, to_version,          // when applicable
  observed_at }
```

**joined with the attested cp.backup ids** (per-site backup ids are a
checkpoint attestation in rb.bulk-plugin-update; the BackupGate produces
them and WP-19's `task.action.executed` records the acts), and with
causation back to the approval event.

**The abort affordance therefore renders four honest groups:**
1. **Done, standing** — per Q6's ruling, completed sites stand; each shows
   `updated 9.4.1 → 9.5.0 · backup <id>` and "restorable" — where restore is
   a NAMED, SEPARATE, GATED action per site, never automatic and never
   implied to be part of aborting.
2. **The failing site** — where the halt happened, with its recorded failure.
3. **Skipped** — with the recorded reason ("halted — skipped").
4. **Untouched** — everything the halt prevented; aborting leaves these
   exactly as they were, and the copy may promise that because the gateway
   events prove it.

Copy rule (vocabulary): "abort" stops FUTURE work; it does not undo done
work — the affordance's first line should say exactly that, derived from
group counts ("Stop here? 2 sites already updated and standing; 3 untouched").

## 3. RB-B ruling — the two-column belongs to the audit view. Agreed, and adopted.

The designer's instinct is ratified: RB-B (what-the-runbook-says beside
what-the-run-did) is too wide for a session but is the strongest
half-adherence defense built so far — and it is precisely the human-facing
render of the machine artifacts we already have: the runbook's checkpoint
list (the spec column) beside the attestation/gateway events (the actual
column) is the same spec-vs-actual shape as the eval harness's judgment
sheet and detect_drift's classification. Adopted as:
- **Transcript**: RB-A2 (collapsing checklist) per §5b.
- **Audit view** ("How do you know that?" / the task trail): RB-B, generated
  from the manifest + attestations + WP-19 events — never authored.
- Future bonus: RB-B is also the natural POST-RUN REPORT for cp.report, and
  its "no attestation" gaps are B-03's half-adherence criterion rendered.
  The eval and the audit view should stay column-for-column consistent.

## 4. Instructions to the WP-20 design note (agent)

Your item 7 (UI seam) is now half-written for you: consume §5b's decisions
as given; your job is the ENGINEERING counterpart — name the shared shapes
(the declared-procedure block, the attestation record, the badge reason
lines, the approval-carried canary policy, the abort groups above) as data
contracts the transcript renders. Where §5b implies a capability your other
items must supply (e.g., the declaration requires the bundle to carry the
checkpoint list before approval; the badge reasons require the runbook's
frontmatter reasons to survive delivery), say so explicitly in the relevant
item. The designer's scenario switch stays the design-side chaos rig — your
fail-closed semantics (item 6) should name which scenario exercises each.
