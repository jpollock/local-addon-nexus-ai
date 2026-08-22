# WP-63 · The Sites deep-dive — is ADR-21 still true?

*Read-only investigation, 2026-08-22. Branch `poc/nexintelligence-ux` @ `13a6f5b3`.
Re-tests one sentence in `reconciliation-site-environment-model.md` §7 / ADR-21:*

> *"Product UI inversion: one Site card, N environments, local copies as tracked
> snapshots — the entity graph is the substrate that makes it a RENDERING CHANGE,
> not a data migration."*

*Every claim below carries a `file:line` or a query and its result. Live data
measured against `~/Library/Application Support/Local/nexus-ai/{graph,ledger,vectors}.db`
and `~/Library/Application Support/Local/{sites.json,nexus-ai_index_registry.json}`,
all opened `mode=ro`, on 2026-08-22 with Local running.*

---

## THE VERDICT, IN ONE SENTENCE

**Item 6 is a rendering change plus four named producers — `siteLinkMirror`
coverage for external hosts, a Site-role reconciliation for the three
high-volume producers (`graphServiceTap` / `graphBackfill` / `wpEventProducer`),
an environment-kind tie-break in `resolveUpstream`, and per-place-count parity
(WP-62) — and one product ruling on the partial-index sentence; there is no
data migration and no missing JOIN.**

Every one of those four is additive. None requires re-deriving an id, altering a
table, or rebuilding history. ADR-21's claim survives re-testing — but it
survives *narrowly*, and it survives for a different reason than the architect's
framing assumed.

---

## THE FLEET THIS WAS MEASURED ON

