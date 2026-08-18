/**
 * WP-31 · the arming gap — root cause C of the 2026-08-18 incident.
 *
 * `nexus_load_procedure` acknowledges a request and the PLATFORM delivers the
 * body on the NEXT turn (R7 — a runbook may not ride a `role: 'tool'` message
 * the model has been told to distrust). Everything between those two moments is
 * the gap, and the whole live incident happened inside it: the model asked for
 * the procedure, read the acknowledgement's class labels as completion states,
 * and wrote. `runForTask` had nothing — the turn was assembled before the
 * request existed — so the sequence guard was not in the path at all.
 *
 * The rule pinned here: a pending arming request for a GRANTED, STRICT,
 * exclusive-scope capability closes the write door on its own, before any run
 * exists. Nothing is attested in the gap by definition, so the current
 * checkpoint is the first gated one and the only writes it permits are the ones
 * that checkpoint declares.
 *
 * WHY IT MUST PEEK AND NOT DRAIN. `procedureRequestForTurn` drains the queue to
 * arm the next turn's carrier. A guard that consumed a request to refuse a call
 * would refuse the write AND cancel the arming it was protecting, which is a
 * worse outcome than the incident: no refusal on the next turn either.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { getCapabilityGrants } from '../capabilityGrants';
import {
  clearArmingRequests,
  recordArmingRequest,
  takeArmingRequests,
} from '../procedureArming';
import { forgetProcedureRun } from '../procedureCursor';
import { STORAGE_KEYS } from '../../../common/constants';
import { checkCheckpointSequence } from '../sequenceGuard';
import { taskId as mintTaskId } from '../../../intelligence';
import { TIER_OVERRIDES } from '../../mcp/safety';

const CAPABILITY = 'cap.bulk_plugin_update';

let core: IntelligenceCore;
let dir: string;
let task: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-gap-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetProcedureRun('s1');
  clearArmingRequests();
  task = mintTaskId();
});

afterEach(() => {
  clearArmingRequests();
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the shipped grant this suite rests on exists — the premise, measured not assumed', () => {
  expect(getCapabilityGrants().map((g) => g.capability)).toContain(CAPABILITY);
});

describe('parity — nothing armed, nothing pending', () => {
  test('every tool passes, exactly as before this packet', () => {
    for (const tool of ['wp_plugin_update', 'bulk_plugin_update', 'wpe_backup_and_verify', 'nexus_list_sites']) {
      expect(checkCheckpointSequence(tool, task)).toBeNull();
    }
    expect(checkCheckpointSequence('wp_plugin_update', undefined)).toBeNull();
  });

  test('THE WHOLE TOOL SURFACE passes — every name the tier table knows, plus unknowns', () => {
    // The parity floor this packet rests on, taken over the population rather
    // than over a handful: with no run and no pending request the guard returns
    // null before it reads a runbook, a grant or a ledger, so the unarmed path
    // is instruction-for-instruction what it was. A single refusal here would
    // mean the flip reached a surface that never opted into a procedure.
    const names = Object.keys(TIER_OVERRIDES);
    expect(names.length).toBeGreaterThan(50); // guard the guard: an empty table would pass vacuously

    const refused = [...names, 'a_tool_nobody_registered', 'acme/contributed_tool']
      .filter((tool) => checkCheckpointSequence(tool, task) !== null);

    expect(refused).toEqual([]);
  });
});

describe('the gap itself', () => {
  test("the incident, reproduced: ask for the procedure, then write — REFUSED", () => {
    recordArmingRequest(CAPABILITY);

    const refusal = checkCheckpointSequence('wp_plugin_update', task)!;

    expect(refusal).not.toBeNull();
    expect(refusal.reason).toBe('arming-gap');
    expect(refusal.capability).toBe(CAPABILITY);
    expect(refusal.runbookId).toBe('rb.bulk-plugin-update');
    expect(refusal.checkpoint).toBe('cp.consult-history');
  });

  test('the refusal says the procedure has not arrived and no checkpoint has been performed', () => {
    recordArmingRequest(CAPABILITY);

    const { message } = checkCheckpointSequence('wp_plugin_update', task)!;

    expect(message).toContain('wp_plugin_update');
    expect(message).toContain('rb.bulk-plugin-update');
    expect(message).toMatch(/next turn/i);
    expect(message).toMatch(/no checkpoint has been performed/i);
  });

  test('the gap refusal carries the Govern door too — the fourth reason', () => {
    recordArmingRequest(CAPABILITY);

    // The gap builds its refusal on a path with no run and no cursor, so it is
    // the one that would most easily be left without the contract.
    expect(checkCheckpointSequence('wp_plugin_update', task)!.governDoor).toEqual({
      surface: 'settings',
      section: 'capabilities',
      capability: CAPABILITY,
      runbookId: 'rb.bulk-plugin-update',
    });
  });

  test('a task id is not required — the gap has no run to key on', () => {
    recordArmingRequest(CAPABILITY);
    expect(checkCheckpointSequence('wp_plugin_update', undefined)!.reason).toBe('arming-gap');
  });

  test('reads are untouched in the gap', () => {
    recordArmingRequest(CAPABILITY);
    for (const read of ['nexus_list_sites', 'wp_plugin_list', 'wp_core_version']) {
      expect(checkCheckpointSequence(read, task)).toBeNull();
    }
  });

  test('THE GUARD PEEKS: the pending request survives a refusal and still arms the next turn', () => {
    recordArmingRequest(CAPABILITY);

    checkCheckpointSequence('wp_plugin_update', task);

    // Draining here would refuse the write and cancel the arming — the next
    // turn would deliver nothing, and the turn after that would be ungoverned.
    expect(takeArmingRequests().map((r) => r.capability)).toEqual([CAPABILITY]);
  });

  test('once the request is drained by the assembling turn, the gap closes', () => {
    recordArmingRequest(CAPABILITY);
    takeArmingRequests();

    expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
  });

  test('a request for a capability nobody granted arms nothing and refuses nothing', () => {
    recordArmingRequest('cap.not-granted-anywhere');

    expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
  });

  test('A GRANT SWITCHED OFF IN SETTINGS closes the gap, though the runbook still loads', () => {
    // The case the capability-name check actually protects, and the one a
    // no-such-runbook fixture cannot reach: `cap.bulk_plugin_update` is served
    // by a strict exclusive document on disk, and the user has disabled it. A
    // queue is not an authority (WP-20b) — a request cannot enforce a procedure
    // the user switched off, and a gate that ignored that would be enforcing
    // against consent it does not have.
    const kv = new Map<string, unknown>();
    kv.set(STORAGE_KEYS.SETTINGS, {
      capabilityGrants: [{ capability: CAPABILITY, enabled: false }],
    });
    const withoutGrant = initIntelligenceCore({
      storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
      logger: { info: () => {}, error: () => {} },
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'intel-gap-off-')),
    })!;
    setIntelligenceCore(withoutGrant);
    try {
      // Premise, measured: the document IS served, and the grant is NOT live.
      expect(withoutGrant.law!.runbooks.byCapability(CAPABILITY)!.toolScope).toBe('exclusive');
      expect(getCapabilityGrants().map((g) => g.capability)).not.toContain(CAPABILITY);

      recordArmingRequest(CAPABILITY);
      expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
    } finally {
      withoutGrant.close();
    }
  });

  test('clearArmingRequests closes the gap — a chat clear is not a procedure', () => {
    recordArmingRequest(CAPABILITY);
    clearArmingRequests();

    expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
  });

  test('a gap fault never throws into the caller', () => {
    recordArmingRequest(CAPABILITY);
    setIntelligenceCore({
      get law() {
        throw new Error('registry exploded');
      },
    } as never);

    expect(() => checkCheckpointSequence('wp_plugin_update', task)).not.toThrow();
    expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
  });
});
