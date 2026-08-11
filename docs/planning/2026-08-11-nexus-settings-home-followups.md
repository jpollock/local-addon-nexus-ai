# Spec 6a — follow-ups after implementation

Date: 2026-08-11
Branch: `spec-6-settings` (12 tasks, 37 commits, base `48ad609b` on `new-ux-v2`)
Plan: `2026-08-10-nexus-settings-home-plan.md` · Design: `2026-08-10-nexus-settings-home-design.md`

Everything here was **found and deliberately deferred**, not missed. Each task passed a
scoped review; a whole-branch review and one fix wave followed. Suite at merge:
**24 failed, 4106 passed** — the same 24 pre-existing failures in nine unrelated suites
that were present before the branch started.

---

## For the designer

**1. Brand cyan is gone from the settings surfaces.** `#0ECAD4` measures **2.02:1** on
white and fails WCAG AA. The old `NexusPreferences` used it in five places; the new
sections use `--nxai-accent` (`#0a8189`). This is a real visual change — brand cyan
becomes accent teal on the my.wpengine.com link and the "checking" status — not a
refactor. Anyone comparing screenshots will see it.

**2. The danger/error token pairing fails AA in light theme.**
`--nxai-danger-text` on `--nxai-error-bg` is **3.44:1**; `ConnectionsSection` has the
same pairing at 3.76:1; `SettingsShell`'s footer is **2.43:1** — on the sentence that
*is* the acceptance test. Measured across every declared token: **no danger-coloured
token clears 4.5:1 on that background in light theme.** `--nxai-card-text` would pass at
16.22:1 but strips the danger semantic from a destructive label. This is a palette gap,
not a component bug, and needs a colour decision.

**3. Seven new theme tokens want confirmation.** Added for the Advanced reset group:
amber border/row/button/text and red border/row plus a "keeps" text token. Light values
are exact matches to the hexes in `COPY.md`; dark values were **derived from the
patterns already in `theme.ts`** (`--nxai-error-bg` goes `#fef2f2` → `#450a0a`;
`--nxai-warn-text` goes `#d97706` → `#fbbf24`) rather than invented, with the derivation
documented in-file. Resulting dark contrast: 8.97:1 and 5.84:1, both clearing AA.

**4. The Chat override link has no destination.** The design specifies "a link to sites
overriding the global AI provider". No such link existed in the source and no target is
defined. Deferred with an in-code comment. Candidates: the Sites tab filtered to
per-site-override sites, or a new list.

**5. The Chat retention sentence has no copy.** `COPY.md` covers Background work,
Permissions, Advanced and the footer — it has **no Chat section at all**. An implementer
wrote a placeholder; it was removed rather than shipped, because invented copy formatted
as the designer's is indistinguishable from approved copy to everyone downstream.

**6. `wpcli_read` is enforced but not surfaced.** Design-sanctioned — `COPY.md` mandates
exactly four grid rows. But the setting is still enforced by the gate, still in the
schema, and still writable via `nexus settings set`. The line above the grid reads
"Reading a site is always allowed, everywhere"; it is *default*-allowed and remains
blockable from the CLI with no UI to see or undo that.

---

## Engineering follow-ups

Ordered by consequence.

### 1. The contract suite pins arguments, not returns

Task C added contract tests comparing every renderer call's arguments against its
handler's declared parameter shape, across 30 channels — the test class that would have
caught all four defects the whole-branch review found. It pins the **argument**
direction to handler source.

The **return** direction is pinned to nothing. `RESPONSES` is a hand-copy with source
comments, so a handler renaming a returned field passes the entire suite. Concretely:
the AWS envelope defect (reading `.status` off `{connections: […]}`) **would still slip
through** — it fails silently rather than crashing.

Unguarded on the return direction: `CREDENTIAL_API_KEY_STATUS`, `AI_GATEWAY_GET_STATS`,
`WPE_DIAGNOSE`, `GET_API_KEY`, `GET_DASHBOARD_STATS`, `GET_JOB_RUN_DATA`.

**Fix:** pin `RESPONSES` to the handler's `return` text the way `signature` is pinned.

### 2. Two channels are registered twice; the later one silently wins

`safeHandle` calls `removeHandler` first, so a second registration shadows the first
with no warning.

- **`INDEX_ALL_FLEET`** — `bulk.ts:126` (takes `{siteIds?}`, returns `{opId}`, local
  running sites) is shadowed by `wpe-sync.ts:353` (takes nothing, returns
  `{indexed, errors}`, WPE content). Two entirely different operations on one channel.
  Latent: no renderer caller today.
