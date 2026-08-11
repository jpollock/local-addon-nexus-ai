# Canonical Demo Sites — Meridian Data & Cedar & Vale Health

**Created:** 2026-08-09
**Status:** Design approved, not yet implemented
**Repository:** `~/development/wpengine/canonical-demos/`
**Precedent:** `2026-07-27-alpine-outfitters-design.md`

---

## Executive Summary

Two new canonical demo properties join Alpine Outfitters, chosen to cover four
capability gaps Alpine cannot reach. Each property must satisfy **both jobs at
once** — showable on a stage to a GTM audience, and rigorous enough to serve as a
test bed. No site compromises one for the other, which is why there are two
properties and not four.

| Property | Vertical | Gaps covered |
|---|---|---|
| **Meridian Data** | B2B SaaS (data observability) with a content engine | B2B funnel/pipeline + publisher scale |
| **Cedar & Vale Health** | 25-location dermatology group | Multi-location network + regulated vertical |

The four gaps pair naturally: nobody runs a 5,000-article publisher without a
business model behind it, and a multi-location clinic group is a regulated
vertical by construction.

**Design principle running through both:** every claim a demo makes must be
computable from a structured field, not inferred from prose. Content
intelligence over unstructured text is a parlor trick; over a modeled corpus it
is a product.

---

## 1. Portfolio Architecture

### 1.1 Repository layout

```
canonical-demos/
  alpine-outfitters-demo/     ← existing, untouched
  meridian-data-demo/
  cedar-vale-health-demo/
  shared/                     ← generator library
    ai-client/                (checkpointing, model preflight, budget)
    faker-helpers/
    seed/
    wp-cli/
    normalize/                (acf-mappers, relationships, internal links)
    importers/                (two-pass import, verify gate)
    design-system/            (shared tokens + block patterns)
```

`shared/` is **lifted from** Alpine's `scripts/`, not moved out of it. New sites
depend on `shared/` from day one; Alpine keeps its own copy and keeps working.
Migrating Alpine onto `shared/` is a separate decision for a separate day — this
spec does not imply a convergence that never happens.

### 1.2 Cedar & Vale is 25 locations across 8 single-site installs

Not 25 installs, and **not WordPress multisite**. See §7.1 for why multisite was
rejected.

- **The flagship** (`cedarvale.local`) carries all 25 locations as structured
  `location` entries. This is the structured-data and regulated story on one site.
- **The fleet** is 7 genuinely separate installs — acquired practices that kept
  their own sites, which is what actually happens in clinic groups and franchise
  networks. Generated from one blueprint, then deliberately skewed (§4.2).

The asymmetry *is* the demo. Twenty-five identical clean installs prove nothing;
a corporate site plus seven inherited strays is the mess `detect_drift` and
`compare_sites` exist to find.

### 1.3 Source matrix

Both properties together must populate all three values of `sites.source`, so
fleet queries are exercised on `IN ('local','wpe','external')` rather than the
WPE-only path:

| Source | Where |
|---|---|
| `wpe` | Flagship production install per property (carries IW/Power + the real analytics pipes), plus Cedar fleet sites A and B |
| `local` | Cedar fleet sites E and F; development clones; the demo laptop |
| `external` | Cedar fleet sites C, D and G, on one SpinupWP server |

**Amended 2026-08-11.** This table previously put a single site (`D`) on an
external host and left the rest unassigned. The three-way split is deliberate,
and each placement is forced by something:

- **`local` is forced for E.** `CV-E-01` is "halted," and halted is a Local-only
  concept — `getSiteStatus` has no remote equivalent and Nexus never starts or
  stops a remote host. E cannot live anywhere else and remain the pathology it is.
- **`external` is forced for C.** `CV-C-01` is two WP majors behind with ACF 5.x.
  A self-managed cloud server is the honest home for an unpatched install; it is
  also the only tier where nothing upstream will quietly fix the defect between
  demos.
- **Three external sites on ONE SpinupWP server, not three servers.** One server
  is still correct — it is cheaper and it is how a self-managed fleet actually
  looks. Whether that server yields *one* SSH connection or three is a separate
  question, settled below.

