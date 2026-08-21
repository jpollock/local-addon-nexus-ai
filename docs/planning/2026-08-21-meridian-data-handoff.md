# Meridian Data (M3–M4) — Agent Handoff

**Written:** 2026-08-21, at the end of Cedar & Vale M2.
**For:** a fresh agent picking up the second canonical demo property.
**Status:** nothing built. No `meridian-data-demo/` directory, no plan.

Your first deliverable is **a plan, not code.** Use `superpowers:writing-plans`
and save it to `docs/planning/` in the addon repo (specs and plans live there;
`docs/superpowers/` is gitignored). Then execute it with
`superpowers:subagent-driven-development`, unless the session config forbids
subagents — check before dispatching.

---

## 1. Read these first, in this order

| Source | Why |
|---|---|
| `docs/planning/2026-08-09-canonical-demo-sites-design.md` §2 | Meridian's content model and pathologies. Binding. |
| …the same file, §4.1–4.3 | The observed/seeded/modeled rule and the pipeline-economics value layer |
| …§6 (generation split) | What is AI-written vs composite, and the honesty constraint |
| …§8 (milestones) | M3 and M4 scope boundaries |
| `docs/planning/2026-08-11-cedar-vale-fleet-m2.md` | The plan shape that worked. Copy its structure. |
| `canonical-demos/docs/fleet-provisioning.md` | Every host-specific trap already paid for |

Do not re-derive decisions the spec has already made. It rejected multisite
(§7.1) with reasons; it fixed the generation split; it set the honesty rule.

---

## 2. What Meridian is

A B2B SaaS content engine — data observability vendor. It exists to cover two
gaps Cedar cannot: **B2B funnel/pipeline** and **publisher scale**.

Cedar is 840 items across 8 installs. **Meridian is ~5,700 items on one site.**
The hard problem is different: not fleet drift, but scale, decay, and
content-attributed revenue.

### Content model (spec §2.1)

| Type | Count | The fields that matter |
|---|---|---|
| `post` (article) | 5,000 | `topic_cluster`, `funnel_stage`, `target_keyword`, `search_intent`, `last_reviewed`, `primary_cta`, `content_status` |
| `doc` | 400 | hierarchical; `doc_type`, `applies_to_version`, `product_area`, `code_language` |
| `integration` | 60 | `category`, `auth_method`, `setup_time`, `tier_required` |
| `glossary` | 120 | `related_terms`, `product_area` |
| `case_study` | 24 | `industry`, `company_size`, `use_case`, before/after `metrics`, `plan_tier` |
| `resource` (gated) | 18 | `asset_type`, `gate`, `form_id`, `mql_weight` |
| `comparison` | 15 | `competitor`, `feature_matrix` (repeater), `win_themes` |
| `plan` | 3 | `price_monthly`, `seat_included`, `features` |
| `author` | 14 | credentials, for provenance |
| `page` | 40 | solutions by role and industry, legal, careers |

Taxonomies: `topic_cluster` (12 pillars, hierarchical), `funnel_stage`
(TOFU/MOFU/BOFU), `product_area`, `persona`, `industry`, `content_status`
(`evergreen | needs-refresh | decaying | retire-candidate`).

### Pathologies (spec §2.2)

| Id | Pathology |
|---|---|
| `MD-CANN-01..03` | 3 cannibalization clusters (4–6 articles per keyword, near-identical intent) |
| `MD-DECAY-01` | ~1,400 articles with `last_reviewed` > 24 months; a cohort with monotonically declining sessions |
| `MD-ORPH-01` | 40 orphans with zero internal inbound links |
| `MD-LINK-01` | 12 broken internal links; 30 redirect chains |
| `MD-DOC-01` | 6 docs whose `applies_to_version` predates the current release |
| `MD-THIN-01` | 200 articles under 400 words |
| `MD-META-01` | 60 posts sharing duplicate meta descriptions |

### Milestone split (spec §8)

