/**
 * WP-45 · P4 — THE RE-PIN, and the premise it corrects.
 *
 * The ratified law review moved four documents. Two of them serve capabilities
 * that hold live grants, so their hashes moved under those grants. P4's promise
 * is exact and two-sided: **no grant silently survives a hash change, and none
 * silently dies of one.**
 *
 * THE NOTE'S PREMISE WAS HALF RIGHT, AND THIS SUITE IS WHERE THAT WAS FOUND.
 * P4 says the two grants are "MATERIALIZED grants pinned to the current hashes"
 * and that "a version bump disarms both via the stale-pin rule". Driven rather
 * than read, the stale-pin rule fires only on a grant that CARRIES a hash —
 * the shape the Govern control writes. A purely materialized grant carries no
 * pin at all, so it does not disarm: it re-pins ITSELF, silently, and stays
 * granted against text nobody re-reviewed. That is the first half of P4's
 * promise failing, in the direction the note did not anticipate.
 *
 * So the re-pin does two different jobs on two different shapes, and both are
 * driven below:
 *
 *  - **Materialized** — the grant survives on its own; what was missing is that
 *    the ledger called the move `repinned`, a mechanical word for a reviewed
 *    act. The re-pin makes the event say `law-review re-pin`.
 *  - **Granted at the control** — the grant DIES (`hash-mismatch`, correctly in
 *    general). The re-pin restores it, across one exact hash transition the
 *    review actually performed and no other.
 *
 * THE ORDER OF THE FIRST TWO TESTS IS THE ARGUMENT. Each drives the world
 * WITHOUT the re-pin first, so the behaviour being fixed is demonstrated rather
 * than asserted — a re-pin test that only showed the good ending would prove
 * nothing about what it prevents.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import {
  CHAT_GRANTEE,
  GRANT_ISSUED_TOPIC,
  GRANT_ISSUE_REASONS,
  GRANTS_STORAGE_KEY,
  LAW_REVIEW_REPIN,
  lawReviewRePinFor,
  materializableCapabilities,
  resolveCapabilityGrants,
  syncCapabilityGrants,
} from '../capabilityGrants';
import { loadLawDirectory, RunbookRegistry } from '../../../intelligence';
import type { EventEnvelope } from '../../../intelligence';
import type { CapabilityGrantSetting } from '../../../common/types';
import { STORAGE_KEYS } from '../../../common/constants';

const silent = { info: () => {}, error: () => {} };
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const LAW_DIR = path.join(REPO_ROOT, 'law');

/** The two capabilities the review re-pinned, read from the table, never re-typed. */
const CONTAINMENT = 'cap.incident_containment';
const PREFLIGHT = 'cap.promotion_preflight';

let dir: string;
let kv: Map<string, unknown>;
let core: IntelligenceCore;

const storage = () => ({ get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) });

function newCore(): IntelligenceCore {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp45-repin-'));
  kv = new Map<string, unknown>();
  return initIntelligenceCore({ storage: storage(), logger: silent, dataDir: dir })!;
}

beforeEach(() => {
  core = newCore();
});
afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function issued(capability: string): EventEnvelope[] {
  // One grantee's slice — the sync emits per (grantee, capability) since the
  // agent-addressing flip, and this suite's counts are per-grant lifecycle.
  return core.ledger
    .query({ topicPrefix: GRANT_ISSUED_TOPIC, limit: 200 })
    .filter((e) => e.payload.capability === capability && e.payload.grantee === CHAT_GRANTEE);
}

function writeSettings(grants: CapabilityGrantSetting[]) {
  // Stamped with the suite grantee since the agent-addressing flip: this
  // suite's subject is the re-pin, which is per-grantee-orthogonal.
  kv.set(STORAGE_KEYS.SETTINGS, {
    capabilityGrants: grants.map((g) => ({ grantee: CHAT_GRANTEE, ...g })),
  });
}

/**
 * Put the issuance marker where a MIGRATED machine's is when this packet lands:
 * every grant announced at the hash it had BEFORE the review.
 *
 * The event ids are the bootstrap's own, never invented. `Emitter.emit`
 * validates `causation`, and a fabricated id makes the whole emission fail —
 * silently, because the producer is non-fatal by construction and logs at
 * error. A fixture with a fake id therefore produces a test that passes with
 * NO EVENT EMITTED, which is the vacuous-guard shape this suite exists to
 * avoid. (Found by driving it: the first draft did exactly that.)
 */
