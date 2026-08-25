# Platform Benchmark v2 — a comparison suite that can be trusted

**Created:** 2026-08-25
**Status:** Design — awaiting review
**Supersedes in part:** `2026-08-21-platform-benchmark-design.md` (which remains
the substrate and scenario-pathology record; this doc governs harness
architecture, grading, fairness, and operations)
**Primary purpose (decided 2026-08-25): comparison.** The suite exists to
produce an honest, reproducible, potentially publishable comparison of Nexus AI
against WP Engine Coworker (and later a WordPress-abilities column) on the same
fleet-intelligence questions. Regression tracking for Nexus is a secondary
benefit, not the design driver.

That decision has teeth: a comparison must survive an adversarial reader.
Every design choice below is downstream of "could the other side's engineer
find the thumb on the scale?"

---

## 1. Where v1 stands, and why it cannot scale

Built across 2026-08-21 → 25: two custom promptfoo providers shelling to
`claude -p --strict-mcp-config --tools ''`, four tests, repeat 3, hand-written
assertions, a 23-case assertion self-test, isolation preflight in `run.sh`.
Evals `t7J`, `VWU`, `NHz`, `he2` are the record.

Observed defects, each of which is a *class*, not an incident:

| # | Defect | Instance | Class |
|---|---|---|---|
| 1 | Assertions could not fail | `icontains-any ["8","eight"]` passed on any date; reach test accepted the union of all outcomes | vacuous grading |
| 2 | Correct answers scored wrong, 3× | `"cedarvalehealt has"` vs `**cedarvalehealt** has`; `"no hours"` vs "no opening hours" | literal substrings grading free prose |
| 3 | Columns could answer outside their MCP surface | built-in WebFetch/Bash live under `--strict-mcp-config` | isolation by assumption |
| 4 | Cross-run memorisation | shared `/tmp` cwd → shared Claude memory carrying the CV-B-01 answer | uncontrolled state |
| 5 | Answer key rot | "8" was stale (real answer 10); found only by re-measuring | keys divorced from substrate |
| 6 | Subject-under-test unpinned | providers inherit the operator's default model — a `/model` change mid-project silently changed what the benchmark measures | unrecorded variables |
| 7 | Tooling drift | `npx promptfoo@latest`; `--filter-description` ceased to exist between versions | unpinned dependencies |

The fixes so far (clause-scoped JS graders, per-column cwds, `--tools ''`,
re-derived keys) were correct but artisanal. Defect 2 alone consumed three
fix-verify cycles because each fix was a bespoke mini-parser. Ten more
scenarios under this architecture means ten more of those.

What v1 got right and v2 keeps: **the assertion self-test** (real assertion
objects run against canned right/wrong answers — it caught a fourth bug
before any live run did), **the isolation model** (`--tools ''` + per-column
cwd + memory sweep), **answer keys derived from the substrate, never from a
column's output**, and **single-command invocation** via `run.sh`.

---

## 2. Principles

1. **Grade semantics, not strings.** Deterministic checks only for
   deterministic atoms (a count, a version). Everything about prose is judged
   by a rubric-grader that receives the answer key.
2. **Ground truth is derived, never remembered.** A key exists in exactly one
   machine-readable place, regenerated from the substrate, with staleness
   detected loudly.
3. **Every variable is pinned or recorded.** Model, CLI version, promptfoo
   version, harness commit, substrate fingerprint, index age, grader model.
   A result without its manifest is an anecdote.
4. **Fairness is structural, not asserted.** Portfolio balance, symmetric
   scaffolding, blind grading, and a published methods statement — checkable
   properties, not intentions.
5. **The graders are themselves under test.** The self-test corpus survives
   as the permanent net: every grader change re-runs canned right/wrong
   answers, including every real output ever misscored.
6. **Efficiency is measured, not implied.** Cost, turns, and wall-clock per
   cell are captured and reported beside correctness.

---

## 3. Architecture

### 3.1 Grading (replaces hand-written assertions)

Each scenario carries three layers:

- **Anchors** — deterministic regex for atoms that admit no phrasing
  variance: `\b23\b`, `6\.9\.7`. Cheap, zero false-positive-by-construction
  only when the atom cannot appear incidentally; anchors that can (`\b8\b`
  matches "8:00") are dropped or scoped into the rubric instead.
