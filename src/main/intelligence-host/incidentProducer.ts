/**
 * WP-25 · The incident producer — `episodic.incident.recorded` stops being a
 * fixture and becomes a record of things that actually broke.
 *
 * THE GAP THIS CLOSES, measured before it was written: the topic exists in the
 * taxonomy, the assembler retrieves it, `episodicSummary` renders it, and two
 * eval families have leaned on it through five sittings — and every incident
 * event in every ledger on this branch was planted `via fixture:e01-incident`.
 * The platform OBSERVES incidents in two places and recorded them in neither.
 *
 * TWO TAPS, both on records the product already writes (design note P1):
 *
 *   (a) **Sentinel findings.** A finding at or above `SEVERITY_FLOOR` in a
 *       completed security-sentinel report is an incident observation: the
 *       platform noticed something broken or breached on a site. Tapped at the
 *       run-completion chokepoint in `AgentRunner`, beside the inbox write —
 *       the sentinel's own behaviour is never touched, only its output read.
 *   (b) **Procedure aborts.** A strict run entering an abort path is an
 *       operational incident by construction: the runbook's own definition of
 *       "something went wrong enough to stop". Derived from the run's
 *       `task.outcome.recorded` failures at the seam that already folds the
 *       cursor. This closes the loop nothing else closes — the NEXT run's
 *       cp.consult-history retrieves the LAST run's abort.
 *
 * FIVE RULES A REVIEWER SHOULD BE ABLE TO CHECK AGAINST THE CODE:
 *
 *  1. **NEVER FABRICATE A TIME.** `observed_at` is the scan's completion time
 *     or the failing outcome's own `observed_at`, both real source timestamps
 *     carried in from the record being folded. Nothing here calls `new Date()`
 *     for `observed_at`; a report with no usable time emits NOTHING rather than
 *     being stamped "now" (the layer's `observed_at` / `recorded_at` invariant,
 *     and the one an episodic family would lose silently).
 *  2. **NEVER DERIVE AN ENTITY.** The sentinel addresses sites by NAME, and a
 *     name that resolves to nothing produces no event — deriving an id for it
 *     would mint a second entity beside the real one (audit A7). Resolution
 *     goes through `entityRefsFor`, the ladder `actionProducer` already uses,
 *     so an incident lands on the entity the ledger already holds.
 *  3. **RESOLUTION IS OBSERVED, NEVER ASSUMED (P3), AND ALWAYS SUPERSEDES.** A
 *     resolution is a NEW event carrying `resolved: true` and `resolved_at`,
 *     with `causation` pointing at the incident it closes. Nothing is mutated;
 *     the ledger is append-only and the fold decides. A sentinel incident
 *     closes only on a later scan of that site that found nothing AND SKIPPED
 *     NOTHING — the sentinel's own summary says `clean` means "the checks that
 *     ran found nothing", so closing on a partial scan would launder a coverage
 *     limit into an all-clear.
 *  4. **DEDUP IS DURABLE, AND IT IS A LEDGER READ (P4).** Two gates, both
 *     required: the same open (site, component, class) never opens twice, and
 *     the same CAUSING RECORD never produces two incidents. The change gate in
 *     `changeGate.ts` is deliberately NOT used, for the reason WP-14 and WP-19
 *     both recorded: it compares against `twin_facts`, an episodic occurrence
 *     folds into no twin, and the gate would degrade to a process-lifetime
 *     cache — a producer that re-emits after every restart is the heartbeat P4
 *     forbids, one restart later. The abort tap re-runs on EVERY armed turn
 *     over the same run events, so a process cache would not even survive the
 *     session.
 *  5. **NON-FATAL BY CONSTRUCTION.** Every entry point swallows its own faults.
 *     A sentinel sweep must never fail because its incidents could not be
 *     recorded, and a chat turn must never break for it either.
 *
 * OUT OF SCOPE, deliberately (design note §3): no assembler change, no sentinel
 * behaviour change, no new topic, no Tell-channel intake, no UI.
 */