- **M3 — core.** Docs, integrations, glossary, funnel, 300 hero articles.
- **M4 — long tail.** 4,700 composites, decay + cannibalization. *"The expensive
  step, after the machinery is proven."* Do not start M4 until M3's pipeline is
  demonstrably working end to end.
- **D2 — design pass.** Trailing, gated on green CWV and AA contrast.

---

## 3. What you inherit — do not rebuild any of this

### `@canonical-demos/shared` (Plan 1a, 139 tests)

`shared/src/`: `ai-client`, `anthropic-client`, `budget` (TokenBudget),
`checkpoint`, `generate-runner`, `manifest`, `seed`, `verify`, `wp-cli`.
Resumable generation with a spend ceiling is already solved.

### Cedar's pipeline shape (`cedar-vale-health-demo/scripts/src/`)

- `run-corpus.ts` — generation orchestrator with per-tier token ceilings
- `prose-store.ts` — content cache keyed so a re-run doesn't re-spend
- `generators/`, `prompts/`, `reference/` — the per-type generation pattern
- `normalize/acf-mappers.ts`, `normalize/relationships.ts` — model → import shape
- `acf/field-types.ts` → `acf/generate-acf-json.ts` — the field map that
  generates ACF local JSON. **This is the highest-value thing to copy.**

### The seeder plugin pattern (`wordpress/plugins/cedar-vale-seeder/inc/`)

`content-model.php` (CPTs + taxonomies), `acf-loader.php`, `importer.php`
(two-pass: upsert by slug, then resolve relationships), `verify.php` (counts +
permalink HTTP + relationship totals), `jsonld.php`, `cli.php`
(`wp <property> import` / `verify`). Clone this wholesale.

### Tooling

`cedar-vale-health-demo/scripts/bin/local-wp.sh` — runs WP-CLI against a Local
site from an outside shell. Property-agnostic; use as-is.

### Probably NOT reusable

Cedar's `scripts/src/fleet/` (derive / localize / skew / assert-pathology).
**Meridian is one site, not a fleet.** Its pathologies live inside a single
corpus, so they belong in the generators or a post-generation pass, not in a
per-site derivation. Read that code for the *assert-pathology* idea — proving
each planted defect exists before import — and drop the rest.

---

## 4. Traps already paid for. Every one of these cost real time.

**Generation**

- **Reasoning tokens consume `max_tokens`.** 20 of 60 Cedar provider bios came
  back truncated, and the truncated ones were *shorter* than the survivors, so
  it did not look like a length ceiling. Proof was `stop_reason: max_tokens`
  with no text block. Set ceilings well above the visible output length.
- **A "clean" verification can be a false zero.** Cedar reported 0 truncated
  pieces while 45 were cut mid-sentence, because the check grepped the wrong
  stream. Inspect the artifact, not the log.

**ACF**

- **A field that is not in `FIELD_TYPES` imports as a silent no-op.** Cedar's
  first skew design used `cv_*` marker fields that did not exist; every write
  vanished. Worse as a design smell: a corpus that flags its own defects means
  the demo finds the flag, not the problem. **Detect pathologies through fields
  the model already has.**
- **Repeater sub-field names must match the mapper's keys exactly.**
  `location` vs `location_slug` imported every row with an empty value and lost
  which clinic each price belonged to. `feature_matrix` on `comparison` is the
  Meridian equivalent — check it.
- **`date_picker` needs an explicit `return_format`.** Without it ACF returns
  `d/m/Y`, so `2026-04-06` reaches an en_US reader as "June 4th". Meridian has
  `last_reviewed` and `applies_to_version` dates; this will bite.
- **Measure the corpus baseline before asserting a pathology count.** Cedar's
  flagship already shipped 37 items with no reviewer and 116 marked overdue, so
  "3 with no reviewer" was not distinctive. `MD-DECAY-01` has exactly this
  shape — 1,400 stale articles only means something against a known baseline of
  fresh ones.

