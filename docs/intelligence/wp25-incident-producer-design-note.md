# WP-25 · The incident producer — design note for owner review

*(Architect, 2026-08-18. This is the note that precedes the prompt, per
the WP-20 pattern: positions to ratify or amend before an agent sees a
packet. The incident producer is the highest-leverage single packet on
the board: it unblocks E-01's last criterion, D-02 — the highest-value
eval in the set — and phase 2 of the UX (Home's needs-you rows), and it
completes the episodic family the fixture has been impersonating since
WP-13.)*

## 0 · The gap, measured

`episodic.incident.recorded` exists in the taxonomy, is consumed by the
assembler's episodic retrieval, is summarized by `episodicSummary`'s
allow-list, has carried two eval families through five sittings — and
has NEVER been emitted by the product. Every incident event in every
ledger is `via fixture:e01-incident`. The runner's standing BLOCKED says
it exactly: outside the fixture there is no "this broke checkout last
time" event to query. Meanwhile the product already OBSERVES incidents
in two places and records them in neither.

## 1 · What counts as an incident — v0 positions

**P1 · Two sources in v0, both already instrumented; a third deferred.**

- **(a) Sentinel findings.** The security-sentinel agent already
  produces structured reports (scan → report with findings). A finding
  at or above a severity threshold IS an incident observation: the
  platform noticed something broken or breached on a site. The producer
  folds report findings into `episodic.incident.recorded` at the
  report-completion chokepoint — the same tap-the-chokepoint pattern as
  the webhook and sync producers.
- **(b) Procedure aborts.** A strict run entering an abort path
  (`ab.backup-failed`, `ab.canary-regression`, `ab.mid-fleet-failure`)
  is an operational incident by construction — the runbook's own
  definition of "something went wrong enough to stop." The producer
  derives an incident from the abort's `task.outcome.recorded`, carrying
  the abort id, the checkpoint, and the affected sites. This closes a
  loop nothing else closes: the NEXT run's cp.consult-history retrieves
  the LAST run's abort. That is the anchor slice's episodic promise made
  real.
- **(c) DEFERRED: user-told incidents** ("checkout broke last Tuesday")
  via the Tell channel. It is elicited intent and wants its own care
  (attribution, retraction, trust class `told`); v0 does not attempt it.
  Registered, not scoped.

**P2 · The payload contract matches what `episodicSummary` already
serves.** Fields, all optional except the first two: `component`
(plugin/theme/core slug, or `site` for site-level), `symptom` (one
sentence, human-authored-quality, from the sentinel finding title or the
abort's reason), `from_version` / `to_version` (when a version change is
implicated — the abort source can often supply these; note this is the
SAME pair the abort-groups UI is waiting on, so one producer feeds both
consumers), `correlates_with` (component slugs), `severity`
(sentinel-mapped), `resolved` (boolean + `resolved_at`), `source`
(`sentinel:<report-id>` or `abort:<task-id>/<abort-id>`). No new
envelope fields; `observed_at` is the scan/abort time, not the fold
time. The fixture's shape was always a forward contract for this
payload; the producer makes the fixture retroactively honest.

**P3 · Resolution is observed, never assumed.** v0 rule: a sentinel
incident resolves when a LATER scan of the same site reports the same
finding class clean — the producer emits an amendment (`resolved: true`,
`resolved_at`) as a new event superseding in the fold, never mutating.
An abort incident resolves when a later run of the same capability on
the same site completes (`task.outcome.recorded`, success). If neither
occurs, it stays open — an open incident is a fact, not a nag.

**P4 · Change-gate and dedup.** Same finding on consecutive scans emits
ONCE (the change-gate pattern from the spine); a re-scan that still
shows the finding refreshes nothing. Dedup key: site + component +
finding class. The episodic family must not become a heartbeat.

**P5 · Routing is already ruled.** ADR-22: episodic → Site-scoped across
environments. The producer stamps the entity per the three-layer rules
(the site the incident occurred on, in whatever manifestation), and the
assembler's existing retrieval does the rest — no assembler changes in
this packet.

## 2 · What it unblocks, explicitly

E-01 criterion 0 flips from BLOCKED to judgeable (the query has a real
producer behind it). D-02 becomes runnable end-to-end (sentinel fixture
→ real incidents → containment/remediation runbooks). Home's needs-you
rows (UX phase 2) get their data ("62 items haven't been checked
recently" has a producer; "checkout broke on Bravo last month" joins
it). The abort-groups version pair gets its first producer (P2). The
designer's lineage-session explanation lines gain incident vocabulary.

## 3 · Scope boundaries

IN: the producer module (`src/main/intelligence-host/incidentProducer.ts`
by pattern symmetry with `syncProducer.ts`), its two taps, the payload
contract, resolution amendments, change-gate, tests + mutation battery,
WORK_PACKETS note. OUT: no assembler changes, no UI (phase 2's packet
consumes this), no new topics (the topic exists), no Tell-channel
intake (P1c), no sentinel changes (tap its output, never its behavior).
Locks: `src/main/intelligence-host/` — serialized; **must wait for or
coordinate with WP-26**, which holds that lock now. Sequence: launch
after WP-26 merges.

## 4 · Escalations pre-answered

The topic exists; the payload is new-but-versioned within the existing
schema discipline — the packet presents the payload contract in its
report for ratification at the gate (same hold WP-26 carries for
`canary_policy`). Anything wanting a sentinel behavior change, a new
topic, or Tell intake: stop and escalate.

## 5 · Acceptance

A sentinel scan with findings on a real site produces incidents the
assembler retrieves on the next chat turn about that site (live smoke,
same shape as the first-real-pull). An aborted fixture run produces an
incident the next run's cp.consult-history line carries. E-01's
criterion 0 check rewritten against the real producer (the WP-20e
pattern: probe facts, check does the conjunction). The eval runner's
BLOCKED count drops by one, honestly.