**How many SpinupWP aliases — measured 2026-08-11, on the live server.** This
bullet originally required one alias serving all three sites, on the grounds
that the resulting `ssh:<alias>/<site>` multi-site form is the shape that
collided in `vectorSiteId()`. Both halves of that reasoning turned out to be
wrong.

SpinupWP isolates each site behind its own system user, and on
`myfirstserver` (159.65.76.95, Ubuntu 26.04, WP-CLI 2.12.0, PHP 8.3.33):

- `/sites` carries an ACL granting `group:site-users:--x` — traverse, not list.
- `wp-config.php` is `-rw-------` (0600), owner only. No group bit, no other
  bit, no ACL entry.
- The sudo user is `spinupwp` (uid 1000, the only member of `sudo`); each site
  user is separate (`cedarvale-spin`, uid 1001).

So no user other than a site's own owner can read that site's `wp-config.php`,
and without it `wp` cannot bootstrap. The sudo user could only reach it through
`sudo`, and **Nexus never sudos** — nor should it. One alias covering three
independently-owned sites is therefore not achievable on SpinupWP without
loosening a permission that is correctly set.

The second half was also wrong: **the multi-site form is already exercised in
the live fleet.** The registered Hostinger connection carries two sites,
`ssh:hostinger-test/palegreen-capybara-114180` and
`ssh:hostinger-test/mediumslateblue-hyena-983322`, under one alias and one
`account_id`. The `vectorSiteId()` regression target exists whether or not
SpinupWP adds another.

**Decision, settled 2026-08-11: three sites, three site users, three aliases** —
SpinupWP's own model, and nothing real is lost. The shared-user escape hatch was
checked and is not offered: SpinupWP created a separate system user per site.
The three are live and verified — `willowcreekderm`, `piedmontdermgroup` and
`tablemesaderm`, each WordPress 7.0.3 at `/sites/<domain>/files`.

`probeExternalHost` needs no change to discover them: its `SEARCH_ROOTS` already
covers `"$HOME"` to depth 4 and SpinupWP puts `wp-config.php` at `$HOME/files/`,
depth 1; WP-CLI is at `/usr/local/bin/wp`, the first `WP_CLI_FALLBACK_PATHS`
entry. Do not add a SpinupWP-specific search root.

**SpinupWP is a WP Engine product** (via the 2022 Delicious Brains acquisition),
so a fleet spanning WP Engine, SpinupWP and Local is three WP Engine surfaces —
not a WP Engine site next to two competitors. To Nexus's code, however, SpinupWP
is simply an SSH-reachable non-WPE host: `source='external'`, identical path to
the existing Hostinger connection. It adds narrative and multi-site coverage, not
a new transport.

**Prerequisite status, updated 2026-08-11 — infrastructure complete.**
`myfirstserver` at 159.65.76.95 (DigitalOcean, Ubuntu 26.04 LTS) is provisioned,
with WP-CLI 2.12.0 and PHP 8.3.33 installed globally. All three sites exist,
each WordPress 7.0.3 with its own system user, ssh alias and `0600`
`wp-config.php`:

| Site | Alias / user | Docroot |
|---|---|---|
| C — Willow Creek Dermatology | `willowcreekderm` | `/sites/willowcreekderm.com/files` |
| D — Piedmont Dermatology Group | `piedmontdermgroup` | `/sites/piedmontdermgroup.com/files` |
| G — Table Mesa Dermatology | `tablemesaderm` | `/sites/tablemesaderm.com/files` |

All three verified end to end over their own alias (`id`, `wp core version`,
`wp option get siteurl`, `php -v`). None of the domains resolves and none needs
to — SpinupWP serves each on a `Host` header.

**Two residuals.** The `cedarvale-spin.com` provisioning placeholder is a fourth
site on the server and must be deleted, or the fleet shows an unexplained fourth
`external` row. And nothing on this server is registered with Nexus yet — the
three `external` rows in the graph are still all Hostinger — because
registration happens after seeding, so the sites are labelled `production` only
once they hold their content.

**Seeding does not go through Nexus's write gate, and that is the point.**
`wpcli` (write) is refused on `production` by default, on both WPE and external
targets; only `wpcli_read` is allowed there. The corpus import is therefore a
build step run with each host's own tooling — `local_wpe_push` from a Local
build for WPE, the server's own WP-CLI over SSH for SpinupWP. The sites are then
registered in Nexus as `production`, where the refusal to write to them is a
capability to demonstrate rather than an obstacle to route around. Do not
register a fleet site as `development` merely to make an importer run.

