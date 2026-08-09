# Cedar & Vale Health — Content Model & Generators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the complete, deterministic, manifest-verified content corpus for the Cedar & Vale Health flagship demo site — 25 locations, 60 providers, 45 treatments, 80 conditions, 600 patient-education posts and 30 insurance plans — as normalized JSON ready for import.

**Architecture:** A new workspace package (`@canonical-demos/cedar-scripts`) that depends on the completed `@canonical-demos/shared`. Six generators turn reference data plus AI prose into typed domain objects; zod schemas are the source of truth for every field; a normalize pass maps domain objects into the same `NormalizedItem` envelope Alpine's importer already consumes, then links relationships. One CLI entry wires the shared library's model preflight, token budget, checkpoint and resumable runner together, and refuses to finish unless the generated corpus matches the manifest.

**Tech Stack:** Node ≥18, TypeScript 5.4 (strict, ESM, `NodeNext`), vitest 4, zod 3, `@faker-js/faker` 9, `@canonical-demos/shared`.

**Source spec:** `docs/superpowers/specs/2026-08-09-canonical-demo-sites-design.md` §3.1 (content model), §6 (generation architecture), §6.1 (inherited obligations)

## Global Constraints

- **Node ≥18**, `"type": "module"`, TypeScript `strict: true` with `noUncheckedIndexedAccess: true`, module resolution `NodeNext` — **relative imports must carry a `.js` extension**, and types are re-exported with the `type` keyword.
- **No test may touch the network, spawn a process, write outside a temp dir, or require WordPress.** Every AI call in a test goes through a fake `CompletionClient`.
- **Determinism: one `seed` from the manifest drives every random choice.** Two runs with the same seed produce byte-identical `data/*.json`. `Math.random()` is banned in `src/**` — import `createRng`/`seededFaker` from `@canonical-demos/shared` instead. Do not import `faker` directly; the global instance is not seeded.
- **The manifest is the source of truth for counts**, and generation fails when actual ≠ declared (spec §6).
- **AI-written vs composite is declared by the manifest's `tier`, not by a flag.** Cedar's AI budget is ~400 pieces: 60 providers, 45 treatments, 80 conditions, and 215 of the 600 patient-education posts. The remaining 385 posts, all 25 locations and all 30 insurance plans are template-and-faker composites with real entities and real links but shallow prose (spec §6).
- **Anything not parsed or not generated is written as `null`, never as a plausible default.** No invented dates, no invented credentials.
- `alpine-outfitters-demo/` is a sibling directory with its own git repo — never modified by this plan.
- Never `git push`, `npm version`, or `git tag` — commits only.

## What This Plan Does NOT Do

- **No WordPress.** The seeder plugin, CPT/taxonomy registration, ACF field group JSON and JSON-LD emission are **Plan 1c**. This plan emits JSON whose `acf` keys match the field names 1c will register; that shared vocabulary is fixed in Task 2 and both plans must agree on it.
- **No import.** The two-pass importer, `syncterms`, and the live `verifySite` gate are **Plan 1d**. This plan's verify gate checks the *generated files* against the manifest, not a live site.
- **No pathologies.** The seven legacy fleet sites and their planted defects are **Plan 1e** (spec §3.2).
- **No theme.** Block theme, Block Bindings and the CWV/AA gates are **Plan 1f** (spec §5).
- **No `page` post type.** Spec §3.1 lists **30 pages** for the flagship; this plan's
  manifest deliberately does not declare them, so the count gate does not check them.
  The reason: most of those 30 are structural rather than editorial (contact, insurance
  index, patient resources, per-metro landing pages), several are WordPress-native
  (privacy policy) and several are better expressed as block patterns than as generated
  prose — all of which makes them Plan 1c/1d work rather than generator work. **This is a
  scope decision, not an oversight, and it leaves the plan short of spec §3.1 by 30
  records.** If pages should be generated here instead, add a `page` entry to
  `manifest.json` and a composite generator alongside Task 8's; nothing else in this plan
  changes.

---

## File Structure

| File | Responsibility |
|---|---|
| `canonical-demos/package.json` | Modify: add `cedar-vale-health-demo/scripts` to `workspaces` |
| `cedar-vale-health-demo/manifest.json` | Declared counts and the master seed. The count gate reads this. |
| `cedar-vale-health-demo/.env.example` | `ANTHROPIC_API_KEY`, `TOKEN_BUDGET`, `AI_MODEL` |
| `cedar-vale-health-demo/scripts/package.json` | Package manifest; depends on `@canonical-demos/shared` |
| `.../src/domain.ts` | zod schemas for all six content types + the `NormalizedItem` envelope. The single source of truth for field names. |
| `.../src/reference/metros.ts` | The 4 metros and their cities — the geography every location and provider is placed in |
| `.../src/reference/specialties.ts` | Provider specialties, credentials, board certifications, languages |
| `.../src/reference/catalogs.ts` | The 45 treatment and 80 condition names with ICD-10 codes and categories |
| `.../src/reference/carriers.ts` | The 30 insurance carrier × plan-type combinations |
| `.../src/generators/locations.ts` | 25 locations (composite) |
| `.../src/generators/providers.ts` | 60 providers (AI prose) |
| `.../src/generators/treatments.ts` | 45 treatments (AI prose) |
| `.../src/generators/conditions.ts` | 80 conditions (AI prose) |
| `.../src/generators/posts.ts` | 600 patient-education posts (215 AI, 385 composite) |
| `.../src/generators/insurance.ts` | 30 insurance plans (composite) |
| `.../src/prompts/*.ts` | Prompt builders, one file per AI-generated type. Kept separate so prose can be tuned without touching generator logic. |
| `.../src/normalize/acf-mappers.ts` | Domain object → `NormalizedItem` |
| `.../src/normalize/relationships.ts` | Cross-type links, resolved after every type exists |
| `.../src/generate-content.ts` | CLI entry: preflight → budget → checkpoint → runGeneration → normalize → verify |

Each `src/**` module gets a sibling `*.test.ts`.

---

### Task 1: Cedar package scaffold

**Files:**
- Modify: `canonical-demos/package.json` (the `workspaces` array)
- Create: `cedar-vale-health-demo/manifest.json`
- Create: `cedar-vale-health-demo/.env.example`
- Create: `cedar-vale-health-demo/scripts/package.json`
- Create: `cedar-vale-health-demo/scripts/tsconfig.json`
- Create: `cedar-vale-health-demo/scripts/vitest.config.ts`
- Test: `cedar-vale-health-demo/scripts/src/manifest-wiring.test.ts`

**Interfaces:**
- Consumes: `@canonical-demos/shared` — `parseManifest(raw: unknown): Manifest`, `expectedCounts(m: Manifest): Record<string, number>`.
- Produces: a resolvable `@canonical-demos/shared` import from inside `cedar-vale-health-demo/scripts`, and `manifest.json` as the declared-count source of truth for every later task.

- [ ] **Step 1: Write the failing test**

This test does double duty: it proves the workspace dependency resolves, and it pins the manifest's declared totals so a later edit cannot quietly change the corpus size.

```typescript
// cedar-vale-health-demo/scripts/src/manifest-wiring.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectedCounts, parseManifest } from '@canonical-demos/shared';

const manifest = parseManifest(
  JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')),
);

describe('cedar manifest', () => {
  it('resolves the shared package and parses', () => {
    expect(manifest.site).toBe('cedar-vale-health');
  });

  it('declares one fixed master seed', () => {
    expect(manifest.seed).toBe(20260809);
  });

  it('declares the corpus the spec calls for', () => {
    expect(expectedCounts(manifest)).toEqual({
      location: 25,
      provider: 60,
      treatment: 45,
      condition: 80,
      post: 600,
      insurance_plan: 30,
    });
  });

  it('splits the 600 posts into the spec AI budget of 215 hero', () => {
    const posts = manifest.entries.filter((e) => e.postType === 'post');
    expect(posts.find((e) => e.tier === 'hero')?.count).toBe(215);
    expect(posts.find((e) => e.tier === 'composite')?.count).toBe(385);
  });

  it('marks locations and insurance plans composite, and the clinical types hero', () => {
    const tierOf = (pt: string) => manifest.entries.filter((e) => e.postType === pt).map((e) => e.tier);
    expect(tierOf('location')).toEqual(['composite']);
    expect(tierOf('insurance_plan')).toEqual(['composite']);
    expect(tierOf('provider')).toEqual(['hero']);
    expect(tierOf('treatment')).toEqual(['hero']);
    expect(tierOf('condition')).toEqual(['hero']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/manifest-wiring.test.ts
```

Expected: FAIL — the package does not exist yet, so vitest cannot resolve `@canonical-demos/shared` (or the directory itself).

- [ ] **Step 3: Create the package and the manifest**

```bash
mkdir -p ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts/src
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo
cat > manifest.json <<'EOF'
{
  "site": "cedar-vale-health",
  "seed": 20260809,
  "entries": [
    { "postType": "location", "tier": "composite", "count": 25 },
    { "postType": "provider", "tier": "hero", "count": 60 },
    { "postType": "treatment", "tier": "hero", "count": 45 },
    { "postType": "condition", "tier": "hero", "count": 80 },
    { "postType": "post", "tier": "hero", "count": 215 },
    { "postType": "post", "tier": "composite", "count": 385 },
    { "postType": "insurance_plan", "tier": "composite", "count": 30 }
  ]
}
EOF
cat > .env.example <<'EOF'
# Required for the AI-written tiers (providers, treatments, conditions, hero posts).
ANTHROPIC_API_KEY=

# Hard ceiling for one invocation, in tokens. The run aborts rather than exceeding it.
TOKEN_BUDGET=4000000

# Omit to use the shared library's DEFAULT_MODEL.
AI_MODEL=
EOF
cat > scripts/package.json <<'EOF'
{
  "name": "@canonical-demos/cedar-scripts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "generate": "tsx src/generate-content.ts"
  },
  "dependencies": {
    "@canonical-demos/shared": "*",
    "@faker-js/faker": "^9.0.0",
    "dotenv": "^16.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.15.0",
    "typescript": "^5.4.5",
    "vitest": "^4.1.10"
  }
}
EOF
cat > scripts/tsconfig.json <<'EOF'
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
EOF
cat > scripts/vitest.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
EOF
```

Then add the workspace. In `canonical-demos/package.json`, change:

```json
  "workspaces": ["shared"],
```

to:

```json
  "workspaces": ["shared", "cedar-vale-health-demo/scripts"],
```

and install from the monorepo root:

```bash
cd ~/development/wpengine/canonical-demos && npm install
```

`"@canonical-demos/shared": "*"` resolves to the local workspace package — npm symlinks it into `node_modules`, so no build step is needed and `exports` pointing at TS source works under tsx and vitest.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/manifest-wiring.test.ts && npm run typecheck
```

Expected: PASS — 5 tests, and a clean typecheck. If `@canonical-demos/shared` fails to resolve, the workspace entry or the `npm install` did not take; do not work around it with a relative import path.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add package.json package-lock.json cedar-vale-health-demo
git commit -m "feat(cedar): scaffold content-generator package and manifest"
```

---

### Task 2: Domain schemas and the normalized envelope

This task fixes the field vocabulary. **Plan 1c registers ACF fields under exactly these names**, so a rename here is a rename there.

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/domain.ts`
- Test: `cedar-vale-health-demo/scripts/src/domain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LocationSchema`, `ProviderSchema`, `TreatmentSchema`, `ConditionSchema`, `PatientPostSchema`, `InsurancePlanSchema` (zod), and the inferred types `Location`, `Provider`, `Treatment`, `Condition`, `PatientPost`, `InsurancePlan`
  - `ReviewStatusSchema` = `z.enum(['reviewed','overdue','unreviewed'])`
  - `NormalizedItemSchema` and `type NormalizedItem = { slug: string; post_type: string; post_title: string; post_content: string; post_status: 'publish'; acf: Record<string, unknown>; relationships: Record<string, string[]> }`
  - `slugify(input: string): string`
  - `type Corpus = { locations: Location[]; providers: Provider[]; treatments: Treatment[]; conditions: Condition[]; posts: PatientPost[]; insurancePlans: InsurancePlan[] }`

Note two deliberate shape choices. `relationships` holds **slugs**, not WordPress post IDs — IDs do not exist until import, and Plan 1d's Pass 2 resolves slugs to IDs. And `NormalizedItem` carries `post_type` (Alpine's envelope did not, because its importer was invoked once per type); carrying it lets one file hold a mixed corpus.

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/domain.test.ts
import { describe, expect, it } from 'vitest';
import {
  LocationSchema,
  NormalizedItemSchema,
  ProviderSchema,
  ReviewStatusSchema,
  TreatmentSchema,
  slugify,
} from './domain.js';

const validLocation = {
  slug: 'cedar-vale-dermatology-boulder',
  name: 'Cedar & Vale Dermatology — Boulder',
  metro: 'Front Range',
  address: { street: '1820 Pearl Street', city: 'Boulder', state: 'CO', zip: '80302' },
  geo: { lat: 40.019, lng: -105.2705 },
  phone: '(303) 555-0142',
  hours: [
    { day: 'monday', opens: '08:00', closes: '17:00' },
    { day: 'sunday', opens: null, closes: null },
  ],
  acceptingNewPatients: true,
  placeId: 'cv-boulder-001',
  openedDate: '2014-03-01',
  parking: 'Street parking and a validated garage on 18th.',
  accessibility: 'Step-free entrance, accessible restrooms.',
};

describe('LocationSchema', () => {
  it('accepts a complete location', () => {
    expect(() => LocationSchema.parse(validLocation)).not.toThrow();
  });

  it('allows a closed day as explicit nulls rather than omitted hours', () => {
    const sunday = LocationSchema.parse(validLocation).hours.find((h) => h.day === 'sunday');
    expect(sunday).toEqual({ day: 'sunday', opens: null, closes: null });
  });

  it('rejects a 4-digit zip', () => {
    const bad = { ...validLocation, address: { ...validLocation.address, zip: '8030' } };
    expect(() => LocationSchema.parse(bad)).toThrow();
  });

  it('rejects latitude outside the valid range', () => {
    const bad = { ...validLocation, geo: { lat: 91, lng: 0 } };
    expect(() => LocationSchema.parse(bad)).toThrow();
  });
});

describe('ProviderSchema', () => {
  const validProvider = {
    slug: 'jane-okonkwo-md',
    name: 'Jane Okonkwo, MD',
    credentials: 'MD',
    specialties: ['medical dermatology'],
    boardCertifications: ['American Board of Dermatology'],
    npi: '1234567890',
    licenseState: 'CO',
    languages: ['English', 'Igbo'],
    bio: 'Dr. Okonkwo treats inflammatory skin disease...',
    acceptingNewPatients: true,
    locations: ['cedar-vale-dermatology-boulder'],
    bioReviewedBy: 'marcus-hale-md',
    reviewDate: '2026-02-14',
    reviewStatus: 'reviewed',
  };

  it('accepts a complete provider', () => {
    expect(() => ProviderSchema.parse(validProvider)).not.toThrow();
  });

  it('requires an NPI of exactly 10 digits', () => {
    expect(() => ProviderSchema.parse({ ...validProvider, npi: '12345' })).toThrow();
  });

  it('allows a null reviewDate paired with unreviewed, never a fabricated one', () => {
    const unreviewed = ProviderSchema.parse({
      ...validProvider,
      bioReviewedBy: null,
      reviewDate: null,
      reviewStatus: 'unreviewed',
    });
    expect(unreviewed.reviewDate).toBeNull();
  });

  it('rejects an empty specialty list', () => {
    expect(() => ProviderSchema.parse({ ...validProvider, specialties: [] })).toThrow();
  });
});

describe('TreatmentSchema', () => {
  it('requires priceRangeByLocation entries to reference a location slug', () => {
    const base = {
      slug: 'mohs-surgery',
      name: 'Mohs Surgery',
      category: 'surgical',
      conditionsTreated: ['basal-cell-carcinoma'],
      typicalDurationMinutes: 180,
      anesthesia: 'local',
      downtimeDays: 7,
      insuranceCovered: true,
      fdaStatus: null,
      description: 'Mohs surgery removes skin cancer layer by layer...',
      priceRangeByLocation: [{ location: 'cedar-vale-dermatology-boulder', low: 1200, high: 3800 }],
      reviewedBy: 'marcus-hale-md',
      reviewDate: '2026-01-05',
      reviewStatus: 'reviewed',
    };
    expect(() => TreatmentSchema.parse(base)).not.toThrow();
    expect(() =>
      TreatmentSchema.parse({ ...base, priceRangeByLocation: [{ location: '', low: 1, high: 2 }] }),
    ).toThrow();
  });

  it('rejects a price range whose low exceeds its high', () => {
    expect(() =>
      TreatmentSchema.parse({
        slug: 's',
        name: 'S',
        category: 'cosmetic',
        conditionsTreated: ['acne-vulgaris'],
        typicalDurationMinutes: 30,
        anesthesia: 'none',
        downtimeDays: 0,
        insuranceCovered: false,
        fdaStatus: null,
        description: 'x',
        priceRangeByLocation: [{ location: 'l', low: 900, high: 100 }],
        reviewedBy: null,
        reviewDate: null,
        reviewStatus: 'unreviewed',
      }),
    ).toThrow();
  });
});

describe('ReviewStatusSchema', () => {
  it('admits exactly the three states the taxonomy uses', () => {
    expect(ReviewStatusSchema.options).toEqual(['reviewed', 'overdue', 'unreviewed']);
  });
});

describe('NormalizedItemSchema', () => {
  it('accepts an envelope carrying slug relationships', () => {
    expect(() =>
      NormalizedItemSchema.parse({
        slug: 'acne-vulgaris',
        post_type: 'condition',
        post_title: 'Acne Vulgaris',
        post_content: 'Acne is...',
        post_status: 'publish',
        acf: { icd10: 'L70.0' },
        relationships: { related_treatments: ['isotretinoin-therapy'] },
      }),
    ).not.toThrow();
  });

  it('rejects a post_status other than publish', () => {
    expect(() =>
      NormalizedItemSchema.parse({
        slug: 'x',
        post_type: 'condition',
        post_title: 'X',
        post_content: 'x',
        post_status: 'draft',
        acf: {},
        relationships: {},
      }),
    ).toThrow();
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Cedar & Vale Dermatology — Boulder')).toBe('cedar-vale-dermatology-boulder');
  });

  it('strips credential punctuation from a provider name', () => {
    expect(slugify('Jane Okonkwo, MD')).toBe('jane-okonkwo-md');
  });

  it('collapses runs of separators and trims them from both ends', () => {
    expect(slugify('  --Hello //  World--  ')).toBe('hello-world');
  });

  it('is stable when applied twice', () => {
    const once = slugify('Mohs Surgery (Stage II)');
    expect(slugify(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/domain.test.ts
```

