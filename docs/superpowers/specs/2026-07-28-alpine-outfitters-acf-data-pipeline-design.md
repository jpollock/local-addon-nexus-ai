# Alpine Outfitters — ACF Data Pipeline Rebuild (Design Spec)

**Date:** 2026-07-28
**Status:** Approved design → ready for implementation plan
**Repos involved:**
- Demo content generator: `/Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo`
- Nexus AI addon (consumer): `/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai`

---

## Goal

Rebuild the Alpine Outfitters demo dataset so that every custom-post-type item carries **complete, correctly-stored ACF structured data** and a **rich relationship graph**, and make the Nexus AI addon consume that structured data **generically** (no hardcoded domain field names). The result is a canonical, reproducible demo site that showcases Nexus AI and Intelligent Web/Power traversing a real content graph.

## Background — what is broken today

Investigation of the live Alpine Outfitters site (Local) and the `alpine-outfitters-demo` generators found:

- **~350 content items** total: 181 products, 62 blog posts, 41 destinations, 30 trips, 23 pages, 12 team.
- **Destinations (41):** 40 of 41 have **zero** structured ACF data. Difficulty/distance/elevation exist only in prose.
- **Trips (30) and Team (12):** have *partial* postmeta written inconsistently (snake_case, some fields only), with bugs — e.g. trip `season` is **double-serialized** (`s:23:"a:1:{i:0;s:6:"Summer";}"`).
- **Relationships:** **zero** across every type. No `related_trips`, `recommended_gear`, `related_destinations`, `required_gear`, `favorite_destinations`, `guided_trips`, or blog internal links exist in WordPress.
- **ACF field groups:** all 3 groups (`Trip Details`, `Destination Details`, `Team Member Details`) exist as **empty shells** — a title + location rule but **0 field definitions**. `acf_get_fields()` returns nothing; `get_field()` works only via raw-postmeta fallback.
- **Root cause:** the generators produce good data, but the import layer used `wp post create <json>` with flat camelCase fields and **no `meta_input`**, so structured data was dropped (destinations) or written ad-hoc (trips/team). Relationships were typed as `number[]` (post IDs) but generated *before* import, when no IDs exist, and there was no second pass to resolve them.

### Why it matters

Nexus AI and Intelligent Web/Power are most compelling when they can **traverse the content graph** ("this trip visits these destinations, which recommend this gear, sold as these products"). That graph does not exist in the current data.

---

## Scope

**In scope:**
- Regenerate **destination, trip, team** prose + structured data through a fixed pipeline (Approach C).
- Define all 3 ACF field groups properly (full designed schema) via `acf-json`.
- Build a two-pass importer that writes ACF via `update_field()` and resolves relationships by slug.
- Wire the **full relationship graph**, including augmenting existing blog posts with internal links.
- Refactor the addon's hybrid search to be **domain-agnostic**: generic `{field, op, value}` filters and expose `customFields` in results.
- A `verify` gate that fails loudly on missing fields/relationships/field-defs.

**Out of scope (explicit):**
- WPE deployment (deferred to a separate task).
- Regenerating **product, page, or blog prose** (products/pages untouched; blogs only get link injection).
- Embeddings-based relationship matching (heuristics only).

---

## Architecture (Approach C — TS generates, PHP imports via `update_field()`)

Two cooperating layers plus a verify gate.

```
fixed seed → TS generators → normalized JSON (slugs + acf + relationships-by-slug)
  → wp alpine import:
      Pass 1: upsert posts + update_field() every ACF value   → build slug→ID map
      Pass 2: resolve relationship slugs→IDs + update_field(); inject blog internal links
  → wp alpine verify   (non-zero exit on any missing field/relationship/field-def)
  → Nexus reindex → hybrid search & graph demos
```

**Why this shape:** `update_field()` (not raw `meta_input`) guarantees correct ACF serialization and field-key references — it is exactly what the raw-meta path got wrong (double-serialized arrays, empty field-key refs). Expressing relationships **by slug** and resolving them in a **second pass** fixes the empty graph: slugs are stable across seeded re-runs, so link targets never depend on insert order.

### Components