- **`WPE_GET_SITE_DETAILS`** — `wpe-sync.ts:196` and again as a bare literal at
  `ipc-handlers.ts:4580`.

The duplicate-registration test added in the fix wave iterates `CONTRACTS` rather than
all registrations, so it **cannot fail today**. Widening it one line to
`allHandlerRegistrations()` catches both. Do this with follow-up 1.

### 3. A refactor dropped three IPC handlers; two are still loose ends

`d69ec3a0` (the `ipc-handlers` decomposition) removed three handlers without their
callers. `CLEANUP_GHOST_INSTALLS` was restored in this branch's fix wave. Remaining:

- **`WPE_CREATE_BACKUP`** — added `4dc174a4`, removed `d69ec3a0`, no handler anywhere.
  Its caller `NexusOverview.handleCreateWPEBackup:1026` is itself dead, so nothing is
  stranded, but the channel is unhandled.
- **`CLEANUP_EXCLUDED_TYPES`** — dead constant, no caller.

A full sweep of renderer-invoked channels against registrations was run and is otherwise
clean.

### 4. `JobRunStore` returns `NaN` on a corrupt entry

`averageMs` guards the bag and the array but not each `Run`'s `ms`, so a stored
`{at: 1, ms: "x"}` yields `NaN` → "took NaN min". **`lastRunAt` has the identical hole**
on `at`, propagating to "next pass in about NaNh" — fixing only `averageMs` leaves half
the defect. Same class as the `null`-never-`0` rule the store was built around.
Corrupt-storage-only. ~4 lines plus tests.

### 5. Orphan residue

Inert — zero runtime cost, `tsc` passes only because `noUnusedLocals` is off.

- **`NexusPreferences`** — ~20 unread state fields and **nine** uncalled methods:
  `loadStoredKey`, `fetchModels`, `notifyChange`, `saveNow`, and five settings-writing
  handlers. **Delete `saveNow` and `notifyChange` first:** `saveNow` posts a whole-object
  settings snapshot, so re-wiring any one of those handlers would restore the clobber
  path this branch just closed.
- **`NexusOverview`** — `handleCreateWPEBackup`, `handleDiag`, and the
  `wpeBackupRunning`/`wpeBackupInstallId` state, left by the Operations retirement.

### 6. A narrower chat-resurrection path survives

`PanelChat:519` falls back to `this.props.sessionId` when `activeSessionId` is null. If
`DockedPanel` holds a stale id after delete-all, a subsequent turn recreates the row.
The primary path is closed (`CHAT_ALL_CLEARED` is emitted and consumed by both
`PanelChat` and `SessionsSidebar` with unmount cleanup); this needs a `DockedPanel`
change. Keep it filed — the copy says "cannot be undone".

### 7. Smaller items

- **`derived`'s `minsLabel`/`nextLabel` null semantics** are pinned by the *component*
  test, not by `derived`'s own suite. Coverage exists, in the weaker place.
- **`index.ts:599-600`** — the non-paused path still uses the clear-and-null guard shape
  the pause gate fixed. Pre-existing, cosmetic.
- **`JobRow.durationMin`** is computed in `derived.ts` and rendered nowhere. Six jobs
  were instrumented and a store written; the per-row duration reaches the UI only as a
  summand inside `minsPerDay`. Either surface it or drop the field.
- **Raw hexes** remain in `PermissionsSection` (~15 status colours) and `SettingsShell`
  (footer). See designer item 2.
- **`localContentIndexIntervalHours = 0`** ("manual only") is permitted by the schema and
  the handler but has no option in the new `<select>`; the `min = 0` branch is
  unreachable from the UI.
- **Interval steppers are eight fixed options** where `COPY.md:107` says "an ordinary
  stepper (1–168h)". Any stored value outside the list — reachable from the old numeric
  inputs — renders a blank dropdown beside a correct cost label.
- **`COPY.md:60`'s `nothing scheduled` note is rendered nowhere.** In the prototype it
  replaces the scope line when a figure is 0. Since `wpeRefreshAutoEnabled` and
  `wpeSyncAutoEnabled` both default false, the out-of-the-box WP Engine column reads
  "0 · connections a day · across 331 installs" with no note.
- **`ipc-job-run-data.test.ts`** now transitively loads the whole main-process module
  graph to reach one handler. Works today; a future import-time side effect anywhere in
  `src/main` will fail it for an unrelated reason.

---

## Not verified in the running app

Everything above is static analysis and unit tests. **The five sections have never been
rendered in Local.** `./dev-reload.sh` and a manual pass over each section — especially
the three destructive resets, the AWS panel, and SSH diagnostics, all of which were
broken until the final fix wave — should happen before this is considered done.
