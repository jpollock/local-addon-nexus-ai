/**
 * WP-20b · bootstrap wiring: the shipped grant set is materialized at startup,
 * beside the law registry it is derived from.
 *
 * The defect this suite exists to catch is the one WP-17's lesson names: a
 * service that is *declared* but never *called* fails silently. A grant module
 * nothing invokes leaves `getCapabilityGrants()` empty forever, which reads
 * exactly like "nothing is granted" — so `nexus_load_procedure` would answer
 * "not granted" for the one capability that ships granted, and nothing would
 * ever say why.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore } from '../bootstrap';
import {
  GRANTS_STORAGE_KEY,
  GRANT_ISSUED_TOPIC,
  getCapabilityGrants,
} from '../capabilityGrants';

const ANCHOR = 'cap.bulk_plugin_update';

function boot(kv: Map<string, unknown>, dir: string) {
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
}

test('bootstrap materializes the shipped grant, records it, and remembers it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-bootgrants-'));
  const kv = new Map<string, unknown>();
  const core = boot(kv, dir);

  expect(getCapabilityGrants().map((g) => g.capability)).toEqual([ANCHOR]);

  const issued = core.ledger.query({ topicPrefix: GRANT_ISSUED_TOPIC, limit: 10 });
  expect(issued).toHaveLength(1);
  expect(issued[0].payload).toMatchObject({ capability: ANCHOR, reason: 'materialized' });
  expect(kv.get(GRANTS_STORAGE_KEY)).toBeDefined();

  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a second boot over the same storage issues nothing new — one grant, not one per launch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-bootgrants-'));
  const kv = new Map<string, unknown>();
  boot(kv, dir).close();
  const second = boot(kv, dir);

  expect(second.ledger.query({ topicPrefix: GRANT_ISSUED_TOPIC, limit: 10 })).toHaveLength(1);
  expect(getCapabilityGrants().map((g) => g.capability)).toEqual([ANCHOR]);

  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
