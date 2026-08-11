# Build review — Nexus UX, first implementation pass

Reviewed against `handoff_nexus_ux/` (README, COPY.md, MEMBERSHIP.md, DECISIONS.md) and the eight
screens in `Nexus Redesign v1.dc.html`. Ten screenshots, 11 August 2026.

Each finding gives what shipped, what the handoff asked for, why it matters, and what to change.
Severity: **P1** breaks a non-negotiable or shows something provably false · **P2** loses the point
of a design decision · **P3** polish.

Two of these are my errors, not the implementer's, and are marked as such.

---

## Summary

**Landed well.** Health reports honestly. The knowledge ladder is in the Sites table. The
permissions grid is 4×3 with reading stated above it. The footer exception is present and correct on
every settings pane. Background work's destination grouping, both figures, the derived cost strings
and the pause copy are all in and reading from live values.

**Blocking.** Six irreconcilable fleet counts, one of them impossible. A cost label that is false
whenever its parent job is off. The most destructive cell in the permissions grid rendered as safe.

**Drifted.** Sites defaults to all 373 rows. Dashboard and Activity survived with ports and setup
commands still first. Agent cards carry raw internal text.

---

## P1 — must fix before this goes further

### 1.1 Six fleet counts, and one cannot be true

| Screen | Says |
|---|---|
| Sites | `373 installs on this Mac, WP Engine and other hosts` |
| Dashboard → Fleet Intelligence | `38 local` · `332 remote` (= 370) · `20 WPE-connected` |
| Background work | `across 332 installs` · `across 3 sites` |
| Advanced → Search index | `899 MB · 449 sites indexed` |
| Connections → WP Engine | `14 accounts connected` |
| Activity → Storage health | `331 tables` |

**449 indexed sites out of 373 that exist.** That one is provably wrong rather than merely
unexplained, so chase it first — it is almost certainly counting index rows, documents or vector
tables and labelling them "sites". Note `331 tables` on Activity and `332 installs` on Background
work sit one apart, which smells like the same off-by-one in a different dress.

373 vs 370 is the second: Sites and Dashboard disagree by exactly three, which is the external host
count. One of them is including external sites and the other is not, silently.

`14 accounts connected` also changed meaning: it previously read `11 of 14`, which said something
useful (three are excluded from scope). `14 connected` now overstates what is actually being read.

**Handoff:** README → Non-negotiables §1; MEMBERSHIP.md.
**Why it matters:** this is review finding 06, the one described as the biggest trust problem in the
product. A user who spots 449 > 373 has no way to know which other numbers to believe, and the
honest health indicator you just built inherits that doubt.
**Change:** one module computes total, local, WP Engine, external, needs-attention, searchable, and
indexed-of-total. Every label reads from it. No count is ever a string literal. Where a figure is
scoped differently, the label says so: `332 WP Engine installs`, `14 accounts · 11 in scope`,
`449 documents across 312 sites`.

### 1.2 The ride-along cost label is false when its parent is off — *my spec error*

Background work shows `Check WP Engine sites` **off**, while `Make content searchable` reads
`2 passes a day · no extra connections`.

Nothing is opening a connection for it to ride. So either it opens its own — in which case the cost
string is wrong, it belongs in the WP Engine figure, and the ≤2h amber threshold applies to it — or
it genuinely cannot run without its parent, and the row should say that rather than advertise a
saving.

**Handoff:** MEMBERSHIP.md row 3 — it lists the row as contributing to neither figure, unconditionally.
That table is wrong and I am correcting it: contribution is conditional on the parent being enabled.
**Change:** derive row 3's cost from row 1's state.

| Parent (`Check WP Engine sites`) | Row 3 reads | Contributes |
|---|---|---|
| on | `2 passes a day · no extra connections` | nothing |
| off | `2 passes a day · 664 connections` (own) | WP Engine figure, ≤2h amber |

