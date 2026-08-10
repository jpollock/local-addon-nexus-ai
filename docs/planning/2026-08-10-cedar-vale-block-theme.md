# Cedar & Vale Block Theme — Implementation Plan (Plan 1d)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 840-item Cedar & Vale site from a stock-theme WordPress install into the designed property — a block theme whose structured data renders the page.

**Architecture:** A WordPress block theme, `cedar-vale`, living beside the seeder plugin in `cedar-vale-health-demo/wordpress/themes/`. `theme.json` carries the design tokens verbatim from the handoff. Page structure is block templates and template parts. ACF values reach the page through **Block Bindings** where a block can express the field, and through small registered blocks where it cannot (hours table, price strip, monogram, review strip, archive facets).

**Tech Stack:** WordPress 7.0.3 block theme (`theme.json` v3), PHP 8.2, ACF Pro 6.8.6, Block Bindings API, self-hosted variable woff2.

## The design handoff is the visual source of truth

`cedar-vale-health-demo/design/README.md` — committed at `cef90c0`. It carries the token
table, the six screen specs, component notes for every variable-length and empty state, the
interaction table and the performance rationale. **Read the relevant screen section before
building its template.** This plan does not restate its measurements; duplicating them would
create two sources that drift.

`design/theme.json` is transcribable as-is for Task 1. The three `.dc.html` files open in a
browser with no build step and show desktop 1180px and mobile 390px side by side.

Every contrast ratio in that token table was verified independently before this plan was
written: 15 of 15 accurate to within 0.02.

## Global Constraints

- **WCAG 2.2 AA is a gate, not a goal.** Body ≥ 4.5:1, large text ≥ 3:1, UI boundaries and
  focus indicators ≥ 3:1. Any pairing not in the handoff's table must be measured before use.
  `border` (1.29:1) is decorative only and must never be the sole boundary of a control;
  `border-strong` (3.40:1) is the control boundary.
- **Green Core Web Vitals is a gate.** A property that argues for content quality while
  failing CWV refutes itself in the dev tools of anyone who looks.
- **No photorealistic provider imagery, generated or otherwise.** Monogram treatment only.
  Sixty synthetic faces presented as board-certified dermatologists is indefensible the
  moment a screenshot travels without context.
- **200% zoom and forced-colors mode both work.** Root font-size untouched, every step in
  rem, no fixed heights on text containers, every control carries a real 1px border.
- **Never invent a value to fill a slot.** The null `fda_status` renders an explicit absent
  state and is omitted from schema.org output entirely. This rule has been broken twice on
  this property already and caught both times.
- The theme reads data; it never writes. Import and verification stay with the plugin.
- Never `git push`, `npm version`, or `git tag` — commits only.

## Reconciling the design against the real corpus

Measured 2026-08-10 against `data/normalized.json` (840 items). The design was written
against the content model, and six things it assumes are not in the data. **These
resolutions are decided — do not re-litigate them mid-task, and do not silently paper over
them either.**

| Design assumes | Corpus reality | Resolution |
|---|---|---|
| Reading level is a live 3-way control swapping between three stored body variants | One `post_content` and one `reading_level` per post (plain 207 / standard 190 / clinical 203) | **Render as a label and an archive facet, not a switcher.** Building it needs ~1,200 more AI calls and a content-model change. Do not build a control that cannot change anything. |
| `read_time` field | absent | Compute at render from word count. |
| A next-review-due date on providers and articles | Only `review_date`, `reviewed_by`, `review_status` | **Omit.** Deriving "due" from a 12-month rule invents a policy the data does not state. Show reviewer and date. |
| `location.providers[]`, `location.plans[]`, `condition.articles[]` | `location` has **zero** outbound relationships. These exist only inbound: `provider.locations`, `insurance_plan.accepted_at`, `post.internal_links` | **Reverse query at render**, cached in a transient. See Task 4. |
| Symptoms carry "term — plain-language gloss" | Bare terms (`comedones`, `pustules`) | Render the term. No gloss. |
| Review-status facet counts 541 / 38 / 21 | Articles are **479 reviewed / 34 unreviewed / 87 overdue** | Counts are computed from the result set; never hardcode either set of numbers. |

Note the field is spelled `anesthesia` in the corpus; the handoff writes "anaesthesia" in
prose. Use the corpus field name in code, either spelling in the visible label.

---

## File Structure

