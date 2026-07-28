# Alpine Outfitters ACF Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate Alpine Outfitters destination/trip/team content through a fixed pipeline that writes complete, correct ACF structured data and a rich relationship graph, and make the Nexus AI addon consume that data generically (no hardcoded domain field names).

**Architecture:** Approach C — TypeScript generators (in `alpine-outfitters-demo`) emit **normalized JSON** (WordPress-shaped envelopes with slugs, native-JSON ACF values, and relationships expressed by slug). A PHP `alpine-seeder` WordPress plugin registers the CPTs, ships `acf-json` field groups, and provides two WP-CLI commands: `wp alpine import` (Pass 1 writes posts + ACF via `update_field()`; Pass 2 resolves relationship slugs→IDs and injects blog links) and `wp alpine verify` (a hard gate). Separately, the Nexus addon's hybrid search is refactored to accept generic `{field, op, value}` filters and to surface `customFields` in results.

**Tech Stack:** TypeScript (ESM, run via `tsx`), Vitest (new, for demo-repo unit tests), `@faker-js/faker` (seeded), PHP 8 + WP-CLI + ACF (Advanced Custom Fields), better-sqlite3 (addon), Jest (addon tests).

## Global Constraints

- **Two repos.** Demo pipeline lives in `alpine-outfitters-demo/` (paths below prefixed `[demo]`). Addon changes live in `local-addon-nexus-ai/` (paths prefixed `[addon]`).
- **Site:** WordPress install at `/Users/jeremy.pollock/PW-Local-Functional-Sites/alpine-outfitters/app/public/`; Nexus site name `Alpine Outfitters`; site id `8Id0qz1eA`; active theme `twentytwentyfive`.
- **Counts (from `[demo] scripts/utils/config.ts`):** destinations 40, trips 30, team 12. Keep as-is (env-overridable).
- **Regions (single source of truth, `[demo] scripts/utils/faker-helpers.ts` `REGIONS`):** Pacific Northwest, Sierra Nevada, Rocky Mountains, Desert Southwest, Eastern Mountains.
- **Product categories (`[demo] scripts/prompts/product-templates.ts` `PRODUCT_CATEGORIES`):** Backpacks & Bags, Tents & Shelters, Sleeping Systems, Clothing, Footwear, Cooking & Hydration, Navigation & Safety, Climbing Gear, Winter & Snow.
- **Seasons list (single source of truth):** `['Spring','Summer','Fall','Winter']`.
- **ACF field names are snake_case** and become the postmeta keys the Nexus indexer reads. Exact names are fixed in Task A7 and reused verbatim by generators, importer, and verify.
- **`update_field()` only** for ACF writes (never raw `meta_input`). ACF values are passed as native PHP arrays/values.
- **Reproducibility:** faker seed fixed at `20260728`. Committed JSON is the canonical artifact; importer is deterministic over it.
- **Addon is domain-agnostic:** no hiking field names or difficulty semantics may appear in `local-addon-nexus-ai`.
- **Addon native module + reload:** after addon TS changes, `npm run build`; before loading in Local, `npm run rebuild`; restart Local with `./dev-reload.sh` (main-process modules do NOT hot-reload). Tests use system Node (`npm install` context).
- **No releases:** do not `npm version`, `git tag`, or `git push` unless explicitly told.

---

## File Structure

**`[demo]` (alpine-outfitters-demo):**
- `scripts/utils/seed.ts` — *create* — fixed faker seed + `slugify()`.
- `scripts/utils/types.ts` — *modify* — add `NormalizedItem`, `RelationshipMap`, and relationship fields already present.
- `scripts/normalize/acf-mappers.ts` — *create* — domain object → normalized envelope (per type).
- `scripts/normalize/relationships.ts` — *create* — deterministic relationship matcher (CPT graph).
- `scripts/normalize/blog-links.ts` — *create* — blog→destination/product link matcher.
- `scripts/generate-content.ts` — *modify* — seed at startup; after generation run matcher + mappers; write normalized JSON + `blog-links.json`.
- `scripts/generators/destinations.ts`, `team.ts` — *modify* — declare relationship fields so types line up (values filled by matcher).
- `wordpress/plugins/alpine-seeder/alpine-seeder.php` — *create* — plugin bootstrap + CPT registration + WP-CLI command registration.
- `wordpress/plugins/alpine-seeder/includes/class-import-command.php` — *create* — `wp alpine import`.
- `wordpress/plugins/alpine-seeder/includes/class-verify-command.php` — *create* — `wp alpine verify`.
- `wordpress/plugins/alpine-seeder/acf-json/group_destination.json`, `group_trip.json`, `group_team.json` — *create* — field-group definitions.
- `tests/normalize/*.test.ts` — *create* — Vitest unit tests.
- `package.json`, `vitest.config.ts`, `tsconfig.json` — *modify/create* — test tooling.

**`[addon]` (local-addon-nexus-ai):**
- `src/common/types.ts` — *modify* — generic `metadataFilters` type.
- `src/main/vector-store/SqliteVecStore.ts` — *modify* — generic filter application; remove difficulty boost + hardcoded names.
- `src/main/mcp/modules/content/search-content.ts` — *modify* — generic filter schema + expose `customFields`.
- `tests/unit/mcp/hybrid-generic-filters.test.ts` — *create* — unit tests.

---

## PART A — Demo pipeline (`alpine-outfitters-demo`)

### Task A1: Deterministic seed + slug utility

**Files:**
- Create: `[demo] scripts/utils/seed.ts`
- Create: `[demo] vitest.config.ts`, `[demo] tests/utils/seed.test.ts`
- Modify: `[demo] package.json` (add `vitest`, `test` script), `[demo] tsconfig.json` (ensure `tests` compiled)

**Interfaces:**
- Produces: `export const FAKER_SEED = 20260728;` · `export function seedFaker(): void` (calls `faker.seed(FAKER_SEED)`) · `export function slugify(input: string): string`

- [ ] **Step 1: Add test tooling.** In `[demo] package.json` add devDeps `vitest` and `@types/node`, and script `"test": "vitest run"`. Run `npm install` in `[demo]`.

- [ ] **Step 2: Write the failing test** — `[demo] tests/utils/seed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { seedFaker, slugify } from '../../scripts/utils/seed.js';

describe('seed + slugify', () => {
  it('produces identical sequences after re-seeding', () => {
    seedFaker();
    const a = [faker.number.int(), faker.number.int(), faker.number.int()];
    seedFaker();
    const b = [faker.number.int(), faker.number.int(), faker.number.int()];
    expect(a).toEqual(b);
  });

  it('slugifies titles deterministically', () => {
    expect(slugify('Copper Lake via Pacific Crest Trail!')).toBe('copper-lake-via-pacific-crest-trail');
    expect(slugify('  Red Rock: Vegas  ')).toBe('red-rock-vegas');
    expect(slugify('Emerald Lake — Cirque')).toBe('emerald-lake-cirque');
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — `cd [demo] && npx vitest run tests/utils/seed.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** — `[demo] scripts/utils/seed.ts`:

```ts
import { faker } from '@faker-js/faker';

export const FAKER_SEED = 20260728;

export function seedFaker(): void {
  faker.seed(FAKER_SEED);
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')       // strip accents
    .replace(/[^a-zA-Z0-9\s-]/g, '')       // drop punctuation
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
```

- [ ] **Step 5: Run test to verify it passes** — `npx vitest run tests/utils/seed.test.ts` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(pipeline): deterministic faker seed + slugify util"`

---

### Task A2: ACF mappers (domain object → normalized envelope)

**Files:**
- Create: `[demo] scripts/normalize/acf-mappers.ts`
- Modify: `[demo] scripts/utils/types.ts`
- Create: `[demo] tests/normalize/acf-mappers.test.ts`

**Interfaces:**
- Consumes: `Destination`, `Trip`, `TeamMember` from `types.ts`; `slugify` from `seed.ts`.
- Produces:
  ```ts
  export interface NormalizedItem {
    slug: string;
    post_title: string;
    post_content: string;
    post_status: 'publish';
    acf: Record<string, unknown>;
    relationships: Record<string, string[]>;
  }
  export function mapDestination(d: Destination): NormalizedItem
  export function mapTrip(t: Trip): NormalizedItem
  export function mapTeam(m: TeamMember): NormalizedItem
  ```
- ACF field names (verbatim, must match Task A7): destination → `distance, elevation_gain, difficulty, trail_type, trailhead_gps, permits_required, permit_details, best_seasons, region`; trip → `duration, difficulty, price, group_size_min, group_size_max, itinerary, season, region`; team → `years_experience, certifications, specialties, email, phone`.
- Repeater shapes: `itinerary` → `[{ day: number, activities: string }]`; `certifications` → `[{ certification: string }]`; `specialties` → `[{ specialty: string }]`.

- [ ] **Step 1: Add `NormalizedItem` to `types.ts`** (append the interface above).

