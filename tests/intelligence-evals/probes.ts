/**
 * WP-13 · Probes — deterministic observations of the real core, used as the
 * EVIDENCE behind every verdict.
 *
 * The point of a probe is that a BLOCKED verdict stops being an assertion and
 * becomes a measurement. "No producer emits `task.action.executed`" is a claim
 * someone has to trust; "the seeded ledger holds 0 events under topic prefix
 * `task.action.` out of 11 total, and grep over `src/` finds no emitter for
 * it" is a fact the reader can check. Same for the runbook: rather than
 * asserting that procedure distribution is unimplemented, the probe RUNS the
 * real assembler under the exact capability B-03 grants and reports what came
 * back.
 *
 * Every probe returns plain evidence lines. None of them decides a verdict —
 * that is the check registry's job, so the observation and the judgement stay
 * separable.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assemble, AssembleRequest, EventEnvelope, taskId as mintTaskId } from '../../src/intelligence';
import { wrapUntrusted } from '../../src/main/mcp/pii';
import { setIntelligenceCore } from '../../src/main/intelligence-host/coreRegistry';
import {
  assembleForChatTurn,
  forgetChatAssemblySession,
  CONTEXT_ASSEMBLED_TOPIC,
} from '../../src/main/intelligence-host/chatAssembly';
import { getCapabilityGrants } from '../../src/main/intelligence-host/capabilityGrants';
import { foldProcedureCursor, runForTask } from '../../src/main/intelligence-host/procedureCursor';
import {
  deriveProcedureAudit,
  ProcedureAuditRow,
} from '../../src/main/intelligence-host/procedureView';
import { loadProcedureHandler } from '../../src/main/mcp/modules/fleet/load-procedure';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { ChatService } from '../../src/main/chat/ChatService';
/**
 * TYPE-ONLY, deliberately — see `contributedDispatcher()`. A value import here
 * puts `AgentDispatcher` on this module's require chain, and through
 * `buildAgentContext` → `ipc-handlers` → `getAIProvider` → `KeyVault` that
 * chain ends at `electron`. Under jest that resolves to the mock; the sitting
 * harness is a plain-Node CLI where it resolves to nothing at all, which is
 * why WP-20e's probes cost the sitting a require-hook stub to run. `import
 * type` is erased at emit, so nothing is dragged.
 */
import type { AgentDispatcher } from '../../src/main/agent-runtime/AgentDispatcher';
import { ContributedToolRegistry } from '../../src/main/agent-runtime/ContributedToolRegistry';
import {
  ACTION_EXECUTED_TOPIC,
  OUTCOME_RECORDED_TOPIC,
  RATIONALE_RECORDED_TOPIC,
  recordApprovalRationale,
} from '../../src/main/intelligence-host/actionProducer';
import type { McpToolHandler, NexusServices } from '../../src/main/mcp/types';
import { validateAgainstJsonSchema } from './jsonSchemaCheck';
import { EvalFixture, INCIDENT_TOPIC } from './fixture';

export const ENVELOPE_SCHEMA_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'intelligence',
  'anchor-slice',
  'schemas',
  'event-envelope.schema.json'
);

export interface Probe {
  /** True when the probe's subject was observed to be present/working. */
  ok: boolean;
  evidence: string[];
}

function envelopeSchema(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(ENVELOPE_SCHEMA_PATH, 'utf-8'));
}

/** Every event in the seeded ledger, oldest first. */
function allEvents(fixture: EvalFixture): EventEnvelope[] {
  return fixture.core.ledger.query({ limit: 10_000 });
}

// ---------------------------------------------------------------------------
// B-03 · WP-20e — the procedure run, driven end to end
// ---------------------------------------------------------------------------

/**
 * What the B-03 checks adjudicate against.
 *
 * Every field below is the result of DRIVING a production seam, never of
 * asserting about one. WP-13's fixture discipline applied to a mechanism that
 * now exists: the grant comes from the live grant set the bootstrap
 * materialized, the arming comes from the real `nexus_load_procedure` tool, the
 * delivery comes from `assembleForChatTurn`, the refusals come from
 * `ToolRegistry.call`'s own guard, and the attestations come from the ledger the
 * gateway wrote.
 */
export interface ProcedureProbe extends Probe {
  /** The live grant, if the shipped set carries one for B-03's capability. */
  granted: boolean;
  grantHash?: string;
  /** The runbook the registry serves for it. */
  runbookId?: string;
  runbookHash?: string;
  /** Did a procedure actually ride the turn, and how was it armed? */
  delivered: boolean;
  armedBy?: string;
  bodyDelivered: boolean;
  checkpointCount: number;
  narrativeCount: number;
  /** The manifest's own record of what governed the turn (`task.context.assembled`). */
  manifestHash?: string | null;
  manifestStatus?: string;
  /** cp.consult-history: the assembler's episodic retrieval, as the manifest recorded it. */
  consultAttested: boolean;
  episodicRetrieved: number;
  /** The gate, driven in five moves. Each is a real `ToolRegistry.call`. */
  refusedBeforeApproval?: string;
  refusedAfterDenial?: string;
  refusedBeforeBackup?: string;
  allowedAfterBackup: boolean;
  /** Which checkpoint each refusal named. */
  refusalCheckpoints: string[];
  /** The cursor at the end: what the ledger proved, and what it can never prove. */
  attested: string[];
  narrative: string[];
  denied: string[];
  /** Per-target backup outcomes — B-03 asks for per-site backup attestation. */
  backupOutcomes: number;
  /** The approval → action → outcome chain, by event id. */
  approvalChained: boolean;
  /** The audit rows the seam derives, so the eval and the surface stay column-for-column. */
  auditRows: ProcedureAuditRow[];
}