```
cedar-vale-health-demo/wordpress/themes/cedar-vale/
  style.css                     Task 1  theme header only
  theme.json                    Task 1  transcribed from design/theme.json
  functions.php                 Task 1  enqueue, font preload, bindings + block registration
  assets/fonts/                 Task 1  Newsreader + Archivo, subset woff2
  parts/
    header.html                 Task 2
    footer.html                 Task 2
  templates/
    index.html                  Task 2
    single-location.html        Task 4
    single-provider.html        Task 5
    single.html                 Task 6   (core `post` — the articles)
    single-condition.html       Task 7
    single-treatment.html       Task 7
    archive.html                Task 8
  inc/
    bindings.php                Task 3  ACF -> Block Bindings source
    blocks.php                  Task 3  registration for the blocks bindings cannot express
    reverse.php                 Task 4  inbound-relationship lookups + transient cache
    render/                     Tasks 4-8  one render callback per custom block
```

---

### Task 1: Theme scaffold, tokens, and fonts

**Files:** `style.css`, `theme.json`, `functions.php`, `assets/fonts/*`

- [ ] **Step 1: Scaffold and transcribe tokens**

`style.css` carries only the theme header (`Theme Name: Cedar & Vale`, `Requires at least:
6.8`, `Requires PHP: 8.2`, `Text Domain: cedar-vale`). Copy `design/theme.json` to the theme
root **unmodified** — it is v3, 14 colour tokens including the three review-state ink/tint
pairs, 10 type steps, 10 spacing steps, and a styles block.

Add `templateParts` and `customTemplates` declarations, which the supplied file does not
carry, so header/footer resolve and the CPT templates are selectable.

- [ ] **Step 2: Self-host the fonts**

Newsreader (opsz 6–72, wght 300–700) and Archivo (wght 400–700), Latin subset, woff2,
registered through `theme.json`'s `fontFace` so they appear in the editor too. `font-display:
swap`. Metric fallbacks Georgia and system-ui so the swap costs no layout shift.

Preload **both** files in `functions.php` — the LCP element is a text node (the 52px article
H1), so a late font is a late LCP.

- [ ] **Step 3: Verify tokens resolve**

```bash
wp eval 'print_r( wp_get_global_settings()["color"]["palette"]["theme"] );'
```

Expected: all 14 slugs. Then confirm the theme activates and the front page still returns
HTTP 200. Commit.

---

### Task 2: Frame, base styles, and the index template

**Files:** `parts/header.html`, `parts/footer.html`, `templates/index.html`

Header is 68px desktop / 56px mobile, `#FFFFFF` ground, 1px `border-strong` bottom rule,
current nav item marked with a 2px `accent` bottom edge. Ruled, not floated — `shadow: none`
is the system default and the single `shadow-overlay` is reserved for overlays, always with a
1px border so it survives forced-colors.

The focus ring is `2px solid accent` at `2px` offset on **every** focusable element, never
suppressed, switching to `surface` on accent-ground controls. Verify by tabbing the whole
page, not by reading the CSS.

Commit after the front page renders with the frame and passes a tab pass.

---

### Task 3: The bindings layer and shared components

**Files:** `inc/bindings.php`, `inc/blocks.php`

- [ ] **Step 1: Register an ACF Block Bindings source**

Register source `cedar-vale/acf` so a paragraph or heading can bind `{ "source":
"cedar-vale/acf", "args": { "key": "phone" } }`. Return **null**, not an empty string, when a
field is absent — a template must be able to tell "no value" from "empty value", which is the
whole basis of the absent-state rendering.

- [ ] **Step 2: Register the blocks bindings cannot express**

Bindings replace a single attribute on an existing block. These need render callbacks:

| Block | Used by | Why not a binding |
|---|---|---|
| `cedar-vale/review-state` | provider, article, condition, treatment | ink + tint + glyph + label move together |
| `cedar-vale/monogram` | provider, article, lists | initials, hashed tint, five sizes |
| `cedar-vale/chip-list` | languages, specialties, body areas | wraps an array, no truncation |
| `cedar-vale/hours-table` | location | 7 rows, today, closed Sunday |
| `cedar-vale/price-strip` | treatment | 25 bars on a shared axis |
| `cedar-vale/relation-list` | location, condition, treatment, article | reverse lookups, pagination past 8 |

**The review-state component is the one to get right** — it appears on four post types. Ink,
tint, glyph (`✓ ▲ ○`) and written label change **together**. Colour is never the only carrier:
green and ochre are confusable under deuteranopia. `unreviewed` is achromatic on purpose — it
is the absence of a state, not a third alarm.