import type { EventEnvelope, Ledger, Runbook } from '../../intelligence';
import type { NexusServices } from '../mcp/types';
import { entityRefsFor } from './actionProducer';
import type { IntelligenceCore } from './bootstrap';
import { getIntelligenceCore } from './coreRegistry';
import { runEvents } from './procedureCursor';
import type { ProcedureRun } from './procedureCursor';

/** The topic the taxonomy already carries and the assembler already retrieves. */
export const INCIDENT_TOPIC = 'episodic.incident.recorded';
export const INCIDENT_SCHEMA = 'incident.recorded/1';

/**
 * WP-57 · THE SCAN ACT IS GONE, SUBSUMED BY THE RUN FRAME (owner-ruled).
 *
 * WP-51 minted a TaskId here and emitted `task.run.completed` for the scan. A
 * sentinel scan IS a sentinel run, so once `agentTaskFrame` brackets every run
 * that topic had two producers and two meanings — the collision ruled at
 * WP-48/50/52. The frame is now the sole producer; this file RECEIVES the
 * correlation instead of minting one.
 *
 * WP-51's semantics are preserved, not discarded:
 *   - still ONE act per report, however many sites it covers;
 *   - still LAZY — `correlationId()` flushes the bracket only when this
 *     producer is actually about to write something, which is the same
 *     just-in-time rule `scanCorrelation` implemented;
 *   - still "a correlation is written only when the act it names was
 *     recorded" — the frame returns undefined if its bracket could not be
 *     written, so an id naming nothing is never stamped on a finding.
 * And it gains what WP-51 could not give it: a scan that finds NOTHING but
 * closes a previous incident now carries a correlation too.
 */

/** Which agent's report is a security scan. The tap reads one agent's output. */
export const SENTINEL_AGENT_ID = 'security-sentinel';

/**
 * `source.system` values — CONSTANTS, one per tap.
 *
 * The per-report / per-abort identity rides in the PAYLOAD's `source` (P2), not
 * here: `source.system` is what the health surface counts liveness by, one row
 * per system, and a value carrying a report id would make that table grow by
 * one row per scan.
 */
export const SENTINEL_SYSTEM = 'sentinel:scan';
export const ABORT_SYSTEM = 'procedure:abort';

/** The sentinel's own actor. An agent observed this, and the record says so. */
const SENTINEL_ACTOR = { id: 'act_security_sentinel', kind: 'agent' } as const;

/**
 * Severity, weakest first. The sentinel's `Finding.severity` vocabulary
 * (`agent-sdk/types.ts`), used only for comparison against the floor.
 */
export const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

/**
 * The threshold, and why it is here rather than at a call site.
 *
 * `high` and `critical` are the two the sentinel reserves for "something is
 * wrong on this site now"; `medium` and below are hygiene, and folding them
 * would make the episodic family a heartbeat — exactly what P4 forbids. It is a
 * named export so a reader can see the line and a test can pin that the cases
 * below it really are below it.
 */
export const SEVERITY_FLOOR: Severity = 'high';

/** Per-entity ledger read for the dedup gates. Generous: incidents are rare. */
const INCIDENT_READ_LIMIT = 500;

// ---------------------------------------------------------------------------
// The payload contract (design note P2) — held at the gate for ratification
// ---------------------------------------------------------------------------

/**
 * What an incident says. Every field name here is answerable to a CONSUMER:
 * `component`, `symptom`, `from_version`, `to_version`, `correlate` and
 * `resolved` are exactly the keys `episodicSummary`'s allow-list renders, and
 * `fact` is what `factKeyOf` renders as the item's detail line. A field this
 * producer invents that no reader reads is a field nobody will maintain.
 *
 * Two divergences from P2's prose, both deliberate, both reported at the gate:
 *
 *   - P2 writes `correlates_with`; the assembler reads `correlate`. The
 *     ratification's own criterion is "matching what `episodicSummary` already
 *     serves", and the note's §3 forbids an assembler change, so the consumer's
 *     spelling governs. (No v0 tap populates it: the sentinel's per-site
 *     findings carry no correlation and an abort carries none either.)
 *   - P2 lists no field for the FINDING CLASS, and P4's dedup key
 *     (site + component + finding class) cannot be computed without one.
 *     `fact` carries it, reusing the payload convention `factKeyOf` already
 *     reads rather than inventing a key.
 */