1. **TS generators** (`alpine-outfitters-demo/scripts/generators/*`) — existing, lightly modified:
   - Add a **fixed faker seed** (single source, set once at startup).
   - Give every item a **stable slug** (deterministic from title + seed).
   - Express relationships **by slug** (not fabricated numeric IDs).
   - Populate the relationship intent for **all** types (destinations currently emit none).

2. **TS normalizer** (`scripts/generate-content.ts`, rewritten output) — emits normalized JSON per type (see Normalized JSON Contract).

3. **Importer plugin** — a real WordPress plugin `alpine-seeder` in the demo repo, shipping:
   - `acf-json/` field-group definitions (source of truth for the 3 groups).
   - **CPT registration** for `destination` / `trip` / `team` (consolidated here; remove any pre-existing ad-hoc registration).
   - WP-CLI command **`wp alpine import`** (two-pass engine).
   - WP-CLI command **`wp alpine verify`** (the gate).

---

## ACF Field Schema (full designed schema)

Field **names** are snake_case and become the postmeta keys the Nexus indexer reads. `region` and season/`best_seasons` Select/Checkbox choices are **derived from the existing `faker-helpers` region pool and a shared seasons list** (single source of truth — do not hardcode a divergent list).

### `group_destination` → post type `destination`
| Field name | Type | Notes |
|---|---|---|
| `distance` | Number | step 0.1, append "miles" |
| `elevation_gain` | Number | append "feet" |
| `difficulty` | Range | 1–5 |
| `trail_type` | Select | loop / out-and-back / point-to-point |
| `trailhead_gps` | Text | e.g. "47.6062, -122.3321" |
| `permits_required` | True/False | |
| `permit_details` | Textarea | conditional on `permits_required = 1` |
| `best_seasons` | Checkbox | Spring/Summer/Fall/Winter |
| `region` | Select | shared region pool |
| `related_trips` | Relationship | → `trip` |
| `recommended_gear` | Relationship | → `product` |

### `group_trip` → post type `trip`
| Field name | Type | Notes |
|---|---|---|
| `duration` | Number | append "days" |
| `difficulty` | Range | 1–5 |
| `price` | Number | prepend "$" |
| `group_size_min` | Number | |
| `group_size_max` | Number | |
| `itinerary` | Repeater | rows: `day` (Number), `activities` (Textarea) |
| `season` | Checkbox | Spring/Summer/Fall/Winter |
| `region` | Select | shared region pool |
| `related_destinations` | Relationship | → `destination` |
| `required_gear` | Relationship | → `product` |

### `group_team` → post type `team`
| Field name | Type | Notes |
|---|---|---|
| `years_experience` | Number | |
| `certifications` | Repeater | rows: `certification` (Text) |
| `specialties` | Repeater | rows: `specialty` (Text) |
| `email` | Email | |
| `phone` | Text | optional |
| `favorite_destinations` | Relationship | → `destination` |
| `guided_trips` | Relationship | → `trip` |

**Existing empty field groups must be removed** so `acf-json` is the single source of truth (no duplicate/competing groups).

---

## Normalized JSON Contract

Each generator writes an array of items in this envelope (relationships separated from `acf` so pass two resolves them):

```json
{
  "slug": "raven-cliff-falls",
  "post_title": "Raven Cliff Falls",
  "post_content": "…prose…",
  "post_status": "publish",
  "acf": {
    "difficulty": 1,
    "distance": 4.0,
    "elevation_gain": 321,
    "trail_type": "out-and-back",
    "trailhead_gps": "34.90, -111.70",
    "permits_required": false,
    "permit_details": "",
    "best_seasons": ["Spring", "Fall"],
    "region": "Desert Southwest"
  },
  "relationships": {
    "related_trips": ["desert-ascent"],
    "recommended_gear": ["timberline-24l", "trail-runner-shoes"]
  }
}
```

- ACF values stay **native JSON** (arrays/objects) — no hand-serialization. The importer passes them to `update_field()`.
- Relationship values are **arrays of slugs**, resolved to IDs in pass two.
- Repeater fields (`itinerary`, `certifications`, `specialties`) are arrays of row objects, e.g. `"itinerary": [{ "day": 1, "activities": "…" }]`.

---

## Importer plugin — `wp alpine import`

`wp alpine import [--type=all|destinations|trips|team|blog-links] [--dir=<path>]`

