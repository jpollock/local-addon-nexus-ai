# Spec 4 — Inbox: one durable queue for decisions, problems and findings

Date: 2026-08-10
Branch: `spec-4-inbox` (worktree, branched from `new-ux-v2` at `0b2bed3e`)
Predecessors: `2026-08-09-nexus-ux-foundation-design.md`, `2026-08-10-nexus-overview-decomposition-design.md`

## Why this exists

The handoff asks for "a new destination aggregating approvals, findings and failures across all
agents, with inline decide, plain-language titles, evidence behind a disclosure, and per-agent
pending counts derived from this list."

Every clause of that describes something the current code cannot do, for one reason: **there is no
record of a decision anywhere in this addon.** What looks like one is a side effect of a renderer
IPC handler.

## What the "31 pending decisions" number really is

`NexusOverview.tsx:349-380` handles `AGENT_RUN_COMPLETE` and mints exactly **one activity event per
run**, marked `status: 'review'` whenever `findingsCount > 0`:

```ts
type: 'Report', status: hasFindings ? 'review' : 'done',
text: `${agentName} sweep complete`,
```

So the banner counts **runs that found something**, not decisions. Four findings re-reported across
sixty sweeps present as sixty pending decisions. Five call sites derive that same number
independently — `AgentWorkspace.tsx` (lines 344, 442, 508), `AgentCard.tsx:54`, `AgentsHub.tsx:29` —
each with its own copy of `filter(e => e.status === 'review')`.

This also explains, without needing production data, the volume artifact measured on 2026-08-09: a
`graph.db` total of 2,419 findings across 7.1 days that resolved on inspection to the same handful
of findings re-counted across repeated failed sweeps.

## The storage problem

Neither existing store can back an Inbox:

| | `agent_runs` (SQLite, `AgentStateStore.ts:26`) | `activityEvents` (renderer `localStorage`) |
|---|---|---|
| Survives restart | yes | yes, capped at 100 (`AgentStore.ts:146`) |
| Written while the renderer is closed | yes | **no** — the producer is a renderer IPC handler |
| Individual findings | no — `findings_count INTEGER` only | yes (`findings?: Finding[]`) |
| Decision state | no | yes (`status`), run-scoped |
| Undo | no | no |

The durable store has no findings. The store with findings is renderer-scoped, capped, and only
records runs somebody was watching. An agent that finds a problem overnight with Nexus closed
leaves no trace a user can act on.

## The volume question, and why this design does not answer it

`DECISIONS.md` lists **Fleet volume** as open: *"Every number in the prototype is synthetic. The
Inbox design differs considerably at 10 findings a week versus 200; that should be measured before
it is built."*

It cannot be measured here. The only available data is one developer machine where
`security-sentinel` was misconfigured and largely erroring across two sites. Neither the raw
aggregate nor a corrected estimate from it is a sound basis for a design.

**Ruling: build so the answer does not matter.** The design is volume-agnostic by construction
(section A below), not by guessing a number. This is a decision to stop waiting on the
measurement, not a claim to have made it. If real volume data ever arrives it should be used to
tune presentation — grouping, paging, defaults — never to justify an unbounded list.

## Scope

**In:**
- A durable, main-process inbox store whose item is a **finding or failure**, not a run.
- Main-side production of inbox items on run completion.
- An Inbox destination with the prototype's three groups and inline actions.
- Per-agent pending counts derived from the inbox, replacing the five copy-pasted filters.
- `failureAggregation` wired to its first production consumer.

**Out, deliberately:**
- **Undo of a live change.** See "Two lines drawn explicitly" below.
- **Bulk actions.** Spec 5 owns selection and bulk; the Inbox acts one item at a time.
- **New execution authority.** Acting on an item routes through the existing `SentinelExecutor`
  with its `isOperationAllowed` gate intact. The Inbox surfaces decisions; it does not acquire
  permissions the addon does not already have.
- **Migrating existing `activityEvents`.** See "Two lines drawn explicitly".
- **Retiring the Activity ledger.** `FleetActivityLedger` keeps showing run history. The Inbox is
  a queue of open items, not a log; they are different surfaces and both survive this spec.

## Architecture

### A. Identity is the whole design

**An inbox item is keyed by `(source, code, scope)`** — the agent that raised it, the check code,
and the target it is about.

