/**
 * `verify_site_live` — the tool that closes the gap a staleness flag opens.
 *
 * Two cases, both about honesty rather than plumbing (the transport is mocked
 * deliberately — SSH is not what's under test): a live check must record what
 * it saw as FRESH observations including removals (a plugin that vanished is
 * an observation, not an absence of one), and a site it cannot actually reach
 * must refuse with a message that names the reason rather than reporting a
 * successful check over no data.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import {
  provisionalEnvironmentId,
  provisionalSiteId,
} from '../../../../intelligence-host/provisionalEntity';
import { runSiteLinkMirror } from '../../../../intelligence-host/siteLinkMirror';
import { verifySiteLiveHandler } from '../verify-site-live';

// Mock the transport module — the tool's execution path is what's under test,
// not SSH plumbing.
jest.mock('../../../../transport', () => ({
  resolveTransport: jest.fn(),
}));
import { resolveTransport } from '../../../../transport';

function makeCore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-verify-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  return core;
}

/** Rows in `entities` — the count that must NOT move when a target resolves. */
function countEntities(core: IntelligenceCore): number {
  return (core.ledger.raw().prepare('SELECT COUNT(*) AS c FROM entities').get() as { c: number }).c;
}

/** One WPE row, shaped as `siteLinkMirror` reads it out of graph.db. */
function mirrorWpeRow(core: IntelligenceCore, row: Record<string, unknown>): void {
  runSiteLinkMirror(core, {
    getLinks: () => [],
    getDb: () => ({ prepare: () => ({ all: () => [row] }) }),
    logger: { info: () => {}, error: () => {} },
  });
}

test('local live check: reconciles twins, reports deltas, records fresh + removed observations', async () => {
  const core = makeCore();
  const siteId = 'siteX';
  const envId = provisionalEnvironmentId(siteId);

  // Seed cached twins: woocommerce stale at 9.8.0; ghost-plugin that live won't have.
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  for (const [slug, version] of [['woocommerce', '9.8.0'], ['ghost-plugin', '1.0.0']]) {
    core.emitter.emit({
      observed_at: old, topic: 'state.plugin.observed', schema: 'plugin.observed/1',
      entity: { environment: envId },
      actor: { id: 'act_test', kind: 'system' },
      source: { class: 'platform', system: 'graph-backfill', trust: 'observed' },
      payload: { slug, version, active: true },
    });
  }
  core.scheduleFolds();
  await new Promise((r) => setTimeout(r, 700));

  (resolveTransport as jest.Mock).mockResolvedValue({
    kind: 'local',
    siteRef: { kind: 'local', siteId, siteName: 'Site X' },
    runWpCli: async () => ({ success: false, stdout: '' }),
  });
  const services = {
    localServices: {
      getSiteStatus: () => 'running',
      getPlugins: async () => [
        { slug: 'woocommerce', name: 'WooCommerce', version: '9.9.2', status: 'active' }, // changed
        { slug: 'wordfence', name: 'Wordfence', version: '8.1.0', status: 'active' },     // new
      ],
    },
  } as never;

  const res = await verifySiteLiveHandler.execute({ site: 'Site X' }, services);
  const text = res.content[0].text;

  expect(text).toContain('Live verification — Site X');
  expect(text).toMatch(/3 difference/);                       // changed + new + missing-live
  expect(text).toMatch(/woocommerce.*9\.8\.0.*1d ago.*9\.9\.2.*twin updated/s);
  expect(text).toMatch(/wordfence.*first observation/s);
  expect(text).toMatch(/ghost-plugin.*recorded as removed/s);

  await new Promise((r) => setTimeout(r, 700)); // folds drain
  const woo = core.twins.get(envId, 'plugin:woocommerce')!;
  expect((woo.value as { version: string }).version).toBe('9.9.2');
  expect(core.twins.freshness(woo).fresh).toBe(true);          // freshness restored
  const ghost = core.twins.get(envId, 'plugin:ghost-plugin')!;
  expect((ghost.value as { removed?: boolean }).removed).toBe(true);

  // Provenance: the re-check events carry the live-recheck system tag
  const recheckEvents = core.ledger.query({ topicPrefix: 'state.plugin.' })
    .filter((e) => e.source.system === 'live-recheck:local');
  expect(recheckEvents.length).toBe(3); // 2 observed + 1 removed
  core.close();
});

test('halted local site: refuses with a useful message instead of failing cryptically', async () => {
  const core = makeCore();
  (resolveTransport as jest.Mock).mockResolvedValue({
    kind: 'local',
    siteRef: { kind: 'local', siteId: 'siteY', siteName: 'Site Y' },
    runWpCli: async () => ({ success: false, stdout: '' }),
  });
  const services = { localServices: { getSiteStatus: () => 'halted', getPlugins: async () => [] } } as never;
  const res = await verifySiteLiveHandler.execute({ site: 'Site Y' }, services);
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(/needs the site running/);
  expect(res.content[0].text).toMatch(/staleness disclosed/);
  core.close();
});

