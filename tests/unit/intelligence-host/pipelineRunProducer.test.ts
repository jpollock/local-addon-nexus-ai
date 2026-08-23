/**
 * The pipeline-run producer: one function every L1/L2/L3 chokepoint calls
 * after its outcome is decided.
 *
 * Non-fatal by construction (a recorder failure must never fail the run it
 * records), entity ids adopted rather than minted (ADR-21), observed_at is the
 * run's FINISH moment, and every run emits — no change gate, because two
 * identical runs are two runs and success rates are the point.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, type IntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { recordPipelineRun } from '../../../src/main/intelligence-host/pipelineRunProducer';
import { environmentEntityId } from '../../../src/main/intelligence-host/provisionalEntity';
import { catchUp } from '../../../src/intelligence';

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-pipe-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
}

const FINISHED = Date.parse('2026-08-23T18:30:00.000Z');

function obs(over: Record<string, unknown> = {}) {
  return {
    layer: 'l3' as const,
    trigger: 'scheduled' as const,
    outcome: 'ok' as const,
    startedAt: FINISHED - 42_000,
    finishedAt: FINISHED,
    site: { kind: 'wpe' as const, graphRowId: 'wpe-abc-123' },
    ...over,
  };
}

function drainFolds(core: IntelligenceCore): void {
  for (const fold of core.folds) catchUp(core.ledger, fold);
}

describe('recordPipelineRun', () => {
  test('emits task.run.completed with the pipeline.run/1 contract, and it folds', () => {
    const core = makeCore();

    recordPipelineRun(obs({ outcome: 'fail', reason: 'ssh: Connection refused' }), core);

    const events = core.ledger.query({ topicPrefix: 'task.run.' });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.topic).toBe('task.run.completed');
    expect(e.schema).toBe('pipeline.run/1');
    expect(e.observed_at).toBe('2026-08-23T18:30:00.000Z'); // finish moment, never "now"
    expect(e.source).toEqual({ class: 'platform', system: 'pipeline:wpe-ssh', trust: 'observed' });
    expect(e.payload).toEqual({
      layer: 'l3',
      site_kind: 'wpe',
      outcome: 'fail',
      trigger: 'scheduled',
      duration_ms: 42_000,
      reason: 'ssh: Connection refused',
    });

    drainFolds(core);
    const fact = core.twins.get(e.entity.environment!, 'pipeline:l3');
    expect((fact?.value as any).outcome).toBe('fail');
  });

  test('a local site resolves to the same env entity every other producer uses', () => {
    const core = makeCore();

    recordPipelineRun(obs({ site: { kind: 'local', localSiteId: 'Ck3bTFmxY' } }), core);

    const [e] = core.ledger.query({ topicPrefix: 'task.run.' });
    expect(e.entity.environment).toBe(environmentEntityId(core.entities, 'Ck3bTFmxY'));
  });

  test('a graph row ADOPTS an entity siteLinkMirror already aliased — never minted anew', () => {
    const core = makeCore();
    // siteLinkMirror's write: an env entity aliased under graph.site_row.
    const preexisting = core.entities!.ensure('env', 'wpe.install_id', 'uuid-1');
    core.entities!.addAlias(preexisting, 'graph.site_row', 'wpe-abc-123', 1.0, 'derivation');

    recordPipelineRun(obs(), core);

    const [e] = core.ledger.query({ topicPrefix: 'task.run.' });
    expect(e.entity.environment).toBe(preexisting);
  });

  test('an ok outcome carries no reason key at all', () => {
    const core = makeCore();

    recordPipelineRun(obs({ outcome: 'ok' }), core);

    const [e] = core.ledger.query({ topicPrefix: 'task.run.' });
    expect('reason' in e.payload).toBe(false);
  });

  test('two identical runs are two events — no change gate', () => {
    const core = makeCore();

    recordPipelineRun(obs(), core);
    recordPipelineRun(obs(), core);

    expect(core.ledger.query({ topicPrefix: 'task.run.' })).toHaveLength(2);
  });

  test('absent core is a silent no-op; a throwing emitter never propagates', () => {
    expect(() => recordPipelineRun(obs(), undefined)).not.toThrow();

    const core = makeCore();
    const broken = { ...core, emitter: { emit: () => { throw new Error('ledger locked'); } } };
    expect(() => recordPipelineRun(obs(), broken as never)).not.toThrow();
  });

  test('external sites are stamped pipeline:external-ssh', () => {
    const core = makeCore();

    recordPipelineRun(
      obs({ site: { kind: 'external', graphRowId: 'ssh:willowcreekderm/willowcreekderm' } }),
      core,
    );

    const [e] = core.ledger.query({ topicPrefix: 'task.run.' });
    expect(e.source.system).toBe('pipeline:external-ssh');
    expect((e.payload as any).site_kind).toBe('external');
  });
});
