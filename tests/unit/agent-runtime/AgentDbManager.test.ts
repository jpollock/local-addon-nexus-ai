import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { AgentDbManager } from '../../../src/main/agent-runtime/AgentDbManager';

function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-db-test-'));
  return d;
}

describe('AgentDbManager', () => {
  it('opens a database at the correct path', () => {
    const dir = tempDir();
    const mgr = new AgentDbManager(dir);
    const db = mgr.open('my-agent', 'logs');
    const dbPath = path.join(dir, 'my-agent', 'logs.sqlite');
    expect(fs.existsSync(dbPath)).toBe(true);
    mgr.closeAgent('my-agent');
    fs.rmSync(dir, { recursive: true });
  });

  it('returns the same connection on repeated open calls (idempotent)', () => {
    const dir = tempDir();
    const mgr = new AgentDbManager(dir);
    const a = mgr.open('agent', 'logs');
    const b = mgr.open('agent', 'logs');
    expect(a).toBe(b);
    mgr.closeAgent('agent');
    fs.rmSync(dir, { recursive: true });
  });

  it('closeAgent closes all databases for that agent', () => {
    const dir = tempDir();
    const mgr = new AgentDbManager(dir);
    const db = mgr.open('agent', 'logs') as unknown as { open: boolean };
    mgr.closeAgent('agent');
    expect(db.open).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });

  it('opens a fresh connection after closeAgent', () => {
    const dir = tempDir();
    const mgr = new AgentDbManager(dir);
    const first = mgr.open('agent', 'logs');
    mgr.closeAgent('agent');
    const second = mgr.open('agent', 'logs');
    expect(first).not.toBe(second);
    mgr.closeAgent('agent');
    fs.rmSync(dir, { recursive: true });
  });
});