---

## 2. Meridian Data

### 2.1 Content model

| Type | Count | Structured fields that matter |
|---|---|---|
| `post` (article) | 5,000 | `topic_cluster`, `funnel_stage`, `target_keyword`, `search_intent`, `last_reviewed`, `primary_cta`, `content_status` |
| `doc` | 400 | hierarchical; `doc_type`, `applies_to_version`, `product_area`, `code_language` |
| `integration` | 60 | `category`, `auth_method`, `setup_time`, `tier_required` — an SEO asset and an entity graph at once |
| `glossary` | 120 | `related_terms`, `product_area` — cheap, large internal-link surface, ideal semantic-search target |
| `case_study` | 24 | `industry`, `company_size`, `use_case`, before/after `metrics`, `plan_tier` |
| `resource` (gated) | 18 | `asset_type`, `gate`, `form_id`, `mql_weight` — the funnel's structured core |
| `comparison` | 15 | `competitor`, `feature_matrix` (repeater), `win_themes` |
| `plan` | 3 | `price_monthly`, `seat_included`, `features` — pricing as data, never baked into HTML |
| `author` | 14 | credentials, for provenance |
| `page` | 40 | solutions by role and industry, legal, careers |

**Taxonomies:** `topic_cluster` (12 pillars, hierarchical), `funnel_stage`
(TOFU/MOFU/BOFU), `product_area`, `persona`, `industry`, and `content_status`
(`evergreen | needs-refresh | decaying | retire-candidate`) — deliberately
populated so refresh-vs-retire recommendations have ground truth to be graded
against.

### 2.2 Engineered pathologies

Every one is queryable through a structured field:

| Id | Pathology |
|---|---|
| `MD-CANN-01..03` | 3 cannibalization clusters (4–6 articles per keyword, near-identical intent) |
| `MD-DECAY-01` | ~1,400 articles with `last_reviewed` > 24 months; a cohort with monotonically declining sessions |
| `MD-ORPH-01` | 40 orphans with zero internal inbound links |
| `MD-LINK-01` | 12 broken internal links; 30 redirect chains |
| `MD-DOC-01` | 6 docs whose `applies_to_version` predates the current release |
| `MD-THIN-01` | 200 articles under 400 words |
| `MD-META-01` | 60 posts sharing duplicate meta descriptions |

---

## 3. Cedar & Vale Health

### 3.1 Content model (flagship)

| Type | Count | Structured fields that matter | Schema.org |
|---|---|---|---|
| `location` | 25 | structured address, `geo`, `hours` repeater, `insurance_accepted`, `providers`, `services_offered`, `accepting_new_patients`, `place_id` | LocalBusiness / MedicalClinic |
| `provider` | 60 | `credentials`, `board_certifications`, `npi`, `license_state`, `languages`, `locations`, `bio_reviewed_by` | Physician |
| `treatment` | 45 | `category`, `conditions_treated`, `downtime`, `price_range_by_location`, `insurance_covered`, `reviewed_by`, `review_date` | MedicalProcedure |
| `condition` | 80 | `icd10`, `symptoms`, `related_treatments`, `reviewed_by`, `review_date` | MedicalCondition |
| `post` (patient ed.) | 600 | `reviewed_by`, `review_date`, reading level | Article |
| `insurance_plan` | 30 | carrier × plan type, per-location acceptance | — |
| `page` | 30 | — | — |

**Taxonomies:** `metro` (4), `body_area`, `condition_category`,
`treatment_category`, `provider_specialty`, `language_spoken`, `review_status`
(`reviewed | overdue | unreviewed`).

### 3.2 Engineered drift across the 7 legacy sites

One pathology per site, so every fleet tool has a target:

