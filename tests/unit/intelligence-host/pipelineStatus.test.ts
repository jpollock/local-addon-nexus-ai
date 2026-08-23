/**
 * The pipeline status report — the table that took hand-written Python over
 * four stores this morning, always available.
 *
 * Reads only what the producer wrote: twin facts for current status, the
 * ledger for 24h history and failure reasons. Sites the caller lists that
 * have NO fact are reported as `never` — absence is a state, not a blank
 * (the WP-67 copy ruling, applied to coverage).
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, type IntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { recordPipelineRun } from '../../../src/main/intelligence-host/pipelineRunProducer';
import { buildPipelineStatusReport } from '../../../src/main/intelligence-host/pipelineStatus';
import { catchUp } from '../../../src/intelligence';

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-status-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
}

const NOW = Date.now();

function run(
  core: IntelligenceCore,
  site: { kind: 'local'; localSiteId: string } | { kind: 'wpe' | 'external'; graphRowId: string },
  layer: 'l2' | 'l3',
  outcome: 'ok' | 'skip' | 'fail',
  opts: { reason?: string; agoMs?: number } = {},
) {
  const finishedAt = NOW - (opts.agoMs ?? 60_000);
  recordPipelineRun(
    {
      layer, outcome, trigger: 'scheduled',
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      startedAt: finishedAt - 5_000, finishedAt, site,
    },
    core,
  );
  for (const fold of core.folds) catchUp(core.ledger, fold);
}

const SITES = [
  { name: 'jeremypollockblog', ref: { kind: 'local' as const, localSiteId: 'L1' } },
  { name: 'dbrains', ref: { kind: 'wpe' as const, graphRowId: 'wpe-a' } },
  { name: 'jpmeautoscale', ref: { kind: 'wpe' as const, graphRowId: 'wpe-b' } },
  { name: 'willowcreekderm', ref: { kind: 'external' as const, graphRowId: 'ssh:w/w' } },
];

describe('buildPipelineStatusReport', () => {
  test('aggregates latest status per source and layer, with never as its own state', () => {
    const core = makeCore();
    run(core, SITES[0].ref, 'l3', 'ok');
    run(core, SITES[1].ref, 'l3', 'ok');
    run(core, SITES[2].ref, 'l3', 'fail', { reason: 'ssh: Could not resolve hostname' });
    // willowcreekderm: no runs at all → never

    const report = buildPipelineStatusReport(core, SITES);

    const wpe = report.sources.find((s) => s.kind === 'wpe')!;
    expect(wpe.total).toBe(2);
    expect(wpe.layers.l3).toMatchObject({ ok: 1, fail: 1, skip: 0, never: 0 });

    const ext = report.sources.find((s) => s.kind === 'external')!;
    expect(ext.layers.l3).toMatchObject({ ok: 0, fail: 0, skip: 0, never: 1 });

    const local = report.sources.find((s) => s.kind === 'local')!;
    expect(local.layers.l3.ok).toBe(1);
    expect(local.layers.l2.never).toBe(1); // no L2 run recorded for it
  });

  test('failures are listed with site name, layer, reason and age — actionable, not a count', () => {
    const core = makeCore();
    run(core, SITES[2].ref, 'l3', 'fail', { reason: 'ssh: Could not resolve hostname' });
    run(core, SITES[0].ref, 'l2', 'fail', { reason: 'MySQL not available' });

    const report = buildPipelineStatusReport(core, SITES);

    expect(report.failures).toHaveLength(2);
    const byName = Object.fromEntries(report.failures.map((f) => [f.siteName, f]));
    expect(byName['jpmeautoscale']).toMatchObject({
      kind: 'wpe', layer: 'l3', reason: 'ssh: Could not resolve hostname',
    });
    expect(byName['jeremypollockblog'].layer).toBe('l2');
  });

  test('a site that failed then succeeded is ok — and not listed as a failure', () => {
    const core = makeCore();
    run(core, SITES[1].ref, 'l3', 'fail', { reason: 'x', agoMs: 7_200_000 });
    run(core, SITES[1].ref, 'l3', 'ok', { agoMs: 60_000 });

    const report = buildPipelineStatusReport(core, SITES);

    expect(report.sources.find((s) => s.kind === 'wpe')!.layers.l3.ok).toBe(1);
    expect(report.failures.find((f) => f.siteName === 'dbrains')).toBeUndefined();
  });

  test('history counts the last 24h of runs from the ledger — rates, not just latest', () => {
    const core = makeCore();
    run(core, SITES[1].ref, 'l3', 'fail', { reason: 'x', agoMs: 3_600_000 });
    run(core, SITES[1].ref, 'l3', 'ok', { agoMs: 60_000 });
    run(core, SITES[0].ref, 'l3', 'skip', { reason: 'not running', agoMs: 60_000 });
    // Older than the window — excluded.
    run(core, SITES[3].ref, 'l3', 'ok', { agoMs: 25 * 3_600_000 });

    const report = buildPipelineStatusReport(core, SITES);

    expect(report.history24h).toEqual({ runs: 3, ok: 1, skip: 1, fail: 1 });
  });

  test('staleness: a fact older than 24h counts as stale, not fresh', () => {
    const core = makeCore();
    run(core, SITES[1].ref, 'l3', 'ok', { agoMs: 30 * 3_600_000 });
    run(core, SITES[2].ref, 'l3', 'ok', { agoMs: 60_000 });

    const report = buildPipelineStatusReport(core, SITES);

    const wpe = report.sources.find((s) => s.kind === 'wpe')!;
    expect(wpe.layers.l3.ok).toBe(2);
    expect(wpe.layers.l3.fresh24h).toBe(1);
  });
});
