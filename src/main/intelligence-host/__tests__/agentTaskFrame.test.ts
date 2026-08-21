/**
 * WP-57 · The agent task frame — the producer `task.run.*` never had.
 *
 * The assertions that earn their keep here are about IDENTITY and about
 * FABRICATION, because those are the two ways this frame could do damage:
 *
 *   - **Two agents must be two actors.** The defect this packet exists to
 *     close is `actionProducer`'s collapse of every agent-runtime call to one
 *     `act_agent_runtime` — measured at announce as 58 of 58 events. A frame
 *     that minted one id for all agents would reproduce the bug one layer up.
 *   - **`observed_at` is the RUN's moment, never the fold's.** A run whose
 *     completion comes back stamped "now" is the data laundering the layer's
 *     own invariant forbids, and a bracket event is exactly where it would go
 *     unnoticed — nothing else reads these times yet.
 *   - **Autonomy is derived from the TRIGGER.** ADR-7's justification is "a
 *     human is present to judge", which is a fact about why the run started,
 *     not about a ceremony setting. A frame reading `AgentAutonomy`
 *     ('suggest'|'ask'|'auto') would put a user preference in charge of a
 *     safety rule — the collision §A.2 of the design note names.
 *   - **Absent is not null.** `first_gated_act_at` is omitted, not undefined,
 *     when a run performed no gated act. Jest's `toEqual` treats those as the
 *     same (the WP-26 trap), so presence is asserted by key, not by value.
 *   - **Nothing here may throw into a run.** No core, a throwing emitter, a
 *     throwing close — each degrades to "unframed" and none reaches the caller.
 */
import { setIntelligenceCore } from '../coreRegistry';
import { normalizeProducerId } from '../sessionRegistry';
import {
  RUN_ASSIGNED_TOPIC,
  RUN_COMPLETED_TOPIC,
  RUN_ASSIGNED_SCHEMA,
  RUN_COMPLETED_SCHEMA,
  agentActorId,
  autonomyForTrigger,
  openAgentTask,
} from '../agentTaskFrame';

type Draft = Record<string, any>;

function fakeCore(onEmit?: (n: number) => void) {
  const emitted: Draft[] = [];
  const core = {
    emitter: {
      emit: (d: Draft) => {
        onEmit?.(emitted.length + 1);
        emitted.push(d);
        return { ...d, id: `evt_${emitted.length}` };
      },
    },
  } as never;
  setIntelligenceCore(core);
  return emitted;
}

