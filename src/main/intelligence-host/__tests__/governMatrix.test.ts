/**
 * WP-44 · the Govern matrix's derivation, pinned.
 *
 * THE FIRST DESCRIBE IN THIS FILE IS THE RATIFIED PIN, and it is the reason the
 * others are not merely assertions about today's law directory. The gates
 * column's ruling was explicit that the PROPERTY is the pin rather than the
 * sentence — "if the law review authors checkpoints, this column changes by
 * itself" — so the test authors a checkpoint into a fixture document, rebuilds
 * the registry, and requires the column to have moved with no code change at
 * all. Everything else here is a fact about the shipped documents; that one is a
 * fact about the surface.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadLawDirectory, RunbookRegistry } from '../../../intelligence';
import {
  CAPABILITY_LABELS,
  GOVERN_PREAMBLE,
  buildGovernMatrix,
  ceremonyFor,
  formatIssuedAt,
  gatesForRunbook,
  gatesLines,
  readGovernMatrix,
  resolveGovernDoor,
  setCapabilityGrant,
  shortHash,
  stateFor,
} from '../governMatrix';
import {
  GRANT_ISSUED_TOPIC,
  GRANT_REVOKED_TOPIC,
  MANDATED_EXPLICIT_CAPABILITIES,
  syncCapabilityGrants,
} from '../capabilityGrants';
import { governDoorFor } from '../sequenceGuard';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { STORAGE_KEYS } from '../../../common/constants';
import type { NexusSettings } from '../../../common/types';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const LAW_DIR = path.join(REPO_ROOT, 'law');

function registryFrom(dir: string): RunbookRegistry {
  return RunbookRegistry.build({ documents: loadLawDirectory(dir).documents });
}

const shipped = () => registryFrom(LAW_DIR);

/** Every capability the shipped registry serves, materialized — the fully-granted tree. */
function allMaterialized(): string[] {
  return shipped()
    .runbooks({ strictness: 'strict' })
    .map((rb) => rb.capability)
    .filter((c) => !MANDATED_EXPLICIT_CAPABILITIES.includes(c));
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A copy of `law/` a test may edit. The tracked tree is never written to. */
function forkLaw(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp44-law-'));
  tmpDirs.push(dir);
  fs.cpSync(LAW_DIR, dir, { recursive: true });
  return dir;
}

// ───────────────────────────────────────────────────────────────────────────
// THE RATIFIED PIN — the column is derived, or it is nothing
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · the gates column MOVES when the document does', () => {
  /**
   * The law review's own charter, executed as a test.
   *
   * `rb.incident-containment` has five checkpoints and none of them is
   * attestable, so its row says the grant gates itself and nothing after it.
   * Author ONE `attest: event` checkpoint into a copy of that document and the
   * column must say "1 of 6 checkpoints the platform can verify" — with nothing
   * in `src/` edited between the two reads.
   */
  test('authoring an attestable checkpoint changes the column, with no code change', () => {
    const before = gatesLines(gatesForRunbook(shipped().byCapability('cap.incident_containment')!));
    expect(before[0]).toBe('The grant itself, and nothing after it.');
    expect(before[1]).toContain('All 5 checkpoints are narrative');

    const dir = forkLaw();
    const file = path.join(dir, 'runbooks', 'incident-containment.md');
    const src = fs.readFileSync(file, 'utf-8');
    // Appended to the checkpoint list, in the document's own vocabulary. The
    // evidence topic is required of an event attestation by the registry itself.
    const authored = src.replace(
      /^checkpoints:.*\n/m,
      (line) =>
        `${line}` +
        '  - id: cp.wp44_probe\n' +
        '    attest: event\n' +
        '    evidence:\n' +
        '      topic: task.action.executed\n'
    );
    expect(authored).not.toBe(src);
    fs.writeFileSync(file, authored);

    const after = gatesLines(gatesForRunbook(registryFrom(dir).byCapability('cap.incident_containment')!));
    expect(after[0]).toBe('1 of 6 checkpoints the platform can verify.');
    expect(after[1]).toBe("5 are on the agent's account only.");
  });

  /**
   * The same property, driven through the WHOLE matrix rather than the column
   * function — because a surface can derive a column correctly and then render a
   * literal beside it. The row's own `gatesLines` must move too.
   */
  test('the matrix ROW moves with it, not only the column helper', () => {
    const dir = forkLaw();
    const file = path.join(dir, 'runbooks', 'promotion-preflight.md');
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf-8')
        .replace(
          /^checkpoints:.*\n/m,
          (line) => `${line}  - id: cp.wp44_probe\n    attest: manifest\n`
        )
    );
    const row = buildGovernMatrix({ runbooks: registryFrom(dir) }).rows.find(
      (r) => r.capability === 'cap.promotion_preflight'
    )!;
    expect(row.gates).toEqual({ kind: 'strict', attestable: 1, checkpoints: 5, steps: 0 });
    expect(row.gatesLines).toEqual([
      '1 of 5 checkpoints the platform can verify.',
      "4 are on the agent's account only.",
    ]);
  });

  /** And the document column moves with the version, which is the same property. */
  test('a version bump moves the document column', () => {
    const dir = forkLaw();
    const file = path.join(dir, 'runbooks', 'wpe-pull.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace(/^version: 1\.0\.0$/m, 'version: 9.9.9'));
    const row = buildGovernMatrix({ runbooks: registryFrom(dir) }).rows.find(
      (r) => r.capability === 'cap.wpe_pull'
    )!;
    expect(row.documentLine).toContain('9.9.9');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The gates column's wording — unsoftened, and identical on granted rows
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · the gates column is never softened', () => {
  test('zero attestable renders the full sentence on EVERY such row, granted or not', () => {
    // The sheet spells the consequence out once and shortens it on the next
    // three rows. Reproducing that would make a row's copy depend on which other
    // rows exist. This asserts the opposite: same force everywhere.
    const matrix = buildGovernMatrix({ runbooks: shipped(), materialized: allMaterialized() });
    const zero = matrix.rows.filter((r) => r.gates.kind === 'strict' && r.gates.attestable === 0);
    expect(zero.length).toBeGreaterThanOrEqual(4);
    const granted = zero.filter((r) => r.state === 'materialized' || r.state === 'granted-by-you');
    const ungranted = zero.filter((r) => r.state !== 'materialized' && r.state !== 'granted-by-you');
    // Both populations are non-empty, or this test proves nothing about "as
    // loudly on granted rows as denied ones".
    expect(granted.length).toBeGreaterThan(0);
    expect(ungranted.length).toBeGreaterThan(0);
    for (const row of zero) {
      expect(row.gatesLines[0]).toBe('The grant itself, and nothing after it.');
      expect(row.gatesLines[1]).toBe(
        `All ${row.gates.checkpoints} checkpoints are narrative — the platform can verify none of ` +
          'them, so nothing downstream of this grant is provable.'
      );
    }
  });

  test('the granted rows and the denied rows carry byte-identical gates copy for the same shape', () => {
    const matrix = buildGovernMatrix({ runbooks: shipped(), materialized: allMaterialized() });
    const byCount = new Map<number, string[][]>();
    for (const row of matrix.rows.filter((r) => r.gates.kind === 'strict' && r.gates.attestable === 0)) {
      const seen = byCount.get(row.gates.checkpoints) ?? [];
      byCount.set(row.gates.checkpoints, [...seen, row.gatesLines]);
    }
    for (const [, variants] of byCount) {
      for (const v of variants) expect(v).toEqual(variants[0]);
    }
  });

  test('a guided row says steps, never checkpoints — the reserved vocabulary holds', () => {
    const matrix = buildGovernMatrix({ runbooks: shipped() });
    for (const row of matrix.rows.filter((r) => r.gates.kind === 'guided')) {
      expect(row.gatesLines[0]).toBe(`${row.gates.steps} steps, none of them a checkpoint.`);
      expect(row.gatesLines[1]).toBe(
        'A guided document is adapted as it runs, and deviations are recorded with their reason.'
      );
      // ADR-17 amendment 2, and the v1.3 table's "Never say" column: steps belong
      // to guided documents, checkpoints to strict ones.
      expect(row.gatesLines.join(' ')).not.toMatch(/\d+ of \d+ checkpoints/);
    }
  });

  /**
   * FAIL-CLOSED ON A CLASS THAT DOES NOT EXIST YET — the hole the battery found.
   *
   * `attest` has exactly three values today (`event`, `manifest`, `narrative`),
   * so `attest === 'event' || attest === 'manifest'` and `attest !== 'narrative'`
   * agree on every value that can currently be authored, and the battery's M01
   * mutation between them SURVIVED. They are not equivalent in the direction
   * that matters: a fourth class added tomorrow would count as PROVABLE under
   * the second and as narrative under the first.
   *
   * This surface's whole claim is about what the platform can verify, so the
   * unknown must fall on the unverifiable side. The class is cast in, because
   * the registry's own schema will not parse one that is not in the enum — the
   * test drives the production function over the value directly.
   */
  test('an attest class nobody has declared yet is NOT counted as attestable', () => {
    const runbook = shipped().byCapability('cap.incident_containment')!;
    const future = {
      ...runbook,
      checkpoints: [
        ...runbook.checkpoints,
        { id: 'cp.future', attest: 'oracle' as never, tools: [] },
      ],
    };
    const gates = gatesForRunbook(future);
    expect(gates.checkpoints).toBe(6);
    // Six checkpoints, still zero the platform can verify.
    expect(gates.attestable).toBe(0);
    expect(gatesLines(gates)[0]).toBe('The grant itself, and nothing after it.');
  });

  test('the anchor renders the split the documents actually declare', () => {
    const row = buildGovernMatrix({ runbooks: shipped() }).rows.find(
      (r) => r.capability === 'cap.bulk_plugin_update'
    )!;
    expect(row.gatesLines).toEqual([
      '4 of 8 checkpoints the platform can verify.',
      "4 are on the agent's account only.",
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The row set — every capability the registry serves, and no absences
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · no hiding of ungranted capabilities', () => {
  test('the row set is the REGISTRY\'s, not the resolver\'s two lists', () => {
    const registry = shipped();
    const matrix = buildGovernMatrix({ runbooks: registry });
    expect(matrix.rows.map((r) => r.capability).sort()).toEqual(
      registry.runbooks().map((rb) => rb.capability).sort()
    );
  });

  /**
   * THE REGRESSION THIS ROW SET EXISTS TO PREVENT, driven rather than described.
   *
   * `resolveCapabilityGrants` returns the two guided capabilities in NEITHER
   * `grants` nor `disarmed` — strict-only materialization never names them and
   * nothing configured them. A matrix built from the resolver's output would
   * therefore render five rows out of seven and look complete. This test names
   * the two, so a future change that starts hiding them fails here with their
   * ids rather than with an off-by-two.
   */
  test('the guided capabilities are in NEITHER resolver list and are still rows', () => {
    const registry = shipped();
    const guided = registry.runbooks({ strictness: 'guided' }).map((rb) => rb.capability);
    expect(guided.sort()).toEqual(['cap.diagnose_site', 'cap.wpe_pull']);

    const matrix = buildGovernMatrix({ runbooks: registry, materialized: allMaterialized() });
    for (const capability of guided) {
      const row = matrix.rows.find((r) => r.capability === capability);
      expect(row).toBeDefined();
      expect(row!.state).toBe('denied');
      expect(row!.stateLine).toContain('Guided documents carry no mandatory full-body ride');
    }
  });

  test('an empty tree renders no rows rather than seven denials', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp44-empty-'));
    tmpDirs.push(dir);
    expect(buildGovernMatrix({ runbooks: registryFrom(dir) }).rows).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The five states
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · the five states, each from the grant record', () => {
  test('a capability arrives DENIED — nothing materialized, nothing granted', () => {
    // The deny-flip, seen from the surface: a full law directory and no
    // materialized list produces not one granted row.
    const matrix = buildGovernMatrix({ runbooks: shipped() });
    expect(matrix.rows.filter((r) => r.inForce)).toEqual([]);
    expect(matrix.preamble).toBe(GOVERN_PREAMBLE);
  });

  test('materialized vs granted-by-you is which ACT put it in the live set', () => {
    const registry = shipped();
    const bySettings = buildGovernMatrix({
      runbooks: registry,
      settings: { capabilityGrants: [{ capability: 'cap.incident_containment', enabled: true }] },
    }).rows.find((r) => r.capability === 'cap.incident_containment')!;
    expect(bySettings.state).toBe('granted-by-you');

    const byMigration = buildGovernMatrix({
      runbooks: registry,
      materialized: ['cap.incident_containment'],
    }).rows.find((r) => r.capability === 'cap.incident_containment')!;
    expect(byMigration.state).toBe('materialized');

    // Both are GRANTED. The distinction is provenance, never force.
    expect(bySettings.inForce).toBe(true);
    expect(byMigration.inForce).toBe(true);
    expect(bySettings.chip).toBe(byMigration.chip);
  });

  test('the production capabilities render NEVER BY DEFAULT, disclosed and actionable', () => {
    const matrix = buildGovernMatrix({ runbooks: shipped(), materialized: allMaterialized() });
    for (const capability of MANDATED_EXPLICIT_CAPABILITIES) {
      const row = matrix.rows.find((r) => r.capability === capability)!;
      expect(row.state).toBe('never-by-default');
      expect(row.chip).toBe('Never by default');
      expect(row.consent).toBe(false);
      expect(row.stateLine).toBe(
        'Production consequence is not a default, so nothing but a grant you make yourself reaches this.'
      );
      // A row someone can act on, which is what makes it a disclosure rather
      // than a refusal: the door lands here and the switch is live.
      expect(row.door).toEqual(governDoorFor(capability, row.document!.runbookId));
    }
  });

  test('the mandated rows carry NO sentence about another row\'s state', () => {
    // The sheet argues "containment is granted and remediation is not" on the
    // remediation row. True on the day it was drawn; false the moment
    // containment is revoked. A row may not assert a fact about a different row.
    const revoked = buildGovernMatrix({
      runbooks: shipped(),
      materialized: allMaterialized().filter((c) => c !== 'cap.incident_containment'),
    }).rows.find((r) => r.capability === 'cap.incident_remediation')!;
    const granted = buildGovernMatrix({
      runbooks: shipped(),
      materialized: allMaterialized(),
    }).rows.find((r) => r.capability === 'cap.incident_remediation')!;
    expect(revoked.stateLine).toBe(granted.stateLine);
    expect(revoked.stateLine).not.toMatch(/[Cc]ontainment/);
  });

  test('a mandated capability IS grantable, and then reads as granted by you', () => {
    // The deny-flip's own words: production consequence reaches the live set
    // only through "an explicit settings entry — a grant a person made".
    const row = buildGovernMatrix({
      runbooks: shipped(),
      settings: { capabilityGrants: [{ capability: 'cap.promote_environment', enabled: true }] },
    }).rows.find((r) => r.capability === 'cap.promote_environment')!;
    expect(row.state).toBe('granted-by-you');
    expect(row.inForce).toBe(true);
    // And the gates column tells the granter what that buys, in the same row.
    expect(row.gatesLines[0]).toBe('The grant itself, and nothing after it.');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Disarmed — granted and NOT IN FORCE, never denied
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · the disarmed row, as ruled', () => {
  const mismatched = () =>
    buildGovernMatrix({
      runbooks: shipped(),
      settings: {
        capabilityGrants: [
          { capability: 'cap.promotion_preflight', enabled: true, runbookHash: 'sha256:deadbeefdeadbeef' },
        ],
      },
    }).rows.find((r) => r.capability === 'cap.promotion_preflight')!;

  test('the SWITCH stays on and the CHIP goes loud — two facts, two renders', () => {
    const row = mismatched();
    expect(row.state).toBe('disarmed');
    expect(row.chip).toBe('Disarmed');
    // The switch renders CONSENT: the user granted this and nothing they did
    // withdrew it. Rendering it off would be the platform quietly revoking on
    // the user's behalf.
    expect(row.consent).toBe(true);
    // The chip renders FORCE.
    expect(row.inForce).toBe(false);
  });

  test('it is never rendered as denied', () => {
    const row = mismatched();
    expect(row.state).not.toBe('denied');
    expect(row.chip).not.toBe('Denied');
    expect(row.stateLine).toContain('control.grant.issued');
  });

  test('the band names the integrity failure in its own words, and carries a door', () => {
    const row = mismatched();
    expect(row.disarm).not.toBeNull();
    expect(row.disarm!.reason).toBe('hash-mismatch');
    expect(row.disarm!.band).toBe(
      'Granted, and disarmed on an integrity failure. The document on disk is not the one this ' +
        'grant was made against. Not staleness — the review this grant carries happened against ' +
        'different text, so the capability behaves as though it were never granted.'
    );
    expect(row.disarm!.doorLabel).toBe('Re-grant against the current document.');
    // Both hashes reach the surface: the remedy needs the values.
    expect(row.disarm!.detail).toContain('sha256:deadbeefdeadbeef');
  });

  test('the document column says the mismatch too, where a reader checks the file', () => {
    expect(mismatched().documentLine).toMatch(/ — no longer matches$/);
    expect(mismatched().documentLine).toContain('rb.promotion-preflight · 1.1.0 · strict · sha256:ae5a1678d2');
  });

  /**
   * THE RULING READ BACKWARDS, pinned so it cannot be re-introduced.
   *
   * `resolveCapabilityGrants` reports a user's own switch-off as a disarm, with
   * reason `disabled-by-settings`. Rendering that as DISARMED would leave the
   * switch ON for a capability its owner had just switched OFF — the exact
   * inverse of ruling 3, which says the switch renders consent. A revocation is
   * not an integrity failure.
   */
  test('a user\'s own revocation is NOT disarmed — consent was withdrawn', () => {
    const row = buildGovernMatrix({
      runbooks: shipped(),
      materialized: allMaterialized(),
      settings: { capabilityGrants: [{ capability: 'cap.bulk_plugin_update', enabled: false }] },
    }).rows.find((r) => r.capability === 'cap.bulk_plugin_update')!;
    expect(row.state).toBe('denied');
    expect(row.consent).toBe(false);
    expect(row.inForce).toBe(false);
    expect(row.disarm).toBeNull();
    expect(row.stateLine).toBe('Revoked by you. Grantable again from this row.');
  });

  test('a revoked PRODUCTION capability returns to never-by-default, not to a bare denial', () => {
    // The mandate did not stop being true while the grant existed.
    const row = buildGovernMatrix({
      runbooks: shipped(),
      settings: { capabilityGrants: [{ capability: 'cap.promote_environment', enabled: false }] },
    }).rows.find((r) => r.capability === 'cap.promote_environment')!;
    expect(row.state).toBe('never-by-default');
    expect(row.consent).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The act — against a REAL core, a REAL ledger, and WP-20b's own producer
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · the act, at the control', () => {
  const opened: Array<{ core: IntelligenceCore; dir: string }> = [];
  let kv: Map<string, unknown>;
  let core: IntelligenceCore;
  const silent = { info: () => {}, warn: () => {}, error: () => {} };

  function boot(): IntelligenceCore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp44-act-'));
    kv = new Map<string, unknown>();
    core = initIntelligenceCore({
      storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
      logger: silent,
      dataDir: dir,
    })!;
    opened.push({ core, dir });
    return core;
  }

  const storage = () => ({ get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) });
  const act = (capability: string, grant: boolean) =>
    setCapabilityGrant({ core, storage: storage(), logger: silent, capability, grant });
  const events = (topic: string) => core.ledger.query({ topicPrefix: topic, limit: 500 });

  afterEach(() => {
    for (const open of opened.splice(0)) {
      open.core.close();
      fs.rmSync(open.dir, { recursive: true, force: true });
    }
  });

  test('granting a production capability writes a REAL control.grant.issued', () => {
    boot();
    const before = events(GRANT_ISSUED_TOPIC).filter((e) => e.payload.capability === 'cap.promote_environment');
    expect(before).toEqual([]);

    const result = act('cap.promote_environment', true);
    expect(result.ok).toBe(true);

    const issued = events(GRANT_ISSUED_TOPIC).filter((e) => e.payload.capability === 'cap.promote_environment');
    expect(issued).toHaveLength(1);
    // Through WP-20b's producer, so the event carries everything that producer
    // carries — including which layer granted it.
    expect(issued[0].payload.grant_source).toBe('settings');
    expect(issued[0].payload.runbook_id).toBe('rb.promotion-execute');
  });

  test('the row then STATES which act made it, from that event', () => {
    boot();
    const capability = 'cap.promote_environment';
    const result = act(capability, true);
    const row = result.matrix!.rows.find((r) => r.capability === capability)!;
    const issued = events(GRANT_ISSUED_TOPIC).filter((e) => e.payload.capability === capability)[0];

    expect(row.issuance).not.toBeNull();
    // The id on the row is the id of the event in the ledger — not a reference
    // to one, the same string.
    expect(row.issuance!.eventId).toBe(issued.id);
    expect(row.stateLine).toBe(`control.grant.issued · ${issued.id} · ${formatIssuedAt(row.issuance!.issuedAt)}`);
  });

  test('the grant PINS the document it was made against', () => {
    boot();
    act('cap.incident_remediation', true);
    const settings = kv.get(STORAGE_KEYS.SETTINGS) as NexusSettings;
    const entry = settings.capabilityGrants!.find((e) => e.capability === 'cap.incident_remediation')!;
    const rb = core.law!.runbooks.byCapability('cap.incident_remediation')!;
    // Without this, the disarmed state is unreachable: "the review this grant
    // carries happened against different text" is only true if the grant
    // recorded which text.
    expect(entry.runbookId).toBe(rb.id);
    expect(entry.runbookHash).toBe(rb.hash);
  });

  test('every widening is REVERSIBLE from the same row that made it', () => {
    boot();
    const capability = 'cap.promote_environment';
    act(capability, true);
    const revoked = act(capability, false);

    expect(revoked.ok).toBe(true);
    const row = revoked.matrix!.rows.find((r) => r.capability === capability)!;
    expect(row.inForce).toBe(false);
    expect(row.consent).toBe(false);

    const events2 = events(GRANT_REVOKED_TOPIC).filter((e) => e.payload.capability === capability);
    expect(events2).toHaveLength(1);
    // A person's act, recorded as a person's act — not as a platform observation.
    expect(events2[0].actor.kind).toBe('human');
    expect(events2[0].source.class).toBe('intent');
    // Chained to the issuance it answers, so "revoked" has a subject.
    expect(events2[0].causation).toBeTruthy();
  });

  test('the widening is VISIBLE the moment it is made — no reload, no next boot', () => {
    boot();
    const before = readGovernMatrix({ core, storage: storage() })!;
    expect(before.rows.find((r) => r.capability === 'cap.promote_environment')!.inForce).toBe(false);
    act('cap.promote_environment', true);
    const after = readGovernMatrix({ core, storage: storage() })!;
    expect(after.rows.find((r) => r.capability === 'cap.promote_environment')!.inForce).toBe(true);
  });

  test('re-granting a disarmed capability re-pins it and puts it back in force', () => {
    boot();
    const capability = 'cap.promotion_preflight';
    // A grant made against text that is not what is on disk — the disarmed state.
    // Synced, not merely written: the boot already issued this grant, so a
    // disarm nobody announced leaves the ledger holding the old triple and the
    // change gate correctly suppresses the re-grant as repetition. Announcing it
    // is what the running process does on any settings write, and skipping that
    // step would have this test describe a state the product cannot be in.
    kv.set(STORAGE_KEYS.SETTINGS, {
      capabilityGrants: [{ capability, enabled: true, runbookHash: 'sha256:deadbeefdeadbeef' }],
    });
    syncCapabilityGrants({ core, storage: storage(), logger: silent });
    const disarmed = readGovernMatrix({ core, storage: storage() })!.rows.find((r) => r.capability === capability)!;
    expect(disarmed.state).toBe('disarmed');

    // The band's own door: "Re-grant against the current document."
    const after = act(capability, true).matrix!.rows.find((r) => r.capability === capability)!;
    expect(after.inForce).toBe(true);
    expect(after.disarm).toBeNull();
    expect(after.documentLine).not.toMatch(/no longer matches/);

    // AND IT READS `materialized`, NOT `granted-by-you`, WHICH IS CORRECT.
    // This capability is in the migration's record, so the materialized layer is
    // what admits it; the user's act cleared a hash pin rather than creating the
    // grant. Deriving the state from `source` is what makes it a fact instead of
    // a guess — a surface that promoted the row to "granted by you" because the
    // last click was a person's would be authoring provenance, and would then
    // disagree with the resolver about which layer a revocation has to remove.
    expect(after.state).toBe('materialized');
    // The user's act is not lost: it is the issuance the row now cites.
    const issuances = events(GRANT_ISSUED_TOPIC).filter((e) => e.payload.capability === capability);
    expect(issuances.length).toBeGreaterThan(1);
    expect(after.issuance!.eventId).toBe(issuances[issuances.length - 1].id);
  });

  test('a capability nothing serves is refused, not written', () => {
    boot();
    const result = act('cap.not_a_thing', true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-served');
    const settings = (kv.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
    expect((settings.capabilityGrants ?? []).some((e) => e.capability === 'cap.not_a_thing')).toBe(false);
  });

  test('a failed write reports failure rather than a grant that did not happen', () => {
    boot();
    const failing = {
      get: (k: string) => kv.get(k) ?? null,
      set: (k: string, v: unknown) => {
        if (k === STORAGE_KEYS.SETTINGS) throw new Error('disk full');
        kv.set(k, v);
      },
    };
    const result = setCapabilityGrant({
      core,
      storage: failing,
      logger: silent,
      capability: 'cap.promote_environment',
      grant: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unwritable');
    // And nothing was announced: a grant that was not stored must not be a
    // grant that was recorded.
    expect(events(GRANT_ISSUED_TOPIC).filter((e) => e.payload.capability === 'cap.promote_environment')).toEqual([]);
  });

  test('a dark core degrades rather than throwing into the caller', () => {
    expect(() =>
      setCapabilityGrant({
        core: undefined,
        storage: { get: () => null, set: () => {} },
        logger: silent,
        capability: 'cap.promote_environment',
        grant: true,
      })
    ).not.toThrow();
    expect(readGovernMatrix({ core: undefined, storage: { get: () => null, set: () => {} } })).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The door lands on the ROW — J-Refusal's deep-link criterion
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · the door lands on the row, never the top of Settings', () => {
  const matrix = () => buildGovernMatrix({ runbooks: shipped(), materialized: allMaterialized() });

  test('a refusal\'s structured target resolves to the specific capability', () => {
    // The exact target `sequenceGuard` puts on a refused gated call.
    const door = governDoorFor('cap.promote_environment', 'rb.promotion-execute');
    const row = resolveGovernDoor(matrix(), door);
    expect(row).not.toBeNull();
    expect(row!.capability).toBe('cap.promote_environment');
  });

  test('every row is reachable by its own door — no capability is a dead link', () => {
    const m = matrix();
    for (const row of m.rows) {
      expect(resolveGovernDoor(m, row.door)).toBe(row);
    }
  });

  test('a door naming a superseded DOCUMENT still lands on the capability\'s row', () => {
    // The sheet was drawn against rb.promotion-execute 1.1.0; WP-20g bumped it.
    // A refusal captured before the bump must not send a person to the top of
    // Settings — the row is the answer to the refusal that sent them there, and
    // the row is keyed by capability because the capability is what a grant is
    // about.
    const stale = governDoorFor('cap.promote_environment', 'rb.staging-promotion');
    expect(resolveGovernDoor(matrix(), stale)!.capability).toBe('cap.promote_environment');
  });

  test('a door for another surface or section resolves to nothing', () => {
    const m = matrix();
    expect(resolveGovernDoor(m, { surface: 'settings', section: 'connections', capability: 'cap.wpe_pull', runbookId: 'rb.wpe-pull' } as never)).toBeNull();
    expect(resolveGovernDoor(m, null)).toBeNull();
    expect(resolveGovernDoor(m, undefined)).toBeNull();
  });

  test('a door for a capability nothing serves resolves to nothing, rather than to row zero', () => {
    // The failure this forbids is silent: `.find()` returning undefined and a
    // caller falling back to `rows[0]` would land a promotion refusal on the
    // plugin-update row and look like it worked.
    expect(resolveGovernDoor(matrix(), governDoorFor('cap.not_a_thing', 'rb.nope'))).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The vocabulary — ratified rows, transcribed, with the id kept
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · the labels are the ratified vocabulary, not this file\'s invention', () => {
  /**
   * THE TRANSCRIPTION PIN, same discipline as the journey specs'.
   *
   * The seven labels were ratified as Controlled Vocabulary v1.3 rows. The
   * failure mode of transcribing them is a word that drifted, which no
   * behavioural test can see — so the ratified table is re-read on every run and
   * this module's map is required to equal it. A fixture of the expected text
   * would be a second transcription, and two transcriptions of one source are
   * two things that can drift apart.
   */
  const VOCAB = path.join(REPO_ROOT, 'docs', 'intelligence', 'user-docs', 'your-copy-and-the-live-site.md');

  function ratifiedRows(): Record<string, string> {
    const src = fs.readFileSync(VOCAB, 'utf-8');
    const section = src.split(/^### /m).find((s) => s.startsWith('v1.3 additions'));
    expect(section).toBeDefined();
    const out: Record<string, string> = {};
    for (const line of section!.split('\n')) {
      const m = /^\|\s*(cap\.[a-z_]+)\s*\|\s*\*\*([^*]+)\*\*/.exec(line);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  }

  test('found the ratified table', () => {
    expect(Object.keys(ratifiedRows())).toHaveLength(7);
  });

  test('every label equals its ratified row, exactly', () => {
    expect({ ...CAPABILITY_LABELS }).toEqual(ratifiedRows());
  });

  test('every capability the registry serves has a ratified label', () => {
    for (const rb of shipped().runbooks()) {
      expect(Object.keys(CAPABILITY_LABELS)).toContain(rb.capability);
    }
  });

  test('the ID is kept beside the label and never replaced by it', () => {
    // The ratification's own condition: the refusals cite ids, and a matrix that
    // hides the id breaks the door's vocabulary.
    for (const row of buildGovernMatrix({ runbooks: shipped() }).rows) {
      expect(row.id).toBe(row.capability);
      expect(row.label).not.toBe(row.id);
    }
  });

  test('a capability with no ratified label renders its ID, never an invented name', () => {
    const dir = forkLaw();
    const file = path.join(dir, 'runbooks', 'wpe-pull.md');
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf-8').replace(/^capability: cap\.wpe_pull.*$/m, 'capability: cap.brand_new')
    );
    const row = buildGovernMatrix({ runbooks: registryFrom(dir) }).rows.find(
      (r) => r.capability === 'cap.brand_new'
    )!;
    expect(row.label).toBe('cap.brand_new');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The absences — must-nots, as first-class tests
// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 · what this surface must NOT do', () => {
  const RAW = fs.readFileSync(path.join(__dirname, '..', 'governMatrix.ts'), 'utf-8');

  /**
   * The module's CODE, with its prose removed.
   *
   * A grep-for-absence over the whole file is satisfied by the file's own
   * comments about the absence — this module explains why there is no
   * "recommended set", and the first version of this test failed on that
   * sentence. An assertion a comment can break is an assertion a comment can
   * also silently satisfy, so the subject is the code.
   */
  const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('the comment stripper actually removed the prose it is meant to', () => {
    // Guards the guard: a stripper that silently matched nothing would make
    // every absence test below vacuous.
    expect(RAW).toMatch(/recommended/i);
    expect(SOURCE).not.toMatch(/recommended/i);
    expect(SOURCE).toContain('export function setCapabilityGrant');
  });

  test('NO grant-all, no recommended set, no bulk enable', () => {
    // `setCapabilityGrant` takes ONE capability and no list. A widening is one
    // capability at a time because that is the unit a person can weigh.
    expect(SOURCE).not.toMatch(/grantAll|enableAll|recommended|bulkGrant|grantMany/i);
    // Driven, not merely grepped: the act's signature has no plural.
    const arity = setCapabilityGrant.length;
    expect(arity).toBe(1); // one options object
    expect(SOURCE).toMatch(/capability: string;/);
    expect(SOURCE).not.toMatch(/capabilities\s*:\s*(readonly\s+)?string\[\]\s*;[\s\S]{0,200}grant/);
  });

  test('NO health score — a grant count is not a posture to improve', () => {
    const matrix = buildGovernMatrix({ runbooks: shipped(), materialized: allMaterialized() });
    // "Three of seven granted is not a posture to improve; it is a record of
    // what was decided." Nothing on the matrix totals, scores, or rates.
    expect(Object.keys(matrix)).toEqual(['preamble', 'rows']);
    expect(SOURCE).not.toMatch(/\bscore\b|\bposture\b|\bhealth\b|grantedCount|percentGranted/i);
  });

  test('NO severity theatre on the production rows', () => {
    const matrix = buildGovernMatrix({ runbooks: shipped(), materialized: allMaterialized() });
    for (const capability of MANDATED_EXPLICIT_CAPABILITIES) {
      const row = matrix.rows.find((r) => r.capability === capability)!;
      // They are denied by rule, and the rule is stated once rather than
      // dressed in red. No severity, no danger word, no exclamation.
      expect(row.stateLine).not.toMatch(/danger|critical|severe|warning|!/i);
      expect(row.chip).toBe('Never by default');
    }
  });

  test('NO copy of the runbook — the document is named, hashed, and one door away', () => {
    const matrix = buildGovernMatrix({ runbooks: shipped(), materialized: allMaterialized() });
    const rendered = JSON.stringify(matrix);
    for (const rb of shipped().runbooks()) {
      // The whole canonical document must never reach this surface. Checked
      // against the real body rather than a length heuristic.
      expect(rendered).not.toContain(rb.canonicalText);
      expect(rendered).not.toContain(rb.body.slice(0, 200));
    }
  });

  test('NO conversational route in or out — nothing here is a tool', () => {
    // XD-8: consent that must be recorded is made at a control, never elicited
    // in chat. Kept by there being no path rather than by a check that refuses
    // one, so the pin is the absence of the registration itself.
    const toolDirs = [
      path.join(REPO_ROOT, 'src', 'main', 'mcp'),
      path.join(REPO_ROOT, 'src', 'main', 'agent-runtime'),
      path.join(REPO_ROOT, 'src', 'main', 'chat'),
    ];
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const text = fs.readFileSync(full, 'utf-8');
        if (/governMatrix|setCapabilityGrant|GOVERN_MATRIX|GOVERN_SET_GRANT/.test(text)) {
          hits.push(path.relative(REPO_ROOT, full));
        }
      }
    };
    for (const dir of toolDirs) if (fs.existsSync(dir)) walk(dir);
    expect(hits).toEqual([]);
  });
});
