/**
 * WP-31 · what `tool_scope: exclusive` reaches, and what it deliberately does not.
 *
 * The incident ruling turns the mechanism ADR-17's third amendment shipped OFF
 * into the DEFAULT for strict runbooks. Two boundaries follow, and each of them
 * is a thing a reader could reasonably guess wrong:
 *
 *  - **Exclusive is strict-only.** A guided runbook's capability, even one with
 *    gated checkpoints and a live grant, changes nothing about which tools may
 *    run. Guided means "ordered advice you may adapt, saying why" (ADR-12), and
 *    a tool surface that narrowed under advice would make adaptation impossible.
 *  - **The authored field still wins.** A strict document may write
 *    `tool_scope: advisory` and get today's behaviour back. That is an opt-out a
 *    human reviews in the document, not a default nobody reads — the same place
 *    `attest:` and `unrequested:` live, for the same reason.
 *
 * The synthetic runbooks below are built by hand ON PURPOSE. The shipped set
 * has exactly one strict document with gated checkpoints, so the two boundaries
 * above have no shipped exemplar and a test using only shipped law could not
 * distinguish "exclusive is strict-only" from "exclusive is everything".
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { armProcedureRun, forgetProcedureRun, registerProcedureTurn } from '../procedureCursor';
import { clearArmingRequests, recordArmingRequest } from '../procedureArming';
import { checkCheckpointSequence as guardWithCaller } from '../sequenceGuard';

/**
 * Phase 2 (fixes-082526) made the guard PER CALLER; this suite's subject is
 * the sequence/reach rules themselves, so every call asks as 'chat' — the
 * builtin identity its fixtures grant to. The per-caller semantics have
 * their own pins in agentGranteeGate.test.ts.
 */
const checkCheckpointSequence = (toolName: string, taskId?: string) =>
  guardWithCaller(toolName, taskId, 'chat');

import { taskId as mintTaskId } from '../../../intelligence';
import type { Runbook, RunbookStrictness, ToolScope } from '../../../intelligence';

let core: IntelligenceCore;
let dir: string;
let task: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-scope-'));
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

// ---------------------------------------------------------------------------
// The shipped law — measured, not assumed
// ---------------------------------------------------------------------------

describe('the shipped law directory', () => {
  test('every strict runbook the registry serves is exclusive; no shipped document opts out', () => {
    const served = core.law!.runbooks.runbooks();
    const strict = served.filter((r) => r.strictness === 'strict');

    expect(strict.length).toBeGreaterThan(0);
    for (const rb of strict) {
      expect([rb.id, rb.toolScope]).toEqual([rb.id, 'exclusive']);
    }
  });

  test('guided runbooks stay advisory', () => {
    const guided = core.law!.runbooks.runbooks().filter((r) => r.strictness === 'guided');

    expect(guided.length).toBeGreaterThan(0);
    for (const rb of guided) {
      expect([rb.id, rb.toolScope]).toEqual([rb.id, 'advisory']);
    }
  });
});

// ---------------------------------------------------------------------------
// Synthetic runbooks — the boundaries the shipped set cannot exhibit
// ---------------------------------------------------------------------------

const HASH = `sha256:${'a'.repeat(64)}`;

function runbook(opts: { strictness: RunbookStrictness; toolScope: ToolScope }): Runbook {
  return {
    id: 'rb.synthetic',
    version: '1.0.0',
    capability: 'cap.synthetic',
    strictness: opts.strictness,
    path: 'runbooks/synthetic.md',
    hash: HASH,
    canonicalBytes: 100,
    checkpoints: [
      { id: 'cp.gate', attest: 'event', evidence: { topic: 'task.rationale.recorded', decision: 'approved' }, tools: [] },
      { id: 'cp.act', attest: 'event', evidence: { topic: 'task.action.executed', tool: 'bulk_plugin_update' }, tools: [{ name: 'bulk_plugin_update' }] },
    ],
    steps: [],
    tools: [],
    toolScope: opts.toolScope,
    body: '',
    canonicalText: '',
    frontmatter: {},
  };
}

