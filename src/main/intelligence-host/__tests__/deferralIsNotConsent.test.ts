/**
 * WP-56 · A DEFERRAL IS NOT A CONSENT DECISION — the four readers, pinned still.
 *
 * The deferral rides `task.rationale.recorded`, the family cycle two named, as a
 * payload widening. Four things fold that topic, and **every one of them keys
 * off `decision`**:
 *
 *   1. `foldProcedureCursor`   — LEGACY lane (`procedureCursor.ts`)
 *   2. `foldProcedureCursor`   — BOUND lane (same function, different branch)
 *   3. `deriveCanaryPolicy`    — `procedureView.ts`
 *   4. `deriveApprovals`       — `sessionRegistry.ts`, via the cursor
 *
 * MEASURED BEFORE THE PAYLOAD WAS DESIGNED, and both cursor branches are
 * hostile to a deferral that carries a decision:
 *
 *   With `decision` and a `tool` and no `checkpoint`, the record enters the
 *   LEGACY lane, where `legacyLatest.set(payload.tool, decision)` OVERWRITES a
 *   standing legacy approval for that tool — so deferring a situation would
 *   silently REVOKE consent already given.
 *
 *   With `decision` and a `checkpoint`, it enters the BOUND lane, where any
 *   decision that is not the wanted one is pushed to `denied` — and
 *   `deriveCheckpointStates` rule 2 is that "a denial is an abort", so deferring
 *   would ABORT the run.
 *
 * One key, two ways to turn "not now" into "no", on the record a compliance
 * review trusts most. So the payload carries no `decision`, and this file drives
 * a REAL deferral through the REAL readers to pin that none of them move.
 *
 * WHY BOTH A SHAPE PIN AND THESE BEHAVIOUR PINS. `deferral.test.ts` asserts the
 * payload's EXACT key list, which fails the moment anyone adds `decision`. That
 * is the tripwire. These are the consequence: they say what the tripwire is
 * protecting, so a future author who changes the shape deliberately sees the
 * cost rather than an unexplained key list.
 *
 * ONE READER IS NOT DRIVEN HERE, and it is disclosed rather than implied:
 * `abortRecord` (`procedureStream.ts:400`) is private, reachable only through
 * `notifyProcedureState`'s sink. It reads `decision === 'denied' | 'approved'`
 * and nothing else, so it is guarded by the identical absence the shape pin
 * enforces — but it is guarded by argument here, not by execution.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  RATIONALE_RECORDED_TOPIC,
  RATIONALE_RECORDED_SCHEMA,
  recordDeferral,
} from '../actionProducer';
import { foldProcedureCursor, type ProcedureRun } from '../procedureCursor';
import { deriveCanaryPolicy } from '../procedureView';
import { createSessionRegistry, type RunbookLookup, type SessionRegistryDeps } from '../sessionRegistry';
import type { IntelligenceHealthReport } from '../health';
import { taskId as mintTaskId } from '../../../intelligence';
import type { Ledger, Runbook, RunbookCheckpoint } from '../../../intelligence';

let core: IntelligenceCore;
let dir: string;

const NOW = new Date('2026-08-21T08:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const MANIFEST_TOPIC = 'task.context.assembled';
const MANIFEST_SCHEMA = 'context.assembled/1';
const HASH = 'h-consent-1';
const CAPABILITY = 'cap.bulk_plugin_update';
const TOOL = 'bulk_plugin_update';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-defconsent-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const CHECKPOINTS: RunbookCheckpoint[] = [
  {
    id: 'cp.approval',
    attest: 'event',
    tools: [],
    evidence: { topic: RATIONALE_RECORDED_TOPIC, decision: 'approved' },
  } as unknown as RunbookCheckpoint,
];

const RB = {
  id: 'rb.bulk-plugin-update',
  capability: CAPABILITY,
  version: '1.0.0',
  hash: HASH,
  strictness: 'strict',
  path: 'runbooks/rb.bulk-plugin-update.md',
  canonicalBytes: 1024,
  steps: [],
  tools: [],
  toolScope: 'advisory',
  body: '',
  canonicalText: '',
  frontmatter: {},
  checkpoints: CHECKPOINTS,
} as unknown as Runbook;

const lookup: RunbookLookup = { byCapability: (c) => (c === CAPABILITY ? RB : undefined) };

function emitManifest(task: string): void {
  core.emitter.emit({
    observed_at: hoursAgo(5),
    topic: MANIFEST_TOPIC,
    schema: MANIFEST_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: task,
    payload: {
      task,
      procedure: { capability: CAPABILITY, runbook: RB.id, hash: HASH, status: 'delivered' },
      retrieval: [],
    },
  });
}

/**
 * An approval, in whichever lane. `checkpoint: undefined` OMITS the key, which
 * is the LEGACY shape — the pre-WP-36 record whose absence of the key is its
 * own discriminator.
 */
function emitApproval(task: string, checkpoint: string | null | undefined, canaryPolicy?: string): string {
  return core.emitter.emit({
    observed_at: hoursAgo(4),
    topic: RATIONALE_RECORDED_TOPIC,
    schema: RATIONALE_RECORDED_SCHEMA,
    entity: {},
    actor: { id: 'act_local_operator', kind: 'human' },
    source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
    correlation: task,
    payload: {
      tool: TOOL,
      decision: 'approved',
      prompt: 'card text',
      source: 'approval-card',
      ...(checkpoint === undefined ? {} : { checkpoint }),
      ...(canaryPolicy ? { canary_policy: canaryPolicy } : {}),
    },
  }).id;
}