function rewindMarkerTo(hashes: Map<string, string>) {
  const marker = kv.get(GRANTS_STORAGE_KEY) as {
    version: number;
    grants: { grantee: string; capability: string; runbookId: string; runbookHash: string; eventId: string; issuedAt: string }[];
  };
  // The bootstrap sync must actually have announced these, or the rewind is
  // rewinding nothing and every assertion downstream is vacuous.
  for (const capability of hashes.keys()) {
    expect([capability, marker.grants.some((g) => g.capability === capability)]).toEqual([capability, true]);
  }
  kv.set(GRANTS_STORAGE_KEY, {
    ...marker,
    grants: marker.grants.map((g) => (hashes.has(g.capability) ? { ...g, runbookHash: hashes.get(g.capability)! } : g)),
  });
  // The CHAT slice's prior ids — the slice `issued()` asserts over.
  return new Map(
    marker.grants.filter((g) => g.grantee === CHAT_GRANTEE).map((g) => [g.capability, g.eventId])
  );
}

function sync(issueReasons?: ReadonlyMap<string, (typeof GRANT_ISSUE_REASONS)[number]>) {
  return syncCapabilityGrants({ core, storage: storage(), logger: silent, ...(issueReasons ? { issueReasons } : {}) });
}

/** The registry as it was BEFORE the review, rebuilt from the base blobs. */
function priorRegistry(): RunbookRegistry {
  const fork = fs.mkdtempSync(path.join(os.tmpdir(), 'wp45-prior-'));
  fs.cpSync(LAW_DIR, fork, { recursive: true });
  // Any edit moves the hash; this is the cheapest one that cannot collide with
  // a real document. What matters is only that it is NOT the shipped hash.
  const f = path.join(fork, 'runbooks', 'incident-containment.md');
  fs.writeFileSync(f, `${fs.readFileSync(f, 'utf-8')}\n<!-- prior -->\n`);
  return RunbookRegistry.build({ documents: loadLawDirectory(fork).documents });
}

// ───────────────────────────────────────────────────────────────────────────
// The premise, corrected — driven, in both shapes, WITHOUT the re-pin
// ───────────────────────────────────────────────────────────────────────────

