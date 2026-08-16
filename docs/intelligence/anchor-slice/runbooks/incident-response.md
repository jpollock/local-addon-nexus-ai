---
id: rb.incident-response
kind: runbook
version: 1.0.0
strictness: strict
capability: cap.incident_response
owner: ops
review_triggers:
  - any change to the sentinel signal set or its severities (the ground-truth fixture is this runbook's harness)
  - any change to SentinelExecutor's gating (which remediation classes map to which permission)
  - any change to wpeOperationPermissions semantics (delete / wpcli / wpcli_read)
  - a new remediation class appearing (anything destructive not covered by the cleanup catalogue below)
scope:
  environments: [wpe_production, wpe_staging, wpe_development, local, external]
  note: production is IN scope here by necessity — compromises happen on live sites; every
        destructive step is individually gated and none of them are waivable in-session
requires_sources:                # the bill of intelligence — job is unassignable without these
  - { class: platform, type: state,      need: the current sentinel report for this site — signals, severities, evidence paths, via: security-sentinel get-report / scan }
  - { class: platform, type: state,      need: administrator inventory and account creation times, via: wp_user_list + twin facts user:* }
  - { class: platform, type: state,      need: installed plugin/theme reality including inactive ones, via: wp_plugin_list / wp_theme_list, live — never twin-only for a compromise }
  - { class: platform, type: state,      need: filesystem evidence — files outside the known set, obfuscated code, modified core, via: scan_site_files / core checksum verification }
  - { class: platform, type: state,      need: security-relevant configuration (file-edit constants, security plugin presence), via: wp_option_get / config read }
  - { class: work,     type: episodic,   need: access and error log evidence for the entry-vector hypothesis, and the timeline of artifact creation, via: log query + ledger events on this entity }
  - { class: work,     type: episodic,   need: prior incidents on this site or its siblings, via: ledger query on the entity id and its client scope }
  - { class: authored, type: policy,     need: which remediation classes are granted on THIS environment (delete, wpcli, wpcli_read), via: policy engine — evaluated before proposing a plan, not at execution }
  - { class: authored, type: procedural, need: this runbook at the hash pinned on the grant, via: assembler bundle }
  - { class: intent,   type: policy,     need: client red-lines — components that must not be deactivated or deleted without sign-off, via: client policy set }
preconditions:                   # gateway-verified before checkpoint 1 may begin
  - id: pre.entity-resolved
    check: the compromised site resolves to one entity and environment (no bare names)
  - id: pre.report-present
    check: a sentinel report exists for this entity, or a scan can be run before triage
  - id: pre.evidence-readable
    check: read access to files, users, options and logs is grantable (wpcli_read on this environment)
  - id: pre.sources-present
    check: requires_sources are reachable (ledger queryable, policy set fresh, client policy loaded)
checkpoints:                     # ordered; strict mode — gateway refuses gated calls out of sequence
  - id: cp.triage                # sentinel ground truth (ABS-01..05, EXP-01/03, LLM-USER-01) — confirm and rank findings before acting
  - id: cp.isolate               # D-02 step 1 (isolate)
  - id: cp.snapshot              # D-02 step 2 (snapshot infected state) — evidence before cleanup, always
  - id: cp.integrity-diff        # D-02 step 3 (diff vs clean checksums); sentinel FS-01, FS-02
  - id: cp.entry-vector          # D-02 step 4 (hypothesis from log evidence, not speculation); sentinel TC-01 + entry_point_keywords
  - id: cp.cleanup-plan          # D-02 step 5 (cleanup plan); sentinel must_recommend catalogue
  - id: cp.approval              # D-02 (write-gates at each destructive step)
  - id: cp.execute-cleanup       # D-02 step 5, executed — per-item gated, never as one batch
  - id: cp.rotate-credentials    # D-02 step 6 (credential rotation); sentinel must_recommend: salts
  - id: cp.verify-clean          # re-scan: a cleanup unverified by a second scan is a claim, not a result
  - id: cp.post-mortem           # D-02 step 7 (client post-mortem draft, client register); sentinel blind_spots_must_mention
aborts:
  - id: ab.evidence-not-preserved
    on: cp.snapshot fails, or cannot be verified, and cleanup would proceed anyway
    do: full stop before any destructive step. Cleanup destroys the entry-vector evidence
        permanently; a compromise cleaned without a snapshot cannot be investigated, and a
        site cleaned without knowing the entry vector is a site that gets reinfected. Not
        waivable — not by user insistence, urgency, or claimed authority.
  - id: ab.grant-refused
    on: a remediation step is refused by the policy gate (delete is denied on every
        environment by default; other WP-CLI writes are denied on production by default)
    do: stop at that step — do not attempt an equivalent through another tool, do not
        rephrase the command to fall under a permitted class. Name the exact permission and
        environment that must be granted (Preferences → Nexus AI → WP Engine → Access &
        Permissions), state what remains uncleaned meanwhile, and keep the isolation from
        cp.isolate in place until it is. Expect this on a first run — the defaults refuse
        the whole cleanup catalogue, by design.
  - id: ab.client-red-line
    on: the cleanup plan touches a component the client policy protects (revenue-critical
        plugin, integration that must stay active)
    do: stop and surface the conflict as a conflict. Propose the compliant path (isolate
        rather than delete, clone-and-clean, staged removal). Proceed only on an explicit
        override acknowledged as an override, from someone with the authority to give it.
  - id: ab.entry-vector-unknown
    on: cp.entry-vector produces no log-supported hypothesis
    do: cleanup may still proceed — but the run cannot be reported as resolved. Say so
        explicitly in cp.post-mortem, keep the hardening from cp.rotate-credentials in
        place, and schedule a re-scan. Never substitute a plausible-sounding vector for an
        evidenced one — a speculative entry vector closes the incident on a guess.
  - id: ab.reinfection
    on: cp.verify-clean finds the artifacts back, or new ones
    do: full stop and escalate. The site is actively compromised with a live persistence
        mechanism or an open entry vector; further cleanup is whack-a-mole. Report the
        evidence and put restore-from-known-good and host escalation in front of the owner.
  - id: ab.scope-wider-than-one-site
    on: the same artifacts or attacker accounts appear on sibling sites/environments
    do: stop and widen with the owner before continuing. Cleaning one site of a
        multi-site compromise reinfects from the ones left alone.
communication:                   # facts the user must be told, verbatim-checkable
  - the findings, ranked by severity, each with its evidence (path, account name, log line)
  - what isolation was applied, when, and what it makes unavailable to real visitors
  - the snapshot id(s) and their verification status, before any cleanup runs
  - the exact commands proposed, shown in full, BEFORE approval is requested
  - the entry-vector hypothesis with the log evidence it rests on — or an explicit statement
    that the entry vector is unknown
  - which credentials were rotated and the consequences (sessions invalidated, users logged
    out, integrations needing re-authentication)
  - the blind spots this investigation cannot see — runtime behaviour and premium/paid
    component internals — stated in the post-mortem, not omitted because the news is good
  - anything left uncleaned because a permission was refused, named as such
---

# Incident response

Take a confirmed or suspected compromise from detection to resolution: contain, preserve,
understand, clean, rotate, verify, and write it up for the client. This runbook is
**strict**: execute checkpoints in order and attest each one. If a step cannot be
completed, take its abort path — never route around it.

Two properties of this procedure differ from every other runbook here, and both are
deliberate. **Evidence outranks speed**: cleanup is irreversible and destroys the only
record of how the attacker got in, so `cp.snapshot` precedes every destructive step.
And **every destructive step is individually gated**: cleanup is not one approval over a
batch of commands, it is per-item, because the blast radius of each differs.

## cp.triage — confirm the findings before acting on them

Start from the sentinel report and confirm each signal against live state — the report is
a detection, this checkpoint is the verification. Expect signals of several classes and
rank them by severity, not by ease of remediation:

- **Backdoors and webshells** — a known-bad plugin, a PHP file in a must-use directory
  that does not belong there, obfuscated `eval`/`base64` code. Critical.
- **Attacker accounts** — administrators beyond what the site's size justifies, default
  `admin` usernames, placeholder-domain emails, and synthetic-looking names (random
  suffixes, near-miss spellings of real accounts). The account inventory with creation
  times is the input to the timeline at `cp.entry-vector`.
- **Hostile-capability plugins** — file managers and code editors, whether the attacker
  installed them or the owner did. Active file management is arbitrary code execution.
- **Missing hardening** — no security plugin, file editing enabled in production, user
  enumeration open. These are exposure, not compromise; report them separately so the
  confirmed findings are not diluted.

State what you confirmed, what the report claimed that you could not confirm, and what
you could not check at all.

## cp.isolate — contain before you investigate

Reduce reachability before touching anything: maintenance mode, restricted access, or
the host's equivalent. Isolation is itself a change to a live site — tell the user what
it makes unavailable and when it went on. Keep it in place until `cp.verify-clean`
passes; if a permission refusal stalls the cleanup, isolation stays on, and that is the
tradeoff to state.

## cp.snapshot — preserve the infected state

Snapshot before cleanup: a backup of the site as it stands, plus copies of the specific
artifact files and the account inventory. This is evidence, not a rollback target — the
whole point is that it contains the malware. Attest the snapshot id and verify it
completed. Failure or unverifiable result: `ab.evidence-not-preserved`.

## cp.integrity-diff — what does not belong here?

Diff against known-clean references: core and plugin checksums, the expected must-use
plugin list, the known theme/plugin file set. Report each deviation with its path and
modification time. Two classes are load-bearing for the next checkpoint — files present
that should not exist at all, and files whose contents are obfuscated — because their
timestamps date the intrusion.

## cp.entry-vector — a hypothesis with evidence under it

Build the timeline: artifact creation times, account creation times, plugin
installation times. A tight cluster of artifacts inside a few minutes is one intrusion
event and dates it; that timestamp is what you take to the logs. Then find the log
evidence around it — authentication attempts against default administrator names,
requests to the artifact paths, upload endpoints hit before the first artifact appeared,
brute-force patterns.

State the hypothesis with the evidence beneath it and name your confidence. A vector
asserted without log evidence is speculation, however plausible; if the logs do not
support one, that is `ab.entry-vector-unknown` and the incident does not close as
resolved.

## cp.cleanup-plan — the exact commands, in full, before approval

Enumerate every destructive action as the concrete command it will be, grouped by class:

- **Remove webshells and unexpected files** — the specific paths found at
  `cp.integrity-diff` (e.g. an `index.php` planted in `wp-content/mu-plugins/`).
- **Delete backdoor and hostile-capability plugins** — by slug, deleted rather than
  deactivated; a deactivated plugin's files still execute when reached directly.
- **Remove attacker accounts** — with an explicit decision on content reassignment.
- **Restore modified core/plugin files** — from clean sources, never hand-edited.

Check the plan against the client policy set first: anything touching a protected
component is `ab.client-red-line`. Check it against the grants second — see
`cp.execute-cleanup`. Present the full plan and stop.

## cp.approval — per destructive step, not per plan

Approval is requested with the commands visible and is given per item. A blanket "yes,
do it all" is recorded as approval of the enumerated items only; anything discovered
mid-cleanup goes back through `cp.cleanup-plan`. Denial of an item removes that item and
leaves the rest — say what remains uncleaned as a result.

## cp.execute-cleanup — expect the gate, do not route around it

Execute item by item, verifying each before the next. The policy gate will refuse most
of this catalogue on a fresh install by design: file removal is denied on every
environment by default, and other WP-CLI writes are denied on production by default. That
refusal is `ab.grant-refused` — a named permission the owner must grant out of band, not
an obstacle to engineer around. Never substitute a permitted tool to achieve a refused
effect; that is the exact behaviour the gate exists to stop, and it happens most often
here, under time pressure, with the best of intentions.

## cp.rotate-credentials — assume everything was seen

Rotate on the assumption the attacker had read access to everything: authentication
salts and keys (which invalidates every session), administrator passwords, database
credentials where the host allows it, API keys and integration tokens stored on the
site. Tell the user the consequences before running it — everyone is logged out, and
integrations may need re-authentication. Rotation without cleanup is theatre; cleanup
without rotation leaves the attacker's stolen session valid.

## cp.verify-clean — scan again, from scratch

Re-run the full scan and diff, not a spot check of what you removed. Confirm the
artifacts are gone, no new ones appeared, the account inventory matches what was
approved, and hardening gaps found at `cp.triage` are closed or explicitly deferred.
Artifacts back, or new ones: `ab.reinfection`. Only after a clean verification does the
isolation from `cp.isolate` come off, and say when it does.

## cp.post-mortem — write it for the client, not for us

Draft the write-up in the client's register: what happened, when, what was affected, what
was done, what they need to do (rotate their own passwords, re-authenticate integrations),
and what will prevent a recurrence. Plain language, no internal tool names, no
speculation dressed as fact.

State the blind spots explicitly, including in the good-news case: this investigation
sees files, accounts, configuration and logs — it does **not** see runtime behaviour
(what the code did while it ran, what data left the site) and it cannot inspect the
internals of premium or paid components. A clean scan means no evidence was found in
what could be examined, and the write-up must say exactly that rather than "the site is
clean". Record the friction, the ordering constraints and the refused permissions from
this run; the next incident inherits them.
