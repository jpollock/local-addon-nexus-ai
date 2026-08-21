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
  it('mints a distinct task per run and brackets it with task.run.assigned', () => {
    const emitted = fakeCore();

    const a = openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 1_000 });
    const b = openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 2_000 });

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.id).not.toEqual(b!.id);
    expect(a!.id).toMatch(/^task_/);
    expect(emitted).toHaveLength(2);
    expect(emitted[0].topic).toBe(RUN_ASSIGNED_TOPIC);
    expect(emitted[0].schema).toBe(RUN_ASSIGNED_SCHEMA);
    expect(emitted[0].correlation).toBe(a!.id);
  });

  it('names the agent in the actor, so two agents are two actors', () => {
    const emitted = fakeCore();

    openAgentTask({ agentName: 'security-sentinel', trigger: 'cron', startedAt: 1 });
    openAgentTask({ agentName: 'seo-insights', trigger: 'cron', startedAt: 1 });

    expect(emitted.map((e) => e.actor.id)).toEqual([
      'act_agent_security-sentinel',
      'act_agent_seo-insights',
    ]);
    // The defect this closes: one id for every agent.
    expect(new Set(emitted.map((e) => e.actor.id)).size).toBe(2);
    expect(emitted[0].actor.kind).toBe('agent');
  });

  it('derives autonomy from the trigger, never from a setting', () => {
    const emitted = fakeCore();

    openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 });
    openAgentTask({ agentName: 'a', trigger: 'event', startedAt: 1 });
    openAgentTask({ agentName: 'a', trigger: 'manual', startedAt: 1 });

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

    openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1, runId: 'r_abc' });
    openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 });

    expect(emitted[0].payload.run_id).toBe('r_abc');
    expect(Object.keys(emitted[1].payload)).not.toContain('run_id');
  });

  it('stamps assigned with the run’s own start, never the clock', () => {
    const emitted = fakeCore();
    openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1_600_000_000_000 });
    expect(emitted[0].observed_at).toBe(new Date(1_600_000_000_000).toISOString());
  });

  it('returns undefined and never throws when there is no core', () => {
    setIntelligenceCore(undefined as never);
    expect(() => openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).not.toThrow();
    expect(openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).toBeUndefined();
  });

  it('returns undefined and never throws when the emitter throws', () => {
    setIntelligenceCore({
      emitter: { emit: () => { throw new Error('ledger down'); } },
    } as never);
    expect(() => openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).not.toThrow();
    expect(openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1 })).toBeUndefined();
  });

  it('exposes the actor it minted, so callers need not re-derive it', () => {
    fakeCore();
    const frame = openAgentTask({ agentName: 'log-processor', trigger: 'event', startedAt: 1 })!;
    expect(frame.actor).toEqual({ id: 'act_agent_log-processor', kind: 'agent' });
    expect(frame.autonomy).toBe('autonomous');
    expect(agentActorId('log-processor')).toBe('act_agent_log-processor');
  });
});

describe('WP-57 · AgentTaskFrame.close', () => {
  it('stamps the run its own finish time and reports its duration', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 1_000 })!;

    frame.close({ status: 'success', finishedAt: 5_000 });

    const done = emitted[1];
    expect(done.topic).toBe(RUN_COMPLETED_TOPIC);
    expect(done.schema).toBe(RUN_COMPLETED_SCHEMA);
    expect(done.observed_at).toBe(new Date(5_000).toISOString());
    expect(done.payload.duration_ms).toBe(4_000);
    expect(done.payload.status).toBe('success');
    expect(done.correlation).toBe(frame.id);
    // Both brackets are one thread.
    expect(done.correlation).toBe(emitted[0].correlation);
  });

  it('carries first_gated_act_at only when a gated act happened, and takes the FIRST', () => {
    const emitted = fakeCore();

    const quiet = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    quiet.close({ status: 'success', finishedAt: 10 });
    // Absent, not undefined: a run that wrote nothing has no such moment, and
    // toEqual cannot tell those apart (WP-26).
    expect(Object.keys(emitted[1].payload)).not.toContain('first_gated_act_at');

    const acting = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    acting.noteGatedAct(3_000);
    acting.noteGatedAct(4_000);
    acting.close({ status: 'success', finishedAt: 10_000 });
    expect(emitted[3].payload.first_gated_act_at).toBe(new Date(3_000).toISOString());
  });

  it('reports findings and error only when present', () => {
    const emitted = fakeCore();

    const ok = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    ok.close({ status: 'success', finishedAt: 1, findings: 0 });
    // 0 is a measurement and must survive; only `undefined` is omitted.
    expect(emitted[1].payload.findings).toBe(0);
    expect(Object.keys(emitted[1].payload)).not.toContain('error');

    const bad = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    bad.close({ status: 'error', finishedAt: 1, error: 'boom' });
    expect(emitted[3].payload.error).toBe('boom');
    expect(Object.keys(emitted[3].payload)).not.toContain('findings');
  });

  it('never throws when close emits into a broken ledger', () => {
    const emitted = fakeCore((n) => { if (n > 1) throw new Error('down'); });
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    expect(() => frame.close({ status: 'success', finishedAt: 1 })).not.toThrow();
    expect(emitted).toHaveLength(1);
  });

  it('emits an empty entity map — a run spans its targets and names none', () => {
    const emitted = fakeCore();
    const frame = openAgentTask({ agentName: 'a', trigger: 'cron', startedAt: 0 })!;
    frame.close({ status: 'success', finishedAt: 1 });
    // actionProducer's own rule: an entity map naming ONE of several targets
    // would misattribute the run to that site. The per-site entity rides on
    // the acts and findings, where it is true.
    expect(emitted[0].entity).toEqual({});
    expect(emitted[1].entity).toEqual({});
  });
});