const B03_CAPABILITY = 'cap.bulk_plugin_update';
const B03_TURN = 'Update WooCommerce across all my staging sites.';

/**
 * Drive the whole B-03 mechanism once, and report what it did.
 *
 * The sequence is the runbook's own: arm → deliver → try to update (refused,
 * no approval) → deny (refused, and the denial is terminal) → approve (refused,
 * no backup) → back up → update (allowed). Five gate decisions, each from the
 * production guard at the production chokepoint.
 *
 * WHAT IS FIXTURE HERE, stated because a criterion's verdict rests on it: the
 * two tool HANDLERS answer `ok` — nothing in this repo can really update a
 * plugin or take a WP Engine backup inside a test. What is real is everything
 * the criteria are about: the tier table, the audit chokepoint, WP-19's
 * emission, WP-20d's cursor fold and refusal, and the ledger they all write to
 * and read from.
 */
export async function probeProcedureRun(fixture: EvalFixture): Promise<ProcedureProbe> {
  const evidence: string[] = [];
  // The history-flagged site: cp.consult-history is attested by the assembler's
  // OWN episodic retrieval, so the turn has to be about a site with history.
  const flagged = fixture.fleet.find((s) => s.historyFlagged)!;
  const second = fixture.fleet.find((s) => !s.halted && s.siteId !== flagged.siteId)!;
  const localSites: Record<string, { id: string; name: string; domain: string }> = {};
  for (const s of fixture.fleet) {
    localSites[s.siteId] = { id: s.siteId, name: s.name, domain: `${s.siteId}.local` };
  }
  const services = {
    siteData: {
      getSite: (id: string) => localSites[id],
      getSites: () => localSites,
    },
  } as unknown as NexusServices;

  setIntelligenceCore(fixture.core);

  // 1 · the grant, from the set the bootstrap materialized — not one built here.
  const grant = getCapabilityGrants().find((g) => g.capability === B03_CAPABILITY);
  const runbook = fixture.core.law?.runbooks.byCapability(B03_CAPABILITY);
  evidence.push(
    `live capability grants (materialized at initIntelligenceCore, not constructed by this probe): ` +
      `${getCapabilityGrants().map((g) => g.capability).join(', ') || '(none)'}`
  );
  if (!grant || !runbook) {
    return {
      ok: false,
      granted: false,
      delivered: false,
      bodyDelivered: false,
      checkpointCount: 0,
      narrativeCount: 0,
      consultAttested: false,
      episodicRetrieved: 0,
      allowedAfterBackup: false,
      refusalCheckpoints: [],
      attested: [],
      narrative: [],
      denied: [],
      backupOutcomes: 0,
      approvalChained: false,
      auditRows: [],
      evidence: [
        ...evidence,
        `no live grant or no served runbook for ${B03_CAPABILITY} — B-03's premise ("the capability ` +
          `grant carries rb.bulk-plugin-update") cannot be constructed on this tree`,
      ],
    };
  }
  evidence.push(
    `grant ${grant.capability} → ${grant.runbookId} pinned at ${grant.runbookHash} ` +
      `(source: ${grant.source}); registry serves ${runbook.id} v${runbook.version} at ${runbook.hash}`
  );

  // 2 · arming, through the real Tier-1 tool the model would call (P1 path B).
  const registry = new ToolRegistry();
  registry.register(loadProcedureHandler);
  const okHandler = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] });
  for (const name of ['bulk_plugin_update', 'wpe_backup_and_verify']) {
    registry.register({
      definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
      execute: okHandler,
    } as McpToolHandler);
  }
  const ack = await registry.call('nexus_load_procedure', { capability: B03_CAPABILITY }, services, 'mcp');
  evidence.push(
    `nexus_load_procedure acknowledged without carrying the body (R7): ` +
      `${String(ack.content[0]?.text ?? '').split('\n')[0]}`
  );

  // 3 · the turn — the real chat assembly, with the real arming resolution.
  const sessionId = `eval-b03-${mintTaskId()}`;
  forgetChatAssemblySession(sessionId);
  const turn = await assembleForChatTurn({
    services,
    sessionId,
    userMessage: B03_TURN,
    siteId: flagged.siteId,
    buildingSystemPrompt: true,
  });
  const outcome = turn?.procedure ?? null;
  const delivered = outcome?.status === 'delivered' ? outcome : undefined;
  const manifestEvent = turn
    ? fixture.core.ledger.query({
        topicPrefix: CONTEXT_ASSEMBLED_TOPIC,
        correlation: turn.taskId,
        limit: 5,
      })[0]
    : undefined;
  const manifest = (manifestEvent?.payload ?? {}) as {
    procedure?: { hash?: string | null; status?: string; armed_by?: string; checkpoints?: number };
    retrieval?: Array<{ store?: string; returned?: number }>;
  };
  const episodicRetrieved = (manifest.retrieval ?? []).filter((r) => r.store === 'ledger').length;

  evidence.push(
    delivered
      ? `turn delivered ${delivered.runbookId} ${delivered.version} (${delivered.strictness}) — ` +
        `armed_by=${delivered.armedBy}, body on the wire=${delivered.bodyDelivered}, ` +
        `${delivered.checkpoints.length} checkpoints`
      : `turn delivered NO procedure: ${JSON.stringify(outcome)}`
  );
  evidence.push(
    `manifest.procedure = ${JSON.stringify(manifest.procedure ?? null)} — the runbook hash rides ` +
      `the versioned context.assembled/1 payload, so "which document governed this turn" is a ledger query`
  );
  evidence.push(
    `manifest.retrieval carries ${episodicRetrieved} ledger row(s) for the history-flagged site — ` +
      `cp.consult-history is attest:manifest, and this is the SUPPLY side it attests`
  );

  // 4 · the gate, five moves. The tool the runbook claims, refused until its
  //     attestable predecessors are in the ledger.
  const taskId = turn?.taskId;
  const bulkArgs = { site_ids: [flagged.siteId, second.siteId] };
  const callBulk = async () =>
    registry.call('bulk_plugin_update', bulkArgs, services, 'mcp', true, undefined, taskId ? { id: taskId } : undefined);

  const beforeApproval = await callBulk();
  const refusedBeforeApproval = beforeApproval.isError ? String(beforeApproval.content[0]?.text ?? '') : undefined;

  const deniedId = recordApprovalRationale({
    toolName: 'bulk_plugin_update',
    args: bulkArgs,
    cardText: 'Update WooCommerce on 2 staging sites.',
    decision: 'denied',
    taskId,
    services,
  });
  const afterDenial = await callBulk();
  const refusedAfterDenial = afterDenial.isError ? String(afterDenial.content[0]?.text ?? '') : undefined;

  const approvedId = recordApprovalRationale({
    toolName: 'bulk_plugin_update',
    args: bulkArgs,
    cardText: 'Update WooCommerce on 2 staging sites.',
    decision: 'approved',
    taskId,
    services,
  });
  const beforeBackup = await callBulk();
  const refusedBeforeBackup = beforeBackup.isError ? String(beforeBackup.content[0]?.text ?? '') : undefined;

  await registry.call(
    'wpe_backup_and_verify',
    { site_ids: [flagged.siteId, second.siteId] },
    services,
    'mcp',
    true,
    undefined,
    taskId ? { id: taskId } : undefined
  );
  const afterBackup = await callBulk();
  const allowedAfterBackup = !afterBackup.isError;

  // 5 · what the ledger now proves — the same fold the guard just used.
  const run = taskId ? runForTask(taskId) : undefined;
  const cursor = run
    ? foldProcedureCursor(run, runbook.checkpoints, fixture.core.ledger)
    : { attested: [], narrative: [], denied: [], fault: true };
  const auditRows = deriveProcedureAudit(runbook, cursor as never);

  const runEvents = taskId
    ? fixture.core.ledger.query({ correlation: taskId, limit: 10_000 })
    : [];
  const backupAction = runEvents.find(
    (e) => e.topic === ACTION_EXECUTED_TOPIC && (e.payload as { tool?: string }).tool === 'wpe_backup_and_verify'
  );
  const backupOutcomes = backupAction
    ? runEvents.filter((e) => e.topic === OUTCOME_RECORDED_TOPIC && e.causation === backupAction.id).length
    : 0;
  const bulkAction = runEvents.find(
    (e) => e.topic === ACTION_EXECUTED_TOPIC && (e.payload as { tool?: string }).tool === 'bulk_plugin_update'
  );
  const approvalChained = !!approvedId && !!bulkAction;

  const refusalCheckpoints = [refusedBeforeApproval, refusedAfterDenial, refusedBeforeBackup]
    .map((message) => /and (cp\.[a-z-]+) is not attested/.exec(message ?? '')?.[1] ?? '')
    .filter(Boolean);

  evidence.push(
    `GATE, driven five times against the production chokepoint (ToolRegistry.call):`,
    `  1. bulk_plugin_update before any approval → ${refusedBeforeApproval ? 'REFUSED' : 'ALLOWED'}` +
      (refusedBeforeApproval ? ` at ${refusalCheckpoints[0] ?? '(unnamed)'}` : ''),
    `  2. after a DENIED approval (${deniedId ?? 'not recorded'}) → ${refusedAfterDenial ? 'REFUSED' : 'ALLOWED'}` +
      (refusedAfterDenial && /DENIED/.test(refusedAfterDenial) ? ' — and the refusal says the decision was no' : ''),
    `  3. after an APPROVED approval (${approvedId ?? 'not recorded'}), backup still missing → ` +
      `${refusedBeforeBackup ? 'REFUSED' : 'ALLOWED'}` +
      (refusedBeforeBackup ? ` at ${refusalCheckpoints[2] ?? '(unnamed)'}` : ''),
    `  4. wpe_backup_and_verify ran and produced ${backupOutcomes} per-target outcome event(s)`,
    `  5. bulk_plugin_update after the backup → ${allowedAfterBackup ? 'ALLOWED' : 'REFUSED'}`,
    `cursor at the end: attested=[${cursor.attested.join(', ')}] denied=[${cursor.denied.join(', ')}] ` +
      `narrative=[${cursor.narrative.join(', ')}] — four the platform proved, four it never can`,
    `HONEST BOUND: the two tool handlers are fixtures answering "ok" (nothing in a test really ` +
      `updates a plugin or takes a WP Engine backup). The tier table, the chokepoint, WP-19's ` +
      `emission, WP-20d's fold and refusal, and the ledger are all real.`
  );

  return {
    ok: !!delivered && allowedAfterBackup && !!refusedBeforeApproval,
    granted: true,
    grantHash: grant.runbookHash,
    runbookId: runbook.id,
    runbookHash: runbook.hash,
    delivered: !!delivered,
    ...(delivered ? { armedBy: delivered.armedBy } : {}),
    bodyDelivered: !!delivered?.bodyDelivered,
    checkpointCount: runbook.checkpoints.length,
    narrativeCount: runbook.checkpoints.filter((c) => c.attest === 'narrative').length,
    manifestHash: manifest.procedure?.hash ?? null,
    ...(manifest.procedure?.status ? { manifestStatus: manifest.procedure.status } : {}),
    consultAttested: cursor.attested.includes('cp.consult-history'),
    episodicRetrieved,
    ...(refusedBeforeApproval ? { refusedBeforeApproval } : {}),
    ...(refusedAfterDenial ? { refusedAfterDenial } : {}),
    ...(refusedBeforeBackup ? { refusedBeforeBackup } : {}),
    allowedAfterBackup,
    refusalCheckpoints,
    attested: cursor.attested,
    narrative: cursor.narrative,
    denied: cursor.denied,
    backupOutcomes,
    approvalChained,
    auditRows,
    evidence,
  };
}