describe('WP-45 · what a hash change does to a grant, measured', () => {
  test('THE NOTE IS RIGHT for a grant made at the control: it disarms', () => {
    const runbooks = core.law!.runbooks;
    const stale = 'sha256:' + 'a'.repeat(64);
    const resolution = resolveCapabilityGrants({
      runbooks,
      settings: {
        capabilityGrants: [
          { grantee: CHAT_GRANTEE, capability: CONTAINMENT, enabled: true, runbookId: 'rb.incident-containment', runbookHash: stale },
        ],
      },
      materialized: materializableCapabilities(runbooks).map((capability) => ({ grantee: CHAT_GRANTEE, capability })),
    });

    expect(resolution.grants.map((g) => g.capability)).not.toContain(CONTAINMENT);
    const disarm = resolution.disarmed.find((d) => d.capability === CONTAINMENT)!;
    expect(disarm.reason).toBe('hash-mismatch');
  });

  test('THE NOTE IS WRONG for a purely materialized grant: it does NOT disarm, it silently re-pins', () => {
    // The correction, and the reason the re-pin table covers this shape too.
    // A materialized grant is a list of capability NAMES — there is no hash on
    // it, so there is nothing for the stale-pin rule to compare and the grant
    // follows its document wherever it goes.
    const priorHash = priorRegistry().byCapability(CONTAINMENT)!.hash;
    const shippedHash = core.law!.runbooks.byCapability(CONTAINMENT)!.hash;
    expect(priorHash).not.toBe(shippedHash);

    const resolution = resolveCapabilityGrants({
      runbooks: core.law!.runbooks,
      settings: null,
      materialized: [{ grantee: CHAT_GRANTEE, capability: CONTAINMENT }],
    });

    const grant = resolution.grants.find((g) => g.capability === CONTAINMENT)!;
    expect(grant.runbookHash).toBe(shippedHash);
    expect(resolution.disarmed.map((d) => d.capability)).not.toContain(CONTAINMENT);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The re-pin itself
// ───────────────────────────────────────────────────────────────────────────

describe('WP-45 · the re-pin, on both grant shapes', () => {
  test('the table names exactly the two capabilities the review moved, at real hashes', () => {
    expect(LAW_REVIEW_REPIN.map((r) => r.capability).sort()).toEqual([CONTAINMENT, PREFLIGHT]);

    // The `to` side is not a literal someone typed: it must BE the hash the
    // shipped document has today, or the re-pin would move a grant onto text
    // that is not on disk — which is the failure it exists to prevent.
    for (const row of LAW_REVIEW_REPIN) {
      const rb = core.law!.runbooks.byCapability(row.capability)!;
      expect([row.capability, row.runbookId, row.to]).toEqual([row.capability, rb.id, rb.hash]);
      expect(row.from).not.toBe(row.to);
    }
  });

  /**
   * M09 · THE `to` HALF OF THE MATCH, which no behavioural case above can
   * exercise: in every one of them the shipped hash IS `to`, so dropping the
   * `to` check changes nothing observable and the mutation survives.
   *
   * The case it guards is a REAL future one. Edit `incident-containment.md`
   * again and the table's `to` goes stale. A grant sitting at `from` would then
   * be re-pinned onto text this review never produced, and the ledger would
   * record a review as having approved it. `repinned` is the honest word there,
   * and the matcher must decline.
   */
  test('the matcher declines a transition whose destination is not the reviewed text', () => {
    const row = LAW_REVIEW_REPIN[0];
    const elsewhere = 'sha256:' + 'e'.repeat(64);

    expect(lawReviewRePinFor(row.capability, row.from, row.to)).toEqual(row);
    // The document moved AGAIN after the review: not this review's transition.
    expect(lawReviewRePinFor(row.capability, row.from, elsewhere)).toBeUndefined();
    // And the `from` half, for symmetry — a grant made against other text.
    expect(lawReviewRePinFor(row.capability, elsewhere, row.to)).toBeUndefined();
    // A capability the review never touched, at both of another row's hashes.
    expect(lawReviewRePinFor('cap.bulk_plugin_update', row.from, row.to)).toBeUndefined();
  });

  test('a control-made grant at the reviewed FROM hash is restored, not disarmed', () => {
    const rows = LAW_REVIEW_REPIN;
    writeSettings(
      rows.map((r) => ({ capability: r.capability, enabled: true, runbookId: r.runbookId, runbookHash: r.from }))
    );

    const resolution = sync();

    for (const row of rows) {
      expect([row.capability, resolution.grants.some((g) => g.capability === row.capability)]).toEqual([
        row.capability,
        true,
      ]);
      expect(resolution.disarmed.map((d) => d.capability)).not.toContain(row.capability);
    }

    // And the settings entry itself was moved to the new hash — which is what
    // makes this a one-shot transition rather than a standing exemption.
    const stored = (kv.get(STORAGE_KEYS.SETTINGS) as { capabilityGrants: CapabilityGrantSetting[] }).capabilityGrants;
    for (const row of rows) {
      expect(stored.find((e) => e.capability === row.capability)!.runbookHash).toBe(row.to);
    }
  });

  test('a grant pinned to ANY OTHER hash still disarms — the table is a transition, not an exemption', () => {
    writeSettings([
      {
        capability: CONTAINMENT,
        enabled: true,
        runbookId: 'rb.incident-containment',
        runbookHash: 'sha256:' + 'c'.repeat(64),
      },
    ]);

    const resolution = sync();
    // THIS grant disarms. The other grantee's standing materialized grant is
    // untouched — a bad pin kills the grant that carries it, never the
    // capability across every holder (the grant unit is (grantee, capability)).
    expect(
      resolution.grants.filter((g) => g.grantee === CHAT_GRANTEE).map((g) => g.capability)
    ).not.toContain(CONTAINMENT);
    expect(
      resolution.disarmed.find((d) => d.capability === CONTAINMENT && d.grantee === CHAT_GRANTEE)!
        .reason
    ).toBe('hash-mismatch');
  });

  test('the ISSUANCE says law-review re-pin, with both hashes on the event', () => {
    // A machine that already announced the grant at the OLD hash — the state
    // every migrated machine is in when this packet lands.
    const priorIds = rewindMarkerTo(new Map(LAW_REVIEW_REPIN.map((r) => [r.capability, r.from])));

    sync();

    for (const row of LAW_REVIEW_REPIN) {
      const events = issued(row.capability);
      // Two: the bootstrap's own issuance, then the review's re-pin.
      expect([row.capability, events.length]).toEqual([row.capability, 2]);
      const payload = events[1].payload as Record<string, unknown>;
      expect(payload.reason).toBe('law-review re-pin');
      expect(payload.runbook_hash).toBe(row.to);
      expect(payload.previous_runbook_hash).toBe(row.from);
      // Chained to the issuance it supersedes: the trail reads in order.
      expect(events[1].causation).toBe(priorIds.get(row.capability));
    }
  });

  test('IDEMPOTENT ACROSS RESTARTS — a second sync emits nothing, with no marker of its own', () => {
    rewindMarkerTo(new Map(LAW_REVIEW_REPIN.map((r) => [r.capability, r.from])));

    sync();
    const afterFirst = LAW_REVIEW_REPIN.map((r) => issued(r.capability).length);
    sync();
    sync();
    expect(LAW_REVIEW_REPIN.map((r) => issued(r.capability).length)).toEqual(afterFirst);
    // Bootstrap's issuance plus exactly one re-pin, and no more however often
    // the process restarts.
    expect(afterFirst).toEqual([2, 2]);

    // Idempotency is STRUCTURAL, not a stored flag: once applied, the recorded
    // hash IS `to`, so `from` cannot match again. Asserted so that replacing it
    // with a marker — which can be lost — fails here.
    const marker = kv.get(GRANTS_STORAGE_KEY) as { grants: { capability: string; runbookHash: string }[] };
    for (const row of LAW_REVIEW_REPIN) {
      expect(marker.grants.find((g) => g.capability === row.capability)!.runbookHash).toBe(row.to);
    }
  });

  test('a hash change the review did NOT perform still reads as a mechanical repin', () => {
    // The word `repinned` must survive: telling a reviewed re-pin apart from an
    // unreviewed one is the entire point of the vocabulary.
    const anchor = 'cap.bulk_plugin_update';
    rewindMarkerTo(new Map([[anchor, 'sha256:' + 'd'.repeat(64)]]));

    sync();
    const events = issued(anchor);
    expect(events).toHaveLength(2);
    expect((events[1].payload as Record<string, unknown>).reason).toBe('repinned');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The vocabulary — WP-44's gate finding, folded in
// ───────────────────────────────────────────────────────────────────────────

describe('WP-45 · a caller-supplied reason, in the ratified vocabulary', () => {
  test('the vocabulary is closed, and carries the three ratified words plus the derived one', () => {
    expect([...GRANT_ISSUE_REASONS]).toEqual([
      'materialized',
      'granted-at-control',
      'law-review re-pin',
      'repinned',
    ]);
  });

  test('the MIGRATION keeps `materialized` — nobody chose those, and the word says so', () => {
    sync();
    const anchor = issued('cap.bulk_plugin_update');
    expect(anchor).toHaveLength(1);
    expect((anchor[0].payload as Record<string, unknown>).reason).toBe('materialized');
  });

  test('a supplied reason applies ONLY to the capability it names', () => {
    // The scoping that makes this safe: one sync re-resolves the whole set, so
    // a reason applied to the CALL would stamp one person's act onto every
    // grant that happened to change in the same pass.
    //
    // THE OTHER CAPABILITY MUST ISSUE IN THE **SAME** SYNC, or this proves
    // nothing (M14 survived the first draft for exactly this reason): comparing
    // against an event the BOOTSTRAP emitted reads a different sync entirely,
    // and any scoping bug would leave that earlier event untouched. So the
    // anchor's marker is rewound first, which makes it re-pin in the very sync
    // the supplied reason is passed to.
    const target = 'cap.wpe_pull';
    const anchor = 'cap.bulk_plugin_update';
    // Guarded rather than assumed: if the shipped set stops serving this, the
    // test must say so instead of passing vacuously.
    expect(core.law!.runbooks.byCapability(target)).toBeDefined();

    rewindMarkerTo(new Map([[anchor, 'sha256:' + 'f'.repeat(64)]]));
    writeSettings([{ capability: target, enabled: true }]);
    sync(new Map([[target, 'granted-at-control' as const]]));

    const targetEvents = issued(target);
    const anchorEvents = issued(anchor);
    // Both moved in this one sync — the premise, asserted before the claim.
    expect(targetEvents).toHaveLength(1);
    expect(anchorEvents).toHaveLength(2);

    expect((targetEvents[0].payload as Record<string, unknown>).reason).toBe('granted-at-control');
    // The anchor changed in the SAME pass and kept the DERIVED word.
    expect((anchorEvents[1].payload as Record<string, unknown>).reason).toBe('repinned');
  });
});
