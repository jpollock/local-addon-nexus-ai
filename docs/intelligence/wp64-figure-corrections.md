# WP-64 · Corrections list for the "Nexus Stores and Identity" figures

**Verifying:** artifact `f43f5df6-7686-44af-a432-d74f740dc608`, drafted
21–22 Aug 2026.
**Method:** read-only. Every verdict below carries a `file:line` or a query
and the result it returned. Nothing in `src/` was changed.
**Fleet measurements taken:** 2026-08-22 15:28Z (`ledger.db`, `graph.db`,
`sites.json`, `nexus-ai_index_registry.json`), one machine, one fleet.

Verdicts are **confirmed** / **corrected** / **struck** (no citation exists,
so the claim leaves the figure) / **unverifiable** (a citation may exist but
no method reproduces the stated number).

Counts below are marked **[fleet]** where they are a property of this
machine's data and **[structural]** where they are a property of the code.
A **[fleet]** number is not a verified claim about the system.

---

## Summary

**33 claims examined. 14 confirmed, 13 corrected, 4 struck, 1 unverifiable,
1 confirmed-but-widened.** Two claims the architect named as load-bearing
split: `tracks_content`/`tracks_code` **held and got stronger**; the
`sites.json` ownership boundary **failed outright**.

The two findings that change what the figures argue:

1. **A third link kind exists.** `content_pulled_from` is written by
   `syncProducer.ts:203`, read by `divergence.ts:291` as the *first* tier of
   upstream resolution, and has live rows. Figure B says two kinds exist and
   its caption describes only the second tier. Upstream is not resolved by
   confidence alone.
2. **Nexus writes `sites.json`.** Seven `updateSite` call sites; three write
   `hostConnections` — the exact field Figure A says Nexus has no way to
   write. The ownership boundary the figure is built around is wrong.

---

## Figure A — the stores

### A1 · "Five persistent stores, four of them Nexus's" — **corrected**

Nexus owns **six store families**, not four. Three of the four drawn are real
and correctly attributed; `IndexRegistry` is a *key inside* a store rather
than a store (see A9). The undrawn ones:

| store | citation | on this fleet |
|---|---|---|
| Local's userData key-value store | `src/common/constants.ts:438-456` — 17 `STORAGE_KEYS`, all `nexus-ai_`-prefixed | 12 files present; the twin cache (`nexus-ai_site_metadata.json`, 77 KB) is one of them **[fleet]** |
| durable log & audit family | `OperationAuditLog`, `mcp/audit.ts`, `logging/eventLog.ts`, `AuditLogger` — four writers, per CLAUDE.md | `operation-audit.log` + 3 generations, `audit.log` + 3, ~32 MB **[fleet]** |
| per-agent SQLite | `agent-runtime/AgentDbManager.ts:20` — `agents/<name>/<db>.sqlite` | **no instance on this fleet** — the class exists, nothing has used it |
| telemetry identity | `nexus-ai/config.json` (installationId + secretKey) | present |
| GraphQL connection info | `Local/graphql-connection-info.json` — the CLI's and renderer's shared bearer token | present |

Every `new Database(...)` in non-test `src/`: `intelligence/ledger/ledger.ts:33`,
`main/vector-store/SqliteVecStore.ts:17`, `main/events/GraphService.ts:162`,
`main/agent-runtime/AgentDbManager.ts:20`. That is the complete SQLite set.

Two dead artifacts sit beside the live ones and should be named so they are
not mistaken for stores: `nexus-ai/vectors/` (the LanceDB directory,
`VECTOR_DB_DIR` at `constants.ts:461`, superseded by `vectors.db`) and
`nexus-ai/registry.db` (0 bytes, no tables).

### A2 · "sites.json · 45 sites · 20 with hostConnections" — **confirmed [fleet]**

45 top-level entries; 25 carry a `hostConnections` key, 20 of those non-empty,
20 connection objects in total.

