/**
 * WP-20f · the deny-flip, its migration, and the guard that keeps it flipped.
 *
 * The ruling has three points and this suite is organised as three sections
 * plus the migration's mechanics.
 *
 *  1. `cap.promote_environment` and `cap.incident_remediation` are DENY by
 *     default with no legacy carve-out — and "no carve-out" is given teeth
 *     here: the pins drive the poisoned-marker case, not merely the happy one,
 *     so a future default cannot reach them through the path a filter would
 *     have left standing.
 *  2. Every capability that remains enabled is materialized as an explicit
 *     `control.grant.issued` — once, across any number of boots.
 *  3. New capabilities arrive DENIED: registering a capability and enabling it
 *     are two acts.
 *
 * THE STRUCTURAL PIN IS THE FIRST TEST IN THE FILE, and it is the one that
 * makes the rest more than assertions about a filter: `resolveCapabilityGrants`
 * with no materialized list returns NOTHING on a tree whose `law/` is full.
 * There is no argument to that function that makes a document grant itself.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import {
  CHAT_GRANTEE,
  GRANTS_STORAGE_KEY,
  GRANT_ISSUED_TOPIC,
  GRANT_REVOKED_TOPIC,
  MANDATED_EXPLICIT_CAPABILITIES,
  MATERIALIZED_STORAGE_KEY,
  materializableCapabilities,
  requiresExplicitGrant,
  resolveCapabilityGrants,
  syncCapabilityGrants,
} from '../capabilityGrants';
import { loadLawDirectory, RunbookRegistry } from '../../../intelligence';
import type { EventEnvelope } from '../../../intelligence';
import { STORAGE_KEYS } from '../../../common/constants';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

/** The capability the shipped, servable strict runbook carries. */
const ANCHOR = 'cap.bulk_plugin_update';
const PROMOTE = 'cap.promote_environment';
const REMEDIATE = 'cap.incident_remediation';

let dir: string;
let kv: Map<string, unknown>;
let core: IntelligenceCore;

const opened: Array<{ core: IntelligenceCore; dir: string }> = [];

/**
 * Boot a core, optionally SEEDING STORAGE FIRST.
 *
 * The seed hook is not a convenience: `initIntelligenceCore` runs the grant
 * sync itself, so the migration has already happened by the time a test body
 * begins. A test that wrote its markers after `boot()` would be describing a
 * SECOND sync over a migrated machine while believing it described the first —
 * which is how the two states this packet is about would get confused with each
 * other.
 */
function boot(seed?: (kv: Map<string, unknown>) => void): IntelligenceCore {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-denyflip-'));
  kv = new Map<string, unknown>();
  seed?.(kv);
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  opened.push({ core, dir });
  return core;
}

function storage() {
  return { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) };
}

function sync() {
  return syncCapabilityGrants({ core, storage: storage(), logger: silent });
}

/**
 * The shipped strict runbooks, read through the boot path production uses.
 *
 * A test that needs the pre-flip issuance marker has to name real document ids
 * and hashes, and it must not hardcode them — the WP-20c split moved four of
 * them once already.
 */
function shippedStrict(): Array<{ capability: string; id: string; hash: string }> {
  const probe = boot();
  return probe
    .law!.runbooks.runbooks({ strictness: 'strict' })
    .map((rb) => ({ capability: rb.capability, id: rb.id, hash: rb.hash }));
}

function events(topic: string): EventEnvelope[] {
  return core.ledger.query({ topicPrefix: topic, limit: 200 });
}

function issuedFor(capability: string): EventEnvelope[] {
  // One grantee's slice — "issued once" means once per (grantee, capability).
  return events(GRANT_ISSUED_TOPIC).filter(
    (e) => e.payload.capability === capability && e.payload.grantee === CHAT_GRANTEE
  );
}

function caps(list: { capability: string }[]): string[] {
  // DISTINCT capabilities: since the agent-addressing flip a fresh boot holds
  // one grant per (grantee, capability) — chat and mcp-client — and this
  // suite's subject is WHICH capabilities are grantable, not to whom (the
  // per-grantee fan has its own pins in agentAddressedGrants.test.ts).
  return [...new Set(list.map((g) => g.capability))].sort();
}

function registry(): RunbookRegistry {
  return core.law!.runbooks;
}