Expected: FAIL — cannot resolve `./domain.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// cedar-vale-health-demo/scripts/src/domain.ts
import { z } from 'zod';

/** Lowercase, hyphen-separated, idempotent. Slugs are the identity used everywhere
 *  before WordPress assigns post IDs, so this must be stable across runs. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SlugSchema = z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a slug');
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

export const ReviewStatusSchema = z.enum(['reviewed', 'overdue', 'unreviewed']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/** Provenance travels together: a reviewer with no date, or a date with no reviewer,
 *  is the kind of half-populated record the spec's honesty rule forbids. */
const ProvenanceSchema = z
  .object({
    reviewedBy: SlugSchema.nullable(),
    reviewDate: IsoDateSchema.nullable(),
    reviewStatus: ReviewStatusSchema,
  })
  .refine((p) => (p.reviewedBy === null) === (p.reviewDate === null), {
    message: 'reviewedBy and reviewDate must both be present or both be null',
  })
  .refine((p) => (p.reviewStatus === 'unreviewed') === (p.reviewedBy === null), {
    message: 'reviewStatus "unreviewed" requires a null reviewer, and vice versa',
  });

export const DayHoursSchema = z
  .object({
    day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
    opens: TimeSchema.nullable(),
    closes: TimeSchema.nullable(),
  })
  .refine((h) => (h.opens === null) === (h.closes === null), {
    message: 'a closed day must have both opens and closes null',
  });

export const LocationSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1),
  metro: z.string().min(1),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().length(2),
    zip: z.string().regex(/^\d{5}$/, 'must be a 5-digit ZIP'),
  }),
  geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  phone: z.string().min(10),
  hours: z.array(DayHoursSchema).length(7),
  acceptingNewPatients: z.boolean(),
  placeId: z.string().min(1),
  openedDate: IsoDateSchema,
  parking: z.string().min(1),
  accessibility: z.string().min(1),
});

export const ProviderSchema = z
  .object({
    slug: SlugSchema,
    name: z.string().min(1),
    credentials: z.enum(['MD', 'DO', 'PA-C', 'NP']),
    specialties: z.array(z.string().min(1)).min(1),
    boardCertifications: z.array(z.string().min(1)),
    npi: z.string().regex(/^\d{10}$/, 'NPI must be 10 digits'),
    licenseState: z.string().length(2),
    languages: z.array(z.string().min(1)).min(1),
    bio: z.string().min(1),
    acceptingNewPatients: z.boolean(),
    locations: z.array(SlugSchema).min(1),
    bioReviewedBy: SlugSchema.nullable(),
    reviewDate: IsoDateSchema.nullable(),
    reviewStatus: ReviewStatusSchema,
  })
  .refine((p) => (p.bioReviewedBy === null) === (p.reviewDate === null), {
    message: 'bioReviewedBy and reviewDate must both be present or both be null',
  })
  .refine((p) => (p.reviewStatus === 'unreviewed') === (p.bioReviewedBy === null), {
    message: 'reviewStatus "unreviewed" requires a null reviewer, and vice versa',
  });

const PriceRangeSchema = z
  .object({ location: SlugSchema, low: z.number().nonnegative(), high: z.number().nonnegative() })
  .refine((r) => r.low <= r.high, { message: 'low must not exceed high' });

export const TreatmentSchema = z
  .object({
    slug: SlugSchema,
    name: z.string().min(1),
    category: z.enum(['medical', 'surgical', 'cosmetic']),
    conditionsTreated: z.array(SlugSchema).min(1),
    typicalDurationMinutes: z.number().int().positive(),
    anesthesia: z.enum(['none', 'topical', 'local', 'sedation']),
    downtimeDays: z.number().int().nonnegative(),
    insuranceCovered: z.boolean(),
    fdaStatus: z.string().min(1).nullable(),
    description: z.string().min(1),
    priceRangeByLocation: z.array(PriceRangeSchema).min(1),
  })
  .and(ProvenanceSchema);

export const ConditionSchema = z
  .object({
    slug: SlugSchema,
    name: z.string().min(1),
    icd10: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, 'must look like an ICD-10 code'),
    category: z.string().min(1),
    bodyAreas: z.array(z.string().min(1)).min(1),
    symptoms: z.array(z.string().min(1)).min(1),
    relatedTreatments: z.array(SlugSchema),
    description: z.string().min(1),
  })
  .and(ProvenanceSchema);

export const PatientPostSchema = z
  .object({
    slug: SlugSchema,
    title: z.string().min(1),
    content: z.string().min(1),
    excerpt: z.string().min(1),
    tier: z.enum(['hero', 'composite']),
    conditionFocus: SlugSchema.nullable(),
    treatmentFocus: SlugSchema.nullable(),
    readingLevel: z.enum(['plain', 'standard', 'clinical']),
    internalLinks: z.array(SlugSchema),
  })
  .and(ProvenanceSchema);

export const InsurancePlanSchema = z.object({
  slug: SlugSchema,
  carrier: z.string().min(1),
  planName: z.string().min(1),
  planType: z.enum(['HMO', 'PPO', 'EPO', 'POS', 'Medicare Advantage']),
  acceptedAt: z.array(SlugSchema),
  referralRequired: z.boolean(),
  notes: z.string().min(1).nullable(),
});

export const NormalizedItemSchema = z.object({
  slug: SlugSchema,
  post_type: z.string().min(1),
  post_title: z.string().min(1),
  post_content: z.string().min(1),
  post_status: z.literal('publish'),
  acf: z.record(z.unknown()),
  relationships: z.record(z.array(z.string())),
});

export type Location = z.infer<typeof LocationSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type Treatment = z.infer<typeof TreatmentSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type PatientPost = z.infer<typeof PatientPostSchema>;
export type InsurancePlan = z.infer<typeof InsurancePlanSchema>;
export type NormalizedItem = z.infer<typeof NormalizedItemSchema>;

export interface Corpus {
  locations: Location[];
  providers: Provider[];
  treatments: Treatment[];
  conditions: Condition[];
  posts: PatientPost[];
  insurancePlans: InsurancePlan[];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/domain.test.ts && npm run typecheck
```

Expected: PASS — 15 tests, clean typecheck.

- [ ] **Step 5: Commit**

```bash
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/domain.ts cedar-vale-health-demo/scripts/src/domain.test.ts
git commit -m "feat(cedar): domain schemas, provenance rules and the normalized envelope"
```

---

### Task 3: Metro reference data and the locations generator

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/reference/metros.ts`
- Create: `cedar-vale-health-demo/scripts/src/generators/locations.ts`
- Test: `cedar-vale-health-demo/scripts/src/generators/locations.test.ts`

**Interfaces:**
- Consumes: `Location`, `LocationSchema`, `slugify` from `../domain.js` (Task 2); `createRng`, `seededFaker` from `@canonical-demos/shared`.
- Produces:
  - `METROS: readonly Metro[]` where `Metro = { name: string; state: string; cities: readonly City[]; latRange: readonly [number, number]; lngRange: readonly [number, number] }` and `City = { name: string; zips: readonly string[] }`
  - `generateLocations(seed: number, count: number): Location[]`
  - Locations are distributed across metros round-robin so no metro is empty, and each is validated against `LocationSchema` before return.

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/generators/locations.test.ts
import { describe, expect, it } from 'vitest';
import { LocationSchema } from '../domain.js';
import { METROS } from '../reference/metros.js';
import { generateLocations } from './locations.js';

describe('METROS', () => {
  it('covers the four metros the spec calls for', () => {
    expect(METROS).toHaveLength(4);
  });

  it('gives every metro at least two cities with at least one ZIP each', () => {
    for (const metro of METROS) {
      expect(metro.cities.length).toBeGreaterThanOrEqual(2);
      for (const city of metro.cities) expect(city.zips.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('generateLocations', () => {
  it('generates exactly the requested count', () => {
    expect(generateLocations(20260809, 25)).toHaveLength(25);
  });

  it('produces records that satisfy LocationSchema', () => {
    for (const location of generateLocations(20260809, 25)) {
      expect(() => LocationSchema.parse(location)).not.toThrow();
    }
  });

  it('is deterministic for a given seed', () => {
    expect(generateLocations(7, 25)).toEqual(generateLocations(7, 25));
  });

  it('produces different output for a different seed', () => {
    expect(generateLocations(7, 25)).not.toEqual(generateLocations(8, 25));
  });

  it('assigns unique slugs', () => {
    const slugs = generateLocations(20260809, 25).map((l) => l.slug);
    expect(new Set(slugs).size).toBe(25);
  });

  it('places at least one location in every metro', () => {
    const metros = new Set(generateLocations(20260809, 25).map((l) => l.metro));
    expect(metros.size).toBe(METROS.length);
  });

  it('gives every location all seven days of hours', () => {
    for (const location of generateLocations(20260809, 25)) {
      expect(location.hours).toHaveLength(7);
      expect(location.hours.map((h) => h.day)).toEqual([
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      ]);
    }
  });

  it('closes every location on Sunday with explicit nulls', () => {
    for (const location of generateLocations(20260809, 25)) {
      const sunday = location.hours.find((h) => h.day === 'sunday');
      expect(sunday).toEqual({ day: 'sunday', opens: null, closes: null });
    }
  });

  it('places each location geographically inside its own metro bounds', () => {
    for (const location of generateLocations(20260809, 25)) {
      const metro = METROS.find((m) => m.name === location.metro);
      expect(metro).toBeDefined();
      expect(location.geo.lat).toBeGreaterThanOrEqual(metro!.latRange[0]);
      expect(location.geo.lat).toBeLessThanOrEqual(metro!.latRange[1]);
      expect(location.geo.lng).toBeGreaterThanOrEqual(metro!.lngRange[0]);
      expect(location.geo.lng).toBeLessThanOrEqual(metro!.lngRange[1]);
    }
  });

  it('draws each ZIP from the city it belongs to', () => {
    for (const location of generateLocations(20260809, 25)) {
      const metro = METROS.find((m) => m.name === location.metro)!;
      const city = metro.cities.find((c) => c.name === location.address.city);
      expect(city, `city ${location.address.city} not in metro ${metro.name}`).toBeDefined();
      expect(city!.zips).toContain(location.address.zip);
    }
  });

  it('rejects a count larger than the available city/ZIP combinations', () => {
    expect(() => generateLocations(1, 5000)).toThrow(/distinct locations/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/generators/locations.test.ts
```

Expected: FAIL — cannot resolve `../reference/metros.js`.

- [ ] **Step 3: Write the reference data**

```typescript
// cedar-vale-health-demo/scripts/src/reference/metros.ts
export interface City {
  readonly name: string;
  readonly zips: readonly string[];
}

export interface Metro {
  readonly name: string;
  readonly state: string;
  readonly cities: readonly City[];
  /** Bounding box, used so a location's coordinates land in the metro it claims. */
  readonly latRange: readonly [number, number];
  readonly lngRange: readonly [number, number];
}

export const METROS: readonly Metro[] = [
  {
    name: 'Front Range',
    state: 'CO',
    latRange: [39.55, 40.15],
    lngRange: [-105.3, -104.7],
    cities: [
      { name: 'Denver', zips: ['80202', '80206', '80218', '80220'] },
      { name: 'Boulder', zips: ['80301', '80302', '80304'] },
      { name: 'Littleton', zips: ['80120', '80123'] },
      { name: 'Westminster', zips: ['80031', '80234'] },
    ],
  },
  {
    name: 'Puget Sound',
    state: 'WA',
    latRange: [47.25, 47.8],
    lngRange: [-122.45, -122.1],
    cities: [
      { name: 'Seattle', zips: ['98101', '98109', '98115', '98122'] },
      { name: 'Bellevue', zips: ['98004', '98007'] },
      { name: 'Tacoma', zips: ['98402', '98405'] },
    ],
  },
  {
    name: 'Research Triangle',
    state: 'NC',
    latRange: [35.7, 36.1],
    lngRange: [-79.05, -78.6],
    cities: [
      { name: 'Raleigh', zips: ['27601', '27607', '27612'] },
      { name: 'Durham', zips: ['27701', '27705'] },
      { name: 'Chapel Hill', zips: ['27514', '27516'] },
    ],
  },
  {
    name: 'Sonoran',
    state: 'AZ',
    latRange: [33.25, 33.75],
    lngRange: [-112.3, -111.8],
    cities: [
      { name: 'Phoenix', zips: ['85004', '85016', '85028'] },
      { name: 'Scottsdale', zips: ['85251', '85260'] },
      { name: 'Tempe', zips: ['85281', '85284'] },
    ],
  },
] as const;
```

- [ ] **Step 4: Write the generator**

```typescript
// cedar-vale-health-demo/scripts/src/generators/locations.ts
import { createRng, seededFaker } from '@canonical-demos/shared';
import { LocationSchema, slugify, type Location } from '../domain.js';
import { METROS } from '../reference/metros.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

const PARKING = [
  'Free surface lot adjacent to the entrance.',
  'Street parking and a validated garage next door.',
  'Dedicated patient lot behind the building, entrance on the north side.',
  'Underground garage, first ninety minutes validated at reception.',
] as const;

const ACCESSIBILITY = [
  'Step-free entrance, accessible restrooms, elevator to all floors.',
  'Ramped entrance and accessible exam rooms on the ground floor.',
  'Automatic doors, accessible parking within twenty feet of the entrance.',
] as const;

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function generateLocations(seed: number, count: number): Location[] {
  const rng = createRng(seed);
  const faker = seededFaker(seed);

  // One location per city/ZIP pair at most, so slugs and addresses stay distinct.
  const slots = METROS.flatMap((metro) =>
    metro.cities.flatMap((city) => city.zips.map((zip) => ({ metro, city, zip }))),
  );
  if (count > slots.length) {
    throw new RangeError(
      `cannot generate ${count} distinct locations from ${slots.length} city/ZIP combinations`,
    );
  }

  // Round-robin across metros first so every metro is represented, then take
  // the requested number from the front.
  const byMetro = METROS.map((metro) => slots.filter((slot) => slot.metro.name === metro.name));
  const ordered: typeof slots = [];
  for (let depth = 0; ordered.length < slots.length; depth++) {
    for (const group of byMetro) {
      const slot = group[depth];
      if (slot !== undefined) ordered.push(slot);
    }
  }

  return ordered.slice(0, count).map(({ metro, city, zip }, index) => {
    const opensAt = rng.pick(['07:30', '08:00', '08:30'] as const);
    const closesAt = rng.pick(['16:30', '17:00', '17:30'] as const);
    const saturdayOpen = rng.next() < 0.4;

    const name = `Cedar & Vale Dermatology — ${city.name}`;
    const slug = slugify(`cedar vale dermatology ${city.name} ${zip}`);

    const location: Location = {
      slug,
      name: `${name} (${zip})`,
      metro: metro.name,
      address: {
        street: `${rng.int(100, 9999)} ${faker.location.street()}`,
        city: city.name,
        state: metro.state,
        zip,
      },
      geo: {
        lat: round(metro.latRange[0] + rng.next() * (metro.latRange[1] - metro.latRange[0]), 4),
        lng: round(metro.lngRange[0] + rng.next() * (metro.lngRange[1] - metro.lngRange[0]), 4),
      },
      phone: `(${rng.int(200, 990)}) 555-${String(rng.int(1000, 9999))}`,
      hours: DAYS.map((day) => {
        if (day === 'sunday') return { day, opens: null, closes: null };
        if (day === 'saturday') {
          return saturdayOpen ? { day, opens: '09:00', closes: '13:00' } : { day, opens: null, closes: null };
        }
        return { day, opens: opensAt, closes: closesAt };
      }),
      acceptingNewPatients: rng.next() < 0.8,
      placeId: `cv-${slug}-${String(index + 1).padStart(3, '0')}`,
      openedDate: `${rng.int(2008, 2025)}-${String(rng.int(1, 13)).padStart(2, '0')}-01`,
      parking: rng.pick(PARKING),
      accessibility: rng.pick(ACCESSIBILITY),
    };

    return LocationSchema.parse(location);
  });
}
```

