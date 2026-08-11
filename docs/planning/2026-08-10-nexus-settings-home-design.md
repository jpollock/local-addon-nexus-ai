# Spec 6a — Settings: one home, five sections, honest costs

Date: 2026-08-10
Branch: `spec-6-settings` (worktree, branched from `new-ux-v2` at `48ad609b`)
Predecessors: specs 1+2 (foundation), 2.5 (NexusOverview decomposition), 3 (panel), 4 (Inbox),
5 (Sites table)
Handoff: `docs/handoff-ux/handoff_nexus_ux/README.md` §5, `BUILD-ORDER.md` step 6

## Why this exists

`BUILD-ORDER.md` step 6 is "Settings and agents". It is four things, and this spec is the first
three-quarters of it: **one Settings home replacing the current two**, including the Advanced
section that spec 5 promised a destination to. The agent-card rewrite is spec 6b — it shares no
code with this and is independently shippable.

The handoff is unusually prescriptive here. `README.md` §5 gives the layout, the section list, the
derived notes and the final copy; the prototype gives the working cost arithmetic. **Where this
document is silent, the handoff is the answer.** Where this document contradicts the handoff, it
is because the handoff was drawn before something shipped, and each case is named below.

## What "two settings homes" actually means

| Home | File | Lines | Sections |
|---|---|---|---|
| In-app | `src/renderer/components/SettingsTab.tsx` | 860 | Auto-indexing, Sync schedule (Local / WPE / External), WP Engine access |
| Native | `src/renderer/components/NexusPreferences.tsx` | 1871 | External hosts, WPE access control, Chat, WPE credentials, AWS credentials |

They are not merely split — they **overlap**. WP Engine access is implemented twice
(`renderWpeAccessSection` in the first, `renderWpeAccessControlSection` in the second), and
external hosts appear in both. The merge is therefore a reconciliation, not a relocation, and any
task that only moves code has not done the job.

The acceptance test for the whole spec is **one settings home plus one named, justified
exception**. The footer states the exception rather than overclaiming (`COPY.md` § Settings
footer):

> *"Everything Nexus can be configured with is here, with one exception: approving a new host the
> first time you connect to it stays in Local → Preferences → Nexus AI, because that approval must
> not be reachable from anything but Local itself."*

The earlier *"There is no second settings page"* could never have been true: trust-on-first-use
host-key approval is IPC-only by design and must not be reachable over GraphQL. That is a security
boundary, so it is stated in the UI rather than quietly preserved. The test still retires the real
overlap — six sections duplicated across two homes.

## Copy and membership are quoted, not paraphrased

Two handoff files are normative for this spec and must be quoted rather than restated:

| File | Owns |
|---|---|
| `docs/handoff-ux/handoff_nexus_ux/COPY.md` | every user-visible string — the nine reset fragments, both halves of the pause copy, all seven row descriptions, the six cost-string forms, the grid's two framing lines |
| `docs/handoff-ux/handoff_nexus_ux/MEMBERSHIP.md` | which rows belong to which subset, which figure each feeds, and each row's amber threshold |

`MEMBERSHIP.md` was **reconciled against the code on 2026-08-10** and four of its eight flag names
were corrected; the corrections are tabulated in that file. Read the corrected table, not the
design's original mapping.

## Architecture

### A. Shell plus one file per section

`SettingsTab.tsx` is 860 lines today and absorbing both homes would take it past 2,500. It becomes
a **shell** — the 232px nav, the section dispatch, and nothing else — with one component per
section under `src/renderer/components/settings/`:

```
settings/
  SettingsShell.tsx        nav + dispatch + the footer line
  ConnectionsSection.tsx
  ChatSection.tsx
  BackgroundWorkSection.tsx
  PermissionsSection.tsx
  AdvancedSection.tsx
  derived.ts               every number on the screen
```

This is the same move spec 2.5 made on `NexusOverview` and spec 5 made with `tabs/`. Each section
is a pure function of its props; the shell owns the settings fetch and the save.

`NexusPreferences.tsx` keeps host management and the trust-on-first-use host-key UI — those are
genuinely native-Preferences concerns and `TRUST_EXTERNAL_HOST_KEY` is deliberately IPC-only, not
GraphQL (CLAUDE.md). Everything else in it moves, and what remains gains a line pointing at the
in-app home.

### B. One source for every number

The handoff's first non-negotiable, and the one it says broke four times during the prototype's own
build:

> *"Compute fleet figures **once**, in one module, and have every label read from it. Never restate
> a number in a string literal."*

