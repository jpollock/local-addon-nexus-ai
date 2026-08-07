# Handoff: Agent Site Scope Picker (v2)

## Overview
A reusable **site scope picker** for Nexus agents. Every agent needs to answer two questions:
*which sites do I run on when my schedule or an event fires?* and *which sites do I run on
right now?* Today each agent screen answers these differently. This design defines one
component that answers both.

**This supersedes v1 of this document.** v1 specced a filter-heavy list with an environment
filter, a bulk-action bar, and a numeric selection rail. It was rejected in review as too
complicated: nine filter chips across two rows (with "Local" appearing in both rows meaning
two different things), site IDs wrapping rows to double height, and a rail that consumed a
third of the width to show a number. See **What changed from v1** below.

The design covers three things:
1. **The picker** — one component, used everywhere sites are chosen.
2. **Settings** — a persistent scope, collapsed to a sentence, edited in place.
3. **Run now** — the same picker, prefilled from the settings scope.

### Product decisions this design encodes
Settled before design; do not re-litigate during implementation:

- **A scope is an explicit list of site IDs.** Never a live rule. A site added to the account
  is never auto-included in a running agent's scope.
- **"Every site" mode is removed.** The shipped settings card offers "Only selected sites /
  Every site". "Every site" is a live rule and contradicts the decision above. The
  replacement is selecting everything, which then displays honestly as "384 sites, 232 of
  them in production".
- **Environment is information, not a filter.** It is shown as a badge on each row and as a
  grouping in the basket. You cannot filter by it.
- **Platform is the only filter, with three values:** WP Engine, Local, External.
- **Saved scopes are per-agent**, not shared across agents (v1 of the feature).
- **Run now uses the same picker as settings**, prefilled from the schedule scope.
- **Production access is a per-agent policy**, not a run-time checkbox.

## About the Design Files
The files here are **design references created in HTML** — interactive prototypes showing
intended look and behavior. They are **not production code to copy**. Recreate them in the
target codebase's existing framework, component library, and styling approach.

Open `Site Picker v2.dc.html` and go to sections **3a** and **3b** — those are the design to
build. Sections 1a–1c and 2a–2b are the rejected alternatives, kept for context on why 3a/3b
looks the way it does. The prototype generates 384 fake sites client-side.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and interaction behavior are final. Where the
target codebase already has an equivalent primitive (checkbox row, chip, modal), prefer the
codebase primitive and match these values through it.

---

## The Picker Component ("the basket")

Two panels side by side. Left: everything you could pick. Right: what you have picked,
grouped by environment and readable as a list of names.

**Shell:** `border 1px solid #232c38`, `radius 12px`, `background #111621`,
`overflow hidden`, height `400px` in both placements.

### Left panel — browse
`flex 1 1 0`, `min-width 0`, `border-right 1px solid #1c232e`.

**Search + filter header** (`padding 13px 15px 11px`, `border-bottom 1px solid #1c232e`):
- Search input: full width, `background #0b0e14`, `border 1px solid #2a3441`,
  `radius 9px`, `padding 9px 13px`, `14px` `#f2f5f8`, placeholder "Search sites…" in
  `#5c6675`. Matches site name; also matches site ID (see **Site IDs** below).
- Platform tabs, `gap 6px`, `margin-top 10px`: **All 384 · WP Engine 300 · Local 35 ·
  External 49**. Single-select. Counts are part of the label. Active = `#0b0e14` on
  `#35e0c5`, `border #35e0c5`; inactive = `#9aa4b2`, transparent,
  `border 1px solid #2a3441`. `12px / 600`, `padding 5px 10px`, `radius 7px`.

**Row list** (`flex 1 1 auto`, `overflow-y auto`). Each row `padding 8px 15px`,
`gap 10px`, `border-bottom 1px solid #161d27`, whole row clickable, single line:
- Add box: `16x16`, `radius 5px`, `border 1.5px solid`. Not in scope = `+` glyph,
  `#6b7684`, border `#3a4553`. In scope = `✓`, `#35e0c5`, border `#35e0c5`.
