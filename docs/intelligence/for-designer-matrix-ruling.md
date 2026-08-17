# The site-at-places matrix — ratified, with four boundary conditions

*(Architect, 2026-08-17. Responding to the environment-detail exchange:
the parked screen dies, the matrix replaces it. This note is the ruling
so the next prototype cycle can cite it rather than re-derive it.)*

First, the reassurance the exchange deserves: **the architecture had
this nailed; the IA was the transitional shape.** ADR-21 is explicit
that the Site is the logical thing, environments are its durable
manifestations, and "which environment is this copy?" is an invalid
question by design. The roadmap has carried the consequence since the
model was adopted: *"the UI inversion (one Site card, N environments,
copies as tracked snapshots) — the entity graph makes it a rendering
change, not a migration."* The matrix is that inversion arriving through
design instead of waiting for post-M4 — which is the best possible way
for it to arrive. "Environments nest inside a site" was IA shorthand
that the prototype reified into pages; the exchange caught it. Nothing
in the recorded model changes; one screen in the prototype does.

The matrix itself is the ruled model's native rendering: one row per
fact, one column per place, divergence as a row whose cells disagree —
the same shape as the permissions matrix and RB-B, and for the same
reason: **the honest rendering of records is a grid where an empty or
disagreeing cell does the work.** Ratified, with four boundary
conditions:

**1 · The divergence flag is the comparator's verdict, never naive cell
inequality.** WP-15's comparator is lineage-aware and per-flow; "these
two cells differ" is not the same fact as "this place has diverged."
Development running theme `alpine` while everything else runs
`alpine-child` may be intentional per-place configuration; your copy at
WooCommerce 9.5.1 against staging's 9.9.2 is only "behind" along a flow
that connects them. Render the ← marker from what the comparator
computes; let raw inequality without a comparator verdict render as
plain difference, not as an alarm. (This is your own derived-never-
authored rule — the flag is a computed verdict, and cell !== cell is not
the computation.)

**2 · The your-copy column sits in the same grid but is a different
species, and its comparisons run along its two flows.** Environments are
durable; your copy carries per-flow moving pointers (code: branch;
content: pulled-from a source at a time). Its cells compare against its
code upstream and its content source — not pairwise against every
column. The Content row in your own sketch already behaves this way
("11 days old" is an age against a source, not a diff against
development's "—"). Keep that asymmetry: the grid unifies the *reading*,
not the *semantics*.

**3 · Place-scoped facts are rows with empty cells; place-only actions
anchor on the column header.** Some facts belong to the place, not the
site-as-manifested — PHP version, SSL, backups, install usage. They fit
the grid fine (a "—" cell is honest). Operations that belong to one
place (promote from staging, restore a backup) hang off the column
header. If a place ever accumulates enough place-only material to want a
detail view again, it returns as a **column-focused view of the same
matrix** — never as a separate page with separately authored facts.

**4 · Pre-tracking history says "watching since," never "unknown."**
Your lineage worry was half-dissolved, not fully: history still explains
a disagreeing cell, and the real record has hard edges — WP-14's
standing finding is that Local persists no durable WPE sync history;
**the ledger IS the only durable record.** So an environment whose
origin predates tracking has an honestly absent history, and the
controlled vocabulary's omit-never-"unknown" rule applies: the
explanation line reads "Nexus AI has been watching this site since
14 August" — a fact we own — not "origin unknown" — a shrug we don't.
Deleted sources are real too (a push from a local copy that no longer
exists): the ledger keeps the event, the entity is gone, and the copy
should name what the record supports: "pushed from a copy that has since
been deleted."

**The joint session survives its own reason being dissolved.** You no
longer need real lineage to design the *subject* — divergence is the
subject and WP-15 computes it. But condition 4's ugly cases (pre-tracking
origins, deleted sources, orphaned pushes) are exactly what the session
should look at, against real `wpeSiteLinks` and real ledger events, when
the matrix's explanation lines get designed. Same session, smaller
scope, later urgency — after WP-20e, with the rest of the loop.

**Vocabulary:** "this site, at staging" is adopted — Controlled
Vocabulary v1.1 now carries a locative-phrasing row ("the site is one
thing manifested in several places"; "the staging environment" as a
noun-of-place users must open is the never-say). You are right that it
sidesteps the dev-collision finding; the v1 table's №2-item-6 mitigation
stays for the one place it is still needed (first reference in a
session).
