import Database from 'better-sqlite3';
import { AgentEventBus } from '../../../src/main/agent-event-bus/AgentEventBus';
import type { NexusEvent } from '../../../src/main/agent-sdk/types';

function makeEvent(namespace: string, type: string, siteId?: string): NexusEvent {
  return {
    namespace,
    type,
    key: `${namespace}:${type}`,
    payload: {},
    createdAt: Date.now(),
    siteId,
  };
}

function makeBus() {
  const db = new Database(':memory:');
  return new AgentEventBus(db);
}

describe('AgentEventBus', () => {
  it('creates schema on construction', () => {
    const db = new Database(':memory:');
    new AgentEventBus(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    expect(tables.map((t: any) => t.name)).toContain('agent_events');
  });

  it('publish persists event to SQLite', () => {
    const db = new Database(':memory:');
    const bus = new AgentEventBus(db);
    bus.publish(makeEvent('wp', 'post.published'));
    const rows = db.prepare('SELECT * FROM agent_events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].namespace).toBe('wp');
    expect(rows[0].type).toBe('post.published');
  });

  it('subscribe and receive exact event key', () => {
    const bus = makeBus();
    const received: NexusEvent[] = [];
    bus.subscribe('wp:post.published', (e) => { received.push(e); });
    bus.publish(makeEvent('wp', 'post.published'));
    expect(received).toHaveLength(1);
    expect(received[0].key).toBe('wp:post.published');
  });

  it('pattern wp:post.* matches post.published and post.deleted but not post', () => {
    const bus = makeBus();
    const received: string[] = [];
    bus.subscribe('wp:post.*', (e) => { received.push(e.key); });
    bus.publish(makeEvent('wp', 'post.published'));
    bus.publish(makeEvent('wp', 'post.deleted'));
    bus.publish(makeEvent('wp', 'post'));
    bus.publish(makeEvent('wpe', 'deploy.completed'));
    expect(received).toEqual(['wp:post.published', 'wp:post.deleted']);
  });

  it('pattern wpe:* matches all wpe events', () => {
    const bus = makeBus();
    const received: string[] = [];
    bus.subscribe('wpe:*', (e) => { received.push(e.key); });
    bus.publish(makeEvent('wpe', 'deploy.completed'));
    bus.publish(makeEvent('wpe', 'backup.finished'));
    bus.publish(makeEvent('wp', 'post.published'));
    expect(received).toEqual(['wpe:deploy.completed', 'wpe:backup.finished']);
  });

  it('unsubscribe stops receiving events', () => {
    const bus = makeBus();
    const received: NexusEvent[] = [];
    const unsub = bus.subscribe('wp:*', (e) => { received.push(e); });
    bus.publish(makeEvent('wp', 'post.published'));
    unsub();
    bus.publish(makeEvent('wp', 'post.deleted'));
    expect(received).toHaveLength(1);
  });

  it('replay returns events since timestamp matching pattern', () => {
    const bus = makeBus();
    const t0 = Date.now() - 1000;
    bus.publish(makeEvent('wp', 'post.published'));
    bus.publish(makeEvent('wpe', 'deploy.completed'));
    const events = bus.replay(t0, 'wp:*');
    expect(events).toHaveLength(1);
    expect(events[0].key).toBe('wp:post.published');
  });

  it('pruneOldEvents removes events older than cutoff', () => {
    const db = new Database(':memory:');
    const bus = new AgentEventBus(db);
    const old = makeEvent('wp', 'post.published');
    old.createdAt = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31 days ago
    bus.publish(old);
    bus.publish(makeEvent('wp', 'post.deleted'));
    bus.pruneOldEvents(30);
    const rows = db.prepare('SELECT * FROM agent_events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('post.deleted');
  });
});
