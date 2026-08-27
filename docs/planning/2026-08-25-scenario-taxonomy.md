# Scenario taxonomy, and three drafts for the empty quadrants

Companion to `2026-08-25-platform-benchmark-v2.md`. That doc governs grading,
pinning and fairness; this one governs **what we choose to measure** and why the
portfolio currently has a hole in it.

**Status, 2026-08-25 15:2x — WIRED.** All four scenarios are in
`promptfooconfig.yaml` (11 tests total) and their keys are measured by
`ground-truth.js` into `keys.json`. What that does and does not mean:

- **Runnable, not yet run.** No archived run contains them. Filter the family with
  `--filter-pattern 'AO-S|WC-S|FL-|AO-T'`.
- **AO-S-01 needs `COWORKER_ABILITIES=1` and a personal key** to be the comparison
  it is graded as. Run without those and the Coworker column has no plugin route,
  so it will lose for a reason we caused — see §3.1 and §6.1.
- **Arming abilities re-baselines the suite.** Every archived run used the KB-only
  scaffolding; the manifest now stamps a note saying so.
- **AO-U-01 (updates) is still not drafted.** It is no longer blocked on the
  false-update defect — that landed and is verified — but it targets the WPE install
  `alpineoutfitte`, which is not ability-connected yet (its connect URL was one of
  the two `http://` ones that failed). Note also that "Alpine Outfitters" in the
  local plugin audit is a *different site* from the WPE install: 13 plugins against
  21. Another name collision.

§6 lists what remains.

---

## 1. The taxonomy

Two axes of scope and subject, and a third of task type that the suite already
carries implicitly.

**Scope x subject** (the agency developer's mental model — "this client's site"
vs "all my clients", "the words" vs "the software"):

|  | Content | Site |
|---|---|---|
| **In-site** | what this client publishes | what this client runs |
| **Fleet** | what the portfolio publishes | what the portfolio runs |

**Task type** — this is not a fifth category, it is a dimension that cuts
across all four, and the v2 doc already distinguishes the first two:

- **Lookup** — one verifiable fact, a few calls (CV-A/B/G).
- **Audit** — decompose a vague ask into censuses nobody requested; the
  load-bearing findings are absences (AO-A/B/C).
- **Temporal** — compare two windows and say what changed and whether it
  matters. *Zero coverage today.*
- **Synthesis** — assemble a client-facing narrative from several of the above.
  *Zero coverage today, and deliberately last: grading advice quality is where
  benchmark rubrics go to die (v2 §4).*

Scope x subject x task type is enough. Resist adding categories; "content decay"
is not a new box, it is in-site x content x temporal.

**The one thing that genuinely does not fit:** commercial intelligence — which
client is over plan, what storage costs per retainer, which engagement is
underwater. That is WP Engine account data rather than site data, and it is the
agency *owner's* question rather than the developer's. Fold it into fleet x site
or break it out, but decide deliberately rather than letting it leak in.

---

## 2. Current coverage

| | Content | Site |
|---|---|---|
| **In-site** | AO-A-01, AO-B-01, AO-C-01, CV-G-01 | **empty** |
| **Fleet** | CV-A-01, CV-B-01 | REACH-01 only |

Drafted in §4 to fill it: AO-S-01 and WC-S-01 (in-site x site), FL-ACF-01
(fleet x site), AO-T-01 (the first temporal). A fifth, AO-U-01, fell out of the
§6.1 probe and is described at the end of §4.1 but not yet drafted.

By task type: 4 lookups, 3 audits, 0 temporal, 0 synthesis.

REACH-01 is a *control* — can you see the site at all — not an audit of what is
running on it. So the site half of the matrix is effectively unbuilt, and every
question an agency developer actually asks on a Monday morning lands in it.

---

## 3. Which quadrants are comparisons — measured, not assumed

**This section previously argued that the site half of the matrix was
Nexus-only by construction. That was wrong, and it was wrong in the direction
that would have flattered us.** Probed live 2026-08-25: given a **personal** API
key and a per-site **WordPress account connection**, Coworker reaches plugin,
environment and site-health data through WordPress abilities. The site quadrant
is a **comparison**, not a capability demonstration.

