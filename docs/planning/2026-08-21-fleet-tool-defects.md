# Fleet tool defects — found while validating an 8-site demo fleet

**Found:** 2026-08-21, on `poc/nexintelligence-ux`
**How:** attempting to answer real questions about a fleet of 8 seeded sites
(3 Local, 3 WP Engine, 3 external SSH) using the fleet MCP tools.

Every claim below is either a code location or a reproduction. Where I could not
determine the cause, it says so.

---

## The pattern

Fleet tools disagree about **two** things, and most of the defects below are
symptoms of one or the other.

**1. How a site is resolved.** At least four paths are in use:

| Resolver | Covers | Used by |
|---|---|---|
| `resolveSite` | Local only | `reindex_site`, `get_index_status` (first pass) |
| `resolveRemoteGraphSite` | graph — WPE + external | `get_index_status` (fallback) |
| `resolveAnySite` | Local + graph | `compare_sites` |
| (unknown) | apparently Local only | `get_site_structure` |

So the same site identifier succeeds in one tool and returns "not found" in
another, with no way for a caller to predict which.

**2. Which store holds the data.** Three, populated by different mechanisms:

| Store | Populated by | Read by |
|---|---|---|
| graph `sites` / `content` | WPE sync, `nexus host refresh`, `nexus host index` | `fleet_sql`, `find_outdated_sites` |
| `IndexRegistry` `entry.structure` | the site-structure path only | `compare_sites` |
| vector index (docs/chunks) | `reindex_site`, `nexus host index`, WPE content sync | `get_index_status`, `search_across_sites` |

A tool that needs store B fails on a site that has A and C — and reports it in
language that names the wrong store.

---

## D1 — `find_outdated_sites` ignores any source filter that is not `wpe`

**`src/main/mcp/modules/fleet/find-outdated-sites.ts:87`**

```ts
if (sourceFilter !== 'wpe') {   // ← merges ALL local sites
```

Line 74 builds the graph query correctly (`WHERE source = ?`). Line 87 then
undoes it for every filter except `wpe`.

**Reproduce:** `find_outdated_sites(component: 'wordpress', source: 'external')`
→ "325 sites in scope", almost all labelled `[local]`. There are 3 external
sites.

The guard was written when `source` had two values. Line 143 has the same
assumption — `sourceLabel` only special-cases `wpe` and `local`, so an
`external` run prints no scope label at all.

**Likely fix:** `if (sourceFilter === 'local' || sourceFilter === 'all')`, and
extend `sourceLabel`.

---

## D2 — `compare_sites` reports "no index data" when it means "no structure data"

**`src/main/mcp/modules/fleet/compare-sites.ts:71,74`**

```ts
if (!entryA?.structure) return error(`Site "${siteA.name}" has no index data.`);
```

The check is on `entry.structure`. The message says "index data", which sends
the reader to the content index — where `get_index_status` will cheerfully
report the site *is* indexed.

**Reproduce:**
```
get_index_status cedarvalehealt   → indexed, 200 documents, 200 chunks
compare_sites cedarvalehealt …    → Site "cedarvalehealt" has no index data.
```

Not a contradiction — two different fields — but the wording cost about an hour
of chasing the wrong store. Worth fixing on its own even if D3 is fixed.

---

## D3 — `compare_sites` appears unusable for any non-Local site

`entry.structure` is initialised `null` at **`src/main/content/IndexRegistry.ts:53`**
and is only written by the site-structure path. For WPE and external sites I
could not find any route that populates it:

- `nexus host refresh` / `nexus host index` populate the graph and the vector
  index, not `structure`
- `get_site_structure` is the only writer, and see D4/D5

**Reproduce:** `piedmontdermgroup` — freshly registered, refreshed, and indexed
today (102 docs, full CPT coverage) — still returns
`Site "piedmontdermgroup" has no index data.`

