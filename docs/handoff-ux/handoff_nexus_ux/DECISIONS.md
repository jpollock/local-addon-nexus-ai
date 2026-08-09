# Decisions

## Settled

**One surface, no developer mode.** An earlier draft proposed gating SSH/CLI/index/port material
behind a mode toggle. Rejected. Instead each item is either translated into a consequence
(*"77 sites we haven't looked inside yet — Sync now"*) or moved to Settings → Advanced. Test for
each: would a developer actually miss it? Most of this material is reassurance that the machinery
is running, not something anyone acts on — which is why one surface can serve both audiences.

**Health is a pill, not a tab.** "Is this thing working?" is one bit of information checked often
and briefly. It currently costs a full tab and three screens of scroll, and answers wrong. It
becomes a persistent header indicator with the detail on click. This makes fixing the health
calculation a prerequisite rather than a cleanup: people will stop opening the tab and start
trusting the pill.

**Agents stay agents.** An earlier recommendation was to replace them with outcome-named
"Workflows". Dropped — the team has agents, not workflows, and rebuilding the cards in plain
language captured most of the benefit without a new object model. The win was the card's content,
not renaming the concept.

**Chat has no agent picker.** A Content / SEO / Site health selector in the composer reintroduces
the mechanism the rest of the design removes. Route automatically; name the specialist afterwards.

**External is a first-class site type.** `This Mac` / `WP Engine` / `External`, with the host named
on the row. External sites cap at **Detailed** knowledge, never Searchable — an honest reflection
of what a generic SSH connection yields, and it is stated at connect time.

**Primary buttons use `#0a8189`, not `#0ECAD4`.** The brand cyan with white text fails WCAG AA at
button sizes (2.96:1). Same hue, 4.65:1, already in the palette.

## Changed on contact

Two recommendations from the review did not survive building.

**The Inbox as the default front door** is weaker than claimed. Once the panel has an Insights tab
it does the "what needs me" job continuously, and the Inbox becomes a queue you visit deliberately.
Still worth having; less obviously the landing surface.

**"One screen serving both personas"** is softer than it sounds. A 367-row table is agency
furniture; a marketing PM will never open it. One surface works because each persona ignores
different screens — not because the screens serve both. Worth naming honestly.

## Open

**Staging and revert — the important one.** Every write surface in the prototype promises
*"staged first, nothing goes live until you say so"*, and nothing shows what staged looks like,
where staged-but-unapplied work lives, what revert costs once something is live, or how any of it
behaves across twelve sites at once. This is the precondition for letting non-developers act on a
client's site. The mechanism the team already uses — pulling a WP Engine site down and working on
the local copy so the work is safe — is the right foundation, and the same pattern applies to
marketing-side work.

**Destination or panel.** The vision frames dissolve Nexus into Local as a panel and a nav item,
with no Nexus dashboard at all; today it is a destination you visit. The code has arguably already
voted — the panel is globally mounted and the dashboard duplicates it — but this should be decided
deliberately, because most smaller questions fall out of it.

**The six site counts.** Still unaudited. Write down what each is scoped to before building
anything on top of them.

**Fleet volume.** Every number in the prototype is synthetic. The Inbox design differs
considerably at 10 findings a week versus 200; that should be measured before it is built.