/**
 * WP-16 (audit A7) — identity, not plumbing.
 *
 * A remote target arrives as a NAME (WPE install, SSH alias); the ledger keys
 * that site's history by the id the producers derive, which is the graph row
 * id. Deriving an entity from the name is a WRITE that registers a second,
 * divergent entity for a site the ledger already knows — splitting its history
 * silently. Resolution through the sanctioned namespaces must come first, and
 * the entity table is the witness: it must not grow.
 */
describe('remote targets resolve through the sanctioned namespaces before deriving', () => {
  const ROW_ID = 'a1b2c3d4-e5f6-graph-row';       // graph `sites.id`
  const INSTALL_NAME = 'acmeprod';                 // WPE install name — deliberately different
  const INSTALL_ID = 'inst-uuid-9';

  test('WPE: observations land on the mirror\'s entity and no new entity is registered', async () => {
    const core = makeCore();
    mirrorWpeRow(core, { id: ROW_ID, name: INSTALL_NAME, remote_install_id: INSTALL_ID, wpe_site_id: null });
    const envId = provisionalEnvironmentId(ROW_ID);
    const before = countEntities(core);

    (resolveTransport as jest.Mock).mockResolvedValue({
      kind: 'wpe-ssh',
      siteRef: { kind: 'wpe', installName: INSTALL_NAME },
      runWpCli: async () => ({
        success: true,
        stdout: JSON.stringify([{ name: 'woocommerce', version: '9.9.2', status: 'active' }]),
      }),
    });

    const res = await verifySiteLiveHandler.execute({ install_name: INSTALL_NAME }, {} as never);
    expect(res.isError).toBeFalsy();

    const events = core.ledger
      .query({ topicPrefix: 'state.plugin.' })
      .filter((e) => e.source.system === 'live-recheck:wpe-ssh');
    expect(events).toHaveLength(1);
    expect(events[0].entity.environment).toBe(envId);
    // The two ids the name would have produced — neither may appear anywhere.
    expect(events[0].entity.environment).not.toBe(provisionalEnvironmentId(INSTALL_NAME));
    expect(events[0].entity.site).not.toBe(provisionalSiteId(INSTALL_NAME));
    // The witness: resolution registers nothing, and the install name never
    // becomes a `local.site_id` (which means "graph sites.id", audit A1).
    expect(countEntities(core)).toBe(before);
    expect(core.entities!.resolve(INSTALL_NAME, 'local.site_id')).toEqual([]);
    core.close();
  });

  test('WPE: an install id passed as the target resolves through wpe.install_id', async () => {
    const core = makeCore();
    mirrorWpeRow(core, { id: ROW_ID, name: INSTALL_NAME, remote_install_id: INSTALL_ID, wpe_site_id: null });
    const before = countEntities(core);

    (resolveTransport as jest.Mock).mockResolvedValue({
      kind: 'wpe-ssh',
      siteRef: { kind: 'wpe', installName: INSTALL_ID }, // callers may address an install by UUID
      runWpCli: async () => ({ success: true, stdout: '[]' }),
    });

    await verifySiteLiveHandler.execute({ install_name: INSTALL_ID }, {} as never);

    expect(countEntities(core)).toBe(before);
    core.close();
  });

  test('external: the SSH target resolves to the graph row entity, not the bare alias', async () => {
    const core = makeCore();
    // graphBackfill registers every active row this way — `ssh:<alias>/<site>`
    // IS the external row's graph id (externalSiteStore.externalSiteId).
    const rowId = 'ssh:hostinger/acme';
    core.entities!.ensure('env', 'local.site_id', rowId);
    core.entities!.ensure('site', 'local.site_id.logical', rowId);
    const before = countEntities(core);

    (resolveTransport as jest.Mock).mockResolvedValue({
      kind: 'external-ssh',
      siteRef: { kind: 'external', alias: 'hostinger' },
      runWpCli: async () => ({
        success: true,
        stdout: JSON.stringify([{ name: 'akismet', version: '5.3', status: 'inactive' }]),
      }),
    });

    const res = await verifySiteLiveHandler.execute(
      { ssh_target: 'ssh:hostinger/acme@production' },
      {} as never
    );
    expect(res.isError).toBeFalsy();

    const [event] = core.ledger
      .query({ topicPrefix: 'state.plugin.' })
      .filter((e) => e.source.system === 'live-recheck:external-ssh');
    expect(event.entity.environment).toBe(provisionalEnvironmentId(rowId));
    expect(event.entity.environment).not.toBe(provisionalEnvironmentId('hostinger'));
    expect(countEntities(core)).toBe(before);
    core.close();
  });

  /** Seed one site.core twin for an entity, and wait for the fold to land it. */
  async function seedSiteCore(core: IntelligenceCore, entityId: string, name: string): Promise<void> {
    core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: 'state.site.observed',
      schema: 'site.observed/1',
      entity: { environment: entityId },
      actor: { id: 'act_test', kind: 'system' },
      source: { class: 'platform', system: 'graph-backfill', trust: 'observed' },
      payload: { name },
    });
    core.scheduleFolds();
    await new Promise((r) => setTimeout(r, 700));
  }

  test('no alias registered yet: the twin name-match still rescues the check', async () => {
    const core = makeCore();
    // The pre-mirror state — twins exist (the backfill ran) but no WPE alias
    // does. The historical fallback is what keeps this target joined up.
    const envId = provisionalEnvironmentId('graph-row-77');
    await seedSiteCore(core, envId, 'legacyinstall');
    const before = countEntities(core);

    (resolveTransport as jest.Mock).mockResolvedValue({
      kind: 'wpe-ssh',
      siteRef: { kind: 'wpe', installName: 'legacyinstall' },
      runWpCli: async () => ({
        success: true,
        stdout: JSON.stringify([{ name: 'akismet', version: '5.3', status: 'active' }]),
      }),
    });

    await verifySiteLiveHandler.execute({ install_name: 'legacyinstall' }, {} as never);

    const [event] = core.ledger
      .query({ topicPrefix: 'state.plugin.' })
      .filter((e) => e.source.system === 'live-recheck:wpe-ssh');
    expect(event.entity.environment).toBe(envId);
    expect(countEntities(core)).toBe(before); // a name-match reads; it never mints
    core.close();
  });

  test('a same-named stranger never outranks the target\'s own entity', async () => {
    const core = makeCore();
    // Names collide across sources in this fleet (CLAUDE.md: five do today), so
    // the name-match is only ever a rescue for a target with no twin of its
    // own. `TwinStore.search` orders by entity id, so the stranger is chosen to
    // sort FIRST — the position a bare `.find()` over matching names loses on.
    // That ordering is asserted, not assumed: a derivation change that reversed
    // it would otherwise turn this test vacuous without failing.
    const stranger = provisionalEnvironmentId('other-row');
    const own = provisionalEnvironmentId('siteX');
    expect(stranger < own).toBe(true);
    await seedSiteCore(core, stranger, 'Site X');
    await seedSiteCore(core, own, 'Site X');

    (resolveTransport as jest.Mock).mockResolvedValue({
      kind: 'local',
      siteRef: { kind: 'local', siteId: 'siteX', siteName: 'Site X' },
      runWpCli: async () => ({ success: false, stdout: '' }),
    });
    const services = {
      localServices: {
        getSiteStatus: () => 'running',
        getPlugins: async () => [{ slug: 'akismet', name: 'Akismet', version: '5.3', status: 'active' }],
      },
    } as never;

    await verifySiteLiveHandler.execute({ site: 'Site X' }, services);

    const [event] = core.ledger
      .query({ topicPrefix: 'state.plugin.' })
      .filter((e) => e.source.system === 'live-recheck:local');
    expect(event.entity.environment).toBe(own);
    expect(event.entity.environment).not.toBe(stranger);
    core.close();
  });

  test('an unknown remote target still records — derivation is the LAST resort, not the first', async () => {
    const core = makeCore();
    const before = countEntities(core);

    (resolveTransport as jest.Mock).mockResolvedValue({
      kind: 'wpe-ssh',
      siteRef: { kind: 'wpe', installName: 'never-seen' },
      runWpCli: async () => ({
        success: true,
        stdout: JSON.stringify([{ name: 'akismet', version: '5.3', status: 'active' }]),
      }),
    });

    const res = await verifySiteLiveHandler.execute({ install_name: 'never-seen' }, {} as never);
    expect(res.isError).toBeFalsy();

    const [event] = core.ledger
      .query({ topicPrefix: 'state.plugin.' })
      .filter((e) => e.source.system === 'live-recheck:wpe-ssh');
    // Nothing in the ledger knows this install: the observation is still
    // recorded, under the same deterministic id the pre-WP-16 build used, so a
    // target the layer has never seen behaves exactly as before.
    expect(event.entity.environment).toBe(provisionalEnvironmentId('never-seen'));
    expect(countEntities(core)).toBeGreaterThan(before);
    core.close();
  });
});