```
node -e "const fs=require('fs'),os=require('os');
const s=JSON.parse(fs.readFileSync(os.homedir()+'/Library/Application Support/Local/sites.json','utf8'));
const a=Object.values(s);console.log(a.length, a.filter(x=>x.hostConnections?.length).length);"
→ 45 20
```

### A3 · "LOCAL OWNS THIS — NEXUS READS, NEVER WRITES" — **STRUCK**

This is the claim Figure A's ownership boundary rests on, and it is false.
Seven call sites write Local's site object through `siteData.updateSite`:

| write | field |
|---|---|
| `src/main/wpe-auto-pull.ts:410` | **`hostConnections`** (replaces the array) |
| `src/main/mcp/modules/wpe/wpe-pull.ts:157` | **`hostConnections`** (before the pull) |
| `src/main/mcp/modules/wpe/wpe-pull.ts:200` | **`hostConnections`** (again after, deliberately — the comment names the race) |
| `src/main/mcp/local-services-bridge.ts:714` | `phpVersion` |
| `src/main/mcp/modules/site-management/rename-site.ts:38` | `name` |
| `src/main/mcp/modules/site-management/toggle-xdebug.ts:39` | `xdebugEnabled` |
| `src/main/graphql/resolvers.ts:964` | `name` |

`local-services-bridge.ts:378` additionally exposes
`updateSite(siteId, updates: Record<string, any>)` — an unrestricted
passthrough, so the field list above is what is used today, not what is
reachable. `resolvers/sites.ts:400` is an eighth copy in the barrel CLAUDE.md
records as unreferenced.

`wpe_pull` is an MCP tool. An agent asking to pull an install writes
`hostConnections` into Local's own record, twice.

**Vacuous-guard note.** Zero of the 20 live hostConnection objects carry
`installId`, which `wpe-auto-pull.ts:415` writes — so that path has left no
trace on this fleet. The boundary is wrong **structurally**; this fleet
happens not to have exercised the auto-pull half of it. A verifier who
checked only the data would have confirmed the figure.

**Corrected statement:** Local owns `sites.json`. Nexus reads it at mirror
time *and writes it on seven paths, three of which write `hostConnections`
itself* — but nothing reads `remoteSiteEnv` back for upstream resolution,
which is the gap that actually matters and the only half of the figcaption
that survives.

### A4 · "graph.db · 372 active wpe/external rows" — **corrected to 368 [fleet]**

365 `wpe` + 3 `external`. Also 42 active `local` and 30 inactive `wpe`.

```sql
SELECT source, is_active, COUNT(*) FROM sites GROUP BY 1,2;
→ external/1: 3 · local/1: 42 · wpe/0: 30 · wpe/1: 365
```

### A5 · "ledger.db · 11,181 events" — **corrected to 15,201 [fleet]**

Up 36% in the ~21 hours since the reading. **Recommendation: the count does
not belong on the figure.** It is carried into the mermaid as a dated caption
line, not a box label, so a re-read corrects a caption instead of falsifying
a drawing.

### A6 · "ledger.db · events · entities · links" — **corrected**

Six tables plus `_meta`, one migration (`intelligence/ledger/migrations.ts`):
`events`, `fold_cursors`, `twin_facts`, `entities`, `entity_aliases`,
`entity_links`. **`twin_facts` is missing from the figure** — the
materialized view the whole fold architecture exists to produce.

### A7 · "vector store · SqliteVecStore" — **confirmed [structural]**

`SqliteVecStore` is the only `implements IVectorStore` in the tree
(`src/main/vector-store/SqliteVecStore.ts:11`) and is constructed exactly once
in production (`src/main/index.ts:234`) against
`nexus-ai/vectors.db` (`index.ts:229`). No second implementation is reachable.
Live: 3,169 tables, **264 distinct site corpora** (counted by `_docs` suffix) **[fleet]**.

### A8 · "remote capped at 200" — **confirmed [structural]**

