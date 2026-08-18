/**
 * WP-20d · the sequence guard — an armed strict runbook's gated calls, refused
 * out of order.
 *
 * The runbook under test is the SHIPPED `rb.bulk-plugin-update`, read through
 * the real registry: a guard tested against a synthetic runbook would pass
 * while the authored one claimed different tools at different checkpoints.
 *
 * Two properties are load-bearing and neither is obvious:
 *
 *  - **A narrative checkpoint cannot gate anything.** Four of the anchor's
 *    eight are narrative, and nothing in the ledger can ever attest them. If
 *    they were prerequisites, cp.roll-fleet would be unreachable forever — the
 *    gate would not be strict, it would be broken. So the guard requires the
 *    ATTESTABLE predecessors only, and the refusal says which ones those are.
 *  - **A tool claimed by two checkpoints gates at the EARLIER one.**
 *    `bulk_plugin_update` is both the canary act and the fleet roll, and no
 *    ledger event distinguishes them. Gating at cp.canary's position enforces
 *    backup-and-approval-before-any-update, which is the property the runbook
 *    actually cares about.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  ACTION_EXECUTED_TOPIC,
  ACTION_EXECUTED_SCHEMA,
  OUTCOME_RECORDED_TOPIC,
  OUTCOME_RECORDED_SCHEMA,
  RATIONALE_RECORDED_TOPIC,
  RATIONALE_RECORDED_SCHEMA,
} from '../actionProducer';
import { CONTEXT_ASSEMBLED_TOPIC, CONTEXT_ASSEMBLED_SCHEMA } from '../chatAssembly';
import { armProcedureRun, forgetProcedureRun, registerProcedureTurn } from '../procedureCursor';
import { checkCheckpointSequence } from '../sequenceGuard';
import { taskId as mintTaskId } from '../../../intelligence';

const CAPABILITY = 'cap.bulk_plugin_update';

let core: IntelligenceCore;
let dir: string;
let task: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-guard-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetProcedureRun('s1');
  task = mintTaskId();
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function arm(): void {
  const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
  armProcedureRun({
    sessionId: 's1',
    capability: CAPABILITY,
    runbookId: runbook.id,
    runbookHash: runbook.hash,
  });
  registerProcedureTurn({ sessionId: 's1', taskId: task });
}

function emitManifest(): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: CONTEXT_ASSEMBLED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: task,
    payload: { task, retrieval: [{ store: 'ledger', query: 'q', returned: 1 }] },
  });
}

function emitRationale(decision: 'approved' | 'denied'): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: RATIONALE_RECORDED_TOPIC,
    schema: RATIONALE_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_local_operator', kind: 'human' },
    source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
    correlation: task,
    payload: { tool: 'bulk_plugin_update', decision, prompt: 'card', source: 'approval-card' },
  });
}

function emitAction(tool: string, outcome: 'success' | 'failure' = 'success'): void {
  const action = core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: ACTION_EXECUTED_TOPIC,
    schema: ACTION_EXECUTED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: task,
    payload: { tool, tier: 2, dispatch: 'registry', targets: 1, targets_resolved: 1 },
  });
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: OUTCOME_RECORDED_TOPIC,
    schema: OUTCOME_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: task,
    causation: action.id,
    payload: { tool, result: outcome, result_scope: 'call' },
  });
}

/** Everything the anchor runbook can attest before an update may run. */
function attestPrerequisites(): void {
  emitManifest();
  emitRationale('approved');
  emitAction('wpe_backup_and_verify');
}

// ---------------------------------------------------------------------------

describe('parity — an unsequenced call is not touched', () => {
  test('no armed run: every tool passes, including the runbook’s own', () => {
    expect(checkCheckpointSequence('bulk_plugin_update', task)).toBeNull();
    expect(checkCheckpointSequence('wpe_backup_and_verify', task)).toBeNull();
  });

  test('no task id at all: passes (CLI, agents, every pre-WP-20 surface)', () => {
    arm();
    expect(checkCheckpointSequence('bulk_plugin_update', undefined)).toBeNull();
  });

  test('armed, but the tool belongs to no checkpoint: passes', () => {
    arm();
    // The fleet-browsing workhorses must keep working mid-procedure, or the
    // gate becomes a tool-set narrowing this packet deliberately does not do.
    expect(checkCheckpointSequence('nexus_list_sites', task)).toBeNull();
    expect(checkCheckpointSequence('wp_plugin_list', task)).toBeNull();
  });
});

