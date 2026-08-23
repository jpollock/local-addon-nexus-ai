/**
 * The pipeline status report — coverage, latest outcomes, failures with
 * reasons, and 24h run history, per source and layer (plan 2026-08-23).
 *
 * Read-only over what `pipelineRunProducer` wrote: twin facts
 * (`pipeline:<layer>`) for current status, the ledger for history. The caller
 * supplies the site population — the spine deliberately does not know which
 * sites exist (Local's store owns local, graph.db owns remote; see the fleet
 * counting rules in CLAUDE.md), so coverage is always measured against the
 * authoritative lists, never against "sites the ledger happens to mention".
 *
 * A site with no fact is `never`, its own state. Absence is reported with its
 * name attached, not folded into a denominator — the WP-67 copy ruling applied
 * to coverage.
 */
import type { IntelligenceCore } from './bootstrap';
import { pipelineEntityId, type PipelineSiteRef } from './pipelineRunProducer';
import { PIPELINE_RUN_SCHEMA } from '../../intelligence';

export interface PipelineStatusSiteInput {
  name: string;
  ref: PipelineSiteRef;
}

export interface LayerRollup {
  ok: number;
  skip: number;
  fail: number;
  /** No run has ever been recorded for this site × layer. */
  never: number;
  /** Of the ok/skip/fail above, how many finished within the last 24h. */
  fresh24h: number;
}

export interface PipelineFailure {
  siteName: string;
  kind: PipelineSiteRef['kind'];
  layer: string;
  reason: string;
  trigger: string;
  finishedAt: string;
}

export interface PipelineStatusReport {
  generatedAt: string;
  sources: Array<{
    kind: PipelineSiteRef['kind'];
    total: number;
    layers: { l2: LayerRollup; l3: LayerRollup };
  }>;
  /** Every site whose LATEST run on some layer failed, with the reason. */
  failures: PipelineFailure[];
  /** Run counts over the ledger's last 24 hours — rates, not just latest. */
  history24h: { runs: number; ok: number; skip: number; fail: number };
}

const DAY_MS = 24 * 3600_000;
const LAYERS = ['l2', 'l3'] as const;

export function buildPipelineStatusReport(
  core: IntelligenceCore,
  sites: PipelineStatusSiteInput[],
  now: number = Date.now(),
): PipelineStatusReport {
  const emptyRollup = (): LayerRollup => ({ ok: 0, skip: 0, fail: 0, never: 0, fresh24h: 0 });
  const byKind = new Map<
    PipelineSiteRef['kind'],
    { total: number; layers: { l2: LayerRollup; l3: LayerRollup } }
  >();
  const failures: PipelineFailure[] = [];

  for (const site of sites) {
    const kind = site.ref.kind;
    if (!byKind.has(kind)) byKind.set(kind, { total: 0, layers: { l2: emptyRollup(), l3: emptyRollup() } });
    const bucket = byKind.get(kind)!;
    bucket.total++;

    const entityId = pipelineEntityId(core, site.ref);
    for (const layer of LAYERS) {
      const fact = core.twins.get(entityId, `pipeline:${layer}`);
      const rollup = bucket.layers[layer];
      if (!fact) {
        rollup.never++;
        continue;
      }
      const value = fact.value as {
        outcome?: string; reason?: string; trigger?: string; finished_at?: string;
      };
      const outcome = value.outcome === 'ok' || value.outcome === 'skip' || value.outcome === 'fail'
        ? value.outcome
        : 'fail'; // an unreadable fact is not a success
      rollup[outcome]++;
      const finished = Date.parse(value.finished_at ?? fact.observedAt);
      if (Number.isFinite(finished) && now - finished <= DAY_MS) rollup.fresh24h++;

      if (outcome === 'fail') {
        failures.push({
          siteName: site.name,
          kind,
          layer,
          reason: value.reason ?? 'reason not recorded',
          trigger: value.trigger ?? 'unknown',
          finishedAt: value.finished_at ?? fact.observedAt,
        });
      }
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    sources: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })),
    failures: failures.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
    history24h: history24h(core, now),
  };
}

/**
 * Counts over the raw ledger, not the twins — the twins keep only the latest
 * run per site × layer, and a site that failed all night then succeeded once
 * looks clean there. Rates need every run.
 */
function history24h(core: IntelligenceCore, now: number): PipelineStatusReport['history24h'] {
  const out = { runs: 0, ok: 0, skip: 0, fail: 0 };
  try {
    const cutoff = new Date(now - DAY_MS).toISOString();
    // Page through the topic; the prefix index makes this cheap, and 24h of
    // pipeline runs is bounded by fleet size x schedule frequency.
    let afterId: string | undefined;
    for (;;) {
      const batch = core.ledger.query({ topicPrefix: 'task.run.', afterId, limit: 500 });
      if (batch.length === 0) break;
      for (const e of batch) {
        if (e.schema !== PIPELINE_RUN_SCHEMA) continue;
        if (e.observed_at < cutoff) continue;
        const outcome = (e.payload as { outcome?: string }).outcome;
        if (outcome !== 'ok' && outcome !== 'skip' && outcome !== 'fail') continue;
        out.runs++;
        out[outcome]++;
      }
      afterId = batch[batch.length - 1].id;
      if (batch.length < 500) break;
    }
  } catch {
    /* a history failure must not take down the status read; zeros are visibly wrong, not silently plausible */
  }
  return out;
}
