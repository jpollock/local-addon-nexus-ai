# Cedar & Vale WordPress Seeder and Import — Implementation Plan (Plan 1c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 840 normalized JSON items Plan 1b produces into a running WordPress site at `cedarvale.local` — six post types, seven taxonomies, 59 registered field slots (54 ACF across 44 distinct names, plus 5 relationship keys), resolved relationships, JSON-LD, and a verify gate that refuses to call the import a success when it is not.

**Architecture:** A WordPress plugin (`cedar-vale-seeder`) registers the content model and exposes two WP-CLI commands, `cedar import` and `cedar verify`. The ACF field groups are **generated** from the TypeScript contract Plan 1b already exports (`ACF_FIELD_NAMES`, `RELATIONSHIP_TARGETS`) into ACF's own `acf-json` export format, so registration cannot drift from what the mappers emit and the groups stay portable to Alpine. The import is two-pass: pass 1 upserts every post and writes scalar ACF plus taxonomy terms; pass 2 resolves relationship slugs to post IDs once every post exists.

**Tech Stack:** PHP 8.2 (WordPress plugin), WordPress 6.8+, ACF Pro 6.8.6, WP-CLI, TypeScript + vitest (the generator and its drift test), Local by WP Engine.

## Global Constraints

- **ACF Pro is 6.8.6**, installed from `~/Downloads/plugins/advanced-custom-fields-pro.zip` — the same version live on Alpine Outfitters. Field groups must load against 6.8.6 so a group exported from one site imports cleanly into the other.
- **The plugin is the only thing that registers the content model.** No theme, no mu-plugin, no manual admin clicks. A site rebuilt from scratch must reach the identical state by activating this plugin and running the two commands.
- **Post types and taxonomies are registered from one config array**, not six near-identical `register_post_type()` calls.
- **`slug` is the identity key** across the whole import. Every item is upserted by `(post_type, post_name)`. Running the import twice must leave the database identical to running it once.
- **Rewrite rules must be flushed after post types are registered.** Alpine's custom post types returned 404 on every permalink because `rewrite_rules` held 191 rules and not one belonged to a CPT. This is the single most likely way this plan produces a broken site.
- **Never fabricate a value to make a record importable.** A missing ACF value is written as empty/absent, never as a plausible default. An unresolvable relationship slug is a hard error naming the slug, never a silently dropped reference.
- **The generated `acf-json` is committed and regenerable**, with a test asserting the committed files match what the generator produces.
- Never `git push`, `npm version`, or `git tag` — commits only.
- No test may require network access. Tests that need WordPress are integration tests run explicitly against `cedarvale.local`, and are separated from the unit suite.

---

## File Structure

```
cedar-vale-health-demo/
  wordpress/
    plugins/
      cedar-vale-seeder/
        cedar-vale-seeder.php        Task 1  plugin header, bootstrap, activation hook
        inc/
          content-model.php          Task 1  the CPT + taxonomy config array and registration
          acf-loader.php             Task 3  points ACF at acf-json/, asserts the groups loaded
          importer.php               Tasks 4-5  two-pass import
          jsonld.php                 Task 6  schema.org output on wp_head
          verify.php                 Task 7  the gate
          cli.php                    Task 7  `wp cedar import` / `wp cedar verify`
        acf-json/                    Task 2  GENERATED — six group_*.json files, committed
  scripts/
    src/
      acf/
        field-types.ts               Task 2  the ACF type/label/config per field name
        generate-acf-json.ts         Task 2  contract + field-types -> acf-json
        generate-acf-json.test.ts    Task 2  drift guard + coverage of all 44 distinct names
```

Mirrors Alpine's `wordpress/plugins/` + `wordpress/themes/` layout, so the same symlink and preflight-script conventions apply when the site is created.

---

### Task 1: Plugin scaffold, content model, and the rewrite flush

**Files:**
- Create: `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/cedar-vale-seeder.php`
- Create: `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/inc/content-model.php`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CEDAR_VALE_POST_TYPES` and `CEDAR_VALE_TAXONOMIES` config arrays
  - `cedar_vale_register_content_model()` hooked to `init`
  - `cedar_vale_activate()` on the activation hook, which registers then flushes

Six post types. `post` is WordPress core and is **not** registered here — it is reused for patient-education articles, which is why the manifest's `post` entries map onto it directly.

- [ ] **Step 1: Write the plugin bootstrap**

```php
<?php
/**
 * Plugin Name: Cedar & Vale Seeder
 * Description: Registers the Cedar & Vale content model and imports the generated corpus.
 * Version: 1.0.0
 * Requires PHP: 8.2
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'CEDAR_VALE_DIR', plugin_dir_path( __FILE__ ) );

require_once CEDAR_VALE_DIR . 'inc/content-model.php';

add_action( 'init', 'cedar_vale_register_content_model' );

/**
 * Rewrite rules are generated from the registered post types, so they must be
 * rebuilt AFTER registration — not before, and not on every request. Alpine
 * Outfitters shipped with 191 rewrite rules and none for its custom post types,
 * so every CPT permalink returned 404 while the posts themselves were fine.
 */
function cedar_vale_activate(): void {
	cedar_vale_register_content_model();
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, 'cedar_vale_activate' );

function cedar_vale_deactivate(): void {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'cedar_vale_deactivate' );
```

- [ ] **Step 2: Write the content model config**

```php
<?php
declare( strict_types = 1 );

/**
 * One config array, not six register_post_type() calls. `show_in_rest` is on for
 * every type because the Block Bindings API in the later theme plan reads these
 * through REST, and turning it on afterwards is a silent no-op until caches clear.
 */
