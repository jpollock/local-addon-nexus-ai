import { AgentAIClient } from '../../../src/main/agent-runtime/AgentAIClient';
import type { ProviderStreamEvent } from '../../../src/common/chat-types';

function fakeLog() {
  const lines: any[] = [];
  return { lines, log: { write: (e: any) => lines.push(e) } as any };
}

/** A provider that answers once with the given events. */
function fakeProvider(...events: ProviderStreamEvent[]) {
  return { async *streamChat() { for (const e of events) yield e; } } as any;
}

const toolProvider = { getProviderToolDefinitions: () => [], invoke: async () => ({}) } as any;
const config = { apiKey: '', model: 'claude-opus-5' } as any;

describe('llm.call', () => {
  it('records model, turn, tokens, cost and duration', async () => {
    const { lines, log } = fakeLog();
    const client = new AgentAIClient(
      fakeProvider({ type: 'token', text: 'done' },
                   { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 1204, outputTokens: 318 } }),
      config, toolProvider, undefined, undefined,
      { eventLog: log, runId: 'r_test', agentName: 'security-sentinel' },
    );
    await client.run('hello');

    const calls = lines.filter(l => l.event === 'llm.call');
    expect(calls).toHaveLength(1);
    expect(calls[0].runId).toBe('r_test');
    expect(calls[0].fields).toMatchObject({
      model: 'claude-opus-5', turn: 1, in: 1204, out: 318,
    });
    expect(calls[0].fields.cost).toBeGreaterThan(0);
    expect(String(calls[0].fields.dur)).toMatch(/^\d+ms$/);
  });

  it('omits in/out/cost when the provider reported no usage', async () => {
    // Ollama and the gateway report nothing. Absent is honest; 0 would read as a free call.
    const { lines, log } = fakeLog();
    const client = new AgentAIClient(
      fakeProvider({ type: 'token', text: 'x' }, { type: 'done', stopReason: 'end_turn' }),
      config, toolProvider, undefined, undefined,
      { eventLog: log, runId: 'r_test', agentName: 'a' },
    );
    await client.run('hello');

    const f = lines.find(l => l.event === 'llm.call').fields;
    expect(f.in).toBeUndefined();
    expect(f.out).toBeUndefined();
    expect(f.cost).toBeUndefined();
    expect(f.model).toBe('claude-opus-5');
  });

  it('numbers each turn of a multi-turn loop', async () => {
    const { lines, log } = fakeLog();
    let call = 0;
    const provider = {
      async *streamChat() {
        call++;
        if (call === 1) {
          yield { type: 'tool_call_end', id: 't1', name: 'wp_plugin_list', arguments: {} };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'token', text: 'finished' };
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
    } as any;
    const client = new AgentAIClient(provider, config, toolProvider, undefined, undefined,
      { eventLog: log, runId: 'r_test', agentName: 'a' });
    await client.run('hello');

    expect(lines.filter(l => l.event === 'llm.call').map(l => l.fields.turn)).toEqual([1, 2]);
  });

  it('records llm.error at WARN when the provider fails, and rethrows', async () => {
    const { lines, log } = fakeLog();
    const client = new AgentAIClient(
      fakeProvider({ type: 'error', message: 'rate limited' }),
      config, toolProvider, undefined, undefined,
      { eventLog: log, runId: 'r_test', agentName: 'a' },
    );
    await expect(client.run('hello')).rejects.toThrow(/rate limited/);

    const errors = lines.filter(l => l.event === 'llm.error');
    expect(errors).toHaveLength(1);
    expect(errors[0].level).toBe('WARN');
    expect(errors[0].message).toMatch(/rate limited/);
    expect(lines.filter(l => l.event === 'llm.call')).toHaveLength(0);
  });

  it('runs unchanged with no event log at all', async () => {
    const client = new AgentAIClient(
      fakeProvider({ type: 'token', text: 'ok' }, { type: 'done', stopReason: 'end_turn' }),
      config, toolProvider,
    );
    await expect(client.run('hello')).resolves.toBe('ok');
  });
});
