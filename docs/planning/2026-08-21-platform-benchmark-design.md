# Platform Benchmark — Nexus vs Coworker vs WordPress

**Created:** 2026-08-21
**Status:** Design approved, not yet implemented
**Substrate:** Cedar & Vale Health (`canonical-demos/cedar-vale-health-demo`)
**Tooling:** promptfoo 0.122.0 (already a devDependency)

---

## 1. Purpose

Two jobs at once, and they pull against each other:

1. **Capability gap map.** For a fixed set of real tasks, which platform can
   answer, which cannot, and *why not*. Feeds roadmap and build-vs-adopt.
2. **Competitive evidence.** Numbers defensible enough to quote externally.

The tension is real: a GTM benchmark pulls toward tasks we win, a gap map
requires publishing the ones we lose. Two rules resolve it, and both are
binding:

- **The task set is fixed and committed before any column is run.** Adding or
  removing a task after seeing results invalidates the run.
- **Losses are published alongside wins.** A gap map with no gaps is marketing,
  and the first sceptical prospect will find the ones we omitted.

---

## 2. The three columns

All three are MCP servers. One client, three endpoints, identical prompts —
the model, the harness and the questions are held constant, and only the tool
surface varies.

| Column | Endpoint | What it is |
|---|---|---|
| **Nexus** | local addon MCP server | sqlite-vec content index, graph DB, twin, ~200 tools |
| **Coworker** | `https://api.ai.wpengine.com/v1/mcp` | WP Engine Power; sites joined via the `wpe-hub` plugin and OAuth |
| **WordPress** | `/wp-json/mcp/mcp-adapter-default-server` | The official WordPress MCP Adapter over core's Abilities API |

### Why WordPress core is the baseline, and not "an LLM with no tools"

An untooled model answers "I don't have access" to everything. That proves only
that tools help, and it is trivially dismissed as a rigged floor.

