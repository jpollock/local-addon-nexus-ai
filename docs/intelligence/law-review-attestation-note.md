# The attestation law review — four runbooks, one pass · design note for owner review

*(Architect, 2026-08-19. The WP-25 pattern: positions to ratify or
amend before any packet edits law. Scope: the four strict runbooks
with zero attestable checkpoints — `rb.promotion-execute`,
`rb.promotion-preflight`, `rb.incident-containment`,
`rb.incident-remediation` — found by WP-20g for one document and
proven for all four by the Govern matrix's gates column. The goal is
NOT green columns: it is that "what granting this gates" tells the
truth, and today the truth is "the grant itself, and nothing after
it" four times over, twice on granted capabilities.)*

## P1 · The derivation rule — classes are derived, never authored generously

A checkpoint's attest class follows the anchor runbook's own comment
("what the PLATFORM can prove, never how well the step was done"):

- **event** — the checkpoint's essence is a gateway-recorded act: a
  declared tool's recorded outcome, or a checkpoint-bound consent
  (`task.rationale.recorded` with WP-36's `checkpoint` binding).
- **manifest** — the checkpoint's essence is the assembler's own
  supply (`task.context.assembled`), the consult-history pattern.
- **narrative** — everything else, honestly: a judgment, a reading,
  a verification whose instrument can be recorded but whose verdict
  cannot ("the instrument does not make the checkpoint provable" —
  the WP-31 ruling on cp.verify-canary, which binds here).

No class is assigned because we wish the step were provable.

## P2 · Proposed classes, per document

**rb.promotion-execute (0 → 3 of 5 provable):**
cp.backup → **event** (the backup tools' recorded outcomes; see P3) ·
cp.approval → **event** (checkpoint-bound rationale, the WP-36
contract) · cp.promote → **event** (wpe_promote_environment is
already declared, WP-20g) · cp.verify-destination → **narrative**,
with `verify_site_live` declared as its instrument (the
cp.verify-canary precedent exactly: the live check is recordable,
"site responds, admin reachable" is not) · cp.report → narrative.

**rb.promotion-preflight (0 → 1 of 4):**
cp.consult-history → **manifest** (identical to the anchor) ·
cp.resolve-endpoints, cp.grant-check, cp.preflight-diff →
**narrative** — resolution reads are recordable but non-reversal is a
judgment; the policy engine's decision has no ledger topic today and
inventing one is escalation-grade, refused here.

**rb.incident-remediation (0 → 1 of 6):**
cp.approval → **event** (checkpoint-bound rationale) · all five
others → **narrative**, including cp.execute-cleanup — WP-20g
measured that the document names no instrument, and that gap stays
recorded rather than papered; cp.verify-clean's re-scan is an agent
run producing a report, not ledger attest evidence.

**rb.incident-containment (0 → 0 to 2 of 5, body-dependent):**
cp.snapshot and cp.isolate are **event candidates** — IF the
document's body names gateway tools for them (a snapshot via the
backup tools would be provable exactly as cp.backup is). I have read
this document's checkpoint list, not its full body: the applying
packet verifies each candidate against the body's own text and the
tool registry, and a class the body cannot support FALLS TO
NARRATIVE with the mismatch escalated, never stretched. cp.triage,
cp.integrity-diff, cp.entry-vector → narrative.

## P3 · Declared tools, where the body names the instrument

cp.backup gains `tools: [wpe_create_backup, wpe_backup_and_verify]`
(its body names both), which also hands those writes to the
sequencer's ordering — the WP-20g pattern, quoted from the document
by the packet, never inferred. cp.verify-destination gains
`tools: [verify_site_live]` per the precedent. Any further
declaration must quote the body's own sentence in the packet's gate
report.

## P4 · The hash ripple this time is NOT free — the re-pin ruling

Unlike the WP-20g edit (a denied capability, zero grants rippled),
`cap.incident_containment` and `cap.promotion_preflight` hold
MATERIALIZED grants pinned to the current hashes. A version bump
disarms both via the stale-pin rule — correct behavior, wrong
ending. Proposed: the packet re-issues those grants at the new
hashes as explicit `control.grant.issued` events,
`reason: 'law-review re-pin'`, presented at its gate — so the ledger
shows the review as an act, no grant silently survives a hash
change, and no grant silently dies of one either.

## P5 · Mechanics, all standing rules applied

Version bumps on all four documents; the anchor-slice copies edited
under the copy-drift lint; `declared-procedures.json` REGENERATED
(never spliced), with the field read-back; `review_triggers` on each
document gains "attestation classes changed"; the Govern matrix and
companion surfaces change BY THEMSELVES (the designer's ratified
property — a test already pins it).

## P6 · What this review refuses

No checkpoint becomes provable by wording. Narrative stays narrative
and says so in full attest words; the matrix's gates column will
read "3 of 5" and "1 of 4" and "1 of 6" — better than zero, honest
about the rest. If a future instrument makes a narrative checkpoint
provable, that is its own review with its own trigger, not a
retrofit.

## Acceptance

After the packet: the gates column reads the new denominators
derived from the documents; a promotion run's backup, approval, and
promote checkpoints attest from ledger evidence end to end; the two
re-pinned grants render with the review as their issuing act; and
granting `cap.promote_environment` no longer gates "the grant
itself, and nothing after it" — it gates three provable checkpoints
including the backup that makes the overwrite recoverable.

*Ratify P1–P6 by number (or amend), and the packet prompt follows.*
