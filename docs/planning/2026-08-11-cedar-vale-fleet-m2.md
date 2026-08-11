# Cedar & Vale Fleet (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the seven acquired-practice installs that surround the Cedar & Vale flagship, split across Local, WP Engine and SpinupWP, each carrying exactly one planted pathology that a named Nexus tool can find.

**Architecture:** A fleet site is a *manifest plus a skew*, not a second codebase. Each site's corpus is **derived** from the flagship's `data/normalized.json` by reference-closed subsetting, **localized** so its articles are not byte-identical to the parent's, then mutated by one skew function that plants its pathology. No regeneration, no API spend. The existing `wp cedar import` / `wp cedar verify` commands, ACF field groups, seeder plugin and Cedar theme are reused unchanged. Provisioning differs per host class; the corpus pipeline does not.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, ESM `NodeNext`), zod, vitest, tsx; WP-CLI; Nexus AI MCP tools (`local_create_site`, `local_wpe_push`, `nexus host add`); SpinupWP over SSH.

## Global Constraints

- **Spec is `docs/planning/2026-08-09-canonical-demo-sites-design.md` §1.2, §1.3, §3.1, §3.2.** The pathology ids, host assignments and defect definitions there are binding. Do not invent an eighth pathology or move a site between host classes.
- **Host split is fixed:** A, B → WP Engine. C, D, G → SpinupWP (one server). E, F → Local. Flagship → WP Engine production, with the existing `cedarvale.local` as its Local development clone.
- **How many SpinupWP aliases depends on the site users, and is measured, not assumed.** This plan originally mandated one alias for all three sites. On the live server that is impossible unless the sites share a system user: `wp-config.php` is `0600`, owner-only, so no other user — sudo user included — can bootstrap `wp` in someone else's site, and Nexus never sudos. If SpinupWP's New Site form lets all three sites run as the existing `cedarvale-spin` user, use one alias; otherwise use three. Nothing rides on the outcome: the `ssh:<alias>/<site>` multi-site form is already live in the fleet via `ssh:hostinger-test`, which carries two sites. Whatever is true, `fleet.json` must state it, because Task 8 registers exactly what it says.
- **No corpus regeneration.** Fleet corpora are derived from `cedar-vale-health-demo/data/normalized.json`. Zero calls to any completion API in this plan. A task that adds one is wrong.
- **Determinism.** Every sampling decision is seeded from the fleet manifest. Running the build twice must produce byte-identical corpora. No `Math.random()`, no `Date.now()`, no bare `new Date()` — in production code *or* in tests.
- **No `cv_*` marker fields.** Every pathology must be detectable from fields that already exist in `scripts/src/acf/field-types.ts`. A new ACF key would have to be added to `FIELD_TYPES`, which would put it on the flagship's field groups too; worse, a corpus that flags its own defects proves nothing, because the demo would be finding the flag rather than the problem. If you cannot detect a pathology without a marker, the pathology is wrongly designed.
- **Articles are localized; that is what makes CV-F-01 real.** Every `post` on a fleet site gets a site-specific lead sentence prepended, so its `post_content` is *not* byte-identical to the flagship's. Only CV-F-01's 40 stolen posts skip localization. Without this, every article on all seven sites is a verbatim flagship copy and "copy-pasted verbatim" describes the whole fleet instead of one site.
  Measured: only the 25 `location` items mention the brand at all; all 600 posts, 60 providers, 45 treatments and 80 conditions are brand-free clinical prose. **Localize `post` items only** — a location's description is a factual address sentence, and renaming a clinic would break CV-D-01's requirement that the contradicted clinics stay recognisably the same place.
- **A dropped reference is a bug, a planted one is a feature.** After derivation and skew, zero dangling relationship targets and zero dangling ACF slug references may remain. The build fails otherwise.
- **Never null a `reviewed_by` except in CV-G-01's skew.** A missing reviewer is G's pathology. Derivation must pull referenced providers into the kept set rather than nulling the reference, or every site silently acquires G's defect and the compliance signal becomes noise. This is asserted across all six other sites, not assumed.
- **Corpus item shape (existing, do not change):**
  ```ts
  { slug: string; post_type: 'location'|'provider'|'treatment'|'condition'|'post'|'insurance_plan';
    post_title: string; post_content: string; post_status: string;
    acf: Record<string, unknown>; relationships: Record<string, string[]> }
  ```
- **Relationship keys (existing, exhaustive):** `provider.locations`, `treatment.conditions_treated`, `condition.related_treatments`, `post.internal_links`, `insurance_plan.accepted_at`.
- **ACF fields that carry a slug reference** (not in `relationships`, but must still close): `provider.bio_reviewed_by`, `treatment.reviewed_by`, `condition.reviewed_by`, `post.reviewed_by` → provider slug; `post.condition_focus` → condition slug; `post.treatment_focus` → treatment slug; `treatment.price_range_by_location[].location` → location slug.
- **`2026-08-11` is the corpus reference date.** All relative-age arithmetic (14 months, 36 months) is measured from it as a constant, never from the clock.
- **The acceptance test is a Nexus tool call, not a unit test.** A pathology that unit tests confirm is present in the corpus but that `compare_sites` / `detect_drift` / `fleet_sql` cannot surface has not been built. Task 9 is the real gate.
- **Seeding bypasses Nexus's write gate deliberately.** `wpcli` is refused on `production`; fleet sites are registered `production` *after* seeding. Do not register a site as `development` to make an importer run (spec §1.3).
- Commit after each task. Do not `git push`, `npm version`, or `git tag` — the repo has no remotes and releases require explicit permission (CLAUDE.md).

---

## File Structure

| File | Responsibility |
|---|---|
| `cedar-vale-health-demo/fleet/fleet.json` | The seven site definitions — the only place a site's identity, host, seed, counts and skew live |
| `scripts/src/fleet/schema.ts` | zod schema + `FleetSite` / `FleetManifest` types; parses and validates `fleet.json` |
| `scripts/src/fleet/corpus-types.ts` | `CorpusItem` type + the reference-extraction helper both derive and skew depend on |
| `scripts/src/fleet/derive.ts` | Reference-closed subsetting of the flagship corpus |
| `scripts/src/fleet/localize.ts` | Per-site article rewriting, so fleet prose is not a verbatim parent copy |
| `scripts/src/fleet/skew/index.ts` | Skew registry: pathology id → skew function |
| `scripts/src/fleet/skew/{cv-a,cv-b,cv-d,cv-f,cv-g}.ts` | One corpus skew each |
| `scripts/src/fleet/assert-pathology.ts` | Post-skew assertions — proves each corpus carries its defect before anything is imported |
| `scripts/src/fleet/build.ts` | CLI: derive → localize → skew → assert → write `data/fleet/<id>/normalized.json` |
| `canonical-demos/docs/fleet-provisioning.md` | The per-host runbook produced by Tasks 5–7 |
| `canonical-demos/docs/fleet-acceptance.md` | The measured tool output produced by Task 9 |

Platform pathologies (`CV-C-01` version drift, `CV-E-01` halted) have no corpus component and appear only in provisioning tasks.

---

## Measured against the live corpus, 2026-08-11

Read before assuming a count is safe. All figures come from
`cedar-vale-health-demo/data/normalized.json` as committed (840 items: 25
locations, 60 providers, 45 treatments, 80 conditions, 600 posts, 30 insurance
plans).

| Fact | Value | Why it matters |
|---|---|---|
| Providers per clinic | 3–5 | Sets how many providers a one-clinic site keeps before reviewer closure |
| Providers with more than one clinic | **17 of 60** | The reason CV-B-01's detection must test *disjoint* location sets, not merely different ones — derivation prunes these to a subset, which is different but overlapping |
| Site F's provider set after transitive reviewer closure | 3 → **15** | Reviewer pull-in more than quadruples a one-clinic site's provider set |
| Flagship posts whose reviewer is in site F's set | **330** | CV-F-01 needs 40 beyond F's own 20; margin is large |
| CV-B-01 ghost candidates disjoint from B's two Boulder clinics | **54 of 60** | No risk of the skew failing to find one |
| Items mentioning "Cedar & Vale" in `post_content` | **25 — all locations** | Why localization prepends a lead rather than substituting a brand name: the 600 posts have no brand string to swap |

Re-measure rather than trusting these if the flagship corpus is regenerated.

---

## Phase A — corpus pipeline (Tasks 1–5)

No infrastructure, no API spend, no external dependencies. Executable immediately.

---

### Task 1: Fleet manifest schema and the seven site definitions

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/fleet/schema.ts`
- Create: `cedar-vale-health-demo/fleet/fleet.json`
- Test: `cedar-vale-health-demo/scripts/src/fleet/schema.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PATHOLOGY_IDS`, `type FleetSite`, `type FleetManifest`, `parseFleetManifest(raw: unknown): FleetManifest`, `loadFleetManifest(path: string): FleetManifest`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/src/fleet/schema.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFleetManifest } from './schema.js';

const manifestPath = fileURLToPath(new URL('../../../fleet/fleet.json', import.meta.url));
const manifest = parseFleetManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));

describe('fleet manifest', () => {
  it('defines exactly the seven sites the spec names', () => {
    expect(manifest.sites.map((s) => s.id)).toEqual([
      'cedar-vale-a', 'cedar-vale-b', 'cedar-vale-c',
      'cedar-vale-d', 'cedar-vale-e', 'cedar-vale-f', 'cedar-vale-g',
    ]);
  });

  it('assigns the host classes from spec §1.3', () => {
    const byId = Object.fromEntries(manifest.sites.map((s) => [s.id, s.host]));
    expect(byId).toEqual({
      'cedar-vale-a': 'wpe', 'cedar-vale-b': 'wpe',
      'cedar-vale-c': 'spinupwp', 'cedar-vale-d': 'spinupwp', 'cedar-vale-g': 'spinupwp',
      'cedar-vale-e': 'local', 'cedar-vale-f': 'local',
    });
  });

  it('gives every site exactly one pathology, and covers all seven', () => {
    const ids = manifest.sites.map((s) => s.pathology);
    expect([...ids].sort()).toEqual([
      'CV-A-01', 'CV-B-01', 'CV-C-01', 'CV-D-01', 'CV-E-01', 'CV-F-01', 'CV-G-01',
    ]);
  });

  it('gives every SpinupWP site an alias that exists in ~/.ssh/config', () => {
    // Deliberately does NOT require the three to share one alias. SpinupWP's
    // per-site 0600 wp-config.php makes a shared alias possible only when the
    // sites also share a system user; whether they do is a dashboard choice at
    // provisioning time. Task 8 registers whatever this file says.
    for (const s of manifest.sites.filter((x) => x.host === 'spinupwp')) {
      expect(s.sshAlias).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    }
  });

  it('gives every site a distinct seed, so no two derive the same sample', () => {
    const seeds = manifest.sites.map((s) => s.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('gives CV-D-01 exactly the four clinics its pathology needs', () => {
    const d = manifest.sites.find((s) => s.id === 'cedar-vale-d')!;
    expect(d.locations).toHaveLength(4);
  });

  it('gives CV-G-01 enough treatments to carry 8 stale plus 3 unreviewed', () => {
    const g = manifest.sites.find((s) => s.id === 'cedar-vale-g')!;
    expect(g.counts.treatment).toBeGreaterThanOrEqual(11);
  });

  it('rejects a site whose pathology is not one of the seven', () => {
    expect(() =>
      parseFleetManifest({
        flagshipCorpus: 'data/normalized.json',
        sites: [{ ...manifest.sites[0]!, pathology: 'CV-Z-99' }],
      }),
    ).toThrow();
  });

  it('rejects a spinupwp site with no sshAlias', () => {
    const c = manifest.sites.find((s) => s.id === 'cedar-vale-c')!;
    const { sshAlias, ...withoutAlias } = c;
    expect(() =>
      parseFleetManifest({ flagshipCorpus: 'data/normalized.json', sites: [withoutAlias] }),
    ).toThrow(/sshAlias/);
  });

  it('rejects an sshAlias on a non-spinupwp site', () => {
    const e = manifest.sites.find((s) => s.id === 'cedar-vale-e')!;
    expect(() =>
      parseFleetManifest({
        flagshipCorpus: 'data/normalized.json',
        sites: [{ ...e, sshAlias: 'cedarvale-spin' }],
      }),
    ).toThrow(/sshAlias/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/schema.test.ts`
