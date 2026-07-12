import Database from 'better-sqlite3';
import { AgentStateStore } from '../../../src/main/agent-runtime/AgentStateStore';

function makeStore() {
  const db = new Database(':memory:');
  return new AgentStateStore(db);
}

describe('AgentStateStore', () => {
  it('initializes schema on construction', () => {
    const db = new Database(':memory:');
    new AgentStateStore(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    expect(tables.map((t: any) => t.name)).toContain('agent_state');
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
