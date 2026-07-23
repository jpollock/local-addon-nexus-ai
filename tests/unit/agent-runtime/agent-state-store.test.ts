import Database from 'better-sqlite3';
import { AgentStateStore } from '../../../src/main/agent-runtime/AgentStateStore';

function makeStore() {
  const db = new Database(':memory:');
  return new AgentStateStore(db);
}

describe('AgentStateStore', () => {
  describe('getRunHistory', () => {
    it('returns empty array when no runs recorded', () => {
      const store = makeStore();
      expect(store.getRunHistory('my-agent')).toEqual([]);
    });

    it('returns runs newest-first', () => {
      const store = makeStore();
      store.recordRun({ agentName: 'a', startedAt: 1000, finishedAt: 2000, status: 'success', summary: 'all clean', findings: [] });
      store.recordRun({ agentName: 'a', startedAt: 3000, finishedAt: 4000, status: 'success', summary: 'found one', findings: [{ id: '1', severity: 'high', title: 'test' }] });
      const rows = store.getRunHistory('a');
      expect(rows[0].startedAt).toBe(3000);
      expect(rows[0].findingsCount).toBe(1);
      expect(rows[0].summary).toBe('found one');
      expect(rows[1].startedAt).toBe(1000);
      expect(rows[1].findingsCount).toBe(0);
    });

    it('respects limit', () => {
      const store = makeStore();
      for (let i = 0; i < 5; i++) {
        store.recordRun({ agentName: 'b', startedAt: i * 1000, finishedAt: i * 1000 + 500, status: 'success' });
      }
      expect(store.getRunHistory('b', 3)).toHaveLength(3);
    });

    it('does not return runs for other agents', () => {
      const store = makeStore();
      store.recordRun({ agentName: 'agent-x', startedAt: 1000, finishedAt: 2000, status: 'success' });
      expect(store.getRunHistory('agent-y')).toHaveLength(0);
    });
  });
});