**The monogram is the no-faces rule in code.** Initials in Newsreader 500 on a tinted square,
radius 3px, 1px `border-strong`. Tint rotates across `#EFEBE4` / `#E6EFE9` / `#F6EBD8` keyed
to a hash of the provider ID with matching ink (`accent` / `reviewed` / `overdue`); all three
pairs clear 6.7:1. Sizes 180 / 120 / 88 / 56 / 52 / 48px.

Chips wrap with an 8px flex gap, never source whitespace. **No truncation and no "+2 more"** —
a language the patient cannot see is a language the provider does not have.

- [ ] **Step 3: Test each component against real records**

For each: zero items, one item, and the largest real case. Assert the review-state block
emits the glyph and the label, not merely the colour — a test that only checks the tint would
pass an implementation that fails for a colourblind reader.

---

### Task 4: Location template and the reverse-relationship layer

**Files:** `templates/single-location.html`, `inc/reverse.php`, `inc/render/`

**This task carries the plan's one piece of real architecture.** The design's right rail is
"providers at this location" and "plans accepted here". Neither is a field on `location` —
`location` has **zero** outbound relationships. They exist only inbound, as
`provider.locations` and `insurance_plan.accepted_at`.

- [ ] **Step 1: Build the reverse lookup**

ACF stores a relationship as a serialised array of post IDs in one meta row, so the query is a
`meta_query` with `LIKE` on `:"<id>";`. Wrap each lookup in a transient keyed by post type and
ID, invalidated on `save_post`. At this scale — 25 locations, 60 providers, 30 plans — the
uncached query is already fast; the cache is for the archive, where the pattern repeats per row.

Do **not** solve this by writing reverse fields back into ACF at import time. That would change
the `ACF_FIELD_NAMES` / `RELATIONSHIP_TARGETS` contract the importer and the next plan depend on,
to serve a presentation concern.

- [ ] **Step 2: Build the rail**

Accepting-new-patients is a boolean rendered as a full-width chip: true takes the `reviewed`
pair and `✓`; false flips to the achromatic `unreviewed` pair, `○`, label "Not currently", and
a helper sentence naming the nearest accepting clinic. **Label, tint, glyph and helper change
together.**

Hours: 7 rows, `<th scope="row">` per day, tabular-nums, today's row carrying a 2px `accent`
left edge at 600 weight — **computed from the location's timezone, not the visitor's**. Sunday
is a **filled** row, tint `#EFEBE4`, uppercase CLOSED, full height, `forced-color-adjust: none`.
A blank cell is indistinguishable from data that failed to load — this is the same defect
already fixed once in this property's JSON-LD.

- [ ] **Step 3: Verify against a real location**

`cedar-vale-dermatology-denver-80202`: 7 hour rows with Sunday closed, providers and plans
populated by reverse lookup, accepting chip in the true state. Confirm a location with **zero**
providers drops the whole block including its heading — an empty "Providers at this location"
heading reads as a broken page.

---

### Task 5: Provider template

**Files:** `templates/single-provider.html`

Three columns: 180px monogram, biography at 66ch, 320px field rail. Rail rows — credentials,
specialties, board certifications, languages, practises at — each a 12px uppercase Archivo
label over the value, separated by 1px `border` rules. Page foot carries the `reviewed` strip
with reviewing clinician and review date. **No next-review date** (see reconciliation).

On the header line one specialty prints as prose; two or more fall back to the chip list.

Verify with `clementine-lang-md` (MD, one specialty, two languages, one board, one location)
and with the provider carrying the most languages — confirm six chips wrap to three rows in
the 320px rail and grow the card rather than truncating.

---

### Task 6: Article template

**Files:** `templates/single.html`

Grid is `180px / minmax(0,660px) / 220px`, 28px gap, 32px padding — it sums exactly, and the
middle track is the 68ch measure which must not be squeezed.

- 3px reading-progress bar under the header, `aria-hidden` — it is decorative.
- Left rail: sticky TOC, current item on a 2px `accent` left edge, highlighted on scroll.
  **Do not use `scrollIntoView`.**
- **Reading level renders as a label, not a control** (see reconciliation). State the level and
  what it means. Do not build a segmented control that cannot change anything.
- Medical review appears twice: a quiet "✓ Medically reviewed" link in the byline jumping to
  the full attribution block at the foot. Findable, not shouting.
- "Mentioned in this article" — a 2-up grid over `internal_links`, each labelled Condition or
  Treatment. **The relation is heterogeneous**: 792 references across the corpus, 508 to
  treatments and 284 to conditions. Resolve by the target's actual post type; a resolver
  assuming one type per key drops hundreds of references.