export interface IncidentPayload extends Record<string, unknown> {
  /**
   * Plugin/theme/core slug. OMITTED for a site-level incident (gate ruling 1a):
   * `episodicSummary` uses it as the summary's HEAD, and a head word must carry
   * information — `site` there is a schema artifact leaking into the model's
   * prose. Absent means site-level, and every reader here defaults it back to
   * `SITE_LEVEL` so the dedup key is unchanged. When a real slug exists it is
   * written, and it heads the line.
   */
  component?: string;
  /** The finding class — stable across scans, and the dedup key's third part. */
  fact: string;
  /** One sentence: the sentinel finding's title, or the runbook's own abort condition. */
  symptom?: string;
  severity?: Severity;
  from_version?: string;
  to_version?: string;
  correlate?: string;
  resolved: boolean;
  /** ISO, on an amendment only. */
  resolved_at?: string;
  /** `sentinel:<report-id>` or `abort:<task-id>/<abort-id>` (P2). */
  source?: string;
}

// ---------------------------------------------------------------------------
// Tap A · sentinel findings
// ---------------------------------------------------------------------------

/** One finding, as `AgentResult` carries it (`agent-sdk/types.ts`). */
export interface SentinelFinding {
  id?: string;
  severity?: string;
  title?: string;
  category?: string;
}

/**
 * One site's slice of the report.
 *
 * `notChecked` is NOT on the SDK's `AgentResult` type but IS on the object the
 * sentinel returns (`describeCoverage`'s skipped labels). It is read
 * defensively and it is load-bearing: it is the difference between "clean" and
 * "clean, and everything ran".
 */
export interface SentinelSiteReport {
  status?: string;
  findings?: SentinelFinding[];
  notChecked?: unknown;
}

export interface SentinelReport {
  agentId?: string;
  /** The run id — the closest thing to a report id the runtime has. */
  runId?: string;
  /** The scan's own completion time (epoch ms or ISO). NEVER the fold time. */
  observedAt?: number | string;
  /**
   * WP-57 · the run frame's correlation, flushed on demand.
   *
   * A FUNCTION rather than a value, and that is load-bearing: calling it is
   * what writes `task.run.assigned`, so passing a plain id would make every
   * sentinel run real whether or not it recorded anything — the heartbeat
   * WP-51's laziness refused and the frame still refuses.
   */
  correlationId?: () => string | undefined;
  sites?: Record<string, SentinelSiteReport>;
}

export interface IncidentProducerDeps {
  /** For local-site resolution. Absent ⇒ only alias-resolvable targets land. */
  services?: NexusServices;
  /** Test seam. Production reads the process-wide core, like every producer. */
  core?: IntelligenceCore;
}

/**
 * Fold a completed sentinel report into incidents, and close what it cleared.
 *
 * Returns how many events were emitted (incidents + amendments), so the caller
 * can log a number rather than a hope. Never throws.
 */
