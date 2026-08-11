# Handoff: Nexus AI — structural UX rework

## Overview

Nexus AI has grown into six top-level tabs, four separate chat entry points, two settings homes,
and a per-site section. A review of the current build (included: `Nexus UX Review.dc.html`)
found that the UI is organised around the addon's subsystems — indexers, sync jobs, credential
stores, an MCP server — rather than around the two things a user actually does: **ask about the
fleet**, and **decide on what the agents found**.

This package contains a working prototype of the reworked structure (`Nexus Redesign v1.dc.html`)
and the review that produced it. Together they cover:

- **Inbox** — one place for every decision, finding and failure, in plain language
- **Ask** — a single chat surface at three sizes (docked / wide / full)
- **Sites** — one table for the whole fleet, including a new **External** host type
- **Agents** — today's agents view, rewritten so a non-developer can read it
- **Settings** — one settings home replacing the current two
- **First run** — connecting accounts and reaching a first useful answer
- **The panel outside Nexus** — the same panel on a plain Local screen

## About the design files

The files in this bundle are **design references written in HTML**. They are prototypes showing
intended layout, copy and behaviour. They are **not** production code and should not be copied in.

The target environment already exists: this addon's renderer is **React 16 with TypeScript**,
using `React.createElement` (no JSX) and inline style objects — see
`src/renderer/components/NexusOverview.tsx` for the established pattern. Recreate these designs
there, using the addon's existing components, IPC channels and theme variables.

The prototype uses **Nunito Sans** as a stand-in for Local's UI font. Do not import it — use
Local's own font stack.

## Fidelity

**High fidelity.** Colours, type sizes, spacing and copy are all final and grounded in the repo's
own tokens (`src/renderer/utils/theme.ts`, `src/common/constants.ts`). Recreate closely. The one
deliberate deviation from the current palette is documented under Design tokens.

---

## Non-negotiables

These four came out of the review and are the reason the work is worth doing. If a build decision
conflicts with one of them, the build decision is wrong.

### 1. Every count has exactly one source

The current UI reports the same fleet as 367, 370, 333, 330, 29 and 19 across four screens. A user
cannot tell which is true, which makes every other number on the page suspect.

Compute fleet figures **once**, in one module, and have every label read from it — the header, the
filter tabs, the panel, the first-run summary, the settings costs. Never restate a number in a
string literal. In the prototype this is the `counts()` method, and every derived label
(`"Needs attention 23"`, `"4 of 6 on"`, `"1,902 connections a day"`) reads from it.

This is the single most-violated rule in the prototype's own history — it recurred four times
during the build, each time by typing a number instead of asking for it. Treat it as an
architectural constraint, not a code-review convention.

### 2. Health must be honest

Today the Activity tab shows "All Systems Healthy" while security-sentinel fails every twenty
minutes and 31 actions await review. Health must roll up agent run status, stale syncs and
credential failures, and must report **unknown** rather than green when an input is missing.
A health indicator that can be confidently wrong is worse than none.

### 3. Anything that changes a site is staged and shown first

Every write surface in the prototype states this. It is not yet designed (see Open questions) but
it is the precondition for letting non-developers act. The mechanism the team already uses —
pulling a WP Engine site down and working on the local copy — is the right foundation.

### 4. Plain language, no second mode

Everything requiring a mental model of SSH, CLI, indexes, embeddings or ports either gets
translated into a consequence a non-developer can act on, or moves to Settings → Advanced.
Not a "developer mode" toggle — one surface. Test: could a web PM explain, in one sentence, what
this screen is telling them and what to do about it?

---

## Screens

Shared chrome for all Nexus screens: a **header row** (`padding: 14px 24px`, white) containing the
title, the health pill and the fleet summary; below it a **tab bar** (`padding: 0 24px`, white,
`border-bottom: 1px solid #e5e7eb`) with tabs Inbox · Ask · Sites · Agents · Settings. Active tab:
`color #111827`, `border-bottom: 3px solid #0ECAD4`. Inactive: `#9ca3af`, transparent border.
Tabs are `padding: 12px 14px; font-size: 14px; font-weight: 700`.

Content area scrolls; the panel is a fixed-width sibling on the right.

### 1. Inbox (default landing when anything is waiting)

**Purpose:** the complete list of what needs a human, across the whole fleet.

