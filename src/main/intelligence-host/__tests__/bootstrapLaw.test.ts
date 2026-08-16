/**
 * WP-08 · bootstrap wiring: the policy registry rides along on the
 * intelligence core, optional by construction like the entity service —
 * its absence must never take the core down, and in v0 it observes the
 * settings without influencing any allow/deny.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore } from '../bootstrap';

test('bootstrap stands up the law registry with a clean mirror of the live settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-law-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;

  expect(core.law).toBeDefined();
  expect(core.law!.registry.documents().map((d) => d.id)).toContain('pol.ops-default');
  expect(core.law!.registry.byId('c.permissions-mirror')).toBeDefined();
  // v0 invariant: freshly built, the registry cannot diverge from the settings.
  expect(core.law!.verifyMirror()).toEqual([]);

  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