What `run_site_ability` returned for `power-coworker/list-plugins` on
summitdermatol:

```
total_count: 6, active_count: 5, inactive_count: 1,
updates_available_count: 2, updates_allowed: true,
update_check: { checked: true, last_checked_gmt: "2026-08-25T17:56:52Z" }
```

with per-plugin `update_status` and `new_version`. The same site also exposes
`core/get-environment-info`, `power-coworker/get-site-info` and
`power-coworker/get-site-health`.

### 3.1 What this obliges us to do

- **`coworker.js` must be widened.** It advertises three tools; the column needs
  the abilities route or every site-quadrant decline is one *we* caused. Until
  it is widened, no site-quadrant result may be published.
- **The bench key must change class.** `COWORKER_API_KEY` in `nexus.env.local`
  is a **project** key (34 chars). A project key resolves no WordPress user and
  can never run an ability — it returns `unauthorized`. Every run in the ledger
  to date used it. The column needs a **personal** key plus a completed
  per-site connection.
- **Record which WordPress user the column ran as.** Abilities execute as the
  connected person's WordPress user with that user's capabilities, and the
  site's logs name them. So the column is not "Coworker" in the abstract, it is
  "Coworker as a specific connected user" — pin it in the manifest the way model
  and grader are pinned, or the result is not reproducible.
- **Decide the mutation question deliberately.** The ability set includes
  `create` / `update` / `delete` for posts, pages and every CPT, plus
  `activate-plugin` and `update-plugin`. Wiring the full set gives a benchmark
  column live write access to real sites. Recommendation: expose a **read-only
  subset**, and state in the fairness note that it was trimmed and why — a
  withheld *write* tool cannot affect a read-only scenario's outcome, so this
  costs the comparison nothing.

### 3.2 What is still capability-only, and why

- **Sites Coworker has no site connection for.** willowcreekderm does not appear
  in `list_account_sites` at all and, at WordPress 6.9.7, sits below the hub's
  7.0 floor, so it cannot get one. REACH-01's premise, holding on a second site.
- **Data classes no ability exposes.** Access logs (AO-T-01), anything
  fleet-wide (FL-ACF-01), and WP Engine CAPI data. Abilities are per-site by
  construction; there is no ability that spans installs.

### 3.3 Ability sets are per-site and not uniform

ridgeline exposes **50** abilities but **none of the plugin ones** — no
`list-plugins`, no `get-site-health`. summitdermatol exposes **45**, including
them. Both run `mcp-adapter` 0.6.1 and `power-coworker` 0.7.0. The cause is not
yet known.

This is a trap for scenario design: choose the wrong substrate site and you will
conclude Coworker cannot do something it demonstrably can. **Enumerate abilities
per site before declaring any expected advantage**, and record the enumeration
beside the key.

## 4. Four drafts

Every figure below was measured 2026-08-25, method named per scenario. Nothing
is copied from a column's output.

### 4.1 AO-S-01 — in-site x site x audit

> **Prompt.** We are taking over maintenance of alpineoutfitte. Give me the
> software inventory — what is installed, what is actually running, and what
> versions. Flag anything a new maintainer should know about.

**Measured, live over SSH (`wp plugin list`) 2026-08-25 — not from graph.db:**

- 21 plugins installed *(re-measured 2026-08-25 14:08 after `mcp-adapter` 0.6.1
  was installed and activated here — see §6.1; the pre-install figures were
  20 / 9 active)*.
- **10 active**, **1 inactive** (`ai-provider-for-local-gateway`), **8 must-use**,
  **2 drop-ins** (`advanced-cache.php`, `object-cache.php`).
- WordPress 7.1, PHP 8.4.
- ACF PRO 6.8.8; WooCommerce 11.0.1 active with 181 products in 9 categories.