describe('the refusal, and what it names', () => {
  test('an update with nothing attested is refused at the first unmet checkpoint', () => {
    arm();

    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;

    expect(refusal).not.toBeNull();
    expect(refusal.checkpoint).toBe('cp.consult-history');
    expect(refusal.runbookId).toBe('rb.bulk-plugin-update');
    expect(refusal.capability).toBe(CAPABILITY);
  });

  test('the message names the runbook, the checkpoint, and WHAT WOULD ATTEST IT', () => {
    arm();
    emitManifest();

    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;

    // Instructive-refusal doctrine: a refusal that does not say what would
    // clear it teaches the model to retry, not to comply.
    expect(refusal.checkpoint).toBe('cp.approval');
    expect(refusal.message).toContain('rb.bulk-plugin-update');
    expect(refusal.message).toContain('cp.approval');
    expect(refusal.message).toContain('task.rationale.recorded');
    expect(refusal.message).toMatch(/approved/);
    expect(refusal.message).toContain('bulk_plugin_update');
  });

  test('backup before approval is refused — the runbook’s own order, enforced', () => {
    arm();
    emitManifest();

    const refusal = checkCheckpointSequence('wpe_backup_and_verify', task)!;

    expect(refusal.checkpoint).toBe('cp.approval');
  });

  test('with every attestable predecessor attested, the update proceeds', () => {
    arm();
    attestPrerequisites();

    expect(checkCheckpointSequence('bulk_plugin_update', task)).toBeNull();
  });

  test('a FAILED backup does not clear the gate — ab.backup-failed is not waivable', () => {
    arm();
    emitManifest();
    emitRationale('approved');
    emitAction('wpe_backup_and_verify', 'failure');

    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;
    expect(refusal.checkpoint).toBe('cp.backup');
  });

  test('the narrative checkpoints are named as un-gateable rather than silently skipped', () => {
    arm();

    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;

    // Four of eight cannot be proven by anything. A gate that stayed quiet
    // about them would imply it was enforcing all eight.
    expect(refusal.message).toMatch(/cp\.dry-run/);
    expect(refusal.message).toMatch(/narrative|cannot verify|not verified/i);
  });
});

describe('M4 — proceeding past a denied approval, made impossible', () => {
  test('a denial refuses the update and says the approval was DENIED, not missing', () => {
    arm();
    emitManifest();
    emitRationale('denied');

    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;

    expect(refusal.checkpoint).toBe('cp.approval');
    expect(refusal.message).toMatch(/denied/i);
    // "Missing" invites asking again; "denied" says the answer exists.
    expect(refusal.message).not.toMatch(/has not happened yet/i);
  });

  test('approved, then denied, then attempted: still refused', () => {
    arm();
    emitManifest();
    emitRationale('approved');
    emitAction('wpe_backup_and_verify');
    emitRationale('denied');

    expect(checkCheckpointSequence('bulk_plugin_update', task)!.checkpoint).toBe('cp.approval');
  });
});

describe('integrity outranks sequencing', () => {
  test('a run armed against a different document is not sequenced — 20c\u2019s refusal governs', () => {
    const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
    armProcedureRun({
      sessionId: 's1',
      capability: CAPABILITY,
      runbookId: runbook.id,
      runbookHash: 'sha256:' + '9'.repeat(64), // the document changed under the run
    });
    registerProcedureTurn({ sessionId: 's1', taskId: task });

    // WP-20c already disarms the capability and says so on the turn carrier,
    // naming both hashes. Refusing tools here as well would punish the same
    // fault twice, in a message that names the wrong problem — and the
    // checkpoints attested against the old text do not describe the new one.
    expect(checkCheckpointSequence('bulk_plugin_update', task)).toBeNull();
  });
});