`src/main/content/RemoteContentExtractor.ts:54` — `--posts_per_page=200`, one
`wp post list` call, no pagination and no total-count query, so the cap is
indistinguishable from the total. `customFields: {}` is hard-coded at line 102.

### A9 · "IndexRegistry — Local's userData (JSON)" — **corrected**

Not a store of its own: one **key** in Local's userData store,
`nexus-ai_index_registry` (`constants.ts:439`), one of 17. On disk that is
**one file**, `~/Library/Application Support/Local/nexus-ai_index_registry.json`
(796 KB), plus a byte-identical `_backup` twin written by the adapter at
`src/main/index.ts:182-193`. `IndexRegistry` itself holds the whole map in
memory and rewrites the file on every `update()`
(`content/IndexRegistry.ts:58`).

### A10 · "structure: local only" — **confirmed [fleet], zero counterexamples**

636 entries: 322 local-shaped site ids **all** carry `structure`; 307 `wpe-*`
and 6 `ssh:` entries **all** carry `structure: null`. The single apparent
exception is `zQ2BB5XHmh` — a local sentinel sandbox — whose `structure` is an
empty object, not a remote one.

### A11 · graph.db "wpe_site_id is a Site UUID with sibling installs" — **confirmed and quantified [fleet]**

```sql
SELECT wpe_site_id, COUNT(*) c FROM sites
WHERE source='wpe' AND is_active=1 GROUP BY 1 HAVING c>1;
→ 71 Site UUIDs (45 with 2 installs, 26 with 3) = 168 of 365 active installs
```

46% of active installs share their `wpe_site_id` with a sibling. Zero active
`wpe` rows have a NULL `wpe_site_id`. Resolving on the Site UUID alone is
ambiguous for nearly half the fleet.

### A12 · ledger row "Zero `agent%` events, because the core has been failing to start on a better-sqlite3 ABI mismatch" — **corrected**

The count is right and **the stated cause is wrong**. The core is running:
3,257 events recorded on 2026-08-22, the most recent at 14:52:28Z, and
`graph.db.agent_runs` holds 116 rows with a `success` run the same day. The
live agent-run topic is `episodic.agent_run.failed` (2 rows,
`agentFailureProducer.ts:78`) — which does not match the `agent%` prefix the
figure searched. What is missing is a **success-side producer**, not a
running core. This is a search-scope error of exactly the class the packet
warns about: the prefix excluded the topic that exists.

### A13 · ledger row "`semantic.content.changed` … structurally zero for WP Engine" — **confirmed, and widened**

2,550 events: **2,549** resolve to a `source='local'` graph row, 1 to no graph
row, **zero to `wpe` and zero to `external`**. Control: `state.plugin.observed`
splits 9,251 wpe / 432 local / 31 external over the same join, so the join
works and the zero is real.

The figure named only WP Engine. **External hosts are equally at zero** and
were not mentioned — the same omission the packet flags as the recurring
scope error.

### A14 · sites.json type row — **all four sub-claims confirmed [structural]**

`src/main/types/site-data.ts:17-27`:

- `remoteSiteEnv?: { environment?: string }` — an object. Live: a plain string
  in 20 of 20 (`"production"` ×19, `"staging"` ×1). **[fleet]**
- `remoteSiteId` — absent from the interface. Present in 20 of 20 live objects.
- `userId` — absent from the interface. Present in live objects.
- `installId?: string` — declared. Present in **0 of 20** live objects.

Additional, undrawn: `LocalSiteDataAccessor` (`site-data.ts:99`) declares only
`getSites` and `getSite`. The seven writes of A3 call a method Nexus's own type
for the accessor does not declare.

### A15 · "NO HUB. NO POSTGRES. NOTHING LEAVES THE MACHINE." — **corrected**

No hub and no Postgres: **confirmed** — every store enumerated in A1 is local,
and the only network-reachable component in the intelligence layer is none.