function runOf(task: string): ProcedureRun {
  return {
    sessionId: `sess_${task}`,
    capability: CAPABILITY,
    runbookId: RB.id,
    runbookHash: HASH,
    taskIds: [task],
  };
}

function cursor(task: string) {
  return foldProcedureCursor(runOf(task), CHECKPOINTS, core.ledger as unknown as Ledger);
}

function eventsOf(task: string) {
  return core.ledger.query({ correlation: task, limit: 100 });
}

function deps(): SessionRegistryDeps {
  return {
    core,
    now: NOW,
    runbooks: lookup,
    health: { lines: [], worst: 'OK', errors: [], at: NOW.toISOString() } as unknown as IntelligenceHealthReport,
  };
}

/** Defer the run's own situation, through the real producer. */
function deferTheRun(task: string): string {
  const id = recordDeferral({
    situationId: `sess_${task}`,
    taskId: task,
    reason: 'not this week',
  });
  // Shape #15: the producer is non-fatal, so prove the record exists before
  // asserting that a reader ignored it. "A reader ignored an event that was
  // never written" is the vacuous form of every assertion in this file.
  if (typeof id !== 'string') throw new Error('the deferral was not recorded');
  return id;
}

// ===========================================================================

describe('the cursor — LEGACY lane: a deferral must not revoke a standing approval', () => {
  it('leaves a legacy-attested checkpoint attested', () => {
    const task = mintTaskId();
    emitManifest(task);
    const approvalId = emitApproval(task, undefined); // no `checkpoint` key ⇒ legacy

    const before = cursor(task);
    expect(before.attested).toEqual(['cp.approval']);
    expect(before.denied).toEqual([]);
    expect(before.evidence?.['cp.approval']?.eventId).toBe(approvalId);

    deferTheRun(task);
    // The deferral IS in the run's event set — this is not a test of a record
    // the reader never saw.
    expect(eventsOf(task).some((e) => (e.payload as { act?: string })?.act === 'defer')).toBe(true);

    const after = cursor(task);
    expect(after.attested).toEqual(['cp.approval']);
    expect(after.denied).toEqual([]);
    expect(after.fault).toBeFalsy();
    // The EVIDENCE still points at the approval, not at the deferral. A lane
    // that accepted the deferral would keep the checkpoint attested but move
    // the receipt, which reads as consent given at the wrong moment.
    expect(after.evidence?.['cp.approval']?.eventId).toBe(approvalId);
  });
});

describe('the cursor — BOUND lane: a deferral must not deny a checkpoint', () => {
  it('leaves a bound-attested checkpoint attested and undenied', () => {
    const task = mintTaskId();
    emitManifest(task);
    const approvalId = emitApproval(task, 'cp.approval');

    expect(cursor(task).attested).toEqual(['cp.approval']);

    deferTheRun(task);

    const after = cursor(task);
    expect(after.attested).toEqual(['cp.approval']);
    expect(after.denied).toEqual([]);
    expect(after.evidence?.['cp.approval']?.eventId).toBe(approvalId);
  });

  it('leaves an UNDECIDED checkpoint pending — a deferral is not a denial either', () => {
    const task = mintTaskId();
    emitManifest(task);

    expect(cursor(task).attested).toEqual([]);
    expect(cursor(task).denied).toEqual([]);

    deferTheRun(task);

    const after = cursor(task);
    // Pending, not denied. This is the branch that would ABORT the run if the
    // payload carried a decision the checkpoint did not want.
    expect(after.attested).toEqual([]);
    expect(after.denied).toEqual([]);
  });
});

describe('deriveCanaryPolicy — a deferral declares no policy and clears none', () => {
  it('keeps a declared policy declared', () => {
    const task = mintTaskId();
    emitManifest(task);
    emitApproval(task, 'cp.approval', 'pause-after-canary');

    expect(deriveCanaryPolicy(eventsOf(task))).toMatchObject({ declared: true, source: 'approval' });

    deferTheRun(task);

    expect(deriveCanaryPolicy(eventsOf(task))).toMatchObject({ declared: true, source: 'approval' });
  });

  it('does not make an undeclared policy declared', () => {
    const task = mintTaskId();
    emitManifest(task);
    expect(deriveCanaryPolicy(eventsOf(task)).declared).toBe(false);

    deferTheRun(task);

    // Still a default, still LABELLED a default. A deferral that flipped this
    // would put a canary decision in the user's mouth.
    expect(deriveCanaryPolicy(eventsOf(task))).toMatchObject({ declared: false, source: 'default' });
  });
});

describe('deriveApprovals — the standing-approval sentence survives a deferral', () => {
  it('keeps `approved` and its deciding event and moment', () => {
    const task = mintTaskId();
    emitManifest(task);
    const approvalId = emitApproval(task, 'cp.approval');

    const registry = createSessionRegistry(deps());
    const before = registry.sessions()[0]!;
    expect(before.approvals).toEqual([
      { checkpointId: 'cp.approval', state: 'approved', eventId: approvalId, decidedAt: hoursAgo(4) },
    ]);

    deferTheRun(task);

    const after = createSessionRegistry(deps()).sessions()[0]!;
    // Byte-identical. XD-26's "You approved this yesterday at 12:11. That
    // approval still stands" must still be writable from this payload after the
    // user quiets the row.
    expect(after.approvals).toEqual(before.approvals);
    expect(after.status).toBe(before.status);
  });

  it('does not invent an approval where there was none', () => {
    const task = mintTaskId();
    emitManifest(task);
    deferTheRun(task);

    const row = createSessionRegistry(deps()).sessions()[0]!;
    expect(row.approvals).toEqual([{ checkpointId: 'cp.approval', state: 'pending' }]);
  });
});
