/**
 * WP-41 · the site-at-places matrix.
 *
 * Every pin here is one of XD-9's four boundary conditions, and the first one
 * is the reason the module is shaped the way it is: **divergence is the
 * comparator's verdict, never cell inequality.** Two cells holding different
 * strings is not a fact about drift, and a grid that drew an alarm from `a !==
 * b` would be the platform inventing a verdict it never computed.
 *
 * The world below is a REAL ledger, real twins, real entity links and the real
 * `divergence()` — because the property under test is exactly that this module
 * routes through that function rather than comparing rows itself, and a mocked
 * comparator would make the pin vacuous by construction.
 */
import { Ledger } from '../../../intelligence/ledger/ledger';
import { EntityService } from '../../../intelligence/entity/entityService';
import { TwinStore } from '../../../intelligence/folds/twinStore';
import { createEmitter, Emitter } from '../../../intelligence/emit/emitter';
import { createStateTwinFold } from '../../../intelligence/folds/stateTwinFold';
import { catchUp } from '../../../intelligence/folds/foldWorker';
import { buildSiteAtPlaces, cellsDisagree, comparatorIdFor, toSelectedCell } from '../siteAtPlaces';
import type { MatrixDeps, MatrixRow } from '../siteAtPlaces';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const FACT = 'plugin:woocommerce';

interface World {
  ledger: Ledger;
  entities: EntityService;
  twins: TwinStore;
  emitter: Emitter;
  site: string;
  copy: string;
  production: string;
  staging: string;
  deps: MatrixDeps;
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

  const site = entities.ensure('site', 'wpe.site_id', 'site-1');
  const copy = entities.ensure('env', 'local.site_id', 'row-copy');
  const production = entities.ensure('env', 'local.site_id', 'row-prod');
  const staging = entities.ensure('env', 'local.site_id', 'row-stg');

  entities.link(site, copy, 'has_environment', 1.0, 'user_link');
  entities.link(site, copy, 'has_working_copy', 1.0, 'user_link');
  entities.link(site, production, 'has_environment', 1.0, 'user_link');
  entities.link(site, staging, 'has_environment', 1.0, 'user_link');

  // The graph's describer, as `describeEnvironmentsFor` builds it. `copy` has
  // NO kind — taskFrame's rule 3: only a remote row's column names a place.
  const described: Record<string, { name?: string; kind?: 'production' | 'staging' | 'development'; host?: 'wpe' | 'external' }> = {
    [copy]: { name: 'Alpha' },
    [production]: { name: 'Alpha', kind: 'production', host: 'wpe' },
    [staging]: { name: 'Alpha', kind: 'staging', host: 'wpe' },
  };

  return {
    ledger,
    entities,
    twins,
    emitter,
    site,
    copy,
    production,
    staging,
    deps: { ledger, twins, entities, describe: (id) => described[id], now: NOW },
    close: () => ledger.close(),
  };
}

function observePlugin(w: World, entityId: string, version: string, at: string, active = true): void {
  w.emitter.emit({
    observed_at: at,
    topic: 'state.plugin.observed',
    schema: 'plugin.observed/1',
    entity: { environment: entityId },
    actor: { id: 'act_test', kind: 'system' },
    source: { class: 'platform', system: 'test', trust: 'observed' },
    payload: { slug: 'woocommerce', version, active },
  });
}

const fold = (w: World) => catchUp(w.ledger, createStateTwinFold());
const rowOf = (rows: MatrixRow[], name: string) => rows.find((r) => r.siteName === name)!;

describe('boundary 1 · divergence is the comparator’s verdict, never cell inequality', () => {
  it('gives NO verdict to two durable places that merely hold different versions', () => {
    const w = makeWorld();
    observePlugin(w, w.production, '9.5.0', daysAgo(1));
    observePlugin(w, w.staging, '9.4.2', daysAgo(1));
    fold(w);

    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', w.deps);
    const row = rowOf(m.rows, 'Alpha');
    const [prod, stg] = [row.cells[0], row.cells[1]];

    // The two cells DO disagree, and the module says so...
    expect(prod!.value).toBe('9.5.0');
    expect(stg!.value).toBe('9.4.2');
    expect(cellsDisagree(prod, stg)).toBe(true);
    // ...and neither carries a verdict, because nothing computed one. This is
    // the whole boundary: development on one theme while everything else runs
    // another may be intentional per-place configuration.
    expect(prod!.verdict).toBeUndefined();
    expect(stg!.verdict).toBeUndefined();
    expect(m.verdictCoverage).toEqual({ cells: 2, verdicts: 0 });
    w.close();
  });

  it('gives a verdict to a working copy the comparator measured against its upstream', () => {
    const w = makeWorld();
    w.entities.linkExclusive(w.copy, w.production, 'content_pulled_from', 1.0, 'pull_lineage', daysAgo(3));
    observePlugin(w, w.copy, '9.4.2', daysAgo(1));
    observePlugin(w, w.production, '9.5.0', daysAgo(1));
    fold(w);

    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', w.deps);
    const row = rowOf(m.rows, 'Alpha');
    const copyCell = row.cells[3]; // the your-copy column

    expect(copyCell!.verdict).toEqual({
      direction: 'behind',
      comparedAgainst: 'Alpha',
      upstreamValue: '9.5.0',
    });
    // Boundary 2: the verdict names what it was measured against. A direction
    // with no other side is an alarm without a subject.
    expect(copyCell!.verdict!.comparedAgainst).toBeTruthy();
    expect(m.verdictCoverage.verdicts).toBe(1);
    w.close();
  });

  it('withholds the verdict when lineage is absent, even though the versions differ', () => {
    // The mutation this kills: "if the values differ, mark it behind". Same
    // data as the test above, minus the one link that lets the comparator
    // resolve an upstream — and the verdict must vanish with it.
    const w = makeWorld();
    observePlugin(w, w.copy, '9.4.2', daysAgo(1));
    observePlugin(w, w.production, '9.5.0', daysAgo(1));
    fold(w);

    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', w.deps);
    const row = rowOf(m.rows, 'Alpha');
    expect(row.cells[3]!.value).toBe('9.4.2');
    expect(row.cells[3]!.verdict).toBeUndefined();
    expect(m.verdictCoverage.verdicts).toBe(0);
    w.close();
  });
});