If that is right, `compare_sites` works only for Local sites, which is not what
its description says ("For local-vs-WPE drift detection, use `wpe_detect_drift`
instead" implies cross-source comparison is otherwise supported).

---

## D4 — `get_site_structure` cannot resolve an external site

**Reproduce:** `get_site_structure(site: 'piedmontdermgroup')` → `Site "piedmontdermgroup" not found`

The same identifier resolves fine in `get_index_status`, which falls back to
`resolveRemoteGraphSite`. `get_site_structure` evidently does not.

This matters more than a normal resolution bug because `get_site_structure` is
the only writer of `entry.structure` (D3) — so an external site can never
become comparable.

---

## D5 — `wpe_sync_sites` does not exist, and 8 messages tell users to run it

Referenced in at least 5 files, 8 mentions, always as the remedy:

- `src/main/mcp/modules/content/search-content.ts:43` — *"WPE install content is indexed by wpe_sync_sites — run that first if results are missing."*
- `src/main/mcp/modules/wpe/helpers.ts:42` — *"Run `wpe_sync_sites` or wait for the next auto-sync"*
- `src/main/mcp/modules/wpe/fleet-versions.ts:75,76`
- `src/main/mcp/modules/wpe/detect-drift.ts:54,78`

There is no tool registration for that name anywhere in `src/`.

The capability exists and is public:

- `WPESyncService.indexOneWpeContent(siteId, installName)` — **line 663**
- `WPESyncService.indexAllWpeContent()` — **line 604**

Line 656's comment says the single-install wrapper exists *precisely because*
`syncContent` is private and `indexAllWpeContent` is fleet-wide — i.e. it was
written to be called from somewhere. Neither is exposed as an MCP tool or a CLI
command.

**Consequence:** when a WPE install's content index is stale, the product tells
the user eight different ways to run a fix that was never wired up, and there is
no other manual path. `reindex_site` is local-only by construction — it uses
`MySQLExtractor` against a Local database — so that is design, not a bug.

**Likely fix:** register `wpe_sync_sites` (or rename the guidance to match
whatever it should be) wrapping `indexOneWpeContent` / `indexAllWpeContent`.

---

## D6 — `get_site_structure` against a WPE install returned nothing in 20 minutes

**Reproduce:** `get_site_structure(site: 'cedarvalehealt')` — no result after
20 minutes; killed.

**Cause undetermined.** Two candidates and I could not separate them:

- a genuine hang
- contention: the WPE SSH transport uses `ControlMaster=auto` with a shared
  `ControlPath=/tmp/ssh-nexus-%C` and `ControlPersist=600s`, and a WPE refresh
  sweep was holding connections to other installs at the time

Nothing referencing `structure` or `cedarvalehealt` appeared in
`nexus-2026-08-21.log` during the attempt, which is itself worth noting — a
20-minute operation logged nothing.

---

## O1 — Observation: the WPE content index is partial in a specific, telling way

Not filed as a defect because the cause is plausible and local to this fixture,
but the shape may generalise.

`cedarvalehealt` holds 840 content items. Its index holds 200:

```
post             170
insurance_plan    30
location           0
provider           0
treatment          0
condition          0
```

The four missing types are custom post types registered by a plugin. The index
ran 2026-08-14; that plugin was a **dangling symlink** on the server until
2026-08-21, so its CPTs were not registered at index time.

**The question for someone who knows the indexer:** if a CPT is unregistered at
index time its posts are skipped — fine — but `insurance_plan` (also a plugin
CPT) came through at full count. That asymmetry is unexplained and suggests the
type-discovery path is not what I assume.

By contrast the three external sites, indexed today with the plugin active, have
complete coverage (e.g. `piedmontdermgroup`: 35 post, 30 provider, 16 condition,
10 treatment, 6 insurance_plan, 4 location, 1 page).

---

## Priority, from where I sit

1. **D5** — users are actively directed to a tool that does not exist, for a
   problem with no other manual remedy.
2. **D3 + D4** — together they appear to make `compare_sites` Local-only, which
   is a large functional gap in a fleet product.
3. **D1** — silently wrong output; an `external` query returns 300+ local sites.
4. **D2** — cheap fix, high time-cost when wrong.
5. **D6** — needs someone who can tell a hang from SSH contention.

---

## What I was doing, for context

Validating a purpose-built 8-site demo fleet with planted, documented defects
(`docs/planning/2026-08-11-cedar-vale-fleet-m2.md`, Task 9). The goal was to
confirm each planted defect is discoverable through a real Nexus tool. Three of
seven are; the rest are blocked on the above rather than on the fixture — the
data is present and verified on the sites themselves.

---

## D7 — Remote content extraction is hard-capped at 200 posts, silently

**Added 2026-08-22, after D1–D5 were fixed.** This supersedes O1 below, whose
hypothesis was wrong.

**`src/main/content/RemoteContentExtractor.ts:44-56`**

```ts
const result = await transport.runWpCli([
  'post', 'list',
  '--post_type=any',
  '--post_status=publish',
  '--fields=…',
  '--posts_per_page=200',      // ← hard cap
  '--format=json',
], { skipPlugins: false, skipThemes: false });
```

One call. No pagination, no `--offset` loop, no second page, and **no warning
when the result is truncated**. The method's doc comment says "Extract all
published content from a remote site in a single SSH call" — it cannot; it
extracts at most 200.

The log line reinforces the illusion: `${rawPosts.length} total → ${filtered.length} indexable`.
`rawPosts.length` is already capped at 200, so a truncated index reports as a
complete one.

**Measured across the live fleet:**

| site | source | published posts | indexed |
|---|---|---|---|
| `rtstgaitoolkit` | wpe | 1,716 | 163 |
| `cedarvalehealt` | wpe | 600 | **200** |
| `testmigratejpp` | wpe | 588 | **200** |
| `poc4doble` | wpe | 544 | 185 |
| `meridian` | **local** | 995 | **994** |

Two installs sit exactly on the cap. The local extractor indexed 994 of 995, so
this is specific to the remote path, not to indexing generally.

**Correction, 2026-08-22.** An earlier version of this table led with
`qwerky — 30,628 published / 2 indexed`. That was wrong and I should not have
used it. Before the fix `qwerky` was reading 200 rows, not 2; after the fix it
reads up to 5,000 and *still* indexes 2, because its other posts carry no
extractable text and are dropped by a content filter that predates all of this.
I took a striking number and filed it under the cap's heading without tracing
what produced it — in a document whose only value is that every claim is
verified. The cap was real; that row was never evidence for it.

**Impact.** Semantic search, `search_across_sites` and anything reading the
content index is silently incomplete for any WP Engine install with more than
200 published posts. There is no signal to the user that the index is partial —
`get_index_status` reports the truncated count as the document total.

**This also corrects O1.** The four missing CPTs on `cedarvalehealt` were not
missing because they were unregistered at index time. I re-ran
`wpe_sync_sites --content` with the seeder plugin active and the CPTs
registered, and the breakdown was unchanged at 170 `post` + 30 `insurance_plan`.
They fall outside the first 200 rows the extractor requests. `insurance_plan`
survived because of row ordering, not because of a type-discovery quirk.

**Fix shape.** Paginate with `--offset` until a short page returns, or raise the
cap and emit an explicit truncation warning when it is hit. Whichever is chosen,
**the truncation must be visible** — a partial index that reports as complete is
worse than a slow one, because every downstream answer is confidently wrong.

Note the external-host extractor was not audited for the same pattern. The three
external sites in this fleet hold 85, 102 and 101 documents — all under 200, so
they are complete by luck rather than by demonstration.

---

## D8 — `keyword` and `hybrid` search are broken for any site whose id contains a hyphen

**Found 2026-08-22, after WP-62.** Blocks the structured-filter capability that
`describe_site_fields` advertises.

**`src/main/vector-store/SqliteVecStore.ts`, `searchBM25`:**

```ts
// NOTE: FTS5 virtual tables use unquoted table names in MATCH clause.
const ftsTableName = `${p}_fts`;
this.conn.prepare(
  `SELECT rowid, rank FROM ${ftsTableName} WHERE ${ftsTableName} MATCH ? ORDER BY rank LIMIT ${ftsLimit}`
)
```

The table is **created** quoted in `ensureTables` — `"${p}_fts"` — and
**queried** unquoted here. Any hyphen in the site id therefore breaks the read
while the write succeeds.

Two symptoms, one cause:

| site | id | error |
|---|---|---|
| `cedarvale` (local) | `oXhu--v0j` | `no such table: site_oXhu` — SQLite reads `--` as a line comment and truncates |
| `cedarvalehealt` (wpe) | UUID `99ef6161-13f1-…` | `near "-": syntax error` — single hyphen in a bare identifier |

**Reproduce:**
```
search_site_content(site:'cedarvale', query:'dermatology provider',
                    postType:'provider', searchMode:'keyword')
→ Tool error: no such table: site_oXhu

same call with searchMode:'hybrid'   → same failure
same call with no searchMode         → works (semantic path, correctly quoted)
```

**The comment's premise is wrong.** FTS5 accepts a quoted identifier in a
`MATCH` clause. What it cannot take is a *bound parameter* for a table name —
someone hit that and reached for the wrong remedy. `validateSiteId`
(`/^[a-zA-Z0-9_-]+$/`) deliberately permits hyphens, so validation will not
catch it either.

**Blast radius.** Every WP Engine install (ids are UUIDs) and every Local site
whose generated id contains a hyphen. `keyword` and `hybrid` both fail, and
because `metadataFilters` requires `hybrid`, the entire structured-filter path
is unreachable — including every example `describe_site_fields` prints in its
own closing instruction.

**Fix:** quote the identifier as `ensureTables` already does. `ftsLimit` is
interpolated too; it is `Math.floor`ed so it is not injectable today, but it
should be bound.

---

## Task 9 results — what the fixes unblocked

With WP-62 built and the fleet re-indexed (`cedarvalehealt` 842/842 including
all six content types), the structured pathologies became findable:

- **CV-C-01** — `find_outdated_sites(source:'external')` → `6.9.7 (1 site) — willowcreekderm [external]`, correctly scoped. Found.
- **CV-A-01** — `describe_site_fields` on the flagship lists `hours: number 7–7 (25/25)` under `location`; on `summitdermatol` the `hours` field is **absent from the schema entirely**. A stronger signal than designed for: the gap shows structurally, without inspecting a record.
- **CV-B-01** — `search_across_sites` for the ghost returns Elian Mills, PA-C on `cedarvalehealt` (Phoenix) and `ridgelineskini` (Boulder). The cross-site contradiction is discoverable. Custom fields now return in results (`npi`, `review_date`, `review_status`), so the exact NPI is retrievable per-record.
- **CV-D-01, CV-G-01** — blocked on D8. Both need `metadataFilters` (address/phone comparison; `review_date` range), which requires `hybrid`.

**Observation:** array-valued custom fields are returned as raw PHP
serialization — `specialties: a:2:{i:0;s:19:"medical dermatology";…}`,
`locations: a:1:{i:0;s:2:"11";}`. Consumable by a model, but not by an exact-match
assertion, and `locations` surfaces post IDs rather than slugs.

---

## D9 — every Local site fails to content-index when the site is not running

**Found 2026-08-22, while fixing WP-67.** Filed separately because WP-67's
scope is the *reporting* contract; this is the underlying failure it was
concealing.

**Measured.** In the 2026-08-22 18:49 UTC bulk `Index content` run over 413
sites, 45 IndexRegistry entries were stamped `state: 'error'` — every Local
site in the fleet, none excepted — with a single distinct error text:

```
$ node -e "…nexus-ai_index_registry.json, entries stamped 18:49:00–18:50:30Z…"
entries total: 636 | stamped in window: 48
by state: { error: 45, indexed: 3 }
error texts: { 'MySQL not available — site may not be running': 45 }
```

The 3 `indexed` are the external SSH hosts (`willowcreekderm` 85 docs,
`piedmontdermgroup` 102, `tablemesaderm` 101). No Local site produced a
document.

**Mechanism.** `ContentPipeline.indexSite` gates DB extraction on
`mysqlExtractor.isAvailable(info)` (`src/main/content/ContentPipeline.ts:116`).
A halted Local site has no MySQL, so it pushes
`'MySQL not available — site may not be running'`, extracts zero posts, and
records `state: 'error'`.

`BulkOperationManager` already has the remedy and did not use it:
`executeSingle` auto-starts a halted Local site when
`op.options.autoStartStop === true`, waits for the DB via
`waitForDatabaseReady`, and stops it afterwards. The Operations-tab dispatcher
sends `options: {}` (`NexusOverview.tsx:1013`), so `autoStartStop` is
`undefined` and no site is ever started.

**Open question — this is a product decision, not only a bug.** Starting 45
Local sites serially to index them is minutes of work and real disruption. The
options are: (a) default `autoStartStop` on for `reindex`, (b) offer it as a
checkbox on the bulk bar, or (c) report the halted sites as *did not run —
site is not running* and index only what is up. **(c) is now available and is
what WP-67 shipped the machinery for**, but WP-67 deliberately did not change
which sites are eligible: it classifies a `state: 'error'` result as `failed`,
because that is what the pipeline recorded. Making "halted" a *skip* rather
than a *failure* means teaching `executeReindex` to distinguish that one error
text, which is a behaviour change this packet had no mandate for.

---

## D10 — the WP Engine content index sent the graph id as the install name, so all 365 SSH calls failed instantly

> **CORRECTED 2026-08-22, during WP-68.** This entry originally blamed the
> *bulk* path (`op.siteNames?.[siteId] ?? siteId`). That attribution is wrong.
> The 18:49 run was `indexAllWpeContent` — the FLEET path — which resolves the
> name from the graph and never touches `op.siteNames`. Proof: the log holds
> 365 extraction starts in the graph's exact natural `SELECT` order (20/20 on
> the first 20 ids) dispatched two at a time, matching that method's
> `concurrency = 2`, not `BulkOperationManager`'s `MAX_CONCURRENCY = 5` over a
> renderer-ordered selection.
>
> So the bad name came out of the graph's own `name` column, not out of the UI.
> Corroborating: all 365 rows carry `updated_at = 2026-08-22T20:39Z` — a CAPI
> sync that ran AFTER the incident — while `created_at` spans 13–22 Aug. Every
> row's name was (re)written after the failed run, and the fleet-wide table
> the packet reasoned from was read after that repair.
>
> **The consequence for the fix is material:** "resolve the name from the graph
> at the point of use" would NOT have prevented this, because that is exactly
> what the failing code did. The name resolved from the graph must also be
> *validated* — see `requireWpeInstallName`, which refuses an empty name and
> one equal to the site id or the bare install UUID. The `?? siteId` fallback
> was a second, independent instance of the same mistake and is also gone.
>
> **Still unexplained: what wrote the id into `sites.name`.** Ruled out by
> inspection — no `UPDATE sites SET name`, anywhere; `syncInstall` takes the
> name from CAPI; `syncContent`'s piggyback can only write a bad name on the
> success path, which a zero-post run never reaches; `buildSiteNames` never
> writes to the graph at all. 307 IndexRegistry entries written 14 Aug all
> carry real install names, so the column was correct then. No artifact
> surviving today records the value between 14 and 22 Aug.