**And measured from Coworker's side, 2026-08-25** — because this scenario is a
comparison, both views belong in the key. `power-coworker/list-plugins` uses the
WordPress plugins REST API, which returns **regular plugins only**: for the
structurally identical summitdermatol it reported `total_count: 6` where
`wp plugin list` reports 15, the difference being exactly the must-use plugins
and drop-ins. On alpineoutfitte the same ability should therefore report **11**
(10 active + 1 inactive) against SSH's 21. It also returns `update_status` and
`new_version` per plugin, which Nexus does not persist at all.

**The discriminator — three views, and none of them is complete on its own.**

| view | total | active | inactive | sees must-use / drop-ins | sees updates |
|---|---|---|---|---|---|
| `wp plugin list` over SSH | 21 | 10 | 1 | yes, classified | no |
| Nexus graph cache | 21 rows | 10 | **11** | no — collapses both to `is_active=0` | no |
| Coworker `list-plugins` | 11 | 10 | 1 | **no — invisible entirely** | **yes** |

Two different failures are reachable here, one per column, and that is what
makes the scenario worth running:

- **Nexus's failure is mislabelling.** Read from the graph cache, the
  honest-looking answer is "10 active, 11 inactive" — wrong twice over: only one
  plugin is genuinely inactive, and eight of the eleven *cannot be deactivated
  at all*. An answer reporting 11 inactive has read a cache and called it a site.
- **Coworker's failure would be silent incompleteness.** Its route cannot see
  the 8 must-use plugins or the 2 drop-ins. Reporting "11 plugins" is not wrong
  — reporting it *as the whole inventory* is.

So the scenario grades **scope honesty, not raw completeness**. A scoped answer
that says what it covers is a pass; an unscoped answer that implies it covered
everything is not.

PASS requires all three:

1. **active = 10 and inactive = 1.** Both columns can reach this and it is the
   one figure where the two routes agree.
2. **Scope is either complete or declared.** Either the 8 must-use plugins and 2
   drop-ins are accounted for (a total of 21, or those classes named), **or**
   the response states that its count covers regular plugins only. Silence about
   scope, presented as a full inventory, fails this clause.
3. **Platform grounding** — WordPress 7.1 and PHP 8.4, or the ACF PRO 6.8.8 /
   WooCommerce 11.0.1 versions.

FAIL on: any inactive count above 1 — 11 and 12 are the specific wrong answers
the graph cache produces; presenting a regular-plugins-only count as the
complete inventory with no scope statement; naming plugins that are not
installed; giving no counts; declining.

Do NOT grade which findings the response chooses to flag — a new maintainer's
priorities are judgment. Do NOT fail a response for noting that most of this
stack is platform or instrumentation rather than a typical client site; that is
true, and see the caveat below. Do NOT require update availability here; it is a
real asymmetry but it belongs to its own scenario (see below), not smuggled into
an inventory rubric.

**Grading shape:** a shared `llm-rubric` — both columns graded on the same
expectation. **Not** REACH-01 per-provider; an earlier revision specified that,
on the assumption Coworker had no plugin route, and §3 disproved it.

**Expected advantage: neutral, leaning Nexus.** Nexus can produce the complete
inventory, Coworker can only produce a correct scoped one — but the failure that
actually loses this scenario, mislabelling must-use as inactive, is available
only to Nexus. Declared before the first run.

**A scenario this finding hands us, not yet drafted: AO-U-01, "which plugins on
alpineoutfitte need updating?" — expected advantage COWORKER, strongly.**
Coworker returns `update_status` and `new_version` live per plugin. CLAUDE.md is
explicit that Nexus persists no update availability anywhere and that fleet-wide
outdated counts must be reported as `null`, never `0`. This is the
designed-from-their-strengths scenario the v2 portfolio asks for (§4, SEM/META/
DOC-01), and it arrives from measurement rather than guesswork. It also sharpens
WC-S-01 rather than weakening it: the best available answer there is "2 updates
available, otherwise current" — which still misses an eight-year-abandoned
plugin throwing PHP warnings.

**Caveat, and its limit.** alpineoutfitte's plugin set is benchmark and platform
instrumentation (`alpine-seeder`, `nexus-ai-connector`, `power-coworker`,
`wpe-*`); only three entries — ACF PRO, WooCommerce, Yoast — are a stack anyone
chose. That is fine for an *inventory* question, where the facts are facts and
the platform plugins are what produce the must-use rows being discriminated.