- [ ] **Step 2: Write the failing test** — `[demo] tests/normalize/acf-mappers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapDestination, mapTrip, mapTeam } from '../../scripts/normalize/acf-mappers.js';

const dest = {
  title: 'Copper Lake', content: 'prose', distance: 2.5, elevationGain: 550,
  difficulty: 1, trailType: 'out-and-back' as const, gps: '47.6, -121.5',
  permitRequired: false, permitDetails: undefined, bestSeasons: ['Spring', 'Fall'],
  region: 'Pacific Northwest',
};

describe('acf mappers', () => {
  it('maps a destination to snake_case acf with native types', () => {
    const n = mapDestination(dest as any);
    expect(n.slug).toBe('copper-lake');
    expect(n.post_title).toBe('Copper Lake');
    expect(n.acf.difficulty).toBe(1);
    expect(n.acf.distance).toBe(2.5);
    expect(n.acf.elevation_gain).toBe(550);
    expect(n.acf.trail_type).toBe('out-and-back');
    expect(n.acf.permits_required).toBe(false);
    expect(n.acf.best_seasons).toEqual(['Spring', 'Fall']); // native array, not serialized
    expect(n.relationships).toEqual({ related_trips: [], recommended_gear: [] });
  });

  it('maps trip itinerary + group size to repeater/number fields', () => {
    const trip = {
      title: 'Desert Ascent', content: 'x', duration: 3, difficulty: 3, price: 406,
      groupSize: { min: 4, max: 10 }, itinerary: [{ day: 1, activities: 'Arrive' }],
      season: ['Summer'], region: 'Desert Southwest', relatedDestinations: [], requiredGear: [],
    };
    const n = mapTrip(trip as any);
    expect(n.acf.group_size_min).toBe(4);
    expect(n.acf.group_size_max).toBe(10);
    expect(n.acf.itinerary).toEqual([{ day: 1, activities: 'Arrive' }]);
    expect(n.acf.season).toEqual(['Summer']);
    expect(n.relationships).toEqual({ related_destinations: [], required_gear: [] });
  });

  it('maps team certifications/specialties to repeater rows', () => {
    const m = {
      name: 'Sylvia Q', bio: 'bio', yearsExperience: 8,
      certifications: ['WFR', 'CPR'], specialties: ['Logistics'], email: 's@x.com',
    };
    const n = mapTeam(m as any);
    expect(n.post_title).toBe('Sylvia Q');
    expect(n.acf.years_experience).toBe(8);
    expect(n.acf.certifications).toEqual([{ certification: 'WFR' }, { certification: 'CPR' }]);
    expect(n.acf.specialties).toEqual([{ specialty: 'Logistics' }]);
    expect(n.relationships).toEqual({ favorite_destinations: [], guided_trips: [] });
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — `npx vitest run tests/normalize/acf-mappers.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** — `[demo] scripts/normalize/acf-mappers.ts`:

```ts
import { Destination, Trip, TeamMember, NormalizedItem } from '../utils/types.js';
import { slugify } from '../utils/seed.js';

export function mapDestination(d: Destination): NormalizedItem {
  return {
    slug: slugify(d.title),
    post_title: d.title,
    post_content: d.content,
    post_status: 'publish',
    acf: {
      distance: d.distance,
      elevation_gain: d.elevationGain,
      difficulty: d.difficulty,
      trail_type: d.trailType,
      trailhead_gps: d.gps,
      permits_required: d.permitRequired,
      permit_details: d.permitDetails ?? '',
      best_seasons: d.bestSeasons,
      region: d.region,
    },
    relationships: { related_trips: [], recommended_gear: [] },
  };
}

export function mapTrip(t: Trip): NormalizedItem {
  return {
    slug: slugify(t.title),
    post_title: t.title,
    post_content: t.content,
    post_status: 'publish',
    acf: {
      duration: t.duration,
      difficulty: t.difficulty,
      price: t.price,
      group_size_min: t.groupSize.min,
      group_size_max: t.groupSize.max,
      itinerary: t.itinerary, // [{day, activities}] — matches repeater subfields
      season: t.season,
      region: t.region,
    },
    relationships: { related_destinations: [], required_gear: [] },
  };
}

export function mapTeam(m: TeamMember): NormalizedItem {
  return {
    slug: slugify(m.name),
    post_title: m.name,
    post_content: m.bio,
    post_status: 'publish',
    acf: {
      years_experience: m.yearsExperience,
      certifications: m.certifications.map((c) => ({ certification: c })),
      specialties: m.specialties.map((s) => ({ specialty: s })),
      email: m.email,
      phone: (m as unknown as { phone?: string }).phone ?? '',
    },
    relationships: { favorite_destinations: [], guided_trips: [] },
  };
}
```

- [ ] **Step 5: Run test to verify it passes** — `npx vitest run tests/normalize/acf-mappers.test.ts` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(pipeline): ACF mappers (domain -> normalized envelope)"`

---

### Task A3: Relationship matching engine (CPT graph)

**Files:**
- Create: `[demo] scripts/normalize/relationships.ts`
- Create: `[demo] tests/normalize/relationships.test.ts`

**Interfaces:**
- Consumes: arrays of `NormalizedItem` (destinations, trips, team) plus a product index `{ slug: string; categories: string[] }[]`; `seedFaker` for determinism.
- Produces:
  ```ts
  export interface ProductRef { slug: string; categories: string[]; }
  export function assignRelationships(input: {
    destinations: NormalizedItem[];
    trips: NormalizedItem[];
    team: NormalizedItem[];
    products: ProductRef[];
  }): void; // mutates .relationships arrays in place, seeded + deterministic
  ```
- Rules (all seeded via `seedFaker()` called once at start of `assignRelationships`):
  - **trip.related_destinations:** 2–4 destinations sharing the trip's `region`; if fewer than 2 in-region, fill from other regions (seeded). Reciprocal: each chosen destination gains the trip slug in `related_trips` (deduped).
  - **trip.required_gear / destination.recommended_gear:** map difficulty→categories (see `DIFFICULTY_GEAR` below), pick 3–5 product slugs whose `categories` intersect the mapped set; fallback to any products if the set is empty.
  - **team.favorite_destinations:** 3 destinations (seeded). **team.guided_trips:** 3 trips (seeded).
  - Every relationship array must end non-empty (guaranteed by fallbacks).

- [ ] **Step 1: Write the failing test** — `[demo] tests/normalize/relationships.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assignRelationships, ProductRef } from '../../scripts/normalize/relationships.js';
import { NormalizedItem } from '../../scripts/utils/types.js';

function dest(slug: string, region: string, difficulty: number): NormalizedItem {
  return { slug, post_title: slug, post_content: '', post_status: 'publish',
    acf: { region, difficulty }, relationships: { related_trips: [], recommended_gear: [] } };
}
function trip(slug: string, region: string, difficulty: number): NormalizedItem {
  return { slug, post_title: slug, post_content: '', post_status: 'publish',
    acf: { region, difficulty }, relationships: { related_destinations: [], required_gear: [] } };
}
function team(slug: string): NormalizedItem {
  return { slug, post_title: slug, post_content: '', post_status: 'publish',
    acf: {}, relationships: { favorite_destinations: [], guided_trips: [] } };
}

const products: ProductRef[] = [
  { slug: 'daypack-20l', categories: ['Backpacks & Bags'] },
  { slug: 'trail-shoe', categories: ['Footwear'] },
  { slug: 'ice-axe', categories: ['Climbing Gear'] },
  { slug: 'rope-60m', categories: ['Climbing Gear'] },
  { slug: 'down-bag', categories: ['Sleeping Systems'] },
];

describe('assignRelationships', () => {
  it('links trips to in-region destinations bidirectionally', () => {
    const destinations = [dest('d1', 'Rocky Mountains', 1), dest('d2', 'Rocky Mountains', 2), dest('d3', 'Sierra Nevada', 3)];
    const trips = [trip('t1', 'Rocky Mountains', 2)];
    assignRelationships({ destinations, trips, team: [], products });
    const rel = trips[0].relationships.related_destinations;
    expect(rel.length).toBeGreaterThanOrEqual(2);
    expect(rel.every((s) => ['d1', 'd2'].includes(s))).toBe(true);
    // reciprocity
    for (const s of rel) {
      const d = destinations.find((x) => x.slug === s)!;
      expect(d.relationships.related_trips).toContain('t1');
    }
  });

  it('assigns gear by difficulty->category and never empty', () => {
    const destinations = [dest('d1', 'Rocky Mountains', 5)];
    const trips = [trip('t1', 'Rocky Mountains', 5)];
    assignRelationships({ destinations, trips, team: [], products });
    expect(destinations[0].relationships.recommended_gear.length).toBeGreaterThanOrEqual(1);
    expect(trips[0].relationships.required_gear.length).toBeGreaterThanOrEqual(1);
    // difficulty 5 should favor Climbing Gear
    expect(trips[0].relationships.required_gear.some((s) => ['ice-axe', 'rope-60m'].includes(s))).toBe(true);
  });

  it('gives team members destinations and trips', () => {
    const destinations = [dest('d1', 'Rocky Mountains', 1), dest('d2', 'Sierra Nevada', 2), dest('d3', 'Desert Southwest', 3)];
    const trips = [trip('t1', 'Rocky Mountains', 2), trip('t2', 'Sierra Nevada', 3), trip('t3', 'Desert Southwest', 4)];
    const teamArr = [team('guide-1')];
    assignRelationships({ destinations, trips, team: teamArr, products });
    expect(teamArr[0].relationships.favorite_destinations.length).toBe(3);
    expect(teamArr[0].relationships.guided_trips.length).toBe(3);
  });

  it('is deterministic across runs', () => {
    const build = () => ({
      destinations: [dest('d1', 'Rocky Mountains', 1), dest('d2', 'Rocky Mountains', 2)],
      trips: [trip('t1', 'Rocky Mountains', 2)], team: [team('g1')], products,
    });
    const a = build(); assignRelationships(a);
    const b = build(); assignRelationships(b);
    expect(a.trips[0].relationships.related_destinations)
      .toEqual(b.trips[0].relationships.related_destinations);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/normalize/relationships.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `[demo] scripts/normalize/relationships.ts`:

```ts
import { faker } from '@faker-js/faker';
import { NormalizedItem } from '../utils/types.js';
import { seedFaker } from '../utils/seed.js';

