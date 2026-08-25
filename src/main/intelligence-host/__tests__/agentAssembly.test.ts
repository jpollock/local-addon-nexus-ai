/**
 * WP-59 · Assembly on the agent path.
 *
 * The agent-side sibling of `chatAssembly`. What earns its keep here:
 *
 *   - **The actor is the RUN's, not a surface constant.** Chat assembles as
 *     `act_chat_assembler`; an agent assembles as itself, with the autonomy
 *     class its trigger derived. That class is ADR-7's input, so getting it
 *     from anywhere else would decide a safety rule by accident.
 *   - **A manifest is written per run.** Measured at announce: 36 manifests
 *     exist and all 36 are chat's. "What did the agent know when it acted" has
 *     no stored answer for the actors that act unattended, and this is it.
 *   - **A FAULT DEGRADES; it never costs the run.** Everything on this seam is
 *     non-fatal by construction. An assembler that throws leaves the agent
 *     running exactly as it does today.
 *   - **Empty targets are a first-class case**, not an error: an agent with
 *     `siteScoped: false` has none, and the assembler already treats that as
 *     legitimate (episodic retrieval returns nothing rather than throwing).
 *
 * NOT tested here because it is NOT built (deliberately, see the announce):
 * nothing feeds the bundle's prose into the agent's prompt. This packet is
 * additive — bundle and manifest only, zero change to any agent's model call.
 */
import { setIntelligenceCore } from '../coreRegistry';
import { assembleForAgentRun, agentRunIntent, agentRunTargets, refusalBind } from '../agentAssembly';

type Draft = Record<string, any>;

function fakeCore(onEmit?: () => void) {
  const emitted: Draft[] = [];
  setIntelligenceCore({
    emitter: {
      emit: (d: Draft) => {
        onEmit?.();
        emitted.push(d);
        return { ...d, id: `evt_${emitted.length}` };
      },
    },
    ledger: undefined,
    twins: undefined,
    law: undefined,
  } as never);
  return emitted;
}

/**
 * A frame that is already REAL — its `onFlush` runs inline, which is what the
 * live frame does once `task.run.assigned` has landed. Tests that care about
 * the deferral itself use `quietFrame` below.
 */
function realFrame() {
  return {
    id: 'task_01M0K5X3R17VEHR26JGA2RV931',
    actor: { id: 'act_security_sentinel', kind: 'agent' as const },
    autonomy: 'autonomous' as const,
    onFlush: (fn: () => void) => fn(),
  };
}

/** A frame whose run never became real: registered work is captured, not run. */
function quietFrame() {
  const pending: Array<() => void> = [];
  return {
    frame: {
      id: 'task_01M0K5X3R17VEHR26JGA2RV931',
      actor: { id: 'act_auth_probe', kind: 'agent' as const },
      autonomy: 'autonomous' as const,
      onFlush: (fn: () => void) => { pending.push(fn); },
    },
    pending,
  };
}

const frame = realFrame();

describe('WP-59 · agentRunIntent', () => {
  it('uses the agent\'s own reviewed description when it has one', () => {
    expect(
      agentRunIntent({ name: 'seo-insights', description: 'Content strategy agent' } as never, 'cron')
    ).toBe('Content strategy agent');
  });

  it('derives a plain sentence when the manifest carries no description', () => {
    // Never empty: the intent lands in the manifest, and a blank intent there
    // is a stored record that says nothing about why the run happened.
    expect(agentRunIntent({ name: 'auth-probe' } as never, 'cron')).toBe('cron run of auth-probe');
    expect(agentRunIntent({ name: 'auth-probe' } as never, 'manual')).toBe('manual run of auth-probe');
  });
});