It is **not** fine for a redundancy scenario on this site: the genuine
functional overlap here is four AI connectors, all ours, so a correct answer
flags our own rig and the key moves whenever we change it. Nor for
active-but-inert — exactly one plugin is inactive and nothing is
active-and-doing-nothing, so there is no positive case to find and the scenario
could only ever grade a correct "none", which is the correct-by-blindness
failure the AO family exists to prevent.

**But that is a fact about this site, not about the substrate.** The two
external SSH hosts carry real third-party stacks, and WC-S-01 below is built on
one of them. Only the *clean* redundancy case — two caching plugins, three SEO
plugins on one site — is genuinely absent and still wants seeding, on a separate
install rather than on alpineoutfitte (plugins would not touch the AO content
keys, but they would move `plugins_total` and force a re-measure of a family
that is already drafted).

### 4.2 FL-ACF-01 — fleet x site x audit

> **Prompt.** Across every site I manage, which ones are running old versions of
> Advanced Custom Fields? Give me the spread and tell me what needs attention.

**Measured 2026-08-25 from the fleet's plugin rows — see the key-provenance
problem below before treating these as final:**

- **86 sites** carry ACF core or PRO, across **24 distinct versions**.
- Newest: **6.8.8 on 21 sites**. Oldest: **6.1.0**, one site (`fakerincdemo`).
- **13 sites on 6.3.x or older.**
- **10 sites carry BOTH** `advanced-custom-fields` and
  `advanced-custom-fields-pro` simultaneously.
- **2 sites run a beta in production** — 6.8.0-beta2 (`nexustestsite1`,
  `nexustestsidev`).

**The discriminator.** Four other slugs begin with `advanced-custom-fields`
and are add-ons, not ACF: `-font-awesome` (1.3.1), `-nav-menu-field` (2.0.0),
`-rgba-color`, `-pro-master`. A prefix sweep reports **88 sites across 27
versions** and hands you 1.3.1 as your oldest ACF install. The correct answer
counts only core and PRO. This is CV-B-01's "23, not 1" in a different costume.

PASS requires: the site count (86) and the version spread (24 versions, or the
newest-and-oldest pair), plus at least one actionable finding grounded in the
data — the 13 old installs, the 10 double-installs, or the 2 betas.

FAIL on: 88 sites or 27 versions, or naming 1.3.1 or 2.0.0 as an ACF version
(all four indicate the add-on slugs were swept in); giving no counts; declining.

**Key provenance — the problem this scenario has and the others do not.**
`ground-truth.js` measures substrate sites by `wp eval` over SSH, deliberately
independent of anything Nexus caches. There is no such route for a fleet key:
the numbers above come from Nexus's own graph, which is *the system under test*.
A key read from the graph is trivially satisfied by a column that reads the
graph, and cannot falsify it. Three ways out, in preference order:

1. **Measure over SSH across a bounded, named site list** (say 20 installs
   spanning the version range). Honest, independent, and the cost is one-time
   per re-measure. Recommended.
2. **Reframe onto a CAPI-verifiable fact** — disk usage per install, say — where
   WP Engine's API is a third-party source rather than our cache. Cheaper, but it
   answers a different question.
3. **Accept the graph as the key source** and label the scenario as testing
   *reporting* rather than *retrieval*. Weakest; do this only with the limitation
   written into the scenario comment.

Whichever is chosen, fleet keys drift as the fleet syncs. Wire these atoms into
the existing drift gate so a moved fleet marks the run drift-skipped rather than
silently regrading against stale truth.

### 4.3 AO-T-01 — in-site x site x **temporal** (the first of its kind)

> **Prompt.** Compare the last two weeks of traffic on alpineoutfitte against the
> two weeks before that. What changed, and should I be worried?

**Measured 2026-08-25 from the log-processor daily aggregates** (apache-style
nginx logs, `s3://wpejpp/wpe_logs/nginx/`, 30 aggregate days present):