**Found 2026-08-22, while answering WP-67's open question.** This is the
underlying cause of the 365 no-op installs; WP-67 fixed only the reporting.

**Measured.** All 365 active `wpe` installs took `syncContent`'s zero-posts
exit, inside a single UTC minute:

```
$ grep -h "No content to index for" ~/Library/Logs/local-lightning*.log \
    | grep -o '"timestamp":"[0-9T:-]*' | cut -c1-16 | sort | uniq -c
 365 2026-08-22T18:49

$ grep -h "Extraction complete. Posts found" … | grep -o 'Posts found: [0-9]*' | sort | uniq -c
 365 Posts found: 0
   1 Posts found: 104     ← the three external hosts
   1 Posts found: 116
   1 Posts found: 200
   1 Posts found: 842
```

**The span is 3.8 seconds** — `18:49:34.813Z` to `18:49:38.628Z`, ~96 installs
per second. A WP Engine SSH round trip is 13–30s cold. Nothing reached WP
Engine.

**Cause.** The extractor logs its `siteLabel`, which is the `installName`
argument `syncContent` passes to `RemoteContentExtractor.extract` and to
`new WpeSshTransport(installName)`. Every one of the 365 lines names a **graph
id**, not an install name:

```
[RemoteContentExtractor] No posts returned for wpe-fe84d49f-c1c7-4dbf-9a9e-7511ffbd727e
```

