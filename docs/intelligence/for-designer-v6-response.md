# Re: v6 — the ten answers, the sequence checked, and some news · architect & owner

*(2026-08-18. Responding to "Status and roadmap" in v6. Answers by
number; §4 checked with three amendments; §5 countersigned whole. One
packet is created by this exchange — WP-26, registered — and there is
news at the end you'll want before your "Theirs" rows.)*

---

## §3, answered by number

**1 · Stream wiring: the emission is a platform packet, created by this
question — WP-26, registered today.** You are the consumer; the emitter
lives host-side (the same seam that folds the cursor). The payload
question is already answered by the shapes you're rendering:
`ProcedureArmedEvent` carries the WHOLE `DeclaredProcedure` (once, at
arm), and `CheckpointChangedEvent` carries `changed: CheckpointState[]`
— the diff, exactly as `diffCheckpointStates` suggests. That's not an
accident; it's ADR-20's cadence at the UI seam: the full document rides
once, changes ride after. **Coalescing is the EMITTER's job**: one event
per checkpoint-state transition, never per ledger event — the renderer
must not need to know the ledger exists, and burst semantics is the
platform's knowledge of its own event flow. A rail that re-renders per
checkpoint is the contract. Build your consumption now against a local
fake emitter; WP-26 replaces the fake with the real one and your code
shouldn't notice.

**2 · `canary_policy`'s producer is the APPROVAL — a field on
`task.rationale.recorded` — and asking created the packet.** The phase-1
ruling was always "the canary policy is chosen at approval" (your own
§5b, adopted); what was missing was the recording. WP-26 carries it: the
approval card offers the two values (`pause-after-canary` default,
`continue-if-clean`), the platform records the choice on the approval
event, the gateway treats absence as the default. Your removal of the
control was correct — offering a choice nothing records was fabricating
consent — and this is the producer that lets you put it back. Not the
gateway's own decision: consent is elicited intent, and elicited intent
is recorded from a human act, which the approval is.

**3 · `verifiableCount` does NOT move under a run, and the armed version
is recoverable per task — your assumption is confirmed and mechanized.**
Every task's manifest records the armed procedure's id, version, and
hash (ADR-20; `manifest.procedure` since WP-20c). A run keeps the
denominator it armed with; a later run gets the new one; the audit view
renders each historical run against ITS OWN document, never against the
current registry. And note the compounding answer: since the
`ProcedureArmedEvent` carries the whole `DeclaredProcedure` —
`verifiableCount` included — once WP-26 emits it, every historical run's
denominator is self-contained in its own event stream. Q1's payload
ruling is also Q3's archival answer.

**4 · The change report does NOT need the abort panel's redesign — the
two deltas are different truths, and yours has a producer.** The change
report's "9.5 → 9.9" derives from OBSERVATION pairs: successive
`state.plugin.observed` events for the same fact, which the append-only
ledger records and the comparator's change sets already expose — with
hold duration, which is what makes the report worth reading. That is a
claim about what was OBSERVED TO CHANGE, and it is fully producible
today. The abort panel's `from_version → to_version` is a claim about
what THE RUN's write did — `task.outcome.recorded`'s business, which has
no producer yet (registered at the 20e close as the first item for
whichever packet gives abort groups their versions). Same rendered
shape, two substrates: **label the change report's delta as observed
change** (the source-labeling constraint already obliges it) and never
let either surface borrow the other's substrate. Your catch — "same
claim, two surfaces, and I only caught it in one" — is the standing risk
in §5 doing its job; the resolution is that one of the two was honest
all along.

**5 · Context-set editing: split the verb.** For SITES, "remove" already
exists — it is scope narrowing, per-turn, with the echo as the commit
("Narrowed to X — say 'all sites' to widen"); wire the chip to compose
that utterance and it's real today. For SOURCES and ATTACHMENTS, remove
and re-fetch have no seam yet — downgrade both to intent (the control
states what it WILL do and that the platform doesn't take it yet) until
the registered seam gets an owner. Don't hold the whole panel for the
missing half.

**6 · "What it left out, and why": mark it, keep the beat.** The
placement is right and the beat should survive — but as a marked
placeholder ("planned — the platform does not yet record omissions"),
never as authored prose sitting where a derivation will someday live.
That is your own delete-the-sentence rule applied prospectively: an
authored version of this beat is exactly the sentence a future reader
would trust and shouldn't.

**7 · Restore IS a capability with its own runbook — and your abort
panel is a LAUNCHER, correctly.** Nothing ships it yet (seven runbooks,
none restore). When authored, it will be strict, and note the pleasing
consequence of standing law: restore OVERWRITES an environment, so
`c.backup-before-overwrite` applies to the restore itself — a verified
pre-restore snapshot before the rollback, turnbacks all the way down.
Until that capability exists, "Restore this site" is an arming request
for a capability that will refuse instructively — render it as the
launcher of a named, gated, per-site action, never as a thing the panel
does itself. Registered alongside WP-20g's family.

**8 · Name the SCOPE, not the machine's uniqueness.** "The whole record"
unqualified overdraws; "only ever on this Mac" forecloses the hub. The
present-tense discipline extends: the audit view's claim is **"everything
Nexus AI did from this Mac"** — true now, and STILL true after the hub,
because a hub adds other machines' records without changing what this
one is. Two prepositions, two facts: "from this Mac" scopes the actor,
"stays on this Mac" scopes the storage. Both survive the future.

**9 · Law vs default on SLO numbers: yes, but not yet.** Nothing can
write an SLO override today, so a provenance distinction would have one
arm — noise. The ruling for when overrides exist: the number's
provenance rides the line per the source-labeling constraint ("held for
24h · shipped default" vs "· your policy"), and the distinction ships
WITH the override mechanism, not before it. Your bare "held for 24h" is
correct today for the same reason "stays on this Mac" is: it states the
present truthfully.

**10 · What would shorten a sitting: render the corroboration.** The
judge's slowest verb this week was *cross-check* — every historical
claim in the model's prose, hunted through the carrier and the tool
trace for its supplying record. R3 already gives you the contract
(supplied / quoted / neither); the surface that would halve a sitting
renders each factual claim in the reply linked to its supplying record,
with an unlinked claim visually loud — that is must_not-fabricate as a
glance instead of an hour. It's also the same import trick as
`PROCEDURE_AUDIT_COLUMNS`: if the eval sheet and that rendering share
the claim-to-record join, judge and user read the same surface. The
ordered mutation list is cheap and fine; the corroboration render is the
one that changes the economics.

## §4, checked — three amendments

The sequence is right. Amendments: (1) **"Now" is even more now than you
think** — build the stream consumption against a fake emitter
immediately; WP-26 is registered and its contract above is stable (whole
declaration at arm, diffs after, emitter coalesces). (2) **The change
report moves from "Next: re-derived or redesigned" to "Next: re-labeled"**
— per answer 4 it keeps its shape and gains a source label; cheaper than
you budgeted. (3) **The lineage session should wait for one more packet**:
the incident producer (WP-25, design note in progress) adds
`episodic.incident.recorded` from real sentinel findings — the
explanation lines you'll design in that session should have incident
vocabulary available, not just sync vocabulary.

## §5 — countersigned, all five

Especially the superseded-not-updated candidate files (one contract, no
drift — the shell is the contract) and the boolean matrix ("ask first"
is what the gates already do, not a permission level — exactly the
distinction the deny-flip ruling protects). The standing risk paragraph
should be framed somewhere permanent; it is the project's best sentence.

## The news

Your two "Theirs" rows moved while you were writing. **B-03 ran at
pass³ and PASSED** — the full sitting, live model, three runs: the
declared procedure governed behavior the prompt never asked for,
history was consulted and visibly shaped the plan, the canary was
unprompted, the halted site stayed halted, and the gateway refused
out-of-sequence calls live. One run even distinguished its own narrative
attestation from platform verification unprompted and filed a runbook
improvement. The three transcripts are archived at
`sitting-transcripts/b03/` — real declared-procedure flow to design
against instead of fixtures; they are the best design material this
project has produced. And the first real pull ran end to end the same
night: the chip recounted, the health line flipped a producer from DARK,
and when human memory went 50/50 about what happened, the ledger
answered in one query. The surfaces you've been designing are now
describing a system that has done all of it for real, once.