describe('the sequencer’s own failure — blast radius of one capability', () => {
  test('an unreadable ledger refuses the sequenced tool and nothing else', () => {
    arm();
    const broken = { ...core, ledger: { query: () => { throw new Error('ledger down'); } } };
    setIntelligenceCore(broken as never);

    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;
    expect(refusal.message).toMatch(/could not be read|unreadable/i);
    // Every unclaimed tool still works: the fault is scoped to the capability
    // that opted into sequencing, which is the whole of §4's fail-behaviour.
    expect(checkCheckpointSequence('nexus_list_sites', task)).toBeNull();
    expect(checkCheckpointSequence('wp_plugin_list', task)).toBeNull();
  });

  test('no intelligence core: the guard is not in the path at all', () => {
    arm();
    setIntelligenceCore(undefined as never);

    expect(checkCheckpointSequence('bulk_plugin_update', task)).toBeNull();
  });

  test('a guard fault never throws into the caller', () => {
    arm();
    const hostile = {
      get law() {
        throw new Error('registry exploded');
      },
    };
    setIntelligenceCore(hostile as never);

    expect(() => checkCheckpointSequence('bulk_plugin_update', task)).not.toThrow();
    expect(checkCheckpointSequence('bulk_plugin_update', task)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WP-31 · exclusive tool scope — the unclaimed-tool door, closed
//
// The 2026-08-18 incident in one line: `wp_plugin_update` is claimed by no
// checkpoint and forbidden only in the runbook's PROSE, so the guard above
// never fired and WP-26's approval card — which rides the guard's refusal —
// never rendered. Every protection was bypassed by tool substitution.
//
// The rule these tests pin: while a STRICT capability is armed with unmet
// gated checkpoints, a WRITE tool the CURRENT checkpoint does not declare is
// refused. Reads are untouched, and "write" is not a new list — it is
// `getToolSafety(...).tier >= GATED_TIER_FLOOR`, the same classification the
// audit chokepoint and WP-19's producer already use.
// ---------------------------------------------------------------------------

describe('WP-31 · exclusive tool scope', () => {
  test("the incident's exact sequence is refused: an armed run, nothing attested, wp_plugin_update", () => {
    arm();

    const refusal = checkCheckpointSequence('wp_plugin_update', task)!;

    expect(refusal).not.toBeNull();
    expect(refusal.reason).toBe('exclusive-scope');
    expect(refusal.runbookId).toBe('rb.bulk-plugin-update');
    expect(refusal.capability).toBe(CAPABILITY);
    // Names the CURRENT checkpoint, not the tool's own — the tool has none.
    expect(refusal.checkpoint).toBe('cp.consult-history');
    expect(refusal.message).toContain('wp_plugin_update');
    expect(refusal.message).toContain('rb.bulk-plugin-update');
    expect(refusal.message).toContain('cp.consult-history');
  });

  test('the current checkpoint declaring NO tool says so, rather than naming an empty list', () => {
    arm();

    const refusal = checkCheckpointSequence('wp_plugin_update', task)!;

    // cp.consult-history has `tools: []`. "declares no tool of its own" is a
    // different instruction from "declares wpe_backup_and_verify", and a
    // refusal that printed `declares: ` with nothing after it teaches nothing.
    expect(refusal.message).toMatch(/declares no tool/i);
  });

  test('the refusal names the tools the current checkpoint DOES declare', () => {
    arm();
    emitManifest();
    emitRationale('approved');

    // Current gated checkpoint is now cp.backup, which declares exactly one tool.
    const refusal = checkCheckpointSequence('wp_plugin_update', task)!;

    expect(refusal.checkpoint).toBe('cp.backup');
    expect(refusal.message).toContain('wpe_backup_and_verify');
  });

  test('a tool the current checkpoint DOES declare still runs', () => {
    arm();
    emitManifest();
    emitRationale('approved');

    expect(checkCheckpointSequence('wpe_backup_and_verify', task)).toBeNull();
  });

  test('READS are untouched at every point in the run', () => {
    arm();
    // Tier 1 by the same table the audit chokepoint reads. A gate that
    // narrowed the fleet-browsing tool set mid-procedure would make the
    // procedure unusable, and reads cannot cause the harm this closes.
    for (const read of ['nexus_list_sites', 'wp_plugin_list', 'wp_core_version', 'wp_option_get']) {
      expect(checkCheckpointSequence(read, task)).toBeNull();
    }
    emitManifest();
    emitRationale('approved');
    expect(checkCheckpointSequence('nexus_list_sites', task)).toBeNull();
  });

  test('the LEGITIMATE sequence still runs end to end', () => {
    arm();
    emitManifest();                       // cp.consult-history
    emitRationale('approved');            // cp.approval
    expect(checkCheckpointSequence('wpe_backup_and_verify', task)).toBeNull();
    emitAction('wpe_backup_and_verify');  // cp.backup
    expect(checkCheckpointSequence('bulk_plugin_update', task)).toBeNull();
  });

  test('with no gated checkpoint left unmet, exclusive scope stops enforcing', () => {
    arm();
    attestPrerequisites();
    emitAction('bulk_plugin_update');     // cp.roll-fleet — the last gated one

    // The ruling scopes exclusivity to "unmet gated checkpoints". With none
    // left, the procedure's enforceable part is done and the tool surface
    // returns to what it is outside a procedure.
    expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
  });

  test('a DECLARED tool is never handed to exclusive scope — sequence is all that is asked of it', () => {
    arm();
    attestPrerequisites();

    // The rule is UNCLAIMED-only, and this is the case that decided it. A first
    // draft keyed on "the current checkpoint's tools" refused a second backup
    // here — cp.backup is attested, so the current GATED checkpoint is
    // cp.roll-fleet, which declares bulk_plugin_update alone. Nothing about
    // safety wanted that: the runbook names the tool, its predecessors are
    // attested, and a re-verified backup is not a substitution.
    expect(checkCheckpointSequence('wpe_backup_and_verify', task)).toBeNull();
  });

  test('cp.verify-canary IS SATISFIABLE — the checkpoint has an instrument the gate permits', () => {
    // WP-31 gate ruling: "the flip must not merge with a checkpoint no tool can
    // satisfy." `verify_site_live` is Tier 2 by the tier table (a readOnlyHint
    // carve-out was refused, and re-tiering would cost the audit trail), so
    // before it was declared, the runbook's own "prove it before scaling it"
    // had no tool the gate would allow.
    arm();
    attestPrerequisites();

    expect(checkCheckpointSequence('verify_site_live', task)).toBeNull();
  });

  test('…and it is still SEQUENCED: the canary instrument does not run before the backup', () => {
    // Declaring it did not exempt it. Rule 1 still applies at its earliest
    // claim, so a live re-check cannot become a way to touch the fleet before
    // consent and a backup are on the record.
    arm();
    emitManifest();

    const refusal = checkCheckpointSequence('verify_site_live', task)!;
    expect(refusal.reason).toBe('sequence');
    expect(refusal.checkpoint).toBe('cp.approval');
  });

  test('a SEQUENCE refusal still wins over an exclusive one for a declared tool', () => {
    arm();

    // bulk_plugin_update IS declared (cp.canary, earliest claimer). Its refusal
    // must stay WP-20d's — same message, same reason — or the approval card
    // that rides `checkpoint === cp.approval` stops firing.
    emitManifest();
    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;
    expect(refusal.reason).toBe('sequence');
    expect(refusal.checkpoint).toBe('cp.approval');
  });
});

// ---------------------------------------------------------------------------
// WP-31 · the refusal payload contract (inherited requirement)
//
// Ruled at the designer §1 adjudication while this packet was in flight:
// "WP-31 inherits both requirements — its instructive refusal carries the
// machine-readable capability id and the deep-link target from birth."
// J-Refusal is the refusal → grant → resume walk, and a door that lands on a
// settings PAGE makes the user hunt for the row that stopped them. WP-32's
// barred-subset row consumes the same three fields.
// ---------------------------------------------------------------------------

describe('WP-31 · every refusal carries the Govern door', () => {
  test('the capability id is the key the Settings matrix matches on', () => {
    arm();

    // Not a display string and not a runbook id: `CapabilityGrantSetting.capability`
    // is the override key, so a surface goes from refusal to row with no lookup.
    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;
    expect(refusal.governDoor.capability).toBe(CAPABILITY);
    expect(refusal.capability).toBe(refusal.governDoor.capability);
  });

  test('the door names the DOCUMENT too — a grant naming another one is not this grant', () => {
    arm();

    const refusal = checkCheckpointSequence('bulk_plugin_update', task)!;
    expect(refusal.governDoor).toEqual({
      surface: 'settings',
      section: 'capabilities',
      capability: CAPABILITY,
      runbookId: 'rb.bulk-plugin-update',
    });
  });

  test('ALL FOUR refusal reasons carry it — sequence, exclusive-scope and ledger-fault', () => {
    // Reached by three different code paths that build three different
    // objects; the arming-gap fourth is pinned in armingGap.test.ts, where the
    // state it needs (no run, a pending request) can be constructed.
    arm();
    const sequence = checkCheckpointSequence('bulk_plugin_update', task)!;
    const exclusive = checkCheckpointSequence('wp_plugin_update', task)!;

    setIntelligenceCore({ ...core, ledger: { query: () => { throw new Error('down'); } } } as never);
    const fault = checkCheckpointSequence('bulk_plugin_update', task)!;

    expect([sequence.reason, exclusive.reason, fault.reason]).toEqual([
      'sequence',
      'exclusive-scope',
      'ledger-fault',
    ]);
    for (const refusal of [sequence, exclusive, fault]) {
      expect([refusal.reason, refusal.governDoor.capability]).toEqual([refusal.reason, CAPABILITY]);
      expect([refusal.reason, refusal.governDoor.runbookId]).toEqual([
        refusal.reason,
        'rb.bulk-plugin-update',
      ]);
    }
  });
});
