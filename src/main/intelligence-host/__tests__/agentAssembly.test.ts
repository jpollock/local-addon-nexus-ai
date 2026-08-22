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
import { assembleForAgentRun, agentRunIntent } from '../agentAssembly';

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

const frame = {
  id: 'task_01M0K5X3R17VEHR26JGA2RV931',
  actor: { id: 'act_security_sentinel', kind: 'agent' as const },
  autonomy: 'autonomous' as const,
};

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
      targets: [],
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
      agent: { name: 'a' } as never, frame, trigger: 'cron', targets: [],
      assembleFn: async (req: any) => { seen.push(req); return { manifest: {} } as never; },
    });
    expect(seen[0].surface).toBe('agent.runtime');
  });

  it('passes empty targets through — an agent that is not site-scoped has none', async () => {
    fakeCore();
    const seen: any[] = [];
    await assembleForAgentRun({
      agent: { name: 'auth-probe' } as never, frame, trigger: 'cron', targets: [],
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
      agent: { name: 'a' } as never, frame, trigger: 'cron', targets: [],
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
          agent: { name: 'a' } as never, frame, trigger: 'cron', targets: [],
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
      agent: { name: 'a' } as never, frame, trigger: 'cron', targets: [],
      assembleFn: async () => ({ manifest: {} } as never),
    });
    expect(out).toBeUndefined();
  });
});