| window | requests | human | ai_training | attack | 5xx |
|---|---|---|---|---|---|
| Jul 27 – Aug 9 (14d) | 5,801 | 4,551 (78.5%) | 133 (2.3%) | 439 | 39 |
| Aug 10 – Aug 23 (14d) | 591 | 306 (51.8%) | 153 (25.9%) | 17 | 62 |

Derived, and all of it load-bearing:

- Total requests down **~90%**; human traffic down **~93%**.
- AI-crawler traffic went **up** in absolute terms (133 to 153) while everything
  else collapsed — its share rose from 2.3% to 25.9%, an ~11x shift.
- **2026-08-11 recorded zero human requests** and 10 AI-crawler requests. The
  only visitors that day were bots.
- Server errors rose from 39 to 62 in absolute terms — but the **rate** went from
  0.67% to 10.5%, roughly **15x**.

**The discriminator.** The 5xx line is the whole scenario. A response that
compares raw error counts says "errors are up a bit, from 39 to 62" and buries a
fifteen-fold rate regression under a 90% traffic collapse. Normalising is the
skill under test. This is AO-C-01's denominator discipline applied to time.

PASS requires all three:

1. the traffic decline, with figures from both windows (raw counts or the ~90%);
2. the error finding expressed as a **rate or proportion**, not only as raw
   counts — an answer that gives 39 vs 62 without normalising fails this clause
   even if every number is right;
3. one composition finding — the AI-crawler share rise, or the zero-human day.

FAIL on: reporting traffic as stable or improved; giving only raw error counts;
inventing per-page or per-post traffic figures (the aggregates do not carry
them — see below); declining.

Do NOT grade the diagnosis offered for the decline. The logs cannot distinguish
a seeding run ending from a real audience loss, and a good answer says so.

**Grading shape:** REACH-01 per-provider — no other column has a route to
access logs.

**Window stability.** Both windows are closed and their file-dates are ledgered,
so the aggregates for those days do not move as new logs sync. Pin the window
explicitly in the prompt-adjacent key rather than saying "the last two weeks",
which would rot nightly. Re-pointing the log bucket wipes aggregates and ledger
by design, which would invalidate this key — note it beside the atoms.

**What is NOT buildable here, and it matters.** The daily fold keeps `topPaths`
only inside the bot buckets (`aiTraining`, `aiRetrieval`, `searchBots`). Human
traffic is stored as counts by class and status with **no per-URL breakdown**.
So "what were my most popular content items last month" and true content-decay
scenarios — the in-site x content x temporal cell — **cannot be built on the
access-log aggregates as they fold today**.

**TODO (PARKED 2026-08-25 — do not build yet).** The obvious second route is the
web-analytics agent, and its tools are real and agent-exposed: `list_properties`,
`map_property`, `traffic_summary`, `anomaly_scan`, and `page_performance`, which
returns per-page GA4 by `pagePath` — exactly the shape content decay needs. GA4
is authenticated and 21 properties are visible. It is parked on two facts, not
on missing tooling:

- **No site is mapped.** `web-analytics` scope is `{siteIds: []}`, so
  `page_performance` fails for any `siteId` today. That part is only setup.
- **None of the 21 properties is a substrate site.** They are real WP Engine
  business properties — NitroPack.IO, Advanced Custom Fields, LocalWP,
  StudioPress, Torque, the unified production property. The substrate sites are
  seeded demos with no GA4 tag and no real visitors; mapping cannot conjure data
  that was never collected.

So content decay on the substrate must come from **extending the log fold to
keep human `topPaths`** — that is the live route, and it is its own packet.
Building against a real property instead carries a consequence to decide
deliberately rather than drift into: **the results ledger is committed to git**,
and real business analytics is a different data-sensitivity class from seeded
clinic data.

### 4.4 WC-S-01 — in-site x site x audit (currency is not maintenance)

> **Prompt.** Audit the plugins on willowcreekderm. Is anything on this site a
> maintenance risk?

**Measured 2026-08-25 — plugin inventory live over SSH, maintenance facts from
the wp.org plugin API:**

