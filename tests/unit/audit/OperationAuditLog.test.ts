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

describe('OperationAuditLog — redaction and rotation', () => {
  let dir: string;
  let logPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-'));
    logPath = path.join(dir, 'operation-audit.log');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('redacts sensitive parameter values before they reach disk', () => {
    const log = new OperationAuditLog(logPath);
    log.log({
      operation: 'wpe.install.update',
      target: 'my-install',
      parameters: { api_token: 'super-secret-value', password: 'hunter2', install: 'my-install' },
      outcome: 'success',
    });

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('super-secret-value');
    expect(raw).not.toContain('hunter2');
    expect(raw).toContain('[REDACTED]');
    expect(raw).toContain('my-install'); // non-sensitive values survive
  });

  it('redacts nested sensitive values', () => {
    const log = new OperationAuditLog(logPath);
    log.log({
      operation: 'test.op',
      target: 't',
      parameters: { creds: { private_key: 'PEM-DATA-HERE' } },
      outcome: 'success',
    });
    expect(fs.readFileSync(logPath, 'utf-8')).not.toContain('PEM-DATA-HERE');
  });

  it('rotates the audit log once it exceeds the size cap', () => {
    const log = new OperationAuditLog(logPath, { maxBytes: 512, keep: 2 });
    // Each entry is well over 50 bytes; 40 entries comfortably exceeds 512.
    for (let i = 0; i < 40; i++) {
      log.log({ operation: 'test.op', target: `target-${i}`, parameters: {}, outcome: 'success' });
    }
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.statSync(logPath).size).toBeLessThan(512);
  });

  it('still returns the full entry to the caller', () => {
    const log = new OperationAuditLog(logPath);
    const entry = log.log({ operation: 'o', target: 't', parameters: {}, outcome: 'pending' });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(entry.outcome).toBe('pending');
  });

  it('does not throw when the log path is unwritable', () => {
    const log = new OperationAuditLog('/proc/nope/audit.log');
    expect(() => log.log({ operation: 'o', target: 't', parameters: {}, outcome: 'success' })).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // I2/I3 — value-level masking reaches the `error` field too. For a failed
  // WP-CLI or CAPI call `error` is raw tool output.
  // -------------------------------------------------------------------------

  it('masks credential-shaped values inside the error field', () => {
    const log = new OperationAuditLog(logPath);
    log.log({
      operation: 'cli.wp.command',
      target: 'prod-install',
      parameters: {},
      outcome: 'failure',
      error: "Error: could not connect to mysql://wpuser:hunter2pass@10.0.0.9/wp — check Authorization: Bearer sk-ant-api03-AbCdEf0123456789xyz",
    });

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('hunter2pass');
    expect(raw).not.toContain('sk-ant-api03-AbCdEf0123456789xyz');
    expect(raw).toContain('[REDACTED]');
    // Diagnostic context that is not a credential survives.
    expect(raw).toContain('could not connect');
  });

  it('masks an sk- key in a wp_eval `code` parameter (key-name matching cannot)', () => {
    const log = new OperationAuditLog(logPath);
    log.log({
      operation: 'wp_eval',
      target: 'my-site',
      parameters: { code: "update_option('acme_api_key', 'sk-live-Zz0123456789AbCdEfGh');" },
      outcome: 'success',
    });

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('sk-live-Zz0123456789AbCdEfGh');
    expect(raw).toContain('[REDACTED]');
    expect(raw).toContain('update_option'); // entry keeps its audit value
  });

  it('does not throw on a cyclic parameters object', () => {
    const log = new OperationAuditLog(logPath);
    const cyclic: Record<string, unknown> = { site: 'a' };
    cyclic.self = cyclic;
    expect(() =>
      log.log({ operation: 'agent/tool', target: 'a', parameters: cyclic, outcome: 'success' }),
    ).not.toThrow();
    expect(log.list()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// I1 — rotation must not amputate the compliance export.
// ---------------------------------------------------------------------------

describe('OperationAuditLog — list()/export() across rotated generations', () => {
  let dir: string;
  let logPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-gen-'));
    logPath = path.join(dir, 'operation-audit.log');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const COUNT = 20;
  // Entries are ~180 bytes, so 20 entries ≈ 3.6 KiB. A 1 KiB cap forces ~4
  // rotations; `keep: 8` leaves enough generations that none is dropped, which
  // lets these tests assert on the FULL set rather than "some of it".
  const OPTS = { maxBytes: 1024, keep: 8 };

  function fillAcrossRotations(log: OperationAuditLog, operationFor?: (i: number) => string): void {
    for (let i = 0; i < COUNT; i++) {
      log.log({
        operation: operationFor ? operationFor(i) : 'test.op',
        target: `target-${i}`,
        parameters: {},
        outcome: 'success',
      });
    }
  }

  /** Assert rotation really happened, and return the live file's entry count. */
  function assertRotated(): number {
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.existsSync(`${logPath}.2`)).toBe(true);
    const liveOnly = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean).length;
    expect(liveOnly).toBeLessThan(COUNT); // the live file alone is incomplete
    return liveOnly;
  }

  it('includes entries from rotated generations, newest first', () => {
    const log = new OperationAuditLog(logPath, OPTS);
    fillAcrossRotations(log);
    const liveOnly = assertRotated();

    const entries = log.list();
    expect(entries.length).toBeGreaterThan(liveOnly);
    expect(entries).toHaveLength(COUNT); // nothing lost to rotation
    // Newest first, and the very first entry written is still reachable.
    expect(entries[0].target).toBe(`target-${COUNT - 1}`);
    expect(entries[entries.length - 1].target).toBe('target-0');
  });

  it('keeps list() strictly chronological across the generation boundary', () => {
    const log = new OperationAuditLog(logPath, OPTS);
    fillAcrossRotations(log);
    assertRotated();

    const indices = log.list().map((e) => Number(e.target.replace('target-', '')));
    expect(indices).toHaveLength(COUNT);
    // list() is newest-first, so indices must strictly descend.
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeLessThan(indices[i - 1]);
    }
  });

  it('list() still honours limit when the newest entries span generations', () => {
    const log = new OperationAuditLog(logPath, OPTS);
    fillAcrossRotations(log);
    assertRotated();

    const limited = log.list(3);
    expect(limited.map((e) => e.target)).toEqual([
      `target-${COUNT - 1}`,
      `target-${COUNT - 2}`,
      `target-${COUNT - 3}`,
    ]);
  });

  it('export() writes every entry on disk, oldest first', () => {
    const log = new OperationAuditLog(logPath, OPTS);
    fillAcrossRotations(log);
    assertRotated();

    const exportPath = path.join(dir, 'export.jsonl');
    log.export(exportPath);

    const lines = fs.readFileSync(exportPath, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(COUNT);

    const parsed = lines.map((l) => JSON.parse(l) as AuditEntry);
    expect(parsed[0].target).toBe('target-0');
    expect(parsed[parsed.length - 1].target).toBe(`target-${COUNT - 1}`);
  });

  it('honours the operation filter across generations', () => {
    const log = new OperationAuditLog(logPath, OPTS);
    fillAcrossRotations(log, (i) => (i % 2 === 0 ? 'wpe.install.delete' : 'test.op'));
    assertRotated();

    const deletes = log.list(undefined, { operation: 'wpe.install.delete' });
    expect(deletes).toHaveLength(COUNT / 2);
    expect(deletes.every((e) => e.operation === 'wpe.install.delete')).toBe(true);
    // The oldest delete lives in a rotated generation.
    expect(deletes[deletes.length - 1].target).toBe('target-0');
  });

  it('drops generations beyond `keep` rather than growing without bound', () => {
    const log = new OperationAuditLog(logPath, { maxBytes: 512, keep: 2 });
    for (let i = 0; i < 200; i++) {
      log.log({ operation: 'test.op', target: `target-${i}`, parameters: {}, outcome: 'success' });
    }
    expect(fs.existsSync(`${logPath}.3`)).toBe(false);
    expect(log.list().length).toBeGreaterThan(0);
    // The newest entry is always present.
    expect(log.list()[0].target).toBe('target-199');
  });
});