**Layout:** `padding: 24px 28px 60px`, single column, `gap: 18px`. Header row with the count as an
H1-equivalent (`24px/800`, `letter-spacing: -0.015em`) plus a subtitle at `14px #6b7280`, and a
right-aligned segmented filter (Everything · Needs a decision · Problems).

**Groups:** three, in this order — **Needs a decision** (accent `#0ECAD4`), **Something is stuck**
(`#f59e0b`), **Worth knowing** (`#9ca3af`). Each group header is `12px/800`, uppercase,
`letter-spacing: 0.09em`, `#374151`, followed by a 1px rule and an item count.

**Item card:** `border: 1px solid #e5e7eb`, `border-left: 3px solid <group accent>`,
`border-radius: 10px`, `padding: 16px 18px`, `display: flex; gap: 14px`.
- Icon square 26×26, `border-radius: 7px`, group tint background
- Middle column `flex: 1; min-width: 240px` — title `15px/700`, detail `14px/1.5 #4b5563`, then a
  meta row `12.5px #9ca3af` of scope · source · time
- Optional evidence block: `background #f3f4f6`, `border-radius: 7px`, IBM Plex Mono `12.5px`,
  `white-space: pre-wrap` — this is where raw detail goes, never in the title
- Action column, fixed `width: 172px`: primary button (filled, group colour), secondary (outline),
  and a quiet tertiary "skip" link at `13px #9ca3af`

**Copy rules.** Titles say what happened in the user's terms: *"A security sweep has failed 5 times
since 3:17 PM"*, not `(s.evidence || []).map is not a function`. Repeated failures aggregate into
one row with a count and a time range. Cause goes in the detail line in plain words
(*"The workflow reported its findings in a format Nexus couldn't read"*); the stack detail goes in
the evidence block.

**Behaviour:** any of the three actions resolves the item, removes it from the list, decrements
every count, and shows a dark undo bar (`background #111827`, `border-radius: 9px`) with an Undo
affordance at `#4fd8e2`. Empty state is a dashed box: *"Nothing needs you right now."*

### 2. Ask

**Purpose:** the single chat surface. Same conversation as the panel — one history.

**Empty state:** centred column, `max-width: 720px`. Heading *"What do you want to know?"* at
`34px/800`, `letter-spacing: -0.025em`; a subline naming the fleet; a large composer
(`padding: 15px 17px`, `border-radius: 11px`, 50×50 send button); suggestion pills
(`border-radius: 20px`, `padding: 10px 15px`) grounded in the user's own fleet; and a closing line:
*"Nothing on a site changes until you approve it."*

**With turns:** message list, user bubbles right-aligned on `#e0f2fe`, assistant left on `#f3f4f6`,
both `border-radius: 13px`, `15px/1.55`. Composer becomes sticky at the bottom.

**Answers render as UI, not prose.** An answer that names sites returns a bordered table of rows
(name + meta), a filled primary action (*"Stage an upgrade on all 5"*), and the line
*"Staged first — nothing goes live until you say so"*. Attribution goes underneath at `12.5px`
(*"Answered in 2.1s · Fleet"*).

**No agent picker.** The composer does not ask the user to choose Content / SEO / Site health.
Route automatically and name the specialist after the fact.

### 3. Sites

**Purpose:** one table for the entire fleet; operations act on a selection.

**Filters** (segmented, left-aligned): Needs attention · All · On this Mac · WP Engine · External.
Every label carries its count and every count is derived. Default filter is **Needs attention** —
never render 367 rows by default.

**Search** field top-right, `width: 240px`, placeholder derived (*"Search 367 sites"*).

**Table:** `border: 1px solid #e5e7eb`, `border-radius: 10px`. Header row `background #f9fafb`,
`12px/800` uppercase `#6b7280`. Columns:
| Column | Width | Notes |
|---|---|---|
| checkbox | 18px | `border-radius: 5px`; checked = `#0a8189` fill, white ✓ |
| Site | `flex: 1; min-width: 150px` | `14px/700`, ellipsis |
| Where | 140px | `This Mac` / `WP Engine` / `External · <host>` |
| What we know | 116px | dot + label |
| Last looked | 92px | `#9ca3af` |
| Waiting | 84px | count pill on `#fffbeb`/`#b45309`, or an em dash |

