---
id: rb.bulk-plugin-update
kind: runbook
version: 1.1.0
strictness: strict
capability: cap.bulk_plugin_update
owner: ops
review_triggers:
  - WooCommerce or WordPress major release
  - Local major release
  - any change to gateway plugin-update tool signatures
scope:
  environments: [local, wpe_staging, wpe_development]   # production requires a separate grant + its own runbook version
requires_sources:                # the bill of intelligence — job is unassignable without these
  - { class: platform, need: live plugin inventory for all targets }
  - { class: work,     need: incident/sync history for target components }
preconditions:                   # gateway-verified before checkpoint 1 may begin
  - id: pre.scope-resolved
    check: every target resolves to a known entity within scope (no raw names)
  - id: pre.no-production
    check: no target environment is production
  - id: pre.sources-present
    check: requires_sources are reachable (inventory tools grantable, ledger queryable)
checkpoints:                     # ordered; strict mode — gateway refuses gated calls out of sequence
  # attest: what the PLATFORM can prove, never how well the step was done.
  # Four are provable and four are not; a reader who cannot tell which is which
  # would read a narrative tick as a verified one (WP-20 design note §4).
  #
  # unrequested: this step is one the user did not ask for, so the surface says
  # "runbook added this" beside it (§5b). Marked here rather than derived: no
  # structural property separates cp.canary (marked) from cp.roll-fleet (not),
  # since both use the same tool. The user asked for the roll-out; consent, a
  # backup and a report are what this platform does about any write. What the
  # RUNBOOK adds is the history check, the plan-before-writing, and the canary
  # pair. A document that marked all eight would be saying nothing.
  - id: cp.consult-history
    attest: manifest             # the assembler's own episodic retrieval — the SUPPLY side only
    evidence: { topic: task.context.assembled }
    unrequested: true
  - id: cp.dry-run
    attest: narrative            # bulk_plugin_update has no dry_run parameter and no dry-run tool exists (WP-20g)
    unrequested: true
  - id: cp.approval
    attest: event
    evidence: { topic: task.rationale.recorded, decision: approved }
  - id: cp.backup
    attest: event
    evidence: { topic: task.action.executed, tool: wpe_backup_and_verify, per_target: true }
    tools: [wpe_backup_and_verify]
  - id: cp.canary
    attest: narrative            # cardinality is observable; that the site chosen was low-risk is not
    tools: [bulk_plugin_update]  # never wp_plugin_update: that tool's path AUTO-STARTS a halted site
    unrequested: true
  - id: cp.verify-canary
    attest: narrative            # no tool checks "site loads, admin reachable, checkout renders" in this flow
    unrequested: true
  - id: cp.roll-fleet
    attest: event
    evidence: { topic: task.action.executed, tool: bulk_plugin_update }
    tools: [bulk_plugin_update]
  - id: cp.report
    attest: narrative
aborts:
  - id: ab.backup-failed
    on: cp.backup failure or unverifiable backup
    do: full stop. Report the exact failure and current world state. Backup is not
        waivable — not by user insistence, urgency, or claimed authority.
  - id: ab.canary-regression
    on: cp.verify-canary failure
    do: roll the canary site back from its backup, full stop, report evidence
        (what was observed, on which site, at which version).
  - id: ab.mid-fleet-failure
    on: any site failing during cp.roll-fleet
    do: pause the rollout at the failed site. Do not continue to remaining sites.
        Report sites completed / failed / not attempted, with rollback options.
communication:                   # facts the user must be told, verbatim-checkable
  - the dry-run diff, before any write
  - the backup id(s) and verification status
  - which sites were skipped and why (halted, out of scope, data stale)
  - the canary site chosen and the reason it was chosen
---

# Bulk plugin update

Update plugins across the target fleet with a canary-first, backup-always sequence.
This runbook is **strict**: execute checkpoints in order and attest each one. If a
step cannot be completed, take its abort path — never route around it.

## cp.consult-history — has this bitten us before?

Query the ledger for incidents and failed syncs touching the plugins being updated
and the sites being targeted (this is a mandatory retrieval; the assembler includes
it in the bundle). If history shows prior breakage — e.g. a payment-gateway conflict
on past WooCommerce updates — the affected sites are updated **last**, watched
explicitly, and the finding is stated to the user in the plan.

## cp.dry-run — show what would change

Build the update plan from **live** plugin inventory (twins may be used for
targeting; every version you act on must be live-checked). Apply the version
filter: patch and minor bumps only — **skip any major-version change** and list
skipped majors separately with their current → available versions. Halted sites
are skipped, never started for updating, and reported as skipped. Present the full
diff and stop.

## cp.approval — explicit, informed consent

Proceed only on explicit approval of the presented plan. Approval of a *different*
plan (user edits scope or filter) restarts from cp.dry-run. A denial ends the run:
record it, do not re-propose in this session.

## cp.backup — before anything writes

Create (or verify recent) backups for every site in the approved plan. Attest
per-site backup ids. On any failure: `ab.backup-failed`.

## cp.canary — one low-risk site first

Select the canary: prefer a low-traffic, non-revenue site *without* a history flag
from cp.consult-history. Apply the approved updates to the canary only, with
`bulk_plugin_update` and a single-element `site_ids` — **never `wp_plugin_update`,
whose path starts a halted site before running**. Tell the user which site and why.

The gateway can see that exactly one site was updated before the rest; it cannot
see that the site you picked was the low-risk one. That half is yours to state and
the user's to judge.

## cp.verify-canary — prove it before scaling it

Verify the canary: site loads, admin reachable, no new PHP errors in logs, and any
site-specific checks from history (e.g. checkout renders where commerce is present).
On regression: `ab.canary-regression`.

## cp.roll-fleet — the rest, watched

Apply to remaining sites, history-flagged sites last. Per-site verification at the
same bar as the canary. On any failure: `ab.mid-fleet-failure`.

## cp.report — close the loop

Report per-site outcomes (updated / skipped / failed, with versions), and record
the run's rationale: filter applied, canary choice, history findings, anything that
should update this runbook. The gateway emits the events; your job is to make the
rationale worth reading.