The key already exists in the data. `SentinelTypes.Finding.id` is a **check code** (`'FS-01'`,
`'ABS-05'`), not a per-instance identifier — two sites failing the same check produce the same
`id`, and the same site failing it on Monday and Tuesday produces the same `id` twice.

On re-report the store **updates** `lastSeenAt` and increments `seenCount`. It does not insert.

This is what makes the design volume-agnostic. Row count becomes a function of **distinct
problems**, not of sweep frequency. Ten findings a week and two thousand sweeps a week over the
same ten problems produce the same inbox. The volume question stops being load-bearing.

Two consequences to hold onto:

- **A resolved-then-recurring problem is the same item, reopened** — not a new one. `seenCount`
  and `firstSeenAt` are the honest record of a problem that keeps coming back, and that is more
  useful than a fresh row that hides the history.
- **An item dismissed by the user stays dismissed on re-report.** Re-reporting updates timestamps
  and count; it must not resurrect a decision the user already made. Otherwise every sweep
  un-dismisses everything and the Inbox becomes unusable at exactly the volume it is meant to
  survive.

### B. Production moves to the main process

`ipc-handlers.ts:5419` already holds everything needed — `findings`, `plan`, `summary`,
`findingsSites`, `siteNames`, `agentId` — immediately before it broadcasts `AGENT_RUN_COMPLETE`.
Inbox items are written there, on the same `graphService.getDb()` connection that carries
`agent_runs`, with `InboxStore` constructed beside `AgentStateStore` (`src/main/index.ts:667`).

The renderer's event-minting block in `NexusOverview.tsx` stops being the source of truth. It may
keep feeding the Activity ledger; it no longer decides what needs a decision.

Note the existing failure mode at that call site: the full-payload broadcast is wrapped in a
`try/catch` that falls back to a minimal payload when `findings`/`plan` fail to serialize. The
inbox write must happen **before** the broadcast and must not be inside that same try — a payload
too large to send to the renderer is still a finding worth recording.

### C. Three groups, from the prototype

| Group | Prototype `kind` | Source in this spec | Populated on day one? |
|---|---|---|---|
| Needs a decision | `decide` | Findings awaiting approval, one item per distinct finding | yes |
| Something is stuck | `problem` | `aggregateFailures` output — agent failures only | yes |
| Worth knowing | `know` | Nothing yet | **no** |

Two of those need saying plainly, because both look like bugs otherwise.

**"Worth knowing" will be empty.** `FindingSev` is `'critical' | 'high' | 'medium'`
(`SentinelTypes.ts:1`) — there is no informational severity, so no current producer can raise a
`know` item. The prototype's examples for the group ("traffic down 13%", "6 broken links appeared
this week") come from a Web Analytics agent and a Site Health agent that do not exist. The group is
still built, because the prototype already hides empty groups
(`.filter(g => g.items.length > 0)`) — so an empty one is invisible, and the slot is ready when
such an agent lands. Do not invent a producer to fill it.

**"Something is stuck" covers agent failures, not fleet blockers.** The prototype also shows
"Meridian has been stopped for 6 days" and "44 WP Engine sites haven't been looked inside" in this
group. Those are real and worth having, but each needs its own producer and its own staleness
policy, which would roughly double this spec. Agent failures only, here.

Each item carries `title`, `detail`, `scope`, `source`, `when`, a primary/secondary/skip action
triple, and optional `evidence` behind a disclosure — the prototype's shape, which is already
plain-language and already aggregated (`"A security sweep has failed 5 times since 3:17 PM"`).

**`scope` is a string on every item, never a bare number.** This is the foundation spec's first
non-negotiable, and the Inbox is its second render site after the panel's Insights tab.

### D. "Something is stuck" is `failureAggregation`'s first consumer

`src/main/agents/failureAggregation.ts` has **zero production callers** today — it is exercised
only by `tests/unit/agents/failure-aggregation.test.ts`. The prototype's own mock item for this
group is precisely its output:

> "A security sweep has failed 5 times since 3:17 PM … It has been paused."
> Evidence: "Last 5 runs · 15:17, 15:50, 16:02, 17:45, 18:00"

That is `AggregatedFailure`'s `count`, `firstAt`, `lastAt`, plus `shouldAutoPause`. Wiring the
module is the group.

