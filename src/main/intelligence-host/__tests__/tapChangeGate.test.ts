/**
 * fixes-082526 · Tier A 2 — the webhook tap goes through the change gate.
 *
 * CLAUDE.md's producer rule: "Producers dedup through the change gate — the
 * ledger records change, not repetition." The webhook tap was the one
 * producer bypassing it, with no written rationale. WordPress double-fires
 * hooks (activation + upgrader completion), and the MU plugin retries
 * delivery — each repeat landed as a fresh event.
 *
 * The gate applies to STATE topics only. `semantic.content.changed` is
 * deliberately ungated: two saves of a post with identical (id, type,
 * status) are two real edits — each is a re-index trigger, and deduping
 * them would silently drop the second edit's re-index. That asymmetry is
 * pinned here so it stays a choice.
 */
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-gate-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
}

const drain = () => new Promise((r) => setTimeout(r, 700)); // let the debounced fold run

describe('webhook tap × change gate', () => {
  let core: IntelligenceCore;
  afterEach(() => core.close());

  test('an identical repeated plugin webhook is recorded once — change, not repetition', async () => {
    core = makeCore();
    const fire = () =>
      core.tap('site1', 'plugin_updated', { slug: 'akismet', version: '5.3', is_active: true });
    fire();
    await drain(); // fold the first so the gate's twin check also gets exercised
    fire();
    fire();
    await drain();
    expect(core.ledger.query({ topicPrefix: 'state.plugin.' })).toHaveLength(1);
  });

  test('a changed value passes the gate — the gate is a dedup, not a dam', async () => {
    core = makeCore();
    core.tap('site1', 'plugin_updated', { slug: 'akismet', version: '5.3', is_active: true });
    core.tap('site1', 'plugin_updated', { slug: 'akismet', version: '5.4', is_active: true });
    core.tap('site1', 'plugin_deactivated', { slug: 'akismet', version: '5.4', is_active: false });
    await drain();
    expect(core.ledger.query({ topicPrefix: 'state.plugin.' })).toHaveLength(3);
  });

  test('semantic.content.changed is DELIBERATELY ungated — every save re-indexes', async () => {
    core = makeCore();
    const save = () =>
      core.tap('site1', 'post_updated', { post_id: 7, post_type: 'page', status: 'publish' });
    save();
    save();
    await drain();
    expect(core.ledger.query({ topicPrefix: 'semantic.content.' })).toHaveLength(2);
  });

  test('two sites with the same plugin state are two facts, not one gated away', async () => {
    core = makeCore();
    core.tap('siteA', 'plugin_updated', { slug: 'akismet', version: '5.3', is_active: true });
    core.tap('siteB', 'plugin_updated', { slug: 'akismet', version: '5.3', is_active: true });
    await drain();
    expect(core.ledger.query({ topicPrefix: 'state.plugin.' })).toHaveLength(2);
  });
});