/** Swap the served runbook without touching the real registry's own documents. */
function serve(rb: Runbook): void {
  setIntelligenceCore({
    ...core,
    law: { ...core.law!, runbooks: { byCapability: () => rb } },
  } as never);
  armProcedureRun({
    sessionId: 's1',
    capability: rb.capability,
    runbookId: rb.id,
    runbookHash: rb.hash,
  });
  registerProcedureTurn({ sessionId: 's1', taskId: task });
}

test('a GUIDED capability changes nothing — an undeclared write runs', () => {
  serve(runbook({ strictness: 'guided', toolScope: 'exclusive' }));

  // Both halves: the sequence guard never gated guided runbooks, and exclusive
  // scope does not start. `toolScope: 'exclusive'` is set here deliberately, so
  // the pass is attributable to STRICTNESS and not to the field being advisory.
  expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
  expect(checkCheckpointSequence('bulk_plugin_update', task)).toBeNull();
});

test('a STRICT runbook authored tool_scope: advisory keeps today’s behaviour for unclaimed tools', () => {
  serve(runbook({ strictness: 'strict', toolScope: 'advisory' }));

  // Unclaimed → untouched, exactly as WP-20d shipped it.
  expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
  // Claimed → still sequenced. The opt-out is about the door, not the gate.
  expect(checkCheckpointSequence('bulk_plugin_update', task)!.reason).toBe('sequence');
});

test('a STRICT exclusive runbook refuses the same unclaimed write', () => {
  serve(runbook({ strictness: 'strict', toolScope: 'exclusive' }));

  const refusal = checkCheckpointSequence('wp_plugin_update', task)!;
  expect(refusal.reason).toBe('exclusive-scope');
  expect(refusal.checkpoint).toBe('cp.gate');
});

test('a strict exclusive runbook with NO gated checkpoint enforces nothing', () => {
  const rb = runbook({ strictness: 'strict', toolScope: 'exclusive' });
  serve({ ...rb, checkpoints: rb.checkpoints.map((c) => ({ ...c, attest: 'narrative' as const })) });

  // Nothing can ever be attested, so nothing is ever "unmet" in the sense the
  // ruling scopes exclusivity to. A permanently-closed tool surface is the
  // broken-gate shape WP-20d's rule 1 exists to prevent, wearing a new hat.
  expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
});

// ---------------------------------------------------------------------------
// The same two boundaries, in the ARMING GAP
//
// The gap path reaches `isExclusive` by a DIFFERENT route: there is no run, so
// the guard's own `strictness !== 'strict'` early return never executes and
// `isExclusive` is the only thing standing between a guided document and a
// refused tool surface. The run-path tests above therefore cannot cover this —
// measured, not assumed: dropping the strictness conjunct leaves every one of
// them green.
//
// The capability stays `cap.bulk_plugin_update` (the one the shipped grant
// covers, which the gap path requires) while the DOCUMENT served for it is
// swapped. That isolates the strictness/scope decision from the grant lookup.
// ---------------------------------------------------------------------------

const GRANTED = 'cap.bulk_plugin_update';

/** Serve `rb` for the granted capability, and leave a request pending. */
function gapWith(rb: Runbook): void {
  setIntelligenceCore({
    ...core,
    law: { ...core.law!, runbooks: { byCapability: () => rb } },
  } as never);
  recordArmingRequest(GRANTED);
}

test('IN THE GAP: a GUIDED document refuses nothing, even at exclusive scope', () => {
  gapWith({ ...runbook({ strictness: 'guided', toolScope: 'exclusive' }), capability: GRANTED });

  expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
});

test('IN THE GAP: a STRICT advisory document refuses nothing either', () => {
  gapWith({ ...runbook({ strictness: 'strict', toolScope: 'advisory' }), capability: GRANTED });

  expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
});

test('IN THE GAP: a STRICT exclusive document refuses the write — the control arm', () => {
  gapWith({ ...runbook({ strictness: 'strict', toolScope: 'exclusive' }), capability: GRANTED });

  // Without this, the two passes above would be satisfied by a gap path that
  // refuses nothing at all.
  const refusal = checkCheckpointSequence('wp_plugin_update', task)!;
  expect(refusal.reason).toBe('arming-gap');
  expect(refusal.checkpoint).toBe('cp.gate');
});
