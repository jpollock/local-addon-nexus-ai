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

  test('THE WHOLE TOOL SURFACE passes — except exactly what law binds to an ungranted capability', () => {
    // WP-31's parity floor, taken over the population rather than over a
    // handful: with no run and no pending request the guard used to return null
    // before it read a runbook, a grant or a ledger, so the unarmed path was
    // instruction-for-instruction what it was.
    //
    // **WP-20g CHANGED THIS ASSERTION, DELIBERATELY, AND IT IS THE PACKET.**
    // Rule 7 runs with nothing armed — a grant is prior to a run — so the
    // unarmed path is no longer empty of refusals. Weakening the test to
    // `not.toContain('wpe_promote_environment')`, or deleting it, would hide
    // precisely the reach this packet was built to take away and the parity it
    // must still preserve.
    //
    // So the expected set is DERIVED FROM THE DOCUMENTS HERE, independently of
    // the guard's own derivation, and compared: the tools refused must be
    // exactly the tools shipped law binds to a capability nothing grants. A
    // runbook that declares a new tool tomorrow appears in this list and is
    // READ; a refusal that appears for any other reason fails.
    const names = Object.keys(TIER_OVERRIDES);
    expect(names.length).toBeGreaterThan(50); // guard the guard: an empty table would pass vacuously

    const grantedCaps = new Set(getCapabilityGrants().map((g) => g.capability));
    const boundToUngranted = (tool: string): boolean => {
      const caps = core
        .law!.runbooks.runbooks()
        .filter((rb) =>
          (rb.checkpoints ?? []).some(
            (c) => c.evidence?.tool === tool || (c.tools ?? []).some((t) => t.name === tool)
          )
        )
        .map((rb) => rb.capability);
      return caps.length > 0 && !caps.some((c) => grantedCaps.has(c));
    };

    const population = [...names, 'a_tool_nobody_registered', 'acme/contributed_tool'];
    const refused = population.filter((tool) => checkCheckpointSequence(tool, task) !== null);
    const expected = population.filter(boundToUngranted);

    // Not vacuous in either direction: shipped law binds at least one tool to a
    // capability that is never granted by default, and this says so out loud.
    expect(expected.length).toBeGreaterThan(0);
    expect(refused).toEqual(expected);
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

  test('THE RUNBOOK’S OWN WRITE TOOL IS REFUSED IN THE GAP TOO — no run means no sequencer', () => {
    recordArmingRequest(CAPABILITY);

    // `bulk_plugin_update` IS declared (cp.canary, cp.roll-fleet), so on the RUN
    // path rule 5 leaves it to the sequencer, which refuses it until approval
    // and backup are attested. In the gap there is no run and therefore no
    // sequencer — an unclaimed-only reading here would execute the capability's
    // own primary tool with no approval and no backup, which is the incident's
    // harm reached through a claimed tool instead of an unclaimed one.
    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;
    expect(refusal.reason).toBe('arming-gap');
    expect(refusal.checkpoint).toBe('cp.consult-history');
  });

  test('and so is the canary instrument, which no run has reached', () => {
    recordArmingRequest(CAPABILITY);

    // WP-31's own authoring: `verify_site_live` is declared on cp.verify-canary,
    // five checkpoints in. Declaring a tool does not make it callable before the
    // run that would reach it has started.
    expect(checkCheckpointSequence('verify_site_live', task)!.reason).toBe('arming-gap');
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
