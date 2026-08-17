# Re: v5 — verified, closed, and the copy sweep is done · from the architect & owner

*(2026-08-17. Responding to "UX Prototyping for Intelligence Docs v5" —
the rebundle with the permissions matrix. Short: the matrix is verified
against the shipped model to the letter; all three v4-response items
landed; the copy sweep you called "unblocked but small" has been run from
this side, its findings are ruled into Controlled Vocabulary v1.1, and
your open-items ledger is confirmed — everything is closed, parked on
purpose, or waiting on WP-20e.)*

---

## 1 · The permissions matrix — verified against the code, not the docs

Your five rows are the shipped model's five operations **verbatim**:
the type in `permissionsTranslation.ts` is
`'pull' | 'wpcli_read' | 'wpcli' | 'push' | 'delete'` — including the
read/write wp-cli split your matrix draws, which is real, not aspirational.
Two of your footnote claims are shipped *constraints with ids*, not copy:
"Production writes … are off by default; enabling is a settings/grant
change, never a conversation outcome" and the delete/promote opt-in. So
the matrix row values, the deny story, and the grant story all have code
behind them. One boundary to keep as 20b lands: grants ship **additive**
in v0 (a grant can only widen), and the global deny-by-default flip is a
separately registered, deliberately breaking change (WP-20f) — your
"this page sets what is denied everywhere" copy is the destination and is
right to be written that way; just don't let a changelog claim it earlier
than 20f makes it true.

## 2 · The three v4 items, confirmed landed

`SLO_HOURS` in the §3 table (one spec, one truth — done); "Attested is
not verified" promoted to a §5 behaviour row plus both "checked" fixes
(the vocabulary's load-bearing distinction is now in the contract, where
it belongs); §5b's abort closed with the four groups rendered from
per-site outcome records, counting rather than asserting. Nothing further
from this side on any of them.

One-line erratum in the README: the revision note now reads "`SLO_HOURS`
is gone" — the rename overshot; that line should still say
`STALE_AFTER_HOURS` is gone (replaced by `SLO_HOURS`). As written it
deletes the map the same paragraph relies on.

## 3 · The copy sweep — done, ruled, and mostly good news

The sweep was run from this side against the v5 prototype's user strings.
The "ledger" and "verified" families are fully fixed (the two remaining
"verified recently" strings became "checked recently" in this build —
confirmed). The full pass found exactly the "two or three more" you
predicted, and rather than sending them back as notes, they are **ruled
into Controlled Vocabulary v1.1** (the table in
`user-docs/your-copy-and-the-live-site.md` now carries the new rows):

1. **Procedure vocabulary is now sanctioned, not squatting.** v1 predates
   the §5b surfaces, so *runbook*, *checkpoint*, *attested*, "runbook
   added this", and *canary* were in use without a ruling. They now have
   rows. Two teeth worth knowing: *step* is reserved for GUIDED runbooks
   (strict runbooks have checkpoints — the reservation mirrors ADR-17),
   and *verified* is banned for checkpoints in the table itself, matching
   your new §5 row.
2. **"Install" vs "environments" were sharing the count-noun job.** Ruled:
   *environments* is the Nexus count noun ("203 sites · 367
   environments"); *install* appears only inside WP Engine-labeled
   contexts — which means your grants copy ("one named install") is
   CORRECT as written, because a grant quotes WP Engine's own unit.
3. **"Synced" is scoped.** It belongs to the WP Engine account-inventory
   refresh only ("last synced 2 hours ago" on Connections — correct).
   Never for site reads (*checked*) or content (*pulled*). Three acts,
   three verbs.

And one confirmation rather than a correction: "⚠ may be out of date" was
already v1's fact-level freshness phrase — your usage conforms, and the
levels compose ("checked 3 days ago · may be out of date · Check it now").

## 4 · Your open-items ledger, countersigned

**Blocked on eng — correct.** WP-20e is the meeting point, and the
sequence is live: the runbook registry, the split procedures, and
turn-carrier delivery are all merged; attestation/sequencing (20d) is
launching; 20e follows. Next cycle of this loop: procedure surfaces
against 20e's actual seam, RB-A2 + the audit view as the contract, the
eleven B-03 criteria as the shared script. Nothing for you to do until
that lands.

**Parked deliberately — correct, and doubly so.** Designing environment
detail against real lineage data rather than fixtures is your own
derived-never-authored rule applied to your own process. The lineage
producer (WP-14) is live, so the data will be real when you get there.

**Unblocked but small — now closed** (§3 above). The copy pass is done
and the vocabulary grew by ruling instead of by sweep-notes; future
prototypes can cite v1.1 rows instead of re-litigating word choices.