Expected: FAIL — `Cannot find module './schema.js'`

- [ ] **Step 3: Write the schema**

```ts
// scripts/src/fleet/schema.ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const PATHOLOGY_IDS = [
  'CV-A-01', 'CV-B-01', 'CV-C-01', 'CV-D-01', 'CV-E-01', 'CV-F-01', 'CV-G-01',
] as const;

export const POST_TYPES = [
  'location', 'provider', 'treatment', 'condition', 'post', 'insurance_plan',
] as const;

const CountsSchema = z
  .object({
    treatment: z.number().int().nonnegative(),
    condition: z.number().int().nonnegative(),
    post: z.number().int().nonnegative(),
    insurance_plan: z.number().int().nonnegative(),
  })
  .strict();

const FleetSiteSchema = z
  .object({
    id: z.string().regex(/^cedar-vale-[a-g]$/),
    /** The acquired practice's own trading name — used by localization. */
    label: z.string().min(1),
    /** Spec §3.2 letter. */
    letter: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']),
    host: z.enum(['local', 'wpe', 'spinupwp']),
    /** Required for host === 'spinupwp'; one alias serves all three sites. */
    sshAlias: z.string().optional(),
    pathology: z.enum(PATHOLOGY_IDS),
    /** Deterministic sampling seed. Distinct per site. */
    seed: z.number().int().positive(),
    /** Flagship location slugs this practice operates. Explicit, never sampled:
     *  CV-D-01 needs four specific shared clinics, and every site's provider set
     *  is closed over from this list. */
    locations: z.array(z.string().min(1)).min(1),
    /** How many of each remaining type to sample. */
    counts: CountsSchema,
    /** Theme slug. C runs stock — an install two majors behind never received
     *  the new theme, and it gives find_sites_with_theme a real negative. */
    theme: z.string().min(1),
  })
  .strict()
  .superRefine((site, ctx) => {
    if (site.host === 'spinupwp' && !site.sshAlias) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sshAlias'],
        message: `sshAlias is required for spinupwp site ${site.id}`,
      });
    }
    if (site.host !== 'spinupwp' && site.sshAlias !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sshAlias'],
        message: `sshAlias is meaningless for ${site.host} site ${site.id}`,
      });
    }
  });

export const FleetManifestSchema = z
  .object({
    flagshipCorpus: z.string().min(1),
    sites: z.array(FleetSiteSchema).min(1),
  })
  .strict();

export type FleetSite = z.infer<typeof FleetSiteSchema>;
export type FleetManifest = z.infer<typeof FleetManifestSchema>;

export function parseFleetManifest(raw: unknown): FleetManifest {
  return FleetManifestSchema.parse(raw);
}

export function loadFleetManifest(path: string): FleetManifest {
  return parseFleetManifest(JSON.parse(readFileSync(path, 'utf8')));
}
```

- [ ] **Step 4: Write `fleet/fleet.json`**

Every slug below was read from the live corpus and exists. The flagship's 25
clinics are 7 Front Range, 6 Puget Sound, 6 Research Triangle, 6 Sonoran; each
practice is given a geographically coherent slice.

```json
{
  "flagshipCorpus": "data/normalized.json",
  "sites": [
    {
      "id": "cedar-vale-a", "label": "Summit Dermatology Partners", "letter": "A",
      "host": "wpe", "pathology": "CV-A-01", "seed": 20260811,
      "locations": [
        "cedar-vale-dermatology-denver-80202",
        "cedar-vale-dermatology-denver-80206"
      ],
      "counts": { "treatment": 12, "condition": 20, "post": 45, "insurance_plan": 8 },
      "theme": "cedar-vale"
    },
    {
      "id": "cedar-vale-b", "label": "Ridgeline Skin Institute", "letter": "B",
      "host": "wpe", "pathology": "CV-B-01", "seed": 20260812,
      "locations": [
        "cedar-vale-dermatology-boulder-80301",
        "cedar-vale-dermatology-boulder-80302"
      ],
      "counts": { "treatment": 10, "condition": 18, "post": 40, "insurance_plan": 6 },
      "theme": "cedar-vale"
    },
    {
      "id": "cedar-vale-c", "label": "Willow Creek Dermatology", "letter": "C",
      "host": "spinupwp", "sshAlias": "cedarvale-spin", "pathology": "CV-C-01", "seed": 20260813,
      "locations": ["cedar-vale-dermatology-seattle-98101"],
      "counts": { "treatment": 8, "condition": 14, "post": 30, "insurance_plan": 5 },
      "theme": "twentytwentyone"
    },
    {
      "id": "cedar-vale-d", "label": "High Desert Skin Care", "letter": "D",
      "host": "spinupwp", "sshAlias": "cedarvale-spin", "pathology": "CV-D-01", "seed": 20260814,
      "locations": [
        "cedar-vale-dermatology-raleigh-27601",
        "cedar-vale-dermatology-raleigh-27607",
        "cedar-vale-dermatology-durham-27701",
        "cedar-vale-dermatology-chapel-hill-27514"
      ],
      "counts": { "treatment": 10, "condition": 16, "post": 35, "insurance_plan": 6 },
      "theme": "cedar-vale"
    },
    {
      "id": "cedar-vale-e", "label": "Aspen Grove Dermatology", "letter": "E",
      "host": "local", "pathology": "CV-E-01", "seed": 20260815,
      "locations": ["cedar-vale-dermatology-phoenix-85004"],
      "counts": { "treatment": 8, "condition": 12, "post": 25, "insurance_plan": 4 },
      "theme": "cedar-vale"
    },
    {
      "id": "cedar-vale-f", "label": "Copper Basin Skin Clinic", "letter": "F",
      "host": "local", "pathology": "CV-F-01", "seed": 20260816,
      "locations": ["cedar-vale-dermatology-scottsdale-85251"],
      "counts": { "treatment": 9, "condition": 15, "post": 20, "insurance_plan": 4 },
      "theme": "cedar-vale"
    },
    {
      "id": "cedar-vale-g", "label": "Table Mesa Dermatology", "letter": "G",
      "host": "spinupwp", "sshAlias": "cedarvale-spin", "pathology": "CV-G-01", "seed": 20260817,
      "locations": ["cedar-vale-dermatology-denver-80218"],
      "counts": { "treatment": 14, "condition": 18, "post": 35, "insurance_plan": 7 },
      "theme": "cedar-vale"
    }
  ]
}
```

`cedar-vale-g` samples 14 treatments because CV-G-01 marks 8 stale and 3
unreviewed and the two sets must be disjoint; a site with fewer than 11 cannot
carry its own pathology. `cedar-vale-f` samples only 20 posts because CV-F-01
appends 40 more.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/schema.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean

- [ ] **Step 6: Commit**

```bash
git add cedar-vale-health-demo/fleet/fleet.json cedar-vale-health-demo/scripts/src/fleet/
git commit -m "feat(fleet): manifest schema and the seven site definitions"
```

---

### Task 2: Reference-closed corpus derivation

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/fleet/corpus-types.ts`
- Create: `cedar-vale-health-demo/scripts/src/fleet/derive.ts`
- Test: `cedar-vale-health-demo/scripts/src/fleet/derive.test.ts`

**Interfaces:**
- Consumes: `FleetSite` from Task 1.
- Produces:
  - `type PostType`, `type CorpusItem`, `type Corpus = CorpusItem[]`
  - `ACF_SLUG_REFS`, `ACF_PROVIDER_REFS`
  - `interface SlugRef { ref: string; via: string }`
  - `slugRefsOf(item: CorpusItem): SlugRef[]`
  - `deriveCorpus(flagship: Corpus, site: FleetSite): Corpus`
  - `danglingRefs(corpus: Corpus): { from: string; ref: string; via: string }[]`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/src/fleet/derive.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFleetManifest } from './schema.js';
import { deriveCorpus, danglingRefs, type Corpus } from './derive.js';

const root = new URL('../../../', import.meta.url);
const flagship = JSON.parse(
  readFileSync(fileURLToPath(new URL('data/normalized.json', root)), 'utf8'),
) as Corpus;
const manifest = loadFleetManifest(fileURLToPath(new URL('fleet/fleet.json', root)));
const siteA = manifest.sites.find((s) => s.id === 'cedar-vale-a')!;

describe('deriveCorpus', () => {
  it('keeps exactly the locations the manifest names', () => {
    const out = deriveCorpus(flagship, siteA);
    expect(out.filter((i) => i.post_type === 'location').map((i) => i.slug).sort())
      .toEqual([...siteA.locations].sort());
  });

  it('is a strict subset of the flagship by slug — it never invents an item', () => {
    const flagshipSlugs = new Set(flagship.map((i) => i.slug));
    for (const item of deriveCorpus(flagship, siteA)) {
      expect(flagshipSlugs.has(item.slug)).toBe(true);
    }
  });

  it('leaves no dangling reference of any kind, on any site', () => {
    for (const site of manifest.sites) {
      expect({ id: site.id, dangling: danglingRefs(deriveCorpus(flagship, site)) })
        .toEqual({ id: site.id, dangling: [] });
    }
  });

  it('never nulls a reviewed_by to close a reference — it pulls the reviewer in', () => {
    for (const site of manifest.sites) {
      const out = deriveCorpus(flagship, site);
      const kept = new Set(out.map((i) => i.slug));
      const nulled = out.filter((i) => i.acf['reviewed_by'] === null);
      expect({ id: site.id, nulled: nulled.length }).toEqual({ id: site.id, nulled: 0 });
      for (const item of out) {
        for (const key of ['reviewed_by', 'bio_reviewed_by'] as const) {
          const ref = item.acf[key];
          if (typeof ref === 'string' && ref !== '') expect(kept.has(ref)).toBe(true);
        }
      }
    }
  });

  it('keeps only providers who practise at a kept location, plus pulled-in reviewers', () => {
    const out = deriveCorpus(flagship, siteA);
    const keptLocations = new Set(siteA.locations);
    const reviewerSlugs = new Set(
      out.flatMap((i) =>
        (['reviewed_by', 'bio_reviewed_by'] as const)
          .map((k) => i.acf[k])
          .filter((v): v is string => typeof v === 'string' && v !== ''),
      ),
    );
    for (const p of out.filter((i) => i.post_type === 'provider')) {
      const practises = (p.relationships['locations'] ?? []).some((l) => keptLocations.has(l));
      expect(practises || reviewerSlugs.has(p.slug)).toBe(true);
    }
  });

  it('honours the requested counts for sampled types', () => {
    const out = deriveCorpus(flagship, siteA);
    const n = (t: string) => out.filter((i) => i.post_type === t).length;
    expect(n('treatment')).toBe(siteA.counts.treatment);
    expect(n('condition')).toBe(siteA.counts.condition);
    expect(n('post')).toBe(siteA.counts.post);
    expect(n('insurance_plan')).toBe(siteA.counts.insurance_plan);
  });

  it('is deterministic — same input, byte-identical output', () => {
    expect(JSON.stringify(deriveCorpus(flagship, siteA)))
      .toBe(JSON.stringify(deriveCorpus(flagship, siteA)));
  });

  it('gives two different sites different samples', () => {
    const siteG = manifest.sites.find((s) => s.id === 'cedar-vale-g')!;
    const a = deriveCorpus(flagship, siteA).filter((i) => i.post_type === 'post').map((i) => i.slug);
    const g = deriveCorpus(flagship, siteG).filter((i) => i.post_type === 'post').map((i) => i.slug);
    expect(a).not.toEqual(g);
  });

  it('throws, rather than producing an empty site, when a manifest slug does not exist', () => {
    expect(() => deriveCorpus(flagship, { ...siteA, locations: ['no-such-clinic'] }))
      .toThrow(/no-such-clinic/);
  });
});

describe('danglingRefs', () => {
  const item = (over: Partial<Corpus[number]>): Corpus[number] => ({
    slug: 'x', post_type: 'treatment', post_title: 'X', post_content: '',
    post_status: 'publish', acf: {}, relationships: {}, ...over,
  });

  it('reports a relationship target that is absent', () => {
    expect(danglingRefs([item({
      slug: 'p1', post_type: 'provider', relationships: { locations: ['missing-clinic'] },
    })])).toEqual([{ from: 'p1', ref: 'missing-clinic', via: 'relationships.locations' }]);
  });

  it('reports an absent ACF slug reference', () => {
    expect(danglingRefs([item({ slug: 't1', acf: { reviewed_by: 'ghost-md' } })]))
      .toEqual([{ from: 't1', ref: 'ghost-md', via: 'acf.reviewed_by' }]);
  });

  it('treats null and empty string as absent-by-design, not dangling', () => {
    expect(danglingRefs([item({ acf: { reviewed_by: null, treatment_focus: '' } })])).toEqual([]);
  });

  it('follows price_range_by_location rows into their location slug', () => {
    expect(danglingRefs([item({
      slug: 't1', acf: { price_range_by_location: [{ location: 'gone-clinic', low: 1, high: 2 }] },
    })])).toEqual([
      { from: 't1', ref: 'gone-clinic', via: 'acf.price_range_by_location[0].location' },
    ]);
  });

  it('reports nothing when every reference resolves', () => {
    expect(danglingRefs([
      item({ slug: 'r1', post_type: 'provider' }),
      item({ slug: 't1', acf: { reviewed_by: 'r1' } }),
    ])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/derive.test.ts`
