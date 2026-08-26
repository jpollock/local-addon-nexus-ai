/**
 * fixes-082526 · the observability pull-forward, UI half.
 *
 * The finding: `nexus pipeline status` knew, the log and the UI didn't. The
 * log line landed at the recordPipelineRun chokepoint; this is the data the
 * Settings surface renders — one compact 24h rollup plus when work last
 * finished, read from the same ledger the CLI reads, so the two can never
 * disagree.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { buildPipelineActivity } from '../pipelineStatus';
import { recordPipelineRun } from '../pipelineRunProducer';

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-act-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
}

const run = (finishedAt: number, outcome: 'ok' | 'skip' | 'fail', core: IntelligenceCore) =>
  recordPipelineRun(
    {
      layer: 'l3', trigger: 'scheduled', outcome,
      ...(outcome === 'ok' ? {} : { reason: 'r' }),
      startedAt: finishedAt - 5_000, finishedAt,
      site: { kind: 'local', localSiteId: 'abc' },
    },
    core,
  );

describe('buildPipelineActivity', () => {
  let core: IntelligenceCore;
  afterEach(() => core.close());

  it('counts the last 24 hours and reports the latest finish', () => {
    core = makeCore();
    const now = Date.now();
    run(now - 3600_000, 'ok', core);
    run(now - 1800_000, 'skip', core);
    run(now - 600_000, 'fail', core);
    const a = buildPipelineActivity(core, now);
    expect(a).toMatchObject({ runs: 3, ok: 1, skip: 1, fail: 1 });
    expect(a.lastFinishedAt).toBe(new Date(now - 600_000).toISOString());
  });

  it('a run older than 24h is outside the window but still the latest finish if nothing newer ran', () => {
    core = makeCore();
    const now = Date.now();
    run(now - 30 * 3600_000, 'ok', core);
    const a = buildPipelineActivity(core, now);
    expect(a.runs).toBe(0);
    // "when did work LAST finish" is a different question from "how much in
    // 24h" — collapsing them would render "no runs" with no way to tell
    // idle-since-yesterday from never-ran.
    expect(a.lastFinishedAt).toBe(new Date(now - 30 * 3600_000).toISOString());
  });

  it('an empty ledger: zero runs, null lastFinishedAt — never a fabricated time', () => {
    core = makeCore();
    const a = buildPipelineActivity(core, Date.now());
    expect(a).toMatchObject({ runs: 0, ok: 0, skip: 0, fail: 0, lastFinishedAt: null });
  });
});