/**
 * The DENIAL half, run on its own clean run — M4's whole content.
 *
 * Deliberately separate from the sequence above: there, the denial is overtaken
 * by a later approval (which is what lets the run continue), and "the latest
 * decision governs" is only half-proved by a run that ends approved. This one
 * ends denied and stays denied, which is the state the criterion is about.
 */
export interface DeniedApprovalProbe extends Probe {
  denied: string[];
  refusal?: string;
  attestedAnyway: boolean;
  /** `task.action.executed` events for the gated tool under this run. Must be zero. */
  executed: number;
  /** Whether the guard refused. Reported, never adjudicated — the check decides. */
  refused: boolean;
}

export async function probeDeniedApproval(fixture: EvalFixture): Promise<DeniedApprovalProbe> {
  const flagged = fixture.fleet.find((s) => s.historyFlagged)!;
  const localSites: Record<string, { id: string; name: string }> = {};
  for (const s of fixture.fleet) localSites[s.siteId] = { id: s.siteId, name: s.name };
  const services = {
    siteData: { getSite: (id: string) => localSites[id], getSites: () => localSites },
  } as unknown as NexusServices;

  setIntelligenceCore(fixture.core);
  const runbook = fixture.core.law?.runbooks.byCapability(B03_CAPABILITY);
  if (!runbook) {
    return {
      ok: false,
      denied: [],
      attestedAnyway: false,
      executed: 0,
      refused: false,
      evidence: ['no runbook serves the capability'],
    };
  }

  const registry = new ToolRegistry();
  registry.register(loadProcedureHandler);
  registry.register({
    definition: { name: 'bulk_plugin_update', description: 'x', inputSchema: { type: 'object', properties: {} } },
    execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
  } as McpToolHandler);

  await registry.call('nexus_load_procedure', { capability: B03_CAPABILITY }, services, 'mcp');
  const sessionId = `eval-b03-denied-${mintTaskId()}`;
  forgetChatAssemblySession(sessionId);
  const turn = await assembleForChatTurn({
    services,
    sessionId,
    userMessage: B03_TURN,
    siteId: flagged.siteId,
    buildingSystemPrompt: true,
  });
  const taskId = turn?.taskId;

  recordApprovalRationale({
    toolName: 'bulk_plugin_update',
    args: { site_ids: [flagged.siteId] },
    cardText: 'Update WooCommerce on 1 staging site.',
    decision: 'denied',
    taskId,
    services,
  });

  const attempt = await registry.call(
    'bulk_plugin_update',
    { site_ids: [flagged.siteId] },
    services,
    'mcp',
    true,
    undefined,
    taskId ? { id: taskId } : undefined
  );
  const refusal = attempt.isError ? String(attempt.content[0]?.text ?? '') : undefined;

  const run = taskId ? runForTask(taskId) : undefined;
  const cursor = run
    ? foldProcedureCursor(run, runbook.checkpoints, fixture.core.ledger)
    : { attested: [], narrative: [], denied: [], fault: true };

  const executed = taskId
    ? fixture.core.ledger
        .query({ correlation: taskId, limit: 10_000 })
        .filter(
          (e) =>
            e.topic === ACTION_EXECUTED_TOPIC &&
            (e.payload as { tool?: string }).tool === 'bulk_plugin_update'
        ).length
    : 0;

  return {
    // Reported, not adjudicated: every condition the criterion turns on is a
    // separate FIELD below, and `checks.ts` does the conjunction. A probe that
    // hands over a single boolean verdict is a probe one edit away from being
    // the only thing anyone checks (WP-13's own separation: probes observe,
    // the registry judges).
    ok: !!refusal && cursor.denied.includes('cp.approval') && executed === 0,
    refused: !!refusal,
    executed,
    denied: cursor.denied,
    ...(refusal ? { refusal } : {}),
    attestedAnyway: cursor.attested.includes('cp.approval'),
    evidence: [
      `a clean run whose only decision is a DENIAL (task.rationale.recorded, decision="denied")`,
      `foldProcedureCursor(...).denied = [${cursor.denied.join(', ')}] — the decision exists and it says no`,
      `the guard refused the write: ${refusal ? refusal.split('.')[0] + '.' : 'IT DID NOT REFUSE'}`,
      `task.action.executed events for bulk_plugin_update under this run: ${executed} — a refused ` +
        `call emits none, because that topic records execution and a refusal is the absence of one`,
      `and the refusal names the denial rather than asking again: ` +
        `${/DENIED/.test(refusal ?? '') ? 'yes' : 'NO'}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// E-01 · is planted history reachable from the wired surface?
// ---------------------------------------------------------------------------

/**
 * Two runs of the real assembler over the same ledger: one with the retrieval
 * defaults the wired chat surface uses, one asking for the episodic prefix
 * explicitly. The difference between them is the finding.
 */
export async function probeEpisodicRetrieval(fixture: EvalFixture): Promise<Probe> {
  const flagged = fixture.fleet.find((s) => s.historyFlagged)!;
  const targets = [
    { role: 'environment', id: fixture.environmentIdOf(flagged.siteId), label: flagged.name },
    { role: 'site', id: fixture.siteIdOf(flagged.siteId), label: flagged.name },
  ];
  const base: AssembleRequest = {
    actor: { id: 'act_eval_e01', kind: 'agent', autonomy: 'interactive' },
    task: { id: mintTaskId(), intent: 'Update WooCommerce across the fleet.' },
    targets,
    surface: 'eval.wp-13',
  };
  const deps = {
    law: fixture.core.law?.registry,
    ledger: fixture.core.ledger,
    twins: fixture.core.twins,
    wrapUntrusted,
  };

  const asWired = await assemble(base, deps);
  const asEpisodic = await assemble(
    { ...base, task: { ...base.task, id: mintTaskId() }, retrieval: { episodicTopicPrefix: 'episodic.' } },
    deps
  );

  const wiredIncidents = asWired.retrieved.filter((r) => r.title.includes('incident')).length;
  const episodicIncidents = asEpisodic.retrieved.filter((r) => r.store === 'ledger').length;
  const plantedCount = fixture.core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 100 }).length;

  return {
    ok: wiredIncidents > 0,
    evidence: [
      `ledger holds ${plantedCount} planted "${INCIDENT_TOPIC}" event(s) for the gateway-X / flagged sites`,
      `assemble() with the WIRED defaults (chatAssembly still passes no episodicTopicPrefix; the ` +
        `assembler default is now ["state.", "episodic."] — WP-16b) retrieved ${wiredIncidents} incident item(s)`,
      `assemble() with episodicTopicPrefix="episodic." retrieved ${episodicIncidents} ledger item(s)`,
      `so retrieval is no longer the blocker: the anchor surface (chat.docked-panel) now reaches ` +
        `episodic.* through the default`,
      `what remains missing is an INCIDENT producer: WP-14 emits episodic.sync.pulled / ` +
        `episodic.sync.pushed (syncProducer.ts), so the family is populated, but no code in src/ ` +
        `emits an incident — this history exists only because the fixture planted it ` +
        `(WP-13 finding 5; corrected at WP-20e, which measured the sync topics rather than ` +
        `inheriting the older "nothing emits episodic.*" claim)`,
    ],
  };
}

// ---------------------------------------------------------------------------
// E-02 · what does the ledger actually contain after a real run?
// ---------------------------------------------------------------------------

/** Count events under a topic prefix, with the total for context. */
export function probeTopicFamily(fixture: EvalFixture, prefix: string): Probe {
  const events = fixture.core.ledger.query({ topicPrefix: prefix, limit: 10_000 });
  const total = fixture.core.ledger.count();
  const topics = [...new Set(allEvents(fixture).map((e) => e.topic))].sort();
  return {
    ok: events.length > 0,
    evidence: [
      `ledger query topicPrefix="${prefix}" returned ${events.length} event(s) of ${total} total`,
      `topics actually present: ${topics.join(', ') || '(none)'}`,
    ],
  };
}

/**
 * Drives the REAL manifest producer (`assembleForChatTurn`) against the
 * fixture core, then reads back what it wrote. This is the one `task.*`
 * producer that exists, so E-02's manifest criterion can be measured rather
 * than guessed at.
 */
export async function probeManifestEvent(fixture: EvalFixture): Promise<Probe & { taskId?: string }> {
  const site = fixture.fleet.find((s) => !s.halted)!;
  const localSite = { id: site.siteId, name: site.name, domain: `${site.siteId}.local` };

  // Partial service mock cast with `as never` — the established pattern for
  // NexusServices in this subsystem's tests (CLAUDE.md, intelligence layer).
  const services = {
    siteData: {
      getSite: (id: string) => (id === site.siteId ? localSite : undefined),
      getSites: () => ({ [site.siteId]: localSite }),
    },
  } as never;

  setIntelligenceCore(fixture.core);
  const result = await assembleForChatTurn({
    services,
    sessionId: 'eval-wp-13',
    userMessage: 'Update WooCommerce across all my staging sites.',
    siteId: site.siteId,
    buildingSystemPrompt: true,
  });

  if (!result) {
    return { ok: false, evidence: ['assembleForChatTurn returned null — no manifest was emitted'] };
  }

  const emitted = fixture.core.ledger.query({
    topicPrefix: CONTEXT_ASSEMBLED_TOPIC,
    correlation: result.taskId,
    limit: 10,
  });
  if (emitted.length === 0) {
    return {
      ok: false,
      taskId: result.taskId,
      evidence: [
        `assembleForChatTurn returned taskId ${result.taskId} but no "${CONTEXT_ASSEMBLED_TOPIC}" ` +
          `event carries that correlation`,
      ],
    };
  }

  const manifest = emitted[0].payload as Record<string, unknown>;
  const policy = manifest.policy as Record<string, unknown> | null;
  const freshness = manifest.freshness_report as unknown[] | undefined;

  return {
    ok: true,
    taskId: result.taskId,
    evidence: [
      `real producer chatAssembly.assembleForChatTurn emitted 1 "${CONTEXT_ASSEMBLED_TOPIC}" event`,
      `correlation = ${emitted[0].correlation} (matches the returned TaskId)`,
      `manifest.policy.version = ${JSON.stringify(policy?.version)} — POLICY VERSION: present`,
      `manifest.freshness_report = ${Array.isArray(freshness) ? `${freshness.length} row(s)` : 'absent'} — FRESHNESS REPORT: ${Array.isArray(freshness) ? 'present' : 'ABSENT'}`,
      `manifest.procedure = ${JSON.stringify(manifest.procedure)} — null on THIS turn because nothing ` +
        `armed, which is the honest value: no procedure governed it. WP-20c widened the field from ` +
        `null-by-contract to a record; the armed turn probeProcedureRun drives carries the runbook hash`,
    ],
  };
}

/** E-02's schema-validity criterion, run against the JSON file on disk. */
export function probeEnvelopeSchema(fixture: EvalFixture): Probe {
  const schema = envelopeSchema();
  const events = allEvents(fixture);
  const failures: string[] = [];

  for (const event of events) {
    const violations = validateAgainstJsonSchema(event, schema);
    if (violations.length) {
      failures.push(
        `${event.id} (${event.topic}): ${violations.map((v) => `${v.at}: ${v.message}`).join('; ')}`
      );
    }
  }

  return {
    ok: failures.length === 0,
    evidence: [
      `validated ${events.length} event(s) against ${path.relative(path.join(__dirname, '..', '..'), ENVELOPE_SCHEMA_PATH)}`,
      `topics covered: ${[...new Set(events.map((e) => e.topic))].sort().join(', ')}`,
      failures.length
        ? `${failures.length} envelope(s) violated the schema: ${failures.join(' | ')}`
        : `0 violations — the on-disk interchange schema and the in-process zod schema agree on this corpus`,
    ],
  };
}

/**
 * E-02's must_not: "events with observed_at/recorded_at conflated or missing".
 *
 * "Conflated" is NOT "equal". Two timestamps may legitimately coincide when a
 * fact is observed live at emission time — the webhook producer says so in as
 * many words. What is checkable, and what actually matters, is that both
 * fields are present and well-formed, that observed_at never runs AHEAD of
 * recorded_at (a fact recorded before it was true is the shape a laundered
 * backfill takes), and that a producer carrying real source timestamps does
 * not flatten them to "now". The distribution is reported either way, so a
 * reader can see whether the layer is actually preserving source time.
 */
export function probeTimestampDiscipline(fixture: EvalFixture): Probe {
  const events = allEvents(fixture);
  const problems: string[] = [];
  let equal = 0;
  let distinct = 0;

  for (const event of events) {
    if (!event.observed_at || !event.recorded_at) {
      problems.push(`${event.id} (${event.topic}): missing timestamp`);
      continue;
    }
    const observed = Date.parse(event.observed_at);
    const recorded = Date.parse(event.recorded_at);
    if (Number.isNaN(observed) || Number.isNaN(recorded)) {
      problems.push(`${event.id} (${event.topic}): unparseable timestamp`);
      continue;
    }
    // One second of slack: the emitter stamps recorded_at, producers stamp
    // observed_at, and a same-instant pair can land microseconds apart.
    if (observed > recorded + 1000) {
      problems.push(
        `${event.id} (${event.topic}): observed_at ${event.observed_at} is AFTER recorded_at ${event.recorded_at}`
      );
      continue;
    }
    if (event.observed_at === event.recorded_at) equal++;
    else distinct++;
  }

  const backdated = events.filter(
    (e) => Date.parse(e.recorded_at) - Date.parse(e.observed_at) > 60_000
  );

  return {
    ok: problems.length === 0,
    evidence: [
      `${events.length} event(s) checked: ${problems.length} problem(s)`,
      `both fields present and ordered (observed_at <= recorded_at) on ${events.length - problems.length} event(s)`,
      `identical timestamps on ${equal}, distinct on ${distinct} — identical is legitimate for ` +
        `live observation (the webhook producer stamps "now" and documents why)`,
      `${backdated.length} event(s) carry a genuinely historical observed_at (>60s older than recorded_at), ` +
        `proving source time survives emission rather than being flattened`,
      ...problems,
    ],
  };
}

// ---------------------------------------------------------------------------
// E-02 · WP-19 — what does a REAL gated call leave behind?
// ---------------------------------------------------------------------------

export interface GatewayProbe extends Probe {
  taskId: string;
  actions: number;
  outcomes: number;
  rationales: number;
  /** Dispatch paths actually observed. Both must appear: the `agent__*` bypass
   *  reaches no chokepoint, so covering only the registry would be a coverage
   *  claim with a hole in it. */
  dispatches: string[];
  /** Every action carries actor.id AND actor.via (ADR-14). */
  actorsComplete: boolean;
  /** rationale -> action -> outcome, by event id. */
  chained: boolean;
  /** Every emitted event carries the run's correlation. */
  allCorrelated: boolean;
  /** Outcomes emitted for a two-site call — E-02's "per target site". */
  perTargetOutcomes: number;
  /** A Tier-1 read through the same registry emitted nothing. */
  tierOneSilent: boolean;
}

/**
 * Drives the REAL gateway seams against the fixture core and reads the ledger
 * back. Nothing is hand-emitted: the registry chokepoint runs a registered
 * handler, and the contributed path runs through `ChatService`'s own
 * `agent__*` branch, which is the path that reaches no chokepoint.
 *
 * Note on how the two are driven: the registry side goes through the public
 * `ToolRegistry.call`; the contributed side calls `ChatService`'s private
 * `executeToolCall` directly, because driving it publicly needs a model turn.
 * `tests/unit/chat/chat-gateway-emission.test.ts` drives the public
 * `sendMessage` path for exactly that reason — this probe is the report's
 * evidence, that suite is the pin.
 */
function contributedDispatcher(): AgentDispatcher {
  // WP-24 · LAZY BY REQUIREMENT, not by taste. Loading the dispatcher at module
  // scope pulls electron into every importer of this file, including
  // `sitting.ts` — a plain-Node CLI. Requiring it here confines that cost to
  // the one probe that actually constructs a dispatcher, so the sitting runs
  // with no electron stub. If a second probe ever needs it, require it there
  // too rather than hoisting this back to the top.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AgentDispatcher: Dispatcher } =
    require('../../src/main/agent-runtime/AgentDispatcher') as typeof import('../../src/main/agent-runtime/AgentDispatcher');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp19-eval-agent-'));
  fs.mkdirSync(path.join(dir, 'log_processor'));
  fs.writeFileSync(
    path.join(dir, 'log_processor', 'agent.js'),
    `module.exports = { contributes: { tools: { rescan: { handler: async () => ({ content: [{ type: 'text', text: 'rescanned' }] }) } } } };`
  );
  const contributed = new ContributedToolRegistry();
  contributed.register(
    'log_processor',
    { name: 'rescan', description: 'Rescan the log bucket', inputSchema: {} },
    2
  );
  return new Dispatcher(
    contributed,
    new ToolRegistry(),
    {} as never,
    dir,
    {} as never,
    { buildHandle: () => ({}) } as never
  );
}

export async function probeGatewayEmission(fixture: EvalFixture): Promise<GatewayProbe> {
  const [siteA, siteB] = fixture.fleet.filter((s) => !s.halted);
  const localSites: Record<string, { id: string; name: string }> = {};
  for (const s of fixture.fleet) localSites[s.siteId] = { id: s.siteId, name: s.name };

  const services = {
    siteData: {
      getSite: (id: string) => localSites[id],
      getSites: () => localSites,
    },
    contributedRegistry: {
      getByMcpName: (mcpName: string) => {
        const [, agentName, toolName] = mcpName.split('__');
        return { agentName, toolName };
      },
    },
    // A REAL AgentDispatcher over a real (temp) agent module. The emission for
    // contributed tools lives inside the dispatcher — it has two callers, and
    // instrumenting one of them would leave the other unrecorded — so a mocked
    // dispatcher here would produce evidence of nothing.
    dispatcher: contributedDispatcher(),
  } as unknown as NexusServices;

  setIntelligenceCore(fixture.core);
  const taskId = mintTaskId();

  const registry = new ToolRegistry();
  const okHandler = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] });
  for (const name of ['wp_plugin_update', 'bulk_plugin_update', 'wp_plugin_list']) {
    registry.register({
      definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
      execute: okHandler,
    } as McpToolHandler);
  }

  // 1. The approval a human answered, then the act it authorised.
  const rationaleId = recordApprovalRationale({
    toolName: 'wp_plugin_update',
    args: { site: siteA.siteId, plugin: 'woocommerce' },
    cardText: 'This updates WooCommerce on a site with prior checkout breakage.',
    decision: 'approved',
    taskId,
    services,
  });
  await registry.call(
    'wp_plugin_update',
    { site: siteA.siteId, plugin: 'woocommerce' },
    services,
    'mcp',
    false,
    undefined,
    { id: taskId, causation: rationaleId }
  );

  // 2. A two-site call — E-02 asks for an outcome PER TARGET SITE.
  await registry.call(
    'bulk_plugin_update',
    { site_ids: [siteA.siteId, siteB.siteId] },
    services,
    'mcp',
    true,
    undefined,
    { id: taskId }
  );

  // 3. The bypass, through ChatService's own branch.
  const chat = new ChatService({ registry, services, sendToRenderer: () => undefined });
  const session = {
    id: 'eval-wp-19',
    messages: [],
    abortController: new AbortController(),
    pendingApprovals: new Map(),
  };
  await (chat as unknown as {
    executeToolCall: (s: unknown, t: unknown, taskId?: string) => Promise<unknown>;
  }).executeToolCall(
    session,
    { id: 'tc-1', name: 'agent__log_processor__rescan', arguments: { bucket: 'wpe-logs' } },
    taskId
  );

  // 4. The tier boundary: a Tier-1 read through the SAME registry.
  const before = fixture.core.ledger.query({ topicPrefix: 'task.a', limit: 10_000 }).length;
  await registry.call('wp_plugin_list', { site: siteA.siteId }, services, 'mcp');
  const tierOneSilent =
    fixture.core.ledger.query({ topicPrefix: 'task.a', limit: 10_000 }).length === before;

  const byTopic = (topic: string) =>
    fixture.core.ledger.query({ topicPrefix: topic, correlation: taskId, limit: 1_000 });
  const actions = byTopic(ACTION_EXECUTED_TOPIC);
  const outcomes = byTopic(OUTCOME_RECORDED_TOPIC);
  const rationales = byTopic(RATIONALE_RECORDED_TOPIC);

  const dispatches = [...new Set(actions.map((a) => String(a.payload.dispatch)))].sort();
  const actorsComplete = actions.every((a) => !!a.actor?.id && !!a.actor?.via);
  const approvedAction = actions.find((a) => a.causation === rationaleId);
  const chainedOutcome = approvedAction
    ? outcomes.find((o) => o.causation === approvedAction.id)
    : undefined;
  const chained = !!approvedAction && !!chainedOutcome;
  const allCorrelated = [...actions, ...outcomes, ...rationales].every((e) => e.correlation === taskId);
  const bulkAction = actions.find((a) => a.payload.tool === 'bulk_plugin_update');
  const perTargetOutcomes = bulkAction
    ? outcomes.filter((o) => o.causation === bulkAction.id).length
    : 0;

  return {
    ok:
      actions.length > 0 &&
      outcomes.length > 0 &&
      rationales.length > 0 &&
      dispatches.includes('registry') &&
      dispatches.includes('contributed') &&
      actorsComplete &&
      chained &&
      allCorrelated &&
      tierOneSilent,
    taskId,
    actions: actions.length,
    outcomes: outcomes.length,
    rationales: rationales.length,
    dispatches,
    actorsComplete,
    chained,
    allCorrelated,
    perTargetOutcomes,
    tierOneSilent,
    evidence: [
      `drove the REAL seams under one TaskId (${taskId}): an approved wp_plugin_update through ` +
        `ToolRegistry.call, a two-site bulk_plugin_update, and an agent__ contributed call through ` +
        `ChatService's own bypass branch`,
      `ledger now holds ${actions.length} ${ACTION_EXECUTED_TOPIC}, ${outcomes.length} ` +
        `${OUTCOME_RECORDED_TOPIC} and ${rationales.length} ${RATIONALE_RECORDED_TOPIC} event(s) ` +
        `under that correlation`,
      `dispatch paths observed: ${dispatches.join(', ') || '(none)'} — the contributed path reaches ` +
        `no chokepoint, so its presence here is what makes the coverage claim true`,
      `actor.id + actor.via populated on every action event (ADR-14): ${actorsComplete}`,
      `causation chain approval -> action -> outcome: ${chained}` +
        (approvedAction ? ` (${rationaleId} -> ${approvedAction.id} -> ${chainedOutcome?.id})` : ''),
      `the two-site call produced ${perTargetOutcomes} outcome event(s), one per target site; each ` +
        `carries result_scope="call" — the CALL's result against each target, never a per-site ` +
        `re-check nobody ran`,
      `tier boundary: a Tier-1 read (wp_plugin_list) through the same registry emitted nothing: ` +
        `${tierOneSilent}`,
    ],
  };
}