"Nothing leaves the machine" is false unqualified:
`src/cli/utils/telemetry.ts:27` POSTs to
`https://analytics.elasticapi.io/v1/events`, and provider and CAPI calls are
network calls by definition. **Corrected to:** *no intelligence-layer store
leaves the machine.* The narrower claim is the true one and is the one the
figure needs.

---

## Figure B — identity

### B1 · "`tracks_content` and `tracks_code` appear nowhere in `src/`" — **confirmed, and stronger**

Zero occurrences **anywhere in the repository outside `docs/`** — not in
`src/`, `tests/`, `lib/`, `dist/`, `build/`, `scripts/`, `wp-plugins/`, `law/`,
`agents/`, or `archive/`.

```
grep -rn "tracks_content\|tracks_code\|tracksContent\|tracksCode" . \
  --exclude-dir=node_modules --exclude-dir=.git
```

At `HEAD` (2d7120e9): **7 line hits, 5 files, all under
`docs/intelligence/`** — `architecture.md` (the ADR-21 text itself),
`WORK_PACKETS.md`, `reconciliation-site-environment-model.md`,
`sites-ia-readiness.md`, `implementation-audit-three-layer.md`. Re-run over
every non-docs directory, tracked and gitignored alike (`src tests lib dist
build scripts wp-plugins law agents archive bin models coverage docs-site
requirements`): **0 files**. Control: the same grep for `has_working_copy`
returns 18 files including 8 under `src/`, so the search reaches source.

Not written, not read, not declared, not in a migration, not in a fixture.

### B2 · "Two link kinds exist" — **corrected: three**

`content_pulled_from` is live and load-bearing:

- written — `src/main/intelligence-host/syncProducer.ts:203`, via
  `linkExclusive` so a copy holds exactly one content upstream
- read — `src/intelligence/compare/divergence.ts:291`, as the **first** tier
  of `resolveUpstream`, ahead of every structural link
- 2 rows live, at `1.0 pull_lineage`, from the 2 `episodic.sync.pulled` events
  **[fleet]**

A fourth name, `belongs_to_client`, appears only as a schema comment
(`migrations.ts:64`) with no writer and no reader.

### B3 · The three confidence arrows — **corrected: five writes across three branches**

The architect's cited lines are right and the drawing under-counts them.
`siteLinkMirror.ts`:

| branch | lines | writes |
|---|---|---|
| every active WPE row | `:110` | `has_environment` **0.95 host_connection**, hardcoded |
| `site_links` row, install known to the graph | `:127`, `:132` | `has_environment` **and** `has_working_copy`, both at `LINK_SOURCE_MAP[linkSource]` (`:63-67`): user→1.0 `user_link`, hostConnection→0.95 `host_connection`, inferred→0.5 `name_heuristic` |
| `site_links` row, install **unknown** to the graph | `:142`, `:143`, `:144` | `has_environment` + `has_working_copy` to the local env, both **1.0 `derivation`**; plus `has_environment` at the mapped evidence to a freshly minted WPE env |

Two corrections follow.

**`has_working_copy` is never written alone.** Every one is written in the
same breath as a `has_environment` on the *same* (site, env) pair, at
identical confidence and evidence (`:127`+`:132`, `:142`+`:143`). The middle
and right boxes of Figure B are therefore **one entity**, not two, and
`has_working_copy` contributes no discriminating signal to upstream ranking —
it exists to *subtract* copies from the candidate set
(`divergence.ts:resolveCandidates`, and the comment at
`entityService.ts:328-330` says so).

**The arrow labelled `has_working_copy · 1.0 user_link` is mislabelled.**
Live: 19 of 20 are 0.95 `host_connection`, 1 is 1.0 `user_link` **[fleet]**.

Live link census, all kinds **[fleet]**:

```sql
SELECT kind, established_by, confidence, COUNT(*) FROM entity_links GROUP BY 1,2,3;
→ has_environment    / host_connection / 0.95 : 393
  has_working_copy   / host_connection / 0.95 :  19
  content_pulled_from/ pull_lineage    / 1.0  :   2
  has_environment    / user_link       / 1.0  :   1
  has_working_copy   / user_link       / 1.0  :   1
```