- Name `14px / 600` `#e6ebf1`, ellipsised.
- Platform `11px` `#6b7684`.
- Environment badge `10px / 800`, `letter-spacing 0.04em`, `padding 2px 6px`,
  `radius 4px`: PROD `#ff8a95` on `rgba(255,107,122,0.14)`; STAGING `#f0b52e` on
  `rgba(240,181,46,0.13)`; DEV `#7cb6ff` on `rgba(124,182,255,0.13)`; LOCAL `#b79bff`
  on `rgba(183,155,255,0.13)`.
- **Rows already in scope render at `opacity 0.4`** — they stay in place rather than
  disappearing, so the list does not reflow as you pick.
- Tail line `12px` `#5c6675`: "Showing 60 of {n} — keep typing to narrow." or
  "End of results."

**Site IDs are not shown on the row.** In v1 they wrapped to a second line and doubled row
height for information nobody reads. Show the ID on hover (title attribute or a hover-revealed
line), and inline in the row when the user's query matched the ID rather than the name.

### Right panel — the basket
`flex 0 0 276px`, `background #0e131c`.

**Header** (`padding 13px 15px 11px`, `border-bottom 1px solid #1c232e`):
- "In scope **{n}**" `14px / 700`, count in `#35e0c5`. "Clear" `12px` `#7b8593` right.
- Quick-add chips, `gap 6px`, `margin-top 10px`: **+ All WP Engine · + All non-prod ·
  + Everything**. `12px / 600`, `padding 5px 9px`, `radius 7px`, `#9aa4b2`,
  `border 1px dashed #35404f`. Additive — they add to the current basket, never replace it.

**Contents** (`flex 1 1 auto`, `overflow-y auto`), grouped by environment in the order
production, staging, development, local. Groups with zero members are omitted.
- Group header `padding 8px 15px`, `border-bottom 1px solid #161d27`: `6px` dot in the
  env dot color (`#ff6b7a` / `#f0b52e` / `#7cb6ff` / `#b79bff`), uppercase label
  `12px / 800` `letter-spacing 0.04em`, count `12px / 700`, and a `×` (`14px`
  `#59626f`) removing the whole group.
- **Production group header is red**: `background rgba(255,107,122,0.1)`, label and count
  `#ff8a95`. Every other group header is transparent with `#8a94a2` text.
- Item rows `padding 5px 15px 5px 29px`: name `13px` `#cdd5df` ellipsised, `×`
  `14px` `#59626f`.
- Max 5 items shown per group, then "+ N more" `11px` `#5c6675`.
- Empty: "Nothing selected yet. Add sites from the left, or use a shortcut above."
  `12px` `#5c6675`, `line-height 1.5`.

**The basket is the source of truth.** It shows names, not a number, so "did I mean to
include those" is answerable without leaving the screen.

---

## Production warning — the escalation

Production is never blocked and never hidden (unless agent policy locks it, see below). It is
made progressively harder to miss as it becomes more consequential:

1. **Row badge** — PROD in red on every production row in the left list.
2. **Basket group header** — a red "PRODUCTION" band with a count, pinned to the top of the
   basket by group ordering.
3. **Footer note** — the container's footer turns `background rgba(255,107,122,0.07)`,
   `border-top rgba(255,107,122,0.24)`, with a `13px / 600` `#ff8a95` sentence.
4. **Primary button** — fill changes from `#35e0c5` to `#ff8a95`. Text stays `#0b0e14`.

Nothing blocks the user. They would have to ignore four escalating signals.

### The warning sentence must come from the agent
**This is a required behavior, not copy.** The footer sentence states what the agent will do
to those sites, and that differs per agent:

- Read-only agent (`security-sentinel` — investigates, surfaces findings, takes no action):
  "3 live production sites will be scanned."
- Acting agent (a remediation agent that writes): "3 live production sites will be modified."

An earlier draft hardcoded "this agent will write to live sites" for all agents, which was
false for security-sentinel — a warning that misstates the risk is worse than no warning.
Derive the verb from the agent's declared capability. See `SDK_requirements.md` §3.

---

## Screens

### 1. Settings — persistent scope (prototype section 3a)
**Purpose:** view and edit the scope used by scheduled runs and event triggers.

Card: `background #111621`, `border 1px solid #1f2732`, `radius 16px`,
`padding 20px 22px`. Sections separated by `border-top 1px solid #1c232e`, `16px` above
and below.

