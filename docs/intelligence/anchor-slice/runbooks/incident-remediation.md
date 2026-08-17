---
id: rb.incident-remediation
kind: runbook
version: 1.0.0
strictness: strict
capability: cap.incident_remediation
owner: ops
split_from: rb.incident-response   # WP-20c: split at a checkpoint seam, to load under the ceiling
follows: rb.incident-containment   # never first: it consumes that runbook's verified snapshot
review_triggers:
  - any change to SentinelExecutor's gating (which class maps to which permission)
  - any change to wpeOperationPermissions semantics (delete / wpcli / wpcli_read)
  - a new remediation class (anything destructive not in the catalogue below)
scope:
  environments: [wpe_production, wpe_staging, wpe_development, local, external]
  note: production is in scope because compromises happen on live sites.
requires_sources:
  - { class: work,     type: procedural, need: containment's findings, isolation, VERIFIED snapshot, deviations, entry vector }
  - { class: platform, type: state,      need: plugin/theme/file reality, LIVE — never twin-only, via: wp_plugin_list }
  - { class: authored, type: policy,     need: which classes are granted HERE (delete, wpcli), via: policy engine }
  - { class: intent,   type: policy,     need: client red-lines — what must not be removed, via: client policy }
  - { class: authored, type: procedural, need: this runbook at the granted hash, via: assembler bundle }
preconditions:                   # gateway-verified before checkpoint 1
  - id: pre.containment-complete
    check: rb.incident-containment completed, or its findings supplied and verified
  - id: pre.snapshot-verified
    check: a verified snapshot exists — cleanup never precedes preserved evidence
  - id: pre.entity-resolved
    check: the site resolves to one entity and environment (no bare names)
  - id: pre.sources-present
    check: requires_sources are reachable (policy set fresh, client policy loaded)
checkpoints:                     # ordered; strict — gated calls out of sequence are refused
  - id: cp.cleanup-plan
  - id: cp.approval
  - id: cp.execute-cleanup
  - id: cp.rotate-credentials
  - id: cp.verify-clean          # unverified cleanup is a claim, not a result
  - id: cp.post-mortem
aborts:
  - id: ab.grant-refused
    on: a remediation step is refused by the policy gate (delete is denied on every
        environment by default; other WP-CLI writes are denied on production by default)
    do: stop at that step — no equivalent through another tool, no rephrasing to fall under
        a permitted class. Name the exact permission and environment to grant (Preferences →
        Nexus AI → WP Engine → Access & Permissions), state what remains uncleaned, and keep
        the isolation on until it is. Expect this on a first run — the defaults refuse the
        whole catalogue, by design.
  - id: ab.client-red-line
    on: the cleanup plan touches a component the client policy protects (revenue-critical
        plugin, integration that must stay active)
    do: stop and surface the conflict as a conflict. Propose the compliant path (isolate
        rather than delete, clone-and-clean, staged removal). Proceed only on an override
        acknowledged as an override, from someone with authority to give it.
  - id: ab.reinfection
    on: cp.verify-clean finds the artifacts back, or new ones
    do: full stop and escalate. The site is actively compromised — a live persistence
        mechanism or an open entry vector — and further cleanup is whack-a-mole. Report the
        evidence and put restore-from-known-good and host escalation to the owner.
communication:                   # facts the user must be told
  - the exact commands proposed, shown in full, BEFORE approval is requested
  - which credentials were rotated and the consequences (sessions invalidated, users logged
    out, integrations needing re-authentication)
  - the blind spots this investigation cannot see — runtime behaviour and premium/paid
    component internals — stated in the post-mortem, not omitted because the news is good
  - anything left uncleaned because a permission was refused, named as such
---

# Incident response · remediation and write-up

Clean a compromise whose evidence is already preserved, rotate what the attacker could have
read, verify it, write it up. **Strict**: execute checkpoints in order and attest each one;
if a step cannot be completed, take its abort path — never route around it. The six map to
D-02 steps 5–7 and to the sentinel must_recommend and blind_spots catalogues.

**It never runs first.** `rb.incident-containment` produces the findings, isolation and
verified snapshot this one consumes; without them `pre.snapshot-verified` fails. Every
destructive step is gated individually and none is waivable in-session: cleanup is approved
per item, never as a batch, because the blast radius of each differs.

## cp.cleanup-plan — the exact commands, in full, before approval

Enumerate every destructive action as the command it will be, by class:

- **Webshells and unexpected files** — the paths from containment's `cp.integrity-diff`
  (e.g. an `index.php` planted in `wp-content/mu-plugins/`).
- **Backdoor and hostile-capability plugins** — by slug, DELETED not deactivated; a
  deactivated plugin's files still execute when reached directly.
- **Attacker accounts** — with an explicit content-reassignment decision.
- **Modified core/plugin files** — restored from clean sources, never hand-edited.

Check the plan against the client policy set first (`ab.client-red-line`), against the
grants second. Present it in full and stop.

## cp.approval — per destructive step, not per plan

Approval is requested with the commands visible and given per item. A blanket "yes, do it
all" covers the enumerated items only; anything found mid-cleanup returns to
`cp.cleanup-plan`. Denying an item removes it and leaves the rest — say what that leaves
uncleaned.

## cp.execute-cleanup — expect the gate, do not route around it

Execute item by item, verifying each before the next. The gate refuses most of this
catalogue on a fresh install by design, and that refusal is `ab.grant-refused`. Never
substitute a permitted tool to achieve a refused effect — that is what the gate exists to
stop, and it happens most often here, under time pressure, with the best of intentions.

## cp.rotate-credentials — assume everything was seen

Rotate as though the attacker read everything: salts and keys (which invalidates every
session), administrator passwords, database credentials where the host allows, API keys and
integration tokens on the site. Tell the user the consequences first — everyone is logged
out, integrations may need re-authentication. Rotation without cleanup is theatre; cleanup
without rotation leaves a stolen session valid.

## cp.verify-clean — scan again, from scratch

Re-run the full scan and diff, not a spot check of what you removed. Confirm the artifacts
are gone, no new ones appeared, the accounts match what was approved, and the hardening gaps
found at triage are closed or deferred explicitly. Artifacts back, or new ones:
`ab.reinfection`. Only after a clean verification does the isolation come off — say when.

## cp.post-mortem — write it for the client, not for us

Draft the write-up in the client's register: what happened, when, what was affected, what
was done, what they must do (rotate their own passwords, re-authenticate integrations), what
prevents a recurrence. Plain language, no internal tool names, no speculation dressed as
fact. If containment ended in `ab.entry-vector-unknown`, say so: the incident does not close
as resolved.

State the blind spots, including in the good-news case: this investigation sees files,
accounts, configuration and logs — it does **not** see runtime behaviour (what the code did
while it ran, what data left) and cannot inspect premium component internals. A clean scan
means no evidence was found in what could be examined, and the write-up must say that, not
"the site is clean". Record the friction and the refused permissions; the next incident
inherits them.