`derived.ts` is that module for this screen. Every nav note (`"4 of 6 on"`, `"5 of 6 on"`,
`"production safe"`), **both** connection figures, every cost string and the three summary columns
come from it. Site counts come from `collectFleetCounts` — the foundation spec's deliverable —
never re-derived from the graph. Its row-to-subset mapping is `MEMBERSHIP.md`'s table, transcribed
once.

### C. Absent data omits its clause

**A figure with no measurement behind it renders nothing at all — not a zero, not a placeholder,
not "not measured yet".**

This is already the handoff's own rule, from `BUILD-ORDER.md` step 1: *"omit the actor field rather
than printing `UNKNOWN`"*. A field that admits it has nothing to say still occupies a row at full
weight and trains the reader to skip it.

Applied here, a job row on a fresh install reads:

```
6 passes a day · 1,986 connections
```

and after its first real run becomes:

```
6 passes a day · 1,986 connections · took 11 min
```

The summary behaves the same way: the TIME column reads `next pass in about 2h` until at least one
job has a duration, then gains `48 min of work a day` above it. Nothing is blocked waiting for
data — connections and passes are derivable from the interval and the install count on day one.

The same rule governs a whole group: with no external host connected, the *Other people's servers*
column and its two rows **do not exist**, rather than rendering as `0`.

## The five sections

### 1. Connections

Grouped by what each thing gets you, not by what it is. Three groups, per `README.md` §5:

- *Where your sites are* — WP Engine, Other hosts
- *How Nexus answers you* — the provider, with the Local AI Gateway **nested underneath it**
  (`margin-left: 28px`) as *"Let WordPress sites use it too"*
- *What else Nexus can do* — **Traffic and search data** (Google), **Backups** (WP Engine API key),
  **Reading access logs** (Amazon S3)

"AWS S3 credentials" does not appear as a label. Configured rows collapse to one line and an
outline button; unconfigured rows expand to explain what they unlock and get a filled primary
button. Consequence notes sit under the row they belong to.

Sources: `NexusPreferences`'s `renderWpeCredsSection`, `renderAwsCredsSection`,
`renderExternalHostsSection`, plus the provider settings from `SettingsTab`.

### 2. Chat

The panel toggle (`dockedPanelEnabled` — the biggest switch in the product, it removes the panel
from every screen in Local), retention 7/30/90/Forever (`chatRetentionDays`) with a sentence that
tracks the choice, delete-all, and a link to sites overriding the global AI provider.

Source: `NexusPreferences.renderChatSection`.

### 3. Background work

The section that carries the argument, and the only one that is substantially new.

**Grouped by where the load lands, not by what the job does.** Three destination groups, each with
its own header, its own figure and its own amber threshold:

| Group | Header | Rows | Threshold |
|---|---|---|---|
| `wpe` | On your WP Engine account | Check WP Engine sites · Refresh site details · Make content searchable | ≤ 2h |
| `ext` | On other people's servers | Check other hosts · Make other hosts searchable | < 6h |
| `local` | On this Mac | Index sites on this Mac · Look over stopped local sites | never |

Grouping by destination is what made the section coherent. The earlier framing pulled *external
indexing* out for reasons that were verbatim true of *external refresh* — both open their own SSH
session per host and neither can share one with the other, so with both enabled a shared host takes
**two independent sessions per cycle**. `ExternalContentIndexScheduler.ts:58` says so in as many
words. Naming the group by destination means adding a job is a question of which destination it
hits, not of inventing a threshold.

It also fixes the layout: the external-cost explanation lives **once, in the group header**, because
it is a property of the destination rather than of either job. No per-row callout, and every row
stays the same height.

> **`README.md` §5 is stale on exactly this point.** It still carries the older per-row framing
> (*"External indexing … gets its own row … Its row says why"*) with a per-row string. `COPY.md`
> § Background work — group headers supersedes it. Quote `COPY.md`.

**Row membership, the three subsets and every flag name come from `MEMBERSHIP.md`** — reconciled
against the code, with four of the design's eight flag names corrected. Do not re-derive them here.
The two facts that most often get assumed wrong:

- **Group membership and cost contribution are different predicates.** "Make content searchable"
  sits in the `wpe` group and contributes **nothing** to its figure, because it rides the connection
  "Check WP Engine sites" already opened. A row can have a group and no `conn`.
- **The switchable denominator is 6 with an external host connected and 4 without**, not the 7 and 5
  the design's table gave. `haltedSiteRefresh` is the always-on row and is excluded from both.

