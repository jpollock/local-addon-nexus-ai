/**
 * WP-15 · The divergence comparator.
 *
 * Every pin here exists because the alternative is a confident wrong sentence
 * about a production site. The three that matter most:
 *
 *   - **The two flows carry different units** (docs finding №3, binding):
 *     content is measured in TIME, code in ITEMS. The pins assert the shape,
 *     not just the numbers, so a future "helpful" unification fails here.
 *   - **Three distinct absences stay distinct**: no lineage at all, lineage
 *     but no recorded sync, and a sync whose contents could not be determined
 *     are three different answers a user can act on differently. Collapsing
 *     any pair into "unknown" is the failure this packet exists to prevent.
 *   - **A read never mints.** `divergence()` runs the entity service and the
 *     ledger; the ids-frozen invariant (ADR-21) means a comparison must not
 *     leave a single new row behind.
 */
import { Ledger } from '../ledger/ledger';
import { EntityService } from '../entity/entityService';
import { TwinStore } from '../folds/twinStore';
import { createEmitter, Emitter } from '../emit/emitter';
import { createStateTwinFold } from '../folds/stateTwinFold';
import { catchUp } from '../folds/foldWorker';
import { divergence, DivergenceDeps } from '../compare/divergence';

const NOW = new Date('2026-08-17T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

interface World {
  ledger: Ledger;
  entities: EntityService;
  twins: TwinStore;
  emitter: Emitter;
  deps: DivergenceDeps;
  /** local site id → the copy's env entity */
  copy: string;
  site: string;
  production: string;
  staging: string;
  close: () => void;
}

function makeWorld(): World {
  const ledger = new Ledger(':memory:');
  const entities = new EntityService(ledger);
  const twins = new TwinStore(ledger);
  const emitter = createEmitter({
    ledger,
    clock: { now: () => NOW },
    identity: {
      actor: () => ({ id: 'act_test', kind: 'system' as const }),
      via: () => 'sat_test',
      tenant: () => 'local',
    },
  });

  const copy = entities.ensure('env', 'local.site_id', 'local-copy-1');
  const site = entities.ensure('site', 'wpe.site_id', 'site-uuid-1');
  const production = entities.ensure('env', 'local.site_id', 'graph-row-prod');
  const staging = entities.ensure('env', 'local.site_id', 'graph-row-stg');

  return {
    ledger,
    entities,
    twins,
    emitter,
    deps: { ledger, twins, entities, now: NOW },
    copy,
    site,
    production,
    staging,
    close: () => ledger.close(),
  };
}

/** Seed a twin fact the way production does: emit, then fold. */
function observePlugin(
  w: World,
  entityId: string,
  slug: string,
  version: string,
  observedAt: string,
  active = true,
): void {
  w.emitter.emit({
    observed_at: observedAt,
    topic: 'state.plugin.observed',
    schema: 'plugin.observed/1',
    entity: { environment: entityId },
    actor: { id: 'act_test', kind: 'system' },
    source: { class: 'platform', system: 'test', trust: 'observed' },
    payload: { slug, version, active },
  });
}

function observeSiteCore(
  w: World,
  entityId: string,
  wpVersion: string,
  observedAt: string,
  name = 'a site',
): void {
  w.emitter.emit({
    observed_at: observedAt,
    topic: 'state.site.observed',
    schema: 'site.observed/1',
    entity: { environment: entityId },
    actor: { id: 'act_test', kind: 'system' },
    source: { class: 'platform', system: 'test', trust: 'observed' },
    payload: { name, domain: `${name}.example`, wp_version: wpVersion, php_version: '8.2' },
  });
}

/** The WP-14 producer's envelope, verbatim in shape. */
function emitSync(
  w: World,
  opts: {
    type?: 'pulled' | 'pushed';
    at: string;
    flow?: unknown;
    includesDb?: unknown;
    upstream?: string;
  },
): void {
  const { type = 'pulled', at, flow = 'full', upstream } = opts;
  // `includes_db` is OMITTED when the caller passes undefined — a destructuring
  // default would have turned "the event does not say" into "it says true",
  // which is the exact conflation the production code is pinned against.
  const includesDb = 'includesDb' in opts ? opts.includesDb : true;
  w.emitter.emit({
    observed_at: at,
    topic: `episodic.sync.${type}`,
    schema: 'sync.observed/1',
    entity: {
      site: w.site,
      ...(upstream ? { environment: upstream } : {}),
      working_copy: w.copy,
    },
    actor: { id: 'act_local_sync', kind: 'system' },
    source: { class: 'platform', system: 'sync:wpe', trust: 'observed' },
    payload: {
      flow: flow as string,
      direction: type === 'pulled' ? 'down' : 'up',
      ...(includesDb === undefined ? {} : { includes_db: includesDb as boolean }),
    },
  });
}

function fold(w: World): void {
  catchUp(w.ledger, createStateTwinFold());
}

/** The shape the sync producer leaves behind: edge + event, together. */
function seedPull(w: World, at: string, upstream?: string): void {
  const target = upstream ?? w.production;
  w.entities.linkExclusive(w.copy, target, 'content_pulled_from', 1.0, 'pull_lineage', at);
  emitSync(w, { at, upstream: target });
}

describe('divergence — content flow is measured in TIME', () => {
  test('a copy pulled 11 days ago is 11 days behind its upstream', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(11));

    const report = divergence(w.copy, w.deps);

    expect(report.upstream).toEqual({ entityId: w.production, via: 'content_lineage' });
    expect(report.content.upstreamEntityId).toBe(w.production);
    expect(report.content.pulledAt).toBe(daysAgo(11));
    expect(report.content.behindSeconds).toBe(11 * 24 * 3600);
    expect(report.content.reason).toBeUndefined();
    w.close();
  });

  test('content carries no item count and code carries no time — the units never mix', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(3));
    observePlugin(w, w.copy, 'acf', '6.0', hoursAgo(1));
    observePlugin(w, w.production, 'acf', '6.1', hoursAgo(2));
    fold(w);

    const report = divergence(w.copy, w.deps);

    // Content: time only.
    expect(report.content).not.toHaveProperty('items');
    expect(report.content.behindSeconds).toBe(3 * 24 * 3600);
    // Code: items only.
    expect(report.code).not.toHaveProperty('behindSeconds');
    expect(report.code.items).toHaveLength(1);
    w.close();
  });

  test('the anchor is the newest sync, not the first one found', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(30));
    seedPull(w, daysAgo(2));

    const report = divergence(w.copy, w.deps);

    expect(report.anchor?.at).toBe(daysAgo(2));
    expect(report.content.pulledAt).toBe(daysAgo(2));
    w.close();
  });

  test('a push is a recorded sync but never moves the content anchor', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(9));
    emitSync(w, { type: 'pushed', at: daysAgo(1), upstream: w.production });

    const report = divergence(w.copy, w.deps);

    expect(report.anchor?.direction).toBe('up'); // the newest sync IS the push
    expect(report.content.pulledAt).toBe(daysAgo(9)); // …and content still dates from the pull
    expect(report.content.behindSeconds).toBe(9 * 24 * 3600);
    w.close();
  });
});