- [ ] **Step 5: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/generators/locations.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/reference/metros.ts cedar-vale-health-demo/scripts/src/generators/locations.ts cedar-vale-health-demo/scripts/src/generators/locations.test.ts
git commit -m "feat(cedar): metro reference data and deterministic locations generator"
```

Expected: PASS — 12 tests, clean typecheck. If the metro-coverage test fails, the round-robin ordering is wrong; do not fix it by raising `count`.

---

### Task 4: Providers generator (AI prose)

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/reference/specialties.ts`
- Create: `cedar-vale-health-demo/scripts/src/prompts/provider-prompts.ts`
- Create: `cedar-vale-health-demo/scripts/src/generators/providers.ts`
- Test: `cedar-vale-health-demo/scripts/src/generators/providers.test.ts`

**Interfaces:**
- Consumes: `Provider`, `ProviderSchema`, `slugify` from `../domain.js`; `Location` from `../domain.js`; `createRng`, `seededFaker`, and the `AiClient` type from `@canonical-demos/shared`.
- Produces:
  - `SPECIALTIES`, `CREDENTIALS`, `BOARD_CERTIFICATIONS`, `LANGUAGES` — readonly arrays in `reference/specialties.ts`
  - `buildProviderBioPrompt(input: { name: string; credentials: string; specialties: readonly string[]; city: string }): string` in `prompts/provider-prompts.ts`
  - `planProviders(seed: number, count: number, locations: readonly Location[]): ProviderPlan[]` where `ProviderPlan = { uid: string; slug: string; name: string; credentials: Provider['credentials']; specialties: string[]; boardCertifications: string[]; npi: string; licenseState: string; languages: string[]; acceptingNewPatients: boolean; locations: string[]; prompt: string }`
  - `finishProvider(plan: ProviderPlan, bio: string): Provider` — attaches the AI prose and returns a schema-validated record with `reviewStatus: 'unreviewed'` and null provenance; Task 9's relationship pass assigns reviewers.

The split matters: `planProviders` is pure and fully testable, and the only AI-dependent step is one call per plan. That shape is what lets `runGeneration` checkpoint per provider.

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/generators/providers.test.ts
import { describe, expect, it } from 'vitest';
import { ProviderSchema } from '../domain.js';
import { generateLocations } from './locations.js';
import { finishProvider, planProviders } from './providers.js';

const locations = generateLocations(20260809, 25);

describe('planProviders', () => {
  it('plans exactly the requested count', () => {
    expect(planProviders(20260809, 60, locations)).toHaveLength(60);
  });

  it('is deterministic for a given seed', () => {
    expect(planProviders(3, 60, locations)).toEqual(planProviders(3, 60, locations));
  });

  it('assigns unique slugs and unique uids', () => {
    const plans = planProviders(20260809, 60, locations);
    expect(new Set(plans.map((p) => p.slug)).size).toBe(60);
    expect(new Set(plans.map((p) => p.uid)).size).toBe(60);
  });

  it('assigns every provider at least one real location slug', () => {
    const known = new Set(locations.map((l) => l.slug));
    for (const plan of planProviders(20260809, 60, locations)) {
      expect(plan.locations.length).toBeGreaterThanOrEqual(1);
      for (const slug of plan.locations) expect(known.has(slug)).toBe(true);
    }
  });

  it('staffs every location with at least one provider', () => {
    const staffed = new Set(planProviders(20260809, 60, locations).flatMap((p) => p.locations));
    expect(staffed.size).toBe(locations.length);
  });

  it('issues a 10-digit NPI per provider, all distinct', () => {
    const plans = planProviders(20260809, 60, locations);
    for (const plan of plans) expect(plan.npi).toMatch(/^\d{10}$/);
    expect(new Set(plans.map((p) => p.npi)).size).toBe(60);
  });

  it('sets licenseState to the state of the provider first location', () => {
    const byslug = new Map(locations.map((l) => [l.slug, l]));
    for (const plan of planProviders(20260809, 60, locations)) {
      expect(plan.licenseState).toBe(byslug.get(plan.locations[0]!)!.address.state);
    }
  });

  it('builds a prompt naming the provider and their specialty', () => {
    const plan = planProviders(20260809, 60, locations)[0]!;
    expect(plan.prompt).toContain(plan.name);
    expect(plan.prompt).toContain(plan.specialties[0]!);
  });

  it('throws when there are no locations to staff', () => {
    expect(() => planProviders(1, 5, [])).toThrow(/at least one location/i);
  });
});

