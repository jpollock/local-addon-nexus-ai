# Re: §5b + the runbook session (v3) — from the architect & owner

Short version: §5b is adopted as the surface contract for procedure
execution — all five decisions stand as written, and the declared-before-
the-run structure is exactly right (it turns half-adherence, the eval's
central must_not, into visible structure instead of a confession). Two
answers below: your open item, closed; and the RB-B call, ratified.

---

## 1. Your open item — the per-site outcome shape (it already exists)

The abort affordance can be written honestly today. Since the gateway
packet (WP-19), every target site in a run gets its own outcome record in
the ledger, and every backup made by the backup gate has an attested id.
The shape your copy renders from, per site:

    result:        updated | skipped | failed
    versions:      from → to (when applicable)
    backup id:     from the attested backup checkpoint (per site)
    reason:        for skips ("halted — skipped")
    observed at:   timestamp

So the abort affordance has **four honest groups**, all derivable:

1. **Done, standing** — completed sites stand (per the Q6 ruling). Each
   shows `updated 9.4.1 → 9.5.0 · backup <id>` and is *restorable* — where
   restore is a named, separate, gated action per site. Never automatic,
   never implied to be part of aborting.
2. **The failing site** — where the halt happened, with its recorded
   failure.
3. **Skipped** — with the recorded reason.
4. **Untouched** — everything the halt prevented. The copy may promise
   "these were not touched" because the gateway events prove it.

Copy rule, consistent with your own invariant: **abort stops future work;
it does not undo done work** — and the affordance's first line should say
so, derived from the group counts:

> Stop here? 2 sites already updated and standing · 3 untouched.

## 2. RB-B — your instinct is ratified, with a deeper reason

RB-B (what-the-runbook-says beside what-the-run-did) goes to the **audit
view**, and RB-A2's collapsing checklist keeps the transcript — as you
proposed. The reason it belongs there is stronger than width: the two
columns are the human-facing render of records the system already keeps
(the runbook's checkpoint list = the spec column; the attestations and
gateway events = the actual column), and an empty cell in the actual
column *is* the half-adherence check, rendered. Generated from those
records, never authored — your rule, their data.

Two follow-ons worth designing when you get there:
- RB-B is also the natural **post-run report** (the runbook's final
  "report" checkpoint) — same columns, one row per checkpoint.
- The eval harness judges B-03 with effectively the same two columns; if
  the audit view and the eval sheet stay column-for-column consistent, a
  human reading either learns to read both.

## 3. One heads-up

The engineering design note for procedure distribution (WP-20) is being
drafted against your §5b right now — its data contracts (the declared-
procedure block, attestation records, badge reason lines, the
approval-carried canary policy, the abort groups above) are being named
to match your surfaces. Expect it back for a joint review; the eleven
B-03 criteria remain the shared script.
