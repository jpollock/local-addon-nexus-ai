/**
 * WP-17 · The health surface, measured against a REAL core.
 *
 * Everything here runs through `initIntelligenceCore` on a temp dir with a
 * real ledger and real emissions — the layer-2 rule: a health check tested
 * against a hand-built fake of the thing it reads pins nothing about the
 * thing it reads. Ages are exercised by moving `now` forward, never by
 * writing to `events` (the append-only rule holds in fixtures too).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import {
  collectIntelligenceHealth,
  formatHealthLogLine,
  FOLD_LAG_SLO_EVENTS,
  PRODUCER_LIVENESS_SLOS,
} from '../health';
import { provisionalEnvironmentId } from '../provisionalEntity';

const DAY = 24 * 3600 * 1000;

function makeCore(): { core: IntelligenceCore; kv: Map<string, unknown>; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-health-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  return { core, kv, dir };
}

function lineFor(report: ReturnType<typeof collectIntelligenceHealth>, key: string) {
  const line = report.lines.find((l) => l.key === key);
  if (!line) throw new Error(`no health line "${key}" in: ${report.lines.map((l) => l.key)}`);
  return line;
}

/** A real webhook observation — the wp-webhook producer's own path. */
function tapPlugin(core: IntelligenceCore, siteId: string, version: string): void {
  core.tap(siteId, 'plugin_updated', {
    slug: 'woocommerce',
    name: 'WooCommerce',
    version,
    is_active: true,
  });
}

describe('producer liveness', () => {
  test('a producer that emitted just now is OK; the same ledger read past its SLO is STALE', () => {
    const { core } = makeCore();
    tapPlugin(core, 'site-a', '9.9.1');
    const now = new Date();

    const fresh = collectIntelligenceHealth({ core, now });
    expect(lineFor(fresh, 'producer:wp-webhook').verdict).toBe('OK');
    expect(lineFor(fresh, 'producer:wp-webhook').value).toMatch(/last seen/);
    expect(fresh.worst).toBe('OK');

    // Nothing new for four days — past the 3-day in-site-events SLO.
    const later = collectIntelligenceHealth({ core, now: new Date(now.getTime() + 4 * DAY) });
    const line = lineFor(later, 'producer:wp-webhook');
    expect(line.verdict).toBe('STALE');
    expect(line.value).toBe('last seen 4d ago');
    expect(line.threshold).toBe('within 3d');
    expect(later.worst).toBe('STALE');

    core.close();
  });

  test('a producer that never emitted reads DARK but does NOT make the whole layer read dark', () => {
    const { core } = makeCore();
    tapPlugin(core, 'site-a', '9.9.1'); // something is recording; WPE never has

    const report = collectIntelligenceHealth({ core, now: new Date() });
    const wpe = lineFor(report, 'producer:graph-sync:wpe');
    expect(wpe.verdict).toBe('DARK');
    expect(wpe.value).toBe('nothing yet');
    expect(wpe.detail).toMatch(/not in use on this machine/);
    // The point: a machine with no WP Engine account must not summarise as
    // dark forever, or the summary is noise and gets ignored.
    expect(report.worst).toBe('OK');

    core.close();
  });

  test('liveness is measured from recorded_at, not observed_at — a backfill of old facts is alive', () => {
    const { core } = makeCore();
    const now = new Date();
    // observed_at 200 days old (a legitimate backfill shape), recorded now.
    core.emitter.emit({
      observed_at: new Date(now.getTime() - 200 * DAY).toISOString(),
      topic: 'state.site.observed',
      schema: 'site.observed/1',
      entity: { environment: provisionalEnvironmentId('site-old') },
      actor: { id: 'act_graph_sync', kind: 'system' },
      source: { class: 'platform', system: 'graph-sync:wpe', trust: 'observed' },
      payload: { name: 'old', domain: 'old.test' },
    });

    const report = collectIntelligenceHealth({ core, now });
    // Reading observed_at here would report a 200-day-dead producer.
    expect(lineFor(report, 'producer:graph-sync:wpe').verdict).toBe('OK');

    core.close();
  });

  test('a producer with no liveness expectation is listed, not silently dropped', () => {
    const { core } = makeCore();
    core.emitter.emit({
      observed_at: new Date().toISOString(),
      topic: 'state.site.observed',
      schema: 'site.observed/1',
      entity: { environment: provisionalEnvironmentId('site-b') },
      actor: { id: 'act_graph_backfill', kind: 'system' },
      source: { class: 'platform', system: 'graph-backfill', trust: 'observed' },
      payload: { name: 'b' },
    });

    const report = collectIntelligenceHealth({ core, now: new Date() });
    const line = lineFor(report, 'producers:unlisted');
    expect(line.value).toContain('graph-backfill');
    expect(line.verdict).toBe('OK'); // unmonitored is not a fault

    core.close();
  });

  test('the assembler line IS the last-manifest age', () => {
    const { core } = makeCore();
    const now = new Date();
    core.emitter.emit({
      observed_at: now.toISOString(),
      topic: 'task.context.assembled',
      schema: 'context.assembled/1',
      entity: { environment: provisionalEnvironmentId('site-c') },
      actor: { id: 'act_chat_assembler', kind: 'system' },
      source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
      payload: { assembled_at: now.toISOString() },
    });

    const sameDay = collectIntelligenceHealth({ core, now });
    expect(lineFor(sameDay, 'producer:assembler:chat').verdict).toBe('OK');

    const eightDays = collectIntelligenceHealth({ core, now: new Date(now.getTime() + 8 * DAY) });
    expect(lineFor(eightDays, 'producer:assembler:chat').verdict).toBe('STALE');
    expect(lineFor(eightDays, 'producer:assembler:chat').threshold).toBe('within 7d');

    core.close();
  });
});

