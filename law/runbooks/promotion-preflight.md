---
id: rb.promotion-preflight
kind: runbook
version: 1.2.0
strictness: strict
capability: cap.promotion_preflight
owner: ops
split_from: rb.staging-promotion       # WP-20c: split at a checkpoint seam, to load under the ceiling
hands_off_to: rb.promotion-execute     # nothing here writes to the destination; that half does
review_triggers:
  - any change to wpeOperationPermissions semantics (the M4 family is its harness)
  - any change to wpe_environment_diff / wpe_get_installs signatures
  - a new environment kind appearing in scope resolution
  - attestation classes changed
scope:
  sources: [wpe_staging, wpe_development]        # a promotion always flows upward
  destinations: [wpe_production, wpe_staging]    # production destination is the normal case here
  excluded: [local]                              # local → WPE is a push, not a promotion: see rb.wpe-pull's inverse
requires_sources:                # the bill of intelligence — unassignable without these
  - { class: platform, type: state,      need: both endpoints resolved to entities with their real environment labels — never a bare install name, via: wpe_get_installs / entity service }
  - { class: platform, type: state,      need: what the destination currently holds — plugin/theme/core versions and content volume, via: twin facts, live-rechecked }
  - { class: platform, type: state,      need: destination/source divergence, via: wpe_environment_diff }
  - { class: authored, type: policy,     need: the effective promote+push grant for the destination, including site exceptions, via: policy engine }
  - { class: work,     type: episodic,   need: prior promotions, failed syncs and incidents on these two entities, via: ledger query on both entity ids }
  - { class: authored, type: procedural, need: this runbook at the granted hash, via: assembler bundle }
preconditions:                   # gateway-verified before checkpoint 1
  - id: pre.endpoints-distinct
    check: source and destination resolve to two different environment entities of the same site
  - id: pre.direction-upward
    check: source is a lower environment than destination (development|staging → staging|production), never the reverse
  - id: pre.target-not-restricted
    check: destination is not on the restricted/never-touch list for this tenant
  - id: pre.sources-present
    check: requires_sources are reachable (CAPI grantable, ledger queryable, policy set fresh)
checkpoints:                     # ordered; strict — gated calls out of sequence are refused
  # unrequested: a step the user did not ask for — the surface badges it
  # "runbook added this" (§5b). Authored, never derived. Consent, backups and a
  # closing report are the platform's own ceremony and stay unmarked, per the
  # anchor runbook's ruled set.
  # Marked: the history check and the diff shown before the destination is
  # overwritten. Resolving which way the promotion runs and checking the grant
  # are not additions — they are doing the requested write correctly, and the
  # grant gate applies to the write with or without this document.
  # attest: what the PLATFORM can prove, never how well the step was done.
  # One of four is provable. The retrieval is the assembler's own supply, which
  # is a manifest fact. The other three are readings: resolution and the grant
  # lookup ARE recordable, but "the direction is not reversed" and "no grant
  # applies" are judgements about what was read, and the policy engine's own
  # decision has no ledger topic — inventing one is a separate review, refused
  # here. Nothing becomes provable by wording (WP-20 design note §4).
  - id: cp.resolve-endpoints     # eval 05 (must_not: get source/destination reversed)
    attest: narrative
  - id: cp.grant-check           # M4-08 / M4-09 (production write is grant-gated; exceptions override the global default)
    attest: narrative
  - id: cp.consult-history       # E-01 (consult-before-risk, made structural)
    attest: manifest             # the assembler's own episodic retrieval — the SUPPLY side only
    evidence: { topic: task.context.assembled }
    unrequested: true
  - id: cp.preflight-diff        # eval 05 (warns that promotion overwrites production)
    attest: narrative
    unrequested: true
aborts:
  - id: ab.direction-ambiguous
    on: cp.resolve-endpoints cannot pin both endpoints to entities, or the direction is not upward
    do: full stop before any read against the destination. Name what was ambiguous (which
        string, which candidate entities) and ask for the disambiguated targets. Never pick
        one and proceed — a reversed promotion overwrites staging with production or,
        worse, production with the wrong source.
  - id: ab.grant-denied
    on: cp.grant-check finds promote (or push) denied for the destination environment
    do: stop before handing off. State that the block is a local Nexus setting, not a WP
        Engine permission problem, name the exact location — Preferences → Nexus AI → WP
        Engine → Access & Permissions — and mention the per-site exception as the narrower
        alternative to enabling production globally. Do not re-propose after a denial, do
        not reframe the request, and never route around the gate.
communication:                   # facts the user must be told
  - the resolved source and destination, each with its environment label, before anything runs
  - that promotion OVERWRITES the destination, stated before approval is requested
  - what the pre-flight diff showed (what is about to be replaced)
  - anything cp.consult-history surfaced about these two environments
---

# Promotion · preflight

Establish that a promotion is the right operation, in the right direction, permitted, and
understood — before anything writes. This runbook is **strict**: execute checkpoints in
order and attest each one. If a step cannot be completed, take its abort path — never route
around it.

**Nothing here writes to the destination.** The backup, the approval, the promotion itself
and its verification are `rb.promotion-execute`, under the `cap.promote_environment` grant.
The seam is where the reversible half ends: a promotion is an overwrite of a live
environment, and every checkpoint in this runbook exists to make that overwrite consented
and recoverable before the grant that performs it is used.

## cp.resolve-endpoints — which way does this run?

Resolve both strings to entities and state each one's environment label back to the user
before doing anything else. The destination is the environment that gets overwritten; the
source is the one that survives unchanged. If either string is a bare name that matches
more than one entity — names collide across sources in this fleet — that is
`ab.direction-ambiguous`, not a coin toss. Confirm the direction is upward. A request
phrased as "promote production to staging" is either a refresh (a different procedure) or a
mistake; treat it as a mistake and ask.

## cp.grant-check — is this write allowed at all?

Evaluate the promote/push grant for the destination environment *before* proposing a plan,
not at execution time. Production writes are off by default; a site exception may grant them
for this install specifically, and an exception that exists **takes precedence over the
global default** — proceeding is then correct and blocking would be the failure. If no grant
applies: `ab.grant-denied`. Tell the user which of the two worlds they are in, either way; a
run that silently succeeds because of an exception they forgot they set is as surprising as
one that blocks.

## cp.consult-history — has this pair bitten us before?

Query the ledger for prior promotions, failed syncs and incidents touching these two
environment entities (mandatory retrieval; the assembler includes it in the bundle). Prior
evidence — a promotion that took the destination down, a plugin that needs manual
reactivation afterwards, a search-replace that had to follow — changes the plan and is
stated to the user in it. Absence of history is also a finding: say that this is the first
recorded promotion of this pair.

## cp.preflight-diff — show what is about to be destroyed

Diff destination against source and present it: version deltas, content-volume deltas,
anything present on the destination that the source does not have. Live-check every fact you
present here; twins may target, they may not be the basis for an overwrite. State plainly,
in the same message, that promotion replaces the destination with the source. Stop.

## Handoff to rb.promotion-execute

Hand over the resolved endpoint ids (never the prompt text — re-deriving them at execution
is where reversals get introduced), the grant finding, what history surfaced, and the diff
as presented. If `cap.promote_environment` is not granted, say so and stop here: the
preflight stands on its own as an answer, and no part of it authorises a write.