describe('divergence — the three absences stay distinct', () => {
  test('no lineage at all: nothing is invented, and it says so', () => {
    const w = makeWorld();

    const report = divergence(w.copy, w.deps);

    expect(report.upstream).toBeUndefined();
    expect(report.content.reason).toBe('no-lineage');
    expect(report.content.behindSeconds).toBeUndefined();
    expect(report.content.pulledAt).toBeUndefined();
    expect(report.code.reason).toBe('no-upstream');
    expect(report.anchor).toBeUndefined();
    w.close();
  });

  test('lineage but no recorded sync: the upstream is known, the anchor is honestly absent', () => {
    const w = makeWorld();
    // The edge without its event — reachable when the events aged out.
    w.entities.linkExclusive(w.copy, w.production, 'content_pulled_from', 1.0, 'pull_lineage', daysAgo(5));

    const report = divergence(w.copy, w.deps);

    expect(report.upstream).toEqual({ entityId: w.production, via: 'content_lineage' });
    expect(report.anchor).toBeUndefined();
    expect(report.content.reason).toBe('no-recorded-sync');
    expect(report.content.behindSeconds).toBeUndefined();
    w.close();
  });

  test("a sync whose flow could not be determined is 'unknown', never guessed into a flow", () => {
    const w = makeWorld();
    w.entities.linkExclusive(w.copy, w.production, 'content_pulled_from', 1.0, 'pull_lineage', daysAgo(4));
    emitSync(w, { at: daysAgo(4), flow: 'unknown', includesDb: undefined, upstream: w.production });

    const report = divergence(w.copy, w.deps);

    expect(report.anchor?.flow).toBe('unknown');
    expect(report.anchor?.includesDb).toBeUndefined();
    // Its contents are unknown, so it cannot be claimed as the content anchor.
    expect(report.content.reason).toBe('no-recorded-sync');
    w.close();
  });

  test('an unrecognised flow value degrades to unknown rather than through the type', () => {
    const w = makeWorld();
    emitSync(w, { at: daysAgo(1), flow: 'partial-something', upstream: w.production });

    const report = divergence(w.copy, w.deps);

    expect(report.anchor?.flow).toBe('unknown');
    w.close();
  });

  test('a files-only pull is a recorded sync that moved no content', () => {
    const w = makeWorld();
    w.entities.linkExclusive(w.copy, w.production, 'content_pulled_from', 1.0, 'pull_lineage', daysAgo(6));
    emitSync(w, { at: daysAgo(1), flow: 'code', includesDb: false, upstream: w.production });

    const report = divergence(w.copy, w.deps);

    expect(report.anchor?.flow).toBe('code');
    expect(report.content.pulledAt).toBeUndefined();
    expect(report.content.reason).toBe('no-recorded-sync');
    w.close();
  });
});

