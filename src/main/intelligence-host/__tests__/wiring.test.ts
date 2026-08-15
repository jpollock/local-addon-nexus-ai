import { initIntelligenceCore } from '../bootstrap';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

test('bootstrap + tap: wp plugin event lands in ledger and twin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
  expect(core).toBeDefined();
  core.tap('abc123', 'plugin_updated', { slug: 'woocommerce', name: 'WooCommerce', version: '9.9.1', is_active: true });
  core.tap('abc123', 'post_updated', { post_id: 7, post_type: 'page', title: 'Pricing', status: 'publish' });
  core.tap('abc123', 'bogus_event', {});
  await new Promise((r) => setTimeout(r, 700)); // let the debounced fold run
  expect(core.ledger.count()).toBe(2); // bogus ignored
  const facts = core.twins.forEntity(core.ledger.query({ topicPrefix: 'state.plugin.' })[0].entity.environment);
  expect(facts).toHaveLength(1);
  expect(facts[0].fact).toBe('plugin:woocommerce');
  core.close();
});