export function recordSentinelIncidents(
  report: SentinelReport,
  deps: IncidentProducerDeps = {}
): number {
  try {
    const core = deps.core ?? getIntelligenceCore();
    if (!core) return 0;
    // The tap reads ONE agent's output. Every agent's findings are not
    // incidents, and widening this is a scope decision, not an implementation
    // detail (P1c registers the Tell channel the same way).
    if (report?.agentId !== SENTINEL_AGENT_ID) return 0;

    const observedAt = isoOrUndefined(report.observedAt);
    if (!observedAt) return 0; // rule 1: no time, no event
    const sites = report.sites;
    if (!sites || typeof sites !== 'object') return 0;

    const source = report.runId ? `sentinel:${report.runId}` : undefined;
    let written = 0;

    /**
     * WP-57 · the RUN's correlation, supplied by the caller's frame.
     *
     * Still lazy and still called just-in-time, for WP-51's own reason: the
     * overwhelmingly common scan finds nothing new and is not an act worth
     * recording. Calling this is what makes the run real, so it happens
     * immediately before the first thing that needs a correlation to point at.
     *
     * Absent caller frame ⇒ no correlation, exactly as an unrecordable act
     * produced none before.
     */
    const scanCorrelation = (): string | undefined =>
      report.correlationId ? report.correlationId() : undefined;

    for (const [siteName, site] of Object.entries(sites)) {
      const refs = entityRefsFor(core, siteName, deps.services);
      if (!refs) continue; // rule 2: never derive an entity for a name
      const anchor = refs.site ?? refs.environment;
      if (!anchor) continue;

      const history = incidentHistory(core, anchor);
      if (!history) continue;
      const findings = Array.isArray(site?.findings) ? site.findings : [];
      const reported = new Set<string>();

      for (const finding of findings) {
        const fact = typeof finding?.id === 'string' ? finding.id : undefined;
        if (!fact) continue;
        reported.add(fact);
        if (!atOrAboveFloor(finding.severity)) continue;
        const key = incidentKey(SITE_LEVEL, fact);
        if (history.open.has(key)) continue; // rule 4: already open, not news

        emitIncident(core, {
          observedAt,
          entity: refs,
          actor: SENTINEL_ACTOR,
          system: SENTINEL_SYSTEM,
          // WP-51 · the scan that observed this finding, named. Absent when the
          // act could not be recorded — see `scanCorrelation`.
          correlation: scanCorrelation(),
          payload: {
            // `component` OMITTED at site level (gate ruling 1a). A head word
            // must carry information, and `site` as a head is a schema artifact
            // leaking into the model's prose — the summary opens on the symptom
            // instead. Omission is the only in-scope lever, since the assembler
            // is out of bounds; the dedup key defaults the absent value back to
            // `site` on read, so nothing downstream has to know.
            ...componentField(SITE_LEVEL),
            fact,
            ...(typeof finding.title === 'string' && finding.title ? { symptom: finding.title } : {}),
            severity: finding.severity as Severity,
            resolved: false,
            ...(source ? { source } : {}),
          },
        });
        history.open.set(key, 'just-emitted');
        written++;
      }

      // Rule 3. Only a scan that found nothing AND skipped nothing may close
      // anything, and it closes only classes it would have seen.
      if (!scanIsConclusive(site)) continue;
      for (const [key, openId] of history.open) {
        if (openId === 'just-emitted') continue;
        const fact = factOfKey(key);
        if (reported.has(fact)) continue;
        emitIncident(core, {
          observedAt,
          entity: refs,
          actor: SENTINEL_ACTOR,
          system: SENTINEL_SYSTEM,
          // The scan doing the CLOSING, not the one that opened it: an
          // amendment is an observation of THIS sweep. `causation` already
          // names the incident being closed, which is the other half.
          correlation: scanCorrelation(),
          causation: openId,
          payload: {
            ...history.payloads.get(key)!,
            resolved: true,
            resolved_at: observedAt,
            ...(source ? { source } : {}),
          },
        });
        written++;
      }
    }

    if (written > 0) core.scheduleFolds();
    return written;
  } catch {
    return 0; // rule 5
  }
}

/**
 * "This scan would have seen it." A sweep that found nothing while skipping the
 * filesystem has not cleared a filesystem finding, and the sentinel says so in
 * its own summary. Nothing here maps a finding class to the check that produces
 * it — that mapping does not exist — so the conservative conjunction is the
 * only honest one available: nothing found, and nothing skipped.
 */
function scanIsConclusive(site: SentinelSiteReport): boolean {
  if (site?.status !== 'clean') return false;
  const skipped = site.notChecked;
  if (skipped === undefined || skipped === null) return false; // unknown coverage is not full coverage
  return Array.isArray(skipped) ? skipped.length === 0 : false;
}

// ---------------------------------------------------------------------------
// Tap B · procedure aborts
// ---------------------------------------------------------------------------

const ACTION_TOPIC = 'task.action.executed';
const OUTCOME_TOPIC = 'task.outcome.recorded';

/** An abort path as the runbook declares it. */
export interface RunbookAbort {
  id: string;
  /** The authored condition, e.g. "cp.backup failure or unverifiable backup". */
  on: string;
}

