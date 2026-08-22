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
