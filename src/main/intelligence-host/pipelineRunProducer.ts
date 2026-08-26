/**
 * Pipeline-run producer — the one function every data-pipeline chokepoint
 * calls after its outcome is decided (plan 2026-08-23).
 *
 * One call per L1/L2/L3 run over any site becomes one `task.run.completed`
 * event (schema `pipeline.run/1`), which `pipelineStatusFold` materializes
 * into `pipeline:<layer>` per site. The topic is already enumerated in
 * architecture.md §4.2; no taxonomy addition was needed.
 *
 * Rules, in the order they have bitten this codebase before:
 *
 * - **Recorded AFTER the outcome, never blocking it.** Same ordering as the
 *   WP-19 audit chokepoints: the recorder records, the run runs. Every path
 *   here is wrapped; a missing core is a silent no-op (init failure is
 *   non-fatal by design, coreRegistry contract).
 * - **`observed_at` is the run's FINISH moment** — when the outcome became
 *   true — never "now" at emission and never the start time. Same reasoning
 *   as syncProducer.
 * - **No change gate, deliberately** (syncProducer's justification verbatim):
 *   an episodic occurrence folds into no current-value comparison; two
 *   identical runs are two runs, and success *rates* — the reason this
 *   producer exists — are computed from their count.
 * - **Ids are adopted, never minted (ADR-21).** Local sites go through
 *   `environmentEntityId` (`local.site_id`), the namespace every other local
 *   producer stamps. Graph rows go through `ensure('env','graph.site_row',…)`
 *   — the namespace `siteLinkMirror` already aliases onto the real env
 *   entities, so a mirrored install resolves to its existing entity and only
 *   a never-seen row derives a provisional one (from the same pair, so the
 *   ids converge when the mirror catches up).
 */
import type { IntelligenceCore } from './bootstrap';
import type { LogEvent } from '../logging/eventLog';
import { getIntelligenceCore } from './coreRegistry';
import { environmentEntityId, provisionalEntityId } from './provisionalEntity';
import {
  PIPELINE_RUN_SCHEMA,
  type PipelineLayer,
  type PipelineOutcome,
  type PipelineTrigger,
} from '../../intelligence';

export type PipelineSiteRef =
  | { kind: 'local'; localSiteId: string }
  | { kind: 'wpe'; graphRowId: string }
  | { kind: 'external'; graphRowId: string };

export interface PipelineRunObservation {
  layer: PipelineLayer;
  trigger: PipelineTrigger;
  outcome: PipelineOutcome;
  /** Required when outcome is not 'ok' — WP-67's rule; omitted when 'ok'. */
  reason?: string;
  /** ms epoch. Duration is computed here so call sites cannot disagree on it. */
  startedAt: number;
  finishedAt: number;
  site: PipelineSiteRef;
}

/**
 * The structured event log, when startup has built one (fixes-082526, the
 * observability pull-forward). Registered from src/main/index.ts beside the
 * EventLog's own construction — a registry setter rather than a parameter
 * because eight caller files already invoke recordPipelineRun and none of
 * them should have to carry a log handle for it.
 *
 * Structural type, not the class: tests hand in a capture, and this module
 * needs exactly one method.
 */
let pipelineEventLog: { write(e: LogEvent): boolean } | undefined;

export function setPipelineRunEventLog(log: { write(e: LogEvent): boolean } | undefined): void {
  pipelineEventLog = log;
}

const SYSTEM: Record<PipelineSiteRef['kind'], string> = {
  local: 'pipeline:local',
  wpe: 'pipeline:wpe-ssh',
  external: 'pipeline:external-ssh',
};

/**
 * Record one pipeline run. Never throws; never blocks; safe to call from any
 * chokepoint. `coreOverride` exists for tests — production call sites pass
 * nothing and the registry supplies the core (or nothing, which is a no-op).
 */
export function recordPipelineRun(
  observation: PipelineRunObservation,
  coreOverride?: IntelligenceCore,
): void {
  // The grep-able log line, BEFORE the core check and in its own guard: the
  // log's whole job is visibility when other layers are dark, so a down
  // intelligence core must not take the line with it. This is the line that
  // was missing during the 2026-08-25 CPU diagnosis — an hour of L3 indexing
  // that `nexus pipeline status` knew about and the log carried zero bytes
  // of. `target` (not `site`) deliberately: it is the redaction layer's
  // identity field, so a site id is not masked as an opaque credential run.
  try {
    pipelineEventLog?.write({
      level: observation.outcome === 'fail' ? 'WARN' : 'INFO',
      source: 'pipeline',
      sourceKind: 'system',
      event: 'pipeline.run',
      fields: {
        layer: observation.layer,
        target: observation.site.kind === 'local' ? observation.site.localSiteId : observation.site.graphRowId,
        kind: observation.site.kind,
        outcome: observation.outcome,
        trigger: observation.trigger,
        duration_ms: Math.max(0, observation.finishedAt - observation.startedAt),
        ...(observation.reason !== undefined ? { reason: observation.reason } : {}),
      },
    });
  } catch {
    // A log failure must never fail the run it describes.
  }

  try {
    const core = coreOverride ?? getIntelligenceCore();
    if (!core) return;

    const environment = resolveEnvironment(core, observation.site);

    core.emitter.emit({
      observed_at: new Date(observation.finishedAt).toISOString(),
      topic: 'task.run.completed',
      schema: PIPELINE_RUN_SCHEMA,
      entity: { environment },
      actor: { id: 'act_pipeline', kind: 'system' },
      source: { class: 'platform', system: SYSTEM[observation.site.kind], trust: 'observed' },
      payload: {
        layer: observation.layer,
        site_kind: observation.site.kind,
        outcome: observation.outcome,
        trigger: observation.trigger,
        duration_ms: Math.max(0, observation.finishedAt - observation.startedAt),
        ...(observation.reason !== undefined ? { reason: observation.reason } : {}),
      },
    });
    core.scheduleFolds();
  } catch {
    // A recorder failure must never fail the run it records. The run's own
    // logging already carries the outcome; losing the observation is the
    // cheapest possible casualty here.
  }
}

/**
 * The entity a site's pipeline facts live on. Exported so the status reader
 * resolves the SAME id the producer stamped — two resolutions would be two
 * chances to disagree, and a disagreement here reads as "this site has never
 * run" (the D10 class of wrongness).
 */
export function pipelineEntityId(core: IntelligenceCore, site: PipelineSiteRef): string {
  return resolveEnvironment(core, site);
}

function resolveEnvironment(core: IntelligenceCore, site: PipelineSiteRef): string {
  if (site.kind === 'local') return environmentEntityId(core.entities, site.localSiteId);
  try {
    if (core.entities) return core.entities.ensure('env', 'graph.site_row', site.graphRowId);
  } catch {
    /* a faulty entity service must never break a producer */
  }
  // Registry down: the shared derivation over the same (namespace, value)
  // pair ensure() hashes — ids converge by construction when it returns.
  return provisionalEntityId('env', 'graph.site_row', site.graphRowId);
}