That row's real name is `bpheadlessb667` (and `wpe-fc902466-…` is
`andonovwoocdev`). All 365 active `wpe` rows have a non-empty `name` — measured,
zero NULL — so the graph is not the source of the id. The bulk path is:

```ts
// BulkOperationManager.executeRemote
const siteName = op.siteNames?.[siteId] ?? siteId;   // ← the fallback
return ops.indexOne(siteId, siteName);
```

`siteNames` had no entry for these ids, so **the fallback handed the graph id
to `WpeSshTransport` as an install name**. SSH to a nonexistent install fails in
milliseconds, which is exactly the observed rate.

**ANSWERED 2026-08-22 (see D13): `siteNames` never reached the manager at
all.** It was absent from `BulkOperationRequestSchema`, and Zod strips unknown
keys, so `validateInput` deleted it on every `BULK_EXECUTE`. The renderer built
the map correctly the whole time. That means the `?? siteId` fallback was not
*occasionally* empty — it fired for **100% of remote sites on every Sites-tab
dispatch**. (It is not the cause of the 18:49 incident, which came through
`indexAllWpeContent` and the graph's own `name` column; these are two
independent instances of the same mistake.)

**Original note, kept for the record:** why `siteNames` was empty. The only `BULK_EXECUTE`
dispatcher (`NexusOverview.tsx:1005`) builds it from `this.state.siteRows`, and
`buildSiteRows` applies no cap and carries `name: g.name ?? g.id` for every
`wpe` row — so on the evidence it *should* have been populated. Establishing
whether `siteRows` was unloaded, or the selection came from a different id
space, needs a live reproduction rather than more log reading.