export interface ProductRef { slug: string; categories: string[]; }

// difficulty (1-5) -> preferred product categories
const DIFFICULTY_GEAR: Record<number, string[]> = {
  1: ['Footwear', 'Backpacks & Bags', 'Navigation & Safety'],
  2: ['Backpacks & Bags', 'Footwear', 'Cooking & Hydration'],
  3: ['Backpacks & Bags', 'Sleeping Systems', 'Tents & Shelters'],
  4: ['Tents & Shelters', 'Sleeping Systems', 'Climbing Gear'],
  5: ['Climbing Gear', 'Winter & Snow', 'Tents & Shelters'],
};

function pickN<T>(pool: T[], n: number): T[] {
  if (pool.length <= n) return [...pool];
  return faker.helpers.arrayElements(pool, n);
}

function gearFor(difficulty: number, products: ProductRef[]): string[] {
  const cats = new Set(DIFFICULTY_GEAR[difficulty] ?? DIFFICULTY_GEAR[3]);
  let pool = products.filter((p) => p.categories.some((c) => cats.has(c)));
  if (pool.length === 0) pool = products;           // fallback: any product
  return pickN(pool, Math.min(5, Math.max(3, pool.length >= 3 ? 4 : pool.length)))
    .map((p) => p.slug);
}

export function assignRelationships(input: {
  destinations: NormalizedItem[];
  trips: NormalizedItem[];
  team: NormalizedItem[];
  products: ProductRef[];
}): void {
  const { destinations, trips, team, products } = input;
  seedFaker(); // deterministic selection

  // trip <-> destination (by region, with fallback), bidirectional
  for (const t of trips) {
    const region = t.acf.region as string;
    const inRegion = destinations.filter((d) => d.acf.region === region);
    const others = destinations.filter((d) => d.acf.region !== region);
    let chosen = pickN(inRegion, faker.number.int({ min: 2, max: 4 }));
    if (chosen.length < 2) chosen = chosen.concat(pickN(others, 2 - chosen.length));
    t.relationships.related_destinations = chosen.map((d) => d.slug);
    for (const d of chosen) {
      if (!d.relationships.related_trips.includes(t.slug)) {
        d.relationships.related_trips.push(t.slug);
      }
    }
  }
  // guarantee every destination has >=1 related trip (fallback: nearest trip by region)
  for (const d of destinations) {
    if (d.relationships.related_trips.length === 0 && trips.length > 0) {
      const region = d.acf.region as string;
      const t = trips.find((x) => x.acf.region === region) ?? faker.helpers.arrayElement(trips);
      d.relationships.related_trips.push(t.slug);
      if (!t.relationships.related_destinations.includes(d.slug)) {
        t.relationships.related_destinations.push(d.slug);
      }
    }
  }

  // gear
  for (const d of destinations) {
    d.relationships.recommended_gear = gearFor(d.acf.difficulty as number, products);
  }
  for (const t of trips) {
    t.relationships.required_gear = gearFor(t.acf.difficulty as number, products);
  }

  // team -> destinations + trips
  for (const m of team) {
    m.relationships.favorite_destinations = pickN(destinations, 3).map((d) => d.slug);
    m.relationships.guided_trips = pickN(trips, 3).map((t) => t.slug);
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/normalize/relationships.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(pipeline): deterministic relationship matcher (CPT graph)"`

---

### Task A4: Blog internal-link matcher

**Files:**
- Create: `[demo] scripts/normalize/blog-links.ts`
- Create: `[demo] tests/normalize/blog-links.test.ts`

**Interfaces:**
- Consumes: blog posts `{ slug: string; title: string; categories: string[]; tags: string[] }[]`, destination refs `{ slug; title; region }[]`, product refs `{ slug; title; categories }[]`, `seedFaker`.
- Produces:
  ```ts
  export interface BlogLinkTargets { blog_slug: string; targets: { slug: string; type: 'destination' | 'product'; label: string }[] }
  export function matchBlogLinks(input: {...}): BlogLinkTargets[]
  ```
- Rule: for each blog post, score destinations/products by keyword overlap between the post's `title + categories + tags` and the target's `title + categories`; take top 2–3 combined; if no overlap, seeded fallback ensures ≥1. Deterministic.

- [ ] **Step 1: Write the failing test** — `[demo] tests/normalize/blog-links.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchBlogLinks } from '../../scripts/normalize/blog-links.js';

const blogs = [
  { slug: 'winter-climbing-tips', title: 'Winter Climbing Tips', categories: ['Climbing'], tags: ['winter', 'climbing'] },
  { slug: 'random-musings', title: 'Random Musings', categories: [], tags: [] },
];
const destinations = [
  { slug: 'ice-peak', title: 'Ice Peak Winter Climb', region: 'Rocky Mountains' },
  { slug: 'sunny-meadow', title: 'Sunny Meadow Stroll', region: 'Desert Southwest' },
];
const products = [
  { slug: 'ice-axe', title: 'Pro Ice Axe', categories: ['Climbing Gear'] },
  { slug: 'sun-hat', title: 'Sun Hat', categories: ['Clothing'] },
];

describe('matchBlogLinks', () => {
  it('links a blog to topically related targets', () => {
    const out = matchBlogLinks({ blogs, destinations, products });
    const winter = out.find((o) => o.blog_slug === 'winter-climbing-tips')!;
    const slugs = winter.targets.map((t) => t.slug);
    expect(slugs).toContain('ice-peak');
    expect(slugs).toContain('ice-axe');
    expect(winter.targets.length).toBeGreaterThanOrEqual(2);
  });

  it('guarantees >=1 target via fallback when no overlap', () => {
    const out = matchBlogLinks({ blogs, destinations, products });
    const random = out.find((o) => o.blog_slug === 'random-musings')!;
    expect(random.targets.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/normalize/blog-links.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `[demo] scripts/normalize/blog-links.ts`:

```ts
import { faker } from '@faker-js/faker';
import { seedFaker } from '../utils/seed.js';

export interface BlogRef { slug: string; title: string; categories: string[]; tags: string[]; }
export interface DestRef { slug: string; title: string; region: string; }
export interface ProdRef { slug: string; title: string; categories: string[]; }
export interface BlogLinkTargets {
  blog_slug: string;
  targets: { slug: string; type: 'destination' | 'product'; label: string }[];
}

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3),
  );
}
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

