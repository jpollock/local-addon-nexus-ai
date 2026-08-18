# Re: Selection to scope — adopted, five pins inherited, two fixture flags (one is a gift) · architect & owner

*(2026-08-18. Responding to the cycle-one artifact "Selection becomes
scope." The scope block is adopted as the walk's first typed handoff
artifact; its five pins become the acceptance criteria of the packet
that builds the carrier. Two things in the sketch's fixture need
naming — one is a discipline slip the shipped code already prevents,
and one is a collision with shipped law that, read correctly, hands
you the best missing state of this design.)*

## 1 · Adopted, and what your pins buy

The one-artifact-two-densities move is exactly right, and the pin that
enforces it — the scope block's rendered text byte-identical across
the selection bar, the companion declaration, and the stage document —
is the promotion-loses-nothing rule applied to a block instead of a
session. All five pins are inherited as the acceptance criteria of
**WP-32 · The scope carrier** (registered with this response): renderer
selection → task frame → arming → dry-run, with your fifth pin as the
headline requirement — **the arming carries the scope; a run that
derives its own targets fails the journey.** That is new engineering
(today the model re-derives targets from the plan) and it is the right
requirement: the set she made is the set that runs.

One refinement of yours we adopt gratefully: **targets are cells, not
sites** — your dry run says "Alpha · staging" and "Bravo · production,"
so the scope's unit is (site, place), the cell that motivated the
selection. The contract is richer than the companion's "site ids" and
the model text is amended to match.

## 2 · Flag one — the checkpoint list in the sketch is authored, and
the order it authored is the incident's

Your declaration lists eight checkpoints in an order where the canary
updates (3) BEFORE the hold-for-you gate (4). The shipped runbook's
order is consult-history → dry-run → **approval** → backup → canary —
consent precedes every write, including the canary's. Canary-before-
approval is not a stylistic variant: writes-before-consent is
precisely what this week's live incident was, and pause-after-canary
(the policy your card offers) governs what happens AFTER the canary
under an approval already given — it never moves the approval below a
write. No code is at risk — the shipped render derives the declared
list from the canonical document and cannot show this order — but the
sketch must not teach it. The deeper rule, which is your own:
**derived-never-authored applies to the checkpoint list itself.** A
design fixture that authors a checkpoint sequence is the same defect
class as a receipt that asserts a count; sketch fixtures should be
generated from a real runbook's declaration, and we can hand you the
derivation's output for any shipped runbook on request.

(Small, same family: the marks "provable / gate / —" are new
vocabulary. Either they render from the shipped ATTEST_WORDS, or —
if you want companion-density shortforms — propose the mark set and
we ratify it into v1.1 like everything else. A blank mark on a
narrative checkpoint reads as nothing-to-say; the shipped words exist
because that silence lies.)

## 3 · Flag two — the fixture's production targets are refused by
shipped law, and that refusal is the state you should design

Bravo·production and Charlie·production sit in the scope under
`rb.bulk-plugin-update` — whose shipped contract excludes production
(`scope.environments: [local, wpe_staging, wpe_development]`;
"production requires a separate grant + its own runbook version"), and
whose `pre.no-production` precondition refuses the arming outright. As
drawn, this scope never arms.

But read as a design prompt instead of a defect, this is the best
missing state of the artifact: **the split scope.** The selection
honestly spans places with different law — three cells the current
grant can run now, two cells that need a grant and a runbook that do
not exist for this capability yet. The scope block is exactly where
that split should render: the runnable subset armed, the barred subset
stated with its reason and its DOOR — which is J-Refusal arriving
inside the handoff, the refusal naming what would make it yes before
anyone hits a gate. "Excludes: Foxtrot — halted, and said so" already
proves the block knows how to carry an exclusion with a reason; the
production rows are the same pattern with a Govern door attached.
Design that state and the artifact covers the walk's hardest case:
a selection whose consequence exceeds its authority.

## 4 · Standing

The scope block is the contract; WP-32 builds the carrier against your
five pins plus the cells-not-sites refinement; the split-scope state is
yours to design when you take this artifact to its second draft. The
declaration's checkpoint list stays derived — in sketches as in code.
