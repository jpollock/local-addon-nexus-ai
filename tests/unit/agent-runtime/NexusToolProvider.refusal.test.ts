/**
 * WP-59 · a fail-closed assembly BINDS the run, at the tool gate.
 *
 * `refusalBind` derives the cause and `agentAssembly.test.ts` pins that
 * derivation. Neither makes anything happen. The bundle's own words — "take no
 * action that changes any site, run read-only diagnostics only" — are prose in
 * a turn block, and **prose is advice a prompt-injected model can ignore**. R3
 * says a refusal binds; a bind that only asks is fail-open with a paragraph.
 *
 * So the enforcement lives here, and this file measures it:
 *
 *   - **Tier is the boundary**, the same one `noteGatedAct` and the durable
 *     audit write already use. A Tier-1 read still runs, because "read-only
 *     diagnostics only" is an instruction to keep reading. Tier ≥ 2 is refused.
 *   - **The message names the cause and the task**, not just the refusal — a
 *     bound run that cannot say why is a support ticket.
 *   - **Tier 3 still answers first.** It is refused for an agent permanently and
 *     for an unrelated reason; leading with the bind would tell a user that
 *     restoring the policy set makes `wpe_delete_install` work, which is false.
 *   - **No bind, no change.** The overwhelmingly common path is untouched.
 */
import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';

function registryStub(calls: string[]) {
  return {
    list: () => [],
    call: async (name: string) => {
      calls.push(name);
      return { content: [{ type: 'text', text: '{}' }], isError: false };
    },
  } as never;
}

function frameStub() {
  const flushes: number[] = [];
  const noted: number[] = [];
  return {
    flushes,
    noted,
    frame: {
      id: 'task_01M0K5X3R17VEHR26JGA2RV931',
      actor: { id: 'act_security_sentinel', kind: 'agent' as const },
      noteGatedAct: (at: number) => { noted.push(at); },
      correlationId: () => {
        flushes.push(1);
        return 'task_01M0K5X3R17VEHR26JGA2RV931';
      },
    },
  };
}

const BIND = { reason: 'no operating policy set could be loaded for this autonomous run' };
const TOOLS = ['nexus_list_sites', 'wp_plugin_update', 'wpe_delete_install'];

describe('WP-59 · a bound run reads but does not act', () => {
  it('still runs a Tier-1 read — the bind is read-only, not stop-work', async () => {
    const calls: string[] = [];
    const { frame } = frameStub();
    const p = new NexusToolProvider(registryStub(calls), {} as never, TOOLS, undefined, frame, BIND);

    await p.invoke('nexus_list_sites', {});

    // An agent that cannot look at anything cannot report why it was bound,
    // which is the one thing a bound run is still for.
    expect(calls).toEqual(['nexus_list_sites']);
    expect(p.failedCallCount()).toBe(0);
  });

  it('refuses a Tier-2 act, names the cause, and never reaches the registry', async () => {
    const calls: string[] = [];
    const { frame } = frameStub();
    const p = new NexusToolProvider(registryStub(calls), {} as never, TOOLS, undefined, frame, BIND);

    await expect(p.invoke('wp_plugin_update', { site: 's', plugin: 'akismet' }))
      .rejects.toThrow(/assembled fail-closed/);

    // Refused BEFORE the call, not after. A tool that ran and then reported a
    // refusal would have already changed the site.
    expect(calls).toEqual([]);
    expect(p.failedCallCount()).toBe(1);
  });

  it('puts the cause and the task id in the message the agent actually reads', async () => {
    const { frame, flushes } = frameStub();
    const p = new NexusToolProvider(registryStub([]), {} as never, TOOLS, undefined, frame, BIND);

    const err = await p.invoke('wp_plugin_update', { site: 's' }).catch((e: Error) => e);
    const message = (err as Error).message;

    expect(message).toContain('wp_plugin_update');
    // The cause, so the user fixes the policy set rather than the agent.
    expect(message).toContain('no operating policy set could be loaded');
    // What to do instead — the bundle's instruction, carried to the model that
    // is now getting an error instead of a tool result.
    expect(message).toContain('read-only');
    // The episode id, so the report, the event log's `run=` lines and the
    // ledger correlation all name the same run.
    expect(message).toContain('task_01M0K5X3R17VEHR26JGA2RV931');
    // And the refusal MADE the run real: `correlationId()` is the frame's own
    // flush. Without it a run stopped from acting would be indistinguishable
    // from a quiet run, and the manifest saying why would never drain.
    expect(flushes).toHaveLength(1);
  });

  it('does not count the refusal as a gated ACT', async () => {
    const { frame, noted } = frameStub();
    const p = new NexusToolProvider(registryStub([]), {} as never, TOOLS, undefined, frame, BIND);

    await p.invoke('wp_plugin_update', { site: 's' }).catch(() => undefined);

    // `noteGatedAct` arms R2's arm-to-first-write measurement. A call that was
    // refused performed no act, and recording one would date the run's first
    // write to something that never happened.
    expect(noted).toHaveLength(0);
    expect(p.toolTrace()).toEqual([]);
  });

  it('leaves the Tier-3 refusal first — a bind must not mis-explain a permanent gate', async () => {
    const { frame } = frameStub();
    const p = new NexusToolProvider(registryStub([]), {} as never, TOOLS, undefined, frame, BIND);

    const err = await p.invoke('wpe_delete_install', { id: 'x' }).catch((e: Error) => e);
    const message = (err as Error).message;

    expect(message).toContain('destructive (Tier 3)');
    // Not "restore the policy set and this works": it never will.
    expect(message).not.toContain('fail-closed');
  });

  it('changes nothing at all when the assembly did not refuse', async () => {
    const calls: string[] = [];
    const { frame } = frameStub();
    // No sixth argument — a normal assembly, and also a FAULTED one. A fault
    // degrades; only a refusal binds. Collapsing those would take the whole
    // fleet's agents offline on an intelligence-layer outage.
    const p = new NexusToolProvider(registryStub(calls), {} as never, TOOLS, undefined, frame);

    await p.invoke('wp_plugin_update', { site: 's' });

    expect(calls).toEqual(['wp_plugin_update']);
    expect(p.failedCallCount()).toBe(0);
  });
});