**Two things to fix, and they are independent:**

1. **The fallback is unsafe and should be removed.** `siteId` is not a legal
   substitute for an install name — it is a value guaranteed to fail. Failing
   with "no display name for `<id>`" is honest; silently SSHing to a nonexistent
   host is not. Note WP-67 makes this louder rather than fixing it: the run is
   now reported as *did not run*, with a reason, instead of "Success".
2. **`RemoteContentExtractor` discards the failure reason.** At
   `src/main/content/RemoteContentExtractor.ts:224` the guard is
   `if (!result.success || !result.stdout)` and the log says only
   `No posts returned for <label>`. A failed WP-CLI call and a genuinely empty
   site are collapsed into one message, and `result.stdout` — which holds the
   SSH error — is thrown away. This is the same class of defect as WP-67, one
   layer deeper: had it logged the failure, the 365 would have been diagnosable
   from the log alone rather than from a timing argument.

---

## D11 — a WP Engine metadata sync writes the site row, then fails on `users.username`

**Found 2026-08-22, in the WP-68 exhibit.** Pre-existing; unrelated to WP-68's
change, and now visible because the outcome is reported honestly.

```
$ wpe_sync_sites { install_name: "acfsupport" }
Metadata sync failed for "acfsupport": NOT NULL constraint failed: users.username
[wall-clock: 56.7s]

before last_sync_at: 2026-08-22 18:08:30
after  last_sync_at: 2026-08-22 21:22:05     ← the site row WAS written
```

`syncInstall` upserts the site row, then plugins, then users. A user row with a
NULL `username` aborts the whole call, so the operation reports failure after
having already committed the site and plugin writes. It is a partial write
reported as a total failure — the mirror image of WP-67's total success
reported over partial work.

Also seen in the wild before this: four occurrences in
`~/Library/Logs/local-lightning*.log` reading
`[WPESyncService] Failed to re-sync <uuid>: NOT NULL constraint failed: users.username`,
at `GraphService.upsertUser` (`src/main/events/GraphService.ts:845`).

**Two things to decide, and they are separate:** whether a WP Engine user with
no username is legal (if so, `upsertUser` should skip or synthesise, not
reject), and whether `syncInstall` should be transactional or should report
per-section outcomes the way the content path now does.

---

## D12 — FIXED 2026-08-22 — "reached but nothing to index" did not say what was actually found

> **FIXED.** A failed read is now reported as a FAILURE carrying the transport's
> own reason, and a genuinely empty site as a skip carrying the row count.
> Verified live:
>
> ```
> jpmeautoscale -> Content indexing failed for "jpmeautoscale": Could not read
>                  content from jpmeautoscale: the first page failed: Command
>                  exited with code 255 — output: ssh: Could not resolve
>                  hostname jpmeautoscale.ssh.wpengine.net
> acfsupport    -> was reached but nothing was indexed — 6 post(s) read, none
>                  with indexable content
> ```
>
> **This was worse than originally filed.** On the 2026-08-22 413-site run, 106
> installs reported "Did not run — No content returned by the extractor". Six
> sampled installs held **215, 50, 44, 6, 2 and 2** published posts, were
> reachable over SSH minutes later, and all six succeeded in a parallel probe;
> `acflikebutton` then re-indexed through the addon in 17.4s. The sites were not
> empty — the reads failed, and the message asserted the opposite.
>
> `coverage.truncatedReason === "page-failed"` already recorded the difference
> and `coverage.truncatedDetail` already held the transport's message from
> `describeRemoteFailure`. Neither was logged and neither was read at the
> decision point, so the evidence was generated and discarded on every failure.