| Id | Site | Host | Planted defect | Proves |
|---|---|---|---|---|
| `CV-A-01` | A | WPE | `openingHoursSpecification` missing entirely | Schema governance at scale |
| `CV-B-01` | B | WPE | Lists a provider who left 14 months ago — who also remains on the flagship roster | Cross-site contradiction (person) |
| `CV-C-01` | C | SpinupWP | Two WP majors behind, ACF 5.x, one abandoned plugin | `detect_drift`, update exposure |
| `CV-D-01` | D | SpinupWP | 4 clinics whose address and phone contradict the flagship's records for the same clinic | Cross-site contradiction (place); NAP integrity |
| `CV-E-01` | E | Local | Halted | Halted ≠ missing |
| `CV-F-01` | F | Local | 40 pages copy-pasted verbatim from the flagship | Cross-site cannibalization |
| `CV-G-01` | G | SpinupWP | 8 treatments with `review_date` > 36 months; 3 with no reviewer at all | Quantified compliance exposure |

**`CV-D-01` was rewritten on 2026-08-11.** It used to read "runs on an external
SSH host, not WPE." Once §1.3 put three sites on SpinupWP, that stopped being a
defect and became an address — a pathology every third site shares is not a
pathology. `source='external'` end to end is still proven, by the Host column
rather than by a row of the defect table. D now carries the *place*-level
contradiction that pairs with B's *person*-level one: same clinic, two different
addresses and phone numbers across two installs, each internally consistent.
Inconsistent name/address/phone across a multi-location group is the canonical
local-SEO defect for exactly this kind of business, and unlike A's missing
schema it cannot be found by validating one site.

`CV-B-01` remains the strongest beat in either property: nothing on any single
site is detectably wrong. The contradiction exists only at fleet level, which is
the entire argument for fleet intelligence. `CV-D-01` is the same argument made
against structured field *values* rather than a roster, so `compare_sites` is
exercised on both shapes.

---

## 4. Integrations, History, and the Value Layer

### 4.1 What can be real, and what cannot

| Source | Status | Why |
|---|---|---|
| On-site forms, orders, subscriptions | **Observed** | Real rows in real WordPress tables |
| WPE access logs (`log-processor`) | **Observed** | Real requests to the real install; genuine traffic evidence, zero seeding |
| GA4 | **Real pipe, seeded history** | Measurement Protocol honors `timestamp_micros` only within ~72h |
| Search Console | **Real pipe, seeded history** | Accrues forward only; 2–3 day lag; weeks before it is interesting |
| CRM (HubSpot) | **Observed, backdatable** | `createdate` is settable on contacts and deals — the one integration whose history is not a compromise |
| ESP campaigns | **Real pipe, seeded history** | Sends cannot be backdated |
| Ad platforms | **Seeded only** | Real spend requires real billing |
| Google Business Profile / local pack | **Seeded only** | GBP verification requires real physical addresses. Fictional clinics cannot have real listings. |
| Call tracking | **Seeded only** | Same reason |

The GBP line deserves attention: Cedar's local-visibility story is the one place
where the most demo-attractive number is the least real. Designed in the open
here rather than discovered on stage.

### 4.2 The seeded-history seam

Seeded history lives as fixtures in each demo repo (`data/analytics/*.json`),
loaded by an explicit `demo:seed-history` command into the agent's own store via
`AgentDbManager`.

**Rules, non-negotiable:**

1. Every seeded row carries `origin` **explicitly, with no default**. A writer
   that forgets it fails, rather than silently minting observed data.
2. A seeded row is never presented as observed.
3. Any aggregate spanning both tiers reports the split.

This is the same rule the codebase already enforces elsewhere: `php_version`
must be NULL rather than a fabricated `'8.0'`; coverage is reported, never
implied. A fixture layer that is honest and slightly less impressive beats a
demo that quietly lies — the second kind gets discovered by the one prospect who
checks.

### 4.3 Value layer

Every number traces to a source tier: `observed`, `seeded`, or `modeled`.

**Meridian — pipeline economics**

- Content-attributed pipeline: article → gated `resource` → MQL → deal, through
  real backdated CRM records. Makes "these 12 articles produced $2.1M of
  pipeline and these 1,400 produced nothing" computable rather than asserted.
- Content debt cost: 1,400 stale articles carrying maintenance cost against
  attributed pipeline → a ranked refresh-vs-retire list with a dollar figure per
  decision.
- Cannibalization cost: 3 clusters splitting impressions, with a consolidation
  forecast.
- Docs deflection: docs sessions against support volume → support cost avoided.

**Cedar & Vale — local demand economics**

- Booking rate: real form entries ÷ sessions, per location, per month.
- Insurance mismatch: each location's `insurance_accepted` against what patients
  searched → estimated denials and no-shows.