describe('whole-ledger signal', () => {
  test('a core that started but has recorded nothing says so', () => {
    const { core } = makeCore();
    const report = collectIntelligenceHealth({ core, now: new Date() });
    const line = lineFor(report, 'ledger');
    expect(line.value).toBe('0 event(s)');
    expect(line.verdict).toBe('STALE');
    expect(line.detail).toMatch(/nothing has been recorded yet/);
    expect(report.worst).toBe('STALE');
    core.close();
  });

  test('once events exist the ledger line is OK and counts them', () => {
    const { core } = makeCore();
    tapPlugin(core, 'site-a', '9.9.1');
    tapPlugin(core, 'site-b', '9.9.2');
    const report = collectIntelligenceHealth({ core, now: new Date() });
    expect(lineFor(report, 'ledger').value).toBe('2 event(s)');
    expect(lineFor(report, 'ledger').verdict).toBe('OK');
    core.close();
  });
});

describe('fold lag', () => {
  test('after the fold drains, nothing is waiting', async () => {
    const { core } = makeCore();
    tapPlugin(core, 'site-a', '9.9.1');
    await new Promise((r) => setTimeout(r, 700)); // the real debounced catch-up

    const line = lineFor(collectIntelligenceHealth({ core, now: new Date() }), 'fold:state-twin/1');
    expect(line.value).toBe('0 waiting');
    expect(line.verdict).toBe('OK');
    core.close();
  });

  test('lag is measured against the WIRED folds, so a newly wired fold is monitored the same day', () => {
    const { core } = makeCore();
    core.folds.push({ name: 'made-up/1', topicPrefix: 'state.', apply: () => {} });
    tapPlugin(core, 'site-a', '9.9.1'); // one state.* event, no cursor for the new fold

    const report = collectIntelligenceHealth({ core, now: new Date() });
    const line = lineFor(report, 'fold:made-up/1');
    expect(line.value).toBe('1 waiting');
    // Under one batch with no cursor: a debounce race, not a stuck fold —
    // a verdict that flaps every 500ms is a verdict nobody trusts.
    expect(line.verdict).toBe('OK');
    expect(line.detail).toMatch(/has not processed anything yet/);
    core.close();
  });

  test('past one whole batch with no cursor, the fold is DARK', () => {
    const { core } = makeCore();
    core.folds.push({ name: 'stuck/1', topicPrefix: 'state.', apply: () => {} });
    for (let i = 0; i <= FOLD_LAG_SLO_EVENTS; i++) tapPlugin(core, `site-${i}`, `9.${i}.0`);

    const line = lineFor(collectIntelligenceHealth({ core, now: new Date() }), 'fold:stuck/1');
    expect(line.verdict).toBe('DARK');
    expect(collectIntelligenceHealth({ core, now: new Date() }).worst).toBe('DARK');
    core.close();
  });
});