**`haltedSiteRefresh` has no on/off, but its interval is adjustable.** It has never had an enable
setting, so its switch column shows a static **Always on** label — *not* a disabled toggle, which
would imply it could be enabled. Inventing `haltedSiteRefreshAutoEnabled` would hand users a switch
for something that has never been switchable, a behaviour change deserving its own decision rather
than a side effect of a settings rewrite.

Its **interval column is an ordinary stepper**. `haltedSiteRefreshIntervalHours` is
`min(1).max(168)`, defaults to 24, and already has a working number input in today's Settings
(`SettingsTab.tsx:407`, labelled "Offline site scan"). The design's *"not adjustable"* string
described the cut row 8, which had no interval at all; carrying it here would silently remove a
control that ships today.

**The master switch is a pause, not an all-off.** It gets its own persisted field,
`backgroundWorkPaused`; the six per-job flags are never written to. A master that writes `false`
into all six destroys the user's configuration and silently re-enables jobs they had deliberately
turned off when switched back on. Both halves of `COPY.md`'s pause copy make that promise explicit,
and the field is what keeps it.

**The arithmetic:**

```
per(h)       = h === 0 ? OFF : round(24 / h)      passes per day
wpeConnPerDay = Σ over wpe-group rows with conn, enabled, of per(h) × installCount
extSessPerDay = Σ over ext-group rows,           enabled, of per(h) × hostCount
minsPerDay    = Σ over enabled jobs of per(h) × avgDurationMin   (omitted if no durations)
nextIn        = min(h) over enabled jobs
```

**Never sum the two connection figures.** A blended total hides the load that matters most. The
summary renders them as three hairline-separated columns — *Your WP Engine account* / *Other
people's servers* / *Time* — each with its own figure, unit and scope note, ambering independently.
The units differ deliberately: `connections a day` versus `SSH sessions a day`. Two clauses on one
line would re-blend them typographically even with separate numbers.

**`h === 0` must be handled before the division.** Six of the seven intervals are `min(1)`, but
`localContentIndexIntervalHours` is `min(0)` and 0 is a legal stored value meaning *off*.
`round(24 / 0)` is `Infinity`, which renders as `"Infinity passes a day"`.

Interval steppers are 1/2/4/8/12/24h. Off jobs read `nothing while off` — never `0`.

### 4. What agents may do

A **4×3** grid of clickable Allowed / Blocked cells replacing the accordion — which exists in
**both** current homes and is the clearest single case of the duplication this spec removes.

| Row | Real permission key |
|---|---|
| Copy a site down to this Mac | `pull` |
| Install or update things | `wpcli` |
| Push local changes up | `push` |
| Delete or promote an environment | `delete` |

Columns are Local / Staging / Production, mapping to `development` / `staging` / `production`.
Risky production cells are amber even when allowed.

**`wpcli_read` is out of the grid entirely**, stated in one line above it rather than rendered as a
fifth row. It is permitted on every environment by default and is how Nexus answers questions at
all; a toggle for it would misrepresent the default, and a permanently-Allowed row would be four
cells of noise. Both framing lines are in `COPY.md` § What agents may do.

Writes to `remoteOperationPermissions`. The legacy `wpeAllowedEnvironments` is dead code and is not
surfaced (CLAUDE.md: all four exported functions of `environment-filter.ts` have zero callers).

### 5. Advanced

Opens with: *"You should not need anything on this page unless something has gone wrong or you are
wiring Nexus into your own tools."*

The prototype gives four rows. Spec 5 stranded **five** items in the Operations shell, and three of
them have no row in the prototype — it was drawn before spec 5 identified them. They get rows on
the same pattern rather than being dropped, because spec 5's whole justification for keeping the
Operations tab alive was that deleting it would make them unreachable.

| Row | Value | Action | From |
|---|---|---|---|
| Connect your own AI tools | `port 10801` | Copy command | Dashboard `renderMcpPanel` |
| AI gateway | `port 13100` | View usage | existing gateway panel |
| Database health | — | Scan | `renderDbScanSection` (`NexusOverview:1062`) — **added** |
| Remove ghost installs | — | Run | `renderContentMaintenance` (`:1135`), first button — **added** |
| SSH diagnostics | — | Run | `renderSshDiagnostics` (`:1186`) — **added** |

Plus the reset group below. Also moving here: `SettingsTab.renderAutoIndexingSection`
("index internals").

#### Rebuilding and starting over