const CEDAR_VALE_POST_TYPES = [
	'location'       => [ 'plural' => 'Locations',       'singular' => 'Location',       'slug' => 'locations',  'icon' => 'dashicons-location' ],
	'provider'       => [ 'plural' => 'Providers',       'singular' => 'Provider',       'slug' => 'providers',  'icon' => 'dashicons-businessperson' ],
	'treatment'      => [ 'plural' => 'Treatments',      'singular' => 'Treatment',      'slug' => 'treatments', 'icon' => 'dashicons-heart' ],
	'condition'      => [ 'plural' => 'Conditions',      'singular' => 'Condition',      'slug' => 'conditions', 'icon' => 'dashicons-clipboard' ],
	'insurance_plan' => [ 'plural' => 'Insurance Plans', 'singular' => 'Insurance Plan', 'slug' => 'insurance',  'icon' => 'dashicons-shield' ],
];

/**
 * `object_type` lists the post types each taxonomy attaches to. These mirror the
 * ACF fields the importer writes: the field carries the structured value, the term
 * carries the archive and filter surface. Both are populated from one source value.
 */
const CEDAR_VALE_TAXONOMIES = [
	'metro'               => [ 'plural' => 'Metros',               'singular' => 'Metro',               'slug' => 'metro',               'object_type' => [ 'location' ], 'hierarchical' => true ],
	'body_area'           => [ 'plural' => 'Body Areas',           'singular' => 'Body Area',           'slug' => 'body-area',           'object_type' => [ 'condition' ], 'hierarchical' => false ],
	'condition_category'  => [ 'plural' => 'Condition Categories', 'singular' => 'Condition Category',  'slug' => 'condition-category',  'object_type' => [ 'condition' ], 'hierarchical' => true ],
	'treatment_category'  => [ 'plural' => 'Treatment Categories', 'singular' => 'Treatment Category',  'slug' => 'treatment-category',  'object_type' => [ 'treatment' ], 'hierarchical' => true ],
	'provider_specialty'  => [ 'plural' => 'Specialties',          'singular' => 'Specialty',           'slug' => 'specialty',           'object_type' => [ 'provider' ], 'hierarchical' => false ],
	'language_spoken'     => [ 'plural' => 'Languages',            'singular' => 'Language',            'slug' => 'language',            'object_type' => [ 'provider' ], 'hierarchical' => false ],
	'review_status'       => [ 'plural' => 'Review Statuses',      'singular' => 'Review Status',       'slug' => 'review-status',       'object_type' => [ 'condition', 'treatment', 'provider', 'post' ], 'hierarchical' => false ],
];

function cedar_vale_register_content_model(): void {
	foreach ( CEDAR_VALE_POST_TYPES as $type => $config ) {
		register_post_type(
			$type,
			[
				'labels'       => [
					'name'          => $config['plural'],
					'singular_name' => $config['singular'],
				],
				'public'       => true,
				'has_archive'  => true,
				'show_in_rest' => true,
				'menu_icon'    => $config['icon'],
				'supports'     => [ 'title', 'editor', 'excerpt', 'thumbnail', 'custom-fields', 'revisions' ],
				'rewrite'      => [ 'slug' => $config['slug'], 'with_front' => false ],
			]
		);
	}

	foreach ( CEDAR_VALE_TAXONOMIES as $taxonomy => $config ) {
		register_taxonomy(
			$taxonomy,
			$config['object_type'],
			[
				'labels'       => [
					'name'          => $config['plural'],
					'singular_name' => $config['singular'],
				],
				'public'       => true,
				'hierarchical' => $config['hierarchical'],
				'show_in_rest' => true,
				'rewrite'      => [ 'slug' => $config['slug'], 'with_front' => false ],
			]
		);
	}
}
```

- [ ] **Step 3: Verify against the real site once it exists**

This task has no unit test — it is WordPress registration, and the honest verification is the site itself. After the site is created and the plugin activated:

```bash
wp post-type list --field=name | sort
wp taxonomy list --field=name | sort
wp rewrite list --format=count
```

Expected: the five custom types plus core `post`/`page`; the seven taxonomies; and a rewrite count meaningfully higher than a bare install (Alpine's broken state was 191 with zero CPT rules — confirm rules matching `locations`, `providers`, `treatments`, `conditions` and `insurance` are present).

- [ ] **Step 4: Commit**

```bash
git add cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder
git commit -m "feat(cedar): seeder plugin registering six post types and seven taxonomies"
```

---

### Task 2: Generate the ACF field groups from the TypeScript contract

**Files:**
- Create: `cedar-vale-health-demo/scripts/src/acf/field-types.ts`
- Create: `cedar-vale-health-demo/scripts/src/acf/generate-acf-json.ts`
- Test: `cedar-vale-health-demo/scripts/src/acf/generate-acf-json.test.ts`
- Create (generated, committed): `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/acf-json/group_cedar_*.json`

**Interfaces:**
- Consumes: `ACF_FIELD_NAMES` and `RELATIONSHIP_TARGETS` from `../normalize/acf-mappers.js`.
- Produces:
  - `FIELD_TYPES: Record<string, AcfFieldSpec>` covering **every** name in `ACF_FIELD_NAMES` plus every relationship key
  - `buildFieldGroups(): AcfGroup[]`
  - `writeFieldGroups(dir: string): void`

`ACF_FIELD_NAMES` gives the field *names* per post type but not their types. This task supplies the types once, in TypeScript, next to the contract they describe — so adding a field to a mapper and forgetting to register it is a test failure rather than a silently missing value in WordPress.

- [ ] **Step 1: Write the field-type map**

Key is the ACF field name; where the same name appears on more than one post type (`review_status`, `accepting_new_patients`, `review_date`, `category`) the spec is shared deliberately.

```typescript
// cedar-vale-health-demo/scripts/src/acf/field-types.ts