- **Rubric** — a promptfoo `llm-rubric` assertion whose text embeds the
  answer key as supplied fact: *"The verified ground truth: summitdermatol's
  2 locations have no hours fields; cedarvalehealt has hours on all 25.
  PASS only if the response asserts this. FAIL if it claims neither site has
  hours, inverts the sites, or declines."* The grader judges meaning;
  markdown bold, clause order, and synonyms stop being able to fail a
  correct answer. Grader model pinned (haiku-class — the judgment is
  key-comparison, not knowledge), temperature 0, and **blind**: the rubric
  never names which column produced the output. Grader circularity (Claude
  grading Claude) is defused because the key is supplied — the grader
  verifies agreement with stated facts, contributing no knowledge of its own.
- **Per-column expectations** where the columns are *supposed* to differ
  (reach test): the existing `context.provider.label` JS branch remains —
  it is the one place column identity is legitimately load-bearing.

**The self-test becomes the grader-test.** `verify-assertions.js` keeps its
exact contract — load the real assertion objects, run the canned corpus,
fail on any misgrade — now exercising rubrics through the pinned grader.
Every output ever misscored in a live eval enters the corpus verbatim; that
rule is what turned defect 2's third instance into a pre-run catch.

### 3.2 Ground truth (`keys.json`)

A `ground-truth` script batches the substrate measurements (the same wp eval
queries run by hand on 2026-08-24: provider counts and NPI overlap, treatment
review statuses/dates, location hours coverage, WP versions) into
`tests/platform-bench/keys.json`, which is committed. Rubric text and anchors
are templated from it — no number appears in the config that does not appear
in `keys.json`.

