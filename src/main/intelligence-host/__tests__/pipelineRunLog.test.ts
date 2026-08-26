/**
 * fixes-082526 · the observability pull-forward — a pipeline.run log line per
 * site run.
 *
 * The finding, verbatim from the CPU diagnosis: Local pegged a core for an
 * hour of L3 indexing, `nexus pipeline status` KNEW (the ledger records every
 * run), and the grep-able log carried zero bytes about it — the one surface a
 * person actually opens was the one surface with no signal. The CLI knowing
 * while the log doesn't is the gap.
 *
 * The fix hangs the line on the chokepoint every layer already calls
 * (`recordPipelineRun`), so all eight caller files are covered by one
 * emission. The line must be INDEPENDENT of the intelligence core: the log's
 * whole job is visibility when other layers are dark, so a down core must
 * not take the log line with it.
 */
import {
  recordPipelineRun,
  setPipelineRunEventLog,
} from '../pipelineRunProducer';
import type { LogEvent } from '../../logging/eventLog';

function capture() {
  const lines: LogEvent[] = [];
  return { lines, log: { write: (e: LogEvent) => { lines.push(e); return true; } } };
}

const run = (over: Record<string, unknown> = {}) => ({
  layer: 'l3' as const,
  trigger: 'scheduled' as const,
  outcome: 'ok' as const,
  startedAt: 1_000,
  finishedAt: 6_210,
  site: { kind: 'local' as const, localSiteId: 'abc123' },
  ...over,
});

describe('recordPipelineRun × the event log', () => {
  afterEach(() => setPipelineRunEventLog(undefined));

  it('one run → one pipeline.run line carrying layer, target, outcome, trigger, duration', () => {
    const { lines, log } = capture();
    setPipelineRunEventLog(log as never);
    recordPipelineRun(run()); // no core registered — the line must not need one
    expect(lines).toHaveLength(1);
    const e = lines[0];
    expect(e.event).toBe('pipeline.run');
    expect(e.source).toBe('pipeline');
    expect(e.level).toBe('INFO');
    expect(e.fields).toMatchObject({
      layer: 'l3', target: 'abc123', kind: 'local',
      outcome: 'ok', trigger: 'scheduled', duration_ms: 5_210,
    });
  });

  it('a failed run logs WARN and carries the reason — greppable by level', () => {
    const { lines, log } = capture();
    setPipelineRunEventLog(log as never);
    recordPipelineRun(run({ outcome: 'fail', reason: 'SSH resolve failed' }));
    expect(lines[0].level).toBe('WARN');
    expect(lines[0].fields).toMatchObject({ outcome: 'fail', reason: 'SSH resolve failed' });
  });

  it('a graph-row site logs its row id as the target', () => {
    const { lines, log } = capture();
    setPipelineRunEventLog(log as never);
    recordPipelineRun(run({ site: { kind: 'external', graphRowId: 'ssh:host/site' } }));
    expect(lines[0].fields).toMatchObject({ target: 'ssh:host/site', kind: 'external' });
  });

  it('no log registered → records without throwing (startup order must not matter)', () => {
    expect(() => recordPipelineRun(run())).not.toThrow();
  });

  it('a throwing log cannot fail the run it records', () => {
    setPipelineRunEventLog({ write: () => { throw new Error('disk full'); } } as never);
    expect(() => recordPipelineRun(run())).not.toThrow();
  });
});