/**
 * The abort a failure of this tool takes, according to the DOCUMENT.
 *
 * The chain is: tool → the checkpoints that declare it (`evidence.tool` or
 * `tools`) → the abort whose `on:` clause names one of them. Nothing here holds
 * a list of abort ids; the three the design note names fall out of
 * `rb.bulk-plugin-update` and a test pins that they do. A runbook that edits its
 * abort paths changes this mapping the same day, which is the property a
 * hardcoded list would not have.
 *
 * **Zero or more than one candidate yields nothing.** `bulk_plugin_update` is
 * declared by both `cp.canary` and `cp.roll-fleet`, and exactly one of those is
 * named by an abort — so the anchor resolves cleanly. A document that ties one
 * tool to two abort paths is ambiguous, and picking one would be a guess
 * recorded as an observation.
 */
export function abortForTool(runbook: Runbook | undefined, tool: string): RunbookAbort | undefined {
  if (!runbook || !tool) return undefined;
  const checkpointIds = (runbook.checkpoints ?? [])
    .filter((c) => c.evidence?.tool === tool || (c.tools ?? []).some((t) => t.name === tool))
    .map((c) => c.id);
  if (checkpointIds.length === 0) return undefined;

  const candidates = declaredAborts(runbook).filter((abort) =>
    checkpointIds.some((id) => mentionsCheckpoint(abort.on, id))
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** `aborts:` lives in the raw frontmatter — no packet models it as a field yet. */
function declaredAborts(runbook: Runbook): RunbookAbort[] {
  const raw = (runbook.frontmatter ?? {})['aborts'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is { id: string; on: string } => {
      const e = entry as { id?: unknown; on?: unknown };
      return typeof e?.id === 'string' && !!e.id && typeof e?.on === 'string' && !!e.on;
    })
    .map((entry) => ({ id: entry.id, on: entry.on.replace(/\s+/g, ' ').trim() }));
}

/** Whole-id match: `cp.backup` must not match `cp.backup-verify`. */
function mentionsCheckpoint(text: string, checkpointId: string): boolean {
  const escaped = checkpointId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.-])${escaped}([^\\w.-]|$)`).test(text);
}

export interface AbortObservation {
  run: ProcedureRun;
  runbook: Runbook;
  ledger: Ledger;
  core?: IntelligenceCore;
}

/**
 * Fold this run's abort paths into incidents, and close the ones a later
 * success cleared.
 *
 * Called once per armed turn from the seam that folds the cursor, so it sees
 * the SAME slice `foldProcedureCursor` sees (`runEvents`) — a second query
 * built beside it is how a reader and a fold start disagreeing about what a run
 * contains (WP-26's note). Idempotence therefore matters more here than
 * anywhere else in this file: the failing outcome stays in the run's events for
 * the rest of the session, so the `causation` gate is what stops one halt from
 * becoming one incident per turn.
 */
export function recordAbortIncidents(args: AbortObservation): number {
  try {
    const core = args.core ?? getIntelligenceCore();
    if (!core || !args?.run || !args?.runbook || !args?.ledger) return 0;

    let events: EventEnvelope[];
    try {
      events = runEvents(args.run, args.ledger);
    } catch {
      return 0; // an unreadable run is not an aborted run
    }

    const toolOfAction = new Map<string, string>();
    for (const event of events) {
      if (event?.topic !== ACTION_TOPIC) continue;
      const tool = stringField(event.payload, 'tool');
      if (tool) toolOfAction.set(event.id, tool);
    }

    /** Per-entity history, read once and kept current as we emit. */
    const histories = new Map<string, IncidentHistory | undefined>();
    const historyFor = (entityId: string): IncidentHistory | undefined => {
      if (!histories.has(entityId)) histories.set(entityId, incidentHistory(core, entityId));
      return histories.get(entityId);
    };

    let written = 0;

    // Oldest first (runEvents sorts by ULID): a failure followed by a
    // successful retry must record the halt AND then close it, in that order.
    for (const event of events) {
      if (event?.topic !== OUTCOME_TOPIC) continue;
      const result = stringField(event.payload, 'result');
      if (result !== 'success' && result !== 'failure') continue;

      const tool =
        stringField(event.payload, 'tool') ??
        (event.causation ? toolOfAction.get(event.causation) : undefined);
      if (!tool) continue;
      const abort = abortForTool(args.runbook, tool);
      if (!abort) continue;

      const refs = entityOf(event);
      const anchor = refs?.site ?? refs?.environment;
      if (!refs || !anchor) continue;

      const observedAt = isoOrUndefined(event.observed_at);
      if (!observedAt) continue; // rule 1

      const history = historyFor(anchor);
      if (!history) continue;
      const key = incidentKey(SITE_LEVEL, abort.id);

      if (result === 'failure') {
        // Two gates. The causing record can only ever produce one incident, and
        // an already-open halt is not news.
        if (history.causes.has(event.id)) continue;
        if (history.open.has(key)) continue;
        const payload: IncidentPayload = {
          ...componentField(SITE_LEVEL),
          fact: abort.id,
          symptom: abort.on,
          resolved: false,
          source: `abort:${event.correlation ?? args.run.taskIds[0] ?? 'unknown'}/${abort.id}`,
        };
        const emitted = emitIncident(core, {
          observedAt,
          entity: refs,
          actor: actorOf(event),
          system: ABORT_SYSTEM,
          correlation: event.correlation,
          causation: event.id,
          payload,
        });
        if (!emitted) continue;
        history.causes.add(event.id);
        history.open.set(key, emitted);
        history.payloads.set(key, payload);
        written++;
        continue;
      }

      // A success on the same capability and the same site closes the halt —
      // P3's "a later run … completes", which a same-run retry also satisfies.
      const openId = history.open.get(key);
      if (!openId) continue;
      const emitted = emitIncident(core, {
        observedAt,
        entity: refs,
        actor: actorOf(event),
        system: ABORT_SYSTEM,
        correlation: event.correlation,
        causation: openId,
        payload: {
          ...history.payloads.get(key)!,
          resolved: true,
          resolved_at: observedAt,
        },
      });
      if (!emitted) continue;
      history.open.delete(key);
      // The failure that opened it must not re-open it on the next turn.
      written++;
    }

    if (written > 0) core.scheduleFolds();
    return written;
  } catch {
    return 0; // rule 5
  }
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** A site-level incident, where no component is named. P2's own wording. */
const SITE_LEVEL = 'site';

/**
 * The `component` field, or nothing at all when the incident is site-level.
 *
 * ONE place decides this, because two producers writing the same topic must not
 * disagree about when the field is present — and because the alternative
 * (`component: 'site'`) is what the gate ruled out.
 */
function componentField(component: string): { component?: string } {
  return component === SITE_LEVEL ? {} : { component };
}

/**
 * The dedup key's separator.
 *
 * This was a literal NUL character until the gate review — which worked
 * (nothing may contain it) and made the whole FILE read as binary to grep, so
 * `grep -n component incidentProducer.ts` printed "Binary file matches" and
 * nothing else. An invisible control character in source is unreadable,
 * unsearchable and changes tooling behaviour for every later reader. A pipe
 * cannot appear in a component slug or a finding class either, and it can be
 * seen.
 */
const KEY_SEPARATOR = '|';

function incidentKey(component: string, fact: string): string {
  return `${component}${KEY_SEPARATOR}${fact}`;
}

function factOfKey(key: string): string {
  return key.slice(key.indexOf(KEY_SEPARATOR) + 1);
}

interface IncidentHistory {
  /** Open (component, class) → the event id that opened it. */
  open: Map<string, string>;
  /** The payload each open incident carried, so an amendment restates it. */
  payloads: Map<string, IncidentPayload>;
  /** Every record already folded into an incident — the idempotency key. */
  causes: Set<string>;
}

/**
 * What this site's incident history already says. ONE ledger read per entity.
 *
 * Newest-first, first occurrence per key wins: a resolution supersedes the
 * incident it closes, so the newest event for a key IS the current state. This
 * is a read of the append-only record, not of a twin — see rule 4.
 */
function incidentHistory(core: IntelligenceCore, entityId: string): IncidentHistory | undefined {
  const history: IncidentHistory = { open: new Map(), payloads: new Map(), causes: new Set() };
  let events: EventEnvelope[] = [];
  try {
    events = core.ledger.query({
      entityId,
      topicPrefix: INCIDENT_TOPIC,
      order: 'desc',
      limit: INCIDENT_READ_LIMIT,
    });
  } catch {
    // An unreadable ledger must NOT read as an empty history. Empty means
    // "nothing is open", which is the one interpretation that re-emits
    // everything this site already has — so the producer records nothing this
    // round and the caller skips the site. Fail closed, like the cursor's fold.
    return undefined;
  }

  const seen = new Set<string>();
  for (const event of events) {
    if (event.causation) history.causes.add(event.causation);
    const payload = (event.payload ?? {}) as IncidentPayload;
    const component = typeof payload.component === 'string' ? payload.component : SITE_LEVEL;
    const fact = typeof payload.fact === 'string' ? payload.fact : undefined;
    if (!fact) continue;
    const key = incidentKey(component, fact);
    if (seen.has(key)) continue;
    seen.add(key);
    if (payload.resolved === true) continue; // closed: not open, and not repeatable
    history.open.set(key, event.id);
    history.payloads.set(key, openPayloadOf(payload));
  }
  return history;
}

/** The fields an amendment restates, so the closing event still says WHAT closed. */
function openPayloadOf(payload: IncidentPayload): IncidentPayload {
  return {
    ...componentField(payload.component ?? SITE_LEVEL),
    fact: payload.fact,
    ...(payload.symptom ? { symptom: payload.symptom } : {}),
    ...(payload.from_version ? { from_version: payload.from_version } : {}),
    ...(payload.to_version ? { to_version: payload.to_version } : {}),
    ...(payload.correlate ? { correlate: payload.correlate } : {}),
    resolved: false,
  };
}

interface EmitArgs {
  observedAt: string;
  entity: Record<string, string>;
  actor: { id: string; kind: 'human' | 'agent' | 'ability' | 'system' };
  system: string;
  correlation?: string;
  causation?: string;
  payload: IncidentPayload;
}

/** One emission, wrapped: a rejected envelope costs the record, never the caller. */
function emitIncident(core: IntelligenceCore, args: EmitArgs): string | undefined {
  try {
    const event = core.emitter.emit({
      observed_at: args.observedAt,
      topic: INCIDENT_TOPIC,
      schema: INCIDENT_SCHEMA,
      entity: args.entity,
      actor: args.actor,
      // An incident is a record OF WORK the platform did (a scan, a run), not a
      // live reading of the site — `work` / `emitted`, the same provenance the
      // fixture's planted history has always carried.
      source: { class: 'work', system: args.system, trust: 'emitted' },
      ...(args.correlation ? { correlation: args.correlation } : {}),
      ...(args.causation ? { causation: args.causation } : {}),
      payload: args.payload,
    });
    return event.id;
  } catch {
    return undefined;
  }
}

function atOrAboveFloor(severity: unknown): boolean {
  const index = SEVERITY_ORDER.indexOf(severity as Severity);
  if (index < 0) return false; // an unknown severity is not a known-high one
  return index >= SEVERITY_ORDER.indexOf(SEVERITY_FLOOR);
}

/** The entity refs an event was stamped with — adopted, never rebuilt. */
function entityOf(event: EventEnvelope): Record<string, string> | undefined {
  const entity = event.entity;
  if (!entity || typeof entity !== 'object') return undefined;
  return Object.keys(entity).length > 0 ? { ...entity } : undefined;
}

/** The actor the aborting act carried, so the incident names who was acting. */
function actorOf(event: EventEnvelope): { id: string; kind: 'human' | 'agent' | 'ability' | 'system' } {
  const actor = event.actor;
  return actor?.id && actor?.kind ? { id: actor.id, kind: actor.kind } : { id: 'act_unknown_caller', kind: 'system' };
}

function stringField(payload: unknown, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * A real source timestamp, or nothing. Epoch ms and ISO both arrive here —
 * `AgentResult.finishedAt` is ms, an envelope's `observed_at` is ISO — and
 * anything else yields `undefined`, which every caller turns into "no event".
 */
function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return undefined;
}
