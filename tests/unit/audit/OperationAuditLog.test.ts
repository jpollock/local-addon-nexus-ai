/**
 * Unit tests for OperationAuditLog
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperationAuditLog, AuditEntry, webServedReason } from '../../../src/main/audit/OperationAuditLog';

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
    // A FILE standing where a DIRECTORY must be. That is a type error, not a
    // permission check, so it fails identically on every platform and is
    // unaffected by running as root — which a chmod-based unwritable path is
    // not, since root bypasses the mode bits.
    //
    // This was '/proc/nope/audit.log'. macOS has no /proc at all, so the write
    // failed instantly and the test passed. On Linux /proc is real procfs and
    //
    //     fs.mkdirSync('/proc/nope', { recursive: true })
    //
    // BLOCKS FOREVER — it neither returns nor throws, so log()'s try/catch
    // never fires. That one call stalled CI's shard 1 after six suites and hung
    // the job until it was killed; it went unseen for months because every
    // earlier CI run was cancelled before reaching this suite, and it can never
    // fail on a developer's Mac. Verified on linux/arm64 as uid 0: the old path
    // hangs indefinitely, this one throws EEXIST/ENOTDIR in 0ms.
    const blocker = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    const log = new OperationAuditLog(path.join(blocker, 'audit.log'));
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

  // CHANGED EXPECTATION (withhold list). `code` is no longer masked in place —
  // it is withheld, so the payload never reaches disk at all. The
  // `toContain('update_option')` assertion this test used to make is now
  // inverted on purpose: keeping the surrounding PHP was the old bargain, and
  // it is exactly what four rounds of review showed cannot be made safe.
  it('withholds a wp_eval `code` parameter — no part of it reaches disk', () => {
    const log = new OperationAuditLog(logPath);
    log.log({
      operation: 'wp_eval',
      target: 'my-site',
      parameters: { code: "update_option('acme_api_key', 'sk-live-Zz0123456789AbCdEfGh');" },
      outcome: 'success',
    });

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('sk-live-Zz0123456789AbCdEfGh');
    expect(raw).not.toContain('update_option');
    expect(raw).toContain('[WITHHELD: freeform input');
    // The operation is still fully identified.
    expect(raw).toContain('wp_eval');
    expect(raw).toContain('my-site');
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

  // -------------------------------------------------------------------------
  // S6 — export destination safety.
  //
  // export() takes a caller-supplied path, mkdir -p's it, and writes the
  // COMPLETE de-rotated trail — every generation. A path under
  // ~/Local Sites/<site>/app/public/ is served over HTTP by nginx.
  // -------------------------------------------------------------------------

  describe('export destination validation', () => {
    it.each([
      ['Local site webroot', '/Users/someone/Local Sites/acme/app/public/audit.jsonl'],
      ['app/public anywhere', '/srv/myproject/app/public/audit.jsonl'],
      ['wp-content', '/var/sites/acme/wp-content/uploads/audit.jsonl'],
      ['public_html', '/home/acme/public_html/audit.jsonl'],
      ['htdocs', '/opt/htdocs/audit.jsonl'],
      ['www', '/var/www/audit.jsonl'],
    ])('refuses to export into %s', (_label, target) => {
      const log = new OperationAuditLog(logPath);
      log.log({ operation: 'wpe.install.delete', target: 'acme-prod', parameters: {}, outcome: 'success' });

      expect(() => log.export(target)).toThrow(/Refusing to export/);
      // Nothing is written when it refuses.
      expect(fs.existsSync(target)).toBe(false);
    });

    it('allows an ordinary destination and writes the entries', () => {
      const log = new OperationAuditLog(logPath);
      log.log({ operation: 'wpe.install.delete', target: 'acme-prod', parameters: {}, outcome: 'success' });

      const out = path.join(dir, 'exports', 'audit.jsonl');
      expect(() => log.export(out)).not.toThrow();
      expect(fs.readFileSync(out, 'utf-8')).toContain('acme-prod');
    });

    it('forces 0600 even when overwriting an existing world-readable file', () => {
      const log = new OperationAuditLog(logPath);
      log.log({ operation: 'wpe.install.delete', target: 'acme-prod', parameters: {}, outcome: 'success' });

      // writeFileSync's `mode` only applies at CREATION, so an export over an
      // existing 0644 file kept 0644 until the explicit chmod was added.
      const out = path.join(dir, 'audit-export.jsonl');
      fs.writeFileSync(out, 'stale', { mode: 0o644 });
      fs.chmodSync(out, 0o644);
      expect(fs.statSync(out).mode & 0o777).toBe(0o644);

      log.export(out);
      expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    });

    it('creates a fresh export at 0600', () => {
      const log = new OperationAuditLog(logPath);
      log.log({ operation: 'o', target: 't', parameters: {}, outcome: 'success' });
      const out = path.join(dir, 'fresh.jsonl');
      log.export(out);
      expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    });

    it('webServedReason names a safe path as safe', () => {
      expect(webServedReason('/Users/someone/Desktop/audit.jsonl')).toBeNull();
      expect(webServedReason('/tmp/nexus/audit.jsonl')).toBeNull();
    });

    it('webServedReason explains why a webroot is rejected', () => {
      expect(webServedReason('/Users/x/Local Sites/acme/app/public/a.jsonl')).toMatch(/Local Sites/);
      expect(webServedReason('/srv/app/public/a.jsonl')).toMatch(/app\/public/);
    });
  });

  // -------------------------------------------------------------------------
  // S7 — `target` is masked like every other string field.
  // -------------------------------------------------------------------------

  describe('target masking', () => {
    it('masks a credential-shaped target', () => {
      const log = new OperationAuditLog(logPath);
      log.log({
        operation: 'wpe.install.delete',
        target: 'install-0123456789abcdef0123456789abcdef',
        parameters: {},
        outcome: 'success',
      });
      const raw = fs.readFileSync(logPath, 'utf-8');
      expect(raw).not.toContain('0123456789abcdef0123456789abcdef');
    });

    it('leaves ordinary install names alone', () => {
      const log = new OperationAuditLog(logPath);
      log.log({ operation: 'wpe.install.delete', target: 'acme-prod', parameters: {}, outcome: 'success' });
      expect(log.list()[0].target).toBe('acme-prod');
    });

    // STRENGTHENED. `acme-prod` is 9 characters, hyphenated, and carries no
    // digit, so it clears `looksOpaque` on three separate counts and could
    // never have detected the real bug: WPE caps install names at 20 chars
    // (`create-install.ts:48` rejects 21+), so a hyphen-free 20-character name
    // with a digit is LEGAL and matched the opaque-run rule exactly. It landed
    // on the one field saying which production install was operated on.
    it.each([
      ['exactly 20 chars, no hyphen, with digits', 'acmeprod2026staging1'],
      ['20 chars, all lowercase alnum', 'wpengineproductions1'],
      ['20 chars with a hyphen', 'acme-prod-2026-live1'],
    ])('keeps a legal WPE install name as the target (%s)', (_label, name) => {
      expect((name as string).length).toBe(20); // the boundary is the point
      const log = new OperationAuditLog(logPath);
      log.log({ operation: 'wpe.install.delete', target: name as string, parameters: {}, outcome: 'success' });

      expect(log.list()[0].target).toBe(name);
      expect(fs.readFileSync(logPath, 'utf-8')).toContain(name as string);
    });

    it('keeps a legal install name in the `install_name` parameter too', () => {
      const log = new OperationAuditLog(logPath);
      log.log({
        operation: 'wpe.install.delete',
        target: 'wpe:acmeprod2026staging1',
        parameters: { install_name: 'acmeprod2026staging1', installName: 'acmeprod2026staging1' },
        outcome: 'success',
      });
      const entry = log.list()[0];
      expect(entry.parameters.install_name).toBe('acmeprod2026staging1');
      expect(entry.parameters.installName).toBe('acmeprod2026staging1');
    });

    // The carve-out must not become a hole: it applies only when the WHOLE
    // value is a legal install name, so anything longer is masked as before.
    it('still masks an opaque target that is not a legal install name', () => {
      const log = new OperationAuditLog(logPath);
      log.log({
        operation: 'wpe.install.delete',
        target: 'acmeprod2026staging12', // 21 chars — one over the WPE cap
        parameters: { install_name: 'AcmeProd2026Staging1' }, // uppercase is illegal
        outcome: 'success',
      });
      const raw = fs.readFileSync(logPath, 'utf-8');
      expect(raw).not.toContain('acmeprod2026staging12');
      expect(raw).not.toContain('AcmeProd2026Staging1');
    });

    it('still masks a vendor-prefixed key even under an identity field', () => {
      // Only the generic opaque-run rule is skipped; every other pattern runs.
      const log = new OperationAuditLog(logPath);
      log.log({
        operation: 'wpe.install.delete',
        target: 'key-0a1b2c3d4e5f67',
        parameters: {},
        outcome: 'success',
      });
      expect(fs.readFileSync(logPath, 'utf-8')).not.toContain('key-0a1b2c3d4e5f67');
    });
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