Expected: FAIL — `Cannot find module './derive.js'`

- [ ] **Step 3: Write `corpus-types.ts`**

```ts
// scripts/src/fleet/corpus-types.ts
export type PostType =
  | 'location' | 'provider' | 'treatment' | 'condition' | 'post' | 'insurance_plan';

export interface CorpusItem {
  slug: string;
  post_type: PostType;
  post_title: string;
  post_content: string;
  post_status: string;
  acf: Record<string, unknown>;
  relationships: Record<string, string[]>;
}

export type Corpus = CorpusItem[];

/** ACF keys whose value is a single slug pointing at another corpus item. */
export const ACF_SLUG_REFS = [
  'reviewed_by', 'bio_reviewed_by', 'condition_focus', 'treatment_focus',
] as const;

/** Which of those point at a provider. Used by derivation's pull-in rule. */
export const ACF_PROVIDER_REFS = ['reviewed_by', 'bio_reviewed_by'] as const;

export interface SlugRef {
  ref: string;
  via: string;
}

/** Every outbound slug reference an item makes, with the path that produced it. */
export function slugRefsOf(item: CorpusItem): SlugRef[] {
  const out: SlugRef[] = [];

  for (const [key, targets] of Object.entries(item.relationships ?? {})) {
    for (const ref of targets ?? []) {
      if (typeof ref === 'string' && ref !== '') out.push({ ref, via: `relationships.${key}` });
    }
  }

  for (const key of ACF_SLUG_REFS) {
    const value = item.acf?.[key];
    if (typeof value === 'string' && value !== '') out.push({ ref: value, via: `acf.${key}` });
  }

  // price_range_by_location is a repeater whose sub-field is named `location`,
  // not `location_slug` — matching PriceRangeSchema's own key, which is exactly
  // the mismatch that once imported every row with an empty value.
  const rows = item.acf?.['price_range_by_location'];
  if (Array.isArray(rows)) {
    rows.forEach((row, i) => {
      const loc = (row as Record<string, unknown> | null)?.['location'];
      if (typeof loc === 'string' && loc !== '') {
        out.push({ ref: loc, via: `acf.price_range_by_location[${i}].location` });
      }
    });
  }

  return out;
}
```

- [ ] **Step 4: Write `derive.ts`**

```ts
// scripts/src/fleet/derive.ts
import type { FleetSite } from './schema.js';
import {
  ACF_PROVIDER_REFS, slugRefsOf,
  type Corpus, type CorpusItem, type PostType,
} from './corpus-types.js';

export type { Corpus, CorpusItem, PostType } from './corpus-types.js';

/** Mulberry32 — small, deterministic, dependency-free. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded sample without replacement, stable for a given (pool order, seed, n). */
function sample<T>(pool: readonly T[], n: number, next: () => number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = a;
  }
  return copy.slice(0, Math.min(n, copy.length));
}

function deepClone(item: CorpusItem): CorpusItem {
  return JSON.parse(JSON.stringify(item)) as CorpusItem;
}

/**
 * Derive one fleet site's corpus from the flagship's.
 *
 * Order matters and is not arbitrary:
 *  1. locations — named explicitly in the manifest, never sampled
 *  2. providers — everyone practising at a kept location
 *  3. treatments / conditions / posts / insurance_plans — seeded sample
 *  4. pull in referenced providers (reviewers) rather than nulling the reference
 *  5. prune every remaining reference that still points outside the kept set
 *
 * Step 4 before step 5 is the whole point. Reversed, every site would arrive with
 * null reviewers — which is CV-G-01's planted pathology, and inventing it on six
 * other sites destroys the compliance signal the demo exists to show.
 */
export function deriveCorpus(flagship: Corpus, site: FleetSite): Corpus {
  const bySlug = new Map(flagship.map((i) => [i.slug, i]));
  const next = rng(site.seed);

  const missing = site.locations.filter((s) => !bySlug.has(s));
  if (missing.length > 0) {
    throw new Error(
      `${site.id}: manifest names ${missing.length} location slug(s) absent from the flagship corpus: ${missing.join(', ')}`,
    );
  }

  const keptSlugs = new Set<string>(site.locations);
  const keptLocations = new Set(site.locations);

  // 2. providers who practise at a kept location
  for (const p of flagship) {
    if (p.post_type !== 'provider') continue;
    if ((p.relationships['locations'] ?? []).some((l) => keptLocations.has(l))) {
      keptSlugs.add(p.slug);
    }
  }

  // 3. seeded samples, in a fixed type order so the rng stream is stable
  //    regardless of object-key iteration order
  const sampled: [PostType, number][] = [
    ['treatment', site.counts.treatment],
    ['condition', site.counts.condition],
    ['post', site.counts.post],
    ['insurance_plan', site.counts.insurance_plan],
  ];
  for (const [type, n] of sampled) {
    const pool = flagship.filter((i) => i.post_type === type).map((i) => i.slug);
    const drawn = sample(pool, n, next);
    if (drawn.length < n) {
      throw new Error(`${site.id}: asked for ${n} ${type}, flagship has only ${pool.length}`);
    }
    for (const slug of drawn) keptSlugs.add(slug);
  }

  // 4. pull in providers referenced as reviewers, transitively (a reviewer may
  //    themselves carry a bio_reviewed_by pointing at another provider)
  for (let guard = 0; guard < 10; guard++) {
    let added = false;
    for (const slug of [...keptSlugs]) {
      const item = bySlug.get(slug);
      if (!item) continue;
      for (const key of ACF_PROVIDER_REFS) {
        const ref = item.acf[key];
        if (typeof ref !== 'string' || ref === '' || keptSlugs.has(ref)) continue;
        if (bySlug.get(ref)?.post_type !== 'provider') continue;
        keptSlugs.add(ref);
        added = true;
      }
    }
    if (!added) break;
  }

  // 5. emit in flagship order, pruning references that still point outside
  const out: Corpus = [];
  for (const original of flagship) {
    if (!keptSlugs.has(original.slug)) continue;
    const item = deepClone(original);

    for (const [key, targets] of Object.entries(item.relationships)) {
      item.relationships[key] = (targets ?? []).filter((t) => keptSlugs.has(t));
    }

    for (const key of ['condition_focus', 'treatment_focus'] as const) {
      const ref = item.acf[key];
      if (typeof ref === 'string' && ref !== '' && !keptSlugs.has(ref)) item.acf[key] = null;
    }

    const rows = item.acf['price_range_by_location'];
    if (Array.isArray(rows)) {
      item.acf['price_range_by_location'] = rows.filter((row) => {
        const loc = (row as Record<string, unknown> | null)?.['location'];
        return typeof loc === 'string' && keptSlugs.has(loc);
      });
    }

    out.push(item);
  }

  return out;
}

/** Every reference that points at a slug the corpus does not contain. */
export function danglingRefs(corpus: Corpus): { from: string; ref: string; via: string }[] {
  const present = new Set(corpus.map((i) => i.slug));
  const out: { from: string; ref: string; via: string }[] = [];
  for (const item of corpus) {
    for (const { ref, via } of slugRefsOf(item)) {
      if (!present.has(ref)) out.push({ from: item.slug, ref, via });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/ && npx tsc --noEmit`
Expected: PASS, typecheck clean

If `honours the requested counts` fails, that is a real conflict between the
manifest and the flagship pool — fix the manifest count. Never loosen the
assertion to `toBeGreaterThanOrEqual`; the count is what CV-G-01 depends on.

- [ ] **Step 6: Commit**

```bash
git add cedar-vale-health-demo/scripts/src/fleet/
git commit -m "feat(fleet): reference-closed derivation of per-site corpora"
```

---

