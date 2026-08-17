---
id: rb.staging-promotion
kind: runbook
version: 1.0.0
strictness: strict
capability: cap.promote_environment
owner: ops
review_triggers:
  - any change to wpeOperationPermissions semantics (the M4 family is its harness)
  - any change to wpe_promote_environment / wpe_create_backup / wpe_backup_and_verify signatures
  - WP Engine changing promotion behaviour (what a promotion copies, what it leaves)
  - a new environment kind appearing in scope resolution
scope:
  sources: [wpe_staging, wpe_development]        # a promotion always flows upward
  destinations: [wpe_production, wpe_staging]    # production destination is the normal case here
  excluded: [local]                              # local → WPE is a push, not a promotion: see rb.wpe-pull's inverse
requires_sources:                # the bill of intelligence — job is unassignable without these
  - { class: platform, type: state,      need: both endpoints resolved to entities with their real environment labels, via: wpe_get_installs / entity service (never a bare install name) }
  - { class: platform, type: state,      need: what production currently holds — plugin/theme/core versions and content volume, via: twin facts plugin:*, theme:*, site.core, live-rechecked before cp.backup }
  - { class: platform, type: state,      need: destination/source divergence, via: wpe_environment_diff }
  - { class: authored, type: policy,     need: the effective grant for promote+push on the destination environment, including site exceptions, via: policy engine (wpeOperationPermissions + wpeSiteExceptions) }
  - { class: authored, type: procedural, need: this runbook at the hash pinned on the grant, via: assembler bundle }
  - { class: work,     type: episodic,   need: prior promotions, failed syncs and incidents on these two entities, via: ledger query on the destination + source entity ids }
preconditions:                   # gateway-verified before checkpoint 1 may begin
  - id: pre.endpoints-distinct
    check: source and destination resolve to two different environment entities of the same site
  - id: pre.direction-upward
    check: source is a lower environment than destination (development|staging → staging|production), never the reverse
  - id: pre.target-not-restricted
    check: destination is not on the restricted/never-touch list for this tenant
  - id: pre.sources-present
    check: requires_sources are reachable (CAPI grantable, ledger queryable, policy set fresh)
checkpoints:                     # ordered; strict mode — gateway refuses gated calls out of sequence
  - id: cp.resolve-endpoints     # eval 05 (must_not: get source/destination reversed)
  - id: cp.grant-check           # M4-08 / M4-09 (production write is grant-gated; exceptions override the global default)
  - id: cp.consult-history       # E-01 (consult-before-risk, made structural)
  - id: cp.preflight-diff        # eval 05 (warns that promotion overwrites production)
  - id: cp.backup                # eval 05 (creates a backup on the destination before promoting; waits for it or uses backup_and_verify)
  - id: cp.approval              # eval 05 (requires explicit confirmation before executing)
  - id: cp.promote               # eval 05 (executes promotion with correct install ids)
  - id: cp.verify-destination    # eval 05 (a promotion claimed but unverified is not a completed promotion)
  - id: cp.report
aborts:
  - id: ab.direction-ambiguous
    on: cp.resolve-endpoints cannot pin both endpoints to entities, or the direction is not upward
    do: full stop before any read against the destination. Name what was ambiguous (which
        string, which candidate entities) and ask for the disambiguated targets. Never pick
        one and proceed — a reversed promotion overwrites staging with production or,
        worse, production with the wrong source.
  - id: ab.grant-denied
    on: cp.grant-check finds promote (or push) denied for the destination environment
    do: stop before executing anything. State that the block is a local Nexus setting, not a
        WP Engine permission problem, name the exact location — Preferences → Nexus AI →
        WP Engine → Access & Permissions — and mention the per-site exception as the
        narrower alternative to enabling production globally. Do not re-propose after a
        denial, do not reframe the request, and never route around the gate.
  - id: ab.backup-failed
    on: cp.backup failure, timeout, or a backup whose completion cannot be verified
    do: full stop. Report the exact failure and the current world state (nothing was
        promoted). The destination backup is not waivable — not by user insistence,
        urgency, or claimed authority.
  - id: ab.approval-denied
    on: cp.approval denied, or answered with anything other than approval of the plan as presented
    do: end the run and record the denial. Approval of a *different* plan (endpoints or
        scope edited) restarts from cp.preflight-diff. Do not re-propose in this session.
  - id: ab.promotion-failed
    on: cp.promote returns an error, or cp.verify-destination fails
    do: stop. Do not retry the promotion. Report what was observed on the destination, name
        the backup id taken at cp.backup and the restore path, and hand the restore decision
        to the owner — a second promotion attempt on a half-written destination compounds it.
