/**
 * WP-37 · the stream serves the scope — WP-35's two escalations, closed at the
 * emission.
 *
 * WP-32 shipped the carrier: `ProcedureScope`, `ArmingRequest.scope`,
 * `DeclaredProcedure.scope`, and every derivation over them. WP-35 built the
 * surface that reads it and found that **nothing fills it** — `procedureStream`
 * never passed a `scope` to `deriveDeclaredProcedure`, so the zero-eligible
 * state was unreachable in the product and the plan line was one segment short
 * of the ratified sheet. Both were escalated rather than worked around. This is
 * the producer they asked for.
 *
 * THREE PROPERTIES, and the second is the one with a shipped consumer:
 *
 * **1 · The scope on the emission IS the scope the arming carried.** Identity,
 * not equality (`toBe`, not `toEqual`): a seam that hands the artifact on
 * unchanged and a seam that rebuilds an equal one are indistinguishable under
 * `toEqual`, and rebuilding is precisely the re-derivation WP-32 exists to
 * stop. The plan is never consulted — a scope reconstructed from the checkpoint
 * list would be the second derivation whose disagreement with the first is the
 * whole defect.
 *
 * **2 · ABSENT IS NOT EMPTY, and the legacy default is a pin.** A declaration
 * with no scope opens its container exactly as it did before WP-32 (`M20`, the
 * mutation WP-35 credited for proving the inversion silences every armed run).
 * A declaration whose scope says zero cells run opens no container. Both
 * assertions below run through the SHIPPED consumer — `procedureModel`'s
 * `opensContainer` and `derivedPlanLine`, imported and not transcribed — so
 * this suite fails if the emission and the renderer ever stop agreeing.
 *
 * **3 · The plan's producing checkpoint is DERIVED, from the document.**
 * `cp.dry-run` for the anchor runbook, and it is not matched by that name:
 * `planCheckpointOf` reads the nearest narrative checkpoint before the consent
 * gate, which is what "the plan the approval consents to" means structurally.
 * A runbook with no consent gate, or none narrative before it, serves no field
 * at all — the honest shape, and the same one `unverifiablePrecedent` has held
 * since WP-26. Those two ARE one derivation, and the last test here is what
 * stops them becoming two.
 *
 * Every fixture is a real event through the real emitter into a real ledger,
 * and every scope is built by the real `deriveScope` from a real selection —
 * a hand-built `ProcedureScope` would let this suite pass against a split that
 * no longer works (`procedureCursor.test.ts`'s rule, applied to the carrier).
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  assembleForChatTurn,
  forgetChatAssemblySession,
  CONTEXT_ASSEMBLED_TOPIC,
  CONTEXT_ASSEMBLED_SCHEMA,
} from '../chatAssembly';
import { getCapabilityGrants } from '../capabilityGrants';
import {
  armProcedureRun,
  forgetProcedureRun,
  registerProcedureTurn,
  runForTask,
} from '../procedureCursor';
import {
  forgetProcedureStream,
  notifyProcedureState,
  procedureApprovalContext,
  setProcedureStreamSink,
  ProcedureStreamEvent,
} from '../procedureStream';
import {
  clearArmingRequests,
  procedureRequestForTurn,
  recordArmingRequest,
} from '../procedureArming';
import { deriveScope, ProcedureScope, ScopeSelection } from '../procedureScope';
import type { ResolvedGrant } from '../capabilityGrants';
import { taskId as mintTaskId } from '../../../intelligence';
import type { ProcedureOutcome, Runbook, RunbookCheckpoint } from '../../../intelligence';
import type { NexusServices } from '../../mcp/types';
// The SHIPPED consumer, imported rather than transcribed. Type-only imports
// cross this seam in the renderer; a TEST may import the values, because jest
// is not Electron and `procedureModel` is a pure module by construction.
import { derivedPlanLine, opensContainer } from '../../../renderer/components/DockedPanel/procedureModel';

const CAPABILITY = 'cap.bulk_plugin_update';

let core: IntelligenceCore;
let dir: string;
let emitted: Array<{ sessionId: string; event: ProcedureStreamEvent }>;
let t1: string;

/** The anchor's rail, as the registry loads it — four provable of eight. */
const CHECKPOINTS: RunbookCheckpoint[] = [
  { id: 'cp.consult-history', attest: 'manifest', evidence: { topic: 'task.context.assembled' }, tools: [] },
  { id: 'cp.dry-run', attest: 'narrative', tools: [] },
  {
    id: 'cp.approval',
    attest: 'event',
    evidence: { topic: 'task.rationale.recorded', decision: 'approved' },
    tools: [],
  },
  {
    id: 'cp.backup',
    attest: 'event',
    evidence: { topic: 'task.action.executed', tool: 'wpe_backup_and_verify', perTarget: true },
    tools: [{ name: 'wpe_backup_and_verify' }],
  },
  { id: 'cp.roll-fleet', attest: 'event', evidence: { topic: 'task.action.executed', tool: 'bulk_plugin_update' }, tools: [] },
  { id: 'cp.report', attest: 'narrative', tools: [] },
];