### Task 3: Per-site article localization

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/fleet/localize.ts`
- Test: `cedar-vale-health-demo/scripts/src/fleet/localize.test.ts`

**Interfaces:**
- Consumes: `Corpus` (Task 2), `FleetSite` (Task 1).
- Produces: `localizeCorpus(corpus: Corpus, site: FleetSite): Corpus`, `isVerbatimCopy(item, flagshipBySlug): boolean`.

**Why this task exists.** Measured on the live corpus: all 600 posts are
brand-free clinical prose, so a derived article is byte-for-byte the flagship's.
Without localization, "40 pages copy-pasted verbatim from the flagship"
(`CV-F-01`) is true of every article on all seven sites, and the pathology
detects nothing. Localization makes the fleet's articles near-duplicates —
realistic for a group that syndicates clinical content — so that F's genuinely
verbatim pages stand out as exact matches.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/src/fleet/localize.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFleetManifest } from './schema.js';
import { deriveCorpus, type Corpus } from './derive.js';
import { localizeCorpus, isVerbatimCopy } from './localize.js';

const root = new URL('../../../', import.meta.url);
const flagship = JSON.parse(
  readFileSync(fileURLToPath(new URL('data/normalized.json', root)), 'utf8'),
) as Corpus;
const bySlug = new Map(flagship.map((i) => [i.slug, i]));
const manifest = loadFleetManifest(fileURLToPath(new URL('fleet/fleet.json', root)));
const siteA = manifest.sites.find((s) => s.id === 'cedar-vale-a')!;
const localized = (id: string) => {
  const s = manifest.sites.find((x) => x.id === id)!;
  return localizeCorpus(deriveCorpus(flagship, s), s);
};

describe('localizeCorpus', () => {
  it('makes every post differ from the flagship original', () => {
    for (const post of localized('cedar-vale-a').filter((i) => i.post_type === 'post')) {
      expect(isVerbatimCopy(post, bySlug)).toBe(false);
    }
  });

  it('names the practice in the lead, so the difference is meaningful, not cosmetic', () => {
    for (const post of localized('cedar-vale-a').filter((i) => i.post_type === 'post')) {
      expect(post.post_content).toContain(siteA.label);
    }
  });

  it('preserves the original body after the lead — the clinical content is unchanged', () => {
    for (const post of localized('cedar-vale-a').filter((i) => i.post_type === 'post')) {
      expect(post.post_content).toContain(bySlug.get(post.slug)!.post_content);
    }
  });

  it('leaves locations byte-identical — CV-D-01 needs the same clinic, same title', () => {
    for (const loc of localized('cedar-vale-d').filter((i) => i.post_type === 'location')) {
      const original = bySlug.get(loc.slug)!;
      expect(loc.post_content).toBe(original.post_content);
      expect(loc.post_title).toBe(original.post_title);
    }
  });

  it('leaves providers, treatments and conditions untouched — they are clinical reference text', () => {
    for (const item of localized('cedar-vale-a')) {
      if (item.post_type === 'post') continue;
      expect(item.post_content).toBe(bySlug.get(item.slug)!.post_content);
    }
  });

  it('gives two sites different leads on the same article', () => {
    const a = localized('cedar-vale-a').find((i) => i.post_type === 'post')!;
    const g = localized('cedar-vale-g').filter((i) => i.post_type === 'post');
    const same = g.find((i) => i.slug === a.slug);
    if (same) expect(same.post_content).not.toBe(a.post_content);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(localized('cedar-vale-a')))
      .toBe(JSON.stringify(localized('cedar-vale-a')));
  });

  it('changes nothing but post_content on post items', () => {
    const before = deriveCorpus(flagship, siteA);
    const after = localizeCorpus(before, siteA);
    for (const [i, item] of after.entries()) {
      expect({ ...item, post_content: '' }).toEqual({ ...before[i]!, post_content: '' });
    }
  });
});

describe('isVerbatimCopy', () => {
  it('is true when body and title both match the flagship item of the same slug', () => {
    const original = flagship.find((i) => i.post_type === 'post')!;
    expect(isVerbatimCopy({ ...original }, bySlug)).toBe(true);
  });

  it('is false for a slug the flagship does not have', () => {
    const original = flagship.find((i) => i.post_type === 'post')!;
    expect(isVerbatimCopy({ ...original, slug: 'not-on-flagship' }, bySlug)).toBe(false);
  });

  it('is false when the body differs by a single character', () => {
    const original = flagship.find((i) => i.post_type === 'post')!;
    expect(isVerbatimCopy({ ...original, post_content: `${original.post_content} ` }, bySlug))
      .toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/localize.test.ts`
Expected: FAIL — `Cannot find module './localize.js'`

- [ ] **Step 3: Write `localize.ts`**

```ts
// scripts/src/fleet/localize.ts
import type { Corpus, CorpusItem } from './corpus-types.js';
import type { FleetSite } from './schema.js';

/** The city a practice leads with — its first manifest clinic. Slugs are of the
 *  form cedar-vale-dermatology-<city>-<zip>, so the city is everything between
 *  the fixed prefix and the trailing five-digit ZIP. */
function primaryCity(site: FleetSite): string {
  const slug = site.locations[0] ?? '';
  const match = /^cedar-vale-dermatology-(.+)-\d{5}$/.exec(slug);
  const raw = match?.[1] ?? 'our';
  return raw
    .split('-')
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * Prepend a practice-specific lead to every article.
 *
 * Only `post` items are touched. Locations carry a factual address sentence and
 * must stay recognisably the same clinic for CV-D-01; providers, treatments and
 * conditions are clinical reference text that a practice would not rewrite.
 *
 * The lead is a single sentence, deterministic in the site alone — no rng — so
 * two builds produce identical bytes and the text can be quoted in demo copy.
 */
export function localizeCorpus(corpus: Corpus, site: FleetSite): Corpus {
  const city = primaryCity(site);
  const lead = `${site.label} shares this guidance with patients at our ${city} clinic.`;

  return corpus.map((item) =>
    item.post_type === 'post'
      ? { ...item, post_content: `${lead}\n\n${item.post_content}` }
      : item,
  );
}

/** True when this item is byte-for-byte the flagship item of the same slug —
 *  the signal CV-F-01 is detected by, and the thing localization removes
 *  everywhere else. */
export function isVerbatimCopy(
  item: CorpusItem,
  flagshipBySlug: ReadonlyMap<string, CorpusItem>,
): boolean {
  const original = flagshipBySlug.get(item.slug);
  if (!original) return false;
  return item.post_content === original.post_content && item.post_title === original.post_title;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/ && npx tsc --noEmit`
Expected: PASS, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add cedar-vale-health-demo/scripts/src/fleet/localize.ts cedar-vale-health-demo/scripts/src/fleet/localize.test.ts
git commit -m "feat(fleet): per-site article localization so CV-F-01 is detectable"
```

---

### Task 4: The five corpus skews

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/fleet/skew/cv-a.ts`, `cv-b.ts`, `cv-d.ts`, `cv-f.ts`, `cv-g.ts`, `index.ts`
- Test: `cedar-vale-health-demo/scripts/src/fleet/skew/skew.test.ts`

**Interfaces:**
- Consumes: `Corpus`, `CorpusItem` (Task 2); `FleetSite`, `PATHOLOGY_IDS` (Task 1); `isVerbatimCopy` (Task 3).
- Produces: `type PathologyId`, `type SkewFn = (corpus: Corpus, site: FleetSite, flagship: Corpus) => Corpus`, `SKEWS: Partial<Record<PathologyId, SkewFn>>`, `applySkew(corpus, site, flagship): Corpus`.

Every skew works through fields that already exist in `FIELD_TYPES`. There are no
`cv_*` marker fields — see Global Constraints.

`CV-C-01` and `CV-E-01` are platform pathologies with no corpus component;
`SKEWS` has no entry for them and `applySkew` returns the corpus unchanged. That
absence is asserted, not assumed.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/src/fleet/skew/skew.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFleetManifest } from '../schema.js';
import { deriveCorpus, danglingRefs, type Corpus } from '../derive.js';
import { localizeCorpus, isVerbatimCopy } from '../localize.js';
import { SKEWS, applySkew } from './index.js';

const root = new URL('../../../../', import.meta.url);
const flagship = JSON.parse(
  readFileSync(fileURLToPath(new URL('data/normalized.json', root)), 'utf8'),
) as Corpus;
const bySlug = new Map(flagship.map((i) => [i.slug, i]));
const manifest = loadFleetManifest(fileURLToPath(new URL('fleet/fleet.json', root)));
const site = (id: string) => manifest.sites.find((s) => s.id === id)!;
const built = (id: string) => {
  const s = site(id);
  return applySkew(localizeCorpus(deriveCorpus(flagship, s), s), s, flagship);
};

const REFERENCE_DATE = Date.parse('2026-08-11');
const MONTH_MS = 1000 * 60 * 60 * 24 * 30.44;
const monthsOld = (iso: unknown) =>
  typeof iso === 'string' ? (REFERENCE_DATE - Date.parse(iso)) / MONTH_MS : NaN;

describe('CV-A-01 — openingHoursSpecification missing entirely', () => {
  it('strips hours from every location', () => {
    const locations = built('cedar-vale-a').filter((i) => i.post_type === 'location');
    expect(locations.length).toBeGreaterThan(0);
    for (const loc of locations) expect(loc.acf['hours']).toEqual([]);
  });

  it('leaves the flagship untouched, so the contrast is real', () => {
    const withHours = flagship
      .filter((i) => i.post_type === 'location')
      .filter((i) => Array.isArray(i.acf['hours']) && (i.acf['hours'] as unknown[]).length > 0);
    expect(withHours).toHaveLength(25);
  });

  it('changes only the hours key', () => {
    const s = site('cedar-vale-a');
    const before = localizeCorpus(deriveCorpus(flagship, s), s);
    const after = applySkew(before, s, flagship);
    expect(after).toHaveLength(before.length);
    for (const [i, item] of after.entries()) {
      expect({ ...item, acf: { ...item.acf, hours: null } })
        .toEqual({ ...before[i]!, acf: { ...before[i]!.acf, hours: null } });
    }
  });
});

describe('CV-B-01 — one clinician, two current employers', () => {
  const corpus = built('cedar-vale-b');
  const b = site('cedar-vale-b');

  /**
   * The ghost is found the way the demo finds it: an NPI on this site that is
   * also an accepting provider on the flagship, at a set of clinics that shares
   * nothing with this site's record for them.
   *
   * The test is DISJOINT, not merely different. Derivation prunes each kept
   * provider's `locations` down to the clinics this site actually operates, so
   * all 17 multi-clinic providers in the flagship end up with a location list
   * that *differs* from their flagship one — a subset, but different. Only the
   * planted ghost, drawn from a provider practising entirely elsewhere, has a
   * location set with an empty intersection.
   */
  const ghosts = corpus.filter((item) => {
    if (item.post_type !== 'provider') return false;
    const twin = flagship.find(
      (f) => f.post_type === 'provider' && String(f.acf['npi']) === String(item.acf['npi']),
    );
    if (!twin) return false;
    const here = new Set(item.relationships['locations'] ?? []);
    const there = twin.relationships['locations'] ?? [];
    return here.size > 0 && there.length > 0 && there.every((l) => !here.has(l));
  });

  it('produces exactly one clinician whose clinics are disjoint from the flagship\'s', () => {
    expect(ghosts).toHaveLength(1);
  });

  it('does not mistake a pruned multi-clinic provider for the ghost', () => {
    const pruned = corpus.filter((item) => {
      if (item.post_type !== 'provider') return false;
      const twin = flagship.find(
        (f) => f.post_type === 'provider' && String(f.acf['npi']) === String(item.acf['npi']),
      );
      if (!twin) return false;
      const here = new Set(item.relationships['locations'] ?? []);
      const there = twin.relationships['locations'] ?? [];
      return there.length > here.size && there.some((l) => here.has(l));
    });
    // Pruned providers exist on this site and must NOT be counted as ghosts.
    expect(pruned.every((p) => !ghosts.includes(p))).toBe(true);
  });

  it('keeps the ghost active here — nothing on this site alone looks wrong', () => {
    expect(ghosts[0]!.acf['accepting_new_patients']).toBe(true);
    expect(ghosts[0]!.post_status).toBe('publish');
  });

  it('places the ghost at this practice\'s own clinics', () => {
    expect(ghosts[0]!.relationships['locations']).toEqual([...b.locations]);
  });

  it('leaves the flagship twin active too — both records claim them right now', () => {
    const twin = flagship.find(
      (f) => f.post_type === 'provider' && String(f.acf['npi']) === String(ghosts[0]!.acf['npi']),
    )!;
    expect(twin.acf['accepting_new_patients']).toBe(true);
  });

  it('backdates the ghost\'s review 14 months, using the existing review_date field', () => {
    expect(monthsOld(ghosts[0]!.acf['review_date'])).toBeGreaterThan(13.5);
    expect(monthsOld(ghosts[0]!.acf['review_date'])).toBeLessThan(14.5);
  });

  it('adds the ghost rather than relabelling someone already here', () => {
    const s = site('cedar-vale-b');
    const before = localizeCorpus(deriveCorpus(flagship, s), s);
    expect(corpus.length).toBe(before.length + 1);
  });
});

