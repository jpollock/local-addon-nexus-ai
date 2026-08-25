/**
 * WP-57 Task 8 · `agent_runs` joins the ledger.
 *
 * Two columns, one of them long overdue: `task_id` is new, and `run_id` has
 * been WRITTEN since WP-19 and never read back — `SELECT *` fetched it and the
 * row mapping dropped it, so the diagnostic log and the run history had no
 * join at all. Both are pinned here.
 */
import Database from 'better-sqlite3';
import { AgentStateStore } from '../../../src/main/agent-runtime/AgentStateStore';

function store(): AgentStateStore {
  return new AgentStateStore(new Database(':memory:'));
}

describe('WP-57 · agent_runs carries both ids', () => {
  it('stores and reads back the task id', () => {
    const s = store();
    s.recordRun({
      agentName: 'a', startedAt: 1, finishedAt: 2, status: 'success',
      runId: 'r_1', taskId: 'task_01M0K5X3R17VEHR26JGA2RV931',
    });
    expect(s.getRunHistory('a', 1)[0].taskId).toBe('task_01M0K5X3R17VEHR26JGA2RV931');
  });

  it('reads back the run id too — written since WP-19, never returned', () => {
    const s = store();
    s.recordRun({ agentName: 'a', startedAt: 1, finishedAt: 2, status: 'success', runId: 'r_1' });
    expect(s.getRunHistory('a', 1)[0].runId).toBe('r_1');
  });

  it('leaves both undefined for an unframed run rather than inventing them', () => {
    const s = store();
    s.recordRun({ agentName: 'a', startedAt: 1, finishedAt: 2, status: 'success' });
    const row = s.getRunHistory('a', 1)[0];
    expect(row.taskId).toBeUndefined();
    expect(row.runId).toBeUndefined();
  });
});
