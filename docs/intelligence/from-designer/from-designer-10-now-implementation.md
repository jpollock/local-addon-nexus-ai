---
title: Implementing Now — where each change actually lands
author: designer (Nexus AI UX)
source: Now screen.dc.html · Addon audit and redesign.dc.html
date: 2026-08-20
status: proposed — implementation route, read from the shipped tree
---

# Implementing Now

Read the tree before proposing an order, and the order changed. Most of this is not a component edit.

## 1 · The headline is composed in the host, not the renderer

`src/main/intelligence-host/sessionRegistry.ts` composes every row's headline:

```
return `${head} under ${row.runbookId ?? row.capability} — ${done} done and standing, ${failed} failed`;
```

and, for an empty target set:

```
if (total === 0) return 'no targets on record';
```

So the verdict rewrite is a change to one derivation, in one file, and every surface that reads `TriageView` inherits it — the arrival, the panel, and the rail badge's own accounting line. `Arrival.tsx` does not need to change: it already renders `situation.headline` verbatim and takes its chip, rule and door from ratified copy.

**The consequence:** this is a smaller change than the audit assumed, and it is in the right place. A verdict assembled once in the host cannot drift between the densities.

## 2 · The fact the rows need already exists

The Now sheet asked whether a run can report writes-in-scope as a number. It can, and it already does: `done` and `failed` are those numbers, and they are what the current headline prints as two zeros. `done === 0 && failed === 0` **is** "has changed nothing" — the most useful sentence on the surface was already in the data, formatted as the least useful one.

That retires the second engineering question. The first stands: whether the four `incident.opened` events on `theawfulpm-test` carry a causal link. If they do, they coalesce; if not, the row states its own limit, as drawn.

## 3 · The copy route is a generator, and it runs from the design files

`returnCopy.generated.ts` is extracted by `scripts/generate-return-copy.ts` from two files:

- `docs/intelligence/from-designer/fixtures/scenario-return.js`
- `docs/intelligence/from-designer/from-designer-09-return-arrival.md`

with `fixtures:return-copy:check` failing closed on a stale copy. So every ratified sentence reaches the product by being written into the design source and regenerated — not by editing the renderer. Sentence changes are mine to make and mechanical to land.

## 4 · The apologetic line is already isolated, and shorter is ratifiable now

`arrivalModel.ts` holds `AUTHORED`, every sentence the packet wrote that the designer did not, gate-held so a report can extract it mechanically. It contains exactly the line the audit flagged:

> No producer reports how many facts are past their freshness window, so this line cannot state the count.

The packet was right to author something — the contract carries no stale count, so the alternative was a fabricated number. It authored one clause too many. Proposed replacement, needing no new data:

> **Freshness is not being reported yet.**

Then the designer's existing second sentence follows unchanged. Same honesty, one clause, and it stops explaining the pipeline to a customer.

## 5 · The order to work in

1. **`AUTHORED.DRIFT_NO_COUNT` → the shorter sentence.** One string, no new data, no contract change. Ships alone.
2. **The situation headline, in `sessionRegistry.ts`.** World state first, then the ask; `runbookId` moves off the headline to the meta line. Needs a ratified sentence set from me first (§6) and the golden fixture's expected output re-ruled, since the fixture pins the current strings.
3. **The chip labels to one word.** `RETURN_COPY.PARTS_CHIP` and the status labels: *Waiting*, *Stuck*. Phrases move to the meta line as text — the system's own rule that a badge never carries a sentence, and the reason the pills read wrong at 6px padding against a 10px radius.
4. **The panel's opening state.** Renderer-only, and the highest-frequency surface in the product.
5. **Collapse the three queues into Now.** Mostly deletion: the Inbox cards already carry Approve and Not now.
6. **Merge the two permission panes, then fold Fleet into Sites** — the last against the Nexus-shell design, one row per web property with environments nested.

Items 1, 3 and 4 need nothing from the host. Item 2 needs the fixture re-ruled. Items 5 and 6 are IA and are the only ones that need a product decision.

## 6 · The sentence set, written

`handoff/from-designer/fixtures/situation-headlines.js` — five templates, each with the guard that selects it and its host fields named, plus the list verdict and the freshness replacement. Every slot is a field that already exists; nothing in the file computes anything.

Five classes rather than four: drawing them as templates surfaced one the current fleet does not contain. **`run.waiting.part-changed`** — `done > 0 || failed > 0` with a gate waiting — is tier 1 by the consequence order's own words, and no shipped row can produce it today because every waiting run has written nothing. It is the class the tier 1 / tier 2 split exists for, so it is specified now rather than discovered by an incident.

One thing in the file needs ratifying before it renders. The headlines need a **noun**, and Controlled Vocabulary v1.3 ratified capability *labels*, which name an act: "Update plugins across sites" does not nominalise into a subject. So §2 proposes a second column on the same rows — same referent, subject form, "A plugin update run" — as vocabulary rather than as prose I wrote into a template. Not to be rendered until it goes through the loop.
