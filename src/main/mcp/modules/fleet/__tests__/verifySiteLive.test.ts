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
import { initIntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { provisionalEnvironmentId } from '../../../../intelligence-host/provisionalEntity';
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