/** The document's own headings — `checkpointReason` reads the tail of each. */
const BODY = [
  '# Bulk plugin update',
  '',
  '## cp.dry-run — show what would change',
  '',
  'Build the update plan from live plugin inventory. Present the full diff and stop.',
  '',
  '## cp.approval — explicit, informed consent',
  '',
  'Proceed only on explicit approval of the presented plan.',
].join('\n');

function runbookFixture(overrides: Partial<Runbook> = {}): Runbook {
  return {
    id: 'rb.bulk-plugin-update',
    version: '1.2.0',
    capability: CAPABILITY,
    strictness: 'strict',
    path: 'runbooks/bulk-plugin-update.md',
    hash: 'sha256:abc',
    canonicalBytes: 4096,
    checkpoints: CHECKPOINTS,
    steps: [],
    tools: [],
    toolScope: 'advisory',
    body: BODY,
    canonicalText: `---\nid: rb.bulk-plugin-update\n---\n${BODY}`,
    frontmatter: { scope: { environments: ['local', 'wpe_staging'] } },
    ...overrides,
  };
}

function delivery(runbook: Runbook = runbookFixture()): ProcedureOutcome {
  return {
    status: 'delivered',
    capability: runbook.capability,
    runbookId: runbook.id,
    version: runbook.version,
    hash: runbook.hash,
    strictness: runbook.strictness,
    armedBy: 'model-request',
    assertFull: true,
    bodyDelivered: true,
    checkpoints: runbook.checkpoints.map((c) => ({ id: c.id, attest: c.attest, attested: false })),
    steps: [],
    tokens: 900,
  };
}

function grantFor(rb: Runbook): ResolvedGrant {
  const declared = (rb.frontmatter as { scope?: { environments?: string[] } }).scope?.environments;
  return {
    capability: rb.capability,
    runbookId: rb.id,
    runbookHash: rb.hash,
    strictness: rb.strictness,
    scope: declared ? { environments: [...declared] } : {},
    source: 'shipped',
  };
}

const FROM = {
  surface: 'comparator',
  comparatorId: 'cmp.fleet-plugins',
  filter: 'plugin=woocommerce outdated=true',
} as const;

const local = { host: 'local' } as const;

/**
 * THE OWNER'S ASK, AS A SELECTION: "Update my plugins on t1, t2", where both are
 * halted. The world removed each cell and SAID SO — the exclusion carries the
 * record that observed it, which is what makes "halted, and said so" honest
 * rather than composed beside the data.
 */
function haltedSelection(): ScopeSelection {
  const causedBy = (recordId: string) => ({
    recordId,
    topic: 'site.status.observed',
    observedAt: '2026-08-19T04:00:00.000Z',
  });
  return {
    from: FROM,
    cells: [
      { siteId: 's.t1', siteName: 't1', place: local, excluded: { reason: 'halted, and said so', causedBy: causedBy('ev.t1') } },
      { siteId: 's.t2', siteName: 't2', place: local, excluded: { reason: 'halted, and said so', causedBy: causedBy('ev.t2') } },
    ],
  };
}

/** One running cell and one halted one — a scope that DOES open a run. */
function partlyRunnableSelection(): ScopeSelection {
  return {
    from: FROM,
    cells: [
      { siteId: 's.t1', siteName: 't1', place: local },
      {
        siteId: 's.t2',
        siteName: 't2',
        place: local,
        excluded: {
          reason: 'halted, and said so',
          causedBy: { recordId: 'ev.t2', topic: 'site.status.observed', observedAt: '2026-08-19T04:00:00.000Z' },
        },
      },
    ],
  };
}

function scopeOf(selection: ScopeSelection, runbook = runbookFixture()): ProcedureScope {
  return deriveScope({ selection, runbook, grants: [grantFor(runbook)] });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp37-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  clearArmingRequests();
  forgetProcedureRun('s1');
  forgetProcedureStream('s1');
  emitted = [];
  setProcedureStreamSink((sessionId, event) => emitted.push({ sessionId, event }));
  t1 = mintTaskId();
});