1. **Card title** "How this agent runs" `16px / 700`.
2. **Schedule row** — toggle (`40x22`, `radius 999px`, on `#22c088`, knob `16x16`
   white at `3px` inset) + "On a schedule" `15px / 600`; cadence pill "Hourly"
   `13px / 600`, `padding 6px 12px`, `radius 8px`, `border 1px solid #2a3441`,
   `#cdd5df`, right-aligned.
3. **Scope block**:
   - Eyebrow "SITES IN SCOPE" `12px / 700`, `0.06em`, uppercase, `#6b7684`.
   - **Scope sentence** `16px`, `line-height 1.5`. Four forms:
     - none: "No sites selected — this agent will not run."
     - no production: "{n} sites — no production" (`#e6ebf1`)
     - all sites: "Every site on the account, including {p} in production" (`#ff8a95`)
     - mixed: "{n} sites, {p} of them in production" (`#ff8a95`)
   - Subline `13px` `#6b7684`: "Last edited 4 days ago · shared by the schedule and event
     triggers".
   - Toggle button right: closed "Edit sites" (`#0b0e14` on `#35e0c5`), open "Close list"
     (`#9aa4b2`, transparent, `border 1px solid #2a3441`). `14px / 700`,
     `padding 9px 16px`, `radius 9px`.
   - **Picker opens inline**, never in a modal — the scope only makes sense next to the
     trigger that consumes it, and a modal implies a one-off choice, which is what Run now is.
   - Below the picker: warning sentence left (`13px / 600` `#ff8a95`, e.g. "3 live
     production sites will be scanned every hour." — note the cadence, this scope repeats),
     "Cancel" ghost + "Save {n} sites" right.
4. **Events row** — toggle (off), "Respond to events" `15px / 600` `#aeb7c4`, then
   "— uses the same scope" `13px` `#6b7684`. One scope serves both triggers.

**Drift banner** (carried over from v1, still required): `background rgba(240,181,46,0.08)`,
`border 1px solid rgba(240,181,46,0.28)`, `radius 11px`, `padding 12px 16px`. Copy:
"**{n} sites** were added to the account after this scope was set. They are not being
scanned." Actions "Review {n}" (`#0b0e14` on `#f0b52e`) and "Dismiss" (`13px / 600`
`#9aa4b2`).

### 2. Run now (prototype section 3b)
Modal: `background #0f141d`, `border 1px solid #232c38`, `radius 18px`,
`box-shadow 0 24px 60px rgba(0,0,0,0.5)`.

- **Header** (`padding 20px 22px 16px`): `36x36` icon tile,
  `background rgba(53,224,197,0.12)`, `radius 10px`, glyph `#35e0c5`. Title
  "Run security-sentinel now" `19px / 800`. Subtitle `14px` `#8a94a2` "Runs once,
  immediately. Does not change the schedule." Close × `19px` `#6b7684`.
- **Prefill banner**: `background rgba(53,224,197,0.07)`,
  `border 1px solid rgba(53,224,197,0.24)`, `radius 10px`, `padding 11px 14px`,
  `13px` `#cdd5df`. Two states:
  - unmodified: "Prefilled from this agent's schedule scope ({n} sites)."
  - modified: "Changed for this run only — {added} added, {removed} removed vs. the schedule
    scope."
  Trailing ghost "Reset to schedule scope" restores the prefill exactly.
- **Picker** — identical component. Quick-add chips are present; saved-scope chips are not
  (saving a scope is a settings action).
- **Footer** (`padding 14px 22px`): note left — with production, the agent-derived warning
  sentence in `#ff8a95`; without, "Same sites the hourly schedule uses." or "Applies to this
  run only. Save it to the schedule from Settings." `13px`. Buttons right: "Cancel" ghost,
  "Run on {n} sites".

### 3. Agent policy — production locked
For an agent whose manifest declares `allowsProduction: false` (e.g. log-processor):

- Explanatory banner above the picker: `background rgba(255,107,122,0.07)`,
  `border 1px solid rgba(255,107,122,0.26)`, `radius 11px`, `#f0c6ca` `14px`:
  "{p} production sites cannot be selected by this agent."
- Production rows in the left list: `opacity 0.45`, name `#6b7684`,
  `cursor not-allowed`, add box shows `—`, click is a no-op.
- Quick-add chips exclude locked sites; "+ Everything" adds everything selectable, and its
  count reflects that.
- No production group can appear in the basket, so no red escalation ever fires.

