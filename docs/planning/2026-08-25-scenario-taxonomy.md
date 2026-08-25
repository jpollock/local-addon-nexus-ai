# Scenario taxonomy, and three drafts for the empty quadrants

Companion to `2026-08-25-platform-benchmark-v2.md`. That doc governs grading,
pinning and fairness; this one governs **what we choose to measure** and why the
portfolio currently has a hole in it.

Status: drafts. Nothing here is wired into `promptfooconfig.yaml` yet — §6 lists
what has to be settled first.

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

By task type: 4 lookups, 3 audits, 0 temporal, 0 synthesis.

REACH-01 is a *control* — can you see the site at all — not an audit of what is
running on it. So the site half of the matrix is effectively unbuilt, and every
question an agency developer actually asks on a Monday morning lands in it.

---

## 3. Comparison scenarios and capability scenarios are different things

`providers/coworker.js` advertises exactly three tools: `search_knowledge_base`,
`fetch_knowledge_base_document`, `list_account_sites`. No plugin data, no
versions, no disk, no access logs. So as the columns stand:

- **Content quadrants are comparisons.** Both columns have a real route; a
  Nexus win means something.
- **Site quadrants are capability demonstrations.** Nexus-only by construction.

This is not a reason to skip the site half — it is most of the job — but it
changes the grading shape. A shared `llm-rubric` across a quadrant one column
structurally cannot reach produces a 100%-0% column that reads as rigged even
when it is honest. Site-quadrant scenarios must use **REACH-01's shape**: a
`javascript` assertion keyed on `context.provider.label`, with opposite
expectations per column, and an explicit fabrication check for the column that
has no route.

**Open before any of this goes live:** the real Coworker MCP also exposes
`list_site_abilities`, `run_site_ability` and `get_site_knowledge_base`, which
the bench provider does not offer. If WP abilities reach plugin or environment
data, part of the site half becomes a genuine comparison and should be graded as
one. Probe before declaring the quadrant Nexus-only — the fairness claim "we
built scenarios for their strengths" has to stay literally true.

---

## 4. Three drafts

Every figure below was measured 2026-08-25, method named per scenario. Nothing
is copied from a column's output.

### 4.1 AO-S-01 — in-site x site x audit

> **Prompt.** We are taking over maintenance of alpineoutfitte. Give me the
> software inventory — what is installed, what is actually running, and what
> versions. Flag anything a new maintainer should know about.

**Measured, live over SSH (`wp plugin list`) 2026-08-25 — not from graph.db:**

- 20 plugins installed.
- **9 active**, **1 inactive** (`ai-provider-for-local-gateway`), **8 must-use**,
  **2 drop-ins** (`advanced-cache.php`, `object-cache.php`).
- WordPress 7.1, PHP 8.4.
- ACF PRO 6.8.8; WooCommerce 11.0.1 active with 181 products in 9 categories.

**The discriminator, and why this scenario is worth building.** Nexus's own
graph cache stores plugin state as a single `is_active` integer, which collapses
must-use and drop-ins into `0`. Read from the cache, the honest-looking answer is
"9 active, 11 inactive" — and it is wrong twice over: only one plugin is
genuinely inactive, and eight of the eleven cannot be deactivated at all. An
answer that reports 11 inactive plugins has read a cache and called it a site.

PASS requires all three:

1. the total (20) and the active count (9);
2. a breakdown that does **not** describe must-use or drop-in plugins as
   inactive — either by naming those classes, or by giving the genuinely
   inactive count as 1;
3. the platform versions (WordPress 7.1, PHP 8.4) or the ACF/WooCommerce
   versions, grounded in the inventory.

FAIL on: reporting 11 inactive plugins (or any inactive count above 1); naming
plugins that are not installed; giving no counts; declining.

Do NOT grade which findings the response chooses to flag — a new maintainer's
priorities are judgment. Do NOT fail a response for noting that most of this
stack is platform or instrumentation rather than a typical client site; that is
true, and see the caveat below.

**Grading shape:** REACH-01 per-provider. Nexus must produce the inventory; a
column with no route must decline and must **not** state a plugin count or a
version — with no plugin route, either is fabricated whether or not it is right.

**Caveat, stated plainly.** alpineoutfitte's plugin set is benchmark and
platform instrumentation (`alpine-seeder`, `nexus-ai-connector`,
`power-coworker`, `wpe-*`), not an agency-realistic stack. That is fine for an
*inventory* question, where the facts are facts. It is **not** fine for the
scenarios this quadrant most wants — redundant plugin functionality, and
active-but-inert plugins — because the redundancy on this site is our own rig.
Those two need a deliberately seeded substrate (two caching plugins, three SEO
plugins, one activated and never configured) and should be a separate packet.

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
access-log aggregates as they fold today**. Two routes: extend the fold to keep
human `topPaths`, or go through the web-analytics agent's GA4 data, which is
per-page by nature but needs a mapped property. Neither is in scope here; both
are worth a packet.

---

## 5. keys.json atoms

`keys.json` already carries a non-site top-level section (`npi_overlap`), so the
fleet atoms fit the existing shape.

```jsonc
"sites": {
  "alpineoutfitte": {
    // AO-S-01 — measured by `wp plugin list --format=json` over SSH
    "plugins_total": 20,
    "plugins_active": 9,
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

1. **Probe what Coworker can actually reach.** If `list_site_abilities` /
   `run_site_ability` reach plugin or environment data, AO-S-01 is a comparison
   and must be graded as one (§3).
2. **Decide FL-ACF-01's key source** (§4.2). Measuring a fleet key from the
   graph makes it unfalsifiable by the column that reads the graph.
3. **Run each once before pinning the grading.** REACH-01's per-provider
   assertion was written after observing what each column actually does; these
   deserve the same, especially the decline-vs-fabricate branch.
4. **Cost.** Audit cells run 2-3 minutes. Three scenarios x 2 columns x repeat 3
   is 18 cells. Give the family a filter prefix so it can run alone.
5. **Not in scope, deliberately:** the seeded-substrate work AO-S-01's caveat
   describes, human `topPaths` in the log fold, GA4-backed content decay, and
   any synthesis-type scenario.