(`collectSystemHealth` is **already** wired — `ipc-handlers.ts:1854` feeds the header health pill.
It is not part of this spec's wiring work.)

### E. Per-agent counts derive from the inbox

The five independent `status === 'review'` filters collapse onto one derivation over inbox items.
This is the same move `FleetCounts` made for site counts in the foundation spec, in a different
domain: one definition, one place, every consumer reading it.

`AgentsHub.renderInbox()` — the banner that started this — becomes a summary of the real queue with
a link to it, rather than a count of runs.

## Two lines drawn explicitly

**Undo means reopening the decision, not reversing the change.** The handoff says "inline
decide/undo". Undoing a decision the user just made in the Inbox is cheap and in scope. Undoing a
change that has already gone live is the **staging and revert** problem `DECISIONS.md` names as
*"the important one"* and the stated precondition for letting non-developers act on a client's
site — deliberately undesigned, and out of scope here. Any copy in this spec must promise only what
it can do: an item can be reopened; a shipped change cannot be un-shipped from this surface.

**Existing `activityEvents` do not migrate.** They are run-shaped, capped at 100, and lossy by
construction — there is no faithful conversion into finding-shaped items, and inventing one would
seed the new durable store with fabricated identities. The Inbox starts empty and fills from new
runs. `FleetActivityLedger` continues to show the history it already shows, so nothing a user can
currently see disappears.

## Testing

The properties worth pinning are all in the store, and they are properties no snapshot can see:

1. **Re-report updates, never inserts.** The same `(source, code, scope)` reported twice yields one
   row with `seenCount: 2`. This is the design's load-bearing claim.
2. **Dismissal survives re-report.** A dismissed item re-reported stays dismissed. Directly
   protects the failure mode that would make the Inbox useless at volume.
3. **Distinct scopes are distinct items.** The same check code on two sites is two rows — the
   inverse of property 1, and the way an over-eager dedup key would be caught.
4. **Items are written with the renderer closed.** The main-side write does not depend on a
   listener.
5. **The write survives a broadcast failure.** Inbox write precedes the broadcast and is outside
   its try/catch, per section B.

Renderer coverage uses `serializeTree` (`tests/unit/renderer/helpers/serializeTree.ts`, inherited
from spec 2.5) for the three groups, empty state, and the evidence disclosure.

**What no test covers:** whether the plain-language titles actually read as plain language, and
whether three groups is the right grouping at real volume. Both need eyes, and the second needs
production data this spec has already declined to guess at.

## Global constraints

- React 16, `React.createElement`, class components, inline style objects — no JSX, no hooks.
- No hardcoded colours; `--nxai-*` theme variables only, working in light and dark.
- Every population rendered carries its `scope` string, never a bare number.
- The Inbox acquires no permission the addon does not already have; execution stays behind
  `SentinelExecutor`'s `isOperationAllowed` gate.
- No unbounded list renders, at any volume.
- Copy may not promise reversal of a live change.

## Build order

| Step | Delivers | Verified by |
|---|---|---|
| 1 | `InboxStore` — schema, identity, upsert-on-re-report, dismissal persistence | store properties 1–3 |
| 2 | Main-side production at `ipc-handlers.ts:5419`, `InboxStore` wired in `index.ts` | properties 4–5 |
| 3 | `aggregateFailures` wired into the "stuck" group | its first production caller |
| 4 | Inbox UI — three groups, actions, evidence disclosure, empty state | `serializeTree` snapshots |
| 5 | Per-agent counts derive from the inbox; five filters collapse to one | existing agent tests stay green |

## Notes for whoever picks this up

- `NexusOverview.tsx`'s `fetchAll` uses a **positional** `Promise.all` destructuring. Specs 4 and 5
  both touch it; a careless merge silently misaligns every variable after the insertion point.
- `AgentStore.Finding` is `{ [key: string]: any }` — untyped. `SentinelTypes.Finding` is the real
  shape and the one carrying the check code that section A depends on.
- The dedup key's `scope` component must be a stable target identifier, not a display string. Site
  names collide across sources (`goldenecomm`, `jpp0413p`, `myloop`, `psbtest2`, `testjppstg` each
  exist as both a WPE install and a Local site — see CLAUDE.md), so a name-keyed scope would merge
  two different sites' findings into one item.