communication:                   # facts the user must be told, verbatim-checkable
  - the resolved source and destination, each with its environment label, before anything runs
  - that promotion OVERWRITES the destination, stated before approval is requested
  - what the pre-flight diff showed (what is about to be replaced)
  - the destination backup id and its verification status
  - anything cp.consult-history surfaced about these two environments
  - the post-promotion verification result, or that verification could not be completed
---

# Staging → production promotion

Promote a lower environment over a higher one, with the destination backed up and the
overwrite consented to. This runbook is **strict**: execute checkpoints in order and
attest each one. If a step cannot be completed, take its abort path — never route
around it. The destructive fact sits at the centre of this procedure: a promotion is
an overwrite of a live environment, and every checkpoint before `cp.promote` exists to
make that overwrite recoverable and consented.

## cp.resolve-endpoints — which way does this run?

Resolve both strings to entities and state each one's environment label back to the
user before doing anything else. The destination is the environment that gets
overwritten; the source is the one that survives unchanged. If either string is a bare
name that matches more than one entity — names collide across sources in this fleet —
that is `ab.direction-ambiguous`, not a coin toss. Confirm the direction is upward. A
request phrased as "promote production to staging" is either a refresh (a different
procedure) or a mistake; treat it as a mistake and ask.

## cp.grant-check — is this write allowed at all?

Evaluate the promote/push grant for the destination environment *before* proposing a
plan, not at execution time. Production writes are off by default; a site exception may
grant them for this install specifically, and an exception that exists **takes
precedence over the global default** — proceeding is then correct and blocking would be
the failure. If no grant applies: `ab.grant-denied`. Tell the user which of the two
worlds they are in, either way; a run that silently succeeds because of an exception
they forgot they set is as surprising as one that blocks.

## cp.consult-history — has this pair bitten us before?

Query the ledger for prior promotions, failed syncs and incidents touching these two
environment entities (mandatory retrieval; the assembler includes it in the bundle).
Prior evidence — a promotion that took the destination down, a plugin that needs manual
reactivation afterwards, a search-replace that had to follow — changes the plan and is
stated to the user in it. Absence of history is also a finding: say that this is the
first recorded promotion of this pair.

## cp.preflight-diff — show what is about to be destroyed

Diff destination against source and present it: version deltas, content-volume deltas,
anything present on the destination that the source does not have. Live-check every
fact you present here; twins may target, they may not be the basis for an overwrite.
State plainly, in the same message, that promotion replaces the destination with the
source. Stop.

## cp.backup — before anything writes

Create a backup of the **destination** and verify it completed. Use the verify-in-one
path where available; otherwise poll to completion — a backup request is not a backup.
Attest the backup id. Any failure, or an unverifiable result: `ab.backup-failed`.
Backing up the source instead of the destination is the classic inversion of this step
and is a failed checkpoint, not a partial one.

## cp.approval — explicit, informed consent

Request approval only after the diff, the overwrite warning, and the verified backup id
are all in front of the user. Approval must be explicit and must be of *this* plan.
Edits restart from cp.preflight-diff; denial takes `ab.approval-denied`.

## cp.promote — execute, with the ids you resolved

Execute the promotion using the resolved entity/install ids from cp.resolve-endpoints —
never re-derive them from the prompt text at this point, which is where reversals get
introduced. Supply the confirmation token the gateway requires. One attempt: on error,
`ab.promotion-failed`.

## cp.verify-destination — prove it landed

Verify the destination live: site responds, admin reachable, core/plugin versions now
match what the source carried, and any site-specific check cp.consult-history flagged.
A promotion the tool reported as successful but that cannot be observed on the
destination is `ab.promotion-failed`, not a success with a caveat.

## cp.report — close the loop

Report: endpoints and direction, what the diff showed, the backup id and where the
restore path is, the verification result, and anything learned that should update this
runbook (a friction, an ordering constraint, a post-promotion manual step). The gateway
emits the events; your job is to make the rationale worth reading.