describe('divergence — code flow is measured in ITEMS', () => {
  test('behind, ahead and changed are counted per item, with per-side ages', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(2));
    // Behind: upstream has a newer version.
    observePlugin(w, w.copy, 'acf', '6.0.0', hoursAgo(1));
    observePlugin(w, w.production, 'acf', '6.1.0', hoursAgo(30));
    // Ahead: only the copy has it.
    observePlugin(w, w.copy, 'campaign-tools', '1.0.0', hoursAgo(1));
    // Behind: only the upstream has it.
    observePlugin(w, w.production, 'wpe-cache', '2.0.0', hoursAgo(30));
    // Same on both sides — must not be reported at all. Observed at DIFFERENT
    // ages from their siblings on purpose: with every fact on a side sharing
    // one timestamp, "stalest" and "freshest" are the same value and the
    // assertion below cannot tell them apart (a mutation to the reduction
    // survived exactly this fixture before it was fixed).
    observePlugin(w, w.copy, 'akismet', '5.0', hoursAgo(5));
    observePlugin(w, w.production, 'akismet', '5.0', hoursAgo(12));
    fold(w);

    const report = divergence(w.copy, w.deps);

    expect(report.code.behind).toBe(2); // acf older here, wpe-cache missing here
    expect(report.code.ahead).toBe(1); // campaign-tools
    expect(report.code.items.map((i) => i.fact).sort()).toEqual([
      'plugin:acf',
      'plugin:campaign-tools',
      'plugin:wpe-cache',
    ]);
    expect(report.code.items.find((i) => i.fact === 'plugin:acf')?.direction).toBe('behind');
    expect(report.code.items.find((i) => i.fact === 'plugin:campaign-tools')?.status).toBe(
      'only_on_copy',
    );
    // Per-side freshness: the STALEST observation on each side, as
    // compare_sites does — a comparison is only as good as its oldest input.
    // The copy holds facts at 1h and 5h; the upstream at 12h and 30h.
    expect(report.code.copy?.ageSeconds).toBe(5 * 3600);
    expect(report.code.upstream?.ageSeconds).toBe(30 * 3600);
    expect(report.code.copy?.fresh).toBe(true); // 5h, inside the 8h plugin SLO
    expect(report.code.upstream?.fresh).toBe(false); // 30h, past it
    w.close();
  });

  test('WordPress core version is a code item; php version and identity are not', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(2));
    observeSiteCore(w, w.copy, '6.5', hoursAgo(1), 'copy-name');
    observeSiteCore(w, w.production, '6.6', hoursAgo(1), 'prod-name');
    fold(w);

    const report = divergence(w.copy, w.deps);

    // One item: the WordPress version. Not the name, not the domain (which
    // differ by construction), not php (a property of the host, not of a pull).
    expect(report.code.items).toHaveLength(1);
    expect(report.code.items[0].fact).toBe('wp.version');
    expect(report.code.items[0].direction).toBe('behind');
    w.close();
  });

  test('an incomparable version pair is reported as changed, never as a direction', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(2));
    observePlugin(w, w.copy, 'weird', 'nightly-b', hoursAgo(1));
    observePlugin(w, w.production, 'weird', 'nightly-a', hoursAgo(1));
    fold(w);

    const report = divergence(w.copy, w.deps);

    expect(report.code.items[0].direction).toBe('unknown');
    expect(report.code.changed).toBe(1);
    expect(report.code.ahead).toBe(0);
    expect(report.code.behind).toBe(0);
    w.close();
  });

  test('a removed plugin is not counted as present on its side', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(2));
    observePlugin(w, w.copy, 'gone', '1.0', hoursAgo(3));
    w.emitter.emit({
      observed_at: hoursAgo(2),
      topic: 'state.plugin.removed',
      schema: 'plugin.observed/1',
      entity: { environment: w.copy },
      actor: { id: 'act_test', kind: 'system' },
      source: { class: 'platform', system: 'test', trust: 'observed' },
      payload: { slug: 'gone', version: '1.0' },
    });
    observePlugin(w, w.production, 'gone', '1.0', hoursAgo(3));
    fold(w);

    const report = divergence(w.copy, w.deps);

    const item = report.code.items.find((i) => i.fact === 'plugin:gone');
    expect(item?.status).toBe('only_on_upstream');
    expect(report.code.behind).toBe(1);
    w.close();
  });
});

