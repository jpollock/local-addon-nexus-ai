/**
 * WP-20b · Capability grants — the object P2 ruled into existence, and the
 * first producer of `control.grant.issued` / `control.grant.revoked` anywhere.
 *
 * Four properties every case below defends:
 *
 *  1. **ADDITIVE-ONLY (P2).** A grant ADDS a procedure over a capability's own
 *     tools. It removes nothing: with no grant, and with a grant switched off,
 *     the tool surface is exactly today's. The inversion P2 names is the whole
 *     reason the shipped grant ships ENABLED — shipping it off would leave the
 *     unceremonious path as the default and make the safe one opt-in.
 *  2. **THE PIN IS THE HASH.** A grant names the document it was reviewed
 *     against. A settings-held pin that no longer matches the shipped file
 *     disarms the capability (§6b: staleness and integrity are different
 *     failures — this one refuses, it never warns-and-proceeds).
 *  3. **CHANGE, NOT REPETITION.** Grants are re-materialized on every boot and
 *     on every settings write; the ledger records only what changed. A second
 *     sync over an unchanged world emits nothing.
 *  4. **NON-FATAL BY CONSTRUCTION.** No core, a throwing emitter, unreadable
 *     storage: all degrade to "no grants", and none of them throws into the
 *     caller.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import {
  GRANT_ISSUED_TOPIC,
  GRANT_REVOKED_TOPIC,
  GRANTS_STORAGE_KEY,
  getCapabilityGrants,
  grantedRunbooks,
  resolveCapabilityGrants,
  syncCapabilityGrants,
} from '../capabilityGrants';
import type { EventEnvelope } from '../../../intelligence';
import type { CapabilityGrantSetting } from '../../../common/types';
import { STORAGE_KEYS } from '../../../common/constants';

const silent = { info: () => {}, error: () => {} };

/** The capability the shipped, servable strict runbook carries (`law/runbooks/bulk-plugin-update.md`). */
const ANCHOR = 'cap.bulk_plugin_update';

let dir: string;
let kv: Map<string, unknown>;
let core: IntelligenceCore;

function newCore(): IntelligenceCore {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-grants-'));
  kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
}

function storage() {
  return { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) };
}

function events(topic: string): EventEnvelope[] {
  return core.ledger.query({ topicPrefix: topic, limit: 100 });
}

function issuedFor(capability: string): EventEnvelope[] {
  return events(GRANT_ISSUED_TOPIC).filter((e) => e.payload.capability === capability);
}

/**
 * Assertions are ANCHOR-SCOPED, never a census of the shipped set. The set grows
 * whenever a strict runbook is added or split — WP-20c splits two runbooks into
 * four — and a test that counted grants would go red on a change that is not a
 * change to any rule here.
 */
function capabilitiesOf(grants: { capability: string }[]): string[] {
  return grants.map((g) => g.capability);
}

function anchorGrant(grants: { capability: string }[]) {
  return grants.find((g) => g.capability === ANCHOR) as ReturnType<
    typeof resolveCapabilityGrants
  >['grants'][number];
}

/** Settings live where every other reader finds them: registryStorage. */
function writeSettings(grants?: CapabilityGrantSetting[]) {
  kv.set(STORAGE_KEYS.SETTINGS, grants ? { capabilityGrants: grants } : {});
}

function sync() {
  return syncCapabilityGrants({ core, storage: storage(), logger: silent });
}

function resolve(grants?: CapabilityGrantSetting[]) {
  return resolveCapabilityGrants({
    runbooks: core.law!.runbooks,
    settings: grants ? { capabilityGrants: grants } : null,
  });
}

beforeEach(() => {
  core = newCore();
});
afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────────────────
// The shipped set
// ───────────────────────────────────────────────────────────────────────────