**WordPress / hosts**

- Fresh WordPress ships `hello-world`, `sample-page`, `privacy-policy`. The post
  breaks any exact count in `verify`. Delete it; the flagship keeps the pages.
- **WP Engine install names cap at 14 characters**, not the 20 the addon's
  `create-install.ts` validates. Over-length fails with a bare `HTTP 400`.
- **WPE's SSH home directory is ephemeral.** Only `sites/<install>/` persists.
  `rsync` to `~/file` reports success and the file is gone next command. Stage
  in `sites/<install>/_wpeprivate/` (persistent, 403 over HTTP).
- **`scp` is refused by WPE's gateway** (`Connection closed`). Use `rsync`.
- **`local_wpe_push` carries symlinks across as symlinks**, pointing at paths
  that do not exist on the server. Cedar's flagship served HTTP 200 with a
  zero-length body for days because the theme was a dangling link. Alpine has
  `pre-push-resolve-symlinks.sh` for this — use it, or copy real directories.
- **A new WPE install has an empty `permalink_structure`**, and `verify` passes
  anyway because query-string permalinks return 200. Set `/%postname%/`.
- **Purge WPE cache after any of this.** `x-cacheable: SHORT` outlived a fix.
- **In zsh, build an rsync destination in a variable first.** Inline
  `"$H:sites/$A/..."` parses `:s` as a substitution modifier and can silently
  produce a string with no colon, turning a remote push into a local copy that
  reports success.

---

## 5. Decisions you must make, that the spec does not

1. **Where does Meridian live?** Cedar spans Local + WPE + SpinupWP. Meridian is
   one site; spec §1.3 gives it a `wpe` production install. Confirm the account
   (`w7579` carries both other properties) and whether a Local dev clone is
   wanted.
2. **How are the 4,700 composites generated?** The spec fixes the *split* (≈900
   AI-written across Meridian, of which 300 are hero articles) but not the
   composite mechanism. Cedar's composites reused real entities with shallow
   templated prose. At 4,700 the templating needs to not read as 4,700 copies of
   one sentence — and CV-F-01 taught us that byte-identical content is a
   *detectable* property, so near-duplicate composites may themselves trip
   `MD-CANN-01`'s detector. Design the two together.
3. **Is 5,000 posts importable in one pass?** Cedar's largest was 840 and the
   two-pass importer handled it comfortably. 5,000 with relationship resolution
   across a 5,700-item map is untested. Consider batching, and measure before
   assuming.
4. **`MD-DECAY-01` needs a session curve**, and spec §4.1 says GA4 history
   cannot be backdated. Decide whether "monotonically declining sessions" is
   `seeded` or `modeled` under §4.2's tiering, and make sure the surface that
   displays it reports the tier.

---

## 6. Ground rules carried from Cedar

- **The acceptance gate is a real tool call.** A pathology proven in the corpus
  but not surfaced by a Nexus tool has not been built. Cedar's plan Task 9 is
  the pattern; write the equivalent and run it.
- **A tool that returns nothing is a finding about the tool**, not licence to
  adjust the corpus until it fires.
- **Never fabricate a plausible value to keep a metric computable.** NULL is the
  honest answer. This is the same rule the addon enforces for `php_version`.
- **Mutation-test the assertions.** Cedar had a guard that passed against the
  bug it targeted — swapping `.every` for `.some` changed nothing on the real
  corpus, and only a synthetic fixture caught it.
- **Do not `git push`, `npm version` or `git tag`** without Jeremy saying so.
  `canonical-demos` has no remotes and 100+ commits on `main`; that is the
  established pattern.

---

## 7. State of the sibling property, for context

Cedar & Vale M2 is one task from complete: eight installs seeded and verified,
six of seven pathologies confirmed live. Outstanding there — **Task 9**, the
fleet acceptance gate, blocked on the Nexus MCP server being connected. Nothing
in Meridian depends on it.
