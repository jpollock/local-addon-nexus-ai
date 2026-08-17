/**
 * WP-21b · Drift events carry the site role.
 *
 * `bootstrap.ts`'s drift emission was the last producer stamping a physical
 * role alone (`{ environment }`), which is the stamping-discipline gap audit
 * A9 registered and WP-21 decision 2 worked around: a Site-scoped episodic
 * read had to query the Site id UNION the copy id, or it would silently drop
 * every drift event from the thread.
 *
 * The four obligations pinned here:
 *
 *   1. the Site role is TRAVERSED (`entities.siteOf`), never derived — a
 *      derivation mints `local.site_id.logical`, which for a mirrored site is
 *      a DIFFERENT entity from the Site the mirror established (the id freeze,
 *      ADR-21 / WP-14's `resolveSite` reasoning);
 *   2. it is OMITTED, not fabricated, when the graph has no Site edge
 *      (WP-16 doctrine — an absent role is honest, a guessed one is not);
 *   3. a faulty entity service never costs the drift event itself (everything
 *      on this seam is non-fatal by construction);
 *   4. the payload and its schema version are UNTOUCHED — `drift.detected/2`
 *      still means what it meant, because an added entity ROLE is not a
 *      payload schema change (`EntityRefs` is `Record<string, string>` and the
 *      validator's `entity` field is an open `z.record`).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { environmentEntityId, provisionalSiteId } from '../provisionalEntity';

const SITE = 'abc123';
const SILENT = { info: () => {}, error: () => {} };

function newCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-drift-stamp-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: SILENT,
    dataDir: dir,
  })!;
}

/**
 * Two observations of one plugin at different versions — the second overwrites
 * the first in `twin_facts`, which is what makes `stateTwinFold` fire `onDrift`.
 * One debounce covers both taps: the fold drains the ledger in order.
 */
async function driftOnce(core: IntelligenceCore): Promise<Record<string, string>> {
  core.tap(SITE, 'plugin_updated', { slug: 'woocommerce', version: '9.5.0', is_active: true });
  core.tap(SITE, 'plugin_updated', { slug: 'woocommerce', version: '9.9.1', is_active: true });
  await new Promise((r) => setTimeout(r, 700));
  const drift = core.ledger.query({ topicPrefix: 'state.drift.' });
  expect(drift).toHaveLength(1);
  return drift[0].entity;
}

test('the stamped Site is the one the graph knows, not the one a derivation would mint', async () => {
  const core = newCore();
  const env = environmentEntityId(core.entities, SITE);

  // A MIRRORED site: its Site entity is keyed by `wpe.site_id`, so it is a
  // different id from `provisionalSiteId(SITE)`. This is the whole point of
  // traversing — a producer that derived instead would stamp a second Site
  // beside the real one and split exactly the history the role exists to join.
  const mirrored = core.entities!.ensure('site', 'wpe.site_id', 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
  core.entities!.link(mirrored, env, 'has_environment', 1.0, 'user_link');
  expect(mirrored).not.toBe(provisionalSiteId(SITE));

  const entity = await driftOnce(core);

  expect(entity.environment).toBe(env);
  expect(entity.site).toBe(mirrored);

  // (4) The schema version and payload are untouched — role, not payload.
  const [ev] = core.ledger.query({ topicPrefix: 'state.drift.' });
  expect(ev.schema).toBe('drift.detected/2');
  expect(Object.keys(ev.payload).sort()).toEqual(
    ['fact', 'observed', 'previous', 'previous_observed_at'].sort()
  );
  core.close();
});

test('no Site edge means no site role — omitted, never derived to fill the slot', async () => {
  const core = newCore();
  const env = environmentEntityId(core.entities, SITE);

  const entity = await driftOnce(core);

  expect(entity.environment).toBe(env);
  // Absent, not null and not a derived stand-in. `provisionalSiteId` would be
  // the tempting fill — and would assert a containment nothing has observed.
  expect(Object.keys(entity)).toEqual(['environment']);
  expect(entity.site).toBeUndefined();
  core.close();
});

test('a faulty entity service costs the site role, never the drift event', async () => {
  const core = newCore();
  const env = environmentEntityId(core.entities, SITE);
  // Same shape as an entity service whose table read throws mid-session: the
  // producer must degrade to the physical role it already had.
  core.entities!.siteOf = () => {
    throw new Error('entity_links is gone');
  };

  const entity = await driftOnce(core);

  expect(entity.environment).toBe(env);
  expect(entity.site).toBeUndefined();
  core.close();
});