`--type=all` runs **all of Pass 1 for every type, then all of Pass 2** (so cross-type relationships resolve). A single-type run (e.g. `--type=trips`) does Pass 1 + Pass 2 for that type and resolves relationship targets against posts already present in WordPress.

**Pass 1 — posts + ACF (per type):**
1. For the 3 CPTs, **delete existing posts of that type** (clean canonical state). Products/pages/blog posts are preserved.
2. For each JSON item: `wp_insert_post` (title, content, status, `post_name` = slug).
3. For each key in `acf`, call `update_field(name, value, $post_id)` — correct serialization + field-key refs guaranteed.

**Pass 2 — relationships:**
1. For each item with `relationships`, resolve each target slug → post ID by querying WordPress for a post with that `post_name` + expected `post_type` (`get_posts`/`get_page_by_path`). No persisted transient — resolution is a direct WP lookup, so it works for both `--type=all` and single-type runs and stays idempotent.
2. `update_field(relationship_field, [ids], $post_id)`.
3. Enforce **reciprocity** for trip↔destination: adding *D* to `trip.related_destinations` also adds *T* to `destination.related_trips` (union, deduped).
4. **Blog internal links:** for each blog post, strip any prior injected block, then append a **"Related" block** (marked `<div class="alpine-internal-link">…</div>`) containing 2–3 links to related destinations/products (matched by keyword/category overlap). Appending a marked block (rather than rewriting in-body phrases) keeps injection deterministic and idempotent. Fallback guarantees every blog post receives ≥1 link.

**Idempotency:** re-running import over the same JSON yields the same site. Delete-and-recreate for the 3 CPTs; slug→ID relationship resolution via WP lookup is order-independent; blog injection is marker-guarded (strip-then-append).

---

## Relationship Matching (heuristics, deterministic)

Resolved in pass two; all selection is **seeded** so it is reproducible. Heuristics chosen over embeddings for reproducibility, explainability, and zero extra dependencies.

1. **trip ↔ destination** (bidirectional): match by **shared `region`**; each trip links 2–4 in-region destinations (seeded). Reciprocity applied in pass two so neither side is orphaned.
2. **destination → `recommended_gear`**, **trip → `required_gear`** (→ products): map **difficulty/type → product category** (categories already exist on products, e.g. "Backpacks & Bags"). E.g. difficulty 4–5 → mountaineering/climbing; 1–2 → daypacks/footwear; backpacking trips → packs/tents/sleeping bags. Seeded pick of 3–5 from the relevant category set.
3. **team → `favorite_destinations` + `guided_trips`**: seeded selection biased by specialty/region; ~3 destinations and ~3 trips per member.
4. **blog → internal links** (destinations + products): pick 2–3 by keyword/category overlap with the post topic; append a marked "Related" block to the body (see importer Pass 2). Every blog post receives ≥1 link (fallback to seeded topic-relevant picks when overlap is weak).

**Fallback:** if a region has too few destinations for a trip's quota, fall back to nearest-region then global seeded pick, so every relationship field ends non-empty (verify enforces ≥1).

---

## Reproducibility model

- **The committed JSON data files are the canonical artifact.** Re-running `wp alpine import` over the same JSON always produces the same site — this is the reproducibility guarantee.
- **Faker** structured data + all relationship selection use a **fixed seed**, so a regeneration reproduces the same numbers/links.
- **AI prose is not deterministic.** Regenerating prose (calling the AI) is an intentional, occasional step; once generated, the JSON is committed and frozen. Day-to-day the site is fully reproducible from committed JSON; only a deliberate "regenerate prose" run changes text.

---

## Addon changes (`local-addon-nexus-ai`) — make hybrid search domain-agnostic

The current WIP hybrid search hardcodes hiking field names (`custom.difficulty`, `custom.distance_miles`, `custom.elevation_gain_ft`) and a "difficulty ≤ 2 → +30%" boost in `SqliteVecStore.searchHybrid`. This is a domain leak in a general-purpose product and must be removed.

**Option A — generic field filters:**
- Replace `SearchOptions.metadataFilters` (currently `{minDifficulty, maxDifficulty, maxDistance, maxElevation}`) with a generic array:
  ```ts
  metadataFilters?: Array<{ field: string; op: 'eq'|'ne'|'lt'|'lte'|'gt'|'gte'|'contains'; value: string | number }>
  ```
