/**
 * fixes-082526 · Tier A 1 — nexus_rebuild_twins, the shipped door.
 *
 * The mechanism (wipe + replay) is proven byte-for-byte in
 * src/intelligence/__tests__/rebuild.test.ts. This suite pins the tool
 * around it: a real end-to-end run against an in-memory ledger through the
 * SAME core shape production hands it, and the honest refusal when the core
 * is down. A tool test that mocked rebuildTwins would prove only that a
 * function was called — these run the real thing.
 */
import { Ledger } from '../../../src/intelligence/ledger/ledger';
import { createEmitter } from '../../../src/intelligence/emit/emitter';
import { createPluginTwinFold } from '../../../src/intelligence/folds/pluginTwinFold';
import { catchUp } from '../../../src/intelligence/folds/foldWorker';
import { rebuildTwinsHandler } from '../../../src/main/mcp/modules/fleet/rebuild-twins';
import {
  setIntelligenceCore,
  getIntelligenceCore,
} from '../../../src/main/intelligence-host/coreRegistry';

const identity = {
  actor: () => ({ id: 'act_test', kind: 'system' as const }),
  via: () => 'sat_test_machine',
  tenant: () => 'local',
};

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? '').join('\n');
}

describe('nexus_rebuild_twins', () => {
  const original = getIntelligenceCore();

  afterEach(() => {
    // Never leak a test core into another suite: restore whatever was there.
    setIntelligenceCore(original as never);
  });

  test('core down → names the reason, promises data safety, rebuilds nothing', async () => {
    setIntelligenceCore(undefined as never);
    const out = textOf(await rebuildTwinsHandler.execute({}, {} as never));
    expect(out).toContain('Nothing to rebuild');
    expect(out).toContain('not running');
    expect(out).not.toContain('rebuilt');
  });

  test('live core → replays the real ledger and reports the counts', async () => {
    const ledger = new Ledger(':memory:');
    const emitter = createEmitter({ ledger, clock: { now: () => new Date() }, identity });
    emitter.emit({
      observed_at: '2026-08-20T10:00:00.000Z',
      topic: 'state.plugin.observed',
      schema: 'plugin.observed/1',
      entity: { environment: 'ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      actor: { id: 'act_test', kind: 'system' },
      source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
      access: { tenant: 'local' },
      payload: { slug: 'akismet', version: '5.3', active: true },
    } as never);
    const fold = createPluginTwinFold(() => {});
    catchUp(ledger, fold);
    // Corrupt the view so the rebuild visibly restores it.
    ledger.raw().prepare(`UPDATE twin_facts SET value = '"tampered"'`).run();

    setIntelligenceCore({ ledger, folds: [fold] } as never);
    const out = textOf(await rebuildTwinsHandler.execute({}, {} as never));

    expect(out).toContain('Twin view rebuilt from the ledger');
    expect(out).toContain('Events replayed: 1');
    expect(out).toContain(fold.name);
    // The corruption is actually gone — the tool did the work, not just the prose.
    const rows = ledger.raw().prepare('SELECT value FROM twin_facts').all() as { value: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.value === '"tampered"')).toBe(false);
    ledger.close();
  });
});
