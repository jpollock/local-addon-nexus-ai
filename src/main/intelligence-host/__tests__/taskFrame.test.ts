/**
 * WP-21 · the frame builder — real core, real ledger, real links.
 *
 * The frame is what makes ADR-22's routing possible, and the honesty of two of
 * its three slots is the whole packet:
 *
 *   - `production` is set ONLY when something on record says an environment is
 *     the live site. Being the only other place a copy could be compared with is
 *     not evidence: it is how a staging install becomes "the live site" in a
 *     sentence a user then acts on.
 *   - A LOCAL graph row's `environment` column says `development` because a
 *     backfill wrote it there (`GraphService.ts`, "environment = 'development'
 *     WHERE host = 'local'"). That is not WP Engine's development environment,
 *     and calling it one would tell a user their own sandbox is a shared space.
 *
 * And the read discipline: this runs on a read path, so it must never mint. The
 * pin counts rows in every table `ensure()`/`link()` would touch.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { provisionalEnvironmentId, provisionalSiteId } from '../provisionalEntity';
import { buildTaskFrame, describeEnvironmentsFor } from '../taskFrame';

const LOCAL_SITE = 'local-alpine';
const COPY = provisionalEnvironmentId(LOCAL_SITE);
const LOGICAL_SITE = provisionalSiteId(LOCAL_SITE);
const PROD = provisionalEnvironmentId('wpe-row-alpine-prod');
const STAGING = provisionalEnvironmentId('wpe-row-alpine-staging');

let core: IntelligenceCore;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-frame-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The shape `siteLinkMirror` writes: the Site contains the copy and the installs. */
function seedLinks(): void {
  const e = core.entities!;
  e.ensure('env', 'local.site_id', LOCAL_SITE);
  e.ensure('site', 'local.site_id.logical', LOCAL_SITE);
  e.ensure('env', 'local.site_id', 'wpe-row-alpine-prod');
  e.ensure('env', 'local.site_id', 'wpe-row-alpine-staging');
  e.link(LOGICAL_SITE, COPY, 'has_environment', 1.0, 'user_link');
  e.link(LOGICAL_SITE, COPY, 'has_working_copy', 1.0, 'user_link');
  e.link(LOGICAL_SITE, PROD, 'has_environment', 0.95, 'host_connection');
  e.link(LOGICAL_SITE, STAGING, 'has_environment', 0.95, 'host_connection');
}

/** What the graph knows: which row is production, which is staging. */
function describer() {
  return (entityId: string) =>
    entityId === PROD
      ? { name: 'alpine-prod', kind: 'production' as const, host: 'wpe' as const }
      : entityId === STAGING
        ? { name: 'alpine-staging', kind: 'staging' as const, host: 'wpe' as const }
        : undefined;
}

function rowCounts(): Record<string, number> {
  const db = core.ledger.raw();
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
  return {
    entities: count('entities'),
    aliases: count('entity_aliases'),
    links: count('entity_links'),
    events: count('events'),
    twins: count('twin_facts'),
  };
}

// ---------------------------------------------------------------------------

describe('buildTaskFrame — the three slots', () => {
  test('the copy is the frame\'s own layer, labelled as the user names it', () => {
    const { frame } = buildTaskFrame({
      core,
      copyEntityId: COPY,
      label: 'Alpine Outfitters',
    });

    expect(frame.workingCopy).toEqual({ role: 'working_copy', id: COPY, label: 'Alpine Outfitters' });
  });

  test('the Site comes from the links when the caller does not supply one', () => {
    seedLinks();
    const { frame } = buildTaskFrame({ core, copyEntityId: COPY, label: 'Alpine Outfitters' });
    expect(frame.site?.id).toBe(LOGICAL_SITE);
  });

  test('a caller-supplied Site is kept — the id its own events are stamped with', () => {
    seedLinks();
    const { frame } = buildTaskFrame({
      core,
      copyEntityId: COPY,
      siteEntityId: 'ent_site_CALLERSUPPLIEDAAAAAAAAAA',
      label: 'Alpine Outfitters',
    });
    expect(frame.site?.id).toBe('ent_site_CALLERSUPPLIEDAAAAAAAAAA');
  });

  test('production is set when the host says an environment IS the live site', () => {
    seedLinks();
    const { frame } = buildTaskFrame({
      core,
      copyEntityId: COPY,
      label: 'Alpine Outfitters',
      describeEnvironment: describer(),
    });

    expect(frame.production).toEqual({ role: 'environment', id: PROD, label: 'alpine-prod' });
  });

  test('production stays EMPTY when nothing says which environment is the live site', () => {
    seedLinks();
    const { frame } = buildTaskFrame({ core, copyEntityId: COPY, label: 'Alpine Outfitters' });

    // Two candidates, no evidence of which is live. Guessing here would route
    // audience questions at a staging install and label the answer "the live
    // site" — a wrong answer wearing the right disclosure.
    expect(frame.production).toBeUndefined();
  });

  test('a copy whose Site has one staging install gets no production slot', () => {
    const e = core.entities!;
    e.ensure('env', 'local.site_id', LOCAL_SITE);
    e.ensure('site', 'local.site_id.logical', LOCAL_SITE);
    e.ensure('env', 'local.site_id', 'wpe-row-alpine-staging');
    e.link(LOGICAL_SITE, COPY, 'has_working_copy', 1.0, 'user_link');
    e.link(LOGICAL_SITE, STAGING, 'has_environment', 0.95, 'host_connection');

    const { frame, tracks } = buildTaskFrame({
      core,
      copyEntityId: COPY,
      label: 'Alpine Outfitters',
      describeEnvironment: describer(),
    });

    expect(frame.production).toBeUndefined();
    // It still knows what the copy tracks — that is a different question.
    expect(tracks?.entityId).toBe(STAGING);
    expect(tracks?.kind).toBe('staging');
  });

  test('two places both called the live site produce NO production slot — the host disagrees with itself', () => {
    seedLinks();
    const bothLive = (id: string) =>
      id === PROD
        ? { name: 'alpine-prod', kind: 'production' as const, host: 'wpe' as const }
        : id === STAGING
          ? { name: 'alpine-two', kind: 'production' as const, host: 'wpe' as const }
          : undefined;

    const { frame } = buildTaskFrame({
      core,
      copyEntityId: COPY,
      label: 'Alpine Outfitters',
      describeEnvironment: bothLive,
    });

    // Picking the first would make a disagreement in the graph's own data
    // invisible, and audience answers would come from a coin toss.
    expect(frame.production).toBeUndefined();
  });

  test('a recorded pull outranks the structural links when naming what the copy tracks', () => {
    seedLinks();
    core.entities!.link(COPY, STAGING, 'content_pulled_from', 1.0, 'pull_lineage');

    const { tracks } = buildTaskFrame({
      core,
      copyEntityId: COPY,
      label: 'Alpine Outfitters',
      describeEnvironment: describer(),
    });

    expect(tracks?.entityId).toBe(STAGING);
    expect(tracks?.via).toBe('content_lineage');
  });

  test('production is still the live site even when the copy pulled from staging', () => {
    seedLinks();
    core.entities!.link(COPY, STAGING, 'content_pulled_from', 1.0, 'pull_lineage');

    const { frame } = buildTaskFrame({
      core,
      copyEntityId: COPY,
      label: 'Alpine Outfitters',
      describeEnvironment: describer(),
    });

    // Audience routing is not lineage: visitors are on the live site regardless
    // of which environment this copy last pulled from (§4, ADR-22).
    expect(frame.production?.id).toBe(PROD);
  });
});