The [WordPress MCP Adapter](https://github.com/WordPress/mcp-adapter) is the
WordPress project's own MCP surface, bridging the Abilities API that ships in
core since 6.9. It is what a WordPress site has with no WP Engine product
attached. When it fails, the finding is *"WordPress's own AI interface cannot
answer this"* — a real result, from a baseline nobody can call unfair.

Measured on `cedarvalehealt` (WP 7.0.4) on 2026-08-21, core registers exactly
three abilities:

```
core/get-site-info
core/get-user-info
core/get-environment-info
```

None is content-aware. The baseline is genuinely thin, and that thinness is a
finding rather than a defect in the setup. It also means the baseline will
**pass** some questions — WP version, site title, environment — possibly more
cheaply than either product. Recording which questions do not need our product
is part of an honest gap map and is what makes the rest credible.

### Binding rule: do not register custom abilities on the demo sites

The moment we add content abilities to make the baseline "fairer," we are
measuring our own fixture instead of WordPress. What ships is what gets
measured. This would have applied to `nexus-ai-connector`, active on the Cedar WPE
sites. **Measured 2026-08-21: it registers none.** With the connector active
the ability count on `cedarvalehealt` is still exactly three, and its source
contains no `wp_register_ability` calls. The WordPress baseline is
uncontaminated and nothing needs removing for baseline runs. Re-check if the
connector gains an abilities integration.

### Adapter facts that constrain the build

- **WordPress ≥ 6.9, PHP ≥ 7.4.** All eight Cedar sites qualify (see §3).
- **Pre-1.0.** Depends on `php-mcp-schema ^0.1.0`, with breaking-change
  migration guides for 0.3.0 and 0.5.0. **Pin the version and record it in the
  run metadata**, or the baseline moves underneath the benchmark.
- **Abilities are reached through meta-tools**, not `tools/list`:
  `mcp-adapter/discover-abilities`, `get-ability-info`, `execute-ability`.
  An ability only appears as a direct tool if explicitly listed via
  `create_server()`. Do not do that — see the binding rule above.
- **Auth is Application Passwords**, typically through the
  `@automattic/mcp-wordpress-remote` proxy. This column costs more per-site
  setup than the other two.
- On WP 6.9/7.0 the adapter honours `meta.public` for MCP, but REST access
  still needs `meta.show_in_rest`; core applies `meta.public` to REST only from
  7.1. Cedar spans 6.9.7, 7.0.4 and 7.1, so this difference is live across the
  substrate and must not be assumed uniform.

---

## 3. Substrate

Cedar & Vale Health — eight installs across three host classes, with **planted,
documented pathologies**. That answer key is the reason to use it: the expected
answers are exact and already written down, so assertions can be deterministic
rather than judged.

State measured 2026-08-21:

| Site | Host | WP | Pathology |
|---|---|---|---|
| `cedarvalehealt` (flagship) | WPE | 7.0.4 | — (the reference corpus) |
| `summitdermatol` | WPE | 7.0.4 | **CV-A-01** no `openingHoursSpecification` |
| `ridgelineskini` | WPE | 7.0.4 | **CV-B-01** ghost provider (pairs with flagship) |
| `willowcreekderm` | SpinupWP | 6.9.7 | **CV-C-01** two majors behind, abandoned plugin |
| `piedmontdermgroup` | SpinupWP | 7.1 | **CV-D-01** NAP contradiction on 4 clinics |
| `tablemesaderm` | SpinupWP | 7.1 | **CV-G-01** 8 stale reviews, 3 unreviewed |
| Papago Park Dermatology | Local | 7.0.4 | **CV-E-01** halted |
| Copper Basin Skin Clinic | Local | 7.0.4 | **CV-F-01** 40 verbatim copies |

Coworker reaches non-WPE sites — connection is the `wpe-hub` plugin plus OAuth,
not hosting — so all eight are candidates and all seven pathologies are
testable on a shared substrate. Nexus's own `iw_connect_site` automates this
for **Local sites only**; WPE and SpinupWP are manual browser flows.

Two sites are already IW-connected (`t2`, `myloop`) under project
`proj_cE8Ib44IuegI3rH5l1MbBy` in account `b97e432b-…` — the same WP Engine
account Cedar lives in, so the account and project plumbing exists.

**Known substrate caveats**

- The three SpinupWP domains have no DNS. They serve correctly on a `Host`
  header and are browsable from the demo laptop via `/etc/hosts`, but the sites
  have **no working WordPress loopback**. Anything requiring the site to fetch
  its own URL will fail there for reasons unrelated to the platform under test.
  Record it; do not let it be scored as a platform failure.
- The two Local sites are halted by default and CV-E-01 requires E halted while
  F runs. Site state is part of the fixture and must be asserted before a run,
  not assumed.

---

## 4. The task set

Fixed and committed before the first run. Three groups.

### 4a. Planted pathologies (7)

One per `CV-*` id. Expected answers are exact and already documented in
`canonical-demos/docs/fleet-provisioning.md`. Example — CV-B-01:

```yaml
- description: "CV-B-01 — cross-site provider contradiction"
  vars:
    prompt: "Is any provider listed as actively seeing patients at two different practices in my fleet?"
  assert:
    - type: contains
      value: "1274960149"                                  # the NPI
    - type: icontains-all
      value: ["ridgelineskini", "cedarvalehealt"]          # both installs named
    - type: not-contains
      value: "willowcreekderm"                             # a site with no such provider
    - type: cost
      threshold: 0.10
```

### 4b. Structured-corpus questions (~15)

Answers computable from `cedar-vale-health-demo/data/normalized.json` with no
judging: how many clinics accept a given carrier, which providers speak a given
language, the price range for a treatment in a metro, how many treatments are
past review. **The answer key is generated from the corpus at build time**, so
it cannot drift from what is actually on the sites.

### 4c. Reach tests (~4)

Deliberately ask about a site a given column cannot see. The pass condition is
an honest refusal; the failure is a confident answer. These carry the
`not-contains` assertions and are where a platform loses credibility fastest.

---

## 5. Scoring

**Three repeats per cell** while building, **five for anything published**.
Every cell reports a pass *rate*, never a bare pass/fail: 2/3 and 3/3 are
different claims, and the difference is what a prospect actually hits. Model
non-determinism makes a single run a coin toss dressed as a result.

**Assertions are deterministic wherever the answer key allows** — `contains`,
`icontains-all`, `not-contains`, `javascript`, `cost`. Rubrics only where the
answer is genuinely prose-shaped, and marked as such in the report.

This is the crux of the GTM half. `contains "1274960149"` is a claim a
prospect can verify against a published corpus. `llm-rubric threshold 0.7` is
one they can wave away.

**Cost and tokens are recorded per cell** and reported per column. If a column
wins by spending three times the tokens, that belongs in the headline — and we
would rather find it than have it found for us.

---

## 6. The derived report

The matrix says which cells failed. The gap map has to say *why*, or it is not
a gap map. Every failure is classified:

| Class | Detection | Meaning |
|---|---|---|
| **hallucination** | a `not-contains` assertion failed | Answered about a site it cannot see. The credibility killer. |
| **no-reach** | all content assertions failed and the output matches a refusal | Cannot see the site at all |
| **no-data** | site named, field absent | Sees the site, lacks the field |
| **no-correlation** | both facts present, join absent | Has the halves, cannot connect them |
| **wrong-value** | assertion failed on a value it did produce | Confidently wrong — worse than no-data |

The first three are detectable from assertion results alone. **no-correlation**
and **wrong-value** need a judging pass: an LLM classifier over the transcript
with the assertion results as input. Rows classified that way are **marked as
machine-judged** so they are distinguishable from the deterministic ones —
a reader must be able to tell which claims rest on an exact match and which on
a model's opinion.

Outputs:

- **`promptfoo view`** — the interactive matrix, transcripts behind every cell
- **`results.json`** — raw, committed per run
- **`gap-map.md`** — generated: per-column capability profile, failure
  classification, headline numbers, and an explicit list of what was *not*
  tested

---

## 7. Location and structure

A sibling of the existing eval framework, not an extension of it.

```
tests/platform-bench/
  promptfooconfig.yaml       # 3 providers, repeat: 3
  providers/
    nexus.js                 # local addon MCP
    coworker.js              # HTTP MCP + bearer
    wordpress.js             # mcp-adapter via the remote proxy
  cases/
    pathologies.yaml         # 4a — generated from the CV-* answer key
    corpus.yaml              # 4b — generated from normalized.json
    reach.yaml               # 4c — hand-written
  answer-key/
    build.ts                 # regenerates cases from the corpus
  report/
    classify.ts              # failure taxonomy
    gap-map.ts               # renders gap-map.md
  results/                   # committed run artifacts
```

`tests/evals/` asks "Nexus via CLI or via MCP" — a different question, a
different audience. Merging them muddies both. Same tool, separate experiment.

---

## 8. Prerequisites — the real cost

Roughly a day across eight sites before a single measurement, and the part most
likely to slip.

| | What | Per |
|---|---|---|
| 1 | Coworker personal API key | once |
| 2 | `wpe-hub` installed + OAuth completed | each site (manual for WPE and SpinupWP) |
| 3 | `mcp-adapter` plugin, version pinned — confirmed absent on all sites today | each site |
| 4 | Application Password + `mcp-wordpress-remote` proxy | each site |
| 5 | Nexus MCP server reachable | once |

**Stage it.** Get two sites — one WPE, one non-WPE — working across all three
columns end to end and prove the harness. Only then widen to eight. Building
the full fixture before the mechanics are known-good is how a day becomes a
week.

---

## 9. Non-goals

- **Not a regression harness.** No scheduled runs, no drift alerting. If that
  is wanted later it is a separate concern with different requirements.
- **Not a model comparison.** The model is held constant; only the tool surface
  varies.
- **Not a CLI-vs-MCP comparison.** Settled, and `tests/evals/` already owns it.
- **No custom abilities on demo sites** (§2). Non-negotiable.

---

## 10. Open questions

1. **Can Coworker connect a site with no public DNS?** Expected yes — Jeremy's
   read, consistent with `iw_connect_site` supporting Local sites, which implies
   the plugin pushes rather than the hub pulling. Still **unmeasured**, and it is
   the single largest risk to the substrate: if it cannot, the three SpinupWP
   sites leave the shared corpus and CV-C-01, CV-D-01 and CV-G-01 go with them,
   halving the pathology coverage.

   **Settle it in Stage 1.** The staged rollout in §8 already calls for one WPE
   and one non-WPE site first; make the non-WPE one a SpinupWP site rather than
   a Local site, so the DNS question is answered by the first two connections
   rather than discovered at site six.
2. **Which Claude model, and pinned how?** Comparability across runs depends on
   it, and it belongs in the run metadata alongside the adapter version.
3. **How is the halted site handled?** CV-E-01 requires E halted. A halted site
   is unreachable to the WordPress column by construction, so that cell is
   structurally N/A rather than a failure. Confirm that reads correctly in the
   report.