afterEach(() => {
  setProcedureStreamSink(null);
  clearArmingRequests();
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function emitManifest(taskId: string): void {
  core.emitter.emit({
    observed_at: new Date().toISOString(),
    topic: CONTEXT_ASSEMBLED_TOPIC,
    schema: CONTEXT_ASSEMBLED_SCHEMA,
    entity: {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: taskId,
    payload: { task: taskId, retrieval: [{ store: 'ledger', query: 'entity=x topic=episodic.*', returned: 2 }] },
  });
}

/** One assembled turn, exactly as `assembleForChatTurn` calls the seam. */
function turn(opts: { scope?: ProcedureScope; runbook?: Runbook } = {}): void {
  const runbook = opts.runbook ?? runbookFixture();
  armProcedureRun({ sessionId: 's1', capability: runbook.capability, runbookId: runbook.id, runbookHash: runbook.hash });
  registerProcedureTurn({ sessionId: 's1', taskId: t1 });
  emitManifest(t1);
  notifyProcedureState({
    sessionId: 's1',
    outcome: delivery(runbook),
    runbook,
    run: runForTask(t1),
    ledger: core.ledger,
    ...(opts.scope ? { scope: opts.scope } : {}),
  });
}

function armedEvent() {
  const found = emitted.find((e) => e.event.type === 'procedure_armed');
  if (!found || found.event.type !== 'procedure_armed') throw new Error('no procedure_armed emitted');
  return found.event;
}

// ---------------------------------------------------------------------------
// 1 · the carrier reaches the emission, unchanged
// ---------------------------------------------------------------------------

describe('the scope on the emission is the scope the arming carried', () => {
  test('it rides the declaration, and it is the SAME object — never a second derivation', () => {
    const scope = scopeOf(partlyRunnableSelection());
    turn({ scope });

    // Identity. An equal-but-rebuilt scope passes `toEqual` and fails this,
    // which is the entire distinction WP-32's carrier exists to enforce.
    expect(armedEvent().procedure.scope).toBe(scope);
  });

  test('the plan is never consulted: a scope survives a rail that disagrees with it', () => {
    // Two cells selected, one runnable; the rail declares six checkpoints and
    // knows nothing about cells. Anything that recomputed the scope from the
    // plan would have no cells to find.
    const scope = scopeOf(partlyRunnableSelection());
    turn({ scope });

    const served = armedEvent().procedure.scope!;
    expect(served.runnable.map((c) => c.siteName)).toEqual(['t1']);
    expect(served.excluded.map((c) => c.siteName)).toEqual(['t2']);
    expect(served.from).toEqual(FROM);
  });

  test('a checkpoint_changed carries no declaration, so the document — and the scope — ride ONCE', () => {
    const scope = scopeOf(partlyRunnableSelection());
    turn({ scope });
    emitted = [];

    // A second turn of the same run with a state change: the diff event, and no
    // second copy of the declaration to disagree with the first.
    const t2 = mintTaskId();
    registerProcedureTurn({ sessionId: 's1', taskId: t2 });
    emitManifest(t2);
    const runbook = runbookFixture();
    notifyProcedureState({
      sessionId: 's1',
      outcome: delivery(runbook),
      runbook,
      run: runForTask(t2),
      ledger: core.ledger,
      scope,
    });
    expect(emitted.every((e) => e.event.type !== 'procedure_armed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2 · absent is not empty — through the shipped consumer
// ---------------------------------------------------------------------------

describe('absent scope, and the legacy default it must not break', () => {
  test('a turn whose arming carried nothing emits a declaration with NO scope KEY', () => {
    turn();
    const procedure = armedEvent().procedure;
    // `toEqual` cannot tell an absent key from a present-undefined one (WP-26's
    // finding), so presence itself is the assertion.
    expect('scope' in procedure).toBe(false);
  });

  test('and it opens its container exactly as it did before WP-32 — M20, held', () => {
    turn();
    expect(opensContainer(armedEvent().procedure)).toBe(true);
    expect(derivedPlanLine(armedEvent().procedure)).toBeNull();
  });
});

describe('the zero-eligible state is servable', () => {
  test('a plan of zero cells still EMITS — a refusal is a turn with a plan, not a silence', () => {
    turn({ scope: scopeOf(haltedSelection()) });
    expect(emitted.map((e) => e.event.type)).toContain('procedure_armed');
  });

  test('the scope says so: nothing runnable, both cells excluded by the world, opensRun false', () => {
    turn({ scope: scopeOf(haltedSelection()) });
    const served = armedEvent().procedure.scope!;
    expect(served.runnable).toEqual([]);
    expect(served.opensRun).toBe(false);
    expect(served.excluded.map((c) => `${c.siteName}: ${c.reason}`)).toEqual([
      't1: halted, and said so',
      't2: halted, and said so',
    ]);
  });

  test('and the SHIPPED consumer flips: no container, and a plan line reading zero', () => {
    turn({ scope: scopeOf(haltedSelection()) });
    const procedure = armedEvent().procedure;
    expect(opensContainer(procedure)).toBe(false);
    expect(derivedPlanLine(procedure)).toContain('0 cells eligible');
  });

  test('a scope with one runnable cell opens the container — the flip is the CELLS, not the carrier', () => {
    turn({ scope: scopeOf(partlyRunnableSelection()) });
    expect(opensContainer(armedEvent().procedure)).toBe(true);
    expect(derivedPlanLine(armedEvent().procedure)).toContain('1 cell eligible');
  });
});

// ---------------------------------------------------------------------------
// 3 · the plan's producing checkpoint
// ---------------------------------------------------------------------------

describe("the checkpoint that produced the plan, from the document's own structure", () => {
  test('the anchor runbook serves cp.dry-run, with the reason its own heading wrote', () => {
    turn({ scope: scopeOf(haltedSelection()) });
    expect(armedEvent().procedure.planCheckpoint).toEqual({
      checkpointId: 'cp.dry-run',
      reason: 'show what would change',
    });
  });

  test('it is NOT matched by the name `cp.dry-run` — a document that spells it otherwise still serves', () => {
    const renamed = runbookFixture({
      checkpoints: CHECKPOINTS.map((c) => (c.id === 'cp.dry-run' ? { ...c, id: 'cp.preview' } : c)),
      body: ['# x', '', '## cp.preview — show what would change', '', 'Present the diff.', '', '## cp.approval — consent'].join('\n'),
    });
    turn({ scope: scopeOf(haltedSelection(), renamed), runbook: renamed });
    expect(armedEvent().procedure.planCheckpoint?.checkpointId).toBe('cp.preview');
  });

  test('a document whose heading wrote no reason serves the id and a null — it says less, never more', () => {
    const bare = runbookFixture({ body: '# x\n\n## cp.approval — consent\n' });
    turn({ scope: scopeOf(haltedSelection(), bare), runbook: bare });
    expect(armedEvent().procedure.planCheckpoint).toEqual({ checkpointId: 'cp.dry-run', reason: null });
  });

  test('NEAREST, not first: two narrative steps before the gate, and the nearer one is served', () => {
    const twoNarratives = runbookFixture({
      checkpoints: [
        { id: 'cp.brief', attest: 'narrative', tools: [] },
        ...CHECKPOINTS,
      ],
      body: [
        '# x',
        '',
        '## cp.brief — say what this will do',
        '',
        '## cp.dry-run — show what would change',
        '',
        '## cp.approval — consent',
      ].join('\n'),
    });
    turn({ scope: scopeOf(haltedSelection(), twoNarratives), runbook: twoNarratives });
    // cp.brief is also narrative and also before the gate. The step the gate
    // directly rests on is the nearer one; a scan from the head serves the wrong
    // one and reads exactly as plausible.
    expect(armedEvent().procedure.planCheckpoint?.checkpointId).toBe('cp.dry-run');
  });

  test('the GATE is found by its contract too — a runbook that names it cp.sign-off still serves', () => {
    const renamedGate = runbookFixture({
      checkpoints: CHECKPOINTS.map((c) => (c.id === 'cp.approval' ? { ...c, id: 'cp.sign-off' } : c)),
      body: ['# x', '', '## cp.dry-run — show what would change', '', '## cp.sign-off — consent'].join('\n'),
    });
    turn({ scope: scopeOf(haltedSelection(), renamedGate), runbook: renamedGate });
    expect(armedEvent().procedure.planCheckpoint?.checkpointId).toBe('cp.dry-run');
  });

  test('a runbook with NO consent gate serves no field at all — there is no plan for a gate to rest on', () => {
    const ungated = runbookFixture({
      checkpoints: CHECKPOINTS.filter((c) => c.id !== 'cp.approval'),
    });
    turn({ scope: scopeOf(haltedSelection(), ungated), runbook: ungated });
    expect('planCheckpoint' in armedEvent().procedure).toBe(false);
  });

  test('a gate with nothing narrative before it serves no field either', () => {
    const straightToConsent = runbookFixture({
      checkpoints: CHECKPOINTS.filter((c) => c.id !== 'cp.dry-run'),
    });
    turn({ scope: scopeOf(haltedSelection(), straightToConsent), runbook: straightToConsent });
    expect('planCheckpoint' in armedEvent().procedure).toBe(false);
  });

  test('ONE derivation, two framings: the approval card\'s precedent IS the declaration\'s plan checkpoint', () => {
    turn({ scope: scopeOf(partlyRunnableSelection()) });
    const context = procedureApprovalContext('s1');
    expect(context).not.toBeNull();
    expect(context!.unverifiablePrecedent).toEqual(armedEvent().procedure.planCheckpoint);
  });
});

// ---------------------------------------------------------------------------
// 4 · the arming's scope reaches the turn that delivers it
// ---------------------------------------------------------------------------

describe('the carrier, from the arming request to the turn', () => {
  test("the honoured arming's scope comes back out of procedureRequestForTurn", () => {
    const scope = scopeOf(haltedSelection());
    const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
    recordArmingRequest(CAPABILITY, new Date(), scope);

    const turnProcedure = procedureRequestForTurn({
      runbooks: core.law!.runbooks,
      userMessage: 'Update my plugins on t1, t2',
    })!;
    expect(turnProcedure.request.armed).toEqual({ capability: CAPABILITY, armedBy: 'model-request' });
    expect(turnProcedure.scope).toBe(scope);
    expect(runbook.capability).toBe(CAPABILITY); // the grant this rode under is real
  });

  test('an arming recorded WITHOUT a selection carries no scope — absent stays absent', () => {
    recordArmingRequest(CAPABILITY);
    const turnProcedure = procedureRequestForTurn({
      runbooks: core.law!.runbooks,
      userMessage: 'update the plugins',
    })!;
    expect(turnProcedure.request.armed).toEqual({ capability: CAPABILITY, armedBy: 'model-request' });
    expect('scope' in turnProcedure).toBe(false);
  });

  test('a turn that arms nothing carries no scope: nothing selected anything', () => {
    const turnProcedure = procedureRequestForTurn({
      runbooks: core.law!.runbooks,
      userMessage: 'update the plugins on every staging site',
    })!;
    expect(turnProcedure.scope).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5 · THE WIRED PATH — the failure WP-26 named: correct in isolation, never called
// ---------------------------------------------------------------------------

/**
 * The owner's ask, end to end, through the REAL assembler.
 *
 * Everything above drives `notifyProcedureState` the way `assembleForChatTurn`
 * does. This drives `assembleForChatTurn` itself, with no `procedure` supplied,
 * so the arming queue → `procedureRequestForTurn` → the fold → the emission is
 * the whole path under test. A scope that reaches the stream in a unit test and
 * is dropped by the assembler is the exact shape WP-20e left behind on purpose
 * and WP-35 found still standing.
 */
describe('"Update my plugins on t1, t2" — the halted-sites ask, through the real assembler', () => {
  const SITE = { id: 'site_t1', name: 't1', domain: 't1.local' };
  const services = () =>
    ({
      siteData: { getSite: (id: string) => (id === SITE.id ? SITE : null), getSites: () => ({ [SITE.id]: SITE }) },
    }) as never as NexusServices;

  const ask = () =>
    assembleForChatTurn({
      services: services(),
      sessionId: 's1',
      siteId: SITE.id,
      userMessage: 'Update my plugins on t1, t2',
      buildingSystemPrompt: false,
    });

  /** The real anchor runbook and the real live grant — not the fixture pair. */
  function liveScope(selection: ScopeSelection) {
    const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
    return deriveScope({ selection, runbook, grants: getCapabilityGrants() });
  }

  beforeEach(() => {
    forgetChatAssemblySession('s1');
  });

  test('the arming carries the scope, the assembler hands it on, and the panel opens NO container', async () => {
    const scope = liveScope(haltedSelection());
    recordArmingRequest(CAPABILITY, new Date(), scope);

    await ask();

    const procedure = armedEvent().procedure;
    expect(procedure.runbookId).toBe('rb.bulk-plugin-update');
    expect(procedure.scope).toBe(scope);
    expect(procedure.scope!.opensRun).toBe(false);

    // The two facts WP-35 built and could not reach. This is the acceptance.
    expect(opensContainer(procedure)).toBe(false);
    expect(derivedPlanLine(procedure)).toContain('0 cells eligible');
    expect(procedure.planCheckpoint?.checkpointId).toBe('cp.dry-run');
  });

  test('and the same ask with nothing selected is byte-identical to the turn before this packet', async () => {
    recordArmingRequest(CAPABILITY);

    await ask();

    const procedure = armedEvent().procedure;
    expect('scope' in procedure).toBe(false);
    expect(opensContainer(procedure)).toBe(true);
    expect(derivedPlanLine(procedure)).toBeNull();
  });
});