describe('WP-57 · openAgentTask', () => {
  it('mints a distinct task per run and writes NOTHING until the run is real', () => {
    const emitted = fakeCore();

    const a = openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 1_000 });
    const b = openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 2_000 });

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.id).not.toEqual(b!.id);
    expect(a!.id).toMatch(/^task_/);
    // THE LAZINESS. auth-probe fires every two minutes; an eager frame would
    // write 1,440 events a day forever into a substrate that is never
    // compacted. Opening a frame is not an act.
    expect(emitted).toHaveLength(0);
    expect(a!.didEmit()).toBe(false);
  });

  it('flushes the bracket just-in-time when a correlation is actually needed', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 1_000 })!;

    const corr = frame.correlationId();

    expect(corr).toBe(frame.id);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].topic).toBe(RUN_ASSIGNED_TOPIC);
    expect(emitted[0].schema).toBe(RUN_ASSIGNED_SCHEMA);
    expect(emitted[0].correlation).toBe(frame.id);
    // Once, not per call — WP-51's `scanCorrelation` generalized.
    frame.correlationId();
    frame.correlationId();
    expect(emitted).toHaveLength(1);
  });

  it('withholds the correlation entirely when the bracket cannot be written', () => {
    // WP-51's rule: an id whose assignment was refused is not written
    // anywhere — it would satisfy the validator's regex and name nothing.
    setIntelligenceCore({
      emitter: { emit: () => { throw new Error('down'); } },
    } as never);
    // openAgentTask itself no longer emits, so the frame opens fine...
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 });
    expect(frame).toBeDefined();
    // ...and the refusal surfaces where it matters.
    expect(frame!.correlationId()).toBeUndefined();
    expect(frame!.didEmit()).toBe(false);
  });

  it('a gated act makes the run real, and the bracket precedes it', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;

    expect(emitted).toHaveLength(0);
    frame.noteGatedAct(500);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].topic).toBe(RUN_ASSIGNED_TOPIC);
    expect(frame.didEmit()).toBe(true);
  });

  it('names the agent in the actor, so two agents are two actors', () => {
    const emitted = fakeCore();

    openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 1 })!.correlationId();
    openAgentTask({ agentName: 'seo-insights', trigger: 'cron', startedAt: 1 })!.correlationId();

    expect(emitted.map((e) => e.actor.id)).toEqual([
      'act_security_sentinel',
      'act_seo_insights',
    ]);
    // The defect this closes: one id for every agent.
    expect(new Set(emitted.map((e) => e.actor.id)).size).toBe(2);
    expect(emitted[0].actor.kind).toBe('agent');
  });

  it('derives autonomy from the trigger, never from a setting', () => {
    const emitted = fakeCore();

    openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })!.correlationId();
    openAgentTask({ agentName: 'a', trigger: 'event', startedAt: 1 })!.correlationId();
    openAgentTask({ agentName: 'a', trigger: 'manual', startedAt: 1 })!.correlationId();

    expect(emitted.map((e) => e.payload.autonomy)).toEqual([
      'autonomous',
      'autonomous',
      'interactive',
    ]);
    // The rule stands alone, so a caller can ask without opening a frame.
    expect(autonomyForTrigger('cron')).toBe('autonomous');
    expect(autonomyForTrigger('manual')).toBe('interactive');
  });

  it('carries the run id when the runtime has one, and omits it otherwise', () => {
    const emitted = fakeCore();

    openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1, runId: 'r_abc' })!.correlationId();
    openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })!.correlationId();

    expect(emitted[0].payload.run_id).toBe('r_abc');
    expect(Object.keys(emitted[1].payload)).not.toContain('run_id');
  });

  it('stamps assigned with the run’s own start, never the clock', () => {
    const emitted = fakeCore();
    openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1_600_000_000_000 })!.correlationId();
    expect(emitted[0].observed_at).toBe(new Date(1_600_000_000_000).toISOString());
  });

  it('returns undefined and never throws when there is no core', () => {
    setIntelligenceCore(undefined as never);
    expect(() => openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).not.toThrow();
    expect(openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).toBeUndefined();
  });

  it('exposes the actor it minted, so callers need not re-derive it', () => {
    fakeCore();
    const frame = openAgentTask({ agentName: 'log-processor', trigger: 'event', startedAt: 1 })!;
    expect(frame.actor).toEqual({ id: 'act_log_processor', kind: 'agent' });
    expect(frame.autonomy).toBe('autonomous');
    expect(agentActorId('log-processor')).toBe('act_log_processor');
  });
});