**The knowledge ladder replaces six vocabularies.** Today the same idea is expressed as
Scanned/Configured/Searchable, indexed/metadata/filesystem, fresh/stale, synced/needs-SSH-sync, a
three-dot meter and a percentage bar. Collapse all of it to **Basic → Detailed → Searchable**
(dots `#d97706` / `#8b5cf6` / `#0ECAD4`), with freshness as a separate timestamp column. Use the
same three words in the table, the fleet summary and the agent scope picker.

**Selection** reveals a teal action bar (`background #0a8189`, white text) with bulk actions and a
Clear. Pager sits in the table footer, 12 rows per page in the prototype.

### 4. Agents

**Purpose:** the current agents view, rewritten. Same five agents, same concepts (schedule,
autonomy, scope) — the change is that the card answers *what does this do* and *does it need me*.

**Paused banner** at top when any agent is paused: `background #fffbeb`, `border #fde68a`, with the
reason in plain words and a link into the Inbox.

**Card grid:** `repeat(auto-fill, minmax(340px, 1fr))`, `gap: 14px`. Card is
`border-radius: 11px`, `padding: 16px 18px`. Avatar 34×34 tinted by state. Title `16px/800` plus a
status pill (On `#f0fdf4`/`#3d9c52`, Paused `#fffbeb`/`#b45309`, Off `#f3f4f6`/`#6b7280`).
One sentence of what it does at `13.5px/1.5`.

Then a four-row detail block above a divider: **Runs** (*Every 6 hours*), **On its own?**
(*Asks first* / *Fixes small things itself* / *Runs on its own* — replacing the autonomy radio
group), **Covers** (*2 sites*), **Last run**. Footer: primary button, Settings, and the agent's
pending count linking to the Inbox.

Per-agent pending counts are **derived by counting inbox items by source** — they are not
independent numbers.

### 5. Settings — one home

Two-column: a 232px section list (`border-right: 1px solid #e5e7eb`) and content. Active section
gets `border-left: 3px solid #0ECAD4`, `background #f3f4f6`. Each nav item carries a derived note
(*"4 of 6 on"*, *"5 of 6 on"*, *"production safe"*). Footer line names the one exception rather than
overclaiming: *"Everything Nexus can be configured with is here, with one exception: approving a new
host the first time you connect to it stays in Local → Preferences → Nexus AI, because that approval
must not be reachable from anything but Local itself."*

**A rump native panel is expected and correct.** Trust-on-first-use host-key approval is
deliberately IPC-only and must not be reachable over GraphQL — that is a security boundary, not
leftover duplication, so it should be stated in the UI rather than quietly preserved. The acceptance
test becomes *one settings home plus one named, justified exception*, which still retires the
current overlap (six sections duplicated across two homes, Access & Permissions in both).

This replaces **both** current homes — Preferences → Nexus AI and the dashboard Settings tab. All
six current sections are covered.

**Connections** — grouped by what each thing gets you, not by what it is:
- *Where your sites are*: WP Engine, Other hosts
- *How Nexus answers you*: the provider, with the Local AI Gateway **nested underneath it** as a
  toggle (`margin-left: 28px`, `background #f9fafb`) reading *"Let WordPress sites use it too"*
- *What else Nexus can do*: capability rows named for the capability — **Traffic and search data**
  (Google), **Backups** (WP Engine API key), **Reading access logs** (Amazon S3). "AWS S3
  credentials" does not appear as a label.

Configured rows collapse to a one-line value and an outline button; unconfigured rows expand to
explain what they unlock and get a **filled** primary button. Consequence notes sit under the row
they belong to (*"Disconnecting takes this away from every agent at once"*).

**Chat** — the panel toggle (the biggest switch in the product: it removes the panel from every
screen in Local), retention 7/30/90/Forever with a sentence that tracks the choice, delete-all,
and a link to the sites overriding the global AI provider.

**Background work** — the section that carries the argument. A master switch, then a derived
summary: **connections a day (WP Engine) · connections a day (other hosts) · minutes of work a day ·
until the next pass**.

**The master is a true pause, and needs a new setting to be one.** There are six per-job
`AutoEnabled` flags and no global one. The master must *not* write `false` into all six — that
destroys the user's configuration, and switching back on silently re-enables jobs they had
deliberately turned off. Add a seventh field (`backgroundWorkPaused`); the scheduler checks it first
and the six per-job flags are never touched. It costs a schema field and is worth it: a master
switch that discards configuration is worse than no master switch. The copy says so —
*"Pausing this stops every schedule below and keeps your per-job settings exactly as they are"*, and
while paused, *"switching this back on restores them."*