- Compute read time from word count.

Verify the layout holds at 1,200 words: rails go sticky, the measure never changes width.

---

### Task 7: Condition and treatment templates

**Files:** `templates/single-condition.html`, `templates/single-treatment.html`

Condition: ICD-10 chip pairing a 12px uppercase label with the code in monospace 17px/600 — it
is an identifier and should look like one. Body areas as chips, symptoms as a list (**terms
only, no gloss**), treatments as a 4-up card grid, articles by reverse lookup.

Treatment: five-cell fact grid — duration, anaesthesia, downtime, insurance covered, FDA status.

**The null `fda_status` is the task's real test.** It renders as a tinted cell (`#EFEBE4`), an
em dash at value size in `border-strong`, and "Not recorded" at 15px in `text-muted`. Not
hidden — a missing cell in a five-cell grid reads as a rendering bug. Not "N/A" and not "0" —
both assert something the database does not say. And it is **omitted entirely** from the
page's schema.org output rather than emitted empty. Verify on a treatment where it is null
(`mohs-surgery`) and one where it is not.

**The price strip** is the most interesting structured element on the site: 25 per-location
ranges on one shared `$900`–`$2,300` axis, **sorted by lowest quoted price, not
alphabetically — the ranking is the information.** The reader's clinic is `accent` with metro
and figures printed; the other 24 are `border-strong`, metro only. Below the strip: network
low, median, high, each naming the clinic that holds it. Below 700px it collapses to an 8px
sparkline with end labels. Bars carry explicit percentage `left`/`width` so nothing reflows
after hydration — target CLS 0.

---

### Task 8: Article archive and filters

**Files:** `templates/archive.html`

600 records, 280px filter rail. Four facets mapping to the real taxonomies: condition category
(checkboxes with counts), body area (chip multi-select, selected chips invert to `accent`),
reading level (three-way), review status (three state pairs with counts).

**Server-rendered and URL-encoded**, so a filtered view is shareable and crawlable. Facet
counts update with the result set — **compute them, never hardcode**. The handoff's
541 / 38 / 21 is illustrative; the real distribution is 479 reviewed / 34 unreviewed /
87 overdue.

Results header states filtered count against total ("42 articles of 600") and echoes the
active filters in words. Rows carry title, one-line excerpt, and a chip row of review state
with date, reading level, condition, body area, and read time right-aligned.

Mobile collapses the rail behind a Filters button carrying the active count, active filters
shown as dismissible chips above the results.

---

### Task 9: The gates

**Files:** none — this task measures and fixes.

Not a formality. These are acceptance criteria and the property's own argument depends on them.

- [ ] **Contrast.** Every rendered pairing measured, not assumed. Any pairing absent from the
  handoff table gets measured before it ships.
- [ ] **Keyboard.** Tab the whole of all six screens. Focus ring visible on every stop,
  including on accent-ground controls where it switches to `surface`. Nothing focusable is
  reachable only by pointer.
- [ ] **200% zoom** on all six screens: no clipping, no horizontal scroll, no overlap.
- [ ] **forced-colors mode**: chips, the closed-Sunday row, price bars and review states all
  survive. This is what `forced-color-adjust: none` and the real 1px borders are for.
- [ ] **Core Web Vitals** on the article and the archive — the two heaviest screens. LCP is the
  article H1 text node. Report the measured figures; do not assert green without numbers.
- [ ] **Screen reader pass** on the location hours table and the review states: the day is a row
  header, and the review state announces its label rather than only its colour.

## Definition of Done

- [ ] All six screens render from real content at desktop and mobile.
- [ ] `wp cedar verify` still exits 0 — the theme is read-only and must not perturb the corpus.
- [ ] No photorealistic provider imagery anywhere.
- [ ] The null `fda_status` renders its absent state and is absent from schema.org output.
- [ ] Sunday reads as closed, not blank.
- [ ] Facet counts are computed; no hardcoded totals anywhere in the theme.
- [ ] Measured CWV and contrast figures recorded in the final report.
- [ ] One commit per task, none pushed.

## Out of scope

- The reading-level switcher (needs ~1,200 more AI calls and a content-model change).
- Symptom glosses, `read_time` as a stored field, next-review dates.
- Imagery via the gateway's image models (spec §5) — hero art and location photography are a
  later pass; the design deliberately needs no hero images to hit its CWV gate.
- Meridian's theme, which shares the token system but is deliberately the opposite property.