**No link at `derivation` exists** — the `:142`/`:143` branch has never fired
on this fleet. Drawing it is correct; presenting it as observed is not.
It is marked **[structural]** in the figure.

### B4 · "env · local.site_id → Layer 2 or 3, by link kind" — **corrected**

The architect flagged this as an inference. It is not what the code does.

`entityService.ts:305-313` searches **both** kinds in `siteOf`, with the
comment *"Both containment kinds are searched because a copy carries both."*
`siteLinkMirror.ts:127`/`:132` writes both to the same env entity. Live, 20
env entities carry `has_environment` and `has_working_copy` from the same Site
simultaneously **[fleet]**.

So the link kind does **not** partition Layer 2 from Layer 3. The working-copy
set is a *subset* of the environment set, and `resolveCandidates`
(`divergence.ts:249-266`) is written as exactly that subtraction — it excludes
`workingCopiesOf(site)` from `environmentsOf(site)` precisely because a copy
appears in both traversals.

Corrected: **one `env` entity, two link kinds, one of them additive.** The
figure now draws one box with both edges rather than two boxes.

### B5 · Caption "resolveUpstream ranks has_environment candidates by confidence and abstains when they tie" — **corrected**

`divergence.ts:285-308` has three tiers:

1. **`content_pulled_from`** — an observed pull, taken first, "so it outranks
   any structural link however confident" (`:277-280`).
2. **The Site traversal** — 0 candidates → no upstream and *not* ambiguous;
   1 → resolve; >1 → resolve only on a strict confidence win.
3. **Abstain** on a tie.

The caption describes tier 2 and omits tier 1, which is the link kind Figure B
also omits. The two errors are the same error.

### B6 · "12 of 47 copies resolve · the 6 declines are every multi-environment Site" — **STRUCK, re-measured**

Replicating `resolveLineage` over live data **[fleet]**:

```
working copies (distinct has_working_copy targets) = 20
  resolved 14  (2 via content_pulled_from, 12 via the Site traversal)
  ambiguous 6
  no candidate 0
```

- **"12" was the traversal-only count**, which is why the third tier is
  missing from the caption too. 14 resolve.
- **"47" is unattributable.** Every copy population I can measure is 20:
  `has_working_copy` targets = 20, `graph.db.site_links` rows = 20,
  `sites.json` non-empty `hostConnections` = 20.
- **"every multi-environment Site" is false.** 84 Site entities carry more
  than one `has_environment` edge; only **5 distinct Sites** abstain (one
  contributes two copies, hence 6 declines). A Site is only asked when it has
  a working copy. Every decline is 2–3 candidates all at 0.95
  `host_connection` — a genuine tie, correctly refused.

The finding the figure draws from this survives intact and is better
supported: **the multi-environment case is where resolution abstains**, and it
abstains because every environment arrived by the same mechanism.

### B7 · "WPE-only sites get a Site at 100%" — **confirmed, converse confirmed, and widened [fleet]**

```sql
-- active graph row → env entity (alias local.site_id) → inbound has_environment from a type='site'
source     rows  with_env_entity  with_site
external      3                3          0
local        42               42         20
wpe         365              365        365
```

- **365 of 365.** The converse — active `wpe` rows with no Site entity — is
  **zero**.
- **external: 0 of 3.** Every external host has an env entity and no Site.
- **local: 20 of 42** — and the 20 are exactly the 20 with a `site_links` row.
  This **confirms as measured** what WP-63 could only state as a hypothesis:
  a local site gets a Site entity if and only if it has a host connection.
  A purely local site has no Site entity by construction.

### B8 · The namespace table (4 rows) — **corrected: six**

Live `entity_aliases` namespaces **[fleet]**:

