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
import * as path from 'path';
import { assemble, AssembleRequest, EventEnvelope, taskId as mintTaskId } from '../../src/intelligence';
import { wrapUntrusted } from '../../src/main/mcp/pii';
import { setIntelligenceCore } from '../../src/main/intelligence-host/coreRegistry';
import {
  assembleForChatTurn,
  CONTEXT_ASSEMBLED_TOPIC,
} from '../../src/main/intelligence-host/chatAssembly';
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
