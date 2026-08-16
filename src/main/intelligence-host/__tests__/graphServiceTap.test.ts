/**
 * The `GraphService` chokepoint wrap — the producer that turns existing CAPI
 * sync and WP-CLI refresh writes into observations without either caller
 * knowing.
 *
 * The assertion that earns its keep is the change gate: a re-sync that writes
 * the same values must emit NOTHING. The ledger records change, not
 * repetition, and a producer that skips the gate floods it on every sync
 * cycle (CLAUDE.md, intelligence-layer invariants).
 */
import { initIntelligenceCore } from '../bootstrap';
import { tapGraphService } from '../graphServiceTap';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

test('graph tap: upserts emit change-deduped observations that fold into twins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-tap-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;

  // Fake GraphService — the tap only needs the two methods it wraps.
  const calls: string[] = [];
  const gs = {
    upsertSite: async (_s: Record<string, unknown>) => { calls.push('site'); },
    upsertPlugin: async (_p: Record<string, unknown>) => { calls.push('plugin'); return 1; },
  };
  tapGraphService(gs, core, { error: (...a) => console.error(a) });

  const plugin = { site_id: 'localwpe', slug: 'woocommerce', name: 'Woo', version: '9.9.1', is_active: true, updated_at: Date.now() };
  await gs.upsertPlugin(plugin);
  await gs.upsertPlugin(plugin);           // unchanged — must NOT re-emit
  await gs.upsertPlugin({ ...plugin, version: '9.9.2' }); // changed — must emit
  await gs.upsertSite({ id: 'localwpe', name: 'localwpe', domain: 'example.com', wp_version: '7.0', source: 'wpe', updated_at: Date.now() });
  await gs.upsertSite({ id: 'localwpe', name: 'localwpe', domain: 'example.com', wp_version: '7.0', source: 'wpe', updated_at: Date.now() }); // unchanged

  expect(calls).toHaveLength(5); // originals always ran
  const events = core.ledger.query({ topicPrefix: 'state.' });
  expect(events.filter((e) => e.topic === 'state.plugin.observed')).toHaveLength(2);
  expect(events.filter((e) => e.topic === 'state.site.observed')).toHaveLength(1);

  await new Promise((r) => setTimeout(r, 700)); // debounced fold
  const envId = events[0].entity.environment;
  const facts = core.twins.forEntity(envId);
  expect(facts.map((f) => f.fact).sort()).toEqual(['plugin:woocommerce', 'site.core']);
  expect((core.twins.get(envId, 'plugin:woocommerce')!.value as { version: string }).version).toBe('9.9.2');
  core.close();
});