describe('CV-D-01 — NAP contradiction on four shared clinics', () => {
  const corpus = built('cedar-vale-d');
  const locations = corpus.filter((i) => i.post_type === 'location');

  it('contradicts the flagship on all four of its clinics', () => {
    expect(locations).toHaveLength(4);
    const differing = locations.filter((l) => {
      const f = bySlug.get(l.slug)!;
      return l.acf['address_street'] !== f.acf['address_street'] || l.acf['phone'] !== f.acf['phone'];
    });
    expect(differing).toHaveLength(4);
  });

  it('each contradicted record is internally valid — a real address and a real phone', () => {
    for (const l of locations) {
      expect(String(l.acf['address_street'])).toMatch(/^\d+ \S/);
      expect(String(l.acf['phone'])).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
      expect(String(l.acf['address_zip'])).toMatch(/^\d{5}$/);
    }
  });

  it('keeps slug and title identical, so it is the same place and not a second clinic', () => {
    for (const l of locations) expect(l.post_title).toBe(bySlug.get(l.slug)!.post_title);
  });

  it('is deterministic — the fabricated address is stable across builds', () => {
    expect(JSON.stringify(built('cedar-vale-d'))).toBe(JSON.stringify(built('cedar-vale-d')));
  });
});

describe('CV-F-01 — 40 pages copy-pasted verbatim', () => {
  const corpus = built('cedar-vale-f');

  it('carries exactly 40 items byte-identical to a flagship item', () => {
    expect(corpus.filter((i) => isVerbatimCopy(i, bySlug))).toHaveLength(40);
  });

  it('appends them — they are extra pages, not a relabelled sample', () => {
    const s = site('cedar-vale-f');
    const before = localizeCorpus(deriveCorpus(flagship, s), s);
    expect(corpus.length).toBe(before.length + 40);
  });

  it('has no duplicate slugs', () => {
    expect(new Set(corpus.map((i) => i.slug)).size).toBe(corpus.length);
  });

  it('is the ONLY site with a verbatim copy — otherwise the pathology is fleet-wide', () => {
    for (const s of manifest.sites) {
      if (s.id === 'cedar-vale-f') continue;
      const verbatim = built(s.id).filter((i) => i.post_type === 'post' && isVerbatimCopy(i, bySlug));
      expect({ id: s.id, verbatim: verbatim.length }).toEqual({ id: s.id, verbatim: 0 });
    }
  });
});

describe('CV-G-01 — quantified compliance exposure', () => {
  const corpus = built('cedar-vale-g');
  const treatments = corpus.filter((i) => i.post_type === 'treatment');
  const stale = treatments.filter((t) => monthsOld(t.acf['review_date']) > 36);
  const unreviewed = treatments.filter((t) => t.acf['reviewed_by'] === null);

  it('marks 8 treatments reviewed over 36 months ago', () => {
    expect(stale).toHaveLength(8);
  });

  it('moves review_status in step, so the site does not contradict itself', () => {
    for (const t of stale) expect(t.acf['review_status']).toBe('overdue');
  });

  it('strips the reviewer from exactly 3', () => {
    expect(unreviewed).toHaveLength(3);
    for (const t of unreviewed) {
      expect(t.acf['review_status']).toBe('unreviewed');
      expect(t.acf['review_date']).toBeNull();
    }
  });

  it('keeps the two sets disjoint — a doubly-defective item halves the count', () => {
    const overlap = unreviewed.filter((t) => stale.some((s) => s.slug === t.slug));
    expect(overlap).toHaveLength(0);
  });

  it('is the ONLY site with a null reviewed_by — derivation must not have invented one', () => {
    for (const s of manifest.sites) {
      if (s.id === 'cedar-vale-g') continue;
      const nulls = built(s.id).filter((i) => i.acf['reviewed_by'] === null);
      expect({ id: s.id, nulls: nulls.length }).toEqual({ id: s.id, nulls: 0 });
    }
  });
});

describe('platform pathologies', () => {
  it('has no corpus skew for CV-C-01 or CV-E-01', () => {
    expect(SKEWS['CV-C-01']).toBeUndefined();
    expect(SKEWS['CV-E-01']).toBeUndefined();
  });

  it('returns C and E corpora unchanged', () => {
    for (const id of ['cedar-vale-c', 'cedar-vale-e']) {
      const s = site(id);
      const input = localizeCorpus(deriveCorpus(flagship, s), s);
      expect(applySkew(input, s, flagship)).toEqual(input);
    }
  });
});