describe('the shipped grant set', () => {
  test('covers the strict runbooks the registry SERVES, and nothing else', () => {
    const { grants } = resolve();

    expect(capabilitiesOf(grants)).toContain(ANCHOR);
    expect(anchorGrant(grants).runbookId).toBe('rb.bulk-plugin-update');
    // Every grant, not just the anchor's: the shipped set grows whenever a
    // strict runbook is added or split (WP-20c splits two into four), and the
    // rule is what must hold — never the census.
    for (const g of grants) expect(g.strictness).toBe('strict');
    expect(capabilitiesOf(grants).sort()).toEqual(
      core
        .law!.runbooks.runbooks({ strictness: 'strict' })
        .map((rb) => rb.capability)
        .sort()
    );
  });

  test('ships the guided runbooks UNGRANTED — nothing is obliged to carry them whole', () => {
    // Ruling 2 on WP-20a: guided runbooks have no mandatory full-body ride, and
    // both shipped ones are over the strict ceiling as whole documents. A
    // shipped grant for them would hand a later delivery path an 8 KB+ payload.
    const { grants } = resolve();
    expect(capabilitiesOf(grants)).not.toContain('cap.wpe_pull');
    expect(capabilitiesOf(grants)).not.toContain('cap.diagnose_site');
  });

  test('pins the hash the registry computed, not one of its own', () => {
    const { grants } = resolve();
    expect(anchorGrant(grants).runbookHash).toBe(core.law!.runbooks.byCapability(ANCHOR)!.hash);
    expect(anchorGrant(grants).runbookHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("carries the runbook's own scope tokens VERBATIM, never coerced to the three remote environments", () => {
    // `rb.bulk-plugin-update` declares [local, wpe_staging, wpe_development].
    // Coercing `wpe_staging` to `staging` would silently widen the grant to
    // every external staging host (WP-20a finding 5: scope.environments is not
    // a universal vocabulary across the shipped set).
    const { grants } = resolve();
    expect(anchorGrant(grants).scope.environments).toEqual(['local', 'wpe_staging', 'wpe_development']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Settings overlay
// ───────────────────────────────────────────────────────────────────────────

describe('the settings overlay', () => {
  test('enabled: false disarms the capability and says why', () => {
    const { grants, disarmed } = resolve([{ capability: ANCHOR, enabled: false }]);

    expect(capabilitiesOf(grants)).not.toContain(ANCHOR);
    expect(disarmed).toEqual([
      expect.objectContaining({ capability: ANCHOR, reason: 'disabled-by-settings' }),
    ]);
  });

  test('a pin that no longer matches the shipped file disarms — integrity, not staleness', () => {
    const { grants, disarmed } = resolve([
      { capability: ANCHOR, runbookHash: 'sha256:reviewedadifferentdocument' },
    ]);

    expect(capabilitiesOf(grants)).not.toContain(ANCHOR);
    expect(disarmed[0].reason).toBe('hash-mismatch');
    // The remedy needs both hashes, per §6(b) — a mismatch message that names
    // neither cannot be acted on.
    expect(disarmed[0].detail).toContain('sha256:reviewedadifferentdocument');
    expect(disarmed[0].detail).toContain(core.law!.runbooks.byCapability(ANCHOR)!.hash);
  });

  test('a grant for a capability nothing serves disarms, naming it rather than throwing', () => {
    const { grants, disarmed } = resolve([{ capability: 'cap.nothing-serves-this' }]);

    expect(capabilitiesOf(grants)).toContain(ANCHOR); // the shipped ones survive
    expect(disarmed).toEqual([
      expect.objectContaining({ capability: 'cap.nothing-serves-this', reason: 'runbook-unavailable' }),
    ]);
  });

  test('an explicit grant CAN cover a guided runbook — the shipped-set rule is a default, not a ban', () => {
    const { grants } = resolve([{ capability: 'cap.wpe_pull' }]);
    expect(capabilitiesOf(grants)).toContain('cap.wpe_pull');
    expect(capabilitiesOf(grants)).toContain(ANCHOR);
  });

  test('a grant naming a different runbook for the capability is disarmed, not silently re-pointed', () => {
    // Classed as INTEGRITY (`hash-mismatch`), not availability: a runbook DOES
    // serve the capability, it is not the one that was reviewed. This is the
    // mechanism that kills a standing grant across a runbook split rather than
    // letting it arm half a procedure by name coincidence (WP-20c gate ruling 1).
    const { grants, disarmed } = resolve([{ capability: ANCHOR, runbookId: 'rb.some-other-document' }]);

    expect(capabilitiesOf(grants)).not.toContain(ANCHOR);
    expect(disarmed[0].reason).toBe('hash-mismatch');
    expect(disarmed[0].detail).toContain('rb.some-other-document');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Emission
// ───────────────────────────────────────────────────────────────────────────

describe('control.grant.* — the first producer of this family', () => {
  // `initIntelligenceCore` already ran the first sync (bootstrapGrants.test.ts
  // pins that wiring), so each case here observes the set as a running process
  // has it, and `sync()` is the second call — which is also why "issued once"
  // below is a real idempotence assertion rather than a first-write one.
  test('the shipped grant is issued once, with the capability, the runbook and its pin', () => {
    sync();

    const issued = issuedFor(ANCHOR);
    expect(issued).toHaveLength(1);
    expect(issued[0].payload).toMatchObject({
      capability: ANCHOR,
      runbook_id: 'rb.bulk-plugin-update',
      runbook_hash: core.law!.runbooks.byCapability(ANCHOR)!.hash,
      strictness: 'strict',
      reason: 'materialized',
    });
    expect(issued[0].topic).toBe('control.grant.issued');
  });

  test('issuance is a platform act: a system actor, an authored source, and the satellite via ADR-14', () => {
    sync();
    const [ev] = issuedFor(ANCHOR);

    expect(ev.actor.kind).toBe('system');
    expect(ev.actor.id).toMatch(/^act_[a-z0-9_-]+$/);
    expect(ev.actor.via).toBe(core.identity!.via());
    expect(ev.source).toEqual({ class: 'expertise', system: 'law:capability-grants', trust: 'authored' });
  });

  test('a second sync over an unchanged world emits nothing — change, not repetition', () => {
    const before = events(GRANT_ISSUED_TOPIC).length;
    sync();
    sync();
    expect(events(GRANT_ISSUED_TOPIC)).toHaveLength(before);
    expect(events(GRANT_REVOKED_TOPIC)).toHaveLength(0);
  });

  test('switching a grant off emits a revocation chained to the issuance that granted it', () => {
    sync();
    const issuedId = issuedFor(ANCHOR)[0].id;

    writeSettings([{ capability: ANCHOR, enabled: false }]);
    sync();

    const revoked = events(GRANT_REVOKED_TOPIC).filter((e) => e.payload.capability === ANCHOR);
    expect(revoked).toHaveLength(1);
    expect(revoked[0].payload).toMatchObject({ capability: ANCHOR, reason: 'disabled-by-settings' });
    // The chain is the point: "revoked" is only readable as an answer to a
    // specific "issued".
    expect(revoked[0].causation).toBe(issuedId);
  });

  test('a revocation the USER made is a human act on an elicited source', () => {
    sync();
    writeSettings([{ capability: ANCHOR, enabled: false }]);
    sync();

    const [ev] = events(GRANT_REVOKED_TOPIC).filter((e) => e.payload.capability === ANCHOR);
    expect(ev.actor.kind).toBe('human');
    expect(ev.actor.id).toBe(core.identity!.actor().id);
    expect(ev.source).toEqual({ class: 'intent', system: 'settings:capability-grants', trust: 'elicited' });
  });

  test('a revocation the PLATFORM made — the pinned document no longer matches — is not attributed to a human', () => {
    sync();
    writeSettings([{ capability: ANCHOR, runbookHash: 'sha256:not-what-shipped' }]);
    sync();

    const [ev] = events(GRANT_REVOKED_TOPIC).filter((e) => e.payload.capability === ANCHOR);
    expect(ev.payload).toMatchObject({ reason: 'hash-mismatch' });
    expect(ev.actor.kind).toBe('system');
    expect(ev.source.class).toBe('platform');
  });

  test('re-pinning the same capability to a different document issues again, chained to the old grant', () => {
    sync();
    const first = issuedFor(ANCHOR)[0];

    // The marker holds the old pin; the world now serves a different hash.
    const marker = kv.get(GRANTS_STORAGE_KEY) as {
      grants: { capability: string; runbookHash: string }[];
    };
    marker.grants.find((g) => g.capability === ANCHOR)!.runbookHash = 'sha256:whatwasgrantedbefore';
    kv.set(GRANTS_STORAGE_KEY, marker);

    sync();

    const issued = issuedFor(ANCHOR);
    expect(issued).toHaveLength(2);
    expect(issued[1].payload).toMatchObject({
      reason: 'repinned',
      previous_runbook_hash: 'sha256:whatwasgrantedbefore',
    });
    expect(issued[1].causation).toBe(first.id);
    // A re-pin is not a revocation: the capability was never withdrawn.
    expect(events(GRANT_REVOKED_TOPIC)).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Storage marker
// ───────────────────────────────────────────────────────────────────────────

describe('the storage marker', () => {
  test('is the approved intelligence_grants_* key and holds what was issued', () => {
    expect(GRANTS_STORAGE_KEY).toMatch(/^intelligence_grants_/);

    sync();
    const marker = kv.get(GRANTS_STORAGE_KEY) as {
      version: number;
      grants: { capability: string; runbookHash: string; eventId: string }[];
    };
    expect(marker.version).toBe(1);
    expect(marker.grants.find((g) => g.capability === ANCHOR)).toMatchObject({
      capability: ANCHOR,
      runbookHash: core.law!.runbooks.byCapability(ANCHOR)!.hash,
      eventId: issuedFor(ANCHOR)[0].id,
    });
  });

  test('a marker written by an older process is honoured, not re-issued', () => {
    // Seeded BEFORE the core starts, because bootstrap itself syncs: the case is
    // a machine that granted this capability in an earlier process, whose ledger
    // and marker both already carry it.
    const shippedHash = core.law!.runbooks.byCapability(ANCHOR)!.hash;
    core.close();
    fs.rmSync(dir, { recursive: true, force: true });

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-grants-'));
    kv = new Map<string, unknown>([
      [
        GRANTS_STORAGE_KEY,
        {
          version: 1,
          grants: [
            {
              capability: ANCHOR,
              runbookId: 'rb.bulk-plugin-update',
              runbookHash: shippedHash,
              eventId: 'evt_01J5X8K3V9Q2M7ABCDEFGHJKMN',
              issuedAt: '2026-08-16T00:00:00.000Z',
            },
          ],
        },
      ],
    ]);
    core = initIntelligenceCore({
      storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
      logger: silent,
      dataDir: dir,
    })!;

    expect(issuedFor(ANCHOR)).toHaveLength(0);
    sync();
    expect(issuedFor(ANCHOR)).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The join arming reads, and the parity floor
// ───────────────────────────────────────────────────────────────────────────

describe('grantedRunbooks — the join WP-20c and WP-20d read', () => {
  test('returns the runbook behind each live grant', () => {
    const { grants } = resolve();
    const rbs = grantedRunbooks(core.law!.runbooks, grants);

    expect(rbs.map((r) => r.id)).toContain('rb.bulk-plugin-update');
    expect(rbs.find((r) => r.id === 'rb.bulk-plugin-update')!.body).toContain('Bulk plugin update');
  });

  test('refuses to hand over a document whose hash is not the one the grant pins', () => {
    // The pin is re-checked at the point of use, not only at resolution: this
    // function is what the delivery path and the gate read, and a grant must
    // never yield a document other than the one it was reviewed against (§6b).
    const stale = {
      capability: ANCHOR,
      runbookId: 'rb.bulk-plugin-update',
      runbookHash: 'sha256:thedocumentthatwasreviewed',
      strictness: 'strict' as const,
      scope: {},
      source: 'settings' as const,
    };
    expect(grantedRunbooks(core.law!.runbooks, [stale])).toEqual([]);
  });

  test('with every grant switched off it returns nothing — the additive-parity floor', () => {
    const off = core.law!.runbooks
      .runbooks({ strictness: 'strict' })
      .map((rb) => ({ capability: rb.capability, enabled: false }));
    const { grants } = resolve(off);
    expect(grants).toEqual([]);
    expect(grantedRunbooks(core.law!.runbooks, grants)).toEqual([]);
  });
});

/** A core whose ledger refuses every write. */
function brokenEmitter(): IntelligenceCore {
  return {
    ...core,
    emitter: {
      emit: () => {
        throw new Error('the record cannot be written');
      },
    },
  } as unknown as IntelligenceCore;
}

describe('the parity floor', () => {
  test('a capabilityGrants key does not perturb the permissions mirror', () => {
    // buildPermissionsSnapshot feeds verifyMirror(), which every chat turn
    // reads: a new settings key that moved the divergence count would start
    // every turn carrying a false "policy disagrees with live settings"
    // warning (design note §2, parity risk 2).
    writeSettings([{ capability: ANCHOR, enabled: true }]);
    expect(core.law!.verifyMirror()).toEqual([]);
  });

  test('syncing without a core degrades to no grants and does not throw', () => {
    expect(() =>
      syncCapabilityGrants({ core: undefined, storage: storage(), logger: silent })
    ).not.toThrow();
    expect(
      syncCapabilityGrants({ core: undefined, storage: storage(), logger: silent }).grants
    ).toEqual([]);
    expect(getCapabilityGrants()).toEqual([]);
  });

  test('an emitter that throws costs the record, never the caller', () => {
    expect(() =>
      syncCapabilityGrants({ core: brokenEmitter(), storage: storage(), logger: silent })
    ).not.toThrow();
  });

  test('a grant whose announcement failed is RETRIED, not marked as announced', () => {
    // The marker is what suppresses re-issuance, so writing an entry for a grant
    // whose event never landed would leave a live grant that the record cannot
    // explain — and no later boot would try again.
    kv.delete(GRANTS_STORAGE_KEY);
    kv.set('__reset__', true); // keeps the map non-empty; irrelevant to the read
    syncCapabilityGrants({ core: brokenEmitter(), storage: storage(), logger: silent });

    const afterFailure = kv.get(GRANTS_STORAGE_KEY) as { grants: unknown[] } | undefined;
    expect(afterFailure?.grants ?? []).toEqual([]);

    // The next sync, with a working emitter, announces it.
    sync();
    expect(issuedFor(ANCHOR).length).toBeGreaterThan(0);
  });

  test("one grant's failed announcement does not stop the next grant's", () => {
    // Per-event guarding, not one try around the loop: two grants, the first
    // one's emission throws, and the second must still be recorded.
    kv.delete(GRANTS_STORAGE_KEY);
    writeSettings([{ capability: 'cap.wpe_pull' }]);
    const selective = {
      ...core,
      emitter: {
        emit: (draft: { payload: { capability?: string } }) => {
          if (draft.payload.capability === ANCHOR) throw new Error('this one fails');
          return core.emitter.emit(draft as never);
        },
      },
    } as unknown as IntelligenceCore;

    syncCapabilityGrants({ core: selective, storage: storage(), logger: silent });

    const issued = events(GRANT_ISSUED_TOPIC).map((e) => e.payload.capability);
    expect(issued).toContain('cap.wpe_pull');
  });

  test('unreadable storage costs the marker, never the caller', () => {
    const hostile = {
      get: () => {
        throw new Error('no');
      },
      set: () => {
        throw new Error('no');
      },
    };
    expect(() =>
      syncCapabilityGrants({ core, storage: hostile, logger: silent })
    ).not.toThrow();
  });

  test('the process-wide accessor carries what the last sync resolved', () => {
    sync();
    expect(capabilitiesOf(getCapabilityGrants())).toContain(ANCHOR);
    writeSettings(
      core
        .law!.runbooks.runbooks({ strictness: 'strict' })
        .map((rb) => ({ capability: rb.capability, enabled: false }))
    );
    sync();
    expect(getCapabilityGrants()).toEqual([]);
  });
});