describe('WP-59 · assembleForAgentRun', () => {
  it('assembles as the AGENT, carrying the trigger-derived autonomy class', async () => {
    const emitted = fakeCore();
    const seen: any[] = [];

    await assembleForAgentRun({
      agent: { name: 'security-sentinel', description: 'Security scanner' } as never,
      frame,
      trigger: 'cron',
      assembleFn: async (req: any) => { seen.push(req); return { manifest: { bundle_id: 'bun_1' } } as never; },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].actor).toEqual({
      id: 'act_security_sentinel',
      kind: 'agent',
      autonomy: 'autonomous',
    });
    // ADR-7's class comes from the frame, which derived it from the trigger.
    // Reading it from anywhere else would decide a safety rule by accident.
    expect(seen[0].task).toEqual({ id: frame.id, intent: 'Security scanner' });
    expect(seen[0].capability).toBeNull();
    expect(emitted).toBeDefined();
  });

  it('names its own surface, so a manifest says which actor class produced it', async () => {
    fakeCore();
    const seen: any[] = [];
    await assembleForAgentRun({
      agent: { name: 'a' } as never, frame, trigger: 'cron',
      assembleFn: async (req: any) => { seen.push(req); return { manifest: {} } as never; },
    });
    expect(seen[0].surface).toBe('agent.runtime');
  });

  it('passes empty targets through — an agent that is not site-scoped has none', async () => {
    fakeCore();
    const seen: any[] = [];
    await assembleForAgentRun({
      agent: { name: 'auth-probe' } as never, frame, trigger: 'cron',
      assembleFn: async (req: any) => { seen.push(req); return { manifest: {} } as never; },
    });
    // Measured against the assembler: `targets: []` is a first-class case
    // there, and episodic retrieval returns nothing rather than throwing.
    expect(seen[0].targets).toEqual([]);
  });

  it('returns the bundle it assembled', async () => {
    fakeCore();
    const bundle = { manifest: { bundle_id: 'bun_7' }, ambient: null };
    const out = await assembleForAgentRun({
      agent: { name: 'a' } as never, frame, trigger: 'cron',
      assembleFn: async () => bundle as never,
    });
    expect(out).toBe(bundle);
  });

  it('A FAULT DEGRADES — a throwing assembler costs the bundle, never the run', async () => {
    fakeCore();
    let out: unknown = 'unset';
    await expect(
      (async () => {
        out = await assembleForAgentRun({
          agent: { name: 'a' } as never, frame, trigger: 'cron',
          assembleFn: async () => { throw new Error('assembler exploded'); },
        });
      })()
    ).resolves.toBeUndefined();
    // Undefined, not a partial bundle: an unassembled run is honest, and the
    // caller treats the bundle as optional exactly as it treats the frame.
    expect(out).toBeUndefined();
  });

  it('degrades when there is no core at all', async () => {
    setIntelligenceCore(undefined as never);
    const out = await assembleForAgentRun({
      agent: { name: 'a' } as never, frame, trigger: 'cron',
      assembleFn: async () => ({ manifest: {} } as never),
    });
    expect(out).toBeUndefined();
  });
});

/**
 * WP-59 · The run's targets, and the manifest that records them.
 *
 * Two things worth stating up front, because both look like inconsistencies
 * at review and neither is:
 *
 * **The manifest's entity map is NOT the frame's.** `task.run.assigned` emits
 * `entity: {}` deliberately — a run spans every site in its scope and naming
 * one of them misattributes the run. The manifest answers a different
 * question: what context was ASSEMBLED, about what. That is known exactly. So
 * an empty entity map here means "assembled about nothing in particular",
 * which is the true answer for a cron run, and a populated one means the
 * assembler really was given that site.
 *
 * **The manifest is DEFERRED onto the frame, not emitted inline.** Assembly
 * happens on every run; recording it on every run would write the 1,440
 * events a day WP-57's laziness was bought to avoid. Reads are free, records
 * are not — so the bundle is built eagerly and its manifest rides
 * `frame.onFlush`, landing only for runs that turned out to be real, and
 * always after the assignment it correlates to.
 */
describe('WP-59 · agentRunTargets', () => {
  const services = (sites: Record<string, any>) =>
    ({ siteData: { getSite: (id: string) => sites[id] ?? null, getSites: () => sites } } as never);

  it('resolves a site to BOTH the copy and the logical site, as chat does', () => {
    setIntelligenceCore({ emitter: { emit: () => ({}) } } as never);
    const out = agentRunTargets(services({ s1: { id: 's1', name: 'acme' } }), 's1');
    expect(out.map((t) => t.role)).toEqual(['environment', 'site']);
    // The label is what appears in prose; the id is unreadable to a model and
    // to a user. Both carry the site's real name, never its id.
    expect(out.every((t) => t.label === 'acme')).toBe(true);
    expect(out.every((t) => t.id.startsWith('ent_'))).toBe(true);
  });

  it('returns nothing for a run with no site — the common case, not an error', () => {
    // A cron run of a fleet-wide agent has no single target, and `siteScoped:
    // false` agents never have one at all.
    expect(agentRunTargets(services({}), undefined)).toEqual([]);
    expect(agentRunTargets(services({}), '')).toEqual([]);
  });

  it('returns nothing rather than an invented entity when the id does not resolve', () => {
    // The runner's site id comes from a webhook event, which is Local-only.
    // A WPE install id or a stale local id resolves to nothing, and an entity
    // minted for a site we cannot name would be a fabricated target in a
    // record whose whole job is saying what was really in scope.
    expect(agentRunTargets(services({ s1: { id: 's1', name: 'acme' } }), 'wpe-install-42')).toEqual([]);
  });

  it('degrades to no targets when the site store throws', () => {
    const hostile = { siteData: { getSite: () => { throw new Error('store down'); }, getSites: () => ({}) } } as never;
    expect(agentRunTargets(hostile, 's1')).toEqual([]);
  });
});