describe('every skew preserves referential integrity', () => {
  it('leaves no dangling reference on any site', () => {
    for (const s of manifest.sites) {
      expect({ id: s.id, dangling: danglingRefs(built(s.id)) })
        .toEqual({ id: s.id, dangling: [] });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/skew/`
Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Write the five skews**

```ts
// scripts/src/fleet/skew/cv-a.ts
import type { Corpus } from '../corpus-types.js';

/** CV-A-01 — every location loses its hours, so no MedicalClinic emits
 *  openingHoursSpecification. `jsonld.php` already omits the key when the
 *  repeater yields nothing, so an empty array is the honest representation of
 *  "this practice never collected hours" rather than a malformed entry. */
export function skewCvA(corpus: Corpus): Corpus {
  return corpus.map((item) =>
    item.post_type === 'location' ? { ...item, acf: { ...item.acf, hours: [] } } : item,
  );
}
```

```ts
// scripts/src/fleet/skew/cv-b.ts
import type { Corpus, CorpusItem } from '../corpus-types.js';
import type { FleetSite } from '../schema.js';

/** 14 months before the 2026-08-11 corpus reference date. */
const GHOST_REVIEW_DATE = '2025-06-11';

/**
 * CV-B-01 — the ghost provider.
 *
 * A clinician who practises for the flagship in one metro is *also* listed here,
 * at this practice's own clinics, still accepting patients, under the same NPI.
 * Neither record is internally wrong; together they are impossible.
 *
 * The ghost is **added**, not relabelled. Derivation only keeps providers who
 * already practise at this site's clinics, so mutating one of those would leave
 * the flagship and the fleet site agreeing about the clinic — no contradiction.
 * The ghost is therefore drawn from providers whose flagship clinics are
 * entirely disjoint from this site's, which is what makes the two records
 * irreconcilable.
 *
 * `bio_reviewed_by` is repointed at a provider already on this site: the
 * acquiring practice's own reviewer signed the bio. Leaving the flagship's
 * reviewer would dangle, and nulling it would forge CV-G-01.
 */
export function skewCvB(corpus: Corpus, site: FleetSite, flagship: Corpus): Corpus {
  const here = new Set(site.locations);
  const present = new Set(corpus.map((i) => i.slug));

  const ghost = flagship.find(
    (i) =>
      i.post_type === 'provider' &&
      !present.has(i.slug) &&
      (i.relationships['locations'] ?? []).length > 0 &&
      (i.relationships['locations'] ?? []).every((l) => !here.has(l)),
  );
  if (!ghost) {
    throw new Error(
      `${site.id}: CV-B-01 needs a flagship provider practising entirely outside this site's clinics; found none`,
    );
  }

  const localReviewer = corpus.find((i) => i.post_type === 'provider');
  if (!localReviewer) {
    throw new Error(`${site.id}: CV-B-01 needs at least one provider already on this site`);
  }

  const clone = JSON.parse(JSON.stringify(ghost)) as CorpusItem;
  clone.acf = {
    ...clone.acf,
    accepting_new_patients: true,
    review_date: GHOST_REVIEW_DATE,
    review_status: 'reviewed',
    bio_reviewed_by: localReviewer.slug,
  };
  clone.relationships = { ...clone.relationships, locations: [...site.locations] };

  return [...corpus, clone];
}
```

```ts
// scripts/src/fleet/skew/cv-d.ts
import type { Corpus } from '../corpus-types.js';
import type { FleetSite } from '../schema.js';

/** FNV-1a — deterministic per slug, so the fabricated address is stable across
 *  builds and can be quoted in demo copy. No rng. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const STREETS = ['Aspen Way', 'Larkspur Street', 'Foothill Parkway', 'Chokecherry Lane'] as const;

/**
 * CV-D-01 — NAP contradiction.
 *
 * Four clinics that also exist on the flagship carry a different street address
 * and a different phone here. Each record is internally valid: real street
 * number, correctly formatted phone, unchanged ZIP and city. Only comparing the
 * same slug across two installs exposes it.
 *
 * Slug and title are untouched — it must be recognisably the same clinic, or it
 * is two clinics rather than one contradiction. The ZIP is left alone for the
 * same reason: changing it would make them different places.
 */
export function skewCvD(corpus: Corpus, site: FleetSite): Corpus {
  const contradicted = new Set(site.locations);

  return corpus.map((item) => {
    if (item.post_type !== 'location' || !contradicted.has(item.slug)) return item;
    const h = hash(item.slug);
    const number = 100 + (h % 8900);
    const street = STREETS[h % STREETS.length]!;
    const area = 300 + (h % 600);
    const exchange = 200 + ((h >> 4) % 700);
    const line = (h >> 8) % 10000;
    return {
      ...item,
      acf: {
        ...item.acf,
        address_street: `${number} ${street}`,
        phone: `(${area}) ${exchange}-${String(line).padStart(4, '0')}`,
      },
    };
  });
}
```

```ts
// scripts/src/fleet/skew/cv-f.ts
import type { Corpus, CorpusItem } from '../corpus-types.js';
import type { FleetSite } from '../schema.js';

const DUPLICATE_COUNT = 40;

/**
 * CV-F-01 — 40 pages copy-pasted verbatim from the flagship.
 *
 * Appended and **un-localized**: every other article on every fleet site carries
 * a practice-specific lead (Task 3), so these forty are the only pages in the
 * fleet whose body and title are byte-for-byte the parent's. That exact-match
 * property is the signal `search_across_sites` finds; without localization it
 * would describe all seven sites and detect nothing.
 *
 * Relationships are dropped, matching what a real copy-paste does to internal
 * links, and the ACF slug refs are checked rather than nulled — nulling
 * `reviewed_by` here would forge CV-G-01 on a site that is not supposed to have
 * it.
 */
export function skewCvF(corpus: Corpus, site: FleetSite, flagship: Corpus): Corpus {
  const present = new Set(corpus.map((i) => i.slug));
  const stolen: CorpusItem[] = [];

  for (const item of flagship) {
    if (stolen.length >= DUPLICATE_COUNT) break;
    if (item.post_type !== 'post' || present.has(item.slug)) continue;

    const reviewer = item.acf['reviewed_by'];
    if (typeof reviewer === 'string' && reviewer !== '' && !present.has(reviewer)) continue;

    const clone = JSON.parse(JSON.stringify(item)) as CorpusItem;
    clone.relationships = {};
    for (const key of ['condition_focus', 'treatment_focus'] as const) {
      const ref = clone.acf[key];
      if (typeof ref === 'string' && ref !== '' && !present.has(ref)) clone.acf[key] = null;
    }
    stolen.push(clone);
  }

  if (stolen.length < DUPLICATE_COUNT) {
    throw new Error(
      `${site.id}: CV-F-01 needs ${DUPLICATE_COUNT} flagship posts that are absent here and whose ` +
        `reviewer is present here; found ${stolen.length}. Raise the site's provider coverage ` +
        'rather than nulling reviewers, which would forge CV-G-01.',
    );
  }

  return [...corpus, ...stolen];
}
```

```ts
// scripts/src/fleet/skew/cv-g.ts
import type { Corpus } from '../corpus-types.js';
import type { FleetSite } from '../schema.js';

const STALE_COUNT = 8;
const UNREVIEWED_COUNT = 3;
/** Comfortably over 36 months before the 2026-08-11 corpus reference date. */
const STALE_DATE = '2023-01-15';

/**
 * CV-G-01 — quantified compliance exposure.
 *
 * 8 treatments reviewed over 36 months ago, and 3 with no reviewer at all. The
 * two sets are disjoint: an item that is both stale and unreviewed collapses two
 * distinct findings into one and halves the count the demo quotes.
 *
 * `review_status` moves in step with `review_date`. Leaving it `reviewed` beside
 * a three-year-old date would make the site self-contradicting, which is
 * CV-B-01's and CV-D-01's job, not G's.
 */
export function skewCvG(corpus: Corpus, site: FleetSite): Corpus {
  const treatments = corpus.filter((i) => i.post_type === 'treatment');
  if (treatments.length < STALE_COUNT + UNREVIEWED_COUNT) {
    throw new Error(
      `${site.id}: CV-G-01 needs ${STALE_COUNT + UNREVIEWED_COUNT} treatments, corpus has ${treatments.length}`,
    );
  }

  const stale = new Set(treatments.slice(0, STALE_COUNT).map((i) => i.slug));
  const unreviewed = new Set(
    treatments.slice(STALE_COUNT, STALE_COUNT + UNREVIEWED_COUNT).map((i) => i.slug),
  );

  return corpus.map((item) => {
    if (stale.has(item.slug)) {
      return {
        ...item,
        acf: { ...item.acf, review_date: STALE_DATE, review_status: 'overdue' },
      };
    }
    if (unreviewed.has(item.slug)) {
      return {
        ...item,
        acf: { ...item.acf, reviewed_by: null, review_date: null, review_status: 'unreviewed' },
      };
    }
    return item;
  });
}
```

```ts
// scripts/src/fleet/skew/index.ts
import type { Corpus } from '../corpus-types.js';
import type { FleetSite } from '../schema.js';
import { PATHOLOGY_IDS } from '../schema.js';
import { skewCvA } from './cv-a.js';
import { skewCvB } from './cv-b.js';
import { skewCvD } from './cv-d.js';
import { skewCvF } from './cv-f.js';
import { skewCvG } from './cv-g.js';

export type PathologyId = (typeof PATHOLOGY_IDS)[number];
export type SkewFn = (corpus: Corpus, site: FleetSite, flagship: Corpus) => Corpus;

/** CV-C-01 (version drift) and CV-E-01 (halted) are platform pathologies with no
 *  corpus component. Their absence here is deliberate and is asserted in tests. */
export const SKEWS: Partial<Record<PathologyId, SkewFn>> = {
  'CV-A-01': skewCvA,
  'CV-B-01': skewCvB,
  'CV-D-01': skewCvD,
  'CV-F-01': skewCvF,
  'CV-G-01': skewCvG,
};

export function applySkew(corpus: Corpus, site: FleetSite, flagship: Corpus): Corpus {
  const skew = SKEWS[site.pathology];
  return skew ? skew(corpus, site, flagship) : corpus;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/ && npx tsc --noEmit`
Expected: PASS, typecheck clean

If CV-F-01 throws "found N" with N under 40, the site's provider coverage is too
narrow for 40 flagship posts to be stolen with their reviewers intact. Widen
`cedar-vale-f`'s clinic list in the manifest so more providers are kept — do not
relax the reviewer check.

- [ ] **Step 5: Commit**

```bash
git add cedar-vale-health-demo/scripts/src/fleet/skew/
git commit -m "feat(fleet): the five corpus skews, detectable without marker fields"
```

---

### Task 5: Fleet build CLI with pathology pre-flight

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/fleet/assert-pathology.ts`
- Create: `cedar-vale-health-demo/scripts/src/fleet/build.ts`
- Modify: `cedar-vale-health-demo/scripts/package.json` (add the `fleet:build` script)
- Test: `cedar-vale-health-demo/scripts/src/fleet/assert-pathology.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `assertPathology(corpus, site, flagship): string[]` — returns evidence lines, throws on failure — and `data/fleet/<site-id>/normalized.json` on disk.

The pre-flight exists because a skew that silently no-ops produces a corpus that
imports cleanly, verifies cleanly, and demonstrates nothing. It must fail at
build time, not in front of an audience.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/src/fleet/assert-pathology.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFleetManifest } from './schema.js';
import { deriveCorpus, type Corpus } from './derive.js';
import { localizeCorpus } from './localize.js';
import { applySkew } from './skew/index.js';
import { assertPathology } from './assert-pathology.js';

const root = new URL('../../../', import.meta.url);
const flagship = JSON.parse(
  readFileSync(fileURLToPath(new URL('data/normalized.json', root)), 'utf8'),
) as Corpus;
const manifest = loadFleetManifest(fileURLToPath(new URL('fleet/fleet.json', root)));
const site = (id: string) => manifest.sites.find((s) => s.id === id)!;
const unskewed = (id: string) => {
  const s = site(id);
  return localizeCorpus(deriveCorpus(flagship, s), s);
};
const built = (id: string) => applySkew(unskewed(id), site(id), flagship);

describe('assertPathology', () => {
  it('passes for every site as built, and produces evidence for each', () => {
    for (const s of manifest.sites) {
      const evidence = assertPathology(built(s.id), s, flagship);
      expect({ id: s.id, lines: evidence.length > 0 }).toEqual({ id: s.id, lines: true });
    }
  });

  it('fails when a corpus skew silently no-ops — the whole reason it exists', () => {
    for (const id of ['cedar-vale-a', 'cedar-vale-b', 'cedar-vale-d', 'cedar-vale-f', 'cedar-vale-g']) {
      expect(() => assertPathology(unskewed(id), site(id), flagship))
        .toThrow(new RegExp(site(id).pathology));
    }
  });

  it('fails CV-G-01 when one of the eight stale treatments was reverted', () => {
    const g = site('cedar-vale-g');
    const corpus = built('cedar-vale-g');
    const firstStale = corpus.find(
      (i) => i.post_type === 'treatment' && i.acf['review_status'] === 'overdue',
    )!;
    const reverted = corpus.map((i) =>
      i.slug === firstStale.slug
        ? { ...i, acf: { ...i.acf, review_date: '2026-01-01', review_status: 'reviewed' } }
        : i,
    );
    expect(() => assertPathology(reverted, g, flagship)).toThrow(/CV-G-01.*found 7/s);
  });

  it('fails CV-G-01 when the stale and unreviewed sets overlap', () => {
    const g = site('cedar-vale-g');
    const corpus = built('cedar-vale-g');
    const firstStale = corpus.find(
      (i) => i.post_type === 'treatment' && i.acf['review_status'] === 'overdue',
    )!;
    const overlapping = corpus.map((i) =>
      i.slug === firstStale.slug ? { ...i, acf: { ...i.acf, reviewed_by: null } } : i,
    );
    expect(() => assertPathology(overlapping, g, flagship)).toThrow(/disjoint/);
  });

  it('fails CV-D-01 when a fabricated address is malformed', () => {
    const d = site('cedar-vale-d');
    const corpus = built('cedar-vale-d');
    const broken = corpus.map((i) =>
      i.post_type === 'location' ? { ...i, acf: { ...i.acf, phone: 'call us' } } : i,
    );
    expect(() => assertPathology(broken, d, flagship)).toThrow(/malformed phone/);
  });

  it('reports C and E as platform pathologies rather than checking their corpus', () => {
    for (const id of ['cedar-vale-c', 'cedar-vale-e']) {
      const evidence = assertPathology(built(id), site(id), flagship);
      expect(evidence.join(' ')).toMatch(/platform pathology/i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cedar-vale-health-demo/scripts && npx vitest run src/fleet/assert-pathology.test.ts`
Expected: FAIL — `Cannot find module './assert-pathology.js'`

- [ ] **Step 3: Write `assert-pathology.ts`**

```ts
// scripts/src/fleet/assert-pathology.ts
import type { Corpus } from './corpus-types.js';
import type { FleetSite } from './schema.js';
import { isVerbatimCopy } from './localize.js';

/** The corpus reference date. A constant, never the clock — the build must be
 *  reproducible and `Date.now()` would make "36 months old" drift. */
const REFERENCE_DATE = Date.parse('2026-08-11');
const MONTH_MS = 1000 * 60 * 60 * 24 * 30.44;

function monthsSince(iso: unknown): number | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (REFERENCE_DATE - t) / MONTH_MS;
}

function fail(site: FleetSite, detail: string): never {
  throw new Error(`${site.id} (${site.pathology}): ${detail}`);
}

/**
 * Prove the built corpus actually carries its planted pathology.
 *
 * Every check finds the defect the way the demo will find it — by the data, not
 * by a marker field. Returns evidence lines for the build log; throws on
 * failure, because a demo site whose defect quietly failed to apply imports and
 * verifies exactly like a correct one.
 */
export function assertPathology(corpus: Corpus, site: FleetSite, flagship: Corpus): string[] {
  const bySlug = new Map(flagship.map((i) => [i.slug, i]));
  const evidence: string[] = [];

  switch (site.pathology) {
    case 'CV-A-01': {
      const locations = corpus.filter((i) => i.post_type === 'location');
      if (locations.length === 0) fail(site, 'no locations at all — cannot demonstrate missing hours');
      const withHours = locations.filter(
        (l) => Array.isArray(l.acf['hours']) && (l.acf['hours'] as unknown[]).length > 0,
      );
      if (withHours.length > 0) {
        fail(site, `${withHours.length} of ${locations.length} locations still carry hours`);
      }
      evidence.push(
        `${locations.length} locations, 0 with hours — no openingHoursSpecification will be emitted`,
      );
      break;
    }

    case 'CV-B-01': {
      // DISJOINT, not merely different. Derivation prunes a kept provider's
      // `locations` to this site's clinics, so every multi-clinic provider (17 of
      // the flagship's 60) has a location list that differs from their flagship
      // one while still overlapping it. Only the planted ghost shares no clinic
      // at all with their flagship record.
      const ghosts = corpus.filter((item) => {
        if (item.post_type !== 'provider') return false;
        const twin = flagship.find(
          (f) => f.post_type === 'provider' && String(f.acf['npi']) === String(item.acf['npi']),
        );
        if (!twin) return false;
        if (twin.acf['accepting_new_patients'] !== true) return false;
        const here = new Set(item.relationships['locations'] ?? []);
        const there = twin.relationships['locations'] ?? [];
        return here.size > 0 && there.length > 0 && there.every((l) => !here.has(l));
      });
      if (ghosts.length !== 1) {
        fail(site, `expected exactly 1 clinician contradicting the flagship, found ${ghosts.length}`);
      }
      const ghost = ghosts[0]!;
      if (ghost.acf['accepting_new_patients'] !== true) {
        fail(site, `ghost ${ghost.slug} is not accepting patients here — the records do not conflict`);
      }
      const months = monthsSince(ghost.acf['review_date']);
      if (months === null || months < 13.5 || months > 14.5) {
        fail(site, `ghost review_date is ${months?.toFixed(1) ?? 'absent'} months old, expected ~14`);
      }
      const twin = flagship.find(
        (f) => f.post_type === 'provider' && String(f.acf['npi']) === String(ghost.acf['npi']),
      )!;
      evidence.push(
        `${ghost.slug} (NPI ${String(ghost.acf['npi'])}) accepting patients here at ` +
          `[${(ghost.relationships['locations'] ?? []).join(', ')}] and on the flagship at ` +
          `[${(twin.relationships['locations'] ?? []).join(', ')}]`,
      );
      break;
    }

    case 'CV-C-01':
      evidence.push(
        'platform pathology — WP two majors behind, ACF 5.x, abandoned plugin; verified at provisioning (Task 8)',
      );
      break;

    case 'CV-D-01': {
      const locations = corpus.filter((i) => i.post_type === 'location');
      const conflicting = locations.filter((l) => {
        const f = bySlug.get(l.slug);
        return (
          f !== undefined &&
          (l.acf['address_street'] !== f.acf['address_street'] || l.acf['phone'] !== f.acf['phone'])
        );
      });
      if (conflicting.length !== 4) {
        fail(site, `expected 4 clinics contradicting the flagship, found ${conflicting.length}`);
      }
      for (const l of conflicting) {
        if (!/^\d+ \S/.test(String(l.acf['address_street']))) {
          fail(site, `${l.slug} has a malformed address — an invalid record is a data error, not a contradiction`);
        }
        if (!/^\(\d{3}\) \d{3}-\d{4}$/.test(String(l.acf['phone']))) {
          fail(site, `${l.slug} has a malformed phone`);
        }
        if (l.post_title !== bySlug.get(l.slug)!.post_title) {
          fail(site, `${l.slug} was renamed — it must stay recognisably the same clinic`);
        }
      }
      evidence.push(
        `4 clinics with a different address and phone than the flagship: ${conflicting.map((l) => l.slug).join(', ')}`,
      );
      break;
    }

    case 'CV-E-01':
      evidence.push('platform pathology — site halted; verified at provisioning (Task 6)');
      break;

    case 'CV-F-01': {
      const verbatim = corpus.filter((i) => isVerbatimCopy(i, bySlug));
      if (verbatim.length !== 40) {
        fail(site, `expected 40 items byte-identical to the flagship, found ${verbatim.length}`);
      }
      const slugs = corpus.map((i) => i.slug);
      if (new Set(slugs).size !== slugs.length) fail(site, 'duplicate slugs in corpus');
      evidence.push('40 posts byte-identical to the flagship, titles and slugs unchanged');
      break;
    }

    case 'CV-G-01': {
      const treatments = corpus.filter((i) => i.post_type === 'treatment');
      const stale = treatments.filter((t) => (monthsSince(t.acf['review_date']) ?? 0) > 36);
      if (stale.length !== 8) {
        fail(site, `expected 8 treatments reviewed >36 months ago, found ${stale.length}`);
      }
      for (const t of stale) {
        if (t.acf['review_status'] !== 'overdue') {
          fail(site, `${t.slug} is 36+ months stale but review_status is '${String(t.acf['review_status'])}'`);
        }
      }
      const unreviewed = treatments.filter((t) => t.acf['reviewed_by'] === null);
      if (unreviewed.length !== 3) {
        fail(site, `expected 3 treatments with no reviewer, found ${unreviewed.length}`);
      }
      const overlap = unreviewed.filter((t) => stale.some((s) => s.slug === t.slug));
      if (overlap.length > 0) {
        fail(site, `${overlap.length} treatments are both stale and unreviewed — the sets must be disjoint`);
      }
      evidence.push(
        `8 treatments >36 months stale, 3 with no reviewer, disjoint, out of ${treatments.length} treatments`,
      );
      break;
    }
  }

  return evidence;
}
```

- [ ] **Step 4: Write `build.ts`**

```ts
// scripts/src/fleet/build.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFleetManifest } from './schema.js';
import { deriveCorpus, danglingRefs, type Corpus } from './derive.js';
import { localizeCorpus } from './localize.js';
import { applySkew } from './skew/index.js';
import { assertPathology } from './assert-pathology.js';

const demoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function main(): void {
  const manifest = loadFleetManifest(resolve(demoRoot, 'fleet/fleet.json'));
  const flagship = JSON.parse(
    readFileSync(resolve(demoRoot, manifest.flagshipCorpus), 'utf8'),
  ) as Corpus;

  console.log(`flagship corpus: ${flagship.length} items`);

  for (const site of manifest.sites) {
    const corpus = applySkew(
      localizeCorpus(deriveCorpus(flagship, site), site),
      site,
      flagship,
    );

    const dangling = danglingRefs(corpus);
    if (dangling.length > 0) {
      const sample = dangling.slice(0, 5).map((d) => `${d.from} -> ${d.ref} (${d.via})`).join('; ');
      throw new Error(`${site.id}: ${dangling.length} dangling reference(s): ${sample}`);
    }

    const evidence = assertPathology(corpus, site, flagship);

    const outPath = resolve(demoRoot, 'data/fleet', site.id, 'normalized.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(corpus, null, 1)}\n`, 'utf8');

    const counts = corpus.reduce<Record<string, number>>((acc, i) => {
      acc[i.post_type] = (acc[i.post_type] ?? 0) + 1;
      return acc;
    }, {});

    console.log(
      `\n${site.id}  [${site.host}${site.sshAlias ? `:${site.sshAlias}` : ''}]  ${site.pathology}`,
    );
    console.log(`  ${corpus.length} items — ${JSON.stringify(counts)}`);
    for (const line of evidence) console.log(`  ✓ ${line}`);
    console.log(`  → ${outPath.replace(`${demoRoot}/`, '')}`);
  }

  console.log(`\n${manifest.sites.length} fleet corpora built, 0 dangling references.`);
}

main();
```

- [ ] **Step 5: Add the npm script**

In `cedar-vale-health-demo/scripts/package.json`, add to `"scripts"`:

```json
"fleet:build": "tsx src/fleet/build.ts"
```

- [ ] **Step 6: Run the build and the full suite**

```bash
cd cedar-vale-health-demo/scripts
npm run fleet:build
npx vitest run
npx tsc --noEmit
```

Expected: seven corpora under `cedar-vale-health-demo/data/fleet/`, every site
printing at least one `✓`, `0 dangling references`, all tests passing, typecheck
clean.

- [ ] **Step 7: Commit**

```bash
git add cedar-vale-health-demo/scripts/ cedar-vale-health-demo/data/fleet/
git commit -m "feat(fleet): build CLI with per-site pathology pre-flight"
```

---

## Phase B — provisioning (Tasks 6–9)

Gated on external dependencies. **Task 8 cannot start until a SpinupWP account
and server exist; Task 7 cannot start until the WP Engine account is chosen.**
Task 6 has no dependencies beyond Phase A.

---

### Task 6: Local provisioning — sites E and F

**Files:**
- Create: `canonical-demos/docs/fleet-provisioning.md` (the `## Local` section)

**Interfaces:**
- Consumes: `data/fleet/cedar-vale-e/normalized.json`, `data/fleet/cedar-vale-f/normalized.json`.
- Produces: two Local sites, F running, E halted; the runbook section Tasks 7–8 extend.

- [ ] **Step 1: Create both sites**

Use the Nexus MCP tool, not the Local UI — Jeremy authorised this route (spec §10):

```
local_create_site  name="cedar-vale-e"   (PHP 8.2, WP latest)
local_create_site  name="cedar-vale-f"   (PHP 8.2, WP latest)
```

Confirm with `local_list_sites` and record each site id — the `wp_*` tools key on it.

- [ ] **Step 2: Install the plugin, theme and ACF Pro on each**

Mirroring exactly what `cedarvale.local` runs:

```bash
# ACF Pro 6.8.6 — same version as the flagship; the acf-json groups must load against it
wp plugin install ~/Downloads/plugins/advanced-custom-fields-pro.zip --activate

ln -s <repo>/cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder \
      <site>/app/public/wp-content/plugins/cedar-vale-seeder
ln -s <repo>/cedar-vale-health-demo/wordpress/themes/cedar-vale \
      <site>/app/public/wp-content/themes/cedar-vale

wp plugin activate cedar-vale-seeder
wp theme activate cedar-vale
```

- [ ] **Step 3: Import each corpus and verify**

```bash
wp cedar import --file=<repo>/cedar-vale-health-demo/data/fleet/cedar-vale-e/normalized.json
wp cedar verify --file=<repo>/cedar-vale-health-demo/data/fleet/cedar-vale-e/normalized.json
```

Expected: `verify` exits 0 on both sites. A non-zero exit means the site does not
match its corpus — stop and diagnose; do not proceed.

- [ ] **Step 4: Confirm CV-F-01 survived the import**

The pathology is exact-match content, so check content, not a flag:

```bash
# On site F — the 40 stolen posts have no localization lead
wp post list --post_type=post --format=count
wp eval 'echo count(get_posts(["post_type"=>"post","numberposts"=>-1,"s"=>"Copper Basin Skin Clinic shares this guidance"]));'
```

Expected: total 60 posts (20 derived + 40 stolen), of which 20 carry the lead.
If all 60 carry it, localization leaked into the stolen set and CV-F-01 is gone.

- [ ] **Step 5: Plant CV-E-01 — halt site E**

```
local_stop_site  site="cedar-vale-e"
```

Confirm with `local_list_sites`: E halted, F running.

**Do not halt F.** E and F differ only in this and in their corpora; halting both
destroys the `halted ≠ missing` contrast, because there is nothing running left
to compare against.

- [ ] **Step 6: Write the runbook section and commit**

Record both site ids, the PHP and WP versions as created, the exact commands run,
and the measured post counts. Then:

```bash
git add docs/fleet-provisioning.md
git commit -m "docs(fleet): Local provisioning runbook for sites E and F"
```

---

### Task 7: WP Engine provisioning — flagship, A and B

**Blocked on:** which of the 14 authenticated accounts to use. Do not guess —
creating installs in the wrong account is billable and visible to other people.

**Files:**
- Modify: `canonical-demos/docs/fleet-provisioning.md` (add the `## WP Engine` section)

- [ ] **Step 1: Confirm the account and its headroom**

```
wpe_get_accounts
wpe_get_account_limits   account_id=<chosen>
wpe_installs_by_account  account_id=<chosen>
```

Three installs are needed. If headroom is under three, stop and report — do not
delete anything to make room.

- [ ] **Step 2: Build each site locally first**

WP Engine refuses `wpcli` writes on `production`, and these are registered
`production` deliberately (spec §1.3). So each WPE site is built as a scratch
Local site and pushed, exactly as an agency would. For `cedar-vale-a` and
`cedar-vale-b`, repeat Task 6 Steps 1–3 against a scratch Local site of the same
name. The flagship is already built as `cedarvale.local`.

- [ ] **Step 3: Create the installs**

```
wpe_create_install  account_id=<chosen>  name="cedarvale"    environment=production
wpe_create_install  account_id=<chosen>  name="cedarvale-a"  environment=production
wpe_create_install  account_id=<chosen>  name="cedarvale-b"  environment=production
```

Install names are `[a-z0-9-]`, 20 characters maximum — `create-install.ts` rejects
21 or more.

- [ ] **Step 4: Push each build up**

```
local_wpe_link  site=<local-site-id>  remote_install_id=<install-name-or-uuid>
local_wpe_push  site=<local-site-id>  remote_install_id=<install-name-or-uuid>
```

Push database and files. After each push, `wpe_purge_cache` for the install —
otherwise the first page views serve the pre-import cache and read as an empty site.

- [ ] **Step 5: Verify over SSH (read-only, allowed on production)**

```bash
nexus wp core version wpe:<account>/cedarvale-a@production
nexus wp plugin list  wpe:<account>/cedarvale-a@production
```

Expected: WP current; `advanced-custom-fields-pro` and `cedar-vale-seeder` both
active. `wp cedar verify` runs through `wpcli`, which is refused on production —
verify against the Local build *before* pushing instead, and treat the push as
the step that must be trusted.

- [ ] **Step 6: Confirm CV-A-01 survived the push**

Fetch a location page on site A and confirm no `openingHoursSpecification` key
appears in its JSON-LD, and that the flagship's equivalent page *does* have one.
The contrast is the pathology; one site alone proves nothing.

- [ ] **Step 7: Record and commit**

Append the account id, the three install names and ids, and the measured
verification output to `docs/fleet-provisioning.md`; commit.

---

### Task 8: SpinupWP provisioning — C, D and G

**Blocked on:** two more SpinupWP sites. The server is up and one site exists.

**Measured 2026-08-11.** `myfirstserver`, 159.65.76.95, DigitalOcean, Ubuntu
26.04 LTS. WP-CLI 2.12.0 and PHP 8.3.33 installed globally. Sudo user
`spinupwp` (uid 1000, sole member of `sudo`). One site: `cedarvale-spin.com`,
site user `cedarvale-spin` (uid 1001, group `site-users`), docroot
`/sites/cedarvale-spin.com/files`, WordPress **7.0.3**, plugins `spinupwp` and
`limit-login-attempts-reloaded` active. Alias `cedarvale-spin` is in
`~/.ssh/config` and authenticates.

**Files:**
- Modify: `canonical-demos/docs/fleet-provisioning.md` (add the `## SpinupWP` section)

- [ ] **Step 1: Create the two missing sites**

One of the three already exists. In the SpinupWP dashboard, add two more on
`myfirstserver`.

**At the New Site step, check whether the form offers an existing system user.**
If it does, put both new sites on `cedarvale-spin`: all three docroots then
belong to one user, one alias reaches all three, and the `ssh:<alias>/<site>`
multi-site form is exercised here as well as on Hostinger. If it forces a new
user per site, accept that and plan for three aliases — see the Global
Constraints; nothing depends on the outcome.

Record each site's domain and docroot. SpinupWP's convention is
`/sites/<domain>/files`, which is also `$HOME/files` for that site's user.

WordPress 7.0.3 is current, so `<two-majors-back>` for CV-C-01 in Step 4 means a
6.x release — pick the latest 6.x minor and record which.

- [ ] **Step 2: Add the ssh alias(es)**

The first is already in `~/.ssh/config` and working:

```
Host cedarvale-spin
  Hostname 159.65.76.95
  User cedarvale-spin
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

**One alias or three depends on Step 1's site-user choice.** If all three sites
run as `cedarvale-spin`, this single block reaches all three roots and nothing
more is needed. If each site got its own user — SpinupWP's default — add one
block per site with that site's user, and set each site's `sshAlias` in
`fleet.json` accordingly.

`IdentitiesOnly yes` is not cosmetic. Without it ssh offers every key in
`~/.ssh` on each connection, and each is a separate failed-auth line in the
server log; SpinupWP installs fail2ban, whose default `sshd` jail bans after 5
failures in 10 minutes. One apparent login attempt can trip it on its own.

Verify each alias before going further — `ssh -G` resolves but does not
validate, and exits 0 for an alias in no config file at all:

```bash
ssh <alias> 'id; wp --version; ls -d "$HOME"/files'
```

A site user cannot list `/sites` (the ACL grants `site-users` traverse only,
`--x`), so `ls -d /sites/*/files` returns nothing even when the connection is
healthy. Check `$HOME/files`, which is that site's docroot.

- [ ] **Step 3: Seed each site with the server's own WP-CLI**

Directly over SSH, not through Nexus — these will be registered `production`,
where `wpcli` writes are refused by design. The seeder plugin and theme must be
*copied* into each site's `wp-content`; symlinks into a local repo do not exist
on a remote server.

```bash
scp cedar-vale-health-demo/data/fleet/cedar-vale-c/normalized.json cedarvale-spin:/tmp/cv-c.json
ssh cedarvale-spin 'cd /sites/<c-domain>/files && \
  wp plugin install /tmp/advanced-custom-fields-pro.zip --activate && \
  wp cedar import --file=/tmp/cv-c.json && \
  wp cedar verify --file=/tmp/cv-c.json'
```

Repeat for D and G.

- [ ] **Step 4: Plant CV-C-01 on site C only**

Run `wp cedar verify` **before** this step, never after: downgrading ACF to 5.x
will break the `acf-json` field groups, which were authored for 6.8.6. That
breakage is the intended pathology — C is supposed to be broken — but a verify
failure afterwards is indistinguishable from an import failure.

```bash
ssh cedarvale-spin 'cd /sites/<c-domain>/files && \
  wp core update --version=<two-majors-back> --force && \
  wp plugin install advanced-custom-fields --version=5.12.6 --force --activate && \
  wp plugin install <an-abandoned-plugin> --activate && \
  wp theme activate twentytwentyone && \
  wp config set WP_AUTO_UPDATE_CORE false --raw'
```

`WP_AUTO_UPDATE_CORE false` matters: without it C silently repairs itself between
demos and the pathology evaporates. Site C runs `twentytwentyone` per its
manifest entry — an install two majors behind never received the new theme, and
it gives `find_sites_with_theme` a real negative to return.

- [ ] **Step 5: Register all three with Nexus**

```bash
nexus host add <alias> --env production      # once per alias from Step 2
```

Registration lists every discovered WordPress install and lets you pick which to
register. On a shared-user server, pick all three from the single alias; on
per-site users, each `host add` will offer exactly one. Then:

```bash
nexus host list
nexus wp core version ssh:<alias>/<site>@production
```

Every surface prints the full `ssh:<alias>/<site>` form regardless of how many
sites a connection carries, so expect that shape in both cases. What must be
true either way: three rows, `source='external'`, `is_active=1`.

- [ ] **Step 6: Collect metadata and index**

```bash
nexus host refresh cedarvale-spin
nexus host index   cedarvale-spin
```

`php_version` may come back NULL if the server disables `proc_open` — `wp --info`
needs it. On SpinupWP that is unlikely, but if it happens, leave it NULL. Never
substitute `'8.0'`; the honest NULL is what keeps the site out of the health
score rather than giving it a fabricated one (CLAUDE.md, "Fleet counts").

Then confirm the vector tables did not collide:

```
search_site_content  site="ssh:<alias>/cedar-vale-d"  query="<a term unique to D's corpus>"
search_site_content  site="ssh:<alias>/cedar-vale-g"  query="<the same term>"
```

D must return hits and G must not. Both returning the same hits means the two
sites share a sqlite-vec table.

This check is worth running whichever alias layout Step 2 produced, but it is
**not** the only coverage of that regression: `ssh:hostinger-test` already
carries two registered sites under one alias, so the multi-site `vectorSiteId()`
path has a live target independent of this server.

- [ ] **Step 7: Record and commit**

Append the server details, the three document roots, the alias block, and the
measured `nexus host list` output to `docs/fleet-provisioning.md`; commit.

---

### Task 9: Fleet-level acceptance — every pathology found by a real tool

**This is the plan's actual gate.** A pathology that unit tests confirm in the
corpus but that no Nexus tool surfaces has not been built.

**Files:**
- Create: `canonical-demos/docs/fleet-acceptance.md`

- [ ] **Step 1: Confirm all eight installs are visible and correctly sourced**

```
nexus_list_sites
fleet_sql  query="SELECT source, COUNT(*) c FROM sites WHERE is_active=1 AND name LIKE 'cedar%' GROUP BY source"
```

Expected: `local` 3 (E, F, and the `cedarvale.local` dev clone), `wpe` 3,
`external` 3. Nine rows for eight installs, because the flagship exists on both
WP Engine and Local — the intended dev-clone relationship, not a duplicate.

- [ ] **Step 2: Find each pathology with a named tool, and record the output verbatim**

| Id | Tool | Expected finding |
|---|---|---|
| `CV-A-01` | `compare_sites` flagship vs A | A's locations carry no hours; the flagship's do |
| `CV-B-01` | `fleet_sql` grouping providers by NPI across sites | one NPI accepting patients on two installs, at clinic sets sharing nothing. Multi-clinic providers legitimately appear on several installs with overlapping clinic lists — the query must require a *disjoint* set, or it returns 17 false positives |
| `CV-C-01` | `detect_drift`, `find_outdated_sites` | C two majors behind; ACF 5.x; abandoned plugin |
| `CV-D-01` | `compare_sites` flagship vs D | 4 matching slugs, differing address and phone |
| `CV-E-01` | `nexus_list_sites`, `get_site_health` | E present and halted — reported as halted, never as missing |
| `CV-F-01` | `search_across_sites` on a stolen passage | the same passage returned from the flagship and F, byte-identical |
| `CV-G-01` | `fleet_sql` on `review_date` / `reviewed_by` | 8 treatments >36 months, 3 with no reviewer |

A tool that returns nothing is a finding about the tool, not about the corpus —
Phase A already proved the data is there. Record which, and do **not** paper over
it by adjusting the corpus until the tool happens to fire.

- [ ] **Step 3: Confirm E is reported as halted, not as broken**

`get_site_health` for E must not return a `critical` score driven by "has never
been indexed" or a fabricated PHP version. If it does, that is the known
Local-shaped-scoring defect (CLAUDE.md, "Health scoring is Local-shaped") and E
is now a live reproduction of it — record it as such rather than working around it.

- [ ] **Step 4: Write `docs/fleet-acceptance.md`**

One section per pathology: the tool invoked, the verbatim output, and one
sentence on what a viewer is meant to conclude. Where a tool failed to surface a
real defect, say so plainly — that is the most valuable line in the document.

- [ ] **Step 5: Commit**

```bash
git add docs/fleet-acceptance.md
git commit -m "docs(fleet): measured acceptance for all seven pathologies"
```

---

## Out of scope

- **Spec §3.1's 30 filler `page` records on the flagship.** Not built in Plan 1d, not built here.
- **Meridian Data (M3–M4).** A separate property with its own spec sections and its own plan.
- **M5 integrations** — GA4, Search Console, HubSpot. Gated on real domains.
- **Per-site distinct themes.** Only C differs (stock `twentytwentyone`). Seven bespoke themes would be realistic and is not worth the cost.
- **Backdated traffic or analytics on the fleet.** Spec §4.1 already rules the seedable pipes out; the fleet is a structured-data and drift story, not a traffic one.
