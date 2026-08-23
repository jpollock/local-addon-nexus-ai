# Incremental indexing — design (backend + frontend)

**Status: DESIGN — nothing here is implemented.** Owner requested 2026-08-23
("scan/index only what's changed since last scan/index"). Supersedes the
phase-5 sketch in `2026-08-23-pipeline-observability.md`; builds on the
pipeline ledger (runs recorded per site × layer × trigger) and assumes the
WP-67/68 outcome contracts throughout.

**Why:** embedding dominates run cost. Measured: `meridian` 13,059 chunks in
7.9 min; the 2026-08-23 fleet sweep's whale windows; a full 413-site sweep is
~4 hours. A quiet fleet's incremental sweep should be minutes, and the ledger
(which now records `duration_ms` per run) is the before/after instrument.

---

## 1. The modes

| mode | meaning | verb mapping |
|---|---|---|
| `full` | read the whole population, embed everything — today's behavior | explicit **Reindex** (drop + rebuild) is ALWAYS full; recovery, migrations, "I don't trust the index" |
| `incremental` | read only posts changed since the watermark; upsert those; reconcile deletions | the default for scheduled runs and (owner Q1) possibly for the Index button |

Threaded exactly like `trigger`: a `mode` param on the chokepoints
(`indexOneWpeContent`, `ContentPipeline.indexSite`,
`ExternalContentIndexService.indexOne`), carried through bulk `options.mode`.
Absent mode = `full` — the current behavior is the safe default until the
owner flips a surface (rollout §7).

## 2. The watermark

**Per site, stored on the IndexRegistry entry** (the L3 bookkeeping store —
coverage already lives there):

```jsonc
"incremental": {
  "watermark": "2026-08-23 21:14:09",   // max post_modified_gmt OBSERVED
  "setByRunAt": 1787525054564,           // local bookkeeping only
  "basis": "full" | "incremental"        // what kind of run established it
}
```

Rules, each of which has already bitten this codebase in another form:

- **Server-side time only.** The watermark is the max `post_modified_gmt` seen
  in the rows actually read — never our clock (skew), never `lastIndexed`
  ("synced-at is not changed-at", the spine's rule).
- **Only a fully-successful run advances it.** A failed page, a truncated
  read (`coverage.complete === false` for reasons other than the deliberate
  cap), or a thrown run leaves the watermark alone — advancing it past unread
  changes is silent data loss with a clean-looking ledger.
- **`reindex`'s drop clears it.** After a drop the store is empty; the next
  run MUST be full regardless of requested mode (the code enforces this, not
  the caller's memory).
- **A missing watermark = full.** First run per site, post-drop, post-reset:
  incremental silently upgrades to full and records `mode: "full"` in the
  ledger — the ledger reports what HAPPENED, not what was asked
  (WP-67's rule applied to modes).

## 3. Change detection per source

### Remote (WPE + external SSH)

```
wp post list --post_type=any --post_status=publish
  --orderby=modified --order=DESC
  --fields=ID,...,post_modified_gmt      ← post_modified_gmt ADDED to the field list
  --posts_per_page=200 --offset=N
```

Page until the first row with `post_modified_gmt < watermark`, then stop.
Rows `== watermark` are RE-READ (idempotent upsert) — the WP-62 lesson
applies: 200+ posts can share one timestamp to the second, and a strict `>`
stop on an unstable tie boundary drops rows. Ties cost a few duplicate
upserts, never a missed change.

Note the sort-stability asymmetry with full mode: full stays `--orderby=ID`
(WP-62's fix — offset paging needs a total order). Incremental pages by
`modified DESC` and is safe from the same defect because it never pages past
the watermark boundary by more than the tie-window, and duplicates are
idempotent.

### Local

`MySQLExtractor` gains an optional `sinceGmt` — one `WHERE post_modified_gmt > ?`
clause on the existing single-query read. Trivial; the local read was never
the cost anyway (embedding is).

### Meta fetch

Custom fields are fetched for the CHANGED set only (same page-batched WXR
mechanism). This preserves the D17 rule — an empty-content post with fields is
content — within the changed population.

## 4. Deletions — the honest hard part

An incremental run cannot see a deleted post. Two candidate mechanisms,
**decided by measurement, not preference** (owner Q3 picks the cadence):

- **A. ID sweep per incremental run:** one `wp post list --field=ID` call
  (WP_Query `fields => 'ids'` is memory-light server-side, but this MUST be
  measured on the 30k-post install before being trusted — the full-object
  query is exactly what OOMs, and WP-CLI's flag plumbing needs verifying).
  Diff against the graph `content` table's post ids for the site; deletions
  cascade to all three stores (§5).
- **B. Scheduled full run** (e.g. weekly) reconciles everything; incremental
  runs simply don't handle deletions. Cheaper per run, staler tombstones —
  a deleted-but-still-searchable post can persist up to the full-run cadence.

Recommendation: A if the measured ID sweep is <10s on qwerky, else B. Either
way the run's ledger payload records `deleted` explicitly (possibly 0), so
"we don't know about deletions" is never silent.

## 5. Store changes required

- **`IVectorStore.deletePosts(siteId, postIds: number[])` — NEW.** `upsert`
  replaces per chunk id, so a changed post that now yields FEWER chunks
  leaves stale tail chunks behind (verified against `SqliteVecStore.upsert`).
  Incremental must delete-then-upsert the changed posts' chunks. `dropSite`
  stays the full-mode/reindex tool.
- **Remote extraction adds `post_modified_gmt`** to its field list and onto
  `ExtractedPost`. The vector docs table already has the column — today it is
  populated by the local path only; after this, both.
- **Graph `content` rows** already carry post ids per site — the deletion
  diff's local side. No schema change.
- **IndexRegistry** gains the `incremental` block (§2). No migration needed —
  entries are JSON.

## 6. Ledger contract — `pipeline.run/2`

Version bump, never mutation (the fold rule):

```jsonc
{
  // everything in pipeline.run/1, plus:
  "mode": "full" | "incremental",
  "changed": 12, "unchanged": 830, "deleted": 3   // incremental only
}
```

`pipelineStatusFold` accepts both schemas; `/1` events remain valid history.
`nexus pipeline status` learns a mode column and, for incremental runs, the
changed/deleted counts — this is what makes the speedup a measurement
("12 changed in 40s") rather than a claim.

## 7. Rollout — three switchable stages, no big bang

- **A (backend, invisible):** all machinery lands with every surface still
  passing `full`. Behavior identical; the only observable change is
  `mode: "full"` appearing in ledger payloads. Full suite + mutation battery
  gate here.
- **B (schedulers):** `OpportunisticScheduler`, the WPE content timer, and
  `ExternalContentIndexScheduler` switch to `incremental` (owner Q2 confirms).
  The e2e harness (pipeline plan phase 2) runs BEFORE this flip — its
  changed/unchanged/deleted assertions are what prove incremental isn't
  quietly skipping content.
- **C (UI):** the Index button and panel copy (§9), last, after B has a week
  of ledger history to point at.

## 8. Known blind spot — meta-only edits (decision required, owner Q4)

WordPress does not timestamp postmeta. An edit through the post editor bumps
`post_modified` (ACF field groups save with the post — covered). A
**programmatic** `update_field()` / direct meta write does NOT bump it —
invisible to the watermark, and postmeta has no timestamp to watermark on.
This is exactly the D17 content class, so it must be a stated decision:

- **Recommended: accept + bound it.** Incremental misses programmatic
  meta-only edits until the next full run; the scheduled full cadence (Q3)
  bounds the staleness, and the limitation is documented in the tool
  descriptions and this file. Cheap, honest.
- Rejected-for-now alternatives: per-post content hashing (a full read to
  compute — defeats the purpose); an mu-plugin write-hook feeding the event
  spine (the RIGHT long-term answer for local sites — the webhook already
  exists — but remote sites have no such channel without shipping code to
  production installs, which Nexus deliberately never does for external and
  currently doesn't for WPE).

## 9. Frontend

Surfaces, smallest honest set:

- **Sites tab bulk bar:** "Index content" runs the default mode (Q1). If Q1 =
  incremental-by-default, the button gains a small "Full" affordance
  (dropdown or modifier), not a second button. "Reindex" (site page) stays
  always-full and labeled so.
- **Operations panel row copy:** an incremental success reads
  **"12 changed, 830 unchanged"** — NOT "842 succeeded". A run that scanned
  and found nothing reads "No changes since &lt;watermark age&gt;" as an OK,
  not a skip — scanning-and-finding-nothing is successful work (distinct
  from WP-67's did-not-run).
- **Summary line:** unchanged totals fold into the ok count; the per-op
  header gains "(incremental)" when applicable.
- **Settings:** one new pair — scheduled-run mode (default incremental once
  B lands) and full-run cadence (default weekly, serving §4B/§8). Both must
  go in `UpdateSettingsSchema` (the documented strict-mode trap).

## 10. Testing shape (the vacuous-guard list, written before the code)

Every positive has its counterpart in the same suite:

1. Changed post → picked up; **unchanged site → zero extraction reads beyond
   the boundary page, zero embeddings** (the perf claim, asserted).
2. Tie at the watermark → re-read, not dropped (the WP-62 tie case, on
   modified instead of ID).
3. Failed page → watermark NOT advanced; next run re-covers the gap.
4. Post shrinks from 5 chunks to 2 → 2 remain after incremental (pins
   `deletePosts`; upsert alone passes with 5).
5. Deleted post → gone from vec store, graph content, and counted in
   `deleted` (mechanism A) or documented-absent (B).
6. Missing watermark / post-drop → silently full, ledger says `full`.
7. D17 within incremental: changed empty-content post with meta → indexed.
8. Mutation battery: watermark advance on failure, `>` vs `>=` at the tie,
   deletePosts removed, mode not threaded (scheduler runs full forever —
   the D9-style silent-default failure).

## Owner questions (blocking B/C, not A)

- **Q1:** "Index content" button default — incremental (with Full affordance)
  or full?
- **Q2:** confirm schedulers flip to incremental after the harness passes.
- **Q3:** full-run cadence for reconciliation/meta-staleness — weekly?
- **Q4:** accept the programmatic-meta-edit blind spot as bounded-by-Q3, or
  hold incremental until a better mechanism exists?