### Original entry


**Found 2026-08-22, in the WP-68 exhibit.** The narrower survivor of D10's
second defect.

WP-68 made *reached-with-nothing* distinguishable from *never reached*: the
first is now a `skipped` outcome and the second throws and is reported as
`failed`. That was the blocking part, and it is fixed. What remains is the
reason string's precision:

```
$ wpe_sync_sites { install_name: "acfsupport", content: true }
**acfsupport** was reached but nothing was indexed — No content returned by
the extractor. No content rows were written.
[wall-clock: 29.4s]
```

The log says something more useful, and only the log says it:

```
[RemoteContentExtractor] acfsupport: 6 rows read over 1 page(s) → 6 indexable (page:6)
[RemoteContentExtractor] Extracted 0 posts with content from acfsupport
```

Six pages were read; all had empty content. "No content returned by the
extractor" implies zero rows came back, which is not what happened. The
extractor already has both numbers — rows read and posts with content — and
`ExtractedContent` could carry them into the outcome's reason so the tool can
say "6 posts read, none with indexable content" instead.


---

## D13 — `siteNames` was stripped by its own validation schema on every bulk dispatch

**Found 2026-08-22, from a screenshot of pending rows reading `wpe-3055da28-…`
instead of install names.** This is the answer to D10's open residual.

`BulkOperationRequestSchema` (`src/common/schemas.ts:409`) declared `type`,
`siteIds` and `options`. It did **not** declare `siteNames`. Zod objects strip
unknown keys by default rather than rejecting them, so
`validateInput(BulkOperationRequestSchema, request)` silently deleted the map
before `bulkOpManager.execute` ever saw it, and `execute()` stored `{}`.

Measured against the installed Zod (3.25.76):

```
in : {"type":"reindex","siteIds":["wpe-abc"],"siteNames":{"wpe-abc":"cedarvalehealt"},"options":{...}}
out: {"type":"reindex","siteIds":["wpe-abc"],"options":{...}}
siteNames survived? false
```

**The symptom names the cause.** `BulkOperationsPanel` renders a row as
`op.siteNames?.[siteId] ?? this.props.siteNames?.get(siteId) ?? siteId`, and
that second map is built from `this.state.sites` — **Local sites only**. With
`op.siteNames` empty, Local rows still resolved through the fallback and every
WP Engine and external row fell through to the raw graph id. Local names
present, remote ids raw, in the same list, is exactly that fallback chain.

**Same trap as `UpdateSettingsSchema`**, already documented in this repo: a
field absent from a schema is not a validation error, it is a silent deletion.
The existing guard (`tests/unit/common/schemas-settings.test.ts`) is
field-by-field, so it only catches fields someone remembered to test.
`tests/unit/schemas.test.ts` now carries a structural one for this request
type: a `Required<BulkOperationRequest>` fixture makes adding an interface
field a compile error until it is listed, and the round-trip assertion then
fails until the schema accepts it.


---

## D14 — FIXED 2026-08-23 — the fleet sweep exhausted WP Engine's 5-connection limit with sockets it never reused

**Found by D12's own fix**, on the first degraded run after it shipped. The log
named the cause where two previous investigations could only infer it.

WP Engine allows **five concurrent SSH connections per user, account-wide** —
not per install. The server says so verbatim:

```
The concurrent connection limit of 5 connections per user has been reached.
If you are using ControlPersist, check your ControlPath and delete any
persisting connections that are no longer needed.
```

Two settings collide with that:

| setting | value | effect on a sweep |
|---|---|---|
| `BulkOperationManager.MAX_CONCURRENCY` | 5 | exactly the cap, zero headroom |
| `SSH_CONTROL_PERSIST` | 10 minutes | each install's master stays open long after its command |

A sweep visits every install **once**, so at ~20s per site × 5 workers it opens
12–20 masters inside every persist window and reuses none of them. **Measured:
82 live sockets against a limit of 5.** Past that point every remaining install
is refused at authentication in under 100ms — which is why both runs were clean
for ~10 minutes and then collapsed, and why individual re-runs always succeeded.

The 2026-08-22 run and the 2026-08-23 run show the same curve:

| minute | OK | FAIL |
|---|---|---|
| 01:05–01:11 | 17 | 0 |
| 01:12–01:14 | 20 | 5 |
| 01:15–01:20 | 44 | 65 |

**Fix.** `WpeSshTransport.closeMaster()` runs `ssh -O exit` against the same
ControlPath, and `syncContent` calls it in a `finally` so the connection is
returned on success, skip and failure alike — a run that leaks one per failure
burns the quota fastest exactly when it is already going wrong. `ControlPersist`
is unchanged: it earns its keep for an agent hitting one install on a short
cadence, which is the case it was introduced for. Only the one-pass caller now
hands its connection back.

Verified live: eight installs indexed back-to-back, held sockets **flat at 1**
(that one belonging to a manual diagnostic, not the addon) and zero ssh
processes; `ssh -O check` reports no socket for any install the addon touched.
All eight were installs that had failed in the run.

