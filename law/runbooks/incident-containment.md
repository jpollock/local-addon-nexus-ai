---
id: rb.incident-containment
kind: runbook
version: 1.2.0
strictness: strict
capability: cap.incident_containment
owner: ops
split_from: rb.incident-response       # WP-20c: split at a checkpoint seam, to load under the ceiling
hands_off_to: rb.incident-remediation  # that half removes things, under its own grant
review_triggers:
  - any change to the sentinel signal set or its severities (its fixture is this runbook's harness)
  - any change to wpeOperationPermissions semantics (delete / wpcli / wpcli_read)
  - attestation classes changed
scope:
  environments: [wpe_production, wpe_staging, wpe_development, local, external]
  note: production is IN scope by necessity — compromises happen on live sites; this half
        reads, isolates and preserves, and removes nothing.
requires_sources:                # the bill of intelligence — unassignable without these
  - { class: platform, type: state,      need: sentinel report — signals, severities, evidence paths, via: security-sentinel }
  - { class: platform, type: state,      need: administrator inventory with creation times, via: wp_user_list }
  - { class: platform, type: state,      need: plugin/theme reality including inactive, LIVE — never twin-only, via: wp_plugin_list }
  - { class: platform, type: state,      need: unexpected files, obfuscated code, modified core, via: scan_site_files / checksums }
  - { class: work,     type: episodic,   need: logs for the entry vector and the artifact timeline, plus prior incidents here and on siblings, via: log query + ledger }
  - { class: authored, type: procedural, need: this runbook at the granted hash, via: assembler bundle }
preconditions:                   # gateway-verified before checkpoint 1
  - id: pre.entity-resolved
    check: the site resolves to one entity and environment (no bare names)
  - id: pre.report-present
    check: a sentinel report exists for this entity, or a scan can run before triage
  - id: pre.evidence-readable
    check: files, users, options and logs are readable (wpcli_read here)
  - id: pre.sources-present
    check: requires_sources are reachable (ledger queryable, policy set fresh)
checkpoints:                     # ordered; strict — gated calls out of sequence are refused
  # unrequested: a step the user did not ask for — the surface badges it
  # "runbook added this" (§5b). Authored, never derived. Consent, backups and a
  # closing report are the platform's own ceremony and stay unmarked, per the
  # anchor runbook's ruled set.
  # Marked: isolate (taking the site out of service was not requested),
  # snapshot (preserving the infected state before touching it), entry-vector
  # (how they got in, which is work beyond "clean this up"). Triage and the
  # integrity diff ARE the investigation that was asked for.
  # attest: what the PLATFORM can prove, never how well the step was done.
  # NONE of the five. cp.snapshot and cp.isolate were reviewed as event
  # candidates and fall to narrative on this document's own text: neither names
  # a gateway tool, and the registry ships none for isolation or snapshotting.
  # A class is never assigned because we wish it were provable (note P1).
  - id: cp.triage
    attest: narrative
  - id: cp.isolate
    attest: narrative
    unrequested: true
  - id: cp.snapshot         # evidence before cleanup, always
    attest: narrative
    unrequested: true
  - id: cp.integrity-diff
    attest: narrative
  - id: cp.entry-vector
    attest: narrative
    unrequested: true
aborts:
  - id: ab.evidence-not-preserved
    on: cp.snapshot fails, or cannot be verified, and cleanup would proceed anyway
    do: full stop before handing off to rb.incident-remediation. Cleanup permanently destroys
        the only record of how the attacker got in — a compromise cleaned without a snapshot
        cannot be investigated, and one cleaned without knowing the entry vector gets
        reinfected. Not waivable — not by user insistence, urgency, or claimed authority.
  - id: ab.entry-vector-unknown
    on: cp.entry-vector produces no log-supported hypothesis
    do: remediation may still proceed — but the incident cannot be reported as resolved. Say
        so at handoff, so the sibling runbook's post-mortem carries it, and schedule a
        re-scan. Never substitute a plausible-sounding vector for an evidenced one — a
        speculative entry vector closes the incident on a guess.
  - id: ab.scope-wider-than-one-site
    on: the same artifacts or attacker accounts appear on sibling sites/environments
    do: stop and widen with the owner before continuing. Cleaning one site of a
        multi-site compromise reinfects from the ones left alone.
communication:                   # facts the user must be told
  - the findings, ranked by severity, each with its evidence (path, account name, log line)
  - what isolation was applied, when, and what it makes unavailable to real visitors
  - the snapshot id(s) and their verification status, before any cleanup runs
  - the entry-vector hypothesis with the log evidence it rests on — or an explicit statement
    that the entry vector is unknown
---

# Incident response · containment and investigation

Contain a confirmed or suspected compromise, preserve its evidence, date the intrusion.
This runbook is **strict**: execute checkpoints in order and attest each one. If a step
cannot be completed, take its abort path — never route around it. The five checkpoints map
to D-02 steps 1–4 and to the sentinel classes ABS/EXP/FS/TC named in `review_triggers`.

**This half never removes anything.** Cleanup, rotation, verification and the client
write-up are `rb.incident-remediation`, which cannot begin until this one has produced a
verified snapshot. Cleanup destroys the evidence, so the authority to investigate and the
authority to destroy are two grants, not one.

## cp.triage — confirm the findings before acting on them

Start from the sentinel report and confirm each signal against live state — the report is a
detection, this checkpoint is the verification. Rank by severity, not by ease of fix:

- **Backdoors and webshells** — a known-bad plugin, a PHP file that does not belong in a
  must-use directory, obfuscated `eval`/`base64` code. Critical.
- **Attacker accounts** — administrators beyond what the site's size justifies, default
  `admin` usernames, placeholder-domain emails, synthetic names. The inventory with creation
  times feeds the timeline at `cp.entry-vector`.
- **Hostile-capability plugins** — file managers and code editors, whoever installed them.
  Active file management is arbitrary code execution.
- **Missing hardening** — no security plugin, file editing enabled in production, user
  enumeration open. Exposure, not compromise; report separately.

State what you confirmed, what the report claimed that you could not confirm, and what you
could not check at all.

## cp.isolate — contain before you investigate

Reduce reachability before touching anything: maintenance mode, restricted access, or the
host's equivalent. Isolation is itself a change to a live site — tell the user what it
makes unavailable and when it went on. It stays on until remediation's `cp.verify-clean`
passes; if a permission refusal stalls the cleanup, it stays on, and say so.

## cp.snapshot — preserve the infected state

Snapshot before cleanup: a backup of the site as it stands, plus copies of the artifact
files and the account inventory. This is evidence, not a rollback target — the whole point
is that it contains the malware. Attest the snapshot id and verify it completed. Failure,
or an unverifiable result: `ab.evidence-not-preserved`.

## cp.integrity-diff — what does not belong here?

Diff against known-clean references: core and plugin checksums, the expected must-use
plugin list, the known file set. Report each deviation with its path and modification time.
Two classes feed the next checkpoint — files that should not exist at all, and files whose
contents are obfuscated — because their timestamps date the intrusion.

## cp.entry-vector — a hypothesis with evidence under it

Build the timeline: artifact, account and plugin-installation times. A tight cluster of
artifacts inside a few minutes is one intrusion event and dates it; that timestamp is what
you take to the logs. Then find the evidence around it — authentication attempts against
default administrator names, requests to the artifact paths, upload endpoints hit before
the first artifact, brute-force patterns.

State the hypothesis with the evidence beneath it and name your confidence. A vector
asserted without log evidence is speculation, however plausible; if the logs support none,
that is `ab.entry-vector-unknown` and the incident does not close as resolved.

## Handoff to rb.incident-remediation

Hand over, naming anything missing: the ranked findings with their evidence, the isolation
in force, the verified snapshot id, the `cp.integrity-diff` deviations, and the entry-vector
hypothesis or the statement that there is none. Remediation is a separate grant; if it is
not held, say what remains uncleaned and leave the isolation on.