describe('buildTaskFrame — it reads, and only reads', () => {
  test('building a frame writes nothing — no entity, alias, link, event or fact', () => {
    seedLinks();
    const before = rowCounts();

    buildTaskFrame({
      core,
      copyEntityId: provisionalEnvironmentId('a-site-nothing-has-ever-registered'),
      label: 'Ghost',
      describeEnvironment: describer(),
    });

    expect(rowCounts()).toEqual(before);
  });

  test('a core with no entity service still yields a frame with the copy', () => {
    const { frame } = buildTaskFrame({
      core: { ...core, entities: undefined } as IntelligenceCore,
      copyEntityId: COPY,
      label: 'Alpine Outfitters',
    });
    expect(frame.workingCopy?.id).toBe(COPY);
    expect(frame.site).toBeUndefined();
  });

  test('a throwing entity service costs the slots, never the frame', () => {
    const broken = {
      ...core,
      entities: {
        siteOf: () => {
          throw new Error('graph down');
        },
        linksOf: () => {
          throw new Error('graph down');
        },
        environmentsOf: () => {
          throw new Error('graph down');
        },
        workingCopiesOf: () => {
          throw new Error('graph down');
        },
      },
    } as unknown as IntelligenceCore;

    const { frame } = buildTaskFrame({ core: broken, copyEntityId: COPY, label: 'Alpine' });
    expect(frame.workingCopy?.id).toBe(COPY);
    expect(frame.production).toBeUndefined();
  });
});

describe('describeEnvironmentsFor — what the graph is allowed to say', () => {
  const rows = [
    { id: 'wpe-row-alpine-prod', name: 'alpine-prod', source: 'wpe', environment: 'production' },
    { id: 'wpe-row-alpine-staging', name: 'alpine-staging', source: 'wpe', environment: 'staging' },
    { id: LOCAL_SITE, name: 'Alpine Outfitters', source: 'local', environment: 'development' },
    { id: 'ssh-host-row', name: 'client-live', source: 'external', environment: 'production' },
  ];

  test('a WP Engine row names its environment', async () => {
    const describe = await describeEnvironmentsFor({
      graphService: { listSites: async () => rows },
    } as never);

    expect(describe!(PROD)).toEqual({ name: 'alpine-prod', kind: 'production', host: 'wpe' });
    expect(describe!(STAGING)).toEqual({
      name: 'alpine-staging',
      kind: 'staging',
      host: 'wpe',
    });
  });

  test('a LOCAL row is a copy, never WP Engine\'s development environment', async () => {
    const describe = await describeEnvironmentsFor({
      graphService: { listSites: async () => rows },
    } as never);

    const local = describe!(COPY);
    // The backfilled 'development' must not survive as an environment kind: this
    // row is the user's own copy, not a shared space at WP Engine.
    expect(local?.kind).toBeUndefined();
    expect(local?.name).toBe('Alpine Outfitters');
  });

  test('an external host keeps its environment but is not "at WP Engine"', async () => {
    const describe = await describeEnvironmentsFor({
      graphService: { listSites: async () => rows },
    } as never);

    expect(describe!(provisionalEnvironmentId('ssh-host-row'))).toEqual({
      name: 'client-live',
      kind: 'production',
      host: 'external',
    });
  });

  test('no graph, or a throwing one, means no describer rather than a broken call', async () => {
    expect(await describeEnvironmentsFor({} as never)).toBeUndefined();
    expect(
      await describeEnvironmentsFor({
        graphService: {
          listSites: async () => {
            throw new Error('graph down');
          },
        },
      } as never)
    ).toBeUndefined();
  });
});
