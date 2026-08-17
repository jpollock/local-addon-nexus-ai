# Re: v4 — the brief's §6 and §7, answered · from the architect & owner

*(2026-08-17. Responding to "UX Prototyping for Intelligence Docs v4":
the standalone prototype + architecture brief. §6's twelve capabilities
and §7's eight questions are answered below, the §5b open item is closed,
and two errata are flagged. Short version: nothing in §6 requires a
surface redesign; ten of twelve exist or are in flight under named
packets, and the two real gaps are registered, not waved at.)*

---

## 0 · The §5b open item is closed — and you already built it

The brief still lists the abort affordance as open ("that copy needs the
real per-site outcome shape"). The shape was answered in our 5b response
(the four honest groups: done-and-standing / the failing site / skipped /
untouched, rendered from per-site outcome records), and your own source
already carries it — `RB_TARGETS` with the comment "per-site outcome
records, as the gateway keeps them: result, versions, attested backup id,
reason, observed at. The abort affordance renders from these — it never
asserts a count it hasn't counted." That is the ruling, implemented. The
brief text just lagged the build; strike the open item.

Same for the audit rows: `auRows`' "an un-run checkpoint has no evidence"
with the empty right-hand cell is RB-B's invariant living inside RB-A2's
audit view — exactly the disposition we ratified. Done well.

## 1 · §6, capability by capability

Numbered in the brief's order. **Shipped** means live on the branch today;
**in flight** names the packet.

1. **Per-fact provenance and age — shipped** (Milestone 1). Every
   observation is an envelope carrying source, trust class, `observed_at`
   and `recorded_at`; twins fold per-fact, so age is fact-granular, not
   per-sync.
2. **Source-class clock semantics — adopted as doctrine; partially
   shipped.** The four-clocks distinction is one of the three things we
   adopted from your loop. Site-state (moment-true) is fully live with
   per-class SLOs (the R1 revision you already built). Period-accumulating,
   daily-closing and streaming arrive with the instruments work (GA4/GSC
   summaries-in — roadmapped, not yet a packet). The envelope can carry
   the clock class now, so nothing you designed needs to change shape.
3. **Read-only verify path — shipped** (`verify_site_live`, M1). Per-site,
   hard no-writes, per-site unreachable/timeout reported individually —
   your "no answer, never guesses" is its existing contract.
4. **Stored vs observed as separate records — shipped by construction.**
   The ledger is append-only; a correction supersedes in the fold and
   deletes nothing; the diff is expressible because both records exist
   forever.
5. **Task-level audit — core shipped; one named gap.** Every chat turn
   mints a TaskId; `task.context.assembled` (the manifest),
   `task.action.executed` (via the gateway, both dispatch chokepoints),
   `task.outcome.recorded` and `task.rationale.recorded` all correlate on
   it, stored locally. The gap: the manifest records what rode; it does
   not yet record **what was omitted and why**. That is a real assembler
   enhancement and is now registered — it will not be quietly reinterpreted
   as "derivable."
6. **Capability model with standing policy — ruled exactly as you state
   it; shipping in two stages.** WP-20b (in flight now) builds the grants
   object — additive in v0. WP-20f (registered) is the deny-by-default
   flip, deliberately separated because it is breaking. "Spend money has
   no code path" is literally true today and stays true.
7. **Gate enforcement below the UI — the backup gate is already below the
   UI** (tool-layer, the agent cannot proceed past it); strict-runbook
   sequence/presence enforcement is WP-20d. One boundary to keep in your
   copy: the gateway enforces **sequence and presence, never quality** —
   a narrative attestation is recorded, not verified, and must never
   render with a verified tick.
8. **Write results update the model — shipped.** Producer chokepoints
   emit on write, twins recompute, and the lineage work (WP-14) is what
   stops a later live check from attributing our own change to an outside
   actor.
9. **Structured refusal — doctrine shipped, uniform shape in flight.**
   Not-connected / not-permitted / not-known are three different records
   today (health surface, permissions mirror, twin absence), so the
   distinction is derivable, and the arming doctrine's "instructive
   refusal" (name what's missing, name what would fix it) is the ruled
   template. The uniform surface shape rides 20b/20e.
10. **Session-scoped context assembly — enumerable shipped; *editable* is
    the second real gap.** The manifest enumerates exactly what you need
    for the context panel, with supplied vs quoted per R3. Editing the
    set from the panel is not built and no packet owns it yet — registered
    as a 20e-adjacent seam, to be scoped when 20e's UI packet lands.
11. **Session state as data — derivable, no dedicated surface.** Turn
    counts, pending approvals and outcomes are folds over the TaskId
    correlation (approvals are ledger events with causation since WP-19).
    A cheap query surface for the sessions list is a small packet when
    the list is built for real.
12. **Change history with hold duration — derivable today.** Append-only
    means hold duration is the interval between change events; the
    divergence comparator (WP-15) already computes per-flow change sets.
    The change report can be generated, per your own invariant.

## 2 · §7, the eight answers

**Q1 — does draft-publish exist?** No, and it is not in scope for this
phase. No packet builds copy-draft → live-publish; when it exists it will
be a new capability with its own runbook and gates, not a bolt-on to the
split. Your resolution — the content half ends in an honest pointer —
is correct and stands. Do not design the action.

**Q2 — what may move scope?** Narrow-only, ruled. On "can the system
reliably detect 'those two'": resolution rides the task frame (the
assembler carries the session's entities), but reliability is made moot
by your own device — **the echo is the commit**. Scope changes only when
announced ("Narrowed to X and Y — say 'all sites' to widen again"), so a
wrong resolution is visible at the moment it happens and correctable in
one turn. Narrowing is per-turn data in the frame; reversal loses
nothing because nothing else moved.

**Q3 — is the freshness threshold global?** Answered by your own R1
revision, confirmed here: per fact class, and it is **policy, not
heuristic** — the per-class SLO table in the spine is the source, fed to
the UI, overridable as law later. One erratum below.

**Q4 — how is "used here" determined?** The R3 ruling is final: *supplied*
is derivable with certainty (the manifest), *quoted* is checkable against
the trace, and causal reliance is **not derivable — so it is never
claimed**. Your implementation of the three states is the answer; there
is no stronger promise to be had, from us or anyone.

**Q5 — the correction's lifetime.** Three clauses. The correction
*record* is permanent — it is a ledger event and survives everything.
Its *effect* on the served value lasts until a strictly newer observation
supersedes it — and a contradicting sync IS a newer observation, so yes,
the sync wins the fold. But the dispute stays in the change history, and
because corrections are episodic intelligence, a re-assertion of a
previously disputed value is exactly the shape the episodic consult
exists to surface ("you corrected this before — check it now?"). That
offer-on-recontradiction is a design seam worth building when you get to
the change report; the record beneath it already exists.

**Q6 — partial failure mid-write.** Ruled, and you built it: the halt is
per-site, completed sites stand, rollback is never automatic, and restore
is a named, separate, gated action per site. Not per-batch, not a
mid-run modal choice — the choice the user makes at approval time is the
canary policy; the choice after a halt is rendered from the four groups.

**Q7 — where does the honest path get expensive?** Three costs, one
binding. Audit writes: local SQLite appends — cheap, and measured (replay
over 9,472 real events reproduces the folds byte-identically). Per-fact
provenance: free at write time; it is envelope fields, not extra I/O.
The binding cost is **live-check fan-out** — per-site round-trips at 367
environments is the one promise that scales linearly with fleet size.
That is why the architecture buys freshness with background producers and
SLOs rather than on-demand sweeps, and why the live-check offer is scoped
to exactly the sites the answer named — your scoping rule is the cost
control, so hold it. On the token side: the per-turn budget is the other
real constraint, and it is why policy re-asserts by hash (ADR-20) and
why procedure delivery is full-body once per task with an 8 KB ceiling —
ratified this week over the canonical whole document, refusal not
trimming.

**Q8 — local-only storage.** True today, all of it: the ledger (which IS
the audit trail), the law cache and attachments live on this Mac; there
is no server component. Second machine: machine identity is designed
(each satellite is its own identity, ADR-14) but nothing syncs the
record yet — two machines are two records, and hub/tenancy is
deliberately deferred. Copy guidance: "stays on this Mac" — present
tense, true, keep it. Avoid "only ever"; the hub, when it comes, will be
opt-in, and today's copy shouldn't foreclose it or promise it.

## 3 · Two errata in the brief

1. **§3's data-contract table still lists `STALE_AFTER_HOURS` (single
   threshold, 6)** — and the README's map list does too — while §4's R1
   revision correctly says it is gone, replaced by per-class SLOs. By
   your own rule the §3 table is "the real specification," so it must
   not name a deleted map. One spec, one truth.
2. **"Verified" is doing two jobs.** In the freshness strings ("62 items
   haven't been verified recently") it means *checked*; in the procedure
   session, attested-vs-verified is a load-bearing distinction (see §1
   item 7). Controlled Vocabulary v1 uses "checked N ago" / "needs a
   check" for freshness — one verb per act. Reserve *verify* for the
   live check's formal name if you want it at all; never let it near a
   checkpoint that is narrative.

## 4 · What's landing under you right now

WP-20a merged this week: the runbook registry is real. The declared-
procedure block you render now has live data behind every field — id,
version, strictness, capability, and an integrity hash over the canonical
whole document (the same text the 8 KB ceiling measures — ruled). All
eight anchor checkpoints are narrative *today*; per-checkpoint `attest:`
authoring is in flight (WP-20c), grants are in flight (WP-20b), gateway
sequencing is next (WP-20d), and **WP-20e is the packet where this
prototype meets the product** — the next cycle of this loop should be
procedure surfaces refined against 20e's actual seam, with your RB-A2 +
audit-view pair as the contract. The eleven B-03 criteria remain the
shared script.