- Roster accuracy → patient leakage, anchored on `CV-B-01`.
- Compliance exposure: pages past `review_date` × risk weight.

### 4.4 Agent coverage

Falls out of the models without extra work: `web-analytics` on both properties,
`seo-insights` on Meridian's 5,000 articles, `security-sentinel` against Cedar's
genuinely neglected legacy installs, `log-processor` on the WPE production logs.

---

## 5. Presentation Layer

**Block themes, not classic PHP.** One per property, both on a shared
`design-system/` of tokens and patterns, with `theme.json` as the single source
of design truth.

**Block Bindings API** (WP 6.5+, mature on 7.0) binds ACF fields directly to
block attributes, so the structured data renders the page — a provider's
credentials, a treatment's downtime, an integration's auth method — instead of a
PHP template reaching into meta. For a demo arguing "structure your content and
intelligence follows," having the structure drive presentation is the strongest
available proof, and editors see it live in the block editor.

**Deliberately divergent art direction**, because two sites from one system with
swapped hex values read as one site twice:

- **Meridian** — dense, data-forward, confident. Dark-surface accents, tabular
  figures, real charts in case studies, monospace for code and metrics.
- **Cedar & Vale** — warm, calm, generous whitespace, high-contrast typography,
  WCAG 2.2 AA as a floor.

**Imagery** via the gateway's own image models (`gpt-image-1`, Imagen 4): hero
art per topic cluster (12, not 5,000), location photography for the 25 clinics,
abstract textures for the long tail.

**One deliberate exception:** provider headshots stay **illustrated or abstract,
never photorealistic.** Sixty AI-generated photorealistic faces presented as
board-certified dermatologists is an asset that looks fine in a demo and
indefensible the moment a screenshot travels without context.

**Performance and accessibility are acceptance criteria, not polish.** Both
properties make SEO and content-quality claims; a demo that fails Core Web
Vitals while advising on SEO refutes itself in the dev tools of anyone curious
enough to look. Green CWV and AA contrast gate each design milestone.

The `frontend-design` skill is invoked at build time per theme — design
decisions want the real content in front of them.

---

## 6. Generation Architecture

Alpine's generation run died mid-flight on a bad model id and lost its progress,
and its README still advertises 300 posts against 60 on disk. Both are design
inputs here, not trivia.

- **Checkpointed and resumable** — per-item append-only JSONL progress plus
  `--resume`. A crash costs one item, not a run.
- **Model preflight** — a one-token validation call before spending an hour.
  Alpine burned a run on `claude-sonnet-4-5@20250929`, a Vertex-shaped id sent to
  the Anthropic API.
- **One `--seed` drives everything** — faker, sampling, pathology placement. A
  regenerated corpus is byte-identical, which is what lets tests assert on it.
- **A manifest is the source of truth for counts**, and `verify` **fails** when
  actual ≠ manifest. That gate is what would have caught Alpine's 300-vs-60 drift
  before it reached a README.
- **Two tiers declared by manifest, not by flag** — `hero` (AI-written) vs
  `composite` (template + faker).
- **Hard token budget** with an up-front estimate and a written report on abort.
- **Idempotent import** keyed on a stable `_demo_uid` in postmeta, so re-running
  updates instead of duplicating. Alpine needed a dedup fix for exactly this.
- **Import reuses Alpine's proven shape** — seeder-plugin WP-CLI commands,
  Pass 1 posts + ACF, Pass 2 relationships, `syncterms`, then the `verify` gate.

### 6.1 Known limitation carried into Plan 1b: undeclared content is not detected

`verifyCounts` (shipped in `shared/`) reports undeclared content as a mismatch
(`expected: 0, actual: N`), and its tests cover that direction. But `verifySite`
— the only production caller — builds its actual-counts map by asking the site
**only about post types the manifest declares**, so that capability is currently
unreachable: a site carrying 40 posts of an undeclared type passes verification
silently. Under-count drift (the 300-vs-60 case) is caught; over-count and stray
content are not.

