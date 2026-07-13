import Database from 'better-sqlite3';
import { AgentStateStore } from '../../../src/main/agent-runtime/AgentStateStore';
import type { AgentResult } from '../../../src/main/agent-sdk/types';

function makeStore() {
  const db = new Database(':memory:');
  return new AgentStateStore(db);
}

function makeResult(name: string, status: AgentResult['status'] = 'success', offset = 0): AgentResult {
  return { agentName: name, startedAt: 1000 + offset, finishedAt: 2000 + offset, status };
}

describe('AgentStateStore', () => {
  it('initializes schema on construction', () => {
    const db = new Database(':memory:');
    new AgentStateStore(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    const tableNames = tables.map((t: any) => t.name);
    expect(tableNames).toContain('agent_state');
    expect(tableNames).toContain('agent_runs');
  });

  it('set and get a value', () => {
    const store = makeStore();
    store.set('my-agent', 'foo', { bar: 42 });
    expect(store.get('my-agent', 'foo')).toEqual({ bar: 42 });
  });

  it('get returns undefined for missing key', () => {
    const store = makeStore();
    expect(store.get('my-agent', 'missing')).toBeUndefined();
  });

  it('delete removes a key', () => {
    const store = makeStore();
    store.set('my-agent', 'foo', 'hello');
    store.delete('my-agent', 'foo');
    expect(store.get('my-agent', 'foo')).toBeUndefined();
  });

  it('clear removes all keys for an agent', () => {
    const store = makeStore();
    store.set('my-agent', 'a', 1);
    store.set('my-agent', 'b', 2);
    store.set('other-agent', 'c', 3);
    store.clear('my-agent');
    expect(store.get('my-agent', 'a')).toBeUndefined();
    expect(store.get('my-agent', 'b')).toBeUndefined();
    expect(store.get('other-agent', 'c')).toBe(3);  // other agent unaffected
  });

  it('buildHandle provides scoped get/set/delete with scratch', () => {
    const store = makeStore();
    const handle = store.buildHandle('my-agent');
    handle.set('x', 99);
    expect(handle.get('x')).toBe(99);
    handle.scratch.temp = 'ephemeral';
    expect(handle.scratch.temp).toBe('ephemeral');
    handle.delete('x');
    expect(handle.get('x')).toBeUndefined();
  });
});

describe('AgentStateStore run history', () => {
  it('getLastRun returns undefined when no runs recorded', () => {
    const store = makeStore();
    expect(store.getLastRun('missing')).toBeUndefined();
  });

  it('recordRun persists and getLastRun retrieves it', () => {
    const store = makeStore();
    store.recordRun(makeResult('hello-nexus'));
    const run = store.getLastRun('hello-nexus');
    expect(run?.status).toBe('success');
    expect(run?.agentName).toBe('hello-nexus');
  });

  it('getLastRun returns the most recent run', () => {
    const store = makeStore();
    store.recordRun(makeResult('a', 'success', 0));
    store.recordRun(makeResult('a', 'error', 100));
    expect(store.getLastRun('a')?.status).toBe('error');
  });

  it('retains only last 100 runs per agent', () => {
    const store = makeStore();
    for (let i = 0; i < 105; i++) {
      store.recordRun(makeResult('b', 'success', i));
    }
    // After 105 inserts with 100-row cap, there should be 100 rows for agent 'b'
    const db = (store as any).db as import('better-sqlite3').Database;
    const count = (db.prepare('SELECT COUNT(*) as c FROM agent_runs WHERE agent_name = ?').get('b') as any).c;
    expect(count).toBe(100);
  });

  it('recordRun with error preserves error string', () => {
    const store = makeStore();
    store.recordRun({ agentName: 'x', startedAt: 1, finishedAt: 2, status: 'error', error: 'boom' });
    expect(store.getLastRun('x')?.error).toBe('boom');
  });
});