**Also fixed here:** OpenSSH's post-quantum advisory — three lines, ~230
characters, printed on EVERY WP Engine connection before the real error — was
consuming the whole 200-character reason budget, so the logged line read
`... output: ** WARNING: connection is not using a post-quantum key exchange
algorithm. ** This session may be vulnerable to ... ** The server m`. The
actual cause had to be recovered by hand. `oneLine` now drops the advisory,
matched on its own wording rather than its `**` prefix so a genuine message
starting with `**` survives. This reverses a deliberate earlier decision to
keep the banner "as context"; context that is always present carries no
information and displaces context that does.

---

## D15 — HANDLED 2026-08-23 — 73 installs on one WP Engine account have no SSH endpoint

> **Identified and handled the same day.** The account is `esm5z2bl7u8vqk`
> ("AutoscaleAlpha") — an Autoscale alpha testing account, and the Autoscale
> platform evidently does not provision the classic per-install SSH gateway.
> The open product question (does Autoscale have or plan any WP-CLI access
> path?) sits with the owner; nothing addon-side can answer it.
>
> **The stated-absence handling shipped** (`wpeGatewayStatus.ts`): one DNS
> probe per account during the CAPI sync, verdict cached on `wpe_accounts`
> with a 24h recheck; only a definitive NXDOMAIN/ENODATA marks an account
> unavailable (a resolver hiccup changes nothing), and a gateway provisioned
> later is noticed within a day. Consumers: `indexOneWpeContent` returns a
> skip naming the account ("no SSH gateway on account \"AutoscaleAlpha\"…"),
> so the panel shows *did not run* with the reason and the pipeline ledger
> records `skip`; `WpeRefreshScheduler` excludes the installs with ONE log
> line naming the account instead of 73 attempts. Unknown status never
> suppresses work — a fresh install always gets its first try. Mutation
> battery 6/6.

### Original entry


**Found 2026-08-23. Corrects an assumption I stated as fact the same evening.**

73 of 365 active `wpe` rows return **NXDOMAIN** for
`<name>.ssh.wpengine.net`, verified twice including against an external
resolver. I assumed they were installs deleted at WP Engine whose graph rows
were never retired, and built `reconcileMissingInstalls` on that basis.

**That assumption was wrong, and the reconciliation itself disproved it.** On
its first live run it deactivated **zero**, because CAPI still lists all 365.
`jpmeautoscale` is a live production install on PHP 8.5, synced today — it
simply has no SSH host.

The real pattern is exact:

| account | installs | resolve? |
|---|---|---|
| `1706440b-b146-4b97-a5f6-134bbaf6f1a4` | **73** | none |
| all other accounts | 292 | yes |

Every one of the 73 belongs to that single account, and that account has
exactly 73 installs. Not one of them resolves. Corroborated independently: 290
of 365 rows carry a `wp_version` (i.e. SSH worked at least once), and
365 − 290 = 75 ≈ the same set.

So this is a WP Engine **provisioning or entitlement** fact about one account,
not a Nexus defect and not stale data. Nothing in the addon can fix it.

**What should change is that it is rediscovered as ~73 failures on every
sweep.** The honest handling is to establish it once and report it as a stated
absence rather than a per-run error — the same ruling already applied to
copy: an absence stated with its reason ships, a blank does not. Candidate
approaches, none implemented:

- probe SSH reachability per account once and record it, then report those
  installs as *not SSH-reachable* rather than attempting and failing;