**Three destructive actions, not two, in one group ordered by cost-to-undo.** The third —
`RESET_AND_REFRESH` — was invisible to the prototype because it is the *second button inside*
`renderContentMaintenance`, under a row the earlier draft labelled "Housekeeping → Run". It
`DELETE`s every graph table, drops all vectors, then re-syncs the fleet.

| Order | Row | Channel | Level | Costs you |
|---|---|---|---|---|
| 1 | Rebuild search | `RESET_CONTENT_INDEX` | plain | a few minutes, patchy search meanwhile |
| 2 | Rebuild what Nexus knows | `RESET_AND_REFRESH` | **amber** | ~30 min with the fleet unanswerable |
| 3 | Start over | `FACTORY_RESET` | **red** | restarts Local; nothing rebuilt until asked |

Each row states what it keeps, what it loses, then how long — nine fragments, verbatim in `COPY.md`
§ Advanced. All three take a confirm; only **Start over** takes a typed one.

**The ranking rule is cost-to-undo, not what gets deleted.** An earlier draft of this spec justified
the split by claiming `FACTORY_RESET` "also clears keychain entries, WPE OAuth and the telemetry
id." **That is false, in the opposite direction:**

```
src/main/ipc-handlers.ts:4342   // Survives: API keys (Keychain), WPE OAuth session, telemetry ID.
src/renderer/components/NexusOverview.tsx:925
                                '✓ API keys (Keychain), WPE OAuth, and telemetry ID are not affected'
```

Credentials survive `FACTORY_RESET` by design, so the user can recover. Preserving credentials is
therefore *not* what makes an action safe — which is why `RESET_AND_REFRESH`, which preserves both
credentials and settings, cannot carry a plain `Run`: half an hour of an unanswerable fleet is what
the user actually pays. Any implementation that warns users their credentials will be destroyed is
lying to them and contradicts confirmation copy already shipped 300 lines away in the same file.

## Operations dies here

Once Advanced exists, `renderOperationsTab` has nothing left. The tab entry, the render method and
the ~450 lines of zone-3 methods leave `NexusOverview`, which drops from 1,655 lines to roughly
1,200. Spec 5's `operations-shell.test.ts` inverts: it currently asserts those five capabilities
are still reachable from `NexusOverview`, and becomes an assertion that they are reachable from
Advanced.

## Data this spec adds

### `backgroundWorkPaused` — a new setting

The master pause needs its own boolean. It must be added to **`UpdateSettingsSchema` in
`src/common/schemas.ts`**, which is `.strict()` — a field absent from that schema is silently
stripped on write, the setting never persists, and the master switch appears to work until Local
restarts. This is a known, previously-hit failure mode in this codebase.

The scheduler checks it first; **the six per-job `AutoEnabled` flags are never written to.** That is
the whole point of the field, and both halves of the pause copy promise it out loud.

### `JobRunStore` — the only new persistence

- `record(jobKey, startedAt, durationMs)` — called by each scheduler at the end of a cycle
- `lastRunAt(jobKey)` → `number | null`
- `averageMs(jobKey)` → `number | null`, mean of the last 5 runs, `null` when there are none

Persisted through `registryStorage` with a per-job cap of 5, the way `AuditLogger` already bounds
its store. `null` is the value that drives clause omission, so it must never be coerced to 0.

Each job brackets its existing run loop with two `Date.now()` calls. **The seven do not share a
shape**, and a task that assumes they do will not compile:

| Job | Runner | Shape |
|---|---|---|
| Check WP Engine sites | `WpeRefreshScheduler` | class, `restart`/`stop` |
| Check other hosts | `ExternalRefreshScheduler` | class |
| Make other hosts searchable | `ExternalContentIndexScheduler` | class |
| Look over stopped local sites | `HaltedSiteRefreshScheduler` | class |
| Index sites on this Mac | `opportunisticScheduler` | class, `restart` only |
| Make WP Engine content searchable | `wpeContentIndexTimer` | **bare `setInterval`**, not a class |
| Refresh site details | `runWpeAutoSyncIncremental` → `WPESyncService.syncAllWPESites` | **closure + startup check**, `src/main/index.ts:923` |

The first five are the ones `onSettingsUpdated` restarts. The last two are not `Scheduler`
instances and have no `restart`/`stop`, so they need instrumenting at their call sites rather than
in a shared base. CLAUDE.md warns that a new settings-driven scheduler must be wired into
`onSettingsUpdated` rather than into one caller of it — that applies to reading intervals, and is
worth re-reading before touching this list.

## Testing

