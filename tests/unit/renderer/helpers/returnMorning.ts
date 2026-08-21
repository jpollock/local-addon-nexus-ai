/**
 * WP-46 · THE DESIGNER'S "ONE MORNING, BOTH WAYS" (§2), built for the RENDER.
 *
 * The consequence order's regression pin lives in
 * `src/main/intelligence-host/__tests__/sessionRegistry.test.ts` and folds the
 * same eight live things into two waiting situations, one reserved row and one
 * changed row. M6's surfaces must render THAT fold, so this helper builds THAT
 * morning — real events, through the real emitter, into a real ledger, shaped
 * exactly as the producers shape them, and folded by the real
 * `createSessionRegistry`.
 *
 * WHY THE EMITTERS ARE HERE RATHER THAN IMPORTED. The registry suite's helpers
 * are local to a file inside `src/main/intelligence-host/`, which WP-46 does not
 * hold the lock on and must not edit — not even to export a fixture. So they are
 * rebuilt here, and the duplication is made SAFE rather than merely disclosed:
 * `assertGoldenShape` below re-asserts the registry suite's own golden-fixture
 * expectations (two waiting, one reserved with three dark producers, one
 * changed; Charlie's three parts; Bravo's gate at `cp.approval`, 3 of 8, in
 * `rb.remediate`) against whatever this file builds. If this copy of the morning
 * ever drifts from the one the registry pins, these assertions go red before any
 * render assertion runs — which is the property a disclosed duplicate does not
 * have on its own.
 *
 * SHAPE #15 (PARALLEL_PROTOCOL): every consumer asserts the fixture's events
 * EXIST before asserting anything the fold made of them. `ledgerCounts` is what
 * they assert on, and `assertGoldenShape` calls it first.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { initIntelligenceCore, IntelligenceCore } from '../../../../src/main/intelligence-host/bootstrap';
import { manifestScopeFor } from '../../../../src/main/intelligence-host/chatAssembly';
import { setIntelligenceCore } from '../../../../src/main/intelligence-host/coreRegistry';
import {
  ACTION_EXECUTED_TOPIC,
  ACTION_EXECUTED_SCHEMA,
  OUTCOME_RECORDED_TOPIC,
  OUTCOME_RECORDED_SCHEMA,
  RATIONALE_RECORDED_TOPIC,
  RATIONALE_RECORDED_SCHEMA,
} from '../../../../src/main/intelligence-host/actionProducer';
import { INCIDENT_TOPIC, INCIDENT_SCHEMA } from '../../../../src/main/intelligence-host/incidentProducer';
import { provisionalEnvironmentId } from '../../../../src/main/intelligence-host/provisionalEntity';
import {
  createSessionRegistry,
  type RunbookLookup,
  type SessionRegistryDeps,
  type TriageView,
} from '../../../../src/main/intelligence-host/sessionRegistry';
import type { IntelligenceHealthReport } from '../../../../src/main/intelligence-host/health';
import type { ScopePlace } from '../../../../src/main/intelligence-host/procedureScope';
import { taskId as mintTaskId } from '../../../../src/intelligence';
import type { Runbook, RunbookCheckpoint } from '../../../../src/intelligence';

export const MANIFEST_TOPIC = 'task.context.assembled';
const MANIFEST_SCHEMA = 'context.assembled/1';

/** A fixed clock, so every age in the morning is arithmetic, not a race. */
export const NOW = new Date('2026-08-19T08:00:00.000Z');
export const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// ---------------------------------------------------------------------------
// Runbooks — hand-built, shaped as the loader builds them
// ---------------------------------------------------------------------------

function runbook(
  overrides: Partial<Runbook> & Pick<Runbook, 'id' | 'capability' | 'hash' | 'checkpoints'>,
): Runbook {
  return {
    version: '1.0.0',
    strictness: 'strict',
    path: `runbooks/${overrides.id}.md`,
    canonicalBytes: 1024,
    steps: [],
    tools: [],
    toolScope: 'advisory',
    body: '',
    canonicalText: '',
    frontmatter: {},
    ...overrides,
  };
}

const rationaleGate = (id: string): RunbookCheckpoint => ({
  id,
  attest: 'event',
  evidence: { topic: RATIONALE_RECORDED_TOPIC, decision: 'approved' },
  tools: [],
});
const actionGate = (id: string, tool: string): RunbookCheckpoint => ({
  id,
  attest: 'event',
  evidence: { topic: ACTION_EXECUTED_TOPIC, tool },
  tools: [{ name: tool }],
});
const manifestGate = (id: string): RunbookCheckpoint => ({
  id,
  attest: 'manifest',
  evidence: { topic: MANIFEST_TOPIC },
  tools: [],
});
const narrative = (id: string): RunbookCheckpoint => ({ id, attest: 'narrative', tools: [] });