**Three further obligations Plan 1b inherits from `shared/`** (full list in the
library plan's Post-Merge Follow-Ups):

- **Plan 1b's import script must call `assertReport`**, the fail-closed
  verification entry point. `verifySite` returns a report and never throws, so
  the rule above ("`verify` **fails** when actual ≠ manifest") is enforced only
  by the caller. An importer that prints `formatReport` and proceeds ships
  exactly the drift the gate exists to prevent.
- **`expectedCounts` returns a null-prototype object** — deliberate, to close a
  fail-open `__proto__` hole — so do not call `.hasOwnProperty()` or
  `.toString()` on it, and do not `toStrictEqual` it against an object literal.
- **The token budget can overshoot by one call's real input usage.**
  `assertAffordable` bounds output tokens (`maxTokens`) only, so a long prompt
  can push spend past the limit with the abort arriving on the next call. It
  fails closed. Resume correctness requires constructing
  `new TokenBudget(limit, checkpoint.loadSpentTokens())`.

Ruled on 2026-08-09: **defer to Plan 1b**, where the importer lives — "did we
create anything we didn't declare" belongs beside the code that creates things.
Closing it needs a post-type enumeration call plus an exclusion filter for
WordPress built-ins (`attachment`, `revision`, `nav_menu_item`, `wp_block`,
`wp_template`, `wp_global_styles`, …). That exclusion list is a design decision
that will drift with WordPress releases, not a one-line addition, and getting it
wrong makes every site report spurious mismatches. A `strict?: boolean` gate on
`verifySite` is one candidate shape.

**Generation split:** AI-written ≈ 900 pieces on Meridian (300 hero articles, all
400 docs, 120 glossary, 60 integrations, 24 case studies) and ≈ 400 on Cedar (60
providers, 45 treatments, 80 conditions, plus ~215 hero patient-education posts;
the remaining ~385 patient-ed posts are composite). Everything else is composite,
with real entities and real internal links but shallow prose. The vector store,
fleet queries and decay curves cannot tell the difference; a screenshot can,
which is why the hero tier covers every surface a demo touches.

**This spec states plainly that Meridian's 5,000 articles are not 5,000
hand-quality articles.** Any later claim otherwise is wrong.

---

## 7. Decisions Recorded

### 7.1 WordPress multisite was rejected

Three reasons:

1. **It would delete the story.** In a network, plugins and core are managed
   network-wide, so there is structurally almost nothing to drift.
   `detect_drift` and `compare_sites` would return "all subsites identical" —
   true and useless.
2. **Nexus is multisite-blind today.** Nine references in the codebase, all
   detect-and-report: `FileScanner.detectMultisite()` sets `isMultisite`,
   `get_site_structure` prints it, `SiteDigitalTwin` carries the flag. There is
   no subsite traversal — zero `blog_id` handling and not one `--url=` passed to
   WP-CLI in `src/`. A multisite Cedar & Vale would appear to our own product as
   one site, and 24 of 25 locations would be invisible to the index, the twin,
   and every fleet query.
3. **It is not how these groups end up.** Acquired practices keep their sites,
   their hosting, and their plugin choices.

**Noted as a product gap, explicitly out of scope here:** multisite is a real WPE
segment (agencies, universities, franchise networks) and Nexus can currently see
that a site *is* multisite without seeing into it. The right response is a small
purpose-built multisite fixture forcing subsite support through the index, twin,
and fleet queries. That is its own spec.

### 7.2 Other decisions

- **Alpine is not migrated** onto `shared/` as part of this work.
- **Ad spend and GBP data are seeded and labeled**, never presented as observed.
- **Visual polish trails content** (§8), with `content-complete` and
  `demo-ready` as two distinct states so trailing does not mean never.

---

## 8. Phasing

| | Milestone | Rationale |
|---|---|---|
| **M0** | `shared/` lifted, both scaffolds, manifests, no content | Proves the pipeline before spending tokens |
| **M1** | Cedar flagship — 25 locations, 60 providers, treatments, conditions | Cheapest real corpus; structured-data story stands alone |
| **M2** | Cedar fleet — 7 installs incl. external SSH + halted; pathologies injected | The differentiated story, on freshly shipped external-host work |
| **D1** | Cedar design pass | Trailing; gated on green CWV + AA |
| **M3** | Meridian core — docs, integrations, glossary, funnel, 300 hero articles | Funnel + docs search |
| **M4** | Meridian long tail — 4,700 composites, decay + cannibalization | The expensive step, after the machinery is proven |
| **D2** | Meridian design pass | Trailing; gated on green CWV + AA |
| **M5** | Real pipes — GA4/GSC/CRM, seeded history, value layer | Blocked on domains (§9) |

Cedar leads deliberately: smaller corpus, faster to something showable, and it
exercises the external-host path while that work is fresh.

**`content-complete` ≠ `demo-ready`.** A property reaches `demo-ready` only after
its design milestone passes. Alpine is the cautionary case: structurally sound,
visually a wireframe, and therefore never quite demo-ready.

### 8.1 This spec is a program, not one plan

M0–M5 is too much for a single implementation plan. It decomposes along the
property boundary, and each piece gets its own plan → implementation cycle:

| Plan | Covers | Independently valuable? |
|---|---|---|
| 1 | M0 + M1 + M2 + D1 — `shared/` and all of Cedar & Vale | Yes — a complete demo property |
| 2 | M3 + M4 + D2 — all of Meridian Data | Yes — a second complete property |
| 3 | M5 — real pipes and the value layer across both | Only after 1 and 2; blocked on §10 |

Plan 1 is the one to write first. It proves the generation machinery on the
cheaper corpus and delivers a showable property before any token-expensive work
begins.

---

## 9. The Both-Jobs Bridge

The two jobs meet in one artifact: **the pathology manifest.** Every planted
defect has an id (§2.2, §3.2) and exactly two consumers:

- a **demo beat** that shows it — `CV-B-01` → "the provider who left 14 months
  ago is still live on two sites"
- a **test** that asserts the tool finds it — `detect_drift` returns `CV-B-01`;
  `seo-insights` returns all three `MD-CANN-*` clusters

The corpus is the fixture. If a tool regresses, a test fails before a demo does —
the only version of "demo-able and testable" that survives contact with a
release. It also keeps the planted defects documented and removable rather than
folklore.

---

## 10. Open Dependencies

| Dependency | Owner | Blocks |
|---|---|---|
| ~~ACF Pro installer~~ | ~~Jeremy~~ | **Resolved 2026-08-09** — `~/Downloads/plugins/advanced-custom-fields-pro.zip`, **v6.8.6**, the same version live on Alpine Outfitters. Version parity matters: Plan 1c's `acf-json` field groups must load against it. Alpine's `install-plugins.sh` already treats that path as the convention. |
| ~~A Local site for `cedarvale.local`~~ | ~~Jeremy~~ | **Resolved 2026-08-09** — Jeremy authorized creating it through the Nexus AI MCP tools (`local_create_site`) rather than by hand, so Plan 1c is no longer gated on a human step. The same route covers M2's 7-install fleet, including putting a site into the halted state the pathology set calls for (`local_stop_site`). Note this makes the addon a dependency of its own demo corpus: Local must be running with the addon loaded for any of it to work. |
| ~~A SpinupWP account and one provisioned cloud server~~ | ~~Jeremy~~ | **Resolved 2026-08-11** — `myfirstserver` (DigitalOcean, 159.65.76.95, Ubuntu 26.04, WP-CLI 2.12.0, PHP 8.3.33). All three sites live and verified: `willowcreekderm`, `piedmontdermgroup`, `tablemesaderm`, each WordPress 7.0.3 with its own system user and ssh alias. One residual: delete the `cedarvale-spin.com` provisioning placeholder, or the fleet shows a fourth unexplained `external` row. |
| ~~Choice of WP Engine account for the flagship + sites A and B~~ | ~~Jeremy~~ | **Resolved 2026-08-11** — `w7579` (`b97e432b-c10a-4f0a-9ce7-55cedd575099`), which already carries Alpine Outfitters, keeping the canonical demo properties in one account. Installs will be `cedarvale`, `summitderm`, `ridgelineskin`. One caveat: the account holds 35 active installs and `wpe_get_account_limits` returns no data for it, so headroom must be checked in the portal before creating anything. |
| Two real domains (or subdomains of an owned domain), DNS-verifiable | Jeremy | M5 — GA4 property and Search Console verification |
| HubSpot developer account | Jeremy | M5 — the backdatable CRM history |
| Token budget approval for ~1,300 AI-written pieces | Jeremy | M3, M4 |
| WPE production install per property | Jeremy | M2 (IW/Power), M5 (real pipes) |