| population | count | source |
|---|---|---|
| Local sites (Local's own store) | **45** | `sites.json` |
| graph `sites` source=`local`, is_active=1 | 42 | graph.db |
| graph `sites` source=`wpe`, is_active=1 | **365** (+30 inactive) | graph.db |
| graph `sites` source=`external`, is_active=1 | **3** | graph.db |
| distinct `wpe_site_id` among active WPE rows | **268** | graph.db |
| `site_links` rows (local↔install attachments) | **20** (19 hostConnection, 1 user) | graph.db |
| ledger `entities` type=`env` | **421** (374 WPE-aliased, 47 not) | ledger.db |
| ledger `entities` type=`site` | **604** (274 `wpe.site_id`, 330 `local.site_id.logical`) | ledger.db |
| `entity_links` | 394 `has_environment`, **20** `has_working_copy`, **2** `content_pulled_from` | ledger.db |
| `twin_facts` | 6,457 rows over **419 entities — all of type `env`, zero on `site`** | ledger.db |
| ledger `events` | **15,185** over 16 topics; `state.plugin.observed` 9,700, `semantic.content.changed` 2,550, `state.theme.observed` 1,163, `state.site.observed` 836, `state.drift.detected` 725 | ledger.db |

**The fleet moved during this investigation.** `semantic.content.changed` was
1,289 events at the first measurement and 2,550 forty minutes later — local
content indexing was running. Where a number below is time-sensitive it is
labelled; the two readings are given where the drift is itself evidence (§8b).

Reproduce:

```bash
cd "$HOME/Library/Application Support/Local/nexus-ai"
sqlite3 -header -column "file:graph.db?mode=ro" \
  "SELECT source,is_active,COUNT(*) c FROM sites GROUP BY source,is_active;"
sqlite3 -header -column "file:ledger.db?mode=ro" \
  "SELECT type,COUNT(*) FROM entities GROUP BY type;
   SELECT kind,COUNT(*) FROM entity_links GROUP BY kind;"
```

**Note on `CLAUDE.md`'s numbers:** they are stale in both directions. That file
records 113 Local sites and five colliding names; measured today it is **45** and
**six** (`thelocalshed` is new). This document's numbers will go stale the same
way — re-run the queries, do not quote these.

---

## 1 · Does a WPE-only site have a Site entity at all?

**The bet was wrong, and it was wrong in an interesting direction.**

Yes — and with **100% coverage**. `siteLinkMirror.ts:99–110` mints a Site entity
for *every* active WPE row, keyed by `wpe.site_id` when CAPI supplies one
(`siteEntityFor`, `siteLinkMirror.ts:173–177`), and links it to the install's env
entity with `has_environment`. Nothing about that path requires a local site to
exist, and nothing about it goes through `provisionalSiteId()`.

Measured — `siteOf()` (`entityService.ts:307–318`) simulated in SQL over every
env entity that carries a twin fact:

| env entity class | count | resolves to a Site | **no Site** |
|---|---|---|---|
| WPE-aliased (`graph.site_row` present) | 374 | **374** | 0 |
| local-only | 45 | 20 | **25** |

**The hole is at Layer 3, not Layer 2.** A local sandbox gets a Site only through
a `site_links` row (20 exist), and `buildSiteAtPlaces` drops an entity with no
Site outright — `siteAtPlaces.ts:295–299`, `if (!site) continue`, with the
docblock at :259–265 stating the reasoning ("dropping is visible; inventing is
not"). So **25 of the 45 local sandboxes vanish from any Site-nested render**,
and they vanish silently.

**And a third class was missed by the question entirely: external SSH hosts.**
`siteLinkMirror` queries `WHERE source = 'wpe'` (`siteLinkMirror.ts:86`). All
three external hosts have env entities with real twin facts and **zero** Site
edges:

```
value                                     site_edges  twins
ssh:piedmontdermgroup/piedmontdermgroup    0          11
ssh:tablemesaderm/tablemesaderm            0          11
ssh:willowcreekderm/willowcreekderm        0          12
```

**Class: a missing producer, not a missing JOIN.** Widening the mirror's query to
`source IN ('wpe','external')` and giving external rows a logical-Site key is
additive. Until it lands, the honest row for an external host is *"not grouped
under a site yet"* — which is a sentence, not a blocker.

**What this fleet cannot answer:** nothing. The case is present 365 times over.

---

## 2 · What groups prod / staging / dev into ONE property?

**`sites.wpe_site_id` — CAPI's own Site container UUID.** It is written on every
sync at `WPESyncService.ts:185` (`wpe_site_id: i.site?.id`) and re-expressed as
the Site entity id by `siteLinkMirror.ts:174`.

The derivation is real and complete:

| | value |
|---|---|
| active WPE rows | 365 |
| with a `wpe_site_id` | **365 (100%)** |
| distinct `wpe_site_id` | **268** |
| Sites with 1 install | 197 |
| Sites with 2 installs | 45 |
| Sites with 3 installs | 26 |

Fan-out measured on the entity side (`has_environment` per Site entity): 190 × 1,
53 × 2, 27 × 3, 3 × 4, 1 × 5 — the ones over 3 being Sites that also carry a
working copy or a soft-deleted install.

The designer's *203 sites / 367 environments* is therefore **a real derivation,
not an estimate**, but the ratio does not reproduce on today's fleet: 1.81
environments per site there, **1.36** here (365/268). Different snapshot. The
*shape* holds; the numbers must be re-derived per fleet.

**Not an estimate, but not free either:** `wpe_site_id` populates only through
`syncAllWPESites`, and the entity-side grouping is built only by
`runSiteLinkMirror`, which is wired **once, at startup** — `index.ts:819`,
chained off `runStartupReconciliation` (`index.ts:816`). A newly discovered install gets its graph
row immediately and its place in the Site graph **at the next Local restart**.
Measured drift today: 374 env entities carry `graph.site_row` against 365 active
WPE rows, i.e. 9 rows have gone inactive since the mirror last ran.

---

## 3 · Is `upstream` / `tracks` populated for anything real?

**Barely — and the shortfall is concentrated exactly where the IA needs it most.**

The producer shipped. `syncProducer.ts` (WP-14) is live and correct: it stamps
three entity roles (`site` + `environment` + `working_copy`, `syncProducer.ts:143–148`),
refuses to record a failed sync (:123), and writes the pointer with
`linkExclusive` (:200–207). Live it has fired **twice** —
`episodic.sync.pulled` × 2, `content_pulled_from` × 2, both 2026-08-17/18.
Zero `episodic.sync.pushed`. Zero `tracks_content` / `tracks_code` edges (the
audit's names; the shipped kind is `content_pulled_from`).

But `resolveUpstream` (`divergence.ts:285–309`) has a second rung — the Site
traversal — so the reach is wider than two. Reproducing the full
`resolveLineage` → `resolveUpstream` ladder over all **47** local working-copy
entities:

| outcome | copies |
|---|---|
| **no Site — dropped from the nested render** | **27** |
| `content_lineage` (a recorded pull) | 2 |
| `site_environment` (Site traversal, unambiguous) | 12 |
| **AMBIGUOUS — declines** | **6** |

(27 rather than §1's 25: this counts all 47 local-only env entities, §1 counted
only the 45 that carry a twin fact. Two have an entity and no facts.)

**The finding is in the last row.** All 12 that resolve are Sites with exactly
**one** upstream candidate — the single-environment case, where the nesting adds
nothing. All 6 that decline are Sites with **2 or 3 WPE installs, every candidate
at confidence 0.95** — the mirror writes `has_environment` at a flat 0.95 for
CAPI containment (`siteLinkMirror.ts:110`), so `candidates[0].confidence >
candidates[1].confidence` (`divergence.ts:303`) is never true, and the function
declines by design (:308).

> **The multi-environment Site — the only case the nested IA exists to render —
> is precisely the case where upstream resolution declines.**

Boards B and C are therefore undrawable for 6 of the 6 interesting copies, and
drawable for the 12 boring ones. That is not the ledger being empty; it is a
tie-break that has no evidence to break on.

**The fix is named and cheap, and it is not a migration.** `describeEnvironmentsFor`
(`taskFrame.ts:172–199`) already knows which install is `production`, from the
graph's own `sites.environment` column. §3 of the model says content flows DOWN
from production — so production *is* the right default content upstream. Passing
that describer (or its verdict) into `resolveUpstream` as a tie-break turns 6
declines into 6 answers. It costs a parameter across the ADR-16 seam, not a
schema change.

**Class: a producer/reader change.** Not a blocker for boards A and D; a blocker
for B and C on multi-environment Sites, which is most of what board B is for.

**What this fleet cannot answer:** whether a copy that has pulled from *two
different* environments over time upserts correctly. `linkExclusive` exists for
exactly that (`entityService.ts:207–224`) and is unit-tested, but the live fleet
has two pulls on two distinct copies — the case has never occurred here. To
construct it: pull one local site from production, then from staging, and assert
one `content_pulled_from` edge survives.

---

## 4 · Does WP-58's collision decline reach the Sites surface?

**No — and it does not need to, because the Sites surface never resolves by name.**

Six names now collide across sources (`goldenecomm`, `jpp0413p`, `myloop`,
`psbtest2`, `testjppstg`, `thelocalshed` — CLAUDE.md's list of five is one
short). Five of the six local copies have a `site_links` row; `jpp0413p` does not.

The surface: `SitesTab.tsx` renders `SiteRow[]`, built by
`buildSiteRows` (`fleet/siteRows.ts:78–144`) from Local's store keyed by
`s.id` and graph rows keyed by `g.id`. **No name lookup anywhere on that path.**
`GET_SITE_ROWS` (`ipc-handlers.ts:761`) selects rows; the bulk actions take
`ids: string[]` (`SitesTab.tsx:32`) and `src/main/bulk/` contains zero calls to
any resolver. A colliding name produces **two correctly-identified rows**, one
per source, and the decline never fires.

Where the decline *does* live, and how it phrases itself:

| resolver | call sites | behaviour |
|---|---|---|
| `resolveLocalSite` (`site-resolver.ts:158`) | **52** | collision → `null` |
| `resolveLocalSiteResult` | 6 | collision → typed `{kind:'collision', message}` |
| `resolveAnySite` (`site-resolver.ts:344`) | 11 | collision → `{kind:'ambiguous', matches}` |

**47 of the 52** `resolveLocalSite` call sites phrase the `null` as some form of
*"not found"* — `Site "${args.site}" not found.` in `wpe-link.ts:26`,
`wpe-pull.ts:44`, `db-export.ts:26`, `scan-files-handler.ts:53`, and 43 more.
The docblock at `site-resolver.ts:154–157` already anticipates this: *"a caller
that wants to say it should use [the result form] instead of inventing a 'not
found'."* The invention is still there 47 times.

**But note what the 11 migrated call sites prove.** `get_index_status`
(`get-index-status.ts:28–36`) went through WP-58 and now says *"matches N sites
across sources — specify which one"*. So the decline reaches the tools an agent
would use to *inspect* a colliding site, and the wrong phrasing survives on the
tools that *act* on one. That ranking is defensible; it should be stated rather
than left to be discovered.

**Class: an honest absence for the Sites screen (it resolves by id), a real but
pre-existing defect for 47 tool call sites. Neither blocks the render.**

**One place it does bite the intelligence layer:** `chatAssembly.resolveTargets`
(`chatAssembly.ts:541`) calls `resolveLocalSite`, and on a collision returns
`{targets: []}` — the whole turn assembles with no entity targets and no
explanation. If a chat turn can ever be addressed by name rather than id, a
colliding site's assembly goes dark silently. **Filed, not fixed.**

---

## 5 · Which resolver does the UI actually use?

**Neither. It uses no resolver at all** — see Q4. `findLocalSiteExact` and
`resolveLocalSite` are both *tool/CLI/GraphQL* paths; the renderer's Sites data
is id-keyed end to end.

The divergence the question describes is real, and it is **already documented at
the seam** rather than hidden — `resolver-utils.ts:55–72` states it verbatim:
`findLocalSiteExact` is case-**sensitive** with no decline (used by ~20 resolvers
in `resolvers.ts`), `resolveLocalSite` is case-**in**sensitive and declines, and
the two are "not merged, deliberately" because merging them would silently make
every GraphQL and CLI lookup case-insensitive as a side effect. The residual is
named in the same block: *"the GraphQL path still has no collision decline."*

**This is the wrong question for the Sites IA**, and finding that out is the
result. It is the right question for a *different* screen — anything that accepts
a typed site name. Ranked as such.

---

## 6 · Is freshness per-PLACE or per-site?

**Per-place, structurally, with no ambiguity. This one is clean.**

`twin_facts`' primary key is `(entity_id, fact)` and it carries its own
`observed_at` per row. Measured: **419 distinct twin entities, every one of type
`env`. Zero twin facts exist on a `site` entity.** There is no per-site age in
the substrate to mistake for a per-place one, because there is no per-site fact
at all.

`buildSiteAtPlaces` already carries it onto the cell: `MatrixCell.observedAt`
(`siteAtPlaces.ts:92`), populated from `row.observedAt` and — the load-bearing
detail — **omitted with the value** when the place holds no such fact
(`siteAtPlaces.ts:325`, boundary 3 at :38–41). *"Last observed 2 hours ago"* is
a fact the substrate owns per row of the nested list.

The spread, so the design knows what it will actually render (`site.core`
`observed_at` vs now):

| place class | places | < 1 day | 1–7 days | > 7 days | oldest |
|---|---|---|---|---|---|
| WPE environment | 374 | 61 | 100 | **213** | 7.5 d |
| local copy | 45 | 4 | 2 | **39** | 7.9 d |

More than half of every place on this fleet would render an age over a week.
That is a truthful rendering of an 8-hour refresh schedule that has not covered
the fleet — but a design that assumed "2 hours ago" as the typical string should
know the typical string is "6 days ago".

**Class: no work. Rendering change, fully substrated.**

---

## 7 · What does `syncAllWPESites` actually write?

**Graph rows only. No entity links, ever.**

`WPESyncService.syncAllWPESites` (`WPESyncService.ts:117`) fetches installs from
CAPI, maps them (`:175–186`, including `wpe_site_id`), filters by account,
permission (`isOperationAllowed('wpcli_read', …)`, `:191`) and staleness
(`:214–218`), then fans out to `syncInstall` at concurrency 4. `syncInstall`
(`:334–445`) writes exactly four things: `graphService.upsertSite`
(`:404`), `deletePlugins` + `upsertPlugin` (`:408–420`), `upsertUser`
(`:424–435`), and — at the caller — `upsertAccount` (`:168`). It explicitly does
not index content (`:437–443`).

**Nothing on that path touches `entities`, `entity_aliases` or `entity_links`.**
The Site→Environment graph is built solely by `runSiteLinkMirror`, wired once at
`index.ts:819` behind `runStartupReconciliation` (`index.ts:816`), and there is exactly one
call site.

So the answer to Q1 is *not* decided by Q7 — the two are independent paths.
`syncAllWPESites` supplies the **grouping key** (`wpe_site_id`), and the mirror
turns it into the **grouping edge**, one restart later.

**Class: a real staleness window (measured: 9 rows out of date today), no
missing JOIN.** Calling `runSiteLinkMirror` at the end of `syncAllWPESites` as
well as at startup would close it; it is idempotent by construction
(`siteLinkMirror.ts:8–9`).

---

## 8 · Is any per-place number comparable across places?

**The architect's example is wrong, and a worse one is live.**

### 8a · "3 days behind production" is NOT arithmetic over the index

`contentDivergence` (`divergence.ts:388–412`) never reads a document count, a
post count, or the vector store. It reads the **timestamp of the newest
`episodic.sync.pulled` event that carried a database** and reports
`behindSeconds = age(pulledAt)`. With no such event it returns
`reason: 'no-recorded-sync'` and no number at all.

This is not an accident — it is a ruled design position, stated at
`siteContentStatus.ts:42`: *"How far behind the source this copy's content is.
**Time, never items** (finding №3)."*

**So the 200-row cap cannot poison the divergence line.** The screen's
"N days behind" is sourced entirely from sync timestamps, at both ends, by one
method. Q8's premise as written does not hold against the shipped comparator.

`codeDivergence` (`divergence.ts:424+`) compares `plugin:*` / `theme:*` twin
facts, which come from `wp plugin list` on both sides — same method, same shape.
Also comparable.

### 8b · The number that IS incomparable is "N events recorded"

`semantic.content.changed`: **2,550 events across 5 places — every one of them a
local copy. Zero WPE environments have one, and structurally none ever can**, because
that topic is fed by the MU-plugin webhook (`HttpEventInterface`) that exists only
on Local sites.

Events per place, by class (second reading, 40 minutes after the first):

| class | places | min | **max** | total |
|---|---|---|---|---|
| local copy | 47 | 1 | **2,542** (was 1,281) | 3,221 (was 1,960) |
| WPE environment | 374 | 1 | **122** (unchanged) | 11,890 (unchanged) |

**The drift between the two readings is the finding, not noise.** In forty
minutes the busiest local copy went from 1,281 events to 2,542 while every WPE
environment stayed exactly where it was. A board line reading *"1,204 events
recorded"* is read as activity. On this substrate a sandbox will always out-count
production — and out-*grow* it — by an order of magnitude, because the sandbox
has an instrument attached and production does not. **That is the same defect
class as `calculateStability`** in CLAUDE.md — "a constant 100 awarded for having
no data" — with the sign flipped again.

### 8c · Where the cap genuinely bites: document counts

WP-62 is **not yet cut** — no `wp-62` branch or worktree exists as of `13a6f5b3`.
So the measurement below is of the current state, as D7 reported it, confirmed
independently from the live index registry (`nexus-ai_index_registry.json`, 636
entries, 472 `indexed` / 164 `error`):

| class | entries | total docs | **max docs** | median duration | max duration |
|---|---|---|---|---|---|
| local | 323 | 82,016 | **68,858** (113,416 chunks) | 4.0 s | **775.3 s** |
| WPE | 307 | 7,736 | **200** | 23.7 s | 81.0 s |
| external | 6 | 298 | 102 | 4.7 s | 5.5 s |

The ceiling is visible in the data: **four installs sit at exactly 200**
(`psbtestcdn1`, `testmigratejpp`, `alpineoutfitte`, `cedarvalehealt`) and six more
at 197–199 — 200 minus the client-side `EXCLUDED_POST_TYPES` filter
(`RemoteContentExtractor.ts:70–72`). No local site sits at 200.

Three stacked truncations, all confirmed in source:

1. **Rows** — `--posts_per_page=200`, no offset loop (`RemoteContentExtractor.ts:54`).
2. **Documents** — one document per post, no chunking. `WPESyncService.syncContent`
   feeds `cleanedContent` straight to `embedBatch` in batches of 10
   (`WPESyncService.ts:513`), where the local path chunks at sentence boundaries
   (`ContentPipeline.ts:189`, `chunkPosts` at :334–404) with `EMBED_BATCH_SIZE = 16`.
3. **Fields** — the remote `--fields=` list (`RemoteContentExtractor.ts:53`) asks
   for no post meta; the extractor hardcodes `customFields: {}` (:102). The local
   path appends ACF custom fields into the embedded text
   (`ContentPipeline.ts:345–347`) via `fetchPostMeta`. **This one produces no
   count to be wrong** — it shows up as a search that quietly returns less.

**The rule to state on the design, and it is not the one about divergence:**
before any per-place number is rendered — document count, event count, "what
Nexus knows" — establish that the same instrument produced it at every place it
appears. Two of the three per-place numbers this substrate can supply today fail
that test, and the one the architect worried about passes it.

**Class: WP-62 (in scope, not started) for the counts; a design ruling for the
event count. Neither blocks boards A–D; both block any *comparison* drawn
between a copy row and an environment row.**

---

## 9 · What does "indexed" mean over time?

### Every sync is a full re-extract — at BOTH ends

- Remote: `RemoteContentExtractor.extract` (`:48–56`) — no `--post_status`
  cursor, no date filter, no `post_modified`.
- Local: `MySQLExtractor.extractPosts` (`:252–258`) —
  `SELECT … FROM wp_posts WHERE post_status='publish' AND post_type IN (…) ORDER BY post_date DESC`.
  No `WHERE post_modified >`, no `LIMIT`, and **`post_modified` is not even
  selected**.

### The delta key exists in the schema and is written empty

`VectorDocument` carries `post_modified_gmt`. `ContentPipeline.makeDocShell`
sets it to `''` at `ContentPipeline.ts:435`, alongside `post_date_gmt: ''` (:434)
and `doc_url: ''` (:436).
Verified live: in a sampled local doc table, **71 of 72 rows** have an empty
`post_modified_gmt`; in a sampled WPE table, 2 of 2.

**So: no delta mechanism exists, and the column that would carry one is present,
unpopulated, and unselected by the query that would fill it. Incremental sync is
new work at both ends** — not a wiring change.

### Cost, measured and projected

Current full-fleet WPE index: 307 installs at p50 23.7 s, concurrency 2 →
**~60 minutes**, for a fleet whose largest install is capped at 200 documents.

Under WP-62 parity, the multiplier is per-install and unbounded. Anchors from
the local path on this machine: `advanced-custom-fields` 3,280 chunks in 159 s
(≈21 chunks/s), `meridian` 1,542 chunks in 146 s (≈11 chunks/s), and the
outlier `sentinel-acfrecipestest-…` 113,416 chunks in 775 s. At the conservative
10–20 chunks/s band, a 30,628-post install (D7's `qwerky`) chunking at the
observed 1.3–1.65 ratio becomes **40,000–50,000 chunks ≈ 35–80 minutes for that
one install**, before SSH extraction of 30k post bodies. "Hours" is the right
order for the largest install; tens of minutes is the ordinary case.

### The schedule, and what happens when a run outlasts it

`startWpeContentIndexScheduler` (`index.ts:598–622`) is a bare
`setInterval(async () => { await indexAllWpeContent() }, hours * 3600_000)`.
Default 24 h (`index.ts:750`, `:1335`); **live on this machine
`wpeContentIndexAutoEnabled = true`, `wpeContentIndexIntervalHours = 24`.**

**There is no re-entrancy guard.** Grepping `WPESyncService.ts` for
`inFlight` / `isIndexing` / a running flag returns nothing, and `setInterval`
fires regardless of whether the previous callback has resolved. So the answer to
"overlap, skip, queue, or thrash" is: **overlap**, silently, with two
concurrent fleet passes each running 2 installs in parallel against the same SSH
gateway (whose per-user limit `syncAllWPESites` respects at 4 —
`WPESyncService.ts:242`, but `indexAllWpeContent` does not coordinate with).
At today's ~60 min fleet pass against a 24 h interval this never fires. Under
WP-62 parity it becomes reachable. **Filed, not fixed.**

Two further asymmetries worth carrying into WP-62: the remote embed loop
(`WPESyncService.ts:516`) has **no cancellation check**, where the local one
tests `this.activeSites.has(siteId)` every batch (`ContentPipeline.ts:197`); and
the remote batch size is 10 against the local 16.

### The honest sentence — and yes, it needs a third form

Today `get_index_status` (`get-index-status.ts:45–52`) prints `**Documents:**
${entry.documentCount}` flat. On a truncated install that is a complete-looking
number for an incomplete index — the exact silence WP-62 is registered to break.

But WP-62 only fixes *stated truncation*. The screen has a harder problem:
**"fully indexed" is a state a large site reaches hours after a sync starts and
loses on the next content change.** The four-state vocabulary already shipped for
the *content-age* line handles exactly this shape and should be the template —
`ContentState = 'pulled' | 'no-sync' | 'ambiguous' | 'unlinked'`
(`siteStatus.ts:57`), each with its own rendered sentence at `:163–180`, and
`null` deliberately kept as a distinct fourth answer meaning "Nexus is not
recording" rather than "nothing to report" (`siteContentStatus.ts:20–24`).

**A partial stated with its reason is the third form, and the precedent for
building it is in the repo.** Candidate states, following that model:

- *indexed* — the whole site, method stated
- *partial* — "N of at least M; the last extraction stopped at the page limit"
- *stale* — indexed at T, content has changed since (**requires the delta
  mechanism that does not exist** — until then this state is unreachable and must
  not be drawn)
- *not indexed* / *never looked* — with the reason

**Class: WP-62 for the truncation flag; a design ruling for the partial
sentence; new producer work for `stale`. The screen ships without `stale` and
says so.**

---

## THE TENSION — how deep does source-as-partition go?

Not resolved here, per instruction. **Measured:**

| axis | count |
|---|---|
| SQL predicates on `sites.source` (non-test) | **107**, across **39 files** |
| distinct predicate shapes | `IN ('wpe','external')` × 26, `= 'wpe'` × ~15, `= 'external' AND is_active = 1` × 12, `IN ('local','wpe','external')` × 2, `= 'local'` × 2 |
| TypeScript declarations of the `'local'\|'wpe'\|'external'` union | **21** |
| runtime branches on a source value (`if`/ternary/switch) | **41** |
| stored shapes carrying `source` as a field | `graph.sites.source` (column), `SiteRow.source` (`fleet/siteRows.ts:7`), `EnvironmentDescription.host` (`taskFrame.ts:50`), `ScopePlace.host` (`procedureScope`), vector-store table-name prefix (`vectorSiteId`) |

**The screen the IA replaces is built on the axis directly.** `SitesTab.tsx`
declares `type HostFilter = 'all' | 'local' | 'wpe' | 'external'` (:20), a
`SOURCE_LABELS` map turning the raw value into "This Mac" / "WP Engine" /
"External" (:49–53), and a four-button `FILTERS` bar (:55–60).
`buildSiteRows` (`siteRows.ts:78–144`) is literally two loops over two
populations, with the comment at :112–114 forbidding `!== 'local'` and the
knowledge ladder itself parameterised by source (`toKnowledgeRung(…, source)`,
:100–106, :132).

**Cost of each answer, stated rather than chosen:**

- **Keep source as the tool axis, drop it from the screen.** Cheapest.
  `buildSiteAtPlaces` already does this — its columns are
  `{host:'wpe',kind:'production'|'staging'|'development'}` plus one `{host:'local'}`
  (`COLUMN_ORDER`, `siteAtPlaces.ts:156–161`), so *source has already stopped
  being a filter and become a place* in the shipped comparator. The 107 SQL
  predicates are untouched; only `SitesTab` and `buildSiteRows` change. The
  residue: `SiteRow.source` stays and is still the correct field for the tools —
  two representations of one fact, which this repo has paid for before.
- **Make place primary everywhere.** Expensive and unbounded: 107 predicates, 21
  type declarations, 41 branches, and the `source-semantics.test.ts` pin WP-60
  put over the whole value set is a *guard against* this change, not a helper for
  it.
- **Do nothing.** The screen states a topology the model says is not one, and
  every new fleet query keeps inheriting the axis.

The tension does not obstruct item 6. `buildSiteAtPlaces` is the existence proof
that a place-primary render sits on a source-primary substrate without a
migration — with the honest limit that it states its own reach
(`verdictCoverage`, `siteAtPlaces.ts:130–136`).

---

## WHAT THIS FLEET CANNOT ANSWER

Stated per the vacuous-guard warning. A measurement on a fleet where the case
does not occur proves nothing.

| question | present? | if absent, the case that would answer it |
|---|---|---|
| 1 · WPE-only Site entity | **present ×365** | — |
| 1 · external host in the Site graph | present ×3, all failing | — |
| 2 · multi-env grouping | **present ×71** (45 pairs + 26 triples) | — |
| 3 · a copy that pulled from TWO different environments | **ABSENT** — 2 pulls, on 2 distinct copies | pull one local site from production, then from staging; assert exactly one `content_pulled_from` edge survives (`linkExclusive`) |
| 3 · `episodic.sync.pushed` | **ABSENT** — zero events | push a local site to staging; assert the pointer does **not** move (`syncProducer.ts:171–178`) |
| 3 · a git-backed environment / `code_ref` | **ABSENT** — unproduced; `siteStatus.ts:35` says so | the "Code: the X branch" line has never rendered on any fleet. **Honest absence**, already handled by an omit |
| 4 · collision reaching a Sites-surface action | **structurally absent** — the surface is id-keyed | to make it occur you would have to introduce a name-addressed action, which is the thing not to do |
| 8 · a WPE install genuinely over 200 posts | **present** — 4 at exactly 200, 6 at 197–199 | the *magnitude* is not measurable from here. Only `wp post list --format=count` per install would give it, which is 365 SSH calls into production. D7's `qwerky` at 30,628 is the anchor; this document did not re-measure it |
| 9 · a scheduler run outlasting its interval | **ABSENT** — ~60 min pass vs 24 h interval | set `wpeContentIndexIntervalHours` below the fleet pass time, or land WP-62 parity, and observe whether two passes overlap. The absence of a guard is verified from source; the *consequence* is not observed |
| 9 · the `stale` index state | **unreachable** — no delta mechanism exists | cannot be constructed without new producer work |

---

## DEFECTS FILED, NOT FIXED

Per scope discipline. None blocked a measurement.

1. **`siteLinkMirror` excludes external hosts** — `siteLinkMirror.ts:86`
   (`WHERE source = 'wpe'`). All 3 external hosts have twin facts and zero Site
   edges; they are dropped by every Site-relational reader. *Missing producer.*
2. **The Site role is split across two entity families.** The three high-volume
   producers stamp `siteEntityId(entities, siteId)` — the
   `local.site_id.logical` namespace — at `graphServiceTap.ts:60,92,125`,
   `graphBackfill.ts:109,144,178` and `wpEventProducer.ts:42`, while the mirror
   builds the Site graph under `wpe.site_id`. Measured fleet-wide:

   | the site-role entity named by the event | distinct | **events** |
   |---|---|---|
   | a Site **with** environments | 93 | 343 (2.6%) |
   | a Site with **zero** environments | 330 | **12,617 (93.8%)** |
   | not registered in `entities` at all | 91 | 490 (3.6%) |

   Worked example — one property, three installs:
   `benfischer` / `benfischer1stg` / `benfischerdev` share
   `wpe_site_id = 06d82b45-…`. The mirror's Site `ent_site_VF64450Q2EYRQFSKGPMYWTFEPC`
   has **3 environments and 7 events**. The three producer Sites have **0
   environments and 123 events between them.**

   **This is known and worked around, not hidden** —
   `chatAssembly.ts:571–577` states it exactly: *"routing episodic at the
   relational Site would query an id no event carries and the history would go
   dark."* `syncProducer.resolveSite` (:227–235) is the one producer that tries
   `siteOf()` first.

   **Consequence for item 6:** a Site card that renders *both* "N environments"
   and "the history of this Site" reads two different nodes. The nesting works;
   the Site-scoped episodic thread (ADR-22's episodic row) does not. *Producer
   reconciliation, additive — dual-stamp both ids, or union at the reader.*
3. **91 site-role entity ids appear on 490 events and are absent from
   `entities`** — the pure `provisionalSiteId` fallback firing before the entity
   service is up. Environment-role ids: 0 unregistered. *Ordering defect.*
4. **`indexAllWpeContent` has no re-entrancy guard** and its scheduler is a bare
   `setInterval` (`index.ts:598–622`). Unreachable today; reachable after WP-62.
5. **47 of 52 `resolveLocalSite` call sites phrase a collision decline as
   "not found."** Pre-existing, named in the resolver's own docblock
   (`site-resolver.ts:154–157`).
6. **`chatAssembly.resolveTargets` returns `{targets: []}` on a collision**
   (`chatAssembly.ts:541`) — a silently dark assembly.
7. **`runSiteLinkMirror` is startup-only** (`index.ts:819`), so the Site graph
   lags `syncAllWPESites` by one restart. Measured drift today: 9 rows.
8. **`resolveUpstream` ties on flat 0.95 confidence** (`divergence.ts:303`,
   fed by `siteLinkMirror.ts:110`) and therefore declines on exactly the
   multi-environment Sites the IA is for. 6 of 6.

---

## SUMMARY TABLE — blocker, or honest absence?

| # | finding | class |
|---|---|---|
| 1 | WPE Site entities exist, 374/374 | ✅ substrated |
| 1 | 25 of 45 local copies + 3 of 3 external hosts have no Site | **producer** (mirror coverage; `site_links` reach) |
| 2 | `wpe_site_id` groups 365 installs into 268 properties | ✅ substrated |
| 3 | 2 recorded pulls; 12 resolve by traversal; **6 decline on the multi-env case** | **reader** (env-kind tie-break) |
| 4 | Sites surface is id-keyed; decline never fires there | ✅ / honest absence |
| 5 | two front doors disagree — but neither is the Sites surface | wrong question; ranked elsewhere |
| 6 | freshness is per-place, per-fact, with honest omission | ✅ substrated |
| 7 | `syncAllWPESites` writes graph rows only; mirror is startup-only | **wiring** (one extra call) |
| 8 | divergence is time-not-items → the cap does **not** poison it | ✅ / premise refuted |
| 8 | "N events recorded" is structurally incomparable across place classes | **design ruling** |
| 8 | document counts truncated three ways | **WP-62** (registered, not started) |
| 9 | full re-extract at both ends; no delta key populated | **new producer** — `stale` unshippable |
| 9 | no re-entrancy guard on the index scheduler | **defect**, unreachable today |
| — | source-as-partition: 107 SQL predicates / 39 files / 21 types / 41 branches | measured, **not resolved** |

**No missing JOIN was found.** `entities.siteOf()` (`entityService.ts:307–318`)
is the join, it exists, and it resolves 374 of 374 WPE environments. Every
remaining gap is something that does not yet *write*, or a sentence nobody has
yet ruled on.