export interface AcfFieldSpec {
  /** ACF field type: text, textarea, number, select, true_false, date_picker, repeater, relationship, url. */
  type: string;
  label: string;
  /** For `select`. */
  choices?: Record<string, string>;
  /** For `repeater` — its sub-fields, in order. */
  subFields?: { name: string; type: string; label: string }[];
  /** For `relationship` — the post types it may point at. */
  postType?: readonly string[];
  instructions?: string;
}

export const FIELD_TYPES: Record<string, AcfFieldSpec> = {
  // location
  address_street: { type: 'text', label: 'Street' },
  address_city: { type: 'text', label: 'City' },
  address_state: { type: 'text', label: 'State' },
  address_zip: { type: 'text', label: 'ZIP' },
  geo_lat: { type: 'number', label: 'Latitude' },
  geo_lng: { type: 'number', label: 'Longitude' },
  phone: { type: 'text', label: 'Phone' },
  hours: {
    type: 'repeater',
    label: 'Hours',
    subFields: [
      { name: 'day', type: 'text', label: 'Day' },
      { name: 'opens', type: 'text', label: 'Opens' },
      { name: 'closes', type: 'text', label: 'Closes' },
    ],
  },
  accepting_new_patients: { type: 'true_false', label: 'Accepting new patients' },
  place_id: { type: 'text', label: 'Google Place ID' },
  opened_date: { type: 'date_picker', label: 'Opened' },
  parking: { type: 'text', label: 'Parking' },
  accessibility: { type: 'text', label: 'Accessibility' },
  metro: { type: 'text', label: 'Metro' },

  // provider
  credentials: { type: 'text', label: 'Credentials' },
  specialties: { type: 'textarea', label: 'Specialties', instructions: 'One per line.' },
  board_certifications: { type: 'textarea', label: 'Board certifications', instructions: 'One per line.' },
  npi: { type: 'text', label: 'NPI' },
  license_state: { type: 'text', label: 'License state' },
  languages: { type: 'textarea', label: 'Languages', instructions: 'One per line.' },
  bio_reviewed_by: { type: 'text', label: 'Bio reviewed by' },

  // treatment
  typical_duration_minutes: { type: 'number', label: 'Typical duration (minutes)' },
  anesthesia: { type: 'text', label: 'Anesthesia' },
  downtime_days: { type: 'number', label: 'Downtime (days)' },
  insurance_covered: { type: 'true_false', label: 'Insurance covered' },
  fda_status: { type: 'text', label: 'FDA status' },
  price_range_by_location: {
    type: 'repeater',
    label: 'Price range by location',
    subFields: [
      { name: 'location_slug', type: 'text', label: 'Location slug' },
      { name: 'low', type: 'number', label: 'Low' },
      { name: 'high', type: 'number', label: 'High' },
    ],
  },

  // condition
  icd10: { type: 'text', label: 'ICD-10' },
  body_areas: { type: 'textarea', label: 'Body areas', instructions: 'One per line.' },
  symptoms: { type: 'textarea', label: 'Symptoms', instructions: 'One per line.' },

  // post
  excerpt: { type: 'textarea', label: 'Excerpt' },
  tier: { type: 'select', label: 'Tier', choices: { hero: 'Hero', composite: 'Composite' } },
  condition_focus: { type: 'text', label: 'Condition focus (slug)' },
  treatment_focus: { type: 'text', label: 'Treatment focus (slug)' },
  reading_level: {
    type: 'select',
    label: 'Reading level',
    choices: { plain: 'Plain', standard: 'Standard', clinical: 'Clinical' },
  },

  // insurance_plan
  carrier: { type: 'text', label: 'Carrier' },
  plan_name: { type: 'text', label: 'Plan name' },
  plan_type: { type: 'text', label: 'Plan type' },
  referral_required: { type: 'true_false', label: 'Referral required' },
  notes: { type: 'textarea', label: 'Notes' },

  // shared across types
  category: { type: 'text', label: 'Category' },
  reviewed_by: { type: 'text', label: 'Reviewed by' },
  review_date: { type: 'date_picker', label: 'Review date' },
  review_status: {
    type: 'select',
    label: 'Review status',
    choices: { reviewed: 'Reviewed', overdue: 'Overdue', unreviewed: 'Unreviewed' },
  },
};

/** Relationship keys are ACF `relationship` fields whose allowed post types come
 *  from RELATIONSHIP_TARGETS, so a heterogeneous key like `internal_links` keeps
 *  both of its targets rather than being narrowed to one. */
export const RELATIONSHIP_LABELS: Record<string, string> = {
  locations: 'Locations',
  related_treatments: 'Related treatments',
  conditions_treated: 'Conditions treated',
  internal_links: 'Internal links',
  accepted_at: 'Accepted at',
};
```

- [ ] **Step 2: Write the failing test**

```typescript
// cedar-vale-health-demo/scripts/src/acf/generate-acf-json.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACF_FIELD_NAMES, RELATIONSHIP_TARGETS } from '../normalize/acf-mappers.js';
import { FIELD_TYPES, RELATIONSHIP_LABELS } from './field-types.js';
import { buildFieldGroups, GROUP_DIR } from './generate-acf-json.js';