describe('WP-59 · the agent manifest', () => {
  const services = (sites: Record<string, any>) =>
    ({ siteData: { getSite: (id: string) => sites[id] ?? null, getSites: () => sites } } as never);

  const bundle = (over: Record<string, any> = {}) => ({
    manifest: {
      bundle_id: 'bun_1',
      task: 'task_01M0K5X3R17VEHR26JGA2RV931',
      assembled_at: '2026-08-25T10:00:00.000Z',
      actor: 'act_security_sentinel',
      surface: 'agent.runtime',
      policy: null,
      ...over,
    },
  });

  it('records a manifest for the run, as the AGENT — never as the chat assembler', async () => {
    const emitted = fakeCore();
    await assembleForAgentRun({
      agent: { name: 'security-sentinel', description: 'Security scanner' } as never,
      frame, trigger: 'cron',
      assembleFn: async () => bundle() as never,
    });

    expect(emitted).toHaveLength(1);
    const m = emitted[0];
    expect(m.topic).toBe('task.context.assembled');
    expect(m.schema).toBe('context.assembled/1');
    // The whole point of the packet: 36 manifests existed at announce and all
    // 36 were `act_chat_assembler`. An agent's manifest attributed to chat
    // would leave the question "what did the AGENT know" still unanswered.
    expect(m.actor).toEqual({ id: 'act_security_sentinel', kind: 'agent' });
    expect(m.source).toEqual({ class: 'work', system: 'assembler:agent', trust: 'emitted' });
  });

  it('stamps the ASSEMBLY\'s own moment and correlates to the run', async () => {
    const emitted = fakeCore();
    await assembleForAgentRun({
      agent: { name: 'security-sentinel' } as never, frame, trigger: 'cron',
      assembleFn: async () => bundle() as never,
    });
    // Never the emitter's clock — the record is deferred to flush time, so a
    // "now" stamp here would be off by the whole length of the run.
    expect(emitted[0].observed_at).toBe('2026-08-25T10:00:00.000Z');
    expect(emitted[0].correlation).toBe('task_01M0K5X3R17VEHR26JGA2RV931');
    expect(emitted[0].payload.bundle_id).toBe('bun_1');
    // `policy: null` is the diagnostic, not a hole: a cron run is autonomous,
    // and an autonomous actor with no policy set gets a fail-closed bundle.
    // The manifest saying so is exactly how that becomes visible.
    expect(emitted[0].payload.policy).toBeNull();
  });

  it('names the targets it actually assembled about — and hands them to the assembler', async () => {
    const emitted = fakeCore();
    const seen: any[] = [];
    await assembleForAgentRun({
      agent: { name: 'security-sentinel' } as never, frame, trigger: 'event',
      siteId: 's1', services: services({ s1: { id: 's1', name: 'acme' } }),
      assembleFn: async (req: any) => { seen.push(req); return bundle() as never; },
    });
    // Both halves, because they can diverge: the manifest could name a target
    // the assembler was never given, which is a record of context that was
    // not assembled.
    expect(seen[0].targets.map((t: any) => t.role)).toEqual(['environment', 'site']);
    expect(Object.keys(emitted[0].entity).sort()).toEqual(['environment', 'site']);
    expect(emitted[0].entity.site).toBe(seen[0].targets[1].id);
  });

  it('emits an empty entity map for a run with no single target', async () => {
    const emitted = fakeCore();
    await assembleForAgentRun({
      agent: { name: 'auth-probe' } as never, frame, trigger: 'cron',
      assembleFn: async () => bundle() as never,
    });
    // NOT the frame's reasoning (which withholds an entity because a run spans
    // its scope). This map is empty because the assembler genuinely was given
    // nothing to be about.
    expect(emitted[0].entity).toEqual({});
  });

  it('DEFERS the manifest onto the frame — a quiet run records nothing', async () => {
    const emitted = fakeCore();
    const { frame: quiet, pending } = quietFrame();

    const out = await assembleForAgentRun({
      agent: { name: 'auth-probe' } as never, frame: quiet, trigger: 'cron',
      assembleFn: async () => bundle() as never,
    });

    // The bundle exists — assembly is not conditional, only its RECORD is.
    expect(out).toBeDefined();
    expect(emitted).toHaveLength(0);
    expect(pending).toHaveLength(1);

    // And when the run does turn out to be real, the manifest lands.
    pending[0]();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].topic).toBe('task.context.assembled');
  });

  it('records nothing when the assembler produced no bundle', async () => {
    const emitted = fakeCore();
    const { frame: quiet, pending } = quietFrame();
    await assembleForAgentRun({
      agent: { name: 'a' } as never, frame: quiet, trigger: 'cron',
      assembleFn: async () => { throw new Error('assembler exploded'); },
    });
    // A manifest for a bundle that does not exist would describe context the
    // agent never had.
    expect(emitted).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('records nothing when the bundle carries no manifest', async () => {
    // Distinct from the case above, and it is the branch the `if (manifest)`
    // guard exists for: the assembler RETURNED, so the outer catch never
    // fires, but there is no manifest to record. Nothing is emitted and
    // nothing is queued — a `task.context.assembled` whose payload is empty
    // asserts that context was assembled and says nothing about what.
    const emitted = fakeCore();
    const { frame: quiet, pending } = quietFrame();
    const out = await assembleForAgentRun({
      agent: { name: 'a' } as never, frame: quiet, trigger: 'cron',
      assembleFn: async () => ({} as never),
    });
    expect(out).toEqual({});
    expect(emitted).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('a manifest that cannot be written costs the manifest, never the run', async () => {
    let calls = 0;
    setIntelligenceCore({
      emitter: { emit: () => { calls += 1; throw new Error('ledger down'); } },
      scheduleFolds: () => { throw new Error('folds down'); },
    } as never);

    let out: unknown = 'unset';
    await expect(
      (async () => {
        out = await assembleForAgentRun({
          agent: { name: 'a' } as never, frame, trigger: 'cron',
          assembleFn: async () => bundle() as never,
        });
      })()
    ).resolves.toBeUndefined();

    // The frame's `onFlush` runs the callback inline here, so a throw would
    // surface as a rejected promise — and in production it would reach
    // `flush()`. The bundle still came back.
    expect(calls).toBe(1);
    expect(out).toBeDefined();
  });
});

/**
 * WP-59 · the second half of R3 — a REFUSAL binds where a FAULT degrades.
 *
 * `refusalBind` is only the derivation; the enforcement is in
 * `NexusToolProvider` and is pinned there and end-to-end in
 * `tests/unit/agent-runtime/AgentRunner.contextBundle.test.ts`. What matters
 * here is the boundary between the two failure modes, because collapsing them
 * is wrong in BOTH directions: binding on a fault would stop every agent in
 * the fleet the moment the ledger became unreadable, and not binding on a
 * refusal would leave an autonomous actor mutating production with no policy
 * loaded, which is the exact case ADR-7 exists for.
 */
describe('WP-59 · refusalBind', () => {
  it('does not bind when there was no bundle at all — a fault degrades', () => {
    expect(refusalBind(undefined)).toBeUndefined();
  });

  it('does not bind a bundle that assembled normally', () => {
    expect(refusalBind({ manifest: {}, failClosed: false } as never)).toBeUndefined();
    // The key absent entirely, not merely false — the shape a pre-WP-11 caller
    // would produce.
    expect(refusalBind({ manifest: {} } as never)).toBeUndefined();
  });

  it('binds the policy refusal, and names the cause rather than just refusing', () => {
    const bind = refusalBind({ manifest: {}, failClosed: true, procedure: null } as never);
    expect(bind).toBeDefined();
    expect(bind!.reason).toContain('no operating policy set');
  });

  it('binds the procedure refusal with ITS cause, not the policy one', () => {
    // A granted capability whose document does not hash to the one it was
    // granted against is an INTEGRITY failure. Reporting it as "no policy set"
    // would send a user to fix the wrong thing.
    const bind = refusalBind({
      manifest: {},
      failClosed: true,
      procedure: {
        status: 'refused',
        capability: 'cap.incident_containment',
        code: 'hash-mismatch',
        reason: 'document changed on disk',
      },
    } as never);
    expect(bind!.reason).toContain('cap.incident_containment');
    expect(bind!.reason).toContain('hash-mismatch');
    expect(bind!.reason).not.toContain('no operating policy set');
  });

  it('falls back to the policy wording when a procedure rode but was NOT refused', () => {
    // `failClosed` with a delivered procedure is the policy refusal shape; the
    // procedure is along for the ride and its `reason` field would be the
    // wrong sentence to quote.
    const bind = refusalBind({
      manifest: {},
      failClosed: true,
      procedure: { status: 'delivered', capability: 'cap.diagnose_site' },
    } as never);
    expect(bind!.reason).toContain('no operating policy set');
  });
});