export const RB_BULK = runbook({
  id: 'rb.bulk-plugin-update',
  capability: 'cap.bulk_plugin_update',
  hash: 'sha256:bulk-1',
  checkpoints: [
    manifestGate('cp.consult-history'),
    narrative('cp.dry-run'),
    rationaleGate('cp.approval'),
    actionGate('cp.backup', 'wpe_backup_and_verify'),
    narrative('cp.canary'),
    actionGate('cp.roll-fleet', 'bulk_plugin_update'),
    actionGate('cp.verify', 'verify_site_live'),
    narrative('cp.report'),
  ],
});

/** The designer's morning names "approval gate 3 of 8 in remediate" — so it is 3 of 8. */
export const RB_REMEDIATE = runbook({
  id: 'rb.remediate',
  capability: 'cap.incident_remediation',
  hash: 'sha256:remediate-1',
  checkpoints: [
    manifestGate('cp.consult-history'),
    actionGate('cp.canary', 'contain_site'),
    rationaleGate('cp.approval'),
    actionGate('cp.roll-fleet', 'remediate_site'),
    narrative('cp.verify'),
    narrative('cp.restore-check'),
    actionGate('cp.close-incident', 'close_incident'),
    narrative('cp.report'),
  ],
});

export const RB_PURGE = runbook({
  id: 'rb.cache-purge',
  capability: 'cap.cache_purge',
  hash: 'sha256:purge-1',
  checkpoints: [
    manifestGate('cp.consult-history'),
    rationaleGate('cp.approval'),
    actionGate('cp.purge', 'wpe_purge_cache'),
  ],
});

function lookup(...books: Runbook[]): RunbookLookup {
  const byCapability = new Map(books.map((b) => [b.capability, b]));
  return { byCapability: (capability: string) => byCapability.get(capability) };
}

export const CHARLIE_1 = provisionalEnvironmentId('charlie-1');
export const CHARLIE_2 = provisionalEnvironmentId('charlie-2');
export const BRAVO = provisionalEnvironmentId('bravo');

const PLACES: Record<string, ScopePlace> = {
  [CHARLIE_1]: { host: 'wpe', kind: 'production' },
  [CHARLIE_2]: { host: 'wpe', kind: 'production' },
  [BRAVO]: { host: 'wpe', kind: 'production' },
};

/** Three producers gone dark: plugin-inventory 9h, health 6h, content-age 6h. */
const MORNING_HEALTH = (): IntelligenceHealthReport => ({
  checkedAt: NOW.toISOString(),
  coreUp: true,
  worst: 'DARK',
  lines: [
    { key: 'producer:plugin-inventory', label: 'plugin inventory', value: '9h ago', threshold: '6h', verdict: 'DARK' },
    { key: 'producer:health', label: 'health', value: '6h ago', threshold: '4h', verdict: 'DARK' },
    { key: 'producer:content-age', label: 'content age', value: '6h ago', threshold: '4h', verdict: 'DARK' },
  ],
  errors: [],
});

// ---------------------------------------------------------------------------
// The morning
// ---------------------------------------------------------------------------

export interface Morning {
  core: IntelligenceCore;
  dir: string;
  charlieTask: string;
  bravoTask: string;
  purgeTask: string;
  incidentId: string;
  /** The fold, ranked — exactly what `RETURN_TRIAGE` hands the surface. */
  triage(): TriageView;
  registry(): ReturnType<typeof createSessionRegistry>;
  ledgerCounts(): Record<string, number>;
  close(): void;
}

interface ManifestProcedure {
  capability: string;
  runbook: string | null;
  hash: string | null;
  status: 'delivered' | 'refused';
}