`serializeTree` + `new Component(props).render()`, the established pattern — **not**
`serializeTree(createElement(C, props))`, which serializes the props bag and makes assertions
vacuous (spec 5 hit this; the helper's own docblock records why).

The load-bearing tests are the derived figures, because they are what the handoff says keeps
breaking:

- A job at 4h with 331 WPE installs reads `6 passes a day · 1,986 connections`
- Turned off, it reads `nothing while off` — never `0`
- With no recorded runs, the row has **no** duration clause and the summary has **no** minutes
  clause; with runs, both appear
- The nav note for Connections equals the count of configured rows, not a literal
- No hardcoded hex colours in any section's tree

The membership rules need their own tests, because they are the part a reader will "simplify" back
into a single set:

- **The two figures are never summed.** The WP Engine figure and the other-hosts figure appear
  under separate column heads with different units (`connections` vs `SSH sessions`), and no
  rendered string contains their total.
- **`externalRefreshAutoEnabled` contributes to the other-hosts figure**, not the WP Engine one —
  the specific regression that grouping-by-destination fixed.
- **"Make content searchable" contributes nothing** while still rendering under the WP Engine
  header: group membership and cost contribution are separate predicates.
- **The switchable denominator is 6 with an external host and 4 without**, and never counts
  `haltedSiteRefresh`.
- **The always-on row renders a static label**, not an `input` with `disabled: true`.
- **`localContentIndexIntervalHours: 0` reads `nothing while off`**, never `Infinity passes a day`.
- **Amber fires at ≤ 2h for `wpe` rows and < 6h for `ext` rows** — one threshold per destination.
- **Toggling the master leaves all six per-job flags byte-identical**, and `backgroundWorkPaused`
  survives a write through `UpdateSettingsSchema` (the `.strict()` guard).
- **`RESET_AND_REFRESH` renders at the amber level and `FACTORY_RESET` at red**, and no reset row's
  copy claims credentials are destroyed.

## Global constraints

- React 16, `React.createElement`, class components, inline styles — no JSX, no hooks.
- `--nxai-*` variables only. `--nxai-accent` (#0a8189) for primary buttons; the brand `#0ECAD4` is
  **2.02:1** against white — measured, not the 2.96:1 the handoff states — and fails WCAG AA.
- Every population renders with its `scope` string, never a bare number.
- Counts come from `collectFleetCounts`; never re-derive local counts from the graph.
- Absent data omits its clause. No placeholder, no zero.
- Never bare `git stash` / `git stash pop` — the stash stack is shared across worktrees.
- No `npm version`, `git tag`, `git push` or release. Commit locally only.
- No `npm install` / `npm run rebuild` — the native module is already correct in the worktree.

## Known limitations to record, not fix here

- **Agent cards are spec 6b.** `src/renderer/components/agents/AgentsHub.tsx` (164) and
  `AgentCard.tsx` (138) are untouched.
- **`DECISIONS.md` still says external caps at Detailed.** Spec 5 shipped the opposite. The line is
  stale and should be corrected when someone next edits that file; it is not this spec's to change.
- **The prototype's `mins` constants (11, 7, 26, 4, 1) are mock measurements.** Real averages come
  from `JobRunStore`; the constants are not seeded as defaults.
- **`renderMcpCard` stays on the Dashboard.** Only the connection *panel* moves to Advanced. The
  card is a status rollup, the same argument that kept the three count cards in spec 5.
- **Search index size is available** — `SqliteVecStore` exposes no size API, but the store is a
  single file (`nexus-ai/vectors.db`) and `statSync().size` gets it in two lines. Earlier drafts
  recorded this as unverified; it is verified now, so the `846 MB` figure is real rather than
  omitted.
- **The cost string wraps at narrow widths.** In its 190px column it breaks as
  `"6 passes a day · 1,902 / connections"`. Legible, but if it should never wrap the column wants
  ~230px, or the two clauses want to be stacked by design rather than by accident. Designer's note
  from the prototype build.

- **An eighth job row was cut.** *"Notice when a local site stops"* is the `siteStopped` event hook
  (`src/main/content/lifecycle-hooks.ts:529`,
  `src/main/agent-event-bus/bridges/local-lifecycle-bridge.ts:24`) — no interval, no cycle, no cost,
  nothing to pause, so it could fill none of the table's columns. Cut by the designer 2026-08-10.
  **Background work has seven rows.** Do not reintroduce it; if the running/stopped reassurance is
  wanted it belongs wherever site status is displayed, not in a cost table.