export function matchBlogLinks(input: {
  blogs: BlogRef[]; destinations: DestRef[]; products: ProdRef[];
}): BlogLinkTargets[] {
  const { blogs, destinations, products } = input;
  seedFaker();
  const results: BlogLinkTargets[] = [];

  for (const blog of blogs) {
    const blogTokens = tokens([blog.title, ...blog.categories, ...blog.tags].join(' '));
    const scored: { slug: string; type: 'destination' | 'product'; label: string; score: number }[] = [];

    for (const d of destinations) {
      scored.push({ slug: d.slug, type: 'destination', label: d.title,
        score: overlap(blogTokens, tokens(`${d.title} ${d.region}`)) });
    }
    for (const p of products) {
      scored.push({ slug: p.slug, type: 'product', label: p.title,
        score: overlap(blogTokens, tokens(`${p.title} ${p.categories.join(' ')}`)) });
    }

    let top = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    if (top.length === 0) {
      // seeded fallback: one destination + one product
      const d = faker.helpers.arrayElement(destinations);
      const p = faker.helpers.arrayElement(products);
      top = [
        { slug: d.slug, type: 'destination', label: d.title, score: 0 },
        { slug: p.slug, type: 'product', label: p.title, score: 0 },
      ];
    }
    results.push({ blog_slug: blog.slug, targets: top.map(({ score, ...t }) => t) });
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/normalize/blog-links.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(pipeline): blog internal-link matcher"`

---

### Task A5: Wire seed + normalizer into generate-content

**Files:**
- Modify: `[demo] scripts/generate-content.ts`
- Modify: `[demo] scripts/generators/destinations.ts` (declare `relatedTrips: []`, `recommendedGear: []` in return), `[demo] scripts/generators/team.ts` (declare `favoriteDestinations: []`, `guidedTrips: []`)
- Create: `[demo] tests/normalize/pipeline.test.ts` (orchestration over fixtures, no AI calls)
- Create: `[demo] scripts/normalize/build-normalized.ts` (pure orchestration function, unit-testable without AI)

**Interfaces:**
- Produces in `build-normalized.ts`:
  ```ts
  export function buildNormalized(input: {
    destinations: Destination[]; trips: Trip[]; team: TeamMember[];
    products: ProductRef[];
    blogs: BlogRef[];
  }): {
    destinations: NormalizedItem[]; trips: NormalizedItem[]; team: NormalizedItem[];
    blogLinks: BlogLinkTargets[];
  }
  ```
  It maps domain→envelopes (A2), assigns relationships (A3), and matches blog links (A4). `generate-content.ts` calls generators (AI) then `buildNormalized`, then writes `destinations.json`, `trips.json`, `team.json` (normalized envelopes) and `blog-links.json`.

- [ ] **Step 1: Write the failing test** — `[demo] tests/normalize/pipeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildNormalized } from '../../scripts/normalize/build-normalized.js';

const destinations = [
  { title: 'Copper Lake', content: 'c', distance: 2.5, elevationGain: 550, difficulty: 1,
    trailType: 'out-and-back' as const, gps: '47,-121', permitRequired: false, bestSeasons: ['Spring'],
    region: 'Pacific Northwest' },
];
const trips = [
  { title: 'PNW Trek', content: 'c', duration: 3, difficulty: 2, price: 500,
    groupSize: { min: 4, max: 10 }, itinerary: [{ day: 1, activities: 'go' }], season: ['Summer'],
    region: 'Pacific Northwest', relatedDestinations: [], requiredGear: [] },
];
const team = [
  { name: 'Guide One', bio: 'b', yearsExperience: 5, certifications: ['WFR'], specialties: ['Nav'], email: 'g@x.com' },
];
const products = [{ slug: 'daypack', categories: ['Backpacks & Bags'] }];
const blogs = [{ slug: 'trek-tips', title: 'Trek Tips', categories: [], tags: [] }];

describe('buildNormalized', () => {
  it('produces complete envelopes with non-empty relationships', () => {
    const out = buildNormalized({ destinations, trips, team, products, blogs });
    expect(out.destinations[0].acf.difficulty).toBe(1);
    expect(out.trips[0].relationships.related_destinations).toContain('copper-lake');
    expect(out.destinations[0].relationships.related_trips).toContain('pnw-trek');
    expect(out.trips[0].relationships.required_gear.length).toBeGreaterThanOrEqual(1);
    expect(out.team[0].relationships.favorite_destinations.length).toBeGreaterThanOrEqual(1);
    expect(out.blogLinks[0].targets.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/normalize/pipeline.test.ts` → FAIL.

- [ ] **Step 3: Implement `build-normalized.ts`:**

```ts
import { Destination, Trip, TeamMember, NormalizedItem } from '../utils/types.js';
import { mapDestination, mapTrip, mapTeam } from './acf-mappers.js';
import { assignRelationships, ProductRef } from './relationships.js';
import { matchBlogLinks, BlogRef, BlogLinkTargets } from './blog-links.js';
import { slugify } from '../utils/seed.js';

export function buildNormalized(input: {
  destinations: Destination[]; trips: Trip[]; team: TeamMember[];
  products: ProductRef[]; blogs: BlogRef[];
}): { destinations: NormalizedItem[]; trips: NormalizedItem[]; team: NormalizedItem[]; blogLinks: BlogLinkTargets[] } {
  const destinations = input.destinations.map(mapDestination);
  const trips = input.trips.map(mapTrip);
  const team = input.team.map(mapTeam);

  assignRelationships({ destinations, trips, team, products: input.products });

  const destRefs = destinations.map((d) => ({ slug: d.slug, title: d.post_title, region: d.acf.region as string }));
  const prodRefs = input.products.map((p) => ({ slug: p.slug, title: p.slug, categories: p.categories }));
  const blogLinks = matchBlogLinks({ blogs: input.blogs, destinations: destRefs, products: prodRefs });

  return { destinations, trips, team, blogLinks };
}

export { slugify };
```

- [ ] **Step 4: Wire into `generate-content.ts`** — at the top of `main()` call `seedFaker()` (import from `./utils/seed.js`). After generating domain arrays, build a `ProductRef[]` from `products.json` (slug = `slugify(name)`, categories from product.categories) and a `BlogRef[]` from `posts.json`, call `buildNormalized`, and write `destinations.json`/`trips.json`/`team.json` from the normalized envelopes plus `blog-links.json`. (Products/pages/posts JSON continue to be written as today.)

- [ ] **Step 5: Update generators** — in `destinations.ts` return, add `relatedTrips: [], recommendedGear: []`; in `team.ts` return add `favoriteDestinations: [], guidedTrips: []` (keeps domain objects type-complete; matcher overwrites via envelopes).

- [ ] **Step 6: Run tests** — `npx vitest run` → all PASS.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(pipeline): orchestrate seed + normalize + relationships + blog links"`

---

### Task A6: `alpine-seeder` plugin — CPT registration; remove mu-plugin

**Files:**
- Create: `[demo] wordpress/plugins/alpine-seeder/alpine-seeder.php`
- Delete (on site): `wp-content/mu-plugins/alpine-custom-post-types.php`
- Test: manual via `wp_eval` assertions (documented commands)

**Interfaces:**
- Produces: registers CPTs `destination`, `trip`, `team` (public, `supports: title, editor, thumbnail, custom-fields`), and registers the `alpine` WP-CLI namespace (commands added in A8/A10). Sets ACF local JSON load point to the plugin's `acf-json/`.

- [ ] **Step 1: Implement plugin bootstrap** — `[demo] wordpress/plugins/alpine-seeder/alpine-seeder.php`:

```php
<?php
/**
 * Plugin Name: Alpine Seeder
 * Description: Registers Alpine Outfitters CPTs + ACF field groups and provides seeding WP-CLI commands.
 * Version: 1.0.0
 */
if (!defined('ABSPATH')) exit;

define('ALPINE_SEEDER_DIR', plugin_dir_path(__FILE__));

add_action('init', function () {
    $common = ['public' => true, 'show_in_rest' => true,
        'supports' => ['title', 'editor', 'thumbnail', 'custom-fields']];
    register_post_type('destination', $common + ['label' => 'Destinations']);
    register_post_type('trip', $common + ['label' => 'Trips']);
    register_post_type('team', $common + ['label' => 'Team']);
});

// Load ACF field groups from this plugin's acf-json (and save there in admin).
add_filter('acf/settings/load_json', function ($paths) {
    $paths[] = ALPINE_SEEDER_DIR . 'acf-json';
    return $paths;
});

if (defined('WP_CLI') && WP_CLI) {
    require_once ALPINE_SEEDER_DIR . 'includes/class-import-command.php';
    require_once ALPINE_SEEDER_DIR . 'includes/class-verify-command.php';
    WP_CLI::add_command('alpine import', 'Alpine_Import_Command');
    WP_CLI::add_command('alpine verify', 'Alpine_Verify_Command');
}
```

- [ ] **Step 2: Install + activate on the site.** Symlink the plugin into the site and activate; delete the old mu-plugin:

```bash
SITE=/Users/jeremy.pollock/PW-Local-Functional-Sites/alpine-outfitters/app/public
ln -sfn /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo/wordpress/plugins/alpine-seeder "$SITE/wp-content/plugins/alpine-seeder"
rm -f "$SITE/wp-content/mu-plugins/alpine-custom-post-types.php"
wp plugin activate alpine-seeder --path="$SITE"
```

- [ ] **Step 3: Verify CPTs still register from the plugin** (mu-plugin gone). Run:

```bash
wp eval 'echo (post_type_exists("destination")&&post_type_exists("trip")&&post_type_exists("team"))?"OK":"FAIL";' --path="$SITE"
```
Expected: `OK`. Also confirm `wp-content/mu-plugins/alpine-custom-post-types.php` no longer exists.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(seeder): alpine-seeder plugin registers CPTs; retire mu-plugin"`

---

### Task A7: ACF field groups via acf-json (full schema); remove empty DB groups

**Files:**
- Create: `[demo] wordpress/plugins/alpine-seeder/acf-json/group_destination.json`
- Create: `[demo] wordpress/plugins/alpine-seeder/acf-json/group_trip.json`
- Create: `[demo] wordpress/plugins/alpine-seeder/acf-json/group_team.json`

**Interfaces:**
- Produces three ACF local-JSON field groups keyed to post types `destination`/`trip`/`team`, with the exact field **names** used by the mappers (A2) and verify (A10). Field keys are stable strings `field_ao_<name>`.

- [ ] **Step 1: Delete the three empty DB field groups** (so acf-json is authoritative — avoids duplicate groups):

```bash
SITE=/Users/jeremy.pollock/PW-Local-Functional-Sites/alpine-outfitters/app/public
wp eval 'foreach (get_posts(["post_type"=>"acf-field-group","posts_per_page"=>-1,"post_status"=>"any"]) as $g){ wp_delete_post($g->ID, true); }' --path="$SITE"
```

- [ ] **Step 2: Write `group_destination.json`** (full destination schema):

```json
{
  "key": "group_ao_destination",
  "title": "Destination Details",
  "fields": [
    { "key": "field_ao_distance", "label": "Distance (miles)", "name": "distance", "type": "number", "step": "0.1", "append": "miles" },
    { "key": "field_ao_elevation_gain", "label": "Elevation Gain (feet)", "name": "elevation_gain", "type": "number", "append": "feet" },
    { "key": "field_ao_difficulty", "label": "Difficulty", "name": "difficulty", "type": "range", "min": 1, "max": 5, "default_value": 1 },
    { "key": "field_ao_trail_type", "label": "Trail Type", "name": "trail_type", "type": "select", "choices": { "loop": "Loop", "out-and-back": "Out-and-back", "point-to-point": "Point-to-point" } },
    { "key": "field_ao_trailhead_gps", "label": "Trailhead GPS", "name": "trailhead_gps", "type": "text" },
    { "key": "field_ao_permits_required", "label": "Permits Required", "name": "permits_required", "type": "true_false", "ui": 1 },
    { "key": "field_ao_permit_details", "label": "Permit Details", "name": "permit_details", "type": "textarea", "conditional_logic": [[{ "field": "field_ao_permits_required", "operator": "==", "value": "1" }]] },
    { "key": "field_ao_best_seasons", "label": "Best Seasons", "name": "best_seasons", "type": "checkbox", "choices": { "Spring": "Spring", "Summer": "Summer", "Fall": "Fall", "Winter": "Winter" } },
    { "key": "field_ao_dest_region", "label": "Region", "name": "region", "type": "select", "choices": { "Pacific Northwest": "Pacific Northwest", "Sierra Nevada": "Sierra Nevada", "Rocky Mountains": "Rocky Mountains", "Desert Southwest": "Desert Southwest", "Eastern Mountains": "Eastern Mountains" } },
    { "key": "field_ao_related_trips", "label": "Related Trips", "name": "related_trips", "type": "relationship", "post_type": ["trip"], "return_format": "id" },
    { "key": "field_ao_recommended_gear", "label": "Recommended Gear", "name": "recommended_gear", "type": "relationship", "post_type": ["product"], "return_format": "id" }
  ],
  "location": [[{ "param": "post_type", "operator": "==", "value": "destination" }]],
  "active": true
}
```

- [ ] **Step 3: Write `group_trip.json`** (full trip schema):

```json
{
  "key": "group_ao_trip",
  "title": "Trip Details",
  "fields": [
    { "key": "field_ao_duration", "label": "Duration (days)", "name": "duration", "type": "number", "append": "days" },
    { "key": "field_ao_trip_difficulty", "label": "Difficulty", "name": "difficulty", "type": "range", "min": 1, "max": 5, "default_value": 1 },
    { "key": "field_ao_price", "label": "Price", "name": "price", "type": "number", "prepend": "$" },
    { "key": "field_ao_group_size_min", "label": "Group Size Min", "name": "group_size_min", "type": "number" },
    { "key": "field_ao_group_size_max", "label": "Group Size Max", "name": "group_size_max", "type": "number" },
    { "key": "field_ao_itinerary", "label": "Itinerary", "name": "itinerary", "type": "repeater", "sub_fields": [
      { "key": "field_ao_itin_day", "label": "Day", "name": "day", "type": "number" },
      { "key": "field_ao_itin_activities", "label": "Activities", "name": "activities", "type": "textarea" }
    ] },
    { "key": "field_ao_season", "label": "Season", "name": "season", "type": "checkbox", "choices": { "Spring": "Spring", "Summer": "Summer", "Fall": "Fall", "Winter": "Winter" } },
    { "key": "field_ao_trip_region", "label": "Region", "name": "region", "type": "select", "choices": { "Pacific Northwest": "Pacific Northwest", "Sierra Nevada": "Sierra Nevada", "Rocky Mountains": "Rocky Mountains", "Desert Southwest": "Desert Southwest", "Eastern Mountains": "Eastern Mountains" } },
    { "key": "field_ao_related_destinations", "label": "Related Destinations", "name": "related_destinations", "type": "relationship", "post_type": ["destination"], "return_format": "id" },
    { "key": "field_ao_required_gear", "label": "Required Gear", "name": "required_gear", "type": "relationship", "post_type": ["product"], "return_format": "id" }
  ],
  "location": [[{ "param": "post_type", "operator": "==", "value": "trip" }]],
  "active": true
}
```

- [ ] **Step 4: Write `group_team.json`** (full team schema):

```json
{
  "key": "group_ao_team",
  "title": "Team Member Details",
  "fields": [
    { "key": "field_ao_years_experience", "label": "Years Experience", "name": "years_experience", "type": "number" },
    { "key": "field_ao_certifications", "label": "Certifications", "name": "certifications", "type": "repeater", "sub_fields": [
      { "key": "field_ao_cert", "label": "Certification", "name": "certification", "type": "text" }
    ] },
    { "key": "field_ao_specialties", "label": "Specialties", "name": "specialties", "type": "repeater", "sub_fields": [
      { "key": "field_ao_specialty", "label": "Specialty", "name": "specialty", "type": "text" }
    ] },
    { "key": "field_ao_email", "label": "Email", "name": "email", "type": "email" },
    { "key": "field_ao_phone", "label": "Phone", "name": "phone", "type": "text" },
    { "key": "field_ao_favorite_destinations", "label": "Favorite Destinations", "name": "favorite_destinations", "type": "relationship", "post_type": ["destination"], "return_format": "id" },
    { "key": "field_ao_guided_trips", "label": "Guided Trips", "name": "guided_trips", "type": "relationship", "post_type": ["trip"], "return_format": "id" }
  ],
  "location": [[{ "param": "post_type", "operator": "==", "value": "team" }]],
  "active": true
}
```

- [ ] **Step 5: Sync + verify field groups load.** ACF auto-loads local JSON. Confirm each group now has field definitions:

```bash
SITE=/Users/jeremy.pollock/PW-Local-Functional-Sites/alpine-outfitters/app/public
wp eval 'foreach (["group_ao_destination","group_ao_trip","group_ao_team"] as $k){ $f=acf_get_fields($k); echo $k.": ".count($f)." fields\n"; }' --path="$SITE"
```
Expected: destination 11, trip 10, team 7 (non-zero each). If ACF shows them as "sync available" in admin, that's fine — `acf_get_fields` on the key resolves from JSON.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(seeder): ACF field groups (full schema) via acf-json"`

---

### Task A8: `wp alpine import` — Pass 1 (posts + ACF)

**Files:**
- Create: `[demo] wordpress/plugins/alpine-seeder/includes/class-import-command.php`

**Interfaces:**
- Consumes: normalized JSON files in `--dir` (`destinations.json`, `trips.json`, `team.json`, `blog-links.json`).
- Produces: `wp alpine import [--type=all|destinations|trips|team|blog-links] [--dir=<path>]`. This task implements Pass 1 (posts + ACF) for the 3 CPTs; Pass 2 is Task A9.
- Post keying: `post_name = slug`. Idempotency: delete all existing posts of a CPT before recreating.

- [ ] **Step 1: Implement Pass 1** — `[demo] wordpress/plugins/alpine-seeder/includes/class-import-command.php`:

```php
<?php
if (!defined('ABSPATH')) exit;

class Alpine_Import_Command {
    private $cpt_files = [
        'destination' => 'destinations.json',
        'trip'        => 'trips.json',
        'team'        => 'team.json',
    ];

    public function __invoke($args, $assoc) {
        $dir  = rtrim($assoc['dir'] ?? getcwd(), '/');
        $type = $assoc['type'] ?? 'all';

        $types = $type === 'all' ? array_keys($this->cpt_files) : [$type];
        // Pass 1 for each requested CPT
        foreach ($types as $t) {
            if (isset($this->cpt_files[$t])) $this->pass1($t, $dir);
        }
        // Pass 2 (relationships) — implemented in Task A9
        foreach ($types as $t) {
            if (isset($this->cpt_files[$t])) $this->pass2($t, $dir);
        }
        if ($type === 'all' || $type === 'blog-links') $this->inject_blog_links($dir);

        WP_CLI::success('Import complete.');
    }

    private function load($dir, $file) {
        $path = "$dir/$file";
        if (!file_exists($path)) WP_CLI::error("Missing file: $path");
        $data = json_decode(file_get_contents($path), true);
        if (!is_array($data)) WP_CLI::error("Invalid JSON: $path");
        return $data;
    }

    private function pass1($cpt, $dir) {
        $items = $this->load($dir, $this->cpt_files[$cpt]);
        // idempotent: delete existing posts of this type
        foreach (get_posts(['post_type' => $cpt, 'posts_per_page' => -1, 'post_status' => 'any', 'fields' => 'ids']) as $id) {
            wp_delete_post($id, true);
        }
        foreach ($items as $item) {
            $post_id = wp_insert_post([
                'post_type'    => $cpt,
                'post_title'   => $item['post_title'],
                'post_content' => $item['post_content'],
                'post_status'  => $item['post_status'] ?? 'publish',
                'post_name'    => $item['slug'],
            ], true);
            if (is_wp_error($post_id)) WP_CLI::error("Insert failed for {$item['slug']}: " . $post_id->get_error_message());
            foreach (($item['acf'] ?? []) as $name => $value) {
                update_field($name, $value, $post_id);   // correct ACF serialization + field-key refs
            }
        }
        WP_CLI::log("Pass 1 ($cpt): " . count($items) . " posts.");
    }

    // pass2() implemented in Task A9
    private function pass2($cpt, $dir) {}
    // inject_blog_links() implemented in Task A9
    private function inject_blog_links($dir) {}
}
```

- [ ] **Step 2: Test Pass 1 with a tiny fixture.** Create `/tmp/alpine-fixture/destinations.json`:

```json
[{ "slug": "test-lake", "post_title": "Test Lake", "post_content": "prose", "post_status": "publish",
   "acf": { "distance": 2.5, "elevation_gain": 550, "difficulty": 1, "trail_type": "out-and-back",
            "trailhead_gps": "47,-121", "permits_required": false, "permit_details": "",
            "best_seasons": ["Spring","Fall"], "region": "Pacific Northwest" },
   "relationships": { "related_trips": [], "recommended_gear": [] } }]
```

- [ ] **Step 3: Run Pass 1 and assert ACF stored correctly:**

```bash
SITE=/Users/jeremy.pollock/PW-Local-Functional-Sites/alpine-outfitters/app/public
wp alpine import --type=destinations --dir=/tmp/alpine-fixture --path="$SITE"
wp eval '$p=get_page_by_path("test-lake","OBJECT","destination"); echo "diff=".get_field("difficulty",$p->ID)." seasons=".json_encode(get_field("best_seasons",$p->ID))." permits=".var_export(get_field("permits_required",$p->ID),true);' --path="$SITE"
```
Expected: `diff=1 seasons=["Spring","Fall"] permits=false` (real array, not double-serialized).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(seeder): wp alpine import Pass 1 (posts + ACF via update_field)"`

---

### Task A9: `wp alpine import` — Pass 2 (relationships) + blog links

**Files:**
- Modify: `[demo] wordpress/plugins/alpine-seeder/includes/class-import-command.php` (implement `pass2` + `inject_blog_links`)

**Interfaces:**
- Consumes: `relationships` slug arrays on each item; `blog-links.json` (`[{ blog_slug, targets:[{slug,type,label}] }]`).
- Behavior: resolve each target slug → post ID via `get_page_by_path(slug, OBJECT, <expected_type>)`; `update_field(rel_field, [ids], $post_id)`. Blog injection: find blog post by slug (fallback: match by title), strip prior `<div class="alpine-internal-link">…</div>`, append a fresh block, `wp_update_post`.
- Relationship field → target post type map (for slug resolution):
  `related_trips→trip`, `related_destinations→destination`, `recommended_gear→product`, `required_gear→product`, `favorite_destinations→destination`, `guided_trips→trip`.

- [ ] **Step 1: Implement `pass2` + `inject_blog_links`** (replace the stub methods):

```php
    private $rel_target_type = [
        'related_trips' => 'trip', 'related_destinations' => 'destination',
        'recommended_gear' => 'product', 'required_gear' => 'product',
        'favorite_destinations' => 'destination', 'guided_trips' => 'trip',
    ];

    private function resolve_slug($slug, $type) {
        $p = get_page_by_path($slug, OBJECT, $type);
        return $p ? (int) $p->ID : 0;
    }

    private function pass2($cpt, $dir) {
        $items = $this->load($dir, $this->cpt_files[$cpt]);
        foreach ($items as $item) {
            $post = get_page_by_path($item['slug'], OBJECT, $cpt);
            if (!$post) continue;
            foreach (($item['relationships'] ?? []) as $field => $slugs) {
                $target_type = $this->rel_target_type[$field] ?? null;
                if (!$target_type) continue;
                $ids = array_values(array_filter(array_map(
                    fn($s) => $this->resolve_slug($s, $target_type), $slugs
                )));
                update_field($field, $ids, $post->ID);
            }
        }
        WP_CLI::log("Pass 2 ($cpt): relationships resolved.");
    }

    private function inject_blog_links($dir) {
        $links = $this->load($dir, 'blog-links.json');
        foreach ($links as $entry) {
            $blog = get_page_by_path($entry['blog_slug'], OBJECT, 'post');
            if (!$blog) { // fallback: match by title-derived slug
                $q = get_posts(['post_type' => 'post', 'name' => $entry['blog_slug'], 'posts_per_page' => 1]);
                $blog = $q ? $q[0] : null;
            }
            if (!$blog) continue;

            // strip prior injected block (idempotent)
            $content = preg_replace('#<div class="alpine-internal-link">.*?</div>#s', '', $blog->post_content);

            $lis = '';
            foreach ($entry['targets'] as $t) {
                $target = get_page_by_path($t['slug'], OBJECT, $t['type']);
                if (!$target) continue;
                $url = get_permalink($target->ID);
                $label = esc_html($t['label']);
                $lis .= "<li><a href=\"" . esc_url($url) . "\">$label</a></li>";
            }
            if ($lis === '') continue;
            $block = '<div class="alpine-internal-link"><h3>Related</h3><ul>' . $lis . '</ul></div>';

            wp_update_post(['ID' => $blog->ID, 'post_content' => rtrim($content) . "\n\n" . $block]);
        }
        WP_CLI::log('Blog internal links injected.');
    }
```

- [ ] **Step 2: Test Pass 2 with a fixture** that references the `test-lake` destination from A8. Add `/tmp/alpine-fixture/trips.json`:

```json
[{ "slug": "test-trek", "post_title": "Test Trek", "post_content": "p", "post_status": "publish",
   "acf": { "duration": 3, "difficulty": 2, "price": 500, "group_size_min": 4, "group_size_max": 10,
            "itinerary": [{ "day": 1, "activities": "go" }], "season": ["Summer"], "region": "Pacific Northwest" },
   "relationships": { "related_destinations": ["test-lake"], "required_gear": [] } }]
```

- [ ] **Step 3: Run import + assert relationship resolved to an ID:**

```bash
SITE=/Users/jeremy.pollock/PW-Local-Functional-Sites/alpine-outfitters/app/public
wp alpine import --type=all --dir=/tmp/alpine-fixture --path="$SITE"
wp eval '$t=get_page_by_path("test-trek","OBJECT","trip"); $r=get_field("related_destinations",$t->ID); echo "rel=".json_encode($r); $lake=get_page_by_path("test-lake","OBJECT","destination"); echo " id=".$lake->ID;' --path="$SITE"
```
Expected: `rel=[<id>]` where `<id>` equals `test-lake`'s ID (resolution + write correct).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(seeder): wp alpine import Pass 2 (relationships + blog links)"`

---

### Task A10: `wp alpine verify` — the gate

**Files:**
- Create: `[demo] wordpress/plugins/alpine-seeder/includes/class-verify-command.php`

**Interfaces:**
- Produces: `wp alpine verify [--expect-destinations=40 --expect-trips=30 --expect-team=12]`. Exits non-zero (`WP_CLI::error`) on any failure. Assertions per the spec's Verification gate.

- [ ] **Step 1: Implement verify** — `[demo] wordpress/plugins/alpine-seeder/includes/class-verify-command.php`:

```php
<?php
if (!defined('ABSPATH')) exit;

class Alpine_Verify_Command {
    public function __invoke($args, $assoc) {
        $errors = [];
        $expect = [
            'destination' => (int)($assoc['expect-destinations'] ?? 40),
            'trip'        => (int)($assoc['expect-trips'] ?? 30),
            'team'        => (int)($assoc['expect-team'] ?? 12),
        ];
        $required = [
            'destination' => ['distance','elevation_gain','difficulty','trail_type','best_seasons','region'],
            'trip'        => ['duration','difficulty','price','group_size_min','group_size_max','itinerary','season','region'],
            'team'        => ['years_experience','certifications','specialties','email'],
        ];
        $rels = [
            'destination' => ['related_trips','recommended_gear'],
            'trip'        => ['related_destinations','required_gear'],
            'team'        => ['favorite_destinations','guided_trips'],
        ];

        // field-group definitions exist
        foreach (['group_ao_destination','group_ao_trip','group_ao_team'] as $g) {
            if (count(acf_get_fields($g)) === 0) $errors[] = "Field group $g has no field definitions.";
        }

        foreach ($expect as $cpt => $count) {
            $posts = get_posts(['post_type'=>$cpt,'posts_per_page'=>-1,'post_status'=>'publish']);
            if (count($posts) !== $count) $errors[] = "$cpt count " . count($posts) . " != expected $count";
            foreach ($posts as $p) {
                foreach ($required[$cpt] as $f) {
                    $v = get_field($f, $p->ID);
                    if ($v === null || $v === '' || $v === false || (is_array($v) && count($v) === 0)) {
                        $errors[] = "$cpt #{$p->ID} missing field '$f'";
                    }
                }
                foreach ($rels[$cpt] as $rf) {
                    $v = get_field($rf, $p->ID);
                    if (!is_array($v) || count($v) === 0) $errors[] = "$cpt #{$p->ID} missing relationship '$rf'";
                }
            }
        }

        // arrays real (no double-serialization): a destination's best_seasons must be an array
        $d = get_posts(['post_type'=>'destination','posts_per_page'=>1,'post_status'=>'publish']);
        if ($d) {
            $bs = get_field('best_seasons', $d[0]->ID);
            if (!is_array($bs)) $errors[] = "best_seasons is not an array (serialization bug)";
        }

        // every blog post has an injected link block
        $blogs = get_posts(['post_type'=>'post','posts_per_page'=>-1,'post_status'=>'publish']);
        foreach ($blogs as $b) {
            if (strpos($b->post_content, 'alpine-internal-link') === false) {
                $errors[] = "blog #{$b->ID} has no injected internal-link block";
            }
        }

        if ($errors) {
            foreach ($errors as $e) WP_CLI::log("FAIL: $e");
            WP_CLI::error(count($errors) . ' verification failures.');
        }
        WP_CLI::success('All Alpine data verified.');
    }
}
```

- [ ] **Step 2: Test the gate fails on bad data, passes on good.** With only the tiny `/tmp/alpine-fixture` imported, run verify with matching expectations to see it pass on populated fields but fail on counts:

```bash
SITE=/Users/jeremy.pollock/PW-Local-Functional-Sites/alpine-outfitters/app/public
wp alpine verify --expect-destinations=1 --expect-trips=1 --expect-team=0 --path="$SITE" ; echo "exit=$?"
```
Expected while only the fixture is loaded: non-zero exit (team=0 but relationships/blogs likely fail) — confirms the gate detects gaps. (Full green happens in Task C1 after the real import.)

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(seeder): wp alpine verify gate"`

---

## PART B — Addon: domain-agnostic hybrid search (`local-addon-nexus-ai`)

### Task B1: Generic metadata filters in searchHybrid

**Files:**
- Modify: `[addon] src/common/types.ts` (SearchOptions.metadataFilters)
- Modify: `[addon] src/main/vector-store/SqliteVecStore.ts` (searchHybrid filter block + remove boost)
- Create: `[addon] tests/unit/mcp/hybrid-generic-filters.test.ts`

**Interfaces:**
- Produces new type:
  ```ts
  export type MetadataFilterOp = 'eq'|'ne'|'lt'|'lte'|'gt'|'gte'|'contains';
  export interface MetadataFilter { field: string; op: MetadataFilterOp; value: string | number; }
  // SearchOptions.metadataFilters?: MetadataFilter[]
  export function applyMetadataFilters(custom: Record<string, unknown>, filters: MetadataFilter[]): boolean;
  ```
- `applyMetadataFilters` returns true if the doc passes ALL filters. Missing field → fail-closed (returns false) for every op. Numeric comparison when both the field value and filter value parse as finite numbers; otherwise string comparison. `contains` = case-insensitive substring.
- Remove the difficulty boost entirely; hybrid ranking stays pure normalized RRF.

- [ ] **Step 1: Write the failing test** — `[addon] tests/unit/mcp/hybrid-generic-filters.test.ts`:

```ts
import { applyMetadataFilters } from '../../../src/main/vector-store/SqliteVecStore';

describe('applyMetadataFilters (generic, domain-agnostic)', () => {
  const doc = { difficulty: '2', distance: '4.5', region: 'Rocky Mountains' };

  it('numeric lte passes and fails correctly', () => {
    expect(applyMetadataFilters(doc, [{ field: 'difficulty', op: 'lte', value: 2 }])).toBe(true);
    expect(applyMetadataFilters(doc, [{ field: 'difficulty', op: 'lte', value: 1 }])).toBe(false);
  });

  it('numeric gt/lt on distance', () => {
    expect(applyMetadataFilters(doc, [{ field: 'distance', op: 'lt', value: 5 }])).toBe(true);
    expect(applyMetadataFilters(doc, [{ field: 'distance', op: 'gt', value: 5 }])).toBe(false);
  });

  it('string eq and contains', () => {
    expect(applyMetadataFilters(doc, [{ field: 'region', op: 'eq', value: 'Rocky Mountains' }])).toBe(true);
    expect(applyMetadataFilters(doc, [{ field: 'region', op: 'contains', value: 'rocky' }])).toBe(true);
    expect(applyMetadataFilters(doc, [{ field: 'region', op: 'ne', value: 'Sierra Nevada' }])).toBe(true);
  });

  it('missing field fails closed', () => {
    expect(applyMetadataFilters(doc, [{ field: 'elevation_gain', op: 'lte', value: 1000 }])).toBe(false);
  });

  it('ALL filters must pass (AND semantics)', () => {
    expect(applyMetadataFilters(doc, [
      { field: 'difficulty', op: 'lte', value: 2 },
      { field: 'distance', op: 'lte', value: 5 },
    ])).toBe(true);
    expect(applyMetadataFilters(doc, [
      { field: 'difficulty', op: 'lte', value: 2 },
      { field: 'distance', op: 'lte', value: 3 },
    ])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `cd [addon] && npx jest tests/unit/mcp/hybrid-generic-filters.test.ts` → FAIL (export missing).

- [ ] **Step 3: Update the type** in `[addon] src/common/types.ts` — replace the current hiking-specific `metadataFilters` on `SearchOptions` with:

```ts
export type MetadataFilterOp = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains';
export interface MetadataFilter { field: string; op: MetadataFilterOp; value: string | number; }
// in SearchOptions:
//   metadataFilters?: MetadataFilter[];
```
(Remove the old `{ minDifficulty; maxDifficulty; maxDistance; maxElevation }` shape.)

- [ ] **Step 4: Implement + export `applyMetadataFilters`** in `[addon] src/main/vector-store/SqliteVecStore.ts` (module-level export) and use it in `searchHybrid`, replacing the hardcoded filter block (current lines ~382–404) and removing the difficulty boost (current lines ~406–408):

```ts
export function applyMetadataFilters(
  custom: Record<string, unknown>,
  filters: import('../../common/types').MetadataFilter[],
): boolean {
  for (const f of filters) {
    if (!(f.field in custom)) return false;             // fail-closed
    const raw = custom[f.field];
    const rawStr = String(raw);
    const numDoc = Number(rawStr);
    const numFilter = Number(f.value);
    const bothNumeric = Number.isFinite(numDoc) && Number.isFinite(numFilter);
    let ok: boolean;
    switch (f.op) {
      case 'eq':  ok = bothNumeric ? numDoc === numFilter : rawStr === String(f.value); break;
      case 'ne':  ok = bothNumeric ? numDoc !== numFilter : rawStr !== String(f.value); break;
      case 'lt':  ok = bothNumeric && numDoc <  numFilter; break;
      case 'lte': ok = bothNumeric && numDoc <= numFilter; break;
      case 'gt':  ok = bothNumeric && numDoc >  numFilter; break;
      case 'gte': ok = bothNumeric && numDoc >= numFilter; break;
      case 'contains': ok = rawStr.toLowerCase().includes(String(f.value).toLowerCase()); break;
      default: ok = false;
    }
    if (!ok) return false;
  }
  return true;
}
```

In `searchHybrid`, inside the candidate loop, replace the old filter block with:

```ts
      const meta = JSON.parse(doc.metadata);
      const custom = meta.customFields ?? {};
      if (options.metadataFilters && options.metadataFilters.length > 0
          && !applyMetadataFilters(custom, options.metadataFilters)) {
        continue;
      }
      // (difficulty boost removed — ranking is pure normalized RRF)
```

- [ ] **Step 5: Run test to verify it passes** — `npx jest tests/unit/mcp/hybrid-generic-filters.test.ts` → PASS. Also run existing hybrid tests: `npx jest tests/unit -t hybrid` (update any test asserting the old filter shape).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(search): generic domain-agnostic metadata filters; remove difficulty boost"`

---

### Task B2: MCP tool — generic filter schema + expose customFields

**Files:**
- Modify: `[addon] src/main/mcp/modules/content/search-content.ts`
- Create: `[addon] tests/unit/mcp/search-content-format.test.ts`

**Interfaces:**
- Consumes: `MetadataFilter[]` (B1), `SearchResult.metadata` (JSON with `customFields`).
- Produces: the `search_site_content` tool accepts `metadataFilters: MetadataFilter[]`; result formatting includes each result's `customFields`. Extract a pure `formatCustomFields(metadataJson: string): string` for testing.

- [ ] **Step 1: Write the failing test** — `[addon] tests/unit/mcp/search-content-format.test.ts`:

```ts
import { formatCustomFields } from '../../../src/main/mcp/modules/content/search-content';

describe('formatCustomFields', () => {
  it('renders customFields compactly', () => {
    const meta = JSON.stringify({ customFields: { difficulty: '2', distance: '4.5', region: 'Rocky Mountains' } });
    const out = formatCustomFields(meta);
    expect(out).toContain('difficulty: 2');
    expect(out).toContain('distance: 4.5');
    expect(out).toContain('region: Rocky Mountains');
  });

  it('returns empty string when no customFields', () => {
    expect(formatCustomFields(JSON.stringify({ excerpt: 'x' }))).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest tests/unit/mcp/search-content-format.test.ts` → FAIL.

- [ ] **Step 3: Implement `formatCustomFields` + wire into the tool** in `[addon] src/main/mcp/modules/content/search-content.ts`:

```ts
export function formatCustomFields(metadataJson: string): string {
  let meta: any;
  try { meta = JSON.parse(metadataJson); } catch { return ''; }
  const cf = meta?.customFields;
  if (!cf || typeof cf !== 'object') return '';
  const entries = Object.entries(cf)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : String(v)}`);
  return entries.length ? `   fields: ${entries.join(', ')}` : '';
}
```
Add to the result `.map(...)` a line appending `formatCustomFields(r.metadata)` when non-empty. Update the tool `inputSchema.properties.metadataFilters` to the generic array shape:

```ts
        metadataFilters: {
          type: 'array',
          description: 'Generic structured filters over indexed custom fields. Each: {field, op, value}. op ∈ eq/ne/lt/lte/gt/gte/contains. All must pass (AND). Missing field fails closed.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: ['eq','ne','lt','lte','gt','gte','contains'] },
              value: { type: ['string','number'] },
            },
            required: ['field','op','value'],
          },
        },