describe('divergence — the pair comes from the links, with site_links precedence', () => {
  test('with no content lineage, the Site’s highest-confidence environment is the upstream', () => {
    const w = makeWorld();
    w.entities.link(w.site, w.copy, 'has_environment', 0.95, 'host_connection');
    w.entities.link(w.site, w.copy, 'has_working_copy', 0.95, 'host_connection');
    w.entities.link(w.site, w.production, 'has_environment', 1.0, 'user_link');
    w.entities.link(w.site, w.staging, 'has_environment', 0.5, 'name_heuristic');

    const report = divergence(w.copy, w.deps);

    expect(report.upstream).toEqual({ entityId: w.production, via: 'site_environment' });
    expect(report.siteEntityId).toBe(w.site);
    // The copy is an environment of its own Site too — it is never its own upstream.
    expect(report.candidates.map((c) => c.entityId)).not.toContain(w.copy);
    w.close();
  });

  test('content lineage outranks the Site traversal even when a link is more confident', () => {
    const w = makeWorld();
    w.entities.link(w.site, w.copy, 'has_working_copy', 1.0, 'user_link');
    w.entities.link(w.site, w.staging, 'has_environment', 1.0, 'user_link');
    seedPull(w, daysAgo(1), w.production);

    const report = divergence(w.copy, w.deps);

    expect(report.upstream).toEqual({ entityId: w.production, via: 'content_lineage' });
    w.close();
  });

  test('two equally-confident candidates decline rather than pick', () => {
    const w = makeWorld();
    w.entities.link(w.site, w.copy, 'has_working_copy', 0.95, 'host_connection');
    w.entities.link(w.site, w.copy, 'has_environment', 0.95, 'host_connection');
    w.entities.link(w.site, w.production, 'has_environment', 0.95, 'host_connection');
    w.entities.link(w.site, w.staging, 'has_environment', 0.95, 'host_connection');

    const report = divergence(w.copy, w.deps);

    expect(report.upstream).toBeUndefined();
    expect(report.ambiguous).toBe(true);
    expect(report.candidates).toHaveLength(2);
    expect(report.content.reason).toBe('no-lineage');
    w.close();
  });

  test('a copy carrying only the pre-WP-14 has_environment edge is still not its own upstream', () => {
    const w = makeWorld();
    // The mirror wrote `has_working_copy` only from WP-14 onward, so a link
    // established before that carries `has_environment` alone. The copy is
    // still an environment of its own Site, and comparing it against itself
    // would report a permanent, perfect match.
    w.entities.link(w.site, w.copy, 'has_environment', 1.0, 'user_link');
    w.entities.link(w.site, w.production, 'has_environment', 0.95, 'host_connection');

    const report = divergence(w.copy, w.deps);

    expect(report.candidates.map((c) => c.entityId)).toEqual([w.production]);
    expect(report.upstream).toEqual({ entityId: w.production, via: 'site_environment' });
    w.close();
  });

  test('a second working copy of the same Site is never an upstream', () => {
    const w = makeWorld();
    const sibling = w.entities.ensure('env', 'local.site_id', 'local-copy-2');
    w.entities.link(w.site, w.copy, 'has_environment', 0.95, 'host_connection');
    w.entities.link(w.site, w.copy, 'has_working_copy', 0.95, 'host_connection');
    w.entities.link(w.site, sibling, 'has_environment', 0.95, 'host_connection');
    w.entities.link(w.site, sibling, 'has_working_copy', 0.95, 'host_connection');
    w.entities.link(w.site, w.production, 'has_environment', 0.95, 'host_connection');

    const report = divergence(w.copy, w.deps);

    expect(report.candidates.map((c) => c.entityId)).toEqual([w.production]);
    expect(report.upstream?.entityId).toBe(w.production);
    w.close();
  });
});