| namespace | aliases | entities |
|---|---|---|
| `local.site_id` | 421 | 421 |
| `graph.site_row` | 374 | 374 |
| `wpe.install_id` | 374 | 374 |
| `wpe.install_name` | 374 | 374 |
| `local.site_id.logical` | 330 | 330 |
| `wpe.site_id` | 274 | 274 |

The figure omits `graph.site_row` and `wpe.install_name` — the two aliases
`siteLinkMirror.ts:100`/`:105`/`:139` exists to write, and the ones that close
the join its own header calls *"the subtle trap"*: producers derive env ids
from `sites.id`, `FleetAssembler` addresses installs by
`remote_install_id ?? id`, and only the double alias makes both land on the
same entity. Leaving them out of a diagram of identity omits the mechanism.

Every alias on this fleet is `derivation` at 1.0 — no `user_link`,
`domain_match` or `name_heuristic` alias exists **[fleet]**. The proposal path
(`EntityService.proposePairings`) has never been confirmed into an alias here.

### B9 · The "call sites" column (24 / 13 / 4 / 1) — **UNVERIFIABLE as stated**

No counting method reproduces all four numbers. Measured candidates:

| method | env·local.site_id | site·local.site_id.logical | site·wpe.site_id | env·wpe.install_id |
|---|---|---|---|---|
| non-test **mint** sites (`environmentEntityId`/`siteEntityId`/`ensure`) | 13 | **13** | 1 | 1 |
| + pure derivations (`provisionalEnvironmentId`, registers nothing) | 32 | 13 | 1 | 1 |
| bare namespace-literal occurrences, non-test | 11 | 5 | 2 | 5 |
| bare namespace-literal occurrences, incl. tests | 47 | 16 | 14 | 14 |

Only the "13" matches, and it matches under two methods, so it is not evidence
of which was used. **The column is replaced** with the defined metric —
non-test mint sites — and the definition is printed with it:

- `env · local.site_id` — **13** (`environmentEntityId` ×11 +
  `siteLinkMirror.ts:99`, `:120`); plus 19 non-test *read* sites via
  `provisionalEnvironmentId`, which derives the id without registering it
- `site · local.site_id.logical` — **13** (`siteEntityId` ×11 +
  `siteLinkMirror.ts:141`, `:176`)
- `site · wpe.site_id` — **1** (`siteLinkMirror.ts:175`)
- `env · wpe.install_id` — **1** (`siteLinkMirror.ts:137`)

`graph.site_row` and `wpe.install_name` mint nothing — they are alias-only
namespaces, 3 `addAlias` sites.

---

## The remainder — what the figures do not show

Enumerated from the code, then subtracted from the figures.

**Stores not drawn** — see A1. The userData key-value store (17 keys), the
four-writer audit family, per-agent SQLite, telemetry config, GraphQL
connection info; plus two dead artifacts (`nexus-ai/vectors/`, `registry.db`).

**Ledger tables not drawn** — `twin_facts` and `fold_cursors`. `twin_facts` is
the materialized view the fold architecture exists to produce; a store diagram
that omits it draws the spine without the thing it feeds.

**graph.db tables not drawn** — the figure names three of 22. The undrawn one
that matters to Figure B is **`site_links`**: every link the mirror writes is
sourced from it, so the arrow labelled "read at mirror time" actually reads
`sites.json` → Track-1's `site_links` → the ledger, not `sites.json` → ledger.

**Entity types** — exactly two: `site` (604) and `env` (421) **[fleet]**.
There is no third type despite ADR-21's third layer; the layer is a link kind
and an envelope role, never a type. The figures never say so.

**Link kinds** — 3 live (B2), 2 specified-and-absent (B1), 1 comment-only
(`belongs_to_client`).

**Envelope roles** — `working_copy` is stamped on **2 events**, both
`episodic.sync.pulled` **[fleet]**. ADR-21's ruling that "producers additively
stamp a third `working_copy` envelope role" is, in the tree, *one* producer.
Neither figure shows envelope roles at all.