describe('mirror, identity and the core line', () => {
  test('the permission mirror reports its divergence count', () => {
    const { core } = makeCore();
    expect(core.law).toBeDefined();
    const line = lineFor(collectIntelligenceHealth({ core, now: new Date() }), 'mirror');
    expect(line.value).toBe('no differences');
    expect(line.verdict).toBe('OK');
    core.close();
  });

  test('the entity service is reported present on a healthy core', () => {
    const { core } = makeCore();
    const line = lineFor(collectIntelligenceHealth({ core, now: new Date() }), 'entities');
    expect(line.value).toBe('available');
    expect(line.verdict).toBe('OK');
    core.close();
  });

  test('with no core, the report is one honest line and nothing invented', () => {
    const report = collectIntelligenceHealth({ core: undefined, initState: {}, now: new Date() });
    expect(report.coreUp).toBe(false);
    expect(report.worst).toBe('DARK');
    expect(report.lines).toHaveLength(1);
    expect(lineFor(report, 'core').value).toBe('not started');
    // No fabricated producer ages, no fabricated fold lag.
    expect(report.lines.some((l) => l.key.startsWith('producer:'))).toBe(false);
  });

  test('a failure recorded by an EARLIER boot is named by a later, successful one', () => {
    const report = collectIntelligenceHealth({
      core: { folds: [], ledger: { raw: () => { throw new Error('unused'); } } } as never,
      initState: {
        last_failure: {
          at: new Date(Date.now() - 2 * DAY).toISOString(),
          stage: 'core',
          message: 'NODE_MODULE_VERSION 146 vs 141',
        },
        last_success_at: new Date().toISOString(),
      },
      now: new Date(),
    });
    const line = lineFor(report, 'core');
    expect(line.verdict).toBe('OK'); // this boot is up
    expect(line.detail).toContain('NODE_MODULE_VERSION 146 vs 141');
    expect(line.detail).toContain('2d ago'); // history, dated — not a live alarm
  });
});

describe('the check itself', () => {
  test('a ledger that throws mid-check degrades to a named error, never an exception', () => {
    const { core } = makeCore();
    const broken = {
      ...core,
      ledger: {
        raw: () => {
          throw new Error('database disk image is malformed');
        },
      },
    } as never as IntelligenceCore;

    const report = collectIntelligenceHealth({ core: broken, now: new Date() });
    expect(report.errors.join(' ')).toMatch(/malformed/);
    // Unmeasured is stated, never silently dropped as if it had passed.
    expect(report.errors.length).toBeGreaterThan(0);
    core.close();
  });

  test('the startup log line carries every verdict and is grep-able', () => {
    const { core } = makeCore();
    tapPlugin(core, 'site-a', '9.9.1');
    const line = formatHealthLogLine(collectIntelligenceHealth({ core, now: new Date() }));
    expect(line).toMatch(/^\[Intelligence] health: (OK|STALE|DARK) — /);
    expect(line).toContain('core=OK(ready)');
    expect(line).toContain('producer:wp-webhook=OK(');
    core.close();
  });

  test('every producer in the SLO table gets a line, and each line carries value + threshold + verdict', () => {
    const { core } = makeCore();
    const report = collectIntelligenceHealth({ core, now: new Date() });
    for (const slo of PRODUCER_LIVENESS_SLOS) {
      const line = lineFor(report, `producer:${slo.system}`);
      expect(line.label).toBe(slo.label);
      expect(line.value).toBeTruthy();
      expect(line.threshold).toBeTruthy();
      expect(['OK', 'STALE', 'DARK']).toContain(line.verdict);
    }
    core.close();
  });
});