- or surface it as a single fleet-level line ("73 installs on account X have
  no SSH endpoint — content indexing is unavailable for them").

**Do not extend `reconcileMissingInstalls` to cover them.** A missing DNS
record is not a missing install, and retiring a live install because we cannot
reach it would delete real fleet from the user's view. CAPI membership is the
only signal that method uses, deliberately.

**Still unknown:** why that account has no SSH endpoints — plan level, a
provisioning state, or an entitlement on this user's access. That is a question
for WP Engine, not something determinable from here.

---

## D16 — a bulk sweep double-indexes every halted local site it starts

**Found 2026-08-23 by the pipeline ledger, on its first day.** During the
413-site sweep, the ledger recorded **35 local sites with BOTH an `adhoc` L3
run and a `lifecycle` L3 run** (37 adhoc + 42 lifecycle in the sweep window).

Mechanism: the bulk worker auto-starts a halted site (the owner's D9 ruling),
which fires the `siteStarted` lifecycle hook — whose auto-index then runs a
full L2 scan + L3 index of its own, concurrently with the bulk worker's
`indexSite` for the same site. Every halted local site in a sweep is indexed
twice, and embedding is the dominant cost (ONNX MatMul was holding ~6.6 cores;
`meridian` alone was 13,059 chunks in 7.9 minutes). A sweep over halted local
sites therefore does roughly **2× the embedding work**, which is why the local
phase runs CPU-saturated.

Neither run is wrong individually — both are real, honestly recorded runs, and
that is exactly how the ledger exposed the duplication (`trigger` distinguishes
them; no log line does, see below). The fix belongs in phase 3/4 of the
2026-08-23 plan: either the lifecycle hook skips auto-index when the start was
bulk-initiated (the bulk worker is about to index anyway), or the bulk worker
defers to the lifecycle index instead of running its own. The first is likely
right — the bulk path reports outcomes into the operation the user is watching;
the lifecycle index reports nowhere.

**Related observation, worth its own line:** `ContentPipeline` writes no log
lines at all, so a bulk-run local site is INVISIBLE in the verbose log while it
indexes — the "Indexed <name>" lines come only from the lifecycle hook. During
the sweep this produced six minutes of apparent silence that looked exactly
like a stall (and earlier today, a false "zero local indexing" conclusion). The
ledger is now the authoritative activity record for these runs; treat log
silence about ContentPipeline as meaningless, not as idleness.

---

## D17 — FIXED 2026-08-23 — an ACF-first site lost its content AND its fields: empty post_content dropped the post before meta was read

**Found 2026-08-23, answering "what % of posts are we getting?" against the
sweep's ledger.** Median site: 100% of rows read become documents; mean 90%;
custom fields collected on 57/60; CPTs captured (cedarvalehealt: 7 types, 842
docs). The exception defines the defect:

```
qwerky   coverage: 25 pages, 5000 rows read (max-posts cap, honestly recorded),
         customFields: "collected"  →  2 documents indexed
```

`RemoteContentExtractor` drops posts whose cleaned `post_content` is empty
BEFORE fetching post meta — a deliberate WP-62 performance choice (the code
comment cites qwerky itself: fetching meta for 4,998 about-to-be-dropped posts
was the bulk of a 431-second run). Correct as a perf call, wrong as a coverage
rule for the page-builder/ACF-flexible-content pattern, where `post_content`
is empty BY DESIGN and every meaningful word lives in postmeta. Such a site
loses the post and its fields together; `customFields: "collected"` is then
true only of the two survivors.

Rare in this fleet (2 of 60 successful sites below 50%: qwerky 2/5000,
qwerkystg 1/4), catastrophic where it hits.

**Fix (implemented same day):** exactly this — fetch meta for a PAGE of ids before the
empty-content drop, and treat a post with empty content but non-empty public
meta as indexable (meta text becomes the document body). Preserves the WP-62
perf win for the common case iff the meta fetch stays page-batched; the
qwerky-shaped worst case pays the meta round trips it currently saves, which
is the point — those posts are the content.

---

> **CORRECTION, same day, after live verification:** qwerky is NOT an
> ACF-first site. Probed over SSH: its 4,998 empty-content posts are seeded
> test data ("Post 21575"…) carrying no public meta at all (only the private
> `_encloseme` key). With D17 live, its re-index still yields 2 documents —
> and that is the TRUE answer, now provable rather than assumed. The fix's
> mechanism stands for genuine ACF/page-builder sites (empty body, real
> fields); the exemplar that motivated it was misdiagnosed. The verification
> case for D17 is therefore a real ACF site with field-only posts, not qwerky.

## D18 — FIXED 2026-08-23 — L2's post_count_by_type for WPE installs missed custom post types

**Found the same way.** graph.db for `cedarvalehealt` says
`post_count_by_type = {"post": 600}` while the content index genuinely holds
842 documents across 7 types (condition, provider, treatment, insurance_plan,
location, page). Several sweep sites showed docs > post_count for the same
reason — the denominator undercounts, not the index overcounting.

The L3 side is correct; the L2 count is wrong. Effect: any surface using
post_count as "how much content does this install have" (fleet views, the
coverage math in this register's own D17 analysis) understates CPT-heavy
sites. Fixed same day: the query lived in `WpeRefreshScheduler` (not syncInstall) —
`--post_type=post` hardcoded in both the by-type call and the total. Now
discovers registered types with `wp post-type list` (wp eval is blocked on
the WPE gateway), excludes the same machinery set the L3 extractor filters,
and counts each publish-status type; the total is the sum. Live values land
on each install's next scheduled refresh (8h cycle).


---

## D19 — FIXED 2026-08-23 — a PHP notice ahead of the JSON made two sites permanently unindexable

**Found by the sweep's failure list; root-caused over SSH.** `bettersnrstg1`
and `bettersearcstg` failed every index with "page 1 returned unparseable
JSON". The actual page-1 output:

```
Notice: Constant DISABLE_WP_CRON already defined in /nas/content/live/bettersnrstg1/config/environments/staging.php on line 9
[{"ID":12,"post_title":"Let's Talk", ...   ← intact JSON
```

The sites' own staging config double-defines a constant; WordPress prints the
notice to stdout ahead of WP-CLI's JSON; `JSON.parse` gives up at byte 0. The
fix (`parseJsonArrayLenient`) retries from each candidate `[` and accepts the
first position from which the remainder parses as an array — prose brackets in
notice text fail the parse and are skipped; output with no JSON anywhere is
still a failed page. Mutation battery 3/3.

Same disease, unfixed elsewhere: `acfprod`'s Deprecated-notice pollution on
`syncInstall`'s plugin/user parses, and `WpeRefreshScheduler`'s `parseInt` on
`--format=count` output would both still choke on a leading notice. The helper
is extractor-local today; lifting it to the transport layer is the general
cure if more sites surface.

**Verification bookkeeping from the same 5-site run:** `andonovwoocstg`'s
sweep failure was transient — re-indexed clean (27 docs). `qwerky` /
`qwerkystg` see the D17 correction above.