**One row has no toggle.** `haltedSiteRefresh` has an interval and has never had an enable flag. Its
switch column shows a static **Always on** label — not a disabled toggle, which implies it could be
enabled. Its **interval column is an ordinary stepper**: `haltedSiteRefreshIntervalHours` is
`min(1).max(168)` and already has a working number input in today's Settings, so the earlier
*"not adjustable"* string is cut — it described the removed row 8, which had no interval at all.
The row is **excluded from the nav note's
denominator**: the note counts switchable jobs only, since a count including an unswitchable row can
never reach its own maximum. Below it one row per
job with the cost stated **as the value in the row**, not as prose underneath:
*"6 passes a day · 1,902 connections"*, *"no extra connections"* (for the WP Engine index, which
rides along), *"free"* (for the disk scan). Interval steppers are 1/2/4/8/12/24h. Off jobs read
*"nothing while off"*. All figures recompute live.

**External indexing is not free and gets its own row and its own figure.** Only the WP Engine index
rides an existing connection; the external one opens a separate SSH session per host and
structurally cannot share one. Its row says why, in the user's terms: *"This one cannot ride along —
each host needs its own SSH session, and shared hosting limits how many you may open."*

**Two connection figures, two thresholds — grouped by where the load lands, not by what the job
does.** `externalRefreshAutoEnabled` belongs in the external figure too: it opens its own session per
host on exactly the same terms, so with both external jobs enabled a shared host takes two
independent sessions per cycle. The group is therefore *"other people's servers"* rather than
*"external indexing"*, and the 6h threshold applies to both rows in it. Do not sum the two figures
into one headline. WP Engine connections turn amber **at or below 2h**; external sessions turn amber
**below 6h**.

The job table is **split into three destination groups** — *On your WP Engine account*, *On other
people's servers*, *On this Mac* — each with a one-line explanation in its header. This is what
carries the external-cost reasoning: it belongs to the destination, not to one row, so it sits in the
group header and every row stays the same height. See `MEMBERSHIP.md` for which row feeds which
figure, and `COPY.md` for the exact strings. The
consequence differs by whose infrastructure it is — WP Engine's platform tolerates a tight interval,
a third party's shared host caps `MaxSessions` and is not ours to hammer. A single blended total
would hide exactly the load that matters most.

**On run duration.** The prototype shows *"took 11 min"* per job and *"48 min of work a day"* in the
summary. No scheduler currently records duration — **add it**: a start/end timestamp per run, keep
the last few, average them. It is two `Date.now()` calls, and it is the figure that carries the row
(connections tell you the load; minutes tell you whether the interval is reasonable).

Until a real measurement exists, **omit the clause** — do not render *"not measured yet"*, *"—"* or
an estimate. That is the same failure as printing `UNKNOWN` in the event timeline (review finding
13): a field admitting it has nothing to say, at full weight. So:

| State | Job row | Summary |
|---|---|---|
| No run recorded yet | `6 passes a day · 1,902 connections` | `1,902 connections a day · next pass in about 2h` |
| At least one run recorded | `6 passes a day · 1,902 connections · took 11 min` | `1,902 connections a day · 48 min of work a day · next pass in about 2h` |

Connections/day is derivable from the install count and the interval, so **nothing blocks** —
Background work ships complete and becomes more informative once runs accumulate. The summary's
minutes clause appears as soon as any one job has a duration, and sums only over jobs that have one.

**What agents may do** — a **4×3** grid (actions × Local/Staging/Production) of clickable Allowed /
Blocked cells replacing the accordion. Risky production cells are amber even when allowed.

`wpcli_read` is **out of the grid entirely**, not greyed inside it, and becomes one sentence above:
*"Reading a site is always allowed, everywhere, and is not listed below — it is how Nexus answers
questions at all. Everything below changes something."* A disabled control in a grid of live ones
still reads as a control and invites "why can't I change this"; it also spends three cells of
weight on one fact. Below the grid, one line: *"Everything that changes a site starts off on
production until you turn it on here."*