**Rationale to preserve:** the shipped design puts an "Include production sites — use with
care" checkbox in the run modal. That places the safety decision at the riskiest moment, made
by whoever happens to be running the agent. As an agent property it becomes a one-time review
by whoever installs the agent, enforced identically in UI, CLI, and MCP.

---

## Interactions & Behavior

**Filtering never changes the basket.** Platform tabs and search narrow the left list only.
Switching tabs, searching, and clearing never adds to or removes from the basket. This was the
biggest failure mode of the shipped UI and the reason the basket is a separate panel.

**Adding and removing.**
- Click a left row to add; click it again (or its `×` in the basket) to remove.
- Quick-add chips are **additive** — "+ All WP Engine" adds them to whatever is already there.
- A group header `×` removes every site of that environment.
- "Clear" empties the basket.

**Zero-selection state.** The primary button ("Save 0 sites" / "Run on 0 sites") renders
disabled: `background #1c232e`, `color #59626f`, `cursor default`. Do not render it in
the accent fill — a dev copying an enabled-looking zero-state button is a real regression.

**Drift detection (settings only).** Compare `site.createdAt` against `scope.updatedAt`.
Sites created after the scope was last edited are drift. "Review {n}" opens the picker filtered
to those sites; "Dismiss" hides the banner (persist per-user-per-scope so it does not nag).
Because scopes are explicit lists, drift is a permanent property of the model — this banner is
how the model stays honest rather than silently under-scanning.

**Run now prefill.** Opening the modal copies the schedule scope into a run-local basket.
Divergence is computed live as added/removed counts and shown in the banner. "Reset to schedule
scope" restores the copy. Editing here never writes to the saved scope.

**Policy enforcement.** `allowsProduction: false` must be enforced server-side for CLI and MCP
invocations. The UI lock is a courtesy, not the boundary.

**Hover.** Left rows lift to `rgba(255,255,255,0.03)` when interactive; locked rows show no
hover response. Chips and buttons brighten one step. Transitions `120ms ease`.

**Empty and loading** (not drawn — implement per codebase conventions):
- No matches: "No sites match" in the list body plus a "Clear filters" action.
- Loading: skeleton rows at `~37px`, basket count showing a dash.

---

## State Management

Per picker instance:
- `selection: Set<siteId>` — the explicit list. The only persisted output.
- `query: string` — debounced ~200ms.
- `platformFilter: 'all' | 'WP Engine' | 'Local' | 'External'`

The platform filter is **view state** and must not be persisted with the scope. Persisting a
filter would recreate rule-based scoping through the back door.

Per screen:
- Settings: `scheduleSelection` (saved), `editorOpen`, `driftDismissed`.
- Run now: `runSelection` initialised from `scheduleSelection`; delta derived, never stored.

Derived, never stored: visible rows, basket grouping, counts, production count, run delta,
scope sentence, warning sentence, button colors.

---

## Scale & performance
The prototype holds all 384 sites in memory and slices the first 60 matches. Current
implementation does the same and that is acceptable at today's fleet size — see
`SDK_requirements.md` §5 for the agreed trigger for moving server-side. When that happens:
- Page or virtualise the left list.
- Run search and platform filtering server-side.
- Make quick-add a **server-side operation** returning site IDs for the filter, not a client
  loop over loaded rows.
- Fetch basket group counts as aggregates.
- Treat `site.environment` as authoritative and cache it carefully — it is a safety boundary,
  not a label.

---

## What changed from v1
| v1 | v2 | Why |
|---|---|---|
| Environment filter chips (5) | Environment shown as badge + basket grouping | It was navigation for something users need to *see*, not filter by |
| Platform chips: Any / WP Engine / Local | Platform tabs: All / WP Engine / Local / External | External is a real platform; "Local" appeared in both rows meaning two different things |
| Two filter rows, 9 chips | One row, 4 tabs | Density |
| Site ID on a second line of every row | ID on hover, and inline only when the query matched it | Doubled row height for unread information |
| "Select all N matching" bulk bar | Three quick-add chips in the basket header | Folded into the panel it affects |
| Numeric selection rail (236px) | Readable basket (276px) | A count cannot answer "did I mean to include those" |
| Production = a checkbox to include | Production = four escalating signals | Warn, don't gate |
| "Every site" mode | Removed | It is a live rule; the scope model is explicit lists |