describe('WP-57 · AgentTaskFrame.close', () => {
  it('writes NOTHING for a quiet successful run — the heartbeat refusal', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'auth-probe', trigger: 'cron', startedAt: 0 })!;

    frame.close({ status: 'success', finishedAt: 10, findings: 0 });

    // The measured case: auth-probe, every two minutes, finding nothing. An
    // eager frame writes 1,440 events a day here forever.
    expect(emitted).toHaveLength(0);
    expect(frame.didEmit()).toBe(false);
  });

  it('a non-success outcome makes the run real on its own', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;

    frame.close({ status: 'error', finishedAt: 10, error: 'boom' });

    // Both brackets, in order, even though nothing flushed during the run.
    expect(emitted.map((e) => e.topic)).toEqual([RUN_ASSIGNED_TOPIC, RUN_COMPLETED_TOPIC]);
    expect(emitted[1].payload.error).toBe('boom');
  });

  it('findings make the run real even when it succeeded', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;

    frame.close({ status: 'success', finishedAt: 10, findings: 3 });

    expect(emitted.map((e) => e.topic)).toEqual([RUN_ASSIGNED_TOPIC, RUN_COMPLETED_TOPIC]);
    expect(emitted[1].payload.findings).toBe(3);
  });

  it('stamps the run its own finish time and reports its duration', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1_000 })!;
    frame.noteGatedAct(2_000);

    frame.close({ status: 'success', finishedAt: 5_000 });

    const done = emitted[1];
    expect(done.topic).toBe(RUN_COMPLETED_TOPIC);
    expect(done.schema).toBe(RUN_COMPLETED_SCHEMA);
    expect(done.observed_at).toBe(new Date(5_000).toISOString());
    expect(done.payload.duration_ms).toBe(4_000);
    expect(done.payload.status).toBe('success');
    // Both brackets are one thread.
    expect(done.correlation).toBe(frame.id);
    expect(done.correlation).toBe(emitted[0].correlation);
  });

  it('carries first_gated_act_at, and takes the FIRST', () => {
    const emitted = fakeCore();
    const acting = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;

    acting.noteGatedAct(3_000);
    acting.noteGatedAct(4_000);
    acting.close({ status: 'success', finishedAt: 10_000 });

    expect(emitted[1].payload.first_gated_act_at).toBe(new Date(3_000).toISOString());
  });

  it('omits first_gated_act_at when the run made no gated act', () => {
    const emitted = fakeCore();
    // Real by outcome, not by act — so completed is written, but there is no
    // such moment to report. Absent, not undefined (the WP-26 trap).
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    frame.close({ status: 'error', finishedAt: 10, error: 'x' });

    expect(Object.keys(emitted[1].payload)).not.toContain('first_gated_act_at');
  });

  it('reports findings and error only when present', () => {
    const emitted = fakeCore();
    const ok = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    ok.noteGatedAct(1);
    ok.close({ status: 'success', finishedAt: 1, findings: 0 });

    // 0 is a measurement and must survive; only `undefined` is omitted.
    expect(emitted[1].payload.findings).toBe(0);
    expect(Object.keys(emitted[1].payload)).not.toContain('error');
  });

  it('never throws when close emits into a broken ledger', () => {
    // First emit (the flush) succeeds; the completed emit throws.
    const emitted = fakeCore((n) => { if (n > 1) throw new Error('down'); });
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    frame.noteGatedAct(1);

    expect(() => frame.close({ status: 'success', finishedAt: 1 })).not.toThrow();
    expect(emitted).toHaveLength(1);
  });

  it('emits an empty entity map — a run spans its targets and names none', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    frame.noteGatedAct(1);
    frame.close({ status: 'success', finishedAt: 1 });

    // actionProducer's own rule: an entity map naming ONE of several targets
    // would misattribute the run to that site.
    expect(emitted[0].entity).toEqual({});
    expect(emitted[1].entity).toEqual({});
  });
});

/**
 * The two-copies-of-one-rule pin (`localDay` / `resolveAgentCron` pattern).
 *
 * `agentActorId` writes the actor id; `normalizeProducerId` reads it back to
 * compare a ledger situation against an Inbox one. They are in different
 * modules and nothing but this table makes them agree.
 */
describe('WP-57 · the actor id round-trips through normalizeProducerId', () => {
  const SHIPPED = ['security-sentinel', 'seo-insights', 'log-processor', 'web-analytics', 'auth-probe'];

  it.each(SHIPPED)('%s survives the write/read round trip', (agentName) => {
    expect(normalizeProducerId(agentActorId(agentName))).toBe(agentName);
  });

  it('agrees with the incident producer\'s own shipped constant', () => {
    // incidentProducer's SENTINEL_ACTOR is `act_security_sentinel`. One agent,
    // one actor id — the two disagreeing schemes are what this packet ends.
    expect(agentActorId('security-sentinel')).toBe('act_security_sentinel');
  });

  it('the rejected spelling would NOT have round-tripped', () => {
    // The bug this pin exists to prevent, stated as a fact rather than a memory.
    expect(normalizeProducerId('act_agent_security-sentinel')).not.toBe('security-sentinel');
  });
});