afterEach(() => {
  for (const open of opened.splice(0)) {
    open.core.close();
    fs.rmSync(open.dir, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// The structural pin — layer 1 is gone, not filtered
// ───────────────────────────────────────────────────────────────────────────

describe('WP-20f · the shipped-enabled code path is REMOVED', () => {
  test('a full law registry with no materialized list grants NOTHING', () => {
    boot();
    // The whole ruling in one assertion. Pre-flip this returned every strict
    // runbook the registry served; a filtered implementation would still
    // return three. Deleting the derivation is what makes it zero.
    expect(registry().runbooks({ strictness: 'strict' }).length).toBeGreaterThan(0);

    const res = resolveCapabilityGrants({ runbooks: registry(), settings: null });

    expect(res.grants).toHaveLength(0);
  });

  test('an empty materialized list is not a fallback to the shipped set either', () => {
    boot();
    // The near-miss shape: `materialized ?? deriveEverything()` would pass the
    // test above (undefined) and fail this one (an explicit empty list).
    const res = resolveCapabilityGrants({ runbooks: registry(), settings: null, materialized: [] });

    expect(res.grants).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Point 1 — the two mandated capabilities, and the guard with teeth
// ───────────────────────────────────────────────────────────────────────────

describe('WP-20f point 1 · the mandated capabilities are DENY by default', () => {
  test('a fresh boot grants every other strict capability and neither of these', () => {
    boot();
    // The census, derived from the registry rather than typed out: a strict
    // runbook added or split later is covered by this pin automatically, which
    // is the property the assertion it replaces did not have.
    const strict = registry()
      .runbooks({ strictness: 'strict' })
      .map((rb) => rb.capability);
    expect(strict).toEqual(expect.arrayContaining([...MANDATED_EXPLICIT_CAPABILITIES]));

    const { grants } = sync();

    expect(caps(grants)).toEqual(strict.filter((c) => !MANDATED_EXPLICIT_CAPABILITIES.includes(c)).sort());
    for (const mandated of MANDATED_EXPLICIT_CAPABILITIES) {
      expect(caps(grants)).not.toContain(mandated);
    }
  });

  test('a materialized record that NAMES them grants neither — tampering is not a path', () => {
    // The teeth. The migration is what should never write these; this drives
    // the case where something else did, which is the only way a default could
    // come back. Two independent refusals, and this pins the second one.
    // Seeded BEFORE the boot, so the poisoned record is what the machine has
    // always had rather than something written over a clean migration.
    boot((store) =>
      store.set(MATERIALIZED_STORAGE_KEY, {
        version: 2,
        migratedAt: '2026-08-18T00:00:00.000Z',
        // v2-shaped tampering: the poisoned pairs name a real grantee, so the
        // refusal under test is the mandated-capability one, not the shape's.
        grants: [ANCHOR, PROMOTE, REMEDIATE].map((capability) => ({
          grantee: CHAT_GRANTEE,
          capability,
        })),
      })
    );

    const { grants } = sync();

    expect(caps(grants)).toEqual([ANCHOR]);
    expect(issuedFor(PROMOTE)).toHaveLength(0);
    expect(issuedFor(REMEDIATE)).toHaveLength(0);
  });

  test('the migration never writes them into the record it creates', () => {
    boot();

    const record = kv.get(MATERIALIZED_STORAGE_KEY) as {
      grants: Array<{ grantee: string; capability: string }>;
    };
    for (const mandated of MANDATED_EXPLICIT_CAPABILITIES) {
      expect(record.grants.map((g) => g.capability)).not.toContain(mandated);
    }
    // And the derivation the migration uses says the same thing on its own, so
    // the exclusion cannot be an accident of what happens to be shipped.
    expect(materializableCapabilities(registry())).not.toContain(PROMOTE);
    expect(materializableCapabilities(registry())).not.toContain(REMEDIATE);
  });

  test('an EXPLICIT settings grant still arms one — the default died, not the capability', () => {
    // The positive control, and it is the ruling's own remedy: "a run needs an
    // explicit grant made before it arms". Without this pin the packet would be
    // indistinguishable from having deleted the capability.
    boot((store) => store.set(STORAGE_KEYS.SETTINGS, { capabilityGrants: [{ grantee: CHAT_GRANTEE, capability: PROMOTE }] }));

    const { grants, disarmed } = sync();

    expect(caps(grants)).toContain(PROMOTE);
    const grant = grants.find((g) => g.capability === PROMOTE)!;
    expect(grant.source).toBe('settings');
    expect(grant.runbookId).toBe(registry().byCapability(PROMOTE)!.id);
    expect(issuedFor(PROMOTE)).toHaveLength(1);
    // And it is NOT also reported as needing a grant. A capability that is both
    // granted and disarmed would render two contradicting rows in the matrix
    // point 2 exists to make honest.
    expect(disarmed.find((d) => d.capability === PROMOTE)).toBeUndefined();
  });

  test('a served-but-ungranted mandated capability is DISCLOSED, not merely absent', () => {
    boot();
    const { disarmed } = sync();

    for (const mandated of MANDATED_EXPLICIT_CAPABILITIES) {
      const row = disarmed.find((d) => d.capability === mandated)!;
      expect(row.reason).toBe('requires-explicit-grant');
      // The row a Settings matrix renders needs the document to grant against.
      expect(row.runbookId).toBe(registry().byCapability(mandated)!.id);
      expect(row.detail).toContain(registry().byCapability(mandated)!.id);
    }
    expect(requiresExplicitGrant(ANCHOR)).toBe(false);
  });

  test('a settings disarm keeps its sharper reason — the disclosure never overwrites it', () => {
    // A hash mismatch says more than "needs a grant", and a mandated capability
    // must not lose that diagnosis to a blanket row.
    boot((store) =>
      store.set(STORAGE_KEYS.SETTINGS, {
        capabilityGrants: [{ grantee: CHAT_GRANTEE, capability: PROMOTE, runbookHash: `sha256:${'0'.repeat(64)}` }],
      })
    );

    const { disarmed } = sync();

    expect(disarmed.filter((d) => d.capability === PROMOTE)).toHaveLength(1);
    expect(disarmed.find((d) => d.capability === PROMOTE)!.reason).toBe('hash-mismatch');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Point 2 — materialization, and its idempotence
// ───────────────────────────────────────────────────────────────────────────

describe('WP-20f point 2 · what remains enabled becomes an explicit, visible grant', () => {
  test('every materialized capability is issued once, as WP-20b issues a first grant', () => {
    const { grants } = syncCapabilityGrants({ core: boot(), storage: storage(), logger: silent });

    for (const grant of grants) {
      const issued = issuedFor(grant.capability);
      expect(issued).toHaveLength(1);
      expect(issued[0].topic).toBe(GRANT_ISSUED_TOPIC);
      expect(issued[0].payload).toMatchObject({
        capability: grant.capability,
        runbook_id: grant.runbookId,
        runbook_hash: grant.runbookHash,
        strictness: 'strict',
        grant_source: 'shipped',
        reason: 'materialized',
      });
      expect(issued[0].actor).toMatchObject({ id: 'act_grant_materializer', kind: 'system' });
      expect(issued[0].source).toMatchObject({ class: 'expertise', trust: 'authored' });
      // A grant is about a capability, not an entity.
      expect(issued[0].entity).toEqual({});
    }
  });

  test('TWO BOOTS, ONE GRANT EACH — the acceptance criterion, driven', () => {
    boot();
    const first = sync();
    const second = sync();

    expect(caps(second.grants)).toEqual(caps(first.grants));
    for (const grant of second.grants) {
      expect(issuedFor(grant.capability)).toHaveLength(1);
    }
    expect(events(GRANT_REVOKED_TOPIC)).toHaveLength(0);
  });

  test('the migration runs once: a SECOND sync does not restamp the record', () => {
    boot();
    const first = kv.get(MATERIALIZED_STORAGE_KEY) as { migratedAt: string };
    sync();
    const second = kv.get(MATERIALIZED_STORAGE_KEY) as { migratedAt: string };

    expect(second.migratedAt).toBe(first.migratedAt);
  });

  test('PRESENCE gates the migration, not content — an empty record is a done migration', () => {
    // A machine whose registry served no strict runbook at migration time
    // materialized nothing. That is a completed migration; re-deriving it later
    // would grant capabilities the flip says arrive denied.
    boot((store) =>
      store.set(MATERIALIZED_STORAGE_KEY, {
        version: 1,
        migratedAt: '2026-08-18T00:00:00.000Z',
        capabilities: [],
      })
    );

    const { grants } = sync();

    expect(grants).toHaveLength(0);
    expect(events(GRANT_ISSUED_TOPIC)).toHaveLength(0);
  });

  test('losing the materialized record alone costs no duplicate events', () => {
    // Dedup layer 3 covering layer 1: the derivation re-runs to the identical
    // set, and the issuance marker suppresses every event.
    boot();
    const { grants } = sync();
    kv.delete(MATERIALIZED_STORAGE_KEY);

    sync();

    for (const grant of grants) expect(issuedFor(grant.capability)).toHaveLength(1);
    expect(events(GRANT_REVOKED_TOPIC)).toHaveLength(0);
  });

  test('a machine crossing the flip REVOKES the two, and says why in the ledger', () => {
    // The upgrade path, which is the real day one for an existing install:
    // WP-20b left all five capabilities in the issuance marker. The revocation
    // must not claim the runbook is unavailable — it is present and serving.
    const now = new Date('2026-08-18T12:00:00.000Z');
    // WP-20b's marker, reconstructed from the real documents rather than
    // hardcoded: it held EVERY strict runbook the registry served.
    //
    // The event ids are ULID-SHAPED, and that is not cosmetic: the envelope
    // validates `causation` as `evt_<ULID>` and `emit` is non-fatal, so a
    // fixture carrying a readable-but-malformed id would have the revocation
    // silently swallowed and the test would report the absence as the code's
    // fault. (It did, once, while this suite was being written.)
    const priorEventId = (index: number) => `evt_01M0C4PFD3M6APJ77EYPJA14A${index}`;
    const wp20bMarker = {
      version: 1,
      grants: shippedStrict().map((rb, index) => ({
        capability: rb.capability,
        runbookId: rb.id,
        runbookHash: rb.hash,
        eventId: priorEventId(index),
        issuedAt: '2026-08-17T00:00:00.000Z',
      })),
    };
    const priorIdOf = new Map(wp20bMarker.grants.map((g) => [g.capability, g.eventId]));
    expect(wp20bMarker.grants.map((g) => g.capability)).toEqual(
      expect.arrayContaining([...MANDATED_EXPLICIT_CAPABILITIES])
    );

    boot((store) => store.set(GRANTS_STORAGE_KEY, wp20bMarker));
    syncCapabilityGrants({ core, storage: storage(), logger: silent, now });

    // Since the agent-addressing flip (fixes-082526, owner ruling 1a) a v1
    // marker triggers the FAIL-CLOSED conversion first: EVERY platform-wide
    // grant is revoked — the mandated two are no longer a special case at the
    // flip (their sharper story survives in the disclosure rows below), and
    // the revocations all carry the flip's own reason, each chained to the
    // act it ends.
    const revoked = events(GRANT_REVOKED_TOPIC);
    expect(caps(revoked.map((e) => ({ capability: e.payload.capability as string })))).toEqual(
      caps(wp20bMarker.grants)
    );
    for (const event of revoked) {
      expect(event.payload.reason).toBe('requires-agent-grant');
      // Not the user's act: nobody clicked anything, the model changed.
      expect(event.actor).toMatchObject({ id: 'act_grant_materializer', kind: 'system' });
      expect(event.source).toMatchObject({ class: 'platform', trust: 'observed' });
      // Chained to the issuance it answers, so "revoked" has a subject.
      expect(event.causation).toBe(priorIdOf.get(event.payload.capability as string));
    }
    // FAIL-CLOSED: nothing is granted after the flip — the ruling's own words,
    // "working automations stop until the user re-grants". The mandated pair
    // still keeps its sharper disclosure over the generic one.
    const after = sync();
    expect(after.grants).toEqual([]);
    for (const mandated of MANDATED_EXPLICIT_CAPABILITIES) {
      expect(after.disarmed.find((d) => d.capability === mandated)?.reason).toBe(
        'requires-explicit-grant'
      );
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Point 3 — registering a capability and enabling it are two acts
// ───────────────────────────────────────────────────────────────────────────

describe('WP-20f point 3 · new capabilities arrive DENIED', () => {
  /** A registry built from a temp law directory, so a capability can "ship" here. */
  function shipping(...capabilities: string[]): RunbookRegistry {
    const lawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-denyflip-'));
    fs.mkdirSync(path.join(lawDir, 'runbooks'), { recursive: true });
    for (const capability of capabilities) {
      const id = `rb.${capability.replace(/^cap\./, '').replace(/_/g, '-')}`;
      fs.writeFileSync(
        path.join(lawDir, 'runbooks', `${id}.md`),
        `---\nid: ${id}\nkind: runbook\nversion: 1.0.0\ncapability: ${capability}\n` +
          `strictness: strict\ncheckpoints:\n  - id: cp.first\n---\n\n# ${id}\n\nProse.\n`
      );
    }
    const { documents } = loadLawDirectory(lawDir);
    fs.rmSync(lawDir, { recursive: true, force: true });
    return RunbookRegistry.build({ documents });
  }

  test('a strict runbook that ships AFTER the migration is served, and not granted', () => {
    const before = shipping('cap.already_here');
    const materialized = materializableCapabilities(before).map((capability) => ({
      grantee: CHAT_GRANTEE,
      capability,
    }));
    expect(materialized.map((m) => m.capability)).toEqual(['cap.already_here']);

    // The same machine, one release later: the registry now serves a second
    // strict runbook. Nothing re-derives, because nothing ever appends.
    const after = shipping('cap.already_here', 'cap.brand_new');
    expect(after.byCapability('cap.brand_new')).toBeDefined();

    const res = resolveCapabilityGrants({ runbooks: after, settings: null, materialized });

    expect(caps(res.grants)).toEqual(['cap.already_here']);
  });

  test('and it is grantable the moment someone grants it — denied, never unreachable', () => {
    const after = shipping('cap.already_here', 'cap.brand_new');

    const res = resolveCapabilityGrants({
      runbooks: after,
      settings: { capabilityGrants: [{ grantee: CHAT_GRANTEE, capability: 'cap.brand_new' }] },
      materialized: [{ grantee: CHAT_GRANTEE, capability: 'cap.already_here' }],
    });

    expect(caps(res.grants)).toEqual(['cap.already_here', 'cap.brand_new']);
  });
});