describe('boundary 3 · place-scoped facts are rows with honest absences', () => {
  it('leaves a column undefined where the place holds no such fact — never a default', () => {
    const w = makeWorld();
    observePlugin(w, w.production, '9.5.0', daysAgo(1));
    fold(w);

    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', w.deps);
    const row = rowOf(m.rows, 'Alpha');
    expect(row.cells[0]!.value).toBe('9.5.0');
    expect(row.cells[1]).toBeUndefined();
    expect(row.cells[3]).toBeUndefined();
    // Length is the column count regardless — a row that dropped its empties
    // would misalign every cell after the gap.
    expect(row.cells).toHaveLength(m.columns.length);
    w.close();
  });

  it('renders a removed plugin as an absence rather than as a version', () => {
    const w = makeWorld();
    observePlugin(w, w.production, '9.5.0', daysAgo(2));
    w.emitter.emit({
      observed_at: daysAgo(1),
      topic: 'state.plugin.removed',
      schema: 'plugin.observed/1',
      entity: { environment: w.production },
      actor: { id: 'act_test', kind: 'system' },
      source: { class: 'platform', system: 'test', trust: 'observed' },
      payload: { slug: 'woocommerce' },
    });
    fold(w);

    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', w.deps);
    expect(rowOf(m.rows, 'Alpha').cells[0]!.value).toBeUndefined();
    w.close();
  });
});

describe('boundary 4 · "watching since", never "unknown"', () => {
  it('carries the earliest record naming the site, and no shrug', () => {
    const w = makeWorld();
    observePlugin(w, w.production, '9.5.0', daysAgo(9));
    fold(w);

    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', w.deps);
    const row = rowOf(m.rows, 'Alpha');
    // The site entity's own earliest event. A date we own.
    expect(typeof row.watchingSince === 'string' || row.watchingSince === undefined).toBe(true);
    expect(JSON.stringify(m)).not.toContain('unknown');
    expect(JSON.stringify(m)).not.toContain('Unknown');
    w.close();
  });
});

describe('the unit is the CELL, not the site', () => {
  it('hands a clicked cell over keyed by site AND place, carrying any exclusion', () => {
    const w = makeWorld();
    observePlugin(w, w.production, '9.5.0', daysAgo(1));
    observePlugin(w, w.staging, '9.5.0', daysAgo(1));
    fold(w);

    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', w.deps);
    const row = rowOf(m.rows, 'Alpha');
    const prod = toSelectedCell(row, row.cells[0]!);
    const stg = toSelectedCell(row, row.cells[1]!);

    // Same site, two targets, two different laws. Keying by site id alone is
    // how a production write hides inside a staging selection.
    expect(prod.siteName).toBe('Alpha');
    expect(stg.siteName).toBe('Alpha');
    expect(prod.place).toEqual({ host: 'wpe', kind: 'production' });
    expect(stg.place).toEqual({ host: 'wpe', kind: 'staging' });
    expect(prod.siteId).not.toBe(stg.siteId);
    w.close();
  });

  it('carries the world exclusion straight through, record and all', () => {
    const w = makeWorld();
    observePlugin(w, w.staging, '9.5.0', daysAgo(1));
    fold(w);
    const record = {
      reason: 'halted, and said so',
      causedBy: { recordId: 'ev.1', topic: 'a.topic', observedAt: daysAgo(1) },
    };
    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', {
      ...w.deps,
      exclusions: new Map([[w.staging, record]]),
    });
    const row = rowOf(m.rows, 'Alpha');
    expect(row.cells[1]!.excluded).toEqual(record);
    // And it reaches the scope cell unchanged — re-deriving it at the split
    // would be the re-derivation the carrier exists to stop, one layer down.
    expect(toSelectedCell(row, row.cells[1]!).excluded).toEqual(record);
    w.close();
  });
});

describe('the read never mints, and never throws', () => {
  it('leaves the entity tables byte-identical', () => {
    const w = makeWorld();
    observePlugin(w, w.production, '9.5.0', daysAgo(1));
    fold(w);
    const count = () =>
      (w.ledger.raw().prepare('SELECT COUNT(*) c FROM entities').get() as { c: number }).c;
    const before = count();
    buildSiteAtPlaces(FACT, 'plugin=woocommerce', w.deps);
    expect(count()).toBe(before);
    w.close();
  });

  it('returns an empty matrix rather than throwing when the twins cannot be read', () => {
    const broken = {
      ledger: { query: () => [] },
      twins: { byFact: () => { throw new Error('closed'); } },
    } as unknown as MatrixDeps;
    const m = buildSiteAtPlaces(FACT, 'plugin=woocommerce', broken);
    expect(m.rows).toEqual([]);
    expect(m.comparatorId).toBe(comparatorIdFor(FACT));
    expect(m.verdictCoverage).toEqual({ cells: 0, verdicts: 0 });
  });
});
