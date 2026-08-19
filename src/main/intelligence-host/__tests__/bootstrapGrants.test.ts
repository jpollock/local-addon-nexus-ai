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
  MANDATED_EXPLICIT_CAPABILITIES,
  getCapabilityGrants,
} from '../capabilityGrants';

const ANCHOR = 'cap.bulk_plugin_update';

function issuedFor(core: { ledger: { query: (o: object) => { payload: Record<string, unknown> }[] } }, capability: string) {
  return core.ledger
    .query({ topicPrefix: GRANT_ISSUED_TOPIC, limit: 100 })
    .filter((e) => e.payload.capability === capability);
}

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

  expect(getCapabilityGrants().map((g) => g.capability)).toContain(ANCHOR);

  // Anchor-scoped, never a census: the shipped set grows whenever a strict
  // runbook is added or split, and this suite is about the WIRING.
  const issued = issuedFor(core, ANCHOR);
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

  expect(issuedFor(second, ANCHOR)).toHaveLength(1);
  expect(getCapabilityGrants().map((g) => g.capability)).toContain(ANCHOR);

  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * WP-20f · the ruling's acceptance criterion, taken literally: TWO BOOTS, and
 * EVERY materialized capability — not the anchor alone.
 *
 * The anchor-scoped test above is about the WIRING and stays that way. This one
 * is about the MIGRATION, whose whole claim is that it happens once across the
 * whole set, so here the census is the subject rather than an over-reach. It
 * also pins the two mandated capabilities emitting nothing at all across both
 * boots, which is where a re-derivation on the second boot would show up.
 */
test('WP-20f · two boots, and every materialized capability has exactly ONE grant event', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-bootgrants-'));
  const kv = new Map<string, unknown>();

  const first = boot(kv, dir);
  const materialized = getCapabilityGrants().map((g) => g.capability);
  expect(materialized.length).toBeGreaterThan(0);
  first.close();

  const second = boot(kv, dir);

  expect(getCapabilityGrants().map((g) => g.capability).sort()).toEqual([...materialized].sort());
  for (const capability of materialized) {
    expect(issuedFor(second, capability)).toHaveLength(1);
  }
  for (const mandated of MANDATED_EXPLICIT_CAPABILITIES) {
    expect(materialized).not.toContain(mandated);
    expect(issuedFor(second, mandated)).toHaveLength(0);
  }

  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