describe('FIELD_TYPES coverage', () => {
  it('specifies a type for every field name the mappers emit', () => {
    const missing = Object.values(ACF_FIELD_NAMES)
      .flat()
      .filter((name) => FIELD_TYPES[name] === undefined);
    expect(missing).toEqual([]);
  });

  it('specifies a label for every relationship key', () => {
    const keys = Object.values(RELATIONSHIP_TARGETS).flatMap((m) => Object.keys(m));
    expect(keys.filter((k) => RELATIONSHIP_LABELS[k] === undefined)).toEqual([]);
  });

  it('has no field spec that no mapper emits', () => {
    const emitted = new Set(Object.values(ACF_FIELD_NAMES).flat());
    expect(Object.keys(FIELD_TYPES).filter((n) => !emitted.has(n))).toEqual([]);
  });
});

describe('buildFieldGroups', () => {
  it('builds one group per post type in the contract', () => {
    expect(buildFieldGroups().map((g) => g.key).sort()).toEqual(
      Object.keys(ACF_FIELD_NAMES).map((t) => `group_cedar_${t}`).sort(),
    );
  });

  it('includes every ACF field and every relationship key for its type', () => {
    for (const group of buildFieldGroups()) {
      const type = group.key.replace('group_cedar_', '');
      const expected = [
        ...(ACF_FIELD_NAMES[type] ?? []),
        ...Object.keys(RELATIONSHIP_TARGETS[type] ?? {}),
      ].sort();
      expect(group.fields.map((f) => f.name).sort()).toEqual(expected);
    }
  });

  it('gives internal_links both of its target post types', () => {
    const post = buildFieldGroups().find((g) => g.key === 'group_cedar_post');
    const field = post?.fields.find((f) => f.name === 'internal_links');
    expect(field?.post_type).toEqual(['condition', 'treatment']);
  });

  it('scopes each group to its own post type via location rules', () => {
    for (const group of buildFieldGroups()) {
      const type = group.key.replace('group_cedar_', '');
      expect(group.location).toEqual([[{ param: 'post_type', operator: '==', value: type }]]);
    }
  });
});