- 8 plugin entries: **6 active**, **1 must-use** (`spinupwp-debug-log-path`),
  **1 drop-in** (`object-cache.php`). Site runs WordPress 6.9.7. *(Re-measured
  2026-08-25 14:08 after `mcp-adapter` 0.6.1 was installed and activated here —
  see §6.1; the pre-install figures were 7 / 5 active.)*
- **Every plugin is already at its latest published version. Zero updates are
  available.**
- `search-everything` 8.1.9 — latest release, **last updated 2017-11-28**,
  **tested up to WordPress 4.7.35**. The site runs 6.9.7: roughly eight years
  and nine months without a release, two major versions behind on tested-up-to.
- `limit-login-attempts-reloaded` 3.3.5 — latest release, **last updated
  2026-08-12** (13 days before measurement), tested to 7.0.4. Healthy.
- `advanced-custom-fields-pro` 6.8.8 (commercial, the fleet's newest ACF),
  `spinupwp` 1.9.1 (host platform), `cedar-vale-seeder` (ours).

**It is not merely stale — it is erroring, live.** Every WP-CLI invocation on
this site now emits `Warning: Trying to access array offset on false in
.../search-everything/config.php on line 29`, observed 2026-08-25 during the
`mcp-adapter` activation. A plugin written for WordPress 4.7 is throwing PHP
warnings on 6.9.7. This is the consequence the update count cannot see,
happening already, and it is an even better answer than the dates — a response
that surfaces it has read the site rather than a version table.

**The discriminator, and why this is the strongest of the four drafts.** Two
plugins on this site are *both* at their latest version. An update check — "how
many of my plugins are out of date?" — returns **zero** and reports the site
healthy. One of those two was published thirteen days ago and one has been
untouched since 2017. **Currency and maintenance are different properties, and
the update count cannot tell them apart.** A column that answers from
`update_version` alone is structurally incapable of finding the risk here.

PASS requires all three:

1. `search-everything` named as the maintenance risk;
2. grounded in maintenance evidence — the last-updated date, the tested-up-to
   version, or the gap against the site's 6.9.7 — **not** in an available
   update;
3. the enumeration it was drawn from — the plugin count, or the fact that no
   updates are available.

Credit, do not require, a response that surfaces the live PHP warning from
`config.php` line 29 — it is the strongest available evidence but reaching it
means reading site output rather than metadata, and a correct answer can be
built from the dates alone.

FAIL on: reporting the site healthy because everything is current; claiming an
update is available for `search-everything` (there is none); naming
`limit-login-attempts-reloaded` as stale (it shipped 13 days ago); no
enumeration.

Do NOT fail a response for also flagging the commercial or platform plugins as
unverifiable against wp.org — that is true and shows it understood the method.

**Key provenance — this one is clean.** The maintenance facts come from the
wp.org plugin API, which is neither column's data and neither column's cache.
This is the independence FL-ACF-01 cannot get from `graph.db`, and it is a
reason to prefer wp.org-anchored plugin scenarios generally.

**Stability.** `last_updated` for an abandoned plugin is frozen by definition —
the 2017 date cannot move. `limit-login-attempts-reloaded` *will* ship again, so
pin the contrast on the abandoned side and re-measure the healthy comparator
with the rest of the keys.

**Grading shape:** REACH-01 per-provider — and here the decline is structural
and nameable rather than a tooling gap. willowcreekderm does not appear in
Coworker's `list_account_sites` at all: it has no Power site connection, and at
WordPress 6.9.7 it is below the hub's 7.0 floor, so it cannot get one. That is
REACH-01's premise holding on a second site, and it is why this scenario stays
a capability test even if §6.1's personal-connection work later turns the rest
of the quadrant into a comparison. State it in the scenario comment so no
reader mistakes the decline for a withheld tool.

Because willowcreekderm has no collection at all, a decline there cannot
distinguish "no route to plugin data" from "no route to this site". If that
ambiguity matters,
run the same scenario against ridgeline (`hostinger-test`), which Coworker
*does* have a collection for and which carries its own realistic stack:
Elementor 4.2.1, LiteSpeed Cache 7.9, four Hostinger platform plugins — and
`wpe-hub` 0.16.0 active on a **Hostinger** site, a genuine cross-platform
mismatch worth its own scenario.

---

## 5. keys.json atoms

`keys.json` already carries a non-site top-level section (`npi_overlap`), so the
fleet atoms fit the existing shape.

```jsonc
"sites": {
  "alpineoutfitte": {
    // AO-S-01 — measured by `wp plugin list --format=json` over SSH
    "plugins_total": 21,
    "plugins_active": 10,
    "plugins_inactive": 1,
    "plugins_mustuse": 8,
    "plugins_dropin": 2,
    "wp_version": "7.1",
    "php_version": "8.4",
    "acf_version": "6.8.8",
    "woocommerce_version": "11.0.1"
  }
},
// FL-ACF-01 — see §4.2 on provenance before trusting these
"fleet_acf": {
  "source": "TBD — SSH sweep recommended over graph.db",
  "sites_with_acf": 86,
  "distinct_versions": 24,
  "newest": "6.8.8",
  "newest_site_count": 21,
  "oldest": "6.1.0",
  "sites_le_6_3": 13,
  "sites_with_both_core_and_pro": 10,
  "sites_on_beta": 2,
  "excluded_addon_slugs": [
    "advanced-custom-fields-font-awesome",
    "advanced-custom-fields-nav-menu-field",
    "advanced-custom-fields-rgba-color",
    "advanced-custom-fields-pro-master"
  ],
  "naive_prefix_sweep_would_report": { "sites": 88, "versions": 27 }
},
// WC-S-01 — inventory over SSH; maintenance facts from the wp.org plugin API
"willowcreekderm_plugins": {
  "entries_total": 8,
  "active": 6,
  "mustuse": 1,
  "dropin": 1,
  "wp_version": "6.9.7",
  "updates_available": 0,
  "abandoned": {
    "slug": "search-everything",
    "version": "8.1.9",
    "is_latest": true,
    "last_updated": "2017-11-28",
    "tested_up_to": "4.7.35",
    "live_php_warning": "Trying to access array offset on false in wp-content/plugins/search-everything/config.php on line 29"
  },
  "healthy_comparator": {
    "slug": "limit-login-attempts-reloaded",
    "version": "3.3.5",
    "is_latest": true,
    "last_updated": "2026-08-12",
    "tested_up_to": "7.0.4"
  }
},
// AO-T-01 — closed windows; invalidated if the log bucket is re-pointed
"alpineoutfitte_traffic": {
  "early_window": { "from": "2026-07-27", "to": "2026-08-09", "requests": 5801,
                    "human": 4551, "ai_training": 133, "attack": 439, "err5xx": 39 },
  "late_window":  { "from": "2026-08-10", "to": "2026-08-23", "requests": 591,
                    "human": 306, "ai_training": 153, "attack": 17, "err5xx": 62 },
  "err5xx_rate_early_pct": 0.67,
  "err5xx_rate_late_pct": 10.49,
  "zero_human_days": ["2026-08-11"]
}
```

---

## 6. Settle before these go live

1. ~~**Probe what Coworker can actually reach.**~~ **RESOLVED 2026-08-25 — the
   answer is yes, and it inverts what this section assumed.** Full reasoning and
   consequences in §3; the short version and the work it leaves:

   **What was found.** With a **personal** API key and a completed per-site
   WordPress account connection, Coworker runs WordPress abilities that reach
   plugin, environment and site-health data. `list-plugins` returns counts,
   per-plugin versions **and update availability**. The two blockers found
   earlier were one root cause — no personal credential, no per-site consent —
   and both are now cleared on two of four sites.

   **How the two credentials differ, for whoever reads this next.** The
   discriminator is the error from `list_site_abilities`, not a field on
   `list_account_sites`:

   | key | result |
   |---|---|
   | project (`COWORKER_API_KEY`, 34 char) | `unauthorized` — "a personal API key is required for this tool" |
   | personal (38 char) | `not_personally_connected` + a `connect_url`, until consent is given |
   | personal + consent | the abilities |

   **`wp_connection_status` is documented but not returned.** WP Engine's
   connections doc says `list_account_sites` reports it per site and that its
   absence means a project key. It is absent under **both** key classes, so it
   cannot be used as a signal. An earlier revision of this item read that
   omission as the project-key tell and was wrong. Worth reporting to whoever
   owns the doc.

   **Connection state, 2026-08-25:**

   | site | abilities | plugin abilities | connect URL scheme |
   |---|---|---|---|
   | summitdermatol | 45 | **yes** | https ✓ |
   | ridgeline | 50 | **no** | https ✓ |
   | cedarvalehealt | — `not_personally_connected` | — | http ✗ |
   | alpineoutfitte | — `not_personally_connected` | — | http ✗ |

   The two that failed are exactly the two whose connect URLs were plain
   `http://`. Retry over https:
   `https://cedarvalehealt.wpenginepowered.com/wp-admin/admin.php?page=power-overview&action=trigger_wp_connection`
   and the same path on `alpineoutfitte`.

   **Work this leaves, and none of it is optional before a site-quadrant result
   is published:**

   1. Widen `coworker.js` to the abilities route — **read-only subset** (§3.1).
   2. Move the bench to a personal key; keep it out of the repo
      (`nexus.env.local` is gitignored) and record the key *class* in the
      manifest, never the value.
   3. Pin the connected WordPress user in the manifest alongside model and
      grader.
   4. Connect the remaining two sites, then **enumerate abilities per site** and
      store the enumeration beside the keys — ridgeline proves the sets are not
      uniform (§3.3).
   5. Re-declare expected advantage for every site-quadrant scenario. AO-S-01 is
      now neutral-leaning-Nexus, not Nexus-only; AO-U-01 (updates) is a
      declared **Coworker** favourite.

   *Note:* `mcp-adapter` 0.6.1 was installed and activated on alpineoutfitte and
   willowcreekderm on 2026-08-25 so the abilities route stays open across the
   Coworker-visible substrate. It moved the AO-S-01 and WC-S-01 keys, which are
   re-measured above.

2. **Decide FL-ACF-01's key source** (§4.2) — but the choice is cheaper than
   §4.2 first suggested, and for a reason that was measured after it was
   written. Two defects were conflated there. *Cache-vs-world* is largely moot:
   of the 86 ACF-bearing sites, 66 have plugin rows under a day old and the rest
   are 1-7 days, so the graph currently does describe the fleet. *Circularity*
   remains — but what survives it is the add-on-slug trap, which is a **reasoning**
   failure a column can commit with perfect data in front of it.

   **The abilities finding does not reach this scenario, and the reason matters.**
   §3 showed Coworker reads plugin data on a connected site — but abilities are
   **per-site by construction**. There is no ability that spans installs, and
   answering "which of my 86 sites run old ACF" would mean 86 separate
   `run_site_ability` calls against 86 separately-consented sites, only some of
   which Coworker has a site connection for at all. **Fleet x site therefore
   stays capability-only even though in-site x site did not** — and that is a
   structural property of the abilities model, not a credential gap, so it will
   not flip the way §6.1 did.

   **Recommendation: keep the graph as key source, label the
   scenario capability + reasoning, and add a bounded SSH spot-check of ~10 sites
   spanning the version range** (including the 6.1.0 outlier and one of the beta
   pair). Escalate to the full sweep only if a fleet route appears on their
   side.
   Prefer wp.org-anchored plugin facts where the scenario allows it — WC-S-01
   shows that route is genuinely independent of both columns.
3. **Run each once before pinning the grading.** REACH-01's per-provider
   assertion was written after observing what each column actually does; these
   deserve the same, especially the decline-vs-fabricate branch.
4. **Cost.** Audit cells run 2-3 minutes. Three scenarios x 2 columns x repeat 3
   is 18 cells. Give the family a filter prefix so it can run alone.
5. **Not in scope, deliberately:** the clean-redundancy seeded site AO-S-01's
   caveat describes, human `topPaths` in the log fold, GA4-backed content decay
   (parked — see §4.3), the ridgeline cross-platform-mismatch scenario WC-S-01
   points at, and any synthesis-type scenario.