**Advanced** — MCP port, gateway, search index. Opens with a line saying you shouldn't need this
page unless something is wrong.

Then a separate **Rebuilding and starting over** group holding all three destructive actions, which
the earlier draft had scattered (one marked danger, one as a plain `Run` inside a Housekeeping row,
one unlisted). Order them by what they cost to undo, and mark them by that cost — not by whether
they touch credentials:

| Intent | Label | Marking | Says |
|---|---|---|---|
| `RESET_CONTENT_INDEX` | Rebuild search | plain | *Keeps everything. Re-reads content you already have on this Mac.* · A few minutes · search results are patchy meanwhile |
| `RESET_AND_REFRESH` | Rebuild what Nexus knows | amber | *Keeps your connections and settings. Throws away everything Nexus worked out about your sites and reads all 367 again from scratch.* · About 30 minutes · Nexus cannot answer questions about your fleet until it finishes |
| `FACTORY_RESET` | Start over | red | *Keeps your connections. Forgets everything else, restores every setting on this page to its default and restarts Local.* · Restarts Local · nothing is rebuilt until you ask it to be |

The rule: **danger marking tracks cost-to-undo, not what gets deleted.** Preserving credentials is
not what makes an action safe — half an hour of an unanswerable fleet is the cost the user actually
pays, so `RESET_AND_REFRESH` cannot carry a plain `Run`. Every row states what it keeps, what it
loses and how long, in that order. All three take a confirm; only Start over needs a typed one.

### 6. First run

Three steps in a 620px centred column.
1. **Connect** — WP Engine (primary), **Another host** (SSH, with an inline form and the honest
   caveat that Nexus can read these sites but not manage the hosting), and local sites shown as
   already ready. Closing line: *"Nothing here needs the terminal."*
2. **Finding your sites** — a live count climbing to the total at `60px/800`, a progress bar, and a
   per-account list filling in. Copy states it keeps running in the background.
3. **Ask something** — three suggested questions grounded in the fleet; picking one renders a real
   answer with rows and an action.

External sites only count once a host is added — totals move from 354 to 367.

### 7. The panel (all screens, including outside Nexus)

The docked panel is **already globally mounted** in the current build —
`src/renderer/index.tsx` renders `DockedPanelContainer` into a fixed full-viewport div on
`document.body` at z-index 8999, gated by `dockedPanelEnabled`. It therefore already floats over
every screen in Local. This is the highest-value piece of the rework and most of its
infrastructure exists.

**Two tabs: Insights and Chat.** Header is a segmented control plus width and maximize controls.

**Insights** is context-aware. On a Nexus screen it shows the fleet: a waiting-items card linking
to the Inbox, four fleet stats, and a *Running on its own* block whose rows read live from the
background-job settings. On a **site** screen it scopes down — the site name as the context label,
*"2 things on this site need you"*, and site-level stats (what we know, broken links, errors, last
looked).

**Three sizes:** docked 380px, wide 620px (toggle), and full — an overlay over the whole app frame
(`position: absolute; inset: 0`) with a 760px centred column and the composer pinned at the bottom.
Maximizing switches to the Chat tab. Restore returns to docked. **The same conversation throughout**
— maximize is a size change, not a different surface.

**Screen 8 in the prototype ("Anywhere in Local")** shows the panel on an ordinary Local site
screen with no Nexus navigation present, to make the cross-app behaviour visible rather than
implied.

---

## Interactions & behaviour

- **Landing rule:** open on Inbox when anything is waiting, otherwise on Ask.
- **Health pill:** click opens a popover anchored to the header row (`position: absolute; top: 100%`)
  listing the inputs it checks, with ports and version at the bottom in mono.
- **Undo:** every inbox decision is reversible from the bar that appears after it.
- **Filters/search/pager** all recompute the visible set and the derived labels together.
- **Selection** on Sites drives the bulk bar; Clear empties it.
- **Transitions:** `animation: nxfade 0.18–0.35s ease` (opacity + 4px translateY) on newly revealed
  blocks; `transition: width 0.25s ease` on the first-run progress bar. Nothing else animates.
- **Empty states** are invitations, not statements: a never-run agent shows Run now as its primary
  content; the Inbox empty state names what will fill it.

## State

Prototype state, as a guide to what the real implementation needs:

