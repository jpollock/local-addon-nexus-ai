/**
 * WP-57 Task 5 · agent tool calls carry their run's task.
 *
 * Two things are pinned here, and the second matters more than the first:
 *
 *   - the frame's id reaches `ToolRegistry.call` as its `task` argument, so
 *     every gated act an agent performs joins the run that performed it;
 *   - **the sequence gate reaches the SAME DECISION framed and unframed.**
 *     Before this change the agent path passed `task: undefined`; now it
 *     passes a real id. Both resolve to "no procedure run exists for this
 *     task", so nothing may become newly refused — but that is a claim about
 *     behaviour, and this file measures it rather than asserting it in a
 *     comment.
 *
 * `noteGatedAct` fires only for tier ≥ 2. A Tier-1 read is not an act (the
 * same floor `actionProducer` and the durable audit use), so a browsing agent
 * never makes its run "real" and never writes a bracket.
 */
import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';

function registryStub(calls: unknown[][], opts: { tool?: string } = {}) {
  const name = opts.tool ?? 'wp_plugin_list';
  return {
    list: () => [{ name, description: 'd', inputSchema: {} }],
    call: async (...args: unknown[]) => {
      calls.push(args);
      return { content: [{ type: 'text', text: '{}' }], isError: false };
    },
  } as never;
}

function frameStub() {
  const noted: number[] = [];
  return {
    noted,
    frame: {
      id: 'task_01M0K5X3R17VEHR26JGA2RV931',
      actor: { id: 'act_security_sentinel', kind: 'agent' as const },
      noteGatedAct: (at: number) => { noted.push(at); },
    },
  };
}

describe('WP-57 · NexusToolProvider threads the run task', () => {
  it('passes the frame id to ToolRegistry.call as the task argument', async () => {
    const calls: unknown[][] = [];
    const { frame } = frameStub();
    const p = new NexusToolProvider(registryStub(calls), {} as never, ['wp_plugin_list'], undefined, frame);

    await p.invoke('wp_plugin_list', { site: 's' });

    expect(calls).toHaveLength(1);
    // Positional: (name, args, services, accessMethod, requireConfirmation, runId, task)
    // The actor rides on the task object — the smallest change that reaches
    // audit chokepoint one, and what stops every agent act collapsing into
    // `act_agent_runtime`.
    expect(calls[0][6]).toEqual({
      id: 'task_01M0K5X3R17VEHR26JGA2RV931',
      actor: { id: 'act_security_sentinel', kind: 'agent' },
    });
  });

  it('passes undefined when there is no frame — the pre-WP-57 shape, unchanged', async () => {
    const calls: unknown[][] = [];
    const p = new NexusToolProvider(registryStub(calls), {} as never, ['wp_plugin_list']);

    await p.invoke('wp_plugin_list', { site: 's' });

    expect(calls[0][6]).toBeUndefined();
  });

  it('does NOT note a gated act for a tier-1 read', async () => {
    const calls: unknown[][] = [];
    const { frame, noted } = frameStub();
    // wp_plugin_list is a read; a browsing agent must never make its run real.
    const p = new NexusToolProvider(registryStub(calls), {} as never, ['wp_plugin_list'], undefined, frame);

    await p.invoke('wp_plugin_list', { site: 's' });

    expect(noted).toHaveLength(0);
  });

  it('notes a gated act for a tier-2 tool, once the call has reached it', async () => {
    const calls: unknown[][] = [];
    const { frame, noted } = frameStub();
    const p = new NexusToolProvider(
      registryStub(calls, { tool: 'wpe_site_deep_refresh' }),
      {} as never,
      ['wpe_site_deep_refresh'],
      undefined,
      frame,
    );

    await p.invoke('wpe_site_deep_refresh', { site: 's' });

    expect(noted).toHaveLength(1);
    expect(noted[0]).toEqual(expect.any(Number));
  });

  it('does NOT note a gated act for a call REFUSED before it ran', async () => {
    const calls: unknown[][] = [];
    const { frame, noted } = frameStub();
    // Not in the declared tools list ⇒ scope refusal, before the tool.
    const p = new NexusToolProvider(
      registryStub(calls, { tool: 'wpe_site_deep_refresh' }),
      {} as never,
      ['something_else'],
      undefined,
      frame,
    );

    await expect(p.invoke('wpe_site_deep_refresh', { site: 's' })).rejects.toThrow();

    // A refused call changed nothing, so it must not make the run real —
    // the same reasoning that keeps a refusal out of the `mutation` event.
    expect(noted).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe('WP-57 · the run\'s citable trace', () => {
  it('records every tool it REACHED, in order, tier regardless', async () => {
    const calls: unknown[][] = [];
    const p = new NexusToolProvider(registryStub(calls), {} as never, undefined);

    await p.invoke('wp_plugin_list', {});
    await p.invoke('wp_plugin_list', {});

    // Reads are citable: "I saw this in the plugin list" is exactly the kind of
    // warrant a finding needs, so the trace is wider than the act record.
    expect(p.toolTrace()).toEqual(['wp_plugin_list', 'wp_plugin_list']);
  });

  it('does NOT record a call refused before it ran', async () => {
    const calls: unknown[][] = [];
    const p = new NexusToolProvider(registryStub(calls), {} as never, ['something_else']);

    await expect(p.invoke('wp_plugin_list', {})).rejects.toThrow();

    // A refused call observed nothing. Citing it would warrant a claim with a
    // non-event — the same boundary the `mutation` event uses.
    expect(p.toolTrace()).toEqual([]);
  });

  it('hands back a copy — the universe cannot be edited after the fact', async () => {
    const calls: unknown[][] = [];
    const p = new NexusToolProvider(registryStub(calls), {} as never, undefined);
    await p.invoke('wp_plugin_list', {});

    p.toolTrace().push('wp_user_list');

    expect(p.toolTrace()).toEqual(['wp_plugin_list']);
  });
});
