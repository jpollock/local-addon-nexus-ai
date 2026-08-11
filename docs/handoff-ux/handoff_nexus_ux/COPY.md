# Copy deck — quote these verbatim

Every string the spec should quote rather than paraphrase. Grouped by where it appears. Where a
number appears, it is **derived** (see MEMBERSHIP.md) — the literal digits below are illustrative.

---

## Settings footer

> Everything Nexus can be configured with is here, with one exception: approving a new host the
> first time you connect to it stays in Local → Preferences → Nexus AI, because that approval must
> not be reachable from anything but Local itself.

`Local → Preferences → Nexus AI` renders in `#6b7280` at `font-weight: 700`; the rest is `#9ca3af`.

---

## Background work — master switch

Section subtitle:

> Nexus does some work on a schedule so it can answer questions without going out to your sites
> first. This is what that costs.

Switch label and sub, **on**:

> Nexus is keeping itself up to date
>
> Pausing this stops every schedule below and keeps your per-job settings exactly as they are — you
> can still run anything by hand.

Switch label and sub, **paused**:

> Background work is paused
>
> Nothing is running on a schedule and what Nexus knows will go stale. Your settings below are kept
> — switching this back on restores them.

Both halves matter: the on-state promises the settings survive, the paused-state confirms it. That
promise is what `backgroundWorkPaused` exists to keep.

## Background work — load summary

Three columns, separated by `border-left: 1px solid #f3f4f6`. Column heads are `11px/800`,
uppercase, `letter-spacing: 0.07em`, `#6b7280`:

> YOUR WP ENGINE ACCOUNT · **1,986** · connections a day · across 330 installs
>
> OTHER PEOPLE'S SERVERS · **52** · SSH sessions a day · across 13 sites · 2 of 2 jobs on
>
> TIME · 48 min of work a day · next pass in about 2h

Note lines swap in when the load is heavy:

> across 330 installs · very frequent
> across 13 sites · 2 of 2 jobs on · too frequent for shared hosting

And when nothing is scheduled, either column's note reads:

> nothing scheduled

Zero state for the whole summary: figures show `0` and TIME reads `next pass paused`.

## Background work — group headers

> **ON YOUR WP ENGINE ACCOUNT**
> These reuse one connection per install where they can, so they can run often.

> **ON OTHER PEOPLE'S SERVERS**
> Each of these opens its own SSH session per host and cannot share one with the other. Shared
> hosting limits how many you may open at once, so Nexus runs them less often on purpose.

> **ON THIS MAC**
> Nothing here connects anywhere.

The middle header carries the whole external-cost explanation **once**, at the group, because it is
a property of the destination rather than of either job. That is why neither external row needs its
own callout and why all rows stay the same height.

## Background work — job rows

| Row | What it says |
|---|---|
| Check WP Engine sites | Reads which plugins, themes and versions are on each install. This is the expensive one. |
| Refresh site details | URLs, admin emails and post counts. Opens its own connection to each install. |
| Make content searchable | Indexes page and post text. Rides along with the check above. |
| Check other hosts | Reads plugins, themes and versions on sites that are not at WP Engine. |
| Make other hosts searchable | Indexes page and post text on those same sites. |
| Index sites on this Mac | Starts a stopped site, reads its content, stops it again. |
| Look over stopped local sites | Reads files on disk. Nothing starts up and nothing connects anywhere. |

Seven rows. An eighth, *"Notice when a local site stops"*, was cut on 2026-08-10 — it is an event
hook rather than a schedule, so it had no interval, no passes-a-day and no cost to show. See
`MEMBERSHIP.md` § Corrections applied.

Cost strings, right-aligned, one per row:

> 6 passes a day · 1,986 connections      (WP Engine jobs)
> 2 passes a day · 26 sessions            (external jobs — "sessions", not "connections")
> 2 passes a day · no extra connections   (the WP Engine index, which rides along)
> 6 passes a day · 37 local sites         (local index)
> free                                    (disk scan, and the always-on row)
> nothing while off                       (any switched-off row)

Interval column: `every hour` / `every 4h` — **including the always-on row**, whose interval is an
ordinary stepper (1–168h, default 24). Only its switch column differs, showing a static label
rather than a disabled toggle:

> ALWAYS ON

**The earlier *"not adjustable"* interval string is cut with row 8.** It described the event hook,
which had no interval at all. The row it would now land on is `haltedSiteRefresh`, whose interval
*is* user-settable and already has a live number input in today's Settings ("Offline site scan",
`src/renderer/components/SettingsTab.tsx:407`). Printing "not adjustable" over a control that
currently works would be a silent feature removal.

---

## What agents may do

Above the grid:

> Reading a site is always allowed, everywhere, and is not listed below — it is how Nexus answers
> questions at all. Everything below changes something.

Below the grid:

> Everything that changes a site starts off on production until you turn it on here.

Row labels and sublabels:

| Action | Sub |
|---|---|
| Copy a site down to this Mac | Files and database, one way |
| Install or update things | Plugin and theme updates, core updates |
| Push local changes up | Overwrites the remote files and database |
| Delete or promote an environment | Cannot be undone |

Cells read `Allowed` / `Blocked`. Nothing else.

---

## Advanced — rebuilding and starting over

Group header and hint:

> **REBUILDING AND STARTING OVER**
> Three different things, in order of what they cost you. Each one says what it keeps and how long
> you are without it.

Nine fragments, three per row — name, what it keeps and loses, then what it costs you:

### Rebuild search — `RESET_CONTENT_INDEX` — plain

> Rebuild search
>
> Keeps everything. Re-reads content you already have on this Mac.
>
> A few minutes · search results are patchy meanwhile

Button: `Rebuild`

### Rebuild what Nexus knows — `RESET_AND_REFRESH` — amber

> Rebuild what Nexus knows
>
> Keeps your connections and settings. Throws away everything Nexus worked out about your sites and
> reads all 367 again from scratch.
>
> About 30 minutes · Nexus cannot answer questions about your fleet until it finishes

Button: `Rebuild everything`

### Start over — `FACTORY_RESET` — red

> Start over
>
> Keeps your connections. Forgets everything else, restores every setting on this page to its
> default and restarts Local.
>
> Restarts Local · nothing is rebuilt until you ask it to be

Button: `Start over`

**Styling per level.** plain `#e5e7eb` border / white / `#374151`; amber `#fde68a` border /
`#fffdf7` row / `#fffbeb` button / `#b45309`; red `#fecaca` border / `#fff5f5` row / `#fef2f2`
button / `#ef4444`. The duration fragment takes the level's text colour; the "keeps" fragment stays
`#4b5563` in all three.

All three take a confirm. Only **Start over** needs a typed one.