```
And pass `metadataFilters: args.metadataFilters as MetadataFilter[] | undefined` into `vectorStore.search`. Update the tool description to mention it returns `customFields` for agent reasoning.

- [ ] **Step 4: Run test to verify it passes** — `npx jest tests/unit/mcp/search-content-format.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(search): generic metadataFilters schema + expose customFields in results"`

---

## PART C — Integration & validation

### Task C1: Regenerate, import, verify (in Local)

**Files:** none (operational task; gated by `wp alpine verify`).

- [ ] **Step 1: Ensure the site is running** (`local_start_site` / Local UI) and the `alpine-seeder` plugin is active (Task A6).

- [ ] **Step 2: Generate normalized content.** In `[demo]`, with `.env` API key set:

```bash
cd /Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo
npx tsx scripts/generate-content.ts --type=destinations
npx tsx scripts/generate-content.ts --type=trips
npx tsx scripts/generate-content.ts --type=team
```
(Products/pages/posts JSON already exist and are reused; regenerate only if desired.) Confirm `data/destinations.json`, `data/trips.json`, `data/team.json`, `data/blog-links.json` now use the normalized envelope (spot-check one file has `acf` + `relationships` + `slug`).

- [ ] **Step 3: Commit the generated JSON** (canonical artifact): `git add data/*.json && git commit -m "chore(data): regenerate normalized destination/trip/team + blog links"`

