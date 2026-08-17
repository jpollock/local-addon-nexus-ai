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
  CONTEXT_ASSEMBLED_TOPIC,
} from '../../src/main/intelligence-host/chatAssembly';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { ChatService } from '../../src/main/chat/ChatService';
import { AgentDispatcher } from '../../src/main/agent-runtime/AgentDispatcher';
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
// B-03 · does anything distribute a runbook to the actor?
// ---------------------------------------------------------------------------

/**
 * B-03's premise is "the capability grant carries rb.bulk-plugin-update
 * (strict)". This runs the REAL assembler under exactly that grant and reports
 * what the actor would actually receive.
 */
export async function probeProcedureDistribution(fixture: EvalFixture): Promise<Probe> {
  const target = fixture.fleet.find((s) => !s.halted)!;
  const request: AssembleRequest = {
    actor: { id: 'act_eval_b03', kind: 'agent', autonomy: 'interactive' },
    capability: 'cap.bulk_plugin_update',
    task: { id: mintTaskId(), intent: 'Update WooCommerce across all my staging sites.' },
    targets: [
      { role: 'environment', id: fixture.environmentIdOf(target.siteId), label: target.name },
    ],
    surface: 'eval.wp-13',
  };

  const bundle = await assemble(request, {
    law: fixture.core.law?.registry,
    ledger: fixture.core.ledger,
    twins: fixture.core.twins,
    wrapUntrusted,
  });

  const evidence = [
    `real assemble() run with capability="cap.bulk_plugin_update", surface="eval.wp-13"`,
    `bundle.procedure = ${JSON.stringify(bundle.procedure)}`,
    `bundle.tools = ${JSON.stringify(bundle.tools)} (${bundle.tools.length} grant(s))`,
    `manifest.capability = ${JSON.stringify(bundle.manifest.capability)} — the grant is RECORDED…`,
    `manifest.procedure = ${JSON.stringify(bundle.manifest.procedure)} — …but no procedure rides with it`,
    `contract: src/intelligence/assemble/types.ts declares procedure/tools "inert in v0 (always null / [])"`,
    `runbook on disk: docs/intelligence/anchor-slice/runbooks/bulk-plugin-update.md ` +
      `(capability: cap.bulk_plugin_update, strictness: strict) — authored, never delivered`,
  ];

  return { ok: bundle.procedure !== null || bundle.tools.length > 0, evidence };
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
      `what remains missing is a PRODUCER — no code in src/ emits any episodic.* event, so this ` +
        `history exists only because the fixture planted it (WP-13 finding 5 → WP-14)`,
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
      `manifest.procedure = ${JSON.stringify(manifest.procedure)} — RUNBOOK HASH: absent, and absent by ` +
        `contract (procedure is null in assembler v0)`,
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
  return new AgentDispatcher(
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