- `searchHybrid` applies each filter against `custom[field]`, using numeric comparison when both sides parse as numbers, else string comparison (`contains` = substring, case-insensitive). Missing field → filter excludes the doc (fail-closed) for `lt/lte/gt/gte/eq`; document the semantics in code.
- **Remove the difficulty boost.** Ranking is pure RRF (vector + BM25), normalized to 0–1 (existing behavior).

**Option B — expose `customFields` in results:**
- `search_site_content` result formatting includes each result's `customFields` (compact rendering) so the AI agent can reason over structured fields directly.

**MCP tool schema:** update `search_site_content` input schema for the generic `metadataFilters` shape; update the description to explain generic filtering + that `customFields` are returned.

**Producer/consumer contract:** the demo site *produces* postmeta keys (ACF field names); the addon *consumes* them only via caller-supplied `{field}` — it never names a field itself. No per-field alignment needed; the clean ACF names stand.

---

## Verification gate — `wp alpine verify`

Exits non-zero on any failure (usable as an SDD review gate and CI check):
- **Counts** match expected (41 destinations / 30 trips / 12 team — from config).
- Every destination/trip/team has **all** required ACF fields non-empty.
- Every one has **≥1 of each** designed relationship (trip: ≥1 `related_destinations` + ≥1 `required_gear`; destination: ≥1 `related_trips` + ≥1 `recommended_gear`; team: ≥1 `favorite_destinations` + ≥1 `guided_trips`).
- Each ACF group has **field definitions** (`acf_get_fields(group) > 0`) — catches the empty-shell regression.
- Spot-check `get_field()` returns **real arrays** for checkbox/repeater fields (catches double-serialization).
- **Every blog post** carries an injected internal-link block (≥1 link).

---

## Testing strategy

**Demo repo (`alpine-outfitters-demo`):**
- Unit tests for matching logic: region matching, category mapping, reciprocity, fallback-when-region-sparse.
- Unit test for normalizer output shape (envelope keys, native-JSON ACF values, slug-based relationships).
- `wp alpine verify` is the integration gate (run after import).

**Addon repo (`local-addon-nexus-ai`):**
- Unit tests for generic metadata filters: each `op`, numeric vs string comparison, missing-field behavior.
- Unit test that `customFields` are surfaced in search results.
- Confirm boost removal does not break existing hybrid-search tests; update any test asserting the old hiking-specific filter shape.

---

## Success criteria

1. `wp alpine verify` passes (all assertions green).
2. In Local, a destination, trip, and team member each show fully populated ACF fields **in the WP admin UI** (proves field groups are real, not shells).
3. Nexus reindex of Alpine Outfitters includes the ACF fields in `customFields`.
4. Hybrid search with a **generic** filter (e.g. `[{field:"difficulty", op:"lte", value:2}]`) correctly narrows destinations — with **no hiking-specific code in the addon**.
5. An AI agent over MCP can answer a structured question ("easy trails under 5 miles near a Rocky Mountains trip") by discovering fields and composing generic filters and/or reasoning over returned `customFields`.
6. The content graph is traversable: from a trip → its destinations → their recommended gear (products), and team → guided trips/favorite destinations.

---

## Risks / notes for the plan

- **CPT registration source:** destinations/trips/team are currently registered somewhere (they exist and are queryable). The plan must locate the existing registration and consolidate it into `alpine-seeder`, removing duplicates to avoid double-registration.
- **Existing empty ACF groups** (DB posts) must be deleted so `acf-json` is authoritative; watch for key/title collisions on first sync.
- **Product categories** must be inspected to build the difficulty/type → category mapping accurately (the mapping table is derived from real categories present on the 181 products).
- **Repeater/relationship postmeta in the index:** ACF repeaters store subfield keys (e.g. `itinerary_0_activities`) and relationships store ID arrays; these flow into `customFields`. Acceptable (repeater text enriches search; ID arrays are harmless). Revisit only if noise hurts relevance.
- **Native modules:** addon changes require the standard `npm run rebuild` (Electron) / `npm install` (tests) workflow; restart Local via `./dev-reload.sh`.