---

## Design Tokens

**Colors**
| Token | Hex | Use |
|---|---|---|
| Page background | `#0b0e14` | canvas, input fill |
| Surface | `#111621` | cards, picker shell |
| Surface raised | `#0f141d` | modal body |
| Surface sunken | `#0e131c` | basket panel, tab bars |
| Header / footer | `#0d1119` | footers |
| Border strong | `#232c38` | picker + modal border |
| Border | `#1f2732` | card border |
| Border subtle | `#1c232e` | section dividers |
| Border faint | `#161d27` | row dividers |
| Control border | `#2a3441` | inputs, ghost buttons, inactive tabs |
| Dashed chip border | `#35404f` | quick-add chips |
| Add box border | `#3a4553` | unselected row |
| Text primary | `#f2f5f8` | body |
| Text strong | `#e6ebf1` | headings, site names |
| Text secondary | `#cdd5df` | basket item names, banner copy |
| Text muted | `#aeb7c4` | secondary labels |
| Text dim | `#9aa4b2` | descriptions, ghost buttons |
| Text dimmer | `#7b8593` | footnotes |
| Text faint | `#6b7684` | eyebrows, platform, group labels |
| Text faintest | `#5c6675` | placeholders, tail lines |
| Disabled fill | `#1c232e` | zero-state primary button |
| Disabled text | `#59626f` | zero-state button, `×` glyphs |
| Accent | `#35e0c5` | primary actions, counts, active tabs |
| Accent hover | `#5eeadb` | link hover |
| Accent tint | `rgba(53,224,197,0.07)` | prefill banner |
| Success | `#22c088` | toggle on |
| Warning | `#f0b52e` | drift banner, staging |
| Danger | `#ff6b7a` / `#ff8a95` | production dot / text + fill |
| Danger tint | `rgba(255,107,122,0.07)` – `0.14` | prod footer, group header, badge |
| Info | `#7cb6ff` | development |
| Violet | `#b79bff` | local |

**Typography** — Figtree (400/500/600/700/800); JetBrains Mono (400/500) for site IDs and API
field names. Google Fonts.

Scale: `19px/800` modal title · `16px/700` card title · `16px/400` scope sentence ·
`15px/600` toggle label · `14px/700` primary buttons, "In scope" · `14px/600` site name ·
`14px/400` body · `13px/600` warning sentence, ghost buttons · `13px/400` basket items,
banners · `12px/800` basket group labels (`0.04em`) · `12px/700` eyebrows (`0.06em`,
uppercase) · `12px/600` tabs, quick-add chips · `12px/400` footnotes · `11px/400`
platform, "+N more" · `10px/800` env badges (`0.04em`).

**Spacing** — 2 / 3 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 13 / 14 / 15 / 16 / 20 / 22 px.

**Radii** — `4px` env badge · `5px` add box · `7px` chips, tabs · `8px` small buttons ·
`9px` input, primary buttons · `10px` icon tile, prefill banner · `11px` drift/policy
banners · `12px` picker shell · `16px` settings card · `18px` modal · `999px` toggles.

**Shadow** — modal only: `0 24px 60px rgba(0,0,0,0.5)`.

**Layout** — picker height `400px`; basket panel fixed `276px`.

**Scrollbars** — `9px`, thumb `#2a323e`, `radius 6px`.

---

## Assets
None. The two glyphs used (`▶` in the Run now header, `×` for close/remove) are text
characters — substitute the codebase's icon set.

## Files
| File | What it is |
|---|---|
| `Site Picker v2.dc.html` | Seven interactive options. **Build 3a and 3b.** 1a–1c and 2a–2b are rejected alternatives kept for context. |
| `Basket.dc.html` | The picker component, imported by 3a and 3b. |
| `support.js` | Runtime for the prototypes. Not part of the design; required for them to open. |

## Out of scope / open questions
- **Saved scopes** — the data model exists and chips render, but naming, editing, and deleting
  a saved scope needs its own design pass. v2 shows quick-add chips instead.
- **"Always do full run"** — present in the shipped Run now modal, absent from every design
  here. Nobody has documented what it does. Clarify before building the modal.
- **Bulk-actions menu** — named as a third placement for the picker, not drawn.
- **Cross-agent saved scopes** — considered and deferred; do not build for them.
