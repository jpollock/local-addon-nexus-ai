# Ride-along: don't build it — and three strings to change

**Decision: do not make the ride-along real.** Correct the copy instead. Rationale, then the exact
strings.

## Why not build it

Making it real means the content index waits on the metadata pass and reuses its connection. That
buys one thing — fewer connections — and costs four:

- **A dependency between two schedulers.** The index can no longer be reasoned about, scheduled, or
  retried on its own.
- **A new failure mode.** Parent fails or is switched off, index silently never runs. That is
  precisely the class of thing the honest-health work exists to surface, and it would be reintroduced
  as designed behaviour.
- **An ordering constraint** on a job whose natural interval (12h) is different from its parent's (4-8h),
  so either it runs more often than it needs to or the parent runs less often than it should.
- **A coupling the user can't see** but can feel, when turning one job off changes another's cost.

And the saving is available for free by other means: the user can already lower the interval, and the
connection count is a number they control on that screen. Coupling two schedulers to avoid a number
the user can already move is the expensive way to solve it.

The cost of *not* building it is one honest number going up. That is the correct trade.

## What changes

Three strings, one membership rule. The first is the one you flagged; the other two are knock-on and
are the reason this is not a one-line change.

### 1. The cost string — becomes unconditional

| Was | Now |
|---|---|
| `2 passes a day · no extra connections` | `2 passes a day · <n> connections` |

Derived like any other WP Engine row: passes/day × WP Engine install count. No parent-state branch —
the conditional table in BUILD-REVIEW §1.2 collapses to this single row.

### 2. The row description — currently claims the thing that doesn't happen

| Was | Now |
|---|---|
| Indexes page and post text. Rides along with the check above. | Indexes page and post text on every WP Engine install. |

### 3. The WP Engine group header — same false claim, one level up

This is the one worth catching. The group header currently reads:

> These reuse one connection per install where they can, so they can run often.

If nothing reuses anything, that sentence is false for the whole group, and it is the sentence
justifying why this group's threshold (≤2h) is looser than the external group's (<6h). Replace with
the reason that is actually true — whose infrastructure it is:

> This is your own hosting, built to be talked to. These can run more often than the group below.

### 4. Membership

`Make content searchable` now contributes to the **WP Engine figure**, unconditionally, and takes the
**≤ 2h** amber threshold like its neighbours. It stops being a special case in every table it appears
in.

## Expected effect

The WP Engine figure goes up by (passes/day × installs) for that row — with the screenshot's values,
2 × 332 = 664 more per day. Nothing else moves. If that number now looks alarming at the default
interval, that is the design working: it was always being paid, and the old string hid it.

## One check before shipping

The same claim may exist elsewhere in the copy — anywhere describing this job as free, cheap, or
riding along. Grep for *rides along*, *no extra*, and *reuse* across the settings strings; the three
above are the ones visible in the screenshots, not necessarily all of them.