**Topics** — 22 literals in `src/`, **16 with live rows** **[fleet]**. Never
fired here: `episodic.incident.opened`, `episodic.sync.pushed`,
`state.plugin.removed`, `state.user.observed`.

**Actors and grants** — `control.grant.issued` (14) and `control.grant.revoked`
(2) are live, and neither figure has an actor or a capability on it. That is
the largest single omission and is the natural subject of the "C · Writes"
figure the artifact proposes next.

---

## Defects found — filed, not fixed

Per the packet's scope discipline. None were touched.

**D1 · `IndexRegistry` never prunes.** 277 of 636 entries (43%) are ids of
Local sites that no longer exist in `sites.json`, all carrying a `structure`
**[fleet]**. Every count taken over `listAll()` — including the health-score
population CLAUDE.md documents under "Fleet counts" — is inflated by them, and
they are indistinguishable from live local sites by shape.

**D2 · Three writers replace `hostConnections` with a single-element array.**
`wpe-auto-pull.ts:410`, `wpe-pull.ts:157`, `wpe-pull.ts:200`. A site with an
existing connection to another environment loses it. No read-modify-write.

**D3 · `remoteSiteEnv` is typed as an object, live data is a string.**
`src/main/types/site-data.ts:24`. A reader doing `remoteSiteEnv.environment`
gets `undefined` and typechecks clean — the exact shape of the WP-63 finding
that the environment record nobody reads is also the record nobody could read
correctly.

**D4 · `entityService.ts`'s header is stale and says the opposite of the
truth.** Lines 1-16: *"DRAFT, unwired … Not wired into the host yet: review
the model before anything writes through it."* `bootstrap.ts:273` constructs
it; it has written 1,025 entities, 2,147 aliases and 416 links **[fleet]**.

**D5 · `LocalSiteDataAccessor` declares no `updateSite`.**
`site-data.ts:99-104` declares `getSites` and `getSite` only, while seven call
sites invoke `updateSite` on the same service — which is one reason the write
path was invisible to a search of the type.

---

## What could not be answered on this fleet

Stated rather than reported as confirmed, per WP-63's standard.

1. **Whether the `derivation` branch (`siteLinkMirror.ts:142-143`) behaves as
   drawn.** Zero links at `derivation` exist here — it fires only for a
   `site_links` row whose install is absent from or soft-deleted in the graph.
   *Would answer it:* soft-delete a linked install, re-run the mirror.
2. **Whether `has_working_copy` can ever carry evidence different from its
   paired `has_environment`.** Both writes take the same `mapped` value in
   both branches, so no, in the tree as written — but a future producer could
   diverge them and nothing pins them together.
3. **Whether a Site can hold two `content_pulled_from` copies with different
   upstreams.** 2 lineage links here, both from distinct copies.
   *Would answer it:* two local copies of one install, pulled from different
   environments.
4. **Whether external hosts would resolve upstream if they had Site entities.**
   0 of 3 have one, so the resolver is never reached for them.
5. **Whether per-agent SQLite (`AgentDbManager`) behaves as a store.** No
   instance exists on this fleet.
6. **Whether `wpe.install_name` collides across accounts.** 374 aliases, all
   distinct here; the schema's `UNIQUE (namespace, value)` would silently
   re-point an entity if two accounts shared an install name.

---

## What the corrected figures assert

**Figure A** — 6 Nexus store families and 1 Local store; 4 SQLite databases;
17 userData keys; 4 durable audit writers; 6 ledger tables; 22 graph tables;
7 write paths across the ownership boundary, 3 of them to `hostConnections`.

**Figure B** — 2 entity types; 6 alias namespaces; 3 live link kinds and 2
specified-and-absent; 5 link writes across 3 branches in one module; 3 tiers
of upstream resolution; 20 working copies, 14 resolving, 6 abstaining.

**Fleet numbers, all measured 2026-08-22 15:28Z on one machine:** 45 sites.json
entries, 20 host connections, 368 active wpe/external graph rows, 15,201
events, 1,025 entities, 416 links, 636 index-registry entries.