`run.sh` preflight re-derives the volatile subset and **fails loudly on
mismatch** ("substrate drifted: treatments now 46, key says 45 — re-run
ground-truth and review scenarios"). A drifted key can no longer silently
grade correct answers as wrong; it stops the run instead.

End-state (already on the roadmap): the canonical-demos seeder generates
Cedar & Vale content *and emits the answers manifest at generation time* —
ground truth by construction. `keys.json` and its script are the bridge; the
schema should anticipate being seeder-emitted.

### 3.3 Pinning and the results ledger

- Providers pass `--model <id>` explicitly; the id lives in one place
  (`isolation.js`) and appears in the manifest. The `/model` incident cannot
  recur.
- promptfoo pinned as a devDependency invocation (`npx promptfoo@0.122.0` or
  the repo's node_modules copy run from a neutral cwd), never `@latest`.
- After each run, `run.sh` archives into `tests/platform-bench/results/<eval-id>/`:
  the promptfoo JSON export and `manifest.json` — harness git SHA, column
  model id, grader model id, claude CLI version, promptfoo version, repeat
  count, `keys.json` hash, per-site substrate fingerprint (content counts +
  latest `post_modified`), and index age per column (Nexus `get_index_status`;
  Coworker KB `last_indexed` where retrievable).
- **The model backend is pinned by gate, not by hope.** The `claude` CLI serves
  the same pinned model ids from Vertex, Bedrock or Anthropic direct, chosen
  purely by environment — and verified 2026-08-25, both `claude-opus-5` and the
  grader's haiku pin resolve cleanly under Vertex *and* under a direct OAuth
  login. A run on the "wrong" backend therefore does not fail; it silently
  succeeds and bills a different account, which is worse than failing because
  nothing in the output says which one served. On the development machine
  `~/.zshrc` exports `CLAUDE_CODE_USE_VERTEX=1`, so a fresh terminal bills WP
  Engine's `wp-engine-ai` project while a shell that ran `unset
  CLAUDE_CODE_USE_VERTEX` bills a personal account — invisible after the fact.
  So: `run.sh` resolves the backend and **refuses** unless it matches
  `BENCH_EXPECTED_BACKEND` (default `vertex` — this benchmark compares a WP
  Engine product against a WP Engine service, so WP Engine is where it should
  bill). There is deliberately no blanket skip flag; a deviation is *declared*
  (`BENCH_EXPECTED_BACKEND=anthropic-oauth ./run.sh`), never stumbled into. The
  gate runs before the drift gate because it is free and the drift gate is not.
  `manifest.json` records what actually served, and the `report` ledger shows it
  as its own column — printing `?`, never a guess, for the runs archived before
  this was captured.

  Scope of the damage this prevents: **column-vs-column fairness was never at
  risk**, since both columns inherit one process environment and therefore
  always share a backend. What is at risk is comparing one archived run against
  another — cost is not comparable across backends (measured on one trivial
  prompt: opus $0.136 via Vertex vs $0.168 direct; haiku $0.032 vs $0.020,
  differing in *both* directions, largely cache state), and neither is latency,
  since quotas differ. That is precisely what `results/` exists to support.
- A `report` script renders the cross-run trend table (per-scenario,
  per-column pass rate + median cost/turns) from `results/`. Markdown out;
  no dashboard.

### 3.4 Efficiency capture

Providers switch to `claude -p --output-format json` and return the `result`
text as output while attaching `total_cost_usd`, `num_turns`, and
`duration_ms` as promptfoo named metrics (v1 discards all three today).
The published comparison reports correctness *and* economics per scenario —
"right answer at what cost" is half the comparison and currently untold.

### 3.5 Fairness (comparison-grade requirements)

- **Symmetric scaffolding.** Coworker's prompt is currently prefixed with a
  hardcoded `COLLECTION_MAP` (site → collection id). Either both columns get
  zero scaffolding — Coworker discovers via its own `list_account_sites` /
  `get_site_knowledge_base`, exactly as Nexus discovers via
  `nexus_list_sites` — or the map stays and the methods statement discloses
  it with the measured discovery cost it avoids. **Decide empirically**: run
  CV-A/B without the prefix; if Coworker reliably self-discovers, drop the
  prefix (preferred — it is also more realistic). A discovery failure is
  itself a result, not a reason to help.
- **Portfolio balance** (see §4): scenarios where Coworker's surface should
  win, scenarios where Nexus should, neutral scenarios, and controls — with
  each scenario's *expected* advantage declared in advance, in the config,
  before results exist. Predictions made after the fact are indistinguishable
  from tuning.
- **Blind rubric grading** (§3.1).
- **No aggregate score.** The report is a per-scenario table with the
  advantage-expectation column beside the result. A single "Nexus wins 83%"
  number invites exactly the scrutiny it cannot survive; per-capability rows
  ("indexes ACF repeaters: Nexus yes, Coworker no — mechanism: KB drops
  non-scalar fields") are defensible because each names its mechanism.
- **Methods statement** — one section in the eventual write-up, generated
  facts from the manifest: substrate description (realistic ACF-heavy
  WordPress; repeaters are ubiquitous in real sites, not a trap), surface
  definitions, scaffolding decisions, grader design, repeat count, and every
  scenario's pre-declared expectation. The Coworker console-key limitation
  (abilities unavailable, KB-only — measured 2026-08-24) is disclosed, and
  re-tested if a personal key ever becomes available.

### 3.6 Scenario packaging

Adding a scenario is one file in `tests/platform-bench/cases/` (dir exists,
empty): prompt, key references, rubric text, anchors, expected-advantage
declaration, and corpus entries (≥1 canned correct answer *in markdown-heavy
formatting*, ≥2 canned wrong answers including the plausible-wrong answer the
scenario is designed to catch). A small loader composes `promptfooconfig.yaml`
tests from `cases/*`; `verify-assertions.js` iterates the same files. The
config stops being the place where grading logic lives.

**Case files are human-readable and human-editable — a requirement, not a
hope.** Everything a case author touches is prose in YAML: the prompt, the
rubric paragraph, the advantage declaration, the corpus answers. No JS in a
case file. This falls out of the grading design — rubrics replace v1's
clause-scoped JS parsers, so the code that made cases unreadable no longer
exists. The permitted non-prose residue is small and declarative: anchor
regexes (one line each) and, for the reach scenario only, a per-column
expectation block. Numbers appear as `{{keys.<name>}}` references resolved
from `keys.json`, so a hand-edited rubric cannot rot the facts. Safety net
for hand edits: `verify-assertions.js` runs the edited rubric against the
case's own canned right/wrong answers, so a wording change that breaks
grading fails loudly before any live run.

Illustrative shape (CV-G-01):

```yaml
id: CV-G-01
dimension: temporal/staleness reasoning
advantage: neutral            # declared before any results exist
prompt: >
  Which treatment pages on cedarvalehealt have not been clinically
  reviewed in the last three years? How many are affected?
anchors:
  - regex: '\b{{keys.treatments_stale_total}}\b'
rubric: >
  Ground truth: {{keys.treatments_stale_total}} of
  {{keys.treatments_total}} treatment pages are stale — 
  {{keys.treatments_overdue}} marked overdue (2021–2022 review dates)
  and {{keys.treatments_unreviewed}} with no review date at all.
  PASS only if the response states the total and distinguishes overdue
  from never-reviewed. FAIL if it reports only the overdue subset as
  the whole answer, or gives a date without a count.
corpus:
  - want: pass
    name: correct — full split
    answer: >
      10 of 45 treatment pages have not been reviewed in three years:
      8 overdue (2021–2022) and 2 with no review date at all.
  - want: fail
    name: wrong — the stale key's answer, overdue subset only
    answer: 8 of 45 treatment pages are overdue for clinical review.
```

---

## 4. Scenario portfolio (target: ~10)

Existing four, re-based onto the new grading:

| ID | Dimension | Expected advantage (declared) |
|---|---|---|
| CV-A-01 | Content-gap detection over ACF repeaters | Nexus (Coworker KB drops non-scalar fields — measured) |
| CV-B-01 | Cross-site entity join (NPI overlap) | Neutral (both answer correctly today) |
| CV-G-01 | Temporal/staleness reasoning (review dates) | Neutral (both answer correctly today) |
| REACH-01 | Fleet reach — external SSH host, WP < 7.0 | Nexus (structural: hub requires WP ≥ 7.0) |

New, to balance and to control:

| ID | Dimension | Expected advantage | Sketch |
|---|---|---|---|
| SEM-01 | Semantic/conceptual content search | **Coworker** | "Which site discusses <concept never stated verbatim>?" — KB embeddings vs Nexus vector index; designed FROM Coworker's `search_knowledge_base` strengths |
| META-01 | ACF metadata filter/aggregation | **Coworker** | A question its measured `acf_` filter/aggregation surface answers in one call (e.g. accepting-patients count per metro) where Nexus needs multi-step |
| DOC-01 | Full-document retrieval fidelity | **Coworker** | "Quote the exact refund-policy wording" — `fetch_knowledge_base_document` vs Nexus chunked index |
| NAP-01 | Cross-site contradiction (CV-D pathology) | Neutral | The NAP contradiction from the original design — multi-step for both |
| NEG-01 | Hallucination control | Neutral | Entity that exists on neither site ("Dr. <fabricated>'s hours?") — both must decline; any answer fails |
| ISO-01 | Isolation canary | Structural control | Task only a built-in tool could do ("read /etc/hosts", "fetch this URL") — **every** column must fail/decline, forever; a pass means the sandbox broke |

SEM/META/DOC-01 are designed from Coworker's measured surface (§0.1 of the
original doc), not guessed — the fairness claim "we built scenarios for their
strengths" must be literally true. If Nexus wins those anyway, that is a
result; if it loses them, the comparison gains the credibility only a loss
can buy.

### In-site intelligence (Alpine Outfitters) — landed ahead of the six above

A different task class from CV-A/B/G. Those are lookups: one verifiable fact,
retrievable in a few calls. These are **audits** — a vague business question
must be decomposed into censuses nobody asked for, and the load-bearing
findings are about **absence**: no audience taxonomy, no kids SKU, no trip a
party of three can book. No retrieval hit can surface a thing that is not
there, which is precisely the capability under test.

Substrate: `alpineoutfitte` (WPE production, WP 7.1) — commerce-shaped, so it
exercises post types the clinic sites do not (181 products, 30 trips, 40
destinations). Both columns reach it: it is a WPE install for Nexus **and**
Coworker collection `col_dhR33vS98LEeZ0CVUVTnZK` (349 docs, post-type facets
and `metadata.acf_*` aggregations available). Counting is not rigged either
way, and the Coworker column's scaffolding gets the same site→collection line
the other three sites get — nothing more.

| ID | Dimension | Expected advantage (declared before first run) |
|---|---|---|
| AO-A-01 | Open-ended coverage audit; reasoning about structural absence | **Nexus, weakly** — the findability blocker needs the tag vocabulary and the destination taxonomy *registration*, neither of which is a document in the KB. Genuinely uncertain: Coworker indexes `acf-field-group` as documents and can aggregate metadata, so it has a real path. |
| AO-B-01 | Threshold aggregation over a metadata field (min group size across 30 trips) | **Neutral** — this is exactly what `metadata.acf_*` aggregations are for. Nexus reaches it by `wp eval`. Both have a route. |
| AO-C-01 | Catalog enumeration with denominator discipline | **Neutral** — product totals and category breakdowns are KB facets. Coworker should answer this cleanly. |

Two of three are declared neutral deliberately. A family stacked toward Nexus
would tell us nothing; per the note above, a loss here buys credibility no win
can.

**Grading shape.** The audit answer decomposes into two layers, and only one is
graded. The *facts* are measured atoms in `keys.json` (`sites.alpineoutfitte`),
so the drift gate protects them exactly as it does the clinic figures. The
*recommendations* — what to build first, in what order — are judgment, where
two good answers legitimately differ; they are explicitly **not** graded, and
the rubrics say so. Grading advice quality is where benchmark rubrics go to die.

**Two guards this family adds:**

- **Correct by blindness.** A negative finding can be accidentally right: a
  column that cannot see products at all will say "no kids gear" and be
  correct for the wrong reason — the same pathology REACH-01 exists to catch.
  AO-B-01 and AO-C-01 therefore require the *denominator* (the 30-trip
  inventory, the 181-product catalogue) and fail a bare, ungrounded "none".
- **No deterministic content anchors.** CV-G-01 already retired its numeric
  anchors (`\b8\b` matches "8:00"; dates contain `\b10\b`), and the P1+P2
  whole-branch review flagged CV-B-01's `not-icontains` guard as able to
  false-negative an honest scoping mention. An audit's wording varies far more
  than a lookup's, and every site name worth guarding against already appears
  in the Coworker column's own prepended collection map — a guard would fire on
  a model that merely names the collection it chose. The rubrics carry explicit
  fabrication FAIL clauses instead.

**Prompts name `alpineoutfitte` explicitly.** Four Alpine installs exist
(production / staging / development / a Local site) — the name-collision hazard
`CLAUDE.md` documents for `goldenecomm`. Left ambiguous, a column may route to
the halted Local site and **start** it mid-run, and the run would be grading
harness side effects instead of intelligence.

**Cost.** Audit cells run long (~2–3 min each). Three scenarios × 2 columns ×
repeat 3 = 18 cells; `--filter-pattern 'AO-'` runs the family alone.

Not in scope (YAGNI, revisit deliberately): multi-turn scenarios, mutation/
write scenarios, CI integration, dashboards, the WordPress-abilities column
(blocked on custom abilities; slot reserved — a third provider file drops in).

---

## 5. Phasing

Each phase leaves the suite runnable and is worth a commit sequence of its own.

- **P1 — Grading + pinning** (highest leverage): rubric grading with key-in-
  rubric, blind, pinned grader; anchors audit (kill `\b8\b`-class); explicit
  `--model`; pinned promptfoo; `--output-format json` metrics; self-test
  re-pointed at rubrics. Exit: all 12 archived real outputs re-score
  correctly through rubrics; self-test corpus green; one live CV-A-01 run
  matches.
- **P2 — Ground truth + ledger**: `ground-truth` script → `keys.json`;
  preflight drift gate; manifest + results archiving; `report` script.
  Exit: a run refuses to start against a mutated substrate; two archived
  runs render a trend table.
- **P3 — Portfolio**: `cases/` packaging; migrate the four; add the six new
  scenarios with pre-declared expectations; scaffolding-parity experiment
  (drop `COLLECTION_MAP` if discovery works). Exit: ~10 scenarios, each with
  corpus entries, portfolio table checked in before any full run.
- **P4 — Publishable run**: repeat 5, full suite, methods statement generated
  from manifest + portfolio declarations.

Rough scale at P4: 10 scenarios × 2 columns × 5 = 100 cells ≈ 2.5–4 h
sequential. Acceptable for a publishable run; iteration uses repeat 2 and
`--filter-pattern`. Per-column parallelism (different backends) is a P4
option if it hurts.

---

## 6. Open questions

1. **Grader model**: haiku-class is the cost-right default for key-comparison
   grading; confirm it passes the corpus, escalate per-scenario only on
   measured misgrades.
2. **Coworker personal API key**: abilities are absent under the console key.
   Pursue one (unlocks `run_site_ability` scenarios and a fairer surface), or
   disclose and proceed? Proceeding is legitimate — the console key *is* the
   product surface most customers get — but the methods statement must say so.
3. **Substrate freeze vs seeder**: freeze Cedar & Vale content for the P4 run
   (fingerprint-pinned), or wait for seeder-generated substrate? Recommend
   freeze-and-fingerprint now; seeder later replaces the bridge.
