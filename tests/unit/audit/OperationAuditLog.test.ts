/**
 * Unit tests for OperationAuditLog
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperationAuditLog, AuditEntry } from '../../../src/main/audit/OperationAuditLog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempLogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-test-'));
  return path.join(dir, 'audit.log');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OperationAuditLog', () => {
  // 1. log() appends entry to log file
  it('appends a valid JSON line to the log file for each call', () => {
    const logPath = makeTempLogPath();
    const auditLog = new OperationAuditLog(logPath);

    auditLog.log({
      operation: 'wpe.backup.create',
      target: 'my-install',
      parameters: { description: 'test backup' },
      outcome: 'success',
    });

    expect(fs.existsSync(logPath)).toBe(true);

    const content = fs.readFileSync(logPath, 'utf-8').trim();
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry: AuditEntry = JSON.parse(lines[0]);
    expect(entry.operation).toBe('wpe.backup.create');
    expect(entry.target).toBe('my-install');
    expect(entry.outcome).toBe('success');
    expect(typeof entry.id).toBe('string');
    expect(entry.id).toHaveLength(36); // UUID format
    expect(typeof entry.timestamp).toBe('string');
  });

  // 2. list() returns entries in reverse chronological order
  it('returns entries in reverse chronological order (newest first)', () => {
    const logPath = makeTempLogPath();
    const auditLog = new OperationAuditLog(logPath);

    auditLog.log({ operation: 'wpe.backup.create', target: 'install-1', parameters: {}, outcome: 'success' });
    auditLog.log({ operation: 'wpe.install.delete', target: 'install-2', parameters: {}, outcome: 'failure', error: 'Not found' });
    auditLog.log({ operation: 'wpe.backup.create', target: 'install-3', parameters: {}, outcome: 'pending' });

    const entries = auditLog.list();
    expect(entries).toHaveLength(3);
    // Newest (install-3) should be first
    expect(entries[0].target).toBe('install-3');
    expect(entries[1].target).toBe('install-2');
    expect(entries[2].target).toBe('install-1');
  });

  // 3. export() writes valid JSONL
  it('export() writes all entries as valid JSONL to the output path', () => {
    const logPath = makeTempLogPath();
    const exportPath = makeTempLogPath() + '.export.jsonl';
    const auditLog = new OperationAuditLog(logPath);

    auditLog.log({ operation: 'wpe.backup.create', target: 'a', parameters: { foo: 1 }, outcome: 'success' });
    auditLog.log({ operation: 'wpe.backup.create', target: 'b', parameters: { foo: 2 }, outcome: 'failure', error: 'oops' });

    auditLog.export(exportPath);

    expect(fs.existsSync(exportPath)).toBe(true);
    const content = fs.readFileSync(exportPath, 'utf-8').trim();
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    // Both lines must be parseable JSON
    const parsed = lines.map((l) => JSON.parse(l) as AuditEntry);
    // export is chronological (oldest first)
    expect(parsed[0].target).toBe('a');
    expect(parsed[1].target).toBe('b');
    expect(parsed[1].error).toBe('oops');
  });

  // 4. list() filters by operation correctly
  it('filters entries by operation when filter.operation is provided', () => {
    const logPath = makeTempLogPath();
    const auditLog = new OperationAuditLog(logPath);

    auditLog.log({ operation: 'wpe.backup.create', target: 'a', parameters: {}, outcome: 'success' });
    auditLog.log({ operation: 'wpe.install.delete', target: 'b', parameters: {}, outcome: 'success' });
    auditLog.log({ operation: 'wpe.backup.create', target: 'c', parameters: {}, outcome: 'failure' });

    const backups = auditLog.list(undefined, { operation: 'wpe.backup.create' });
    expect(backups).toHaveLength(2);
    expect(backups.every((e) => e.operation === 'wpe.backup.create')).toBe(true);

    const deletes = auditLog.list(undefined, { operation: 'wpe.install.delete' });
    expect(deletes).toHaveLength(1);
    expect(deletes[0].target).toBe('b');
  });

  // 5. list() respects limit parameter
  it('respects the limit parameter', () => {
    const logPath = makeTempLogPath();
    const auditLog = new OperationAuditLog(logPath);

    for (let i = 0; i < 10; i++) {
      auditLog.log({ operation: 'wpe.backup.create', target: `install-${i}`, parameters: {}, outcome: 'success' });
    }

    const limited = auditLog.list(3);
    expect(limited).toHaveLength(3);
    // Should be the 3 newest
    expect(limited[0].target).toBe('install-9');
    expect(limited[1].target).toBe('install-8');
    expect(limited[2].target).toBe('install-7');
  });

  // 6. list() returns empty array when log file does not exist
  it('returns an empty array when the log file does not exist', () => {
    const logPath = '/tmp/nexus-audit-nonexistent-' + Date.now() + '.log';
    const auditLog = new OperationAuditLog(logPath);
    const entries = auditLog.list();
    expect(entries).toEqual([]);
  });

  // 7. log() creates directory if it doesn't exist
  it('creates the log directory if it does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-dir-'));
    const nestedPath = path.join(tmpDir, 'sub', 'dir', 'audit.log');
    const auditLog = new OperationAuditLog(nestedPath);

    auditLog.log({ operation: 'test', target: 'x', parameters: {}, outcome: 'success' });

    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  // 8. Each log entry has a unique UUID id
  it('assigns a unique UUID to each log entry', () => {
    const logPath = makeTempLogPath();
    const auditLog = new OperationAuditLog(logPath);

    auditLog.log({ operation: 'op1', target: 'a', parameters: {}, outcome: 'success' });
    auditLog.log({ operation: 'op2', target: 'b', parameters: {}, outcome: 'failure' });

    const entries = auditLog.list();
    const ids = entries.map((e) => e.id);
    // All IDs are unique
    expect(new Set(ids).size).toBe(ids.length);
    // All IDs look like UUIDs (36 chars with dashes)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