- [ ] **Step 4: Import into WordPress:**

```bash
SITE=/Users/jeremy.pollock/PW-Local-Functional-Sites/alpine-outfitters/app/public
DATA=/Users/jeremy.pollock/development/wpengine/alpine-outfitters-demo/data
wp alpine import --type=all --dir="$DATA" --path="$SITE"
```

- [ ] **Step 5: Run the gate:**

```bash
wp alpine verify --expect-destinations=40 --expect-trips=30 --expect-team=12 --path="$SITE" ; echo "exit=$?"
```
Expected: `All Alpine data verified.` and `exit=0`. If it fails, fix the reported items (this is the loop) before proceeding.

- [ ] **Step 6: Spot-check in WP admin** that a destination, a trip, and a team member show fully populated ACF fields (proves field groups are real). Record confirmation.

---

### Task C2: Reindex + validate hybrid search & graph traversal

**Files:** none (operational; validates the whole system end-to-end).

- [ ] **Step 1: Build + reload the addon** so B1/B2 are live:

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai
./dev-reload.sh      # build + rebuild (Electron) + relaunch Local
```
Wait ~45s for Local + MCP to come up.

- [ ] **Step 2: Reindex Alpine Outfitters** (via Nexus MCP `reindex_site` or CLI). Confirm ~350 docs indexed and that a destination's `customFields` now include `difficulty`, `distance`, `elevation_gain`, `region`.

- [ ] **Step 3: Validate generic hybrid filter.** Run `search_site_content` with:
  `{ site: "Alpine Outfitters", query: "scenic hiking", searchMode: "hybrid", postType: "destination", metadataFilters: [{ field: "difficulty", op: "lte", value: 2 }] }`.
  Expected: only difficulty ≤ 2 destinations returned; each result shows `fields: difficulty: …, region: …`. Confirm no hiking-specific code paths (grep the addon for `distance_miles`, `elevation_gain_ft`, and the removed boost — should be zero matches).

- [ ] **Step 4: Validate graph traversal.** Pick one trip; via `wp_eval` confirm `related_destinations` → destination IDs, each destination's `recommended_gear` → product IDs, and a team member's `guided_trips` → trip IDs. Record a short traversal example (trip → destinations → gear).

- [ ] **Step 5: Final commit (docs).** If any addon test snapshots or docs changed, commit: `git add -A && git commit -m "test(search): validate generic hybrid filters against Alpine data"`.

---

## Self-Review

**Spec coverage:**
- ACF schema (full) → A7 (all 3 groups, all fields). ✅
- Normalized JSON contract → A2 (envelope) + A5 (writing). ✅
- Generators: seed, slug, relationships-by-slug → A1, A5, A3. ✅
- Importer plugin: CPTs, acf-json, two-pass, idempotency → A6, A7, A8, A9. ✅
- Relationship matching (region/gear/team/blog, reciprocity, fallback) → A3, A4, A9. ✅
- Reproducibility model (committed JSON, seed) → A1, C1 step 3. ✅
- Addon generic filters (A) + expose customFields (B) + remove hardcoded names/boost → B1, B2. ✅
- Verify gate → A10; run at C1. ✅
- Testing (demo unit tests + addon unit tests) → A1–A5, B1, B2. ✅
- Success criteria (verify green, admin shows fields, reindex, generic filter narrows, traversal) → C1, C2. ✅
- Risks: CPT registration consolidation → A6; empty ACF groups removed → A7; product categories for gear → A3 (DIFFICULTY_GEAR uses real categories); native module/reload → C2. ✅

**Placeholder scan:** No TBD/TODO; every code step has real code; `pass2`/`inject_blog_links` are explicit stubs in A8 *only because* A9 implements them (same file, sequenced) — noted inline. ✅

**Type consistency:** ACF field names identical across A2 (mappers), A7 (acf-json `name`), A9 (`rel_target_type` keys), A10 (verify). Relationship field names (`related_trips`, `related_destinations`, `recommended_gear`, `required_gear`, `favorite_destinations`, `guided_trips`) consistent across A3/A7/A9/A10. `NormalizedItem` shape consistent A2→A3→A5. `MetadataFilter`/`applyMetadataFilters` consistent B1→B2. ✅

---

## Notes / risks carried from the spec

- `get_page_by_path()` resolves a CPT slug when the plugin registered the CPT (A6) before import — ensure plugin active first.
- If ACF admin shows field groups as "Sync available" rather than active, `acf_get_fields('group_ao_*')` still resolves from JSON; the A7 step deletes DB groups so there is no conflicting definition.
- Demo repo has no test runner today; A1 adds Vitest. Addon uses Jest (system Node; run `npm install` context, not the Electron rebuild).
- Blog slug resolution falls back to `name` query then title; unique blog titles make collisions unlikely.