export function buildMorning(): Morning {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp46-morning-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);

  /**
   * `targets` is the size of the arming's `scope.runnable`, spread
   * CONDITIONALLY exactly as `chatAssembly` writes it — an arming that selected
   * nothing carries no `scope` key at all. WP-48 binds the `{total}` slot to it,
   * so a morning without one renders every session row from the DERIVED
   * sentence and no ratified class is exercised at all. That is what this helper
   * did before the scopes were added, and a mutation battery caught it: the
   * headline and `parts[0].summary` were identical on every row, so swapping one
   * for the other in the render changed nothing visible.
   */
  const emitManifest = (args: { taskId: string; observedAt: string; procedure: ManifestProcedure | null; consulted?: boolean; targets?: number }): string =>
    core.emitter.emit({
      observed_at: args.observedAt,
      topic: MANIFEST_TOPIC,
      schema: MANIFEST_SCHEMA,
      entity: {},
      actor: { id: 'act_chat_assembler', kind: 'system' },
      source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
      correlation: args.taskId,
      payload: {
        task: args.taskId,
        procedure: args.procedure,
        retrieval: args.consulted ? [{ store: 'ledger', query: 'entity=x topic=episodic.*', returned: 2 }] : [],
        // WP-50 · built by the PRODUCER'S OWN function, so this morning cannot
        // drift from what a real turn writes.
        ...(args.targets === undefined
          ? {}
          : {
              scope: manifestScopeFor({
                capability: args.procedure?.capability ?? 'cap.x',
                runbookId: args.procedure?.runbook ?? 'rb.x',
                runnable: Array.from({ length: args.targets }, (_, i) => ({
                  siteId: `site-${i}`, siteName: `Site ${i}`, place: { host: 'local' },
                })),
                barred: [], excluded: [], places: ['local'],
                from: { surface: 'comparator', comparatorId: 'cmp-1', filter: 'all' },
                opensRun: args.targets > 0,
              }),
            }),
      },
    }).id;

  const emitRationale = (args: { taskId: string; observedAt: string; decision: 'approved' | 'denied'; checkpoint: string | null; tool?: string }): string =>
    core.emitter.emit({
      observed_at: args.observedAt,
      topic: RATIONALE_RECORDED_TOPIC,
      schema: RATIONALE_RECORDED_SCHEMA,
      entity: {},
      actor: { id: 'act_local_operator', kind: 'human' },
      source: { class: 'intent', system: 'gateway:approval', trust: 'elicited' },
      correlation: args.taskId,
      payload: {
        tool: args.tool ?? 'bulk_plugin_update',
        decision: args.decision,
        prompt: 'card text',
        source: 'approval-card',
        checkpoint: args.checkpoint,
      },
    }).id;

  const emitAct = (args: { taskId: string; observedAt: string; tool: string; targets?: string[]; result?: 'success' | 'failure' }): { actionId: string; outcomeIds: string[] } => {
    const targets = args.targets ?? [];
    const action = core.emitter.emit({
      observed_at: args.observedAt,
      topic: ACTION_EXECUTED_TOPIC,
      schema: ACTION_EXECUTED_SCHEMA,
      entity: targets.length === 1 ? { environment: targets[0] } : {},
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
      correlation: args.taskId,
      payload: { tool: args.tool, tier: 2, dispatch: 'registry', targets: targets.length, targets_resolved: targets.length },
    });
    const outcomeIds = (targets.length ? targets : [undefined]).map((target) =>
      core.emitter.emit({
        observed_at: args.observedAt,
        topic: OUTCOME_RECORDED_TOPIC,
        schema: OUTCOME_RECORDED_SCHEMA,
        entity: target ? { environment: target } : {},
        actor: { id: 'act_chat_agent', kind: 'agent' },
        source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
        correlation: args.taskId,
        causation: action.id,
        payload: { tool: args.tool, result: args.result ?? 'success', result_scope: 'call' },
      }).id,
    );
    return { actionId: action.id, outcomeIds };
  };

  const emitAbortIncident = (args: { taskId: string; observedAt: string; target: string; abortId: string; symptom: string; causedBy: string }): string =>
    core.emitter.emit({
      observed_at: args.observedAt,
      topic: INCIDENT_TOPIC,
      schema: INCIDENT_SCHEMA,
      entity: { environment: args.target },
      actor: { id: 'act_chat_agent', kind: 'agent' },
      source: { class: 'work', system: 'procedure:abort', trust: 'emitted' },
      correlation: args.taskId,
      causation: args.causedBy,
      payload: { fact: args.abortId, symptom: args.symptom, resolved: false, source: `abort:${args.taskId}/${args.abortId}` },
    }).id;

  // --- Charlie: the halt, the failing verify, the incident -------------------
  const charlieTask = mintTaskId();
  emitManifest({
    taskId: charlieTask,
    observedAt: hoursAgo(14),
    procedure: { capability: RB_BULK.capability, runbook: RB_BULK.id, hash: RB_BULK.hash, status: 'delivered' },
    consulted: true,
    targets: 2,
  });
  emitRationale({ taskId: charlieTask, observedAt: hoursAgo(14), decision: 'approved', checkpoint: 'cp.approval' });
  emitAct({ taskId: charlieTask, observedAt: hoursAgo(14), tool: 'wpe_backup_and_verify', targets: [CHARLIE_1] });
  emitAct({ taskId: charlieTask, observedAt: hoursAgo(14), tool: 'bulk_plugin_update', targets: [CHARLIE_1, CHARLIE_2] });
  const verify = emitAct({ taskId: charlieTask, observedAt: hoursAgo(14), tool: 'verify_site_live', targets: [CHARLIE_1], result: 'failure' });
  const incidentId = emitAbortIncident({
    taskId: charlieTask,
    observedAt: hoursAgo(13),
    target: CHARLIE_1,
    abortId: 'ab.verify-failed',
    symptom: 'checkout returned 500',
    causedBy: verify.outcomeIds[0],
  });

  // --- Bravo: an approval waiting inside a canary that already wrote ---------
  const bravoTask = mintTaskId();
  emitManifest({
    taskId: bravoTask,
    observedAt: hoursAgo(3),
    procedure: { capability: RB_REMEDIATE.capability, runbook: RB_REMEDIATE.id, hash: RB_REMEDIATE.hash, status: 'delivered' },
    consulted: true,
    targets: 1,
  });
  emitAct({ taskId: bravoTask, observedAt: hoursAgo(3), tool: 'contain_site', targets: [BRAVO] });

  // --- the finished cache purge across twelve sites -------------------------
  const purgeTask = mintTaskId();
  const twelve = Array.from({ length: 12 }, (_, i) => provisionalEnvironmentId(`purge-${i}`));
  emitManifest({
    taskId: purgeTask,
    observedAt: hoursAgo(5),
    procedure: { capability: RB_PURGE.capability, runbook: RB_PURGE.id, hash: RB_PURGE.hash, status: 'delivered' },
    consulted: true,
    targets: 12,
  });
  emitRationale({ taskId: purgeTask, observedAt: hoursAgo(5), decision: 'approved', checkpoint: 'cp.approval', tool: 'wpe_purge_cache' });
  emitAct({ taskId: purgeTask, observedAt: hoursAgo(5), tool: 'wpe_purge_cache', targets: twelve });

  const morningDeps = (): SessionRegistryDeps => ({
    core,
    now: NOW,
    describePlace: (id: string) => PLACES[id],
    runbooks: lookup(RB_BULK, RB_REMEDIATE, RB_PURGE),
    health: MORNING_HEALTH(),
  });

  return {
    core,
    dir,
    charlieTask,
    bravoTask,
    purgeTask,
    incidentId,
    registry: () => createSessionRegistry(morningDeps()),
    triage: () => createSessionRegistry(morningDeps()).triage(),
    ledgerCounts: () => ({
      manifests: core.ledger.query({ topicPrefix: MANIFEST_TOPIC, limit: 1000 }).length,
      actions: core.ledger.query({ topicPrefix: ACTION_EXECUTED_TOPIC, limit: 1000 }).length,
      rationales: core.ledger.query({ topicPrefix: RATIONALE_RECORDED_TOPIC, limit: 1000 }).length,
      incidents: core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 1000 }).length,
    }),
    close: () => {
      core.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The registry suite's OWN golden-fixture expectations, re-asserted here.
 *
 * This is what makes the duplicated emitters above safe rather than merely
 * disclosed: if this copy of the morning drifts from the one WP-30 pins, this
 * fails before any render assertion is reached.
 */
export function assertGoldenShape(morning: Morning): TriageView {
  // Shape #15 first: the fold over an empty ledger returns an empty triage
  // quite happily, and every count below would pass against it.
  expect(morning.ledgerCounts()).toEqual({ manifests: 3, actions: 5, rationales: 2, incidents: 1 });
  expect(morning.core.ledger.get(morning.incidentId)).toBeDefined();

  const triage = morning.triage();
  expect(triage.waiting).toHaveLength(2);
  expect(triage.changed).toHaveLength(1);
  expect(triage.reserved.dark).toHaveLength(3);
  expect(triage.reserved.headline).toBe('the record is going blind — 3 producers dark');

  const [charlie, bravo] = triage.waiting;
  expect(charlie.tier).toBe(1);
  expect(charlie.parts.map((p) => p.kind)).toEqual(['run', 'outcome', 'incident']);
  expect(bravo.tier).toBe(1);
  expect(bravo.gate).toMatchObject({
    checkpointId: 'cp.approval',
    index: 3,
    of: 8,
    awaits: 'approval',
    runbookId: 'rb.remediate',
  });
  expect(triage.changed[0].tier).toBe(4);
  // Tear 1: drift leaves the list. No tier 3 in either column, ever.
  expect([...triage.waiting, ...triage.changed].map((s) => s.tier)).not.toContain(3);
  expect(triage.reserved.staleCount).toBe(0);
  return triage;
}
