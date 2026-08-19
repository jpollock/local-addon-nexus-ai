---
id: rb.promotion-execute
kind: runbook
version: 1.2.0
strictness: strict
capability: cap.promote_environment    # unchanged from rb.staging-promotion: this half is the write the capability names
owner: ops
split_from: rb.staging-promotion       # WP-20c: split at a checkpoint seam, to load under the ceiling
follows: rb.promotion-preflight        # never runs first: it consumes that runbook's resolved endpoints and diff
review_triggers:
  - any change to wpeOperationPermissions semantics (the M4 family is its harness)
  - any change to wpe_promote_environment / wpe_create_backup / wpe_backup_and_verify signatures
  - WP Engine changing promotion behaviour (what a promotion copies, what it leaves)
scope:
  sources: [wpe_staging, wpe_development]        # a promotion always flows upward
  destinations: [wpe_production, wpe_staging]    # production destination is the normal case here
  excluded: [local]                              # local → WPE is a push, not a promotion
requires_sources:                # the bill of intelligence — unassignable without these
  - { class: work,     type: procedural, need: rb.promotion-preflight's output — resolved endpoint ids, grant finding, history, the diff as presented }
  - { class: platform, type: state,      need: the destination's backup state and completion, via: wpe_create_backup / wpe_backup_and_verify }
  - { class: authored, type: policy,     need: the effective promote+push grant for the destination, including site exceptions, via: policy engine }
  - { class: authored, type: procedural, need: this runbook at the granted hash, via: assembler bundle }
preconditions:                   # gateway-verified before checkpoint 1
  - id: pre.preflight-complete
    check: rb.promotion-preflight completed — endpoints resolved, direction upward, grant found, diff presented
  - id: pre.overwrite-stated
    check: the user has been told, in this conversation, that promotion overwrites the destination
  - id: pre.target-not-restricted
    check: destination is not on the restricted/never-touch list for this tenant
checkpoints:                     # ordered; strict — gated calls out of sequence are refused
  # unrequested: a step the user did not ask for — the surface badges it
  # "runbook added this" (§5b). Authored, never derived. Consent, backups and a
  # closing report are the platform's own ceremony and stay unmarked, per the
  # anchor runbook's ruled set.
  # Marked: verifying the destination after the write — the user asked for the
  # promotion, not for it to be checked afterwards. The backup, the approval and
  # the report are the platform's ceremony around any write; cp.promote is the
  # request itself.
  - id: cp.backup                # eval 05 (backup the destination before promoting; wait for it or use backup_and_verify)
  - id: cp.approval              # eval 05 (explicit confirmation before executing)
  - id: cp.promote               # eval 05 (executes promotion with correct install ids)
    tools: [wpe_promote_environment]   # the write this capability names (WP-20g): declared, so the reach check can bind it
  - id: cp.verify-destination    # eval 05 (a promotion claimed but unverified is not a completed promotion)
    unrequested: true
  - id: cp.report
aborts:
  - id: ab.backup-failed
    on: cp.backup failure, timeout, or a backup whose completion cannot be verified
    do: full stop. Report the exact failure and the current world state (nothing was
        promoted). The destination backup is not waivable — not by user insistence,
        urgency, or claimed authority.
  - id: ab.approval-denied
    on: cp.approval denied, or answered with anything other than approval of the plan as presented
    do: end the run and record the denial. Approval of a *different* plan (endpoints or
        scope edited) restarts from rb.promotion-preflight's cp.preflight-diff. Do not
        re-propose in this session.
  - id: ab.promotion-failed
    on: cp.promote returns an error, or cp.verify-destination fails
    do: stop. Do not retry the promotion. Report what was observed on the destination, name
        the backup id taken at cp.backup and the restore path, and hand the restore decision
        to the owner — a second promotion attempt on a half-written destination compounds it.
communication:                   # facts the user must be told
  - the destination backup id and its verification status
  - the post-promotion verification result, or that verification could not be completed
---

# Promotion · execute and verify

Overwrite a higher environment with a lower one, with the destination backed up and the
overwrite consented to. This runbook is **strict**: execute checkpoints in order and attest
each one. If a step cannot be completed, take its abort path — never route around it.

**It never runs first.** `rb.promotion-preflight` resolves the endpoints, checks the grant,
consults the history and presents the diff; without that output `pre.preflight-complete`
fails and nothing here may begin. The destructive fact sits at the centre of this half: a
promotion is an overwrite of a live environment, and `cp.backup` is what makes it
recoverable.

## cp.backup — before anything writes

Create a backup of the **destination** and verify it completed. Use the verify-in-one path
where available; otherwise poll to completion — a backup request is not a backup. Attest the
backup id. Any failure, or an unverifiable result: `ab.backup-failed`. Backing up the source
instead of the destination is the classic inversion of this step and is a failed checkpoint,
not a partial one.

## cp.approval — explicit, informed consent

Request approval only after the diff, the overwrite warning, and the verified backup id are
all in front of the user. Approval must be explicit and must be of *this* plan. Edits
restart from the preflight's `cp.preflight-diff`; denial takes `ab.approval-denied`.

## cp.promote — execute, with the ids you resolved

Execute the promotion using the entity/install ids resolved at preflight — never re-derive
them from the prompt text at this point, which is where reversals get introduced. Supply the
confirmation token the gateway requires. One attempt: on error, `ab.promotion-failed`.

## cp.verify-destination — prove it landed

Verify the destination live: site responds, admin reachable, core/plugin versions now match
what the source carried, and any site-specific check the preflight's history flagged. A
promotion the tool reported as successful but that cannot be observed on the destination is
`ab.promotion-failed`, not a success with a caveat.

## cp.report — close the loop

Report: endpoints and direction, what the diff showed, the backup id and where the restore
path is, the verification result, and anything learned that should update either half of
this procedure (a friction, an ordering constraint, a post-promotion manual step). The
gateway emits the events; your job is to make the rationale worth reading.