describe('committed acf-json', () => {
  // The plugin loads the committed files, not the generator. If they drift, WordPress
  // registers a different field set than the mappers write, and the mismatch surfaces
  // as silently missing values rather than as an error.
  it('matches what the generator produces right now', () => {
    for (const group of buildFieldGroups()) {
      const onDisk = JSON.parse(readFileSync(join(GROUP_DIR, `${group.key}.json`), 'utf8'));
      expect(onDisk).toEqual(group);
    }
  });

  it('has no orphaned group file', () => {
    const expected = new Set(buildFieldGroups().map((g) => `${g.key}.json`));
    const actual = readdirSync(GROUP_DIR).filter((f) => f.endsWith('.json'));
    expect(actual.filter((f) => !expected.has(f))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd ~/development/wpengine/canonical-demos/cedar-vale-health-demo/scripts && npx vitest run src/acf/generate-acf-json.test.ts
```

Expected: FAIL — cannot resolve `./generate-acf-json.js`.

- [ ] **Step 4: Write the generator**

ACF's export format needs a stable `key` per field. Derive it deterministically from the group and field name (`field_cedar_<type>_<name>`) rather than ACF's random `field_5f3a…` — a random key regenerated on every run would make the committed JSON churn and defeat the drift test.

```typescript
// cedar-vale-health-demo/scripts/src/acf/generate-acf-json.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACF_FIELD_NAMES, RELATIONSHIP_TARGETS } from '../normalize/acf-mappers.js';
import { FIELD_TYPES, RELATIONSHIP_LABELS } from './field-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GROUP_DIR = join(HERE, '..', '..', '..', 'wordpress', 'plugins', 'cedar-vale-seeder', 'acf-json');

export interface AcfGroup {
  key: string;
  title: string;
  fields: Record<string, unknown>[];
  location: { param: string; operator: string; value: string }[][];
  menu_order: number;
  active: boolean;
  description: string;
}

function fieldKey(postType: string, name: string): string {
  return `field_cedar_${postType}_${name}`;
}

export function buildFieldGroups(): AcfGroup[] {
  return Object.keys(ACF_FIELD_NAMES).map((postType, index) => {
    const fields: Record<string, unknown>[] = [];

    for (const name of ACF_FIELD_NAMES[postType] ?? []) {
      const spec = FIELD_TYPES[name];
      if (spec === undefined) {
        throw new Error(`no FIELD_TYPES entry for "${name}" (post type ${postType})`);
      }
      const field: Record<string, unknown> = {
        key: fieldKey(postType, name),
        label: spec.label,
        name,
        type: spec.type,
      };
      if (spec.instructions !== undefined) field.instructions = spec.instructions;
      if (spec.choices !== undefined) field.choices = spec.choices;
      if (spec.subFields !== undefined) {
        field.sub_fields = spec.subFields.map((sub) => ({
          key: `${fieldKey(postType, name)}_${sub.name}`,
          label: sub.label,
          name: sub.name,
          type: sub.type,
        }));
      }
      fields.push(field);
    }

    for (const [key, targets] of Object.entries(RELATIONSHIP_TARGETS[postType] ?? {})) {
      const label = RELATIONSHIP_LABELS[key];
      if (label === undefined) throw new Error(`no RELATIONSHIP_LABELS entry for "${key}"`);
      fields.push({
        key: fieldKey(postType, key),
        label,
        name: key,
        type: 'relationship',
        post_type: [...targets],
        return_format: 'id',
      });
    }

    return {
      key: `group_cedar_${postType}`,
      title: `Cedar & Vale — ${postType}`,
      fields,
      location: [[{ param: 'post_type', operator: '==', value: postType }]],
      menu_order: index,
      active: true,
      description: 'Generated from the TypeScript contract. Edit field-types.ts, not this file.',
    };
  });
}

export function writeFieldGroups(dir: string = GROUP_DIR): void {
  mkdirSync(dir, { recursive: true });
  for (const group of buildFieldGroups()) {
    writeFileSync(join(dir, `${group.key}.json`), `${JSON.stringify(group, null, 2)}\n`, 'utf8');
  }
}
```

- [ ] **Step 5: Add the npm script, generate, and confirm the tests pass**

Add to `cedar-vale-health-demo/scripts/package.json`:

```json
"scripts": {
  "generate:acf": "tsx src/acf/write-groups.ts"
}
```

`write-groups.ts` is three lines — `import { writeFieldGroups } from './generate-acf-json.js'; writeFieldGroups();`

```bash
npm run generate:acf
npx vitest run src/acf/generate-acf-json.test.ts && npm run typecheck
```

Expected: six JSON files written, all tests pass.

- [ ] **Step 6: Prove the drift test can fail**

Edit one committed `group_cedar_*.json` by hand — change a label — and re-run the test. It must fail on the mismatch. Restore it. **Paste the real failure output.**

- [ ] **Step 7: Commit**

```bash
git add cedar-vale-health-demo/scripts/src/acf cedar-vale-health-demo/scripts/package.json cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/acf-json
git commit -m "feat(cedar): generate ACF field groups from the TypeScript contract"
```

---

### Task 3: Load the generated groups in the plugin

**Files:**
- Create: `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/inc/acf-loader.php`
- Modify: `cedar-vale-seeder.php` (require it)

**Interfaces:**
- Consumes: the committed `acf-json/`.
- Produces: ACF loads the six groups; `cedar_vale_acf_ready()` returns whether ACF Pro is active.

ACF looks for `acf-json` in the active theme by default. A plugin has to add its own path via `acf/settings/load_json`, and `load_json` **replaces** the default paths, so the theme's own path must be preserved rather than clobbered.

- [ ] **Step 1: Write the loader**

```php
<?php
declare( strict_types = 1 );

function cedar_vale_acf_ready(): bool {
	return function_exists( 'acf_add_local_field_group' );
}

/**
 * `load_json` replaces the path list rather than appending, so the theme's own
 * acf-json directory has to be carried through — dropping it would silently stop
 * the theme's groups loading the moment this plugin is activated.
 */
add_filter(
	'acf/settings/load_json',
	static function ( array $paths ): array {
		$paths[] = CEDAR_VALE_DIR . 'acf-json';
		return $paths;
	}
);

/**
 * ACF Pro is a hard dependency: without it every field write in the importer is a
 * no-op that leaves posts with titles and no structured data — which looks like a
 * successful import until someone opens a provider.
 */
add_action(
	'admin_notices',
	static function (): void {
		if ( cedar_vale_acf_ready() ) {
			return;
		}
		echo '<div class="notice notice-error"><p><strong>Cedar &amp; Vale Seeder:</strong> ACF Pro is required and is not active. Import will refuse to run.</p></div>';
	}
);
```

- [ ] **Step 2: Verify against the site**

```bash
wp eval 'foreach (acf_get_field_groups() as $g) { echo $g["key"], " ", count(acf_get_fields($g["key"])), "\n"; }'
```

Expected: six `group_cedar_*` lines. Field counts must equal the contract — location 14, provider 11, treatment 11, condition 8, post 9, insurance_plan 6 (ACF fields plus that type's relationship keys). Confirm the totals against `ACF_FIELD_NAMES` rather than trusting these numbers.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(cedar): load the generated ACF groups from the plugin"
```

---

### Task 4: Import pass 1 — upsert posts, ACF scalars, taxonomy terms

**Files:**
- Create: `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/inc/importer.php`

**Interfaces:**
- Produces:
  - `cedar_vale_import_pass_one( array $items ): array` → `['slug|type' => post_id]`
  - `cedar_vale_upsert_post( array $item ): int`
  - `CEDAR_VALE_FIELD_TAXONOMY` — the ACF-field → taxonomy map

Pass 1 must run to completion before any relationship is resolved, because a relationship may point forward to a post that does not exist yet.

- [ ] **Step 1: Write the field → taxonomy map and the upsert**

```php
<?php
declare( strict_types = 1 );

/**
 * ACF field name => taxonomy. The importer writes both from one source value: the
 * field carries the structured value the JSON-LD and Block Bindings read, the term
 * carries the archive and filter surface. Values that are arrays become several terms.
 */
const CEDAR_VALE_FIELD_TAXONOMY = [
	'metro'         => 'metro',
	'body_areas'    => 'body_area',
	'specialties'   => 'provider_specialty',
	'languages'     => 'language_spoken',
	'review_status' => 'review_status',
];

/** Post-type-specific, because `category` means different taxonomies on different types. */
const CEDAR_VALE_CATEGORY_TAXONOMY = [
	'condition' => 'condition_category',
	'treatment' => 'treatment_category',
];

function cedar_vale_upsert_post( array $item ): int {
	$existing = get_posts(
		[
			'post_type'        => $item['post_type'],
			'name'             => $item['slug'],
			'post_status'      => 'any',
			'numberposts'      => 1,
			'suppress_filters' => false,
		]
	);

	$postarr = [
		'post_type'    => $item['post_type'],
		'post_name'    => $item['slug'],
		'post_title'   => $item['post_title'],
		'post_content' => $item['post_content'],
		'post_status'  => $item['post_status'],
	];

	if ( $existing ) {
		$postarr['ID'] = $existing[0]->ID;
	}

	$id = wp_insert_post( $postarr, true );
	if ( is_wp_error( $id ) ) {
		throw new RuntimeException(
			sprintf( 'failed to upsert %s "%s": %s', $item['post_type'], $item['slug'], $id->get_error_message() )
		);
	}
	return (int) $id;
}

function cedar_vale_write_acf( int $post_id, string $post_type, array $acf ): void {
	foreach ( $acf as $name => $value ) {
		// A null means the generator had no value. Write it as empty rather than
		// inventing a default — an invented value is indistinguishable from a real
		// one once it is in the database.
		update_field( $name, $value, $post_id );

		$taxonomy = CEDAR_VALE_FIELD_TAXONOMY[ $name ] ?? null;
		if ( 'category' === $name ) {
			$taxonomy = CEDAR_VALE_CATEGORY_TAXONOMY[ $post_type ] ?? null;
		}
		if ( null === $taxonomy || null === $value || '' === $value ) {
			continue;
		}
		wp_set_object_terms( $post_id, is_array( $value ) ? $value : [ $value ], $taxonomy, false );
	}
}

/** @return array<string,int> keyed "post_type|slug" so two types may share a slug. */
function cedar_vale_import_pass_one( array $items ): array {
	$map = [];
	foreach ( $items as $item ) {
		$id = cedar_vale_upsert_post( $item );
		cedar_vale_write_acf( $id, $item['post_type'], $item['acf'] ?? [] );
		$map[ $item['post_type'] . '|' . $item['slug'] ] = $id;
	}
	return $map;
}
```

- [ ] **Step 2: Verify idempotency against the site**

The claim that matters is that a second import changes nothing. After the first import:

```bash
wp post list --post_type=location --format=count
wp cedar import && wp post list --post_type=location --format=count
```

Expected: 25 both times. A second run producing 50 means the slug lookup failed and every item was inserted fresh — the most damaging possible defect here, because it looks like a successful import.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(cedar): import pass one, upserting posts with ACF and taxonomy terms"
```

---

### Task 5: Import pass 2 — resolve relationship slugs to post IDs

**Files:**
- Modify: `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/inc/importer.php`

**Interfaces:**
- Produces: `cedar_vale_import_pass_two( array $items, array $map ): int` returning the number of references resolved.

`RELATIONSHIP_TARGETS` is the contract: `internal_links` points at **both** `condition` and `treatment`, so a resolver assuming one type per key silently drops hundreds of references. Resolution is therefore by slug across the key's declared target types.

- [ ] **Step 1: Write pass 2**

```php
<?php
/**
 * Relationship key => the post types it may point at. Mirrors RELATIONSHIP_TARGETS in
 * normalize/acf-mappers.ts. `internal_links` is heterogeneous per item: a post links to
 * conditions OR treatments depending on its focus, so both are searched.
 */
const CEDAR_VALE_RELATIONSHIP_TARGETS = [
	'locations'          => [ 'location' ],
	'related_treatments' => [ 'treatment' ],
	'conditions_treated' => [ 'condition' ],
	'internal_links'     => [ 'condition', 'treatment' ],
	'accepted_at'        => [ 'location' ],
];

function cedar_vale_resolve_slug( string $slug, array $targets, array $map ): int {
	$found = [];
	foreach ( $targets as $type ) {
		$key = $type . '|' . $slug;
		if ( isset( $map[ $key ] ) ) {
			$found[] = $map[ $key ];
		}
	}
	if ( 1 !== count( $found ) ) {
		// Zero means the corpus references something it never generated. More than one
		// means two post types share a slug and the reference is ambiguous. Neither is
		// recoverable by picking one — name it and stop.
		throw new RuntimeException(
			sprintf(
				'relationship slug "%s" resolved to %d posts across [%s]; expected exactly 1',
				$slug,
				count( $found ),
				implode( ', ', $targets )
			)
		);
	}
	return $found[0];
}

function cedar_vale_import_pass_two( array $items, array $map ): int {
	$resolved = 0;
	foreach ( $items as $item ) {
		foreach ( ( $item['relationships'] ?? [] ) as $key => $slugs ) {
			$targets = CEDAR_VALE_RELATIONSHIP_TARGETS[ $key ] ?? null;
			if ( null === $targets ) {
				throw new RuntimeException( sprintf( 'undeclared relationship key "%s" on %s', $key, $item['slug'] ) );
			}
			$ids = [];
			foreach ( $slugs as $slug ) {
				$ids[] = cedar_vale_resolve_slug( $slug, $targets, $map );
			}
			update_field( $key, $ids, $map[ $item['post_type'] . '|' . $item['slug'] ] );
			$resolved += count( $ids );
		}
	}
	return $resolved;
}
```

- [ ] **Step 2: Verify the resolved count**

Plan 1b's corpus carries **1,584** relationship references: locations 77, related_treatments 91, conditions_treated 91, accepted_at 533, internal_links 792 (of which 508 point at treatments and 284 at conditions). Pass 2 must report exactly that. A lower number means references were dropped; the command must not report success on a partial resolve.

Measured 2026-08-10 against the real corpus, with zero dangling and zero ambiguous slugs. **This figure moved during Plan 1b's follow-up** — the whole-branch review measured 1,562 with `internal_links` at 770, before the malignancy angle pool changed which conditions and treatments posts focus on. Only `internal_links` shifted; the other four keys are unchanged. Re-measure rather than quoting either number if the generators change again.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(cedar): import pass two, resolving relationship slugs to post IDs"
```

---

### Task 6: JSON-LD

**Files:**
- Create: `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/inc/jsonld.php`

**Interfaces:**
- Produces: `cedar_vale_jsonld_for( int $post_id ): ?array`, printed on `wp_head`.

Per spec §3.1: `location` → MedicalClinic, `provider` → Physician, `treatment` → MedicalProcedure, `condition` → MedicalCondition, `post` → Article. `insurance_plan` has no schema.org type and emits nothing — an absent type is correct, and inventing one would be the structured-data equivalent of a fabricated default.

- [ ] **Step 1: Write the emitter**

```php
<?php
declare( strict_types = 1 );

function cedar_vale_jsonld_for( int $post_id ): ?array {
	$type = get_post_type( $post_id );

	switch ( $type ) {
		case 'location':
			$hours = [];
			foreach ( (array) get_field( 'hours', $post_id ) as $row ) {
				$hours[] = [
					'@type'     => 'OpeningHoursSpecification',
					'dayOfWeek' => $row['day'] ?? '',
					'opens'     => $row['opens'] ?? '',
					'closes'    => $row['closes'] ?? '',
				];
			}
			return array_filter(
				[
					'@context'                   => 'https://schema.org',
					'@type'                      => 'MedicalClinic',
					'name'                       => get_the_title( $post_id ),
					'url'                        => get_permalink( $post_id ),
					'telephone'                  => get_field( 'phone', $post_id ),
					'address'                    => array_filter(
						[
							'@type'           => 'PostalAddress',
							'streetAddress'   => get_field( 'address_street', $post_id ),
							'addressLocality' => get_field( 'address_city', $post_id ),
							'addressRegion'   => get_field( 'address_state', $post_id ),
							'postalCode'      => get_field( 'address_zip', $post_id ),
						]
					),
					'geo'                        => array_filter(
						[
							'@type'     => 'GeoCoordinates',
							'latitude'  => get_field( 'geo_lat', $post_id ),
							'longitude' => get_field( 'geo_lng', $post_id ),
						]
					),
					'openingHoursSpecification' => $hours,
				]
			);

		case 'provider':
			return array_filter(
				[
					'@context'      => 'https://schema.org',
					'@type'         => 'Physician',
					'name'          => get_the_title( $post_id ),
					'url'           => get_permalink( $post_id ),
					'medicalSpecialty' => array_filter( explode( "\n", (string) get_field( 'specialties', $post_id ) ) ),
					'knowsLanguage' => array_filter( explode( "\n", (string) get_field( 'languages', $post_id ) ) ),
				]
			);

		case 'treatment':
			return array_filter(
				[
					'@context' => 'https://schema.org',
					'@type'    => 'MedicalProcedure',
					'name'     => get_the_title( $post_id ),
					'url'      => get_permalink( $post_id ),
				]
			);

		case 'condition':
			return array_filter(
				[
					'@context' => 'https://schema.org',
					'@type'    => 'MedicalCondition',
					'name'     => get_the_title( $post_id ),
					'url'      => get_permalink( $post_id ),
					'code'     => array_filter(
						[
							'@type'      => 'MedicalCode',
							'codeValue'  => get_field( 'icd10', $post_id ),
							'codingSystem' => 'ICD-10',
						]
					),
				]
			);

		case 'post':
			return array_filter(
				[
					'@context'      => 'https://schema.org',
					'@type'         => 'Article',
					'headline'      => get_the_title( $post_id ),
					'url'           => get_permalink( $post_id ),
					'datePublished' => get_the_date( 'c', $post_id ),
				]
			);
	}

	return null;
}

add_action(
	'wp_head',
	static function (): void {
		if ( ! is_singular() ) {
			return;
		}
		$data = cedar_vale_jsonld_for( get_the_ID() );
		if ( null === $data ) {
			return;
		}
		echo '<script type="application/ld+json">',
			wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
			'</script>', "\n";
	}
);
```

- [ ] **Step 2: Verify on the real site**

```bash
curl -s https://cedarvale.local/locations/<slug>/ | grep -o 'application/ld+json.*' | head -1
```

Expected: valid JSON-LD with `@type: MedicalClinic`, a populated address, and a non-empty `openingHoursSpecification`. Paste it through a JSON parser rather than eyeballing it — spec §3.2 makes a *missing* `openingHoursSpecification` one of the deliberately planted defects on a different site, so it must genuinely be present here.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(cedar): schema.org JSON-LD for the five typed content models"
```

---

### Task 7: The verify gate and the WP-CLI commands

**Files:**
- Create: `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/inc/verify.php`
- Create: `cedar-vale-health-demo/wordpress/plugins/cedar-vale-seeder/inc/cli.php`

**Interfaces:**
- Produces: `wp cedar import [--file=<path>]` and `wp cedar verify [--file=<path>]`

The gate answers one question: does WordPress now contain what the JSON said it should? It reports counts per post type, ACF coverage, relationship resolution, and permalink health, and **exits non-zero** when any of them is short.

- [ ] **Step 1: Write the gate**

```php
<?php
declare( strict_types = 1 );

/** @return array{ok:bool,lines:string[]} */
function cedar_vale_verify( array $items ): array {
	$lines    = [];
	$ok       = true;

	// 1. Counts per post type, from the file rather than a hardcoded table.
	$expected = [];
	foreach ( $items as $item ) {
		$expected[ $item['post_type'] ] = ( $expected[ $item['post_type'] ] ?? 0 ) + 1;
	}
	foreach ( $expected as $type => $count ) {
		$actual = (int) wp_count_posts( $type )->publish;
		$lines[] = sprintf( '%-16s expected %4d  actual %4d  %s', $type, $count, $actual, $count === $actual ? 'OK' : 'MISMATCH' );
		if ( $count !== $actual ) {
			$ok = false;
		}
	}

	// 2. Permalinks. A CPT whose rewrite rules were never flushed returns 404 while the
	// post itself is perfectly fine, so counts alone cannot detect it.
	foreach ( array_keys( $expected ) as $type ) {
		$sample = get_posts( [ 'post_type' => $type, 'numberposts' => 1, 'post_status' => 'publish' ] );
		if ( ! $sample ) {
			continue;
		}
		$url  = get_permalink( $sample[0]->ID );
		$code = wp_remote_retrieve_response_code( wp_remote_get( $url, [ 'sslverify' => false, 'timeout' => 20 ] ) );
		$lines[] = sprintf( '%-16s permalink %s -> HTTP %s', $type, $url, $code );
		if ( 200 !== (int) $code ) {
			$ok = false;
		}
	}

	// 3. Relationship resolution, counted against the file.
	$expected_refs = 0;
	$actual_refs   = 0;
	foreach ( $items as $item ) {
		foreach ( ( $item['relationships'] ?? [] ) as $key => $slugs ) {
			$expected_refs += count( $slugs );
			$post           = get_posts(
				[ 'post_type' => $item['post_type'], 'name' => $item['slug'], 'numberposts' => 1, 'post_status' => 'any' ]
			);
			if ( $post ) {
				$actual_refs += count( (array) get_field( $key, $post[0]->ID ) );
			}
		}
	}
	$lines[] = sprintf( 'relationships    expected %4d  actual %4d  %s', $expected_refs, $actual_refs, $expected_refs === $actual_refs ? 'OK' : 'MISMATCH' );
	if ( $expected_refs !== $actual_refs ) {
		$ok = false;
	}

	return [ 'ok' => $ok, 'lines' => $lines ];
}
```

- [ ] **Step 2: Write the CLI**

```php
<?php
declare( strict_types = 1 );

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

function cedar_vale_load_items( array $assoc ): array {
	$file = $assoc['file'] ?? CEDAR_VALE_DIR . '../../../data/normalized.json';
	if ( ! file_exists( $file ) ) {
		WP_CLI::error( sprintf( 'corpus not found at %s — run the generator first', $file ) );
	}
	$items = json_decode( (string) file_get_contents( $file ), true );
	if ( ! is_array( $items ) ) {
		WP_CLI::error( sprintf( 'could not parse %s as JSON', $file ) );
	}
	return $items;
}

WP_CLI::add_command(
	'cedar import',
	static function ( array $args, array $assoc ): void {
		if ( ! cedar_vale_acf_ready() ) {
			WP_CLI::error( 'ACF Pro is not active; every field write would be a silent no-op.' );
		}
		$items = cedar_vale_load_items( $assoc );
		WP_CLI::log( sprintf( 'pass 1: upserting %d items', count( $items ) ) );
		$map = cedar_vale_import_pass_one( $items );
		WP_CLI::log( sprintf( 'pass 2: resolving relationships across %d posts', count( $map ) ) );
		$refs = cedar_vale_import_pass_two( $items, $map );
		WP_CLI::success( sprintf( 'imported %d posts, resolved %d relationship references', count( $map ), $refs ) );
	}
);

WP_CLI::add_command(
	'cedar verify',
	static function ( array $args, array $assoc ): void {
		$result = cedar_vale_verify( cedar_vale_load_items( $assoc ) );
		foreach ( $result['lines'] as $line ) {
			WP_CLI::log( $line );
		}
		if ( ! $result['ok'] ) {
			WP_CLI::error( 'verification FAILED — the site does not match the corpus' );
		}
		WP_CLI::success( 'site matches the corpus' );
	}
);
```

- [ ] **Step 3: Prove the gate can fail**

A gate that cannot fail is worse than no gate. After a successful import, delete one post and re-run:

```bash
wp post delete $(wp post list --post_type=location --format=ids --posts_per_page=1) --force
wp cedar verify   # must exit non-zero and name the location mismatch
wp cedar import   # restores it
wp cedar verify   # must pass again
```

**Paste the real failing output.**

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(cedar): verify gate and wp cedar import/verify commands"
```

---

## Definition of Done

- [ ] `npm test -w @canonical-demos/cedar-scripts` passes, including the new ACF generator tests.
- [ ] `npm run typecheck -w @canonical-demos/cedar-scripts` is clean.
- [ ] `npm test --workspaces` still passes — the shared library's 139 tests must not regress.
- [ ] The committed `acf-json/` matches the generator; the drift test has been watched failing.
- [ ] `wp cedar import` run twice leaves identical counts.
- [ ] `wp cedar verify` passes, and has been watched failing on a deliberately deleted post.
- [ ] Every custom post type's permalink returns HTTP 200, not 404.
- [ ] JSON-LD is present and parses on one page of each of the five typed models.
- [ ] One commit per task, none pushed.

## Sequencing note

Tasks 1–3 and 7's code can be written before the site exists. Tasks 4–6 need `cedarvale.local` to verify against, and the corpus needs a generation run. The order at execution time is: write Tasks 1–3, create the site and install ACF Pro, generate a **small** corpus from a reduced manifest to exercise the importer cheaply, then Tasks 4–7 against it, and only then the full 400-call run.

## Out of scope

- **The block theme** (spec §5) — its own milestone. The spec is explicit that `frontend-design` runs after content exists, so the site will be on a default theme when this plan completes.
- **The 30 `page` records** in spec §3.1 — not in Plan 1b's manifest, and not needed for the content model to stand up.
- **The 7-install fleet and its planted pathologies** (spec §3.2) — milestone M2.