describe('divergence — a read that reads', () => {
  test('comparing mints no entity, no alias, no link, no event and no twin fact', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(2));
    observePlugin(w, w.copy, 'acf', '6.0', hoursAgo(1));
    observePlugin(w, w.production, 'acf', '6.1', hoursAgo(1));
    fold(w);

    const db = w.ledger.raw();
    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const before = {
      entities: count('entities'),
      aliases: count('entity_aliases'),
      links: count('entity_links'),
      events: count('events'),
      twins: count('twin_facts'),
    };

    divergence(w.copy, w.deps);
    // An unknown copy is the case most likely to tempt a derivation.
    divergence('ent_env_ZZZZZZZZZZZZZZZZZZZZZZZZZZ', w.deps);

    expect({
      entities: count('entities'),
      aliases: count('entity_aliases'),
      links: count('entity_links'),
      events: count('events'),
      twins: count('twin_facts'),
    }).toEqual(before);
    w.close();
  });

  test('with no entity service the comparator still answers, honestly and without lineage', () => {
    const w = makeWorld();
    seedPull(w, daysAgo(2));

    const report = divergence(w.copy, { ledger: w.ledger, twins: w.twins, now: NOW });

    expect(report.upstream).toBeUndefined();
    expect(report.content.reason).toBe('no-lineage');
    // The ledger still holds the sync, so the anchor is still real.
    expect(report.anchor?.at).toBe(daysAgo(2));
    w.close();
  });
});