```
screen, panelTab, panelOpen, panelSize ('docked'|'wide'|'full'), healthOpen
inboxFilter, decided{itemId: verb}, undo{id, text}
sitesFilter, query, page, selected{siteId}
chatTurns[], draft
frStep, syncCount, frAnswer, externalOpen, externalAdded
setSection, backgroundOn, jobState{key:{on, hours}}, perms{action:[local,stg,prod]}
gatewayOn, chatPanelOn, retention, googleOn, wpeApiOn, s3On
```

Derived, never stored: all counts, all cost figures, all status labels.

## Design tokens

**From `src/common/constants.ts`:**
`WPE_BRAND #0ECAD4` · `STATUS_RUNNING #51c356` · `STATUS_HALTED #999` ·
`STATUS_ERROR #ef4444` · `STATUS_WARNING #f59e0b`

**From `src/renderer/utils/theme.ts` (light):**
`--nxai-card-bg #ffffff` · `--nxai-card-border #e5e7eb` · `--nxai-card-text #111827` ·
`--nxai-card-sub / --nxai-card-label #6b7280` · `--nxai-section-label #374151` ·
`--nxai-section-bg #f9fafb` · `--nxai-code-bg #f3f4f6` · `--nxai-table-hover #f9fafb` ·
`--nxai-input-border #d1d5db` · `--nxai-warn-text #d97706` · `--nxai-status-neutral #9ca3af` ·
`--nxai-danger-text #ef4444` · `--nxai-chat-user-bg #e0f2fe` · `--nxai-filter-bg #f0fdf4` ·
`--nxai-error-bg #fef2f2`

**Added by this design, and why:**
- `#0a8189` — **primary button fill**. `#0ECAD4` with white text measures 2.96:1 and fails WCAG AA
  at button sizes. `#0a8189` measures 4.65:1, is the same hue, and is already used for links and
  the Nexus mark. Use `#0ECAD4` for accents, active borders, dots and badges; use `#0a8189` for
  anything filled that carries white text. Hover `#076b71`.
- `#ecfcfd` — teal tint for icon squares and selected rows
- `#fffbeb` / `#fde68a` / `#b45309` — warning surface, border, text
- `#f0fdf4` / `#3d9c52` — success surface and text
- `#05262e` — Nexus mark fill (from the asset)
- `#868d98` — icon stroke (from the panel icon assets)
- Dark surface `#111827` for the undo bar

**Type:** Local's UI font stack (prototype substitutes Nunito Sans). Page title 24/800
`-0.015em`; section title 22/800; hero 34/800 `-0.025em`; card title 15–16/700–800; body 13.5–14
at 1.5–1.6; meta 12.5–13; uppercase labels 12/800 `letter-spacing: 0.08em`. Mono is IBM Plex Mono
for evidence blocks, ports and identifiers.

**Radii:** 3 badge · 6–7 buttons and small controls · 9–11 cards and panels · 20 pills.
**Spacing:** 14 / 16 / 18 / 24 / 28. **Borders:** 1px `#e5e7eb`; 3px left accent on inbox cards.

## Assets

- `src/renderer/components/DockedPanel/assets/nexus-mark-glyph.svg` — rail mark, fill `#05262e`
- `.../icon-expand.svg`, `.../icon-contract.svg` — panel maximize / restore, stroke `#868d98`
- Rail badge styling comes from `src/renderer/SidebarBadgeManager.ts` (`#0ECAD4`, 14px tall,
  `border-radius: 3px`, `font-size: 8px/700`, `letter-spacing: 0.5px`)
- The three non-Nexus rail slots are Local core icons, not in this repo — the prototype renders
  neutral shapes rather than guessing at them

## Files

| File | What it is |
|---|---|
| `Nexus Redesign v1.dc.html` | The prototype. Eight screens via the switcher above the window. |
| `Nexus UX Review.dc.html` | The review: 17 findings, the proposed IA, and the reasoning. |
| `support.js` | Runtime for the two HTML files. Not part of the design. |
| `COPY.md` | Every string to quote verbatim — resets, footer, pause, external, permissions. |
| `MEMBERSHIP.md` | Which job rows belong to which set: denominator, WPE figure, external figure. |
| `BUILD-ORDER.md` | Suggested sequence of shippable changes. |
| `DECISIONS.md` | What was decided, what changed on contact, what is still open. |

Open either HTML file directly in a browser.