If the second case is not what the scheduler actually does — if the index simply no-ops without the
metadata pass — then the row reads `needs "Check WP Engine sites" to be on` in `#9ca3af`, and the
interval control is disabled. Either is fine. Silently claiming a saving that isn't happening is not.
**Tell me which the scheduler does and I will write the exact string.**

### 1.3 "Push local changes up" is Allowed on Production, in green

The grid renders it identically to `Copy a site down to this Mac`. It is the one row that
overwrites a client's live site from a local copy, and it is the only Allowed-on-Production cell
that can destroy work rather than merely change it.

**Handoff:** README → Settings → What agents may do: *"Risky production cells are amber even when
allowed."*
**Why it matters:** the whole grid exists so that a non-developer can see, at a glance, what an
agent can do to a production site. Uniform green states that pushing to production is as ordinary as
pulling from it.
**Change:** Allowed-on-Production for `Push local changes up` and `Delete or promote an
environment` renders `#b45309` on `#fffbeb`, not `#3d9c52`. Allowed elsewhere stays green. Turning
one of those two on takes a confirm naming the environment.

### 1.4 Destructive Advanced actions have plain Run buttons

`Remove ghost installs` — *"Remove WPE installs that no longer exist in CAPI"* — deletes rows behind
an unmarked `Run`. `Database health → Scan` and `SSH diagnostics` are read-only and correctly plain,
so the page currently gives identical weight to a scan and a delete.

I also cannot see the **Rebuilding and starting over** group in the screenshot — Advanced ends at SSH
diagnostics with more below the fold. If it is not there, all three resets are still missing; if it
is, ignore this half.

**Handoff:** README → Advanced; COPY.md → *Advanced — rebuilding and starting over* (nine fragments,
three levels).
**Change:** `Remove ghost installs` takes the amber treatment and a confirm stating the count it will
remove. The three resets ship as specified, ordered by cost-to-undo.

---

## P2 — the decision was lost, not the feature

### 2.1 Sites opens on all 373 rows

Filters are `All · This Mac · WP Engine · External`, defaulting to All. `Needs attention` is absent.

**Handoff:** README → Sites: *"Default filter is Needs attention — never render 367 rows by default."*
**Why it matters:** this was the specific fix for review finding 12 (Operations as 37 identical rows
nobody can scan). At 373 rows sorted by nothing in particular, the table is a directory rather than a
worklist, and the agency operator — your stated primary user — has no entry point.
**Change:** add `Needs attention <n>` as the first chip and the default. It is the only filter whose
membership requires a rule: sites with pending items, or knowledge `Basic`, or a failed last sync.

### 2.2 The switch is the last thing in the row

Row reads: name · description · `every [8h]` · `nothing while off` · ☐. You learn the job, then its
schedule, then its cost, then discover it is switched off — which retroactively invalidates the two
things you just read.

**Handoff:** README → Background work; the prototype puts the switch first.
**Change:** switch leads the row. Also make it a switch rather than a checkbox — Local uses switches
for on/off state and checkboxes for selection, and this is state.

### 2.3 Interval is a free-text field

`every [8h]` is an editable input; one row reads `every [hour]`, which is a different format in the
same column. The handoff specified a stepper over a fixed set (1/2/4/8/12/24h) so that a user cannot
type `0.5`, cannot invent `3h`, and cannot produce a load figure nobody modelled.

**Change:** −/+ stepper across the fixed set. Display consistently: `every hour`, `every 4h`.

### 2.4 "Check other hosts" ships already amber

Default is `every hour` → 24 passes × 3 sites = 72 sessions/day, which trips the 6h threshold on
first run. The group header explains that Nexus runs these *"less often on purpose"* while the
default contradicts it.

**Change:** default external jobs to 12h. A warning the user did not cause teaches them to ignore
warnings.

### 2.5 Agent cards carry internal text

> Access log ingestion and read contract. Streams WPE Apache-style logs from S3, folds into daily
> aggregates, serves seo-insights and security-sentinel via contributed tools.

Also: `Every 6` and `Every 15` with no unit; `Auth Probe` — *"Tests WPE OAuth + SSH key auth from a
cron context"* — is an internal test harness on a user-facing surface; and the cards show
schedule/status but not what the agent needs from you.

