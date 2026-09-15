// The behaviour the runtime now owns: an agent's tool calls reach the structured log without the
// agent reporting them. `ctx.log.mutation()` shipped with zero callers across every agent in the
// repo and on the user's machine, which is the same failure the design anticipated for llm.call —
// so `tool.call` and `mutation` are emitted at the chokepoint every agent tool call passes
// through, not left to agent authors to remember.

import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';

function fakeLog() {
  const lines: any[] = [];
  return { lines, log: { write: (e: any) => lines.push(e) } as any };
}

/** A registry whose one tool succeeds, or fails, on demand. */
function fakeRegistry(outcome: 'ok' | 'error' = 'ok') {
  return {
    call: async () => (outcome === 'ok'
      ? { isError: false, content: [{ type: 'text', text: '{"done":true}' }] }
      : { isError: true, content: [{ type: 'text', text: 'WP-CLI exited 1: could not update' }] }),
    list: () => [],
  } as any;
}

const services = { contributedRegistry: { list: () => [] } } as any;

function make(tools: string[] | undefined, outcome: 'ok' | 'error' = 'ok') {
  const { lines, log } = fakeLog();
  const provider = new NexusToolProvider(fakeRegistry(outcome), services, tools, {
    eventLog: log, runId: 'r_test', agentName: 'security-sentinel',
  });
  return { provider, lines };
}

const eventsOf = (lines: any[], name: string) => lines.filter(l => l.event === name);

describe('tool.call is emitted for every agent tool call', () => {
  it('records a read-only call, and does not call it a mutation', async () => {
    const { provider, lines } = make(['wp_plugin_list']);
    await provider.invoke('wp_plugin_list', { site: 'acfprod' });

    expect(eventsOf(lines, 'tool.call')).toHaveLength(1);
    expect(eventsOf(lines, 'mutation')).toHaveLength(0);
    const call = eventsOf(lines, 'tool.call')[0];
    expect(call).toMatchObject({
      level: 'INFO', source: 'security-sentinel', sourceKind: 'agent', runId: 'r_test',
    });
    expect(call.fields).toMatchObject({ tool: 'wp_plugin_list', target: 'acfprod', ok: true });
    expect(String(call.fields.dur)).toMatch(/^\d+ms$/);
  });

  it('records a mutating call as BOTH a tool.call and a mutation', async () => {
    const { provider, lines } = make(['wp_plugin_update']);
    await provider.invoke('wp_plugin_update', { site: 'acfprod', plugin: 'advanced-custom-fields' });

    expect(eventsOf(lines, 'tool.call')).toHaveLength(1);
    const mutations = eventsOf(lines, 'mutation');
    expect(mutations).toHaveLength(1);
    expect(mutations[0].fields).toEqual({ op: 'wp_plugin_update', target: 'acfprod', ok: true });
    expect(mutations[0].runId).toBe('r_test');
  });

  it('stamps the run id so a mutation is attributable to one run', async () => {
    const { provider, lines } = make(undefined);
    await provider.invoke('wp_core_update', { site: 'acfprod' });
    for (const l of lines) expect(l.runId).toBe('r_test');
  });
});

describe('what counts as a mutation', () => {
  it('does NOT record a mutation for a call refused by tool scope', async () => {
    // Refused before it reached the tool, so nothing changed. Labelling it a mutation would put
    // a non-event in the query someone runs after an unexpected change — while the attempt is
    // still visible as a failed tool.call, which is the honest record of it.
    const { provider, lines } = make(['wp_plugin_list']);   // wp_plugin_update NOT declared
    await expect(provider.invoke('wp_plugin_update', { site: 'acfprod' })).rejects.toThrow();

    expect(eventsOf(lines, 'mutation')).toHaveLength(0);
    const call = eventsOf(lines, 'tool.call')[0];
    expect(call.fields.ok).toBe(false);
    expect(call.level).toBe('WARN');
    expect(call.message).toMatch(/tools\[\] declaration/);
  });

  it('DOES record a mutation when the tool ran and failed', async () => {
    // "It tried to update the plugin and failed" is a different fact from "it never tried", and
    // both matter when reconstructing what happened to a site.
    const { provider, lines } = make(['wp_plugin_update'], 'error');
    await expect(provider.invoke('wp_plugin_update', { site: 'acfprod' })).rejects.toThrow();

    const mutations = eventsOf(lines, 'mutation');
    expect(mutations).toHaveLength(1);
    expect(mutations[0].fields).toEqual({ op: 'wp_plugin_update', target: 'acfprod', ok: false });
    expect(mutations[0].level).toBe('WARN');
    expect(mutations[0].message).toMatch(/could not update/);
  });

  it('omits the target rather than inventing one when the args do not name it', async () => {
    const { provider, lines } = make(undefined);
    await provider.invoke('wpe_purge_cache', {});
    expect(eventsOf(lines, 'mutation')[0].fields.target).toBeUndefined();
  });
});

describe('logging never interferes with the tool call', () => {
  it('works with no event log at all — the MCP and test path', async () => {
    const provider = new NexusToolProvider(fakeRegistry(), services, undefined);
    await expect(provider.invoke('wp_plugin_update', { site: 'acfprod' })).resolves.toEqual({ done: true });
  });

  it('a throwing log does not fail a successful call', async () => {
    const provider = new NexusToolProvider(fakeRegistry(), services, undefined, {
      eventLog: { write: () => { throw new Error('disk full'); } } as any,
      runId: 'r_test', agentName: 'security-sentinel',
    });
    await expect(provider.invoke('wp_plugin_update', { site: 'acfprod' })).resolves.toEqual({ done: true });
  });

  it('still returns the tool result unchanged', async () => {
    const { provider } = make(undefined);
    await expect(provider.invoke('wp_plugin_list', { site: 'acfprod' })).resolves.toEqual({ done: true });
  });
});