describe('finishProvider', () => {
  const plan = planProviders(20260809, 60, locations)[0]!;

  it('returns a record satisfying ProviderSchema', () => {
    const provider = finishProvider(plan, 'Dr. Example treats inflammatory skin disease.');
    expect(() => ProviderSchema.parse(provider)).not.toThrow();
  });

  it('ships unreviewed with null provenance — reviewers are assigned later', () => {
    const provider = finishProvider(plan, 'Bio text.');
    expect(provider.reviewStatus).toBe('unreviewed');
    expect(provider.bioReviewedBy).toBeNull();
    expect(provider.reviewDate).toBeNull();
  });

  it('trims the model bio', () => {
    expect(finishProvider(plan, '  Bio text.\n\n').bio).toBe('Bio text.');
  });

  it('rejects an empty bio rather than storing a blank record', () => {
    expect(() => finishProvider(plan, '   \n ')).toThrow(/bio/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/generators/providers.test.ts
```

Expected: FAIL — cannot resolve `./providers.js`.

- [ ] **Step 3: Write the reference data and the prompt builder**

```typescript
// cedar-vale-health-demo/scripts/src/reference/specialties.ts
export const SPECIALTIES = [
  'medical dermatology',
  'surgical dermatology',
  'cosmetic dermatology',
  'pediatric dermatology',
  'dermatopathology',
  'Mohs surgery',
  'phototherapy',
  'hair and scalp disorders',
] as const;

export const CREDENTIALS = ['MD', 'DO', 'PA-C', 'NP'] as const;

export const BOARD_CERTIFICATIONS = [
  'American Board of Dermatology',
  'American Osteopathic Board of Dermatology',
  'American Board of Dermatopathology',
] as const;

export const LANGUAGES = [
  'English',
  'Spanish',
  'Mandarin',
  'Vietnamese',
  'Tagalog',
  'Russian',
  'Amharic',
  'French',
] as const;
```

```typescript
// cedar-vale-health-demo/scripts/src/prompts/provider-prompts.ts
export interface ProviderBioInput {
  name: string;
  credentials: string;
  specialties: readonly string[];
  city: string;
}

export function buildProviderBioPrompt(input: ProviderBioInput): string {
  return [
    `Write a professional biography for ${input.name}, a ${input.credentials} practising`,
    `${input.specialties.join(' and ')} at a dermatology group in ${input.city}.`,
    '',
    'Requirements:',
    '- 90 to 130 words, third person, present tense.',
    '- Name the clinical interests concretely (conditions, procedures) rather than in generalities.',
    '- Mention approach to patient care in one sentence.',
    '- No invented awards, no invented publications, no invented institution names.',
    '- No headings, no bullet points, no honorific repetition. Prose only.',
    '- Do not restate the name in the first three words.',
  ].join('\n');
}
```

- [ ] **Step 4: Write the generator**

```typescript
// cedar-vale-health-demo/scripts/src/generators/providers.ts
import { createRng, seededFaker } from '@canonical-demos/shared';
import { ProviderSchema, slugify, type Location, type Provider } from '../domain.js';
import { buildProviderBioPrompt } from '../prompts/provider-prompts.js';
import {
  BOARD_CERTIFICATIONS,
  CREDENTIALS,
  LANGUAGES,
  SPECIALTIES,
} from '../reference/specialties.js';

export interface ProviderPlan {
  uid: string;
  slug: string;
  name: string;
  credentials: Provider['credentials'];
  specialties: string[];
  boardCertifications: string[];
  npi: string;
  licenseState: string;
  languages: string[];
  acceptingNewPatients: boolean;
  locations: string[];
  prompt: string;
}

export function planProviders(
  seed: number,
  count: number,
  locations: readonly Location[],
): ProviderPlan[] {
  if (locations.length === 0) throw new RangeError('providers need at least one location to staff');

  const rng = createRng(seed);
  const faker = seededFaker(seed);
  const usedSlugs = new Set<string>();
  const usedNpis = new Set<string>();
  const plans: ProviderPlan[] = [];

  for (let index = 0; index < count; index++) {
    const credentials = rng.pick(CREDENTIALS);
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const name = `${first} ${last}, ${credentials}`;

    let slug = slugify(name);
    let disambiguator = 2;
    while (usedSlugs.has(slug)) slug = `${slugify(name)}-${disambiguator++}`;
    usedSlugs.add(slug);

    let npi = String(rng.int(1_000_000_000, 2_000_000_000));
    while (usedNpis.has(npi)) npi = String(rng.int(1_000_000_000, 2_000_000_000));
    usedNpis.add(npi);

    // The first `locations.length` providers each anchor a distinct location, so no
    // location is left unstaffed; later providers are placed at random.
    const primary =
      index < locations.length ? locations[index]! : locations[rng.int(0, locations.length)]!;
    const extra =
      rng.next() < 0.25 && locations.length > 1
        ? [locations[rng.int(0, locations.length)]!.slug]
        : [];
    const assigned = [primary.slug, ...extra.filter((s) => s !== primary.slug)];

    const specialties = rng.shuffle(SPECIALTIES).slice(0, rng.int(1, 3));
    const languages = ['English', ...rng.shuffle(LANGUAGES.filter((l) => l !== 'English')).slice(0, rng.int(0, 2))];

    plans.push({
      uid: `provider:${slug}`,
      slug,
      name,
      credentials,
      specialties,
      boardCertifications:
        credentials === 'MD' || credentials === 'DO' ? [rng.pick(BOARD_CERTIFICATIONS)] : [],
      npi,
      licenseState: primary.address.state,
      languages,
      acceptingNewPatients: rng.next() < 0.75,
      locations: assigned,
      prompt: buildProviderBioPrompt({
        name,
        credentials,
        specialties,
        city: primary.address.city,
      }),
    });
  }

  return plans;
}

export function finishProvider(plan: ProviderPlan, bio: string): Provider {
  const trimmed = bio.trim();
  if (trimmed === '') throw new Error(`empty bio returned for provider "${plan.slug}"`);

  return ProviderSchema.parse({
    slug: plan.slug,
    name: plan.name,
    credentials: plan.credentials,
    specialties: plan.specialties,
    boardCertifications: plan.boardCertifications,
    npi: plan.npi,
    licenseState: plan.licenseState,
    languages: plan.languages,
    bio: trimmed,
    acceptingNewPatients: plan.acceptingNewPatients,
    locations: plan.locations,
    bioReviewedBy: null,
    reviewDate: null,
    reviewStatus: 'unreviewed',
  });
}
```

- [ ] **Step 5: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/generators/providers.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/reference/specialties.ts cedar-vale-health-demo/scripts/src/prompts/provider-prompts.ts cedar-vale-health-demo/scripts/src/generators/providers.ts cedar-vale-health-demo/scripts/src/generators/providers.test.ts
git commit -m "feat(cedar): providers generator with plan/finish split for checkpointing"
```

Expected: PASS — 13 tests, clean typecheck.

---

### Task 5: Treatment and condition catalogs

Both clinical types draw from fixed catalogs rather than invented names, because ICD-10 codes and procedure names must be real to survive a demo audience that includes clinicians.

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/reference/catalogs.ts`
- Test: `cedar-vale-health-demo/scripts/src/reference/catalogs.test.ts`

**Interfaces:**
- Consumes: `slugify` from `../domain.js`.
- Produces:
  - `CONDITION_CATALOG: readonly ConditionEntry[]` where `ConditionEntry = { name: string; icd10: string; category: string; bodyAreas: readonly string[]; symptoms: readonly string[] }` — **80 entries**
  - `TREATMENT_CATALOG: readonly TreatmentEntry[]` where `TreatmentEntry = { name: string; category: 'medical' | 'surgical' | 'cosmetic'; anesthesia: 'none' | 'topical' | 'local' | 'sedation'; treats: readonly string[]; insuranceCovered: boolean; fdaStatus: string | null }` — **45 entries**; `treats` holds condition **names** which Task 6 resolves to slugs
  - `conditionSlug(name: string): string` and `treatmentSlug(name: string): string` — thin wrappers over `slugify` so both catalogs and generators agree

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/reference/catalogs.test.ts
import { describe, expect, it } from 'vitest';
import { CONDITION_CATALOG, TREATMENT_CATALOG, conditionSlug } from './catalogs.js';

describe('CONDITION_CATALOG', () => {
  it('holds exactly the 80 conditions the manifest declares', () => {
    expect(CONDITION_CATALOG).toHaveLength(80);
  });

  it('has unique names and unique slugs', () => {
    expect(new Set(CONDITION_CATALOG.map((c) => c.name)).size).toBe(80);
    expect(new Set(CONDITION_CATALOG.map((c) => conditionSlug(c.name))).size).toBe(80);
  });

  it('gives every condition an ICD-10-shaped code', () => {
    for (const condition of CONDITION_CATALOG) {
      expect(condition.icd10, condition.name).toMatch(/^[A-Z]\d{2}(\.\d{1,2})?$/);
    }
  });

  it('gives every condition at least one body area and one symptom', () => {
    for (const condition of CONDITION_CATALOG) {
      expect(condition.bodyAreas.length, condition.name).toBeGreaterThanOrEqual(1);
      expect(condition.symptoms.length, condition.name).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('TREATMENT_CATALOG', () => {
  it('holds exactly the 45 treatments the manifest declares', () => {
    expect(TREATMENT_CATALOG).toHaveLength(45);
  });

  it('has unique names', () => {
    expect(new Set(TREATMENT_CATALOG.map((t) => t.name)).size).toBe(45);
  });

  it('treats only conditions that exist in the condition catalog', () => {
    const known = new Set(CONDITION_CATALOG.map((c) => c.name));
    for (const treatment of TREATMENT_CATALOG) {
      expect(treatment.treats.length, treatment.name).toBeGreaterThanOrEqual(1);
      for (const condition of treatment.treats) {
        expect(known.has(condition), `${treatment.name} -> ${condition}`).toBe(true);
      }
    }
  });

  it('covers all three treatment categories', () => {
    expect(new Set(TREATMENT_CATALOG.map((t) => t.category))).toEqual(
      new Set(['medical', 'surgical', 'cosmetic']),
    );
  });

  it('marks cosmetic treatments as not insurance-covered', () => {
    for (const treatment of TREATMENT_CATALOG.filter((t) => t.category === 'cosmetic')) {
      expect(treatment.insuranceCovered, treatment.name).toBe(false);
    }
  });

  it('leaves fdaStatus null rather than inventing one where none applies', () => {
    expect(TREATMENT_CATALOG.some((t) => t.fdaStatus === null)).toBe(true);
  });

  it('ensures every condition is treatable by at least one treatment', () => {
    const treated = new Set(TREATMENT_CATALOG.flatMap((t) => t.treats));
    const untreated = CONDITION_CATALOG.filter((c) => !treated.has(c.name)).map((c) => c.name);
    expect(untreated, `conditions with no treatment: ${untreated.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/reference/catalogs.test.ts
```

Expected: FAIL — cannot resolve `./catalogs.js`.

- [ ] **Step 3: Write the catalogs**

Write `cedar-vale-health-demo/scripts/src/reference/catalogs.ts` with this exact structure. Populate **80** condition entries and **45** treatment entries using real dermatologic conditions and real ICD-10 codes; the entries below are the first of each and set the shape. Every treatment's `treats` array must name conditions that appear in `CONDITION_CATALOG`, and — per the last test — every condition must be named by at least one treatment.

```typescript
// cedar-vale-health-demo/scripts/src/reference/catalogs.ts
import { slugify } from '../domain.js';

export interface ConditionEntry {
  readonly name: string;
  readonly icd10: string;
  readonly category: string;
  readonly bodyAreas: readonly string[];
  readonly symptoms: readonly string[];
}

export interface TreatmentEntry {
  readonly name: string;
  readonly category: 'medical' | 'surgical' | 'cosmetic';
  readonly anesthesia: 'none' | 'topical' | 'local' | 'sedation';
  /** Condition NAMES, resolved to slugs by the conditions/treatments generators. */
  readonly treats: readonly string[];
  readonly insuranceCovered: boolean;
  readonly fdaStatus: string | null;
}

export const conditionSlug = (name: string): string => slugify(name);
export const treatmentSlug = (name: string): string => slugify(name);

export const CONDITION_CATALOG: readonly ConditionEntry[] = [
  {
    name: 'Acne Vulgaris',
    icd10: 'L70.0',
    category: 'inflammatory',
    bodyAreas: ['face', 'chest', 'back'],
    symptoms: ['comedones', 'inflammatory papules', 'pustules', 'scarring'],
  },
  {
    name: 'Atopic Dermatitis',
    icd10: 'L20.9',
    category: 'inflammatory',
    bodyAreas: ['flexural surfaces', 'hands', 'face'],
    symptoms: ['pruritus', 'erythema', 'lichenification', 'weeping'],
  },
  {
    name: 'Plaque Psoriasis',
    icd10: 'L40.0',
    category: 'inflammatory',
    bodyAreas: ['elbows', 'knees', 'scalp', 'trunk'],
    symptoms: ['scaly plaques', 'pruritus', 'nail pitting'],
  },
  {
    name: 'Basal Cell Carcinoma',
    icd10: 'C44.91',
    category: 'neoplastic',
    bodyAreas: ['face', 'ears', 'scalp'],
    symptoms: ['pearly papule', 'non-healing ulcer', 'telangiectasia'],
  },
  // ... continue to 80 entries total, spanning at minimum these categories:
  // inflammatory, neoplastic, infectious, autoimmune, pigmentary, hair and nail,
  // vascular, and pediatric.
];

export const TREATMENT_CATALOG: readonly TreatmentEntry[] = [
  {
    name: 'Mohs Surgery',
    category: 'surgical',
    anesthesia: 'local',
    treats: ['Basal Cell Carcinoma'],
    insuranceCovered: true,
    fdaStatus: null,
  },
  {
    name: 'Topical Retinoid Therapy',
    category: 'medical',
    anesthesia: 'none',
    treats: ['Acne Vulgaris'],
    insuranceCovered: true,
    fdaStatus: 'FDA approved',
  },
  {
    name: 'Narrowband UVB Phototherapy',
    category: 'medical',
    anesthesia: 'none',
    treats: ['Plaque Psoriasis', 'Atopic Dermatitis'],
    insuranceCovered: true,
    fdaStatus: 'FDA cleared device',
  },
  {
    name: 'Botulinum Toxin Injection',
    category: 'cosmetic',
    anesthesia: 'topical',
    treats: ['Acne Vulgaris'],
    insuranceCovered: false,
    fdaStatus: 'FDA approved',
  },
  // ... continue to 45 entries total, across medical, surgical and cosmetic,
  // such that every one of the 80 conditions is named by at least one treatment.
];
```

- [ ] **Step 4: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/reference/catalogs.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/reference/catalogs.ts cedar-vale-health-demo/scripts/src/reference/catalogs.test.ts
git commit -m "feat(cedar): condition and treatment catalogs with real ICD-10 codes"
```

Expected: PASS — 12 tests. The coverage test (`every condition is treatable`) is the one most likely to fail while populating; it names the offending conditions, so add treatments until it is empty rather than trimming the condition list.

---

### Task 6: Conditions and treatments generators (AI prose)

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/prompts/clinical-prompts.ts`
- Create: `cedar-vale-health-demo/scripts/src/generators/conditions.ts`
- Create: `cedar-vale-health-demo/scripts/src/generators/treatments.ts`
- Test: `cedar-vale-health-demo/scripts/src/generators/clinical.test.ts`

**Interfaces:**
- Consumes: `CONDITION_CATALOG`, `TREATMENT_CATALOG`, `conditionSlug`, `treatmentSlug` from `../reference/catalogs.js` (Task 5); `Condition`, `Treatment`, `ConditionSchema`, `TreatmentSchema`, `Location` from `../domain.js`; `createRng` from `@canonical-demos/shared`.
- Produces:
  - `buildConditionPrompt(entry: ConditionEntry): string` and `buildTreatmentPrompt(entry: TreatmentEntry): string`
  - `planConditions(seed: number): ConditionPlan[]` where `ConditionPlan = { uid: string; slug: string; entry: ConditionEntry; relatedTreatments: string[]; prompt: string }`
  - `finishCondition(plan: ConditionPlan, description: string): Condition`
  - `planTreatments(seed: number, locations: readonly Location[]): TreatmentPlan[]` where `TreatmentPlan = { uid: string; slug: string; entry: TreatmentEntry; conditionsTreated: string[]; typicalDurationMinutes: number; downtimeDays: number; priceRangeByLocation: Array<{ location: string; low: number; high: number }>; prompt: string }`
  - `finishTreatment(plan: TreatmentPlan, description: string): Treatment`

Counts come from the catalogs, not from arguments — the catalogs are sized to the manifest and Task 5 pins that.

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/generators/clinical.test.ts
import { describe, expect, it } from 'vitest';
import { ConditionSchema, TreatmentSchema } from '../domain.js';
import { CONDITION_CATALOG, TREATMENT_CATALOG, conditionSlug } from '../reference/catalogs.js';
import { finishCondition, planConditions } from './conditions.js';
import { generateLocations } from './locations.js';
import { finishTreatment, planTreatments } from './treatments.js';

const locations = generateLocations(20260809, 25);

describe('planConditions', () => {
  it('plans one per catalog entry', () => {
    expect(planConditions(20260809)).toHaveLength(CONDITION_CATALOG.length);
  });

  it('is deterministic', () => {
    expect(planConditions(5)).toEqual(planConditions(5));
  });

  it('links each condition only to treatments that actually treat it', () => {
    for (const plan of planConditions(20260809)) {
      const expected = TREATMENT_CATALOG.filter((t) => t.treats.includes(plan.entry.name));
      expect(plan.relatedTreatments.length).toBe(expected.length);
    }
  });

  it('builds a prompt naming the condition and its ICD-10 code', () => {
    const plan = planConditions(20260809)[0]!;
    expect(plan.prompt).toContain(plan.entry.name);
    expect(plan.prompt).toContain(plan.entry.icd10);
  });
});

describe('finishCondition', () => {
  it('returns a record satisfying ConditionSchema', () => {
    const plan = planConditions(20260809)[0]!;
    const condition = finishCondition(plan, 'Acne vulgaris is a chronic inflammatory disorder.');
    expect(() => ConditionSchema.parse(condition)).not.toThrow();
    expect(condition.slug).toBe(conditionSlug(plan.entry.name));
  });

  it('ships unreviewed with null provenance', () => {
    const condition = finishCondition(planConditions(20260809)[0]!, 'Text.');
    expect(condition.reviewStatus).toBe('unreviewed');
    expect(condition.reviewedBy).toBeNull();
  });

  it('rejects an empty description', () => {
    expect(() => finishCondition(planConditions(20260809)[0]!, '  ')).toThrow(/description/i);
  });
});

describe('planTreatments', () => {
  it('plans one per catalog entry', () => {
    expect(planTreatments(20260809, locations)).toHaveLength(TREATMENT_CATALOG.length);
  });

  it('is deterministic', () => {
    expect(planTreatments(9, locations)).toEqual(planTreatments(9, locations));
  });

  it('prices every treatment at every location', () => {
    for (const plan of planTreatments(20260809, locations)) {
      expect(plan.priceRangeByLocation).toHaveLength(locations.length);
      for (const range of plan.priceRangeByLocation) expect(range.low).toBeLessThanOrEqual(range.high);
    }
  });

  it('resolves treated conditions to slugs that exist', () => {
    const known = new Set(CONDITION_CATALOG.map((c) => conditionSlug(c.name)));
    for (const plan of planTreatments(20260809, locations)) {
      expect(plan.conditionsTreated.length).toBeGreaterThanOrEqual(1);
      for (const slug of plan.conditionsTreated) expect(known.has(slug)).toBe(true);
    }
  });

  it('gives surgical treatments longer durations than topical medical ones', () => {
    const plans = planTreatments(20260809, locations);
    const surgical = plans.filter((p) => p.entry.category === 'surgical');
    for (const plan of surgical) expect(plan.typicalDurationMinutes).toBeGreaterThanOrEqual(45);
  });

  it('throws with no locations, since prices are per location', () => {
    expect(() => planTreatments(1, [])).toThrow(/at least one location/i);
  });
});

describe('finishTreatment', () => {
  it('returns a record satisfying TreatmentSchema', () => {
    const plan = planTreatments(20260809, locations)[0]!;
    const treatment = finishTreatment(plan, 'Mohs surgery removes cancer layer by layer.');
    expect(() => TreatmentSchema.parse(treatment)).not.toThrow();
  });

  it('carries the catalog insuranceCovered and fdaStatus through unchanged', () => {
    const plan = planTreatments(20260809, locations)[0]!;
    const treatment = finishTreatment(plan, 'Text.');
    expect(treatment.insuranceCovered).toBe(plan.entry.insuranceCovered);
    expect(treatment.fdaStatus).toBe(plan.entry.fdaStatus);
  });

  it('rejects an empty description', () => {
    expect(() => finishTreatment(planTreatments(20260809, locations)[0]!, '\n')).toThrow(/description/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/generators/clinical.test.ts
```

Expected: FAIL — cannot resolve `./conditions.js`.

- [ ] **Step 3: Write the prompt builders**

```typescript
// cedar-vale-health-demo/scripts/src/prompts/clinical-prompts.ts
import type { ConditionEntry, TreatmentEntry } from '../reference/catalogs.js';

export function buildConditionPrompt(entry: ConditionEntry): string {
  return [
    `Write patient-facing educational copy about ${entry.name} (ICD-10 ${entry.icd10}).`,
    '',
    `Affected areas: ${entry.bodyAreas.join(', ')}.`,
    `Common signs: ${entry.symptoms.join(', ')}.`,
    '',
    'Requirements:',
    '- 160 to 220 words, plain language a patient can follow, second person where natural.',
    '- Cover what it is, what it looks like, and when to see a dermatologist.',
    '- No treatment recommendations, no dosages, no prognosis claims.',
    '- No headings, no bullet points, no disclaimers. Prose only.',
  ].join('\n');
}

export function buildTreatmentPrompt(entry: TreatmentEntry): string {
  return [
    `Write patient-facing educational copy about ${entry.name}, a ${entry.category} dermatologic procedure.`,
    '',
    `Anesthesia: ${entry.anesthesia}.`,
    `Used for: ${entry.treats.join(', ')}.`,
    '',
    'Requirements:',
    '- 150 to 200 words, plain language, second person where natural.',
    '- Cover what happens during the procedure and what recovery involves.',
    '- Do not state prices, do not promise outcomes, do not give dosages.',
    '- No headings, no bullet points, no disclaimers. Prose only.',
  ].join('\n');
}
```

- [ ] **Step 4: Write both generators**

```typescript
// cedar-vale-health-demo/scripts/src/generators/conditions.ts
import { createRng } from '@canonical-demos/shared';
import { ConditionSchema, type Condition } from '../domain.js';
import { buildConditionPrompt } from '../prompts/clinical-prompts.js';
import {
  CONDITION_CATALOG,
  TREATMENT_CATALOG,
  conditionSlug,
  treatmentSlug,
  type ConditionEntry,
} from '../reference/catalogs.js';

export interface ConditionPlan {
  uid: string;
  slug: string;
  entry: ConditionEntry;
  relatedTreatments: string[];
  prompt: string;
}

export function planConditions(seed: number): ConditionPlan[] {
  // The rng is constructed for symmetry with the other planners and to keep the
  // signature stable if condition ordering ever needs shuffling.
  createRng(seed);

  return CONDITION_CATALOG.map((entry) => ({
    uid: `condition:${conditionSlug(entry.name)}`,
    slug: conditionSlug(entry.name),
    entry,
    relatedTreatments: TREATMENT_CATALOG.filter((t) => t.treats.includes(entry.name)).map((t) =>
      treatmentSlug(t.name),
    ),
    prompt: buildConditionPrompt(entry),
  }));
}

export function finishCondition(plan: ConditionPlan, description: string): Condition {
  const trimmed = description.trim();
  if (trimmed === '') throw new Error(`empty description returned for condition "${plan.slug}"`);

  return ConditionSchema.parse({
    slug: plan.slug,
    name: plan.entry.name,
    icd10: plan.entry.icd10,
    category: plan.entry.category,
    bodyAreas: [...plan.entry.bodyAreas],
    symptoms: [...plan.entry.symptoms],
    relatedTreatments: plan.relatedTreatments,
    description: trimmed,
    reviewedBy: null,
    reviewDate: null,
    reviewStatus: 'unreviewed',
  });
}
```

```typescript
// cedar-vale-health-demo/scripts/src/generators/treatments.ts
import { createRng } from '@canonical-demos/shared';
import { TreatmentSchema, type Location, type Treatment } from '../domain.js';
import { buildTreatmentPrompt } from '../prompts/clinical-prompts.js';
import {
  TREATMENT_CATALOG,
  conditionSlug,
  treatmentSlug,
  type TreatmentEntry,
} from '../reference/catalogs.js';

export interface TreatmentPlan {
  uid: string;
  slug: string;
  entry: TreatmentEntry;
  conditionsTreated: string[];
  typicalDurationMinutes: number;
  downtimeDays: number;
  priceRangeByLocation: Array<{ location: string; low: number; high: number }>;
  prompt: string;
}

const DURATION_BY_CATEGORY = {
  medical: [10, 30] as const,
  surgical: [45, 240] as const,
  cosmetic: [20, 90] as const,
};

const DOWNTIME_BY_CATEGORY = {
  medical: [0, 2] as const,
  surgical: [3, 21] as const,
  cosmetic: [0, 7] as const,
};

const BASE_PRICE_BY_CATEGORY = {
  medical: [80, 400] as const,
  surgical: [900, 4200] as const,
  cosmetic: [250, 1800] as const,
};

export function planTreatments(seed: number, locations: readonly Location[]): TreatmentPlan[] {
  if (locations.length === 0) {
    throw new RangeError('treatments need at least one location, since prices are per location');
  }
  const rng = createRng(seed);

  return TREATMENT_CATALOG.map((entry) => {
    const [durLow, durHigh] = DURATION_BY_CATEGORY[entry.category];
    const [downLow, downHigh] = DOWNTIME_BY_CATEGORY[entry.category];
    const [priceLow, priceHigh] = BASE_PRICE_BY_CATEGORY[entry.category];

    const base = rng.int(priceLow, priceHigh);

    return {
      uid: `treatment:${treatmentSlug(entry.name)}`,
      slug: treatmentSlug(entry.name),
      entry,
      conditionsTreated: entry.treats.map((name) => conditionSlug(name)),
      typicalDurationMinutes: rng.int(durLow, durHigh + 1),
      downtimeDays: rng.int(downLow, downHigh + 1),
      // Each location varies from the national base by up to ±20%, so the demo can
      // show per-location pricing without any location looking arbitrary.
      priceRangeByLocation: locations.map((location) => {
        const centre = Math.round(base * (0.8 + rng.next() * 0.4));
        return { location: location.slug, low: centre, high: Math.round(centre * 1.6) };
      }),
      prompt: buildTreatmentPrompt(entry),
    };
  });
}

export function finishTreatment(plan: TreatmentPlan, description: string): Treatment {
  const trimmed = description.trim();
  if (trimmed === '') throw new Error(`empty description returned for treatment "${plan.slug}"`);

  return TreatmentSchema.parse({
    slug: plan.slug,
    name: plan.entry.name,
    category: plan.entry.category,
    conditionsTreated: plan.conditionsTreated,
    typicalDurationMinutes: plan.typicalDurationMinutes,
    anesthesia: plan.entry.anesthesia,
    downtimeDays: plan.downtimeDays,
    insuranceCovered: plan.entry.insuranceCovered,
    fdaStatus: plan.entry.fdaStatus,
    description: trimmed,
    priceRangeByLocation: plan.priceRangeByLocation,
    reviewedBy: null,
    reviewDate: null,
    reviewStatus: 'unreviewed',
  });
}
```

- [ ] **Step 5: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/generators/clinical.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/prompts/clinical-prompts.ts cedar-vale-health-demo/scripts/src/generators/conditions.ts cedar-vale-health-demo/scripts/src/generators/treatments.ts cedar-vale-health-demo/scripts/src/generators/clinical.test.ts
git commit -m "feat(cedar): conditions and treatments generators over the clinical catalogs"
```

Expected: PASS — 14 tests, clean typecheck.

---

### Task 7: Patient-education posts generator (two tiers)

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/prompts/post-prompts.ts`
- Create: `cedar-vale-health-demo/scripts/src/generators/posts.ts`
- Test: `cedar-vale-health-demo/scripts/src/generators/posts.test.ts`

**Interfaces:**
- Consumes: `PatientPost`, `PatientPostSchema`, `slugify` from `../domain.js`; `Condition`, `Treatment` from `../domain.js`; `createRng`, `seededFaker` from `@canonical-demos/shared`.
- Produces:
  - `buildPostPrompt(input: { angle: string; subject: string; readingLevel: PatientPost['readingLevel'] }): string`
  - `planPosts(seed: number, heroCount: number, compositeCount: number, conditions: readonly Condition[], treatments: readonly Treatment[]): PostPlan[]` where `PostPlan = { uid: string; slug: string; title: string; tier: 'hero' | 'composite'; conditionFocus: string | null; treatmentFocus: string | null; readingLevel: PatientPost['readingLevel']; internalLinks: string[]; prompt: string | null; subject: string; angle: string }` — `prompt` is `null` for composite plans, which need no AI call; `subject` and `angle` are carried so the composite builder can name its topic without a second lookup
  - `finishHeroPost(plan: PostPlan, content: string): PatientPost`
  - `buildCompositePost(plan: PostPlan, seed: number): PatientPost` — assembles prose from templates plus real entity names; no AI

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/generators/posts.test.ts
import { describe, expect, it } from 'vitest';
import { PatientPostSchema } from '../domain.js';
import { finishCondition, planConditions } from './conditions.js';
import { generateLocations } from './locations.js';
import { buildCompositePost, finishHeroPost, planPosts } from './posts.js';
import { finishTreatment, planTreatments } from './treatments.js';

const locations = generateLocations(20260809, 25);
const conditions = planConditions(20260809).map((p) => finishCondition(p, 'Condition copy.'));
const treatments = planTreatments(20260809, locations).map((p) => finishTreatment(p, 'Treatment copy.'));

const plans = planPosts(20260809, 215, 385, conditions, treatments);

describe('planPosts', () => {
  it('plans exactly the manifest split', () => {
    expect(plans).toHaveLength(600);
    expect(plans.filter((p) => p.tier === 'hero')).toHaveLength(215);
    expect(plans.filter((p) => p.tier === 'composite')).toHaveLength(385);
  });

  it('is deterministic', () => {
    expect(planPosts(4, 10, 10, conditions, treatments)).toEqual(
      planPosts(4, 10, 10, conditions, treatments),
    );
  });

  it('assigns unique slugs and uids across both tiers', () => {
    expect(new Set(plans.map((p) => p.slug)).size).toBe(600);
    expect(new Set(plans.map((p) => p.uid)).size).toBe(600);
  });

  it('gives hero plans a prompt and composite plans none', () => {
    for (const plan of plans) {
      if (plan.tier === 'hero') expect(plan.prompt).toBeTruthy();
      else expect(plan.prompt).toBeNull();
    }
  });

  it('focuses every post on a real condition or a real treatment', () => {
    const conditionSlugs = new Set(conditions.map((c) => c.slug));
    const treatmentSlugs = new Set(treatments.map((t) => t.slug));
    for (const plan of plans) {
      const hasFocus = plan.conditionFocus !== null || plan.treatmentFocus !== null;
      expect(hasFocus, plan.slug).toBe(true);
      if (plan.conditionFocus !== null) expect(conditionSlugs.has(plan.conditionFocus)).toBe(true);
      if (plan.treatmentFocus !== null) expect(treatmentSlugs.has(plan.treatmentFocus)).toBe(true);
    }
  });

  it('links only to slugs that exist', () => {
    const known = new Set([...conditions.map((c) => c.slug), ...treatments.map((t) => t.slug)]);
    for (const plan of plans) for (const link of plan.internalLinks) expect(known.has(link)).toBe(true);
  });

  it('gives every condition at least one post', () => {
    const covered = new Set(plans.map((p) => p.conditionFocus).filter((s): s is string => s !== null));
    expect(covered.size).toBe(conditions.length);
  });

  it('throws when there is nothing to write about', () => {
    expect(() => planPosts(1, 5, 5, [], [])).toThrow(/conditions or treatments/i);
  });
});

describe('finishHeroPost', () => {
  const heroPlan = plans.find((p) => p.tier === 'hero')!;

  it('returns a record satisfying PatientPostSchema', () => {
    const post = finishHeroPost(heroPlan, 'A long-form patient education article body.');
    expect(() => PatientPostSchema.parse(post)).not.toThrow();
    expect(post.tier).toBe('hero');
  });

  it('derives an excerpt from the content rather than leaving it blank', () => {
    const post = finishHeroPost(heroPlan, 'First sentence here. Second sentence follows.');
    expect(post.excerpt.length).toBeGreaterThan(0);
    expect(post.content).toContain(post.excerpt.replace(/…$/, '').trim().slice(0, 20));
  });

  it('rejects empty content', () => {
    expect(() => finishHeroPost(heroPlan, '   ')).toThrow(/content/i);
  });

  it('refuses a composite plan', () => {
    const compositePlan = plans.find((p) => p.tier === 'composite')!;
    expect(() => finishHeroPost(compositePlan, 'Body.')).toThrow(/composite/i);
  });
});

describe('buildCompositePost', () => {
  const compositePlan = plans.find((p) => p.tier === 'composite')!;

  it('returns a record satisfying PatientPostSchema with no AI call', () => {
    const post = buildCompositePost(compositePlan, 20260809);
    expect(() => PatientPostSchema.parse(post)).not.toThrow();
    expect(post.tier).toBe('composite');
  });

  it('is deterministic for a given seed', () => {
    expect(buildCompositePost(compositePlan, 11)).toEqual(buildCompositePost(compositePlan, 11));
  });

  it('names its focus subject in the body so the prose is not generic', () => {
    const post = buildCompositePost(compositePlan, 20260809);
    expect(post.content.length).toBeGreaterThan(200);
    expect(post.title.length).toBeGreaterThan(0);
  });

  it('refuses a hero plan', () => {
    const heroPlan = plans.find((p) => p.tier === 'hero')!;
    expect(() => buildCompositePost(heroPlan, 1)).toThrow(/hero/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/generators/posts.test.ts
```

Expected: FAIL — cannot resolve `./posts.js`.

- [ ] **Step 3: Write the prompt builder**

```typescript
// cedar-vale-health-demo/scripts/src/prompts/post-prompts.ts
import type { PatientPost } from '../domain.js';

export const POST_ANGLES = [
  'what to expect at your first appointment for',
  'how to tell whether you should see a dermatologist about',
  'daily skin care habits that help with',
  'common myths about',
  'questions worth asking your dermatologist about',
  'how seasons and climate affect',
  'what recent guidance says about',
] as const;

const LEVEL_GUIDANCE: Record<PatientPost['readingLevel'], string> = {
  plain: 'Write for a sixth-grade reading level. Short sentences. Define any clinical term you use.',
  standard: 'Write for a general adult audience. Clinical terms are fine if you explain them once.',
  clinical: 'Write for a health-literate reader. Clinical vocabulary is expected; still avoid jargon for its own sake.',
};

export function buildPostPrompt(input: {
  angle: string;
  subject: string;
  readingLevel: PatientPost['readingLevel'];
}): string {
  return [
    `Write a patient-education article: ${input.angle} ${input.subject}.`,
    '',
    LEVEL_GUIDANCE[input.readingLevel],
    '',
    'Requirements:',
    '- 320 to 450 words of prose.',
    '- Open with the reader situation, not a definition.',
    '- No dosages, no specific prices, no promises about outcomes.',
    '- Close by pointing the reader to a dermatologist rather than to a product.',
    '- No headings, no bullet points, no disclaimers, no title line. Body prose only.',
  ].join('\n');
}
```

- [ ] **Step 4: Write the generator**

```typescript
// cedar-vale-health-demo/scripts/src/generators/posts.ts
import { createRng, seededFaker } from '@canonical-demos/shared';
import {
  PatientPostSchema,
  slugify,
  type Condition,
  type PatientPost,
  type Treatment,
} from '../domain.js';
import { POST_ANGLES, buildPostPrompt } from '../prompts/post-prompts.js';

export interface PostPlan {
  uid: string;
  slug: string;
  title: string;
  tier: 'hero' | 'composite';
  conditionFocus: string | null;
  treatmentFocus: string | null;
  readingLevel: PatientPost['readingLevel'];
  internalLinks: string[];
  /** null for composite plans, which are assembled without an AI call. */
  prompt: string | null;
  /** Carried so the composite builder can name its subject without another lookup. */
  subject: string;
  angle: string;
}

const READING_LEVELS: readonly PatientPost['readingLevel'][] = ['plain', 'standard', 'clinical'];

export function planPosts(
  seed: number,
  heroCount: number,
  compositeCount: number,
  conditions: readonly Condition[],
  treatments: readonly Treatment[],
): PostPlan[] {
  if (conditions.length === 0 && treatments.length === 0) {
    throw new RangeError('posts need conditions or treatments to write about');
  }

  const rng = createRng(seed);
  const total = heroCount + compositeCount;
  const usedSlugs = new Set<string>();
  const plans: PostPlan[] = [];

  for (let index = 0; index < total; index++) {
    // Cover every condition before repeating any, so no condition is postless.
    const useCondition = conditions.length > 0 && (index < conditions.length || rng.next() < 0.7);
    const condition = useCondition ? conditions[index % conditions.length]! : null;
    const treatment = useCondition ? null : treatments[index % Math.max(1, treatments.length)] ?? null;

    const subject = condition?.name ?? treatment?.name ?? '';
    const angle = rng.pick(POST_ANGLES);
    const title = `${angle.charAt(0).toUpperCase()}${angle.slice(1)} ${subject}`;

    let slug = slugify(title);
    let disambiguator = 2;
    while (usedSlugs.has(slug)) slug = `${slugify(title)}-${disambiguator++}`;
    usedSlugs.add(slug);

    const tier: 'hero' | 'composite' = index < heroCount ? 'hero' : 'composite';
    const readingLevel = rng.pick(READING_LEVELS);

    const linkPool = [
      ...(condition?.relatedTreatments ?? []),
      ...(treatment?.conditionsTreated ?? []),
    ];
    const internalLinks = rng.shuffle(linkPool).slice(0, Math.min(3, linkPool.length));

    plans.push({
      uid: `post:${slug}`,
      slug,
      title,
      tier,
      conditionFocus: condition?.slug ?? null,
      treatmentFocus: treatment?.slug ?? null,
      readingLevel,
      internalLinks,
      prompt: tier === 'hero' ? buildPostPrompt({ angle, subject, readingLevel }) : null,
      subject,
      angle,
    });
  }

  return plans;
}

function excerptFrom(content: string): string {
  const firstSentence = content.trim().split(/(?<=[.!?])\s/)[0] ?? content.trim();
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157).trimEnd()}…` : firstSentence;
}

export function finishHeroPost(plan: PostPlan, content: string): PatientPost {
  if (plan.tier !== 'hero') {
    throw new Error(`finishHeroPost called with a composite plan "${plan.slug}"`);
  }
  const trimmed = content.trim();
  if (trimmed === '') throw new Error(`empty content returned for post "${plan.slug}"`);

  return PatientPostSchema.parse({
    slug: plan.slug,
    title: plan.title,
    content: trimmed,
    excerpt: excerptFrom(trimmed),
    tier: 'hero',
    conditionFocus: plan.conditionFocus,
    treatmentFocus: plan.treatmentFocus,
    readingLevel: plan.readingLevel,
    internalLinks: plan.internalLinks,
    reviewedBy: null,
    reviewDate: null,
    reviewStatus: 'unreviewed',
  });
}

const COMPOSITE_PARAGRAPHS = [
  (s: string) =>
    `Patients ask about ${s} more often than almost anything else our clinicians see in a week. The questions are usually practical: whether it will pass on its own, whether it is contagious, and whether it is worth taking time off work for an appointment.`,
  (s: string) =>
    `The honest answer is that ${s} varies a great deal from person to person. Two people with the same finding on the same part of the body can need quite different care, which is why an in-person look matters more than a photograph or a search result.`,
  (_s: string) =>
    `A dermatologist will usually start with your history — how long it has been there, whether it changed, what makes it better or worse — before examining the area itself. That conversation often narrows the possibilities faster than any test.`,
  (s: string) =>
    `If you are weighing whether to book an appointment about ${s}, the useful signals are change and persistence. Something new that keeps changing, or something familiar that stops responding to what used to work, is worth a professional look.`,
];

export function buildCompositePost(plan: PostPlan, seed: number): PatientPost {
  if (plan.tier !== 'composite') {
    throw new Error(`buildCompositePost called with a hero plan "${plan.slug}"`);
  }

  // Seeded per post so a composite corpus is reproducible without an AI call.
  const rng = createRng(seed + plan.slug.length);
  const faker = seededFaker(seed + plan.slug.length);
  const order = rng.shuffle(COMPOSITE_PARAGRAPHS);
  const body = order.map((paragraph) => paragraph(plan.subject)).join('\n\n');
  const closing = `Our dermatologists see ${plan.subject.toLowerCase()} at every one of our locations, and ${faker.helpers.arrayElement(['same-week', 'next-week', 'same-month'])} appointments are usually available.`;

  const content = `${body}\n\n${closing}`;

  return PatientPostSchema.parse({
    slug: plan.slug,
    title: plan.title,
    content,
    excerpt: excerptFrom(content),
    tier: 'composite',
    conditionFocus: plan.conditionFocus,
    treatmentFocus: plan.treatmentFocus,
    readingLevel: plan.readingLevel,
    internalLinks: plan.internalLinks,
    reviewedBy: null,
    reviewDate: null,
    reviewStatus: 'unreviewed',
  });
}
```

- [ ] **Step 5: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/generators/posts.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/prompts/post-prompts.ts cedar-vale-health-demo/scripts/src/generators/posts.ts cedar-vale-health-demo/scripts/src/generators/posts.test.ts
git commit -m "feat(cedar): two-tier patient-education post generator"
```

Expected: PASS — 16 tests, clean typecheck.

---

### Task 8: Insurance plans generator

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/reference/carriers.ts`
- Create: `cedar-vale-health-demo/scripts/src/generators/insurance.ts`
- Test: `cedar-vale-health-demo/scripts/src/generators/insurance.test.ts`

**Interfaces:**
- Consumes: `InsurancePlan`, `InsurancePlanSchema`, `slugify`, `Location` from `../domain.js`; `createRng` from `@canonical-demos/shared`.
- Produces:
  - `CARRIERS: readonly Carrier[]` where `Carrier = { name: string; planTypes: readonly InsurancePlan['planType'][] }`
  - `generateInsurancePlans(seed: number, count: number, locations: readonly Location[]): InsurancePlan[]`

The per-location acceptance is what makes the spec's "insurance mismatch → estimated denials and no-shows" metric computable, so acceptance must be genuinely uneven across locations — not all-or-nothing.

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/generators/insurance.test.ts
import { describe, expect, it } from 'vitest';
import { InsurancePlanSchema } from '../domain.js';
import { CARRIERS } from '../reference/carriers.js';
import { generateInsurancePlans } from './insurance.js';
import { generateLocations } from './locations.js';

const locations = generateLocations(20260809, 25);
const plans = generateInsurancePlans(20260809, 30, locations);

describe('CARRIERS', () => {
  it('offers enough carrier/plan-type combinations for 30 distinct plans', () => {
    const combinations = CARRIERS.reduce((sum, c) => sum + c.planTypes.length, 0);
    expect(combinations).toBeGreaterThanOrEqual(30);
  });
});

describe('generateInsurancePlans', () => {
  it('generates exactly the requested count', () => {
    expect(plans).toHaveLength(30);
  });

  it('produces records satisfying InsurancePlanSchema', () => {
    for (const plan of plans) expect(() => InsurancePlanSchema.parse(plan)).not.toThrow();
  });

  it('is deterministic', () => {
    expect(generateInsurancePlans(6, 30, locations)).toEqual(
      generateInsurancePlans(6, 30, locations),
    );
  });

  it('assigns unique slugs', () => {
    expect(new Set(plans.map((p) => p.slug)).size).toBe(30);
  });

  it('accepts each plan at a real subset of locations', () => {
    const known = new Set(locations.map((l) => l.slug));
    for (const plan of plans) {
      expect(plan.acceptedAt.length).toBeGreaterThanOrEqual(1);
      for (const slug of plan.acceptedAt) expect(known.has(slug)).toBe(true);
    }
  });

  it('varies acceptance across locations rather than accepting everything everywhere', () => {
    const counts = plans.map((p) => p.acceptedAt.length);
    expect(new Set(counts).size).toBeGreaterThan(1);
    expect(counts.some((c) => c < locations.length)).toBe(true);
  });

  it('leaves every location accepting at least one plan', () => {
    const accepted = new Set(plans.flatMap((p) => p.acceptedAt));
    expect(accepted.size).toBe(locations.length);
  });

  it('requires referrals only for HMO and POS plans', () => {
    for (const plan of plans) {
      if (plan.referralRequired) expect(['HMO', 'POS']).toContain(plan.planType);
    }
  });

  it('throws with no locations to accept at', () => {
    expect(() => generateInsurancePlans(1, 5, [])).toThrow(/at least one location/i);
  });

  it('throws when asked for more plans than distinct combinations exist', () => {
    expect(() => generateInsurancePlans(1, 500, locations)).toThrow(/distinct/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/generators/insurance.test.ts
```

Expected: FAIL — cannot resolve `../reference/carriers.js`.

- [ ] **Step 3: Write the reference data**

```typescript
// cedar-vale-health-demo/scripts/src/reference/carriers.ts
import type { InsurancePlan } from '../domain.js';

export interface Carrier {
  readonly name: string;
  readonly planTypes: readonly InsurancePlan['planType'][];
}

export const CARRIERS: readonly Carrier[] = [
  { name: 'Summit Health', planTypes: ['HMO', 'PPO', 'EPO'] },
  { name: 'Cascade Mutual', planTypes: ['PPO', 'POS'] },
  { name: 'Front Range Care', planTypes: ['HMO', 'PPO', 'Medicare Advantage'] },
  { name: 'Piedmont Benefit', planTypes: ['PPO', 'EPO'] },
  { name: 'Sonoran First', planTypes: ['HMO', 'POS', 'Medicare Advantage'] },
  { name: 'Meridian Assurance', planTypes: ['PPO', 'EPO', 'POS'] },
  { name: 'Northwater Health', planTypes: ['HMO', 'PPO'] },
  { name: 'Copper State Plans', planTypes: ['PPO', 'Medicare Advantage'] },
  { name: 'Tributary Health', planTypes: ['HMO', 'EPO'] },
  { name: 'Granite Shield', planTypes: ['PPO', 'POS', 'Medicare Advantage'] },
] as const;
```

- [ ] **Step 4: Write the generator**

```typescript
// cedar-vale-health-demo/scripts/src/generators/insurance.ts
import { createRng } from '@canonical-demos/shared';
import { InsurancePlanSchema, slugify, type InsurancePlan, type Location } from '../domain.js';
import { CARRIERS } from '../reference/carriers.js';

const TIER_NAMES = ['Essential', 'Select', 'Preferred', 'Complete', 'Advantage'] as const;

export function generateInsurancePlans(
  seed: number,
  count: number,
  locations: readonly Location[],
): InsurancePlan[] {
  if (locations.length === 0) {
    throw new RangeError('insurance plans need at least one location to be accepted at');
  }

  const rng = createRng(seed);

  const combinations = CARRIERS.flatMap((carrier) =>
    carrier.planTypes.map((planType) => ({ carrier, planType })),
  );
  if (count > combinations.length) {
    throw new RangeError(
      `cannot generate ${count} distinct plans from ${combinations.length} carrier/plan-type combinations`,
    );
  }

  const plans = combinations.slice(0, count).map(({ carrier, planType }, index) => {
    const tier = TIER_NAMES[index % TIER_NAMES.length]!;
    const planName = `${carrier.name} ${tier} ${planType}`;

    // Acceptance is uneven on purpose: the spec's insurance-mismatch metric needs
    // locations that genuinely do not take a given plan.
    const acceptedCount = rng.int(Math.max(1, Math.floor(locations.length * 0.4)), locations.length + 1);
    const acceptedAt = rng.shuffle(locations).slice(0, acceptedCount).map((l) => l.slug);

    return InsurancePlanSchema.parse({
      slug: slugify(planName),
      carrier: carrier.name,
      planName,
      planType,
      acceptedAt,
      referralRequired: planType === 'HMO' || planType === 'POS' ? rng.next() < 0.8 : false,
      notes: rng.next() < 0.3 ? 'Dermatology visits require prior authorization for cosmetic indications.' : null,
    });
  });

  // Guarantee no location is left accepting nothing — assign any orphan to the
  // widest-accepted plan rather than regenerating the whole set.
  const accepted = new Set(plans.flatMap((p) => p.acceptedAt));
  const orphans = locations.filter((l) => !accepted.has(l.slug));
  if (orphans.length > 0) {
    let widest = 0;
    for (let i = 1; i < plans.length; i++) {
      if (plans[i]!.acceptedAt.length > plans[widest]!.acceptedAt.length) widest = i;
    }
    const target = plans[widest]!;
    plans[widest] = InsurancePlanSchema.parse({
      ...target,
      acceptedAt: [...target.acceptedAt, ...orphans.map((l) => l.slug)],
    });
  }

  return plans;
}
```

- [ ] **Step 5: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/generators/insurance.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/reference/carriers.ts cedar-vale-health-demo/scripts/src/generators/insurance.ts cedar-vale-health-demo/scripts/src/generators/insurance.test.ts
git commit -m "feat(cedar): insurance plans generator with uneven per-location acceptance"
```

Expected: PASS — 11 tests, clean typecheck.

---

### Task 9: Relationship and provenance pass

Every generator ships records with `reviewStatus: 'unreviewed'` and null provenance, because a reviewer must be a provider slug and providers do not exist while conditions are being generated. This pass closes the graph.

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/normalize/relationships.ts`
- Test: `cedar-vale-health-demo/scripts/src/normalize/relationships.test.ts`

**Interfaces:**
- Consumes: `Corpus`, `Condition`, `Treatment`, `PatientPost`, `Provider` from `../domain.js`; `createRng` from `@canonical-demos/shared`.
- Produces:
  - `assignProvenance(seed: number, corpus: Corpus): Corpus` — returns a new corpus where clinical content carries a real reviewer slug and a review date, with a deliberate minority left `overdue` or `unreviewed`
  - `linkLocations(corpus: Corpus): Corpus` — **validates** the inverse relation, throwing if any location has no provider assigned. It deliberately invents no links: provider→location assignment from Task 4 is authoritative.
  - `PROVENANCE_MIX = { reviewed: 0.8, overdue: 0.15, unreviewed: 0.05 }`

The `overdue`/`unreviewed` minority is not sloppiness — spec §4.3 needs a nonzero compliance-exposure figure for the flagship, and Plan 1e's fleet pathologies build on the same field.

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/normalize/relationships.test.ts
import { describe, expect, it } from 'vitest';
import { ConditionSchema, ProviderSchema, TreatmentSchema, type Corpus } from '../domain.js';
import { finishCondition, planConditions } from '../generators/conditions.js';
import { generateInsurancePlans } from '../generators/insurance.js';
import { generateLocations } from '../generators/locations.js';
import { buildCompositePost, finishHeroPost, planPosts } from '../generators/posts.js';
import { finishProvider, planProviders } from '../generators/providers.js';
import { finishTreatment, planTreatments } from '../generators/treatments.js';
import { PROVENANCE_MIX, assignProvenance, linkLocations } from './relationships.js';

function buildCorpus(): Corpus {
  const locations = generateLocations(20260809, 25);
  const providers = planProviders(20260809, 60, locations).map((p) => finishProvider(p, 'Bio.'));
  const conditions = planConditions(20260809).map((p) => finishCondition(p, 'Condition copy.'));
  const treatments = planTreatments(20260809, locations).map((p) => finishTreatment(p, 'Treatment copy.'));
  const posts = planPosts(20260809, 20, 20, conditions, treatments).map((plan) =>
    plan.tier === 'hero' ? finishHeroPost(plan, 'Body copy.') : buildCompositePost(plan, 20260809),
  );
  return {
    locations,
    providers,
    conditions,
    treatments,
    posts,
    insurancePlans: generateInsurancePlans(20260809, 30, locations),
  };
}

describe('assignProvenance', () => {
  const corpus = assignProvenance(20260809, buildCorpus());
  const providerSlugs = new Set(corpus.providers.map((p) => p.slug));

  it('is deterministic', () => {
    expect(assignProvenance(3, buildCorpus())).toEqual(assignProvenance(3, buildCorpus()));
  });

  it('names a real provider as reviewer wherever a reviewer is set', () => {
    for (const item of [...corpus.conditions, ...corpus.treatments, ...corpus.posts]) {
      if (item.reviewedBy !== null) expect(providerSlugs.has(item.reviewedBy)).toBe(true);
    }
  });

  it('keeps every record schema-valid after assignment', () => {
    for (const c of corpus.conditions) expect(() => ConditionSchema.parse(c)).not.toThrow();
    for (const t of corpus.treatments) expect(() => TreatmentSchema.parse(t)).not.toThrow();
    for (const p of corpus.providers) expect(() => ProviderSchema.parse(p)).not.toThrow();
  });

  it('leaves a nonzero overdue and unreviewed minority for the compliance metric', () => {
    const statuses = corpus.treatments.map((t) => t.reviewStatus);
    expect(statuses.filter((s) => s === 'overdue').length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === 'unreviewed').length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === 'reviewed').length).toBeGreaterThan(0);
  });

  it('keeps unreviewed records with null reviewer and null date', () => {
    for (const item of [...corpus.conditions, ...corpus.treatments]) {
      if (item.reviewStatus === 'unreviewed') {
        expect(item.reviewedBy).toBeNull();
        expect(item.reviewDate).toBeNull();
      } else {
        expect(item.reviewedBy).not.toBeNull();
        expect(item.reviewDate).not.toBeNull();
      }
    }
  });

  it('dates overdue reviews further in the past than reviewed ones', () => {
    const oldest = (status: string) =>
      [...corpus.treatments]
        .filter((t) => t.reviewStatus === status && t.reviewDate !== null)
        .map((t) => t.reviewDate!)
        .sort()[0]!;
    expect(oldest('overdue') < oldest('reviewed')).toBe(true);
  });

  it('declares a mix that sums to 1', () => {
    const sum = PROVENANCE_MIX.reviewed + PROVENANCE_MIX.overdue + PROVENANCE_MIX.unreviewed;
    expect(sum).toBeCloseTo(1, 10);
  });

  it('throws when there are no providers to attribute reviews to', () => {
    const empty = { ...buildCorpus(), providers: [] };
    expect(() => assignProvenance(1, empty)).toThrow(/providers/i);
  });
});

describe('linkLocations', () => {
  const corpus = linkLocations(assignProvenance(20260809, buildCorpus()));

  it('is deterministic', () => {
    const once = linkLocations(assignProvenance(2, buildCorpus()));
    const twice = linkLocations(assignProvenance(2, buildCorpus()));
    expect(once).toEqual(twice);
  });

  it('leaves the provider-to-location links exactly as the generator set them', () => {
    const original = buildCorpus();
    for (const [index, provider] of corpus.providers.entries()) {
      expect(provider.locations).toEqual(original.providers[index]!.locations);
    }
  });

  it('does not invent a location that no provider is assigned to', () => {
    const staffed = new Set(corpus.providers.flatMap((p) => p.locations));
    for (const location of corpus.locations) expect(staffed.has(location.slug)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/normalize/relationships.test.ts
```

Expected: FAIL — cannot resolve `./relationships.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// cedar-vale-health-demo/scripts/src/normalize/relationships.ts
import { createRng } from '@canonical-demos/shared';
import {
  ConditionSchema,
  PatientPostSchema,
  ProviderSchema,
  TreatmentSchema,
  type Corpus,
  type ReviewStatus,
} from '../domain.js';

/** Spec §4.3 needs a nonzero compliance-exposure figure, so a deliberate minority
 *  of clinical content is left overdue or unreviewed. */
export const PROVENANCE_MIX = { reviewed: 0.8, overdue: 0.15, unreviewed: 0.05 } as const;

/** Fixed reference date so generated review dates are reproducible. Callers must not
 *  pass `new Date()` anywhere in this module — that would break determinism. */
const REFERENCE_DATE = '2026-08-09';

function isoDaysBefore(reference: string, days: number): string {
  const [year, month, day] = reference.split('-').map(Number) as [number, number, number];
  const base = Date.UTC(year, month - 1, day) - days * 86_400_000;
  const d = new Date(base);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pickStatus(roll: number): ReviewStatus {
  if (roll < PROVENANCE_MIX.reviewed) return 'reviewed';
  if (roll < PROVENANCE_MIX.reviewed + PROVENANCE_MIX.overdue) return 'overdue';
  return 'unreviewed';
}

export function assignProvenance(seed: number, corpus: Corpus): Corpus {
  if (corpus.providers.length === 0) {
    throw new RangeError('cannot assign provenance with no providers to attribute reviews to');
  }
  const rng = createRng(seed);

  // Only MD/DO providers may sign off on clinical content.
  const reviewers = corpus.providers.filter((p) => p.credentials === 'MD' || p.credentials === 'DO');
  const pool = reviewers.length > 0 ? reviewers : corpus.providers;

  const provenanceFor = () => {
    const status = pickStatus(rng.next());
    if (status === 'unreviewed') return { reviewedBy: null, reviewDate: null, reviewStatus: status };
    // Reviewed content is recent; overdue content is deliberately older than three years.
    const days = status === 'reviewed' ? rng.int(30, 540) : rng.int(1100, 1800);
    return {
      reviewedBy: rng.pick(pool).slug,
      reviewDate: isoDaysBefore(REFERENCE_DATE, days),
      reviewStatus: status,
    };
  };

  return {
    ...corpus,
    providers: corpus.providers.map((provider) => {
      const { reviewedBy, reviewDate, reviewStatus } = provenanceFor();
      return ProviderSchema.parse({
        ...provider,
        bioReviewedBy: reviewedBy,
        reviewDate,
        reviewStatus,
      });
    }),
    conditions: corpus.conditions.map((condition) =>
      ConditionSchema.parse({ ...condition, ...provenanceFor() }),
    ),
    treatments: corpus.treatments.map((treatment) =>
      TreatmentSchema.parse({ ...treatment, ...provenanceFor() }),
    ),
    posts: corpus.posts.map((post) => PatientPostSchema.parse({ ...post, ...provenanceFor() })),
  };
}

export function linkLocations(corpus: Corpus): Corpus {
  // Provider→location assignment is authoritative from the providers generator; this
  // function exists to validate the inverse relation rather than to invent links.
  const staffed = new Set(corpus.providers.flatMap((p) => p.locations));
  const unstaffed = corpus.locations.filter((l) => !staffed.has(l.slug)).map((l) => l.slug);
  if (unstaffed.length > 0) {
    throw new Error(`locations with no provider assigned: ${unstaffed.join(', ')}`);
  }
  return corpus;
}
```

- [ ] **Step 4: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/normalize/relationships.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/normalize/relationships.ts cedar-vale-health-demo/scripts/src/normalize/relationships.test.ts
git commit -m "feat(cedar): provenance assignment and location link validation"
```

Expected: PASS — 11 tests, clean typecheck. If the `overdue` date test fails, the day ranges overlap — widen the gap rather than loosening the assertion.

---

### Task 10: ACF mappers

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/normalize/acf-mappers.ts`
- Test: `cedar-vale-health-demo/scripts/src/normalize/acf-mappers.test.ts`

**Interfaces:**
- Consumes: every domain type and `NormalizedItemSchema` from `../domain.js`.
- Produces:
  - `mapLocation(l: Location): NormalizedItem`, `mapProvider(p: Provider): NormalizedItem`, `mapTreatment(t: Treatment): NormalizedItem`, `mapCondition(c: Condition): NormalizedItem`, `mapPost(p: PatientPost): NormalizedItem`, `mapInsurancePlan(i: InsurancePlan): NormalizedItem`
  - `mapCorpus(corpus: Corpus): NormalizedItem[]`
  - `ACF_FIELD_NAMES: Readonly<Record<string, readonly string[]>>` — the per-post-type field vocabulary, keyed by post type. **Plan 1c registers ACF fields from exactly this list.**

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/normalize/acf-mappers.test.ts
import { describe, expect, it } from 'vitest';
import { NormalizedItemSchema } from '../domain.js';
import { finishCondition, planConditions } from '../generators/conditions.js';
import { generateInsurancePlans } from '../generators/insurance.js';
import { generateLocations } from '../generators/locations.js';
import { buildCompositePost, planPosts } from '../generators/posts.js';
import { finishProvider, planProviders } from '../generators/providers.js';
import { finishTreatment, planTreatments } from '../generators/treatments.js';
import { ACF_FIELD_NAMES, mapCondition, mapCorpus, mapLocation, mapProvider } from './acf-mappers.js';

const locations = generateLocations(20260809, 25);
const providers = planProviders(20260809, 60, locations).map((p) => finishProvider(p, 'Bio.'));
const conditions = planConditions(20260809).map((p) => finishCondition(p, 'Copy.'));
const treatments = planTreatments(20260809, locations).map((p) => finishTreatment(p, 'Copy.'));
const posts = planPosts(20260809, 0, 12, conditions, treatments).map((p) =>
  buildCompositePost(p, 20260809),
);
const insurancePlans = generateInsurancePlans(20260809, 30, locations);

describe('mapLocation', () => {
  const item = mapLocation(locations[0]!);

  it('produces a valid envelope carrying post_type', () => {
    expect(() => NormalizedItemSchema.parse(item)).not.toThrow();
    expect(item.post_type).toBe('location');
  });

  it('flattens the address into discrete ACF fields', () => {
    expect(item.acf).toMatchObject({
      address_street: locations[0]!.address.street,
      address_city: locations[0]!.address.city,
      address_state: locations[0]!.address.state,
      address_zip: locations[0]!.address.zip,
    });
  });

  it('emits hours as a seven-row repeater', () => {
    expect(Array.isArray(item.acf.hours)).toBe(true);
    expect((item.acf.hours as unknown[]).length).toBe(7);
  });
});

describe('mapProvider', () => {
  const item = mapProvider(providers[0]!);

  it('puts the bio in post_content, not in an ACF field', () => {
    expect(item.post_content).toBe(providers[0]!.bio);
    expect(item.acf).not.toHaveProperty('bio');
  });

  it('carries location links as relationships, not ACF values', () => {
    expect(item.relationships.locations).toEqual(providers[0]!.locations);
    expect(item.acf).not.toHaveProperty('locations');
  });
});

describe('mapCondition', () => {
  it('keeps the ICD-10 code as an ACF field and the copy as content', () => {
    const item = mapCondition(conditions[0]!);
    expect(item.acf.icd10).toBe(conditions[0]!.icd10);
    expect(item.post_content).toBe(conditions[0]!.description);
  });
});

describe('mapCorpus', () => {
  const items = mapCorpus({ locations, providers, conditions, treatments, posts, insurancePlans });

  it('maps every record exactly once', () => {
    expect(items).toHaveLength(
      locations.length + providers.length + conditions.length + treatments.length + posts.length + insurancePlans.length,
    );
  });

  it('produces only valid envelopes', () => {
    for (const item of items) expect(() => NormalizedItemSchema.parse(item)).not.toThrow();
  });

  it('assigns globally unique slug/post_type pairs', () => {
    const keys = items.map((i) => `${i.post_type}:${i.slug}`);
    expect(new Set(keys).size).toBe(items.length);
  });

  it('emits only field names declared in ACF_FIELD_NAMES', () => {
    for (const item of items) {
      const declared = new Set(ACF_FIELD_NAMES[item.post_type] ?? []);
      for (const field of Object.keys(item.acf)) {
        expect(declared.has(field), `${item.post_type}.${field} is not declared`).toBe(true);
      }
    }
  });

  it('declares a field list for every post type it emits', () => {
    for (const postType of new Set(mapCorpus({ locations, providers, conditions, treatments, posts, insurancePlans }).map((i) => i.post_type))) {
      expect(ACF_FIELD_NAMES[postType], postType).toBeDefined();
    }
  });

  it('never emits an undefined ACF value — absent data is null', () => {
    for (const item of items) {
      for (const [field, value] of Object.entries(item.acf)) {
        expect(value, `${item.post_type}.${field}`).not.toBeUndefined();
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/normalize/acf-mappers.test.ts
```

Expected: FAIL — cannot resolve `./acf-mappers.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// cedar-vale-health-demo/scripts/src/normalize/acf-mappers.ts
import type {
  Condition,
  Corpus,
  InsurancePlan,
  Location,
  NormalizedItem,
  PatientPost,
  Provider,
  Treatment,
} from '../domain.js';

/** The ACF field vocabulary. Plan 1c registers field groups from exactly this list;
 *  a rename here is a rename there. */
export const ACF_FIELD_NAMES: Readonly<Record<string, readonly string[]>> = {
  location: [
    'address_street', 'address_city', 'address_state', 'address_zip',
    'geo_lat', 'geo_lng', 'phone', 'hours', 'accepting_new_patients',
    'place_id', 'opened_date', 'parking', 'accessibility', 'metro',
  ],
  provider: [
    'credentials', 'specialties', 'board_certifications', 'npi', 'license_state',
    'languages', 'accepting_new_patients', 'bio_reviewed_by', 'review_date', 'review_status',
  ],
  treatment: [
    'category', 'typical_duration_minutes', 'anesthesia', 'downtime_days',
    'insurance_covered', 'fda_status', 'price_range_by_location',
    'reviewed_by', 'review_date', 'review_status',
  ],
  condition: [
    'icd10', 'category', 'body_areas', 'symptoms',
    'reviewed_by', 'review_date', 'review_status',
  ],
  post: [
    'excerpt', 'tier', 'condition_focus', 'treatment_focus', 'reading_level',
    'reviewed_by', 'review_date', 'review_status',
  ],
  insurance_plan: ['carrier', 'plan_name', 'plan_type', 'referral_required', 'notes'],
};

export function mapLocation(l: Location): NormalizedItem {
  return {
    slug: l.slug,
    post_type: 'location',
    post_title: l.name,
    post_content: `${l.name} is located at ${l.address.street}, ${l.address.city}, ${l.address.state} ${l.address.zip}.`,
    post_status: 'publish',
    acf: {
      metro: l.metro,
      address_street: l.address.street,
      address_city: l.address.city,
      address_state: l.address.state,
      address_zip: l.address.zip,
      geo_lat: l.geo.lat,
      geo_lng: l.geo.lng,
      phone: l.phone,
      hours: l.hours,
      accepting_new_patients: l.acceptingNewPatients,
      place_id: l.placeId,
      opened_date: l.openedDate,
      parking: l.parking,
      accessibility: l.accessibility,
    },
    relationships: {},
  };
}

export function mapProvider(p: Provider): NormalizedItem {
  return {
    slug: p.slug,
    post_type: 'provider',
    post_title: p.name,
    post_content: p.bio,
    post_status: 'publish',
    acf: {
      credentials: p.credentials,
      specialties: p.specialties,
      board_certifications: p.boardCertifications,
      npi: p.npi,
      license_state: p.licenseState,
      languages: p.languages,
      accepting_new_patients: p.acceptingNewPatients,
      bio_reviewed_by: p.bioReviewedBy,
      review_date: p.reviewDate,
      review_status: p.reviewStatus,
    },
    relationships: { locations: p.locations },
  };
}

export function mapTreatment(t: Treatment): NormalizedItem {
  return {
    slug: t.slug,
    post_type: 'treatment',
    post_title: t.name,
    post_content: t.description,
    post_status: 'publish',
    acf: {
      category: t.category,
      typical_duration_minutes: t.typicalDurationMinutes,
      anesthesia: t.anesthesia,
      downtime_days: t.downtimeDays,
      insurance_covered: t.insuranceCovered,
      fda_status: t.fdaStatus,
      price_range_by_location: t.priceRangeByLocation,
      reviewed_by: t.reviewedBy,
      review_date: t.reviewDate,
      review_status: t.reviewStatus,
    },
    relationships: { conditions_treated: t.conditionsTreated },
  };
}

export function mapCondition(c: Condition): NormalizedItem {
  return {
    slug: c.slug,
    post_type: 'condition',
    post_title: c.name,
    post_content: c.description,
    post_status: 'publish',
    acf: {
      icd10: c.icd10,
      category: c.category,
      body_areas: c.bodyAreas,
      symptoms: c.symptoms,
      reviewed_by: c.reviewedBy,
      review_date: c.reviewDate,
      review_status: c.reviewStatus,
    },
    relationships: { related_treatments: c.relatedTreatments },
  };
}

export function mapPost(p: PatientPost): NormalizedItem {
  return {
    slug: p.slug,
    post_type: 'post',
    post_title: p.title,
    post_content: p.content,
    post_status: 'publish',
    acf: {
      excerpt: p.excerpt,
      tier: p.tier,
      condition_focus: p.conditionFocus,
      treatment_focus: p.treatmentFocus,
      reading_level: p.readingLevel,
      reviewed_by: p.reviewedBy,
      review_date: p.reviewDate,
      review_status: p.reviewStatus,
    },
    relationships: { internal_links: p.internalLinks },
  };
}

export function mapInsurancePlan(i: InsurancePlan): NormalizedItem {
  return {
    slug: i.slug,
    post_type: 'insurance_plan',
    post_title: i.planName,
    post_content: i.notes ?? `${i.planName} is accepted at ${i.acceptedAt.length} of our locations.`,
    post_status: 'publish',
    acf: {
      carrier: i.carrier,
      plan_name: i.planName,
      plan_type: i.planType,
      referral_required: i.referralRequired,
      notes: i.notes,
    },
    relationships: { accepted_at: i.acceptedAt },
  };
}

export function mapCorpus(corpus: Corpus): NormalizedItem[] {
  return [
    ...corpus.locations.map(mapLocation),
    ...corpus.providers.map(mapProvider),
    ...corpus.conditions.map(mapCondition),
    ...corpus.treatments.map(mapTreatment),
    ...corpus.posts.map(mapPost),
    ...corpus.insurancePlans.map(mapInsurancePlan),
  ];
}
```

- [ ] **Step 4: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/normalize/acf-mappers.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/normalize/acf-mappers.ts cedar-vale-health-demo/scripts/src/normalize/acf-mappers.test.ts
git commit -m "feat(cedar): ACF mappers and the field vocabulary Plan 1c will register"
```

Expected: PASS — 13 tests, clean typecheck.

---

### Task 11: Prose store

The checkpoint records **that** an item completed; it does not record **what** the model wrote. Without somewhere durable for the prose, a resumed run skips every checkpointed item and then has no text for it — the corpus comes out empty and the count gate fails for a reason that looks nothing like the cause. This store is the missing half of resumability.

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/prose-store.ts`
- Test: `cedar-vale-health-demo/scripts/src/prose-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class ProseStore` with `constructor(filePath: string)`, `load(): Map<string, string>`, `record(uid: string, text: string): void`
  - Append-only JSONL of `{uid, text}`; the last entry for a uid wins; corrupt lines are skipped and counted via `loadCorruptCount(): number`, mirroring the shared library's `Checkpoint`.

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/prose-store.test.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProseStore } from './prose-store.js';

let path: string;

beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'prose-')), 'prose.jsonl');
});

describe('ProseStore', () => {
  it('returns an empty map when the file does not exist', () => {
    expect(new ProseStore(path).load().size).toBe(0);
  });

  it('round-trips text across a reopen', () => {
    new ProseStore(path).record('condition:acne-vulgaris', 'Acne is common.');
    expect(new ProseStore(path).load().get('condition:acne-vulgaris')).toBe('Acne is common.');
  });

  it('appends rather than truncating', () => {
    new ProseStore(path).record('a', 'first');
    new ProseStore(path).record('b', 'second');
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('lets the last write for a uid win', () => {
    const store = new ProseStore(path);
    store.record('a', 'old');
    store.record('a', 'new');
    expect(store.load().get('a')).toBe('new');
  });

  it('preserves text containing newlines and quotes', () => {
    const body = 'Line one.\n\nLine "two" — with punctuation.';
    new ProseStore(path).record('a', body);
    expect(new ProseStore(path).load().get('a')).toBe(body);
  });

  it('skips corrupt lines and counts them instead of throwing', () => {
    writeFileSync(path, '{"uid":"good","text":"ok"}\nnot json\n{"text":"no uid"}\n');
    const store = new ProseStore(path);
    expect(store.load().get('good')).toBe('ok');
    expect(store.load().size).toBe(1);
    expect(store.loadCorruptCount()).toBe(2);
  });

  it('rejects an empty uid rather than storing an unaddressable record', () => {
    expect(() => new ProseStore(path).record('', 'text')).toThrow(/uid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/prose-store.test.ts
```

Expected: FAIL — cannot resolve `./prose-store.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// cedar-vale-health-demo/scripts/src/prose-store.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface ProseRecord {
  uid: string;
  text: string;
}

/** Append-only sidecar to the shared library's Checkpoint. The checkpoint answers
 *  "did this item finish"; this answers "what did the model write". Both are written
 *  from the runner's onResult, so a resumed run can rebuild the corpus without
 *  regenerating — or paying for — a single completed item. Synchronous for the same
 *  reason the checkpoint is: buffered prose lost to a crash is prose paid for twice. */
export class ProseStore {
  private corruptCount = 0;

  constructor(private readonly filePath: string) {}

  load(): Map<string, string> {
    this.corruptCount = 0;
    const entries = new Map<string, string>();
    if (!existsSync(this.filePath)) return entries;

    for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed = JSON.parse(trimmed) as Partial<ProseRecord>;
        if (typeof parsed.uid === 'string' && parsed.uid !== '' && typeof parsed.text === 'string') {
          entries.set(parsed.uid, parsed.text);
        } else {
          this.corruptCount++;
        }
      } catch {
        this.corruptCount++;
      }
    }
    return entries;
  }

  loadCorruptCount(): number {
    return this.corruptCount;
  }

  record(uid: string, text: string): void {
    if (uid.trim() === '') throw new Error('ProseStore.record requires a non-empty uid');
    mkdirSync(dirname(this.filePath), { recursive: true });
    const entry: ProseRecord = { uid, text };
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}
```

- [ ] **Step 4: Run tests and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run src/prose-store.test.ts && npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/prose-store.ts cedar-vale-health-demo/scripts/src/prose-store.test.ts
git commit -m "feat(cedar): append-only prose store so resume needs no regeneration"
```

Expected: PASS — 7 tests, clean typecheck. Note `loadCorruptCount()` is only meaningful after `load()`, exactly as the shared `Checkpoint` behaves.

---

### Task 12: The generation CLI

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/generate-content.ts`
- Create: `cedar-vale-health-demo/scripts/src/run-corpus.ts`
- Test: `cedar-vale-health-demo/scripts/src/run-corpus.test.ts`

**Interfaces:**
- Consumes: every generator and normalizer above; `ProseStore` from `./prose-store.js` (Task 11); from `@canonical-demos/shared` — `AiClient`, `TokenBudget`, `BudgetExceededError`, `Checkpoint`, `runGeneration`, `assertCounts`, `verifyCounts`, `formatReport`, `parseManifest`, `createAnthropicClient`, `DEFAULT_MODEL`, and the `CompletionClient` type.
- Produces:
  - `buildCorpus(options: BuildOptions): Promise<Corpus>` where `BuildOptions = { manifest: Manifest; ai: AiClient; checkpoint: Checkpoint; prose: ProseStore; model: string; log?(message: string): void }`
  - `countByPostType(items: readonly NormalizedItem[]): Record<string, number>`
  - `generate-content.ts` is the thin executable wrapper: load `.env`, read the manifest, preflight the model, construct the budget from `TOKEN_BUDGET` **plus prior checkpoint spend**, call `buildCorpus`, map, `assertCounts`, write `data/*.json`.

Two obligations inherited from `shared/` (spec §6.1) that this task must honour:
- **Resume correctness requires `new TokenBudget(limit, checkpoint.loadSpentTokens())`.** Constructing the budget without prior spend re-arms the cap on every resume.
- **`countByPostType` must build its accumulator with `Object.create(null)`**, matching the library's own count maps, so a `__proto__`-shaped post type cannot slip the gate.

- [ ] **Step 1: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/run-corpus.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AiClient,
  BudgetExceededError,
  Checkpoint,
  TokenBudget,
  parseManifest,
  type CompletionClient,
} from '@canonical-demos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { mapCorpus } from './normalize/acf-mappers.js';
import { ProseStore } from './prose-store.js';
import { buildCorpus, countByPostType } from './run-corpus.js';

// A small manifest keeps the test fast; the real counts are pinned in Task 1.
const manifest = parseManifest({
  site: 'cedar-vale-health',
  seed: 20260809,
  entries: [
    { postType: 'location', tier: 'composite', count: 5 },
    { postType: 'provider', tier: 'hero', count: 6 },
    { postType: 'treatment', tier: 'hero', count: 45 },
    { postType: 'condition', tier: 'hero', count: 80 },
    { postType: 'post', tier: 'hero', count: 3 },
    { postType: 'post', tier: 'composite', count: 4 },
    { postType: 'insurance_plan', tier: 'composite', count: 8 },
  ],
});

const fakeClient = (): CompletionClient & { calls: number } => {
  const client = {
    calls: 0,
    async complete() {
      client.calls++;
      return { text: `Generated prose body number ${client.calls}.`, inputTokens: 10, outputTokens: 40 };
    },
  };
  return client;
};

let checkpointPath: string;
let prosePath: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'cedar-'));
  checkpointPath = join(dir, 'progress.jsonl');
  prosePath = join(dir, 'prose.jsonl');
});

describe('countByPostType', () => {
  it('counts each post type', () => {
    expect(
      countByPostType([
        { slug: 'a', post_type: 'condition', post_title: 'A', post_content: 'a', post_status: 'publish', acf: {}, relationships: {} },
        { slug: 'b', post_type: 'condition', post_title: 'B', post_content: 'b', post_status: 'publish', acf: {}, relationships: {} },
        { slug: 'c', post_type: 'post', post_title: 'C', post_content: 'c', post_status: 'publish', acf: {}, relationships: {} },
      ]),
    ).toEqual({ condition: 2, post: 1 });
  });

  it('uses a null-prototype accumulator so a __proto__ post type is counted', () => {
    const counts = countByPostType([
      { slug: 'x', post_type: '__proto__', post_title: 'X', post_content: 'x', post_status: 'publish', acf: {}, relationships: {} },
    ]);
    expect(Object.keys(counts)).toEqual(['__proto__']);
  });
});

describe('buildCorpus', () => {
  it('produces a corpus matching the manifest counts', async () => {
    const client = fakeClient();
    const ai = new AiClient(client, new TokenBudget(Number.POSITIVE_INFINITY));
    const corpus = await buildCorpus({
      manifest,
      ai,
      checkpoint: new Checkpoint(checkpointPath),
      prose: new ProseStore(prosePath),
      model: 'fake-model',
    });

    expect(countByPostType(mapCorpus(corpus))).toEqual({
      location: 5,
      provider: 6,
      treatment: 45,
      condition: 80,
      post: 7,
      insurance_plan: 8,
    });
  });

  it('makes one AI call per hero item and none for composites', async () => {
    const client = fakeClient();
    const ai = new AiClient(client, new TokenBudget(Number.POSITIVE_INFINITY));
    await buildCorpus({
      manifest,
      ai,
      checkpoint: new Checkpoint(checkpointPath),
      prose: new ProseStore(prosePath),
      model: 'fake-model',
    });
    // 6 providers + 45 treatments + 80 conditions + 3 hero posts
    expect(client.calls).toBe(134);
  });

  it('records every generated item in the checkpoint', async () => {
    const checkpoint = new Checkpoint(checkpointPath);
    const ai = new AiClient(fakeClient(), new TokenBudget(Number.POSITIVE_INFINITY));
    await buildCorpus({ manifest, ai, checkpoint, prose: new ProseStore(prosePath), model: 'fake-model' });
    expect(checkpoint.count()).toBe(134);
  });

  it('rebuilds the identical corpus on a second run with no AI calls at all', async () => {
    const first = fakeClient();
    const firstCorpus = await buildCorpus({
      manifest,
      ai: new AiClient(first, new TokenBudget(Number.POSITIVE_INFINITY)),
      checkpoint: new Checkpoint(checkpointPath),
      prose: new ProseStore(prosePath),
      model: 'fake-model',
    });

    const second = fakeClient();
    const secondCorpus = await buildCorpus({
      manifest,
      ai: new AiClient(second, new TokenBudget(Number.POSITIVE_INFINITY)),
      checkpoint: new Checkpoint(checkpointPath),
      prose: new ProseStore(prosePath),
      model: 'fake-model',
    });

    expect(first.calls).toBe(134);
    expect(second.calls).toBe(0);
    // This is the whole point of the prose store: resume is equivalent to an
    // uninterrupted run, not a run that silently produces less.
    expect(secondCorpus).toEqual(firstCorpus);
  });

  it('throws naming the uid when the checkpoint says done but the prose is missing', async () => {
    const checkpoint = new Checkpoint(checkpointPath);
    // Simulate the inconsistent state: completion recorded, prose absent.
    checkpoint.record('condition:acne-vulgaris', '2026-08-09T00:00:00.000Z', 50);

    await expect(
      buildCorpus({
        manifest,
        ai: new AiClient(fakeClient(), new TokenBudget(Number.POSITIVE_INFINITY)),
        checkpoint,
        prose: new ProseStore(prosePath),
        model: 'fake-model',
      }),
    ).rejects.toThrow(/condition:acne-vulgaris/);
  });

  it('persists token spend so a resumed budget starts where the last one stopped', async () => {
    const checkpoint = new Checkpoint(checkpointPath);
    await buildCorpus({
      manifest,
      ai: new AiClient(fakeClient(), new TokenBudget(Number.POSITIVE_INFINITY)),
      checkpoint,
      prose: new ProseStore(prosePath),
      model: 'fake-model',
    });
    // 134 calls x (10 input + 40 output)
    expect(checkpoint.loadSpentTokens()).toBe(134 * 50);
  });

  it('aborts with BudgetExceededError, leaving the checkpoint accurate for resume', async () => {
    const checkpoint = new Checkpoint(checkpointPath);
    const ai = new AiClient(fakeClient(), new TokenBudget(260));

    await expect(
      buildCorpus({ manifest, ai, checkpoint, prose: new ProseStore(prosePath), model: 'fake-model' }),
    ).rejects.toThrow(BudgetExceededError);

    // Each call costs 50 tokens and maxTokens must be affordable up front, so only
    // a few items complete — but every completed item is recorded exactly once.
    expect(checkpoint.count()).toBeGreaterThan(0);
    expect(checkpoint.count()).toBeLessThan(134);
    expect(checkpoint.loadSpentTokens()).toBe(checkpoint.count() * 50);
  });

  it('logs a resume line when prior progress exists', async () => {
    const checkpoint = new Checkpoint(checkpointPath);
    checkpoint.record('condition:acne-vulgaris', '2026-08-09T00:00:00.000Z', 50);
    const lines: string[] = [];
    await buildCorpus({
      manifest,
      ai: new AiClient(fakeClient(), new TokenBudget(Number.POSITIVE_INFINITY)),
      checkpoint,
      prose: new ProseStore(prosePath),
      model: 'fake-model',
      log: (m) => lines.push(m),
    });
    expect(lines.some((l) => /resum/i.test(l))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/run-corpus.test.ts
```

Expected: FAIL — cannot resolve `./run-corpus.js`.

- [ ] **Step 3: Write the orchestrator**

```typescript
// cedar-vale-health-demo/scripts/src/run-corpus.ts
import {
  runGeneration,
  type AiClient,
  type Checkpoint,
  type Manifest,
} from '@canonical-demos/shared';
import type { Corpus, NormalizedItem } from './domain.js';
import { finishCondition, planConditions } from './generators/conditions.js';
import { generateInsurancePlans } from './generators/insurance.js';
import { generateLocations } from './generators/locations.js';
import { buildCompositePost, finishHeroPost, planPosts } from './generators/posts.js';
import { finishProvider, planProviders } from './generators/providers.js';
import { finishTreatment, planTreatments } from './generators/treatments.js';
import { assignProvenance, linkLocations } from './normalize/relationships.js';
import type { ProseStore } from './prose-store.js';

export interface BuildOptions {
  manifest: Manifest;
  ai: AiClient;
  checkpoint: Checkpoint;
  model: string;
  log?(message: string): void;
}

export function countByPostType(items: readonly NormalizedItem[]): Record<string, number> {
  // Null-prototype accumulator, matching the shared library's own count maps, so a
  // post type named `__proto__` is counted rather than silently vanishing.
  const counts = Object.create(null) as Record<string, number>;
  for (const item of items) counts[item.post_type] = (counts[item.post_type] ?? 0) + 1;
  return counts;
}

function declared(manifest: Manifest, postType: string, tier?: 'hero' | 'composite'): number {
  return manifest.entries
    .filter((e) => e.postType === postType && (tier === undefined || e.tier === tier))
    .reduce((sum, e) => sum + e.count, 0);
}

/** Runs one AI call per plan through the shared resumable runner, writing each result
 *  to the durable prose store and the in-memory map together. `prompt` must be
 *  non-null — composite tiers never reach here. */
async function generateProse(
  plans: readonly { uid: string; prompt: string | null }[],
  options: BuildOptions,
  maxTokens: number,
  prose: Map<string, string>,
): Promise<void> {
  await runGeneration({
    items: plans,
    checkpoint: options.checkpoint,
    log: options.log,
    handler: async (plan) => {
      if (plan.prompt === null) throw new Error(`plan ${plan.uid} has no prompt`);
      return options.ai.generate({ model: options.model, prompt: plan.prompt, maxTokens });
    },
    onResult: (uid, result) => {
      // Durable first, then in-memory — if the process dies between them the store
      // is still correct and the next run reads it back.
      options.prose.record(uid, result.text);
      prose.set(uid, result.text);
    },
    tokensFor: (result) => result.inputTokens + result.outputTokens,
  });
}

export async function buildCorpus(options: BuildOptions): Promise<Corpus> {
  const { manifest } = options;
  const seed = manifest.seed;

  const locations = generateLocations(seed, declared(manifest, 'location'));

  // Conditions and treatments come from fixed catalogs whose sizes Task 5 pins to
  // the manifest, so their counts are not passed in.
  const conditionPlans = planConditions(seed);
  const treatmentPlans = planTreatments(seed, locations);
  const providerPlans = planProviders(seed, declared(manifest, 'provider'), locations);

  // One map holds prose from previous runs AND this run. `generateProse` writes each
  // result into the durable store and this map together, so a resumed run finds text
  // for every item the checkpoint says is done.
  const prose = options.prose.load();

  await generateProse(conditionPlans, options, 700, prose);
  await generateProse(treatmentPlans, options, 700, prose);
  await generateProse(providerPlans, options, 500, prose);

  // Checkpoint and prose store are written from the same onResult, so a uid present
  // in one and absent from the other means the files were edited or partially deleted.
  // That is not recoverable by guessing — name it and stop.
  const requireText = (uid: string): string => {
    const text = prose.get(uid);
    if (text === undefined) {
      throw new Error(
        `no prose recorded for "${uid}" although the checkpoint marks it complete — ` +
          `the checkpoint and prose store are out of sync; delete both to regenerate`,
      );
    }
    return text;
  };

  const conditions = conditionPlans.map((p) => finishCondition(p, requireText(p.uid)));
  const treatments = treatmentPlans.map((p) => finishTreatment(p, requireText(p.uid)));
  const providers = providerPlans.map((p) => finishProvider(p, requireText(p.uid)));

  const postPlans = planPosts(
    seed,
    declared(manifest, 'post', 'hero'),
    declared(manifest, 'post', 'composite'),
    conditions,
    treatments,
  );
  const heroPostPlans = postPlans.filter((p) => p.tier === 'hero');
  await generateProse(heroPostPlans, options, 900, prose);

  const posts = postPlans.map((plan) =>
    plan.tier === 'hero' ? finishHeroPost(plan, requireText(plan.uid)) : buildCompositePost(plan, seed),
  );

  const insurancePlans = generateInsurancePlans(seed, declared(manifest, 'insurance_plan'), locations);

  return linkLocations(
    assignProvenance(seed, { locations, providers, conditions, treatments, posts, insurancePlans }),
  );
}
```

- [ ] **Step 4: Write the executable wrapper**

```typescript
// cedar-vale-health-demo/scripts/src/generate-content.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AiClient,
  Checkpoint,
  DEFAULT_MODEL,
  TokenBudget,
  assertCounts,
  createAnthropicClient,
  formatReport,
  parseManifest,
  verifyCounts,
} from '@canonical-demos/shared';
import 'dotenv/config';
import { mapCorpus } from './normalize/acf-mappers.js';
import { ProseStore } from './prose-store.js';
import { buildCorpus, countByPostType } from './run-corpus.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(HERE, '..', '..');
const DATA_DIR = join(SITE_ROOT, 'data');

async function main(): Promise<void> {
  const manifest = parseManifest(JSON.parse(readFileSync(join(SITE_ROOT, 'manifest.json'), 'utf8')));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error('ANTHROPIC_API_KEY is not set — copy .env.example to .env and fill it in');
  }
  const model = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;

  const limitRaw = process.env.TOKEN_BUDGET?.trim();
  const limit = limitRaw === undefined || limitRaw === '' ? 4_000_000 : Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`TOKEN_BUDGET must be a positive number, got "${limitRaw}"`);
  }

  const checkpoint = new Checkpoint(join(SITE_ROOT, '.generation-progress.jsonl'));

  // Prior spend must seed the budget, or every resume re-arms the cap at full and
  // k resumes cost k x limit (spec §6.1).
  const budget = new TokenBudget(limit, checkpoint.loadSpentTokens());
  const ai = new AiClient(createAnthropicClient(apiKey), budget);

  console.log(`Preflighting model "${model}"...`);
  await ai.preflight(model);
  console.log(`Model OK. Budget: ${budget.report()}`);

  const prose = new ProseStore(join(SITE_ROOT, '.generation-prose.jsonl'));
  const corpus = await buildCorpus({ manifest, ai, checkpoint, prose, model, log: (m) => console.log(m) });
  const items = mapCorpus(corpus);

  const report = verifyCounts(manifest, countByPostType(items));
  console.log(formatReport(report));
  assertCounts(manifest, countByPostType(items));

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, 'normalized.json'), `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  for (const [name, records] of Object.entries(corpus)) {
    writeFileSync(join(DATA_DIR, `${name}.json`), `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  }

  console.log(`Wrote ${items.length} normalized items to ${DATA_DIR}`);
  console.log(budget.report());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 5: Run the full suite, typecheck, and commit**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts
npx vitest run
npm run typecheck
cd ~/development/wpengine/canonical-demos
git add cedar-vale-health-demo/scripts/src/run-corpus.ts cedar-vale-health-demo/scripts/src/run-corpus.test.ts cedar-vale-health-demo/scripts/src/generate-content.ts
git commit -m "feat(cedar): generation CLI with preflight, resumable budget and count gate"
```

Expected: PASS — the whole Cedar suite green, clean typecheck. Report the exact total the runner prints rather than a predicted figure.

---

## Definition of Done

- [ ] `npm test -w @canonical-demos/cedar-scripts` passes from the monorepo root.
- [ ] `npm run typecheck -w @canonical-demos/cedar-scripts` is clean.
- [ ] `npm test --workspaces` still passes — the shared library's 139 tests must not regress.
- [ ] No test performs network I/O, spawns a process, writes outside a temp dir, or requires WordPress.
- [ ] `grep -rn 'Math.random' cedar-vale-health-demo/scripts/src --include='*.ts' | grep -v test` returns nothing.
- [ ] `grep -rn "from '@faker-js/faker'" cedar-vale-health-demo/scripts/src` returns nothing — faker arrives only via `seededFaker`.
- [ ] Two runs of the generator with the same seed and no checkpoint produce byte-identical `data/*.json`.
- [ ] One commit per task, none pushed.

## Handoff to Plan 1c

Plan 1c (seeder plugin + ACF field groups) consumes two artifacts from this plan and must not diverge from them:
- **`ACF_FIELD_NAMES`** in `normalize/acf-mappers.ts` — the field name per post type. Register exactly these.
- **The `NormalizedItem` envelope** — `{slug, post_type, post_title, post_content, post_status, acf, relationships}`, where `relationships` holds **slugs**. Pass 2 of the importer resolves slugs to post IDs; nothing upstream knows a WordPress ID.

The six post types to register are `location`, `provider`, `treatment`, `condition`, `insurance_plan` (plus core `post`), and the taxonomies are `metro`, `body_area`, `condition_category`, `treatment_category`, `provider_specialty`, `language_spoken`, `review_status` (spec §3.1).
