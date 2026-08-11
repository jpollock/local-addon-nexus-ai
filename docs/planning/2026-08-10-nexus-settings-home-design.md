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

The handoff's footer line is the acceptance test for the whole spec:

> *"Everything Nexus can be configured with is here. There is no second settings page."*

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

`derived.ts` is that module for this screen. Every nav note (`"4 of 6 on"`, `"5 on"`,
`"production safe"`), every cost string and the summary line come from it. Site counts come from
`collectFleetCounts` — the foundation spec's deliverable — never re-derived from the graph.

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

The summary line behaves the same way: `1,986 connections a day · next pass in about 2h` until at
least one job has a duration, then the minutes clause appears between them. Nothing is blocked
waiting for data — connections and passes are derivable from the interval and the install count on
day one.

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

**Seven jobs, not the prototype's five.** The prototype was drawn before external became a
first-class site type; spec 5 shipped it and surfaced `externalContentIndexAutoEnabled` in
Settings. The real set, from `src/common/schemas.ts`:

| Row | Setting pair | Connections? |
|---|---|---|
| Check WP Engine sites | `wpeRefreshAutoEnabled` / `wpeRefreshIntervalHours` | yes, one per install |
| Refresh site details | `wpeSyncAutoEnabled` / `wpeSyncIntervalHours` | yes, one per install |
| Make WP Engine content searchable | `wpeContentIndexAutoEnabled` / `wpeContentIndexIntervalHours` | **no extra** — rides along |
| Check other hosts | `externalRefreshAutoEnabled` / `externalRefreshIntervalHours` | yes, one per host |
| Make other hosts searchable | `externalContentIndexAutoEnabled` / `externalContentIndexIntervalHours` | **yes** — see below |
| Index sites on this Mac | `localContentIndexAutoEnabled` / `localContentIndexIntervalHours` | local only |
| Look over stopped local sites | `haltedSiteRefreshIntervalHours` | free |

**External content indexing is not "no extra connections".** Only the WP Engine one rides along.
CLAUDE.md is explicit that `ExternalContentIndexScheduler` opens a separate SSH session per host
because external SSH has no `ControlMaster` to piggyback on, and must not gain one — shared hosting
caps `MaxSessions`, and `ControlPersist` would hold a socket open to a third party's production
server. Copying the WPE row's copy here would understate the cost of the one job whose cost lands
on someone else's server.

**`haltedSiteRefresh` has no on/off.** It has an interval and no enable setting; it always runs.
The row shows its interval and reads `free`, matching the prototype's own cost for it. Inventing
`haltedSiteRefreshAutoEnabled` would hand users a switch for something that has never been
switchable — a behaviour change that deserves its own decision, not a side effect of a settings
rewrite.

**The arithmetic**, from the prototype, unchanged:

```
per(h)      = round(24 / h)                    passes per day
connPerDay  = Σ over connecting, enabled jobs of per(h) × siteCount
minsPerDay  = Σ over enabled jobs of per(h) × avgDurationMin      (omitted if no durations)
nextIn      = min(h) over enabled jobs
```

Interval steppers are 1/2/4/8/12/24h. Cost turns amber below 2h. Off jobs read `nothing while
off` — never `0`. A master switch pauses everything.

### 4. What agents may do

A 5×3 grid of clickable Allowed / Blocked cells replacing the accordion — which exists in **both**
current homes and is the clearest single case of the duplication this spec removes.

| Row | Real permission key |
|---|---|
| Copy a site down to this Mac | `pull` |
| Read what is installed | `wpcli_read` |
| Install or update things | `wpcli` |
| Push local changes up | `push` |
| Delete or promote an environment | `delete` |

Columns are Local / Staging / Production, mapping to `development` / `staging` / `production`.
Risky production cells are amber even when allowed. **Reading is stated as always-on and is not
rendered as a toggle** — `wpcli_read` is permitted on every environment by default and the grid
should say so rather than offer a switch that misrepresents the default.

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
| Search index | size · *N sites indexed* | Rebuild | `renderContentIndexReset` (`NexusOverview:966`) |
| Database health | — | Scan | `renderDbScanSection` (`:1062`) — **added** |
| Housekeeping | — | Run | `renderContentMaintenance` (`:1135`) — **added** |
| SSH diagnostics | — | Run | `renderSshDiagnostics` (`:1186`) — **added** |
| Start over | — | Reset (danger) | `renderFactoryReset` (`:878`) |

`Start over` is Factory Reset, not the content-index reset — *"forgets everything Nexus has
learned"* is `FACTORY_RESET`, which also clears keychain entries, WPE OAuth and the telemetry id.
The content index reset is the `Search index → Rebuild` row. Conflating them would put a
credential-destroying action behind a button labelled "Rebuild".

Also moving here: `SettingsTab.renderAutoIndexingSection` ("index internals").

## Operations dies here

Once Advanced exists, `renderOperationsTab` has nothing left. The tab entry, the render method and
the ~450 lines of zone-3 methods leave `NexusOverview`, which drops from 1,655 lines to roughly
1,200. Spec 5's `operations-shell.test.ts` inverts: it currently asserts those five capabilities
are still reachable from `NexusOverview`, and becomes an assertion that they are reachable from
Advanced.

## Data this spec adds

`JobRunStore` — the only new persistence.

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
- External content indexing does **not** read "no extra connections"
- No hardcoded hex colours in any section's tree

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

- **Agent cards are spec 6b.** `AgentsHub.tsx` (164) and `AgentCard.tsx` (138) are untouched.
- **`DECISIONS.md` still says external caps at Detailed.** Spec 5 shipped the opposite. The line is
  stale and should be corrected when someone next edits that file; it is not this spec's to change.
- **The prototype's `mins` constants (11, 7, 26, 4, 1) are mock measurements.** Real averages come
  from `JobRunStore`; the constants are not seeded as defaults.
- **`renderMcpCard` stays on the Dashboard.** Only the connection *panel* moves to Advanced. The
  card is a status rollup, the same argument that kept the three count cards in spec 5.
- **Search index size** — the prototype shows `846 MB`. Whether a real size is cheaply available
  from the vector store is unverified; if it is not, the value is omitted under the rule above.
