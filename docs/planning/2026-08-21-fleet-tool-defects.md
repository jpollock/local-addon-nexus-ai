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