**Handoff:** README → Agents (one sentence of what it does, in the user's terms); Non-negotiables §4.
**Change:** one plain sentence each. *"Reads your WP Engine access logs so other agents can spot
unusual traffic."* Units on every schedule. Auth Probe moves to Advanced or behind a debug flag —
it is diagnostics, not an agent anyone chooses to run.

### 2.6 The banner and the health pill disagree

Agents shows *"Nothing needs you right now · Everything is running autonomously"* while Seo Insights
is **Disabled** and has **never run**, and Activity concurrently reports *"Can't tell right now —
seo-insights has not reported a run yet (+1 more)."* Two surfaces, same moment, opposite claims.

**Why it matters:** the honest-health work is the thing that makes the pill trustworthy. A green
banner one tab away re-opens exactly the hole it closed.
**Change:** the Agents banner reads from the same rollup as the pill. If health is *unknown*, the
banner says so — *"Nothing waiting on you · one agent hasn't reported yet."*

---

## P3 — worth doing, not urgent

### 3.1 Dashboard and Activity survived, and Dashboard is still the landing tab

Six tabs (Dashboard · Inbox · Sites · Activity · Agents · Settings). Dashboard still opens on
`claude mcp add …`, a filesystem path, port 10802, 201 tools, v0.1.0, two Running service cards with
ports, and `$0.0000` gateway cost. There is no health pill in the header.

The handoff proposed four destinations with this content moving to a one-time setup flow, a header
pill, and Advanced. That is a bigger change than a build pass and it is reasonable that it did not
land yet — noting it so it does not quietly become permanent. Note the pieces are now duplicated:
port 10802 and the MCP command exist on both Dashboard and Advanced.

**Suggested order:** header pill first (the rollup already exists), then land on Inbox when anything
is waiting, then retire Dashboard once its unique content lives in Advanced.

### 3.2 Sites table has two dead columns

`Last sync` is `—` on every visible row and `Actions` is empty throughout. Either wire them or drop
them — an empty column reads as broken data, and this is the table that has to convince someone the
fleet view is trustworthy.

### 3.3 New permissions UI not in the handoff

`ACCOUNT SCOPE` chips, `WPE ONLY` / `WPE + SSH` badges, and `+ Add site exception` are all new. No
objection — account scope in particular is genuinely useful and belongs there. Two notes: the badges
introduce a fourth vocabulary for site type (the ladder is `This Mac / WP Engine / External`), and
per-site exceptions need a visible list, or they become invisible state that contradicts the grid.

### 3.4 Cells do not look interactive

`Allowed` / `Blocked` render as coloured text. The handoff called for clickable cells; nothing
signals that. Give them a hover state and a cell background.

### 3.5 Inbox empty state is a bare sentence

Ships as *"Nothing needs you right now."* on white. COPY.md has the second line —
*"Workflows will drop new findings here as they run"* — and the prototype draws it in a dashed
container so the empty state reads as a working surface rather than an unfinished screen.

---

## Corrections to the handoff

Two are mine.

1. **MEMBERSHIP.md row 3** states unconditionally that `Make content searchable` contributes to no
   figure. Wrong — that holds only while its parent is enabled. See 1.2. Corrected in this pass.
2. **README → Background work** should state that any ride-along row's cost string is derived from
   its parent's state, so the next scheduler added this way inherits the rule rather than the bug.

---

## Questions back

1. Does `Make content searchable` open its own connections when `Check WP Engine sites` is off, or
   no-op? Determines which of the two strings in 1.2 is correct.
2. What is `449 sites indexed` actually counting?
3. Is `373` or `370` the fleet, and which one is missing the three external sites?
4. Did the **Rebuilding and starting over** group land below the fold in Advanced, or is it not built?
5. Is the docked panel (Insights + Chat, three sizes) in this build? The ✦ button is bottom-right but
   nothing in these screens shows the panel itself.
