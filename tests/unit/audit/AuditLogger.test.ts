/**
 * S8 — the third durable audit sink.
 *
 * `src/main/audit/AuditLogger.ts` wrote `params` and `error` with NO masking at
 * all, persisted via `registryStorage` to
 * `~/Library/Application Support/Local/nexus_audit_logs.json` at mode 0644.
 * It has 24 write sites, five of which dump the raw IPC request object on
 * failure (`ipc-handlers.ts` WPE pull/push, `ipc/handlers/wpe-sync.ts`) — which
 * is how a `--user_pass` or an API token reached that file.
 *
 * The other two sinks (`mcp/audit.ts`, `audit/OperationAuditLog.ts`) redact
 * inside `log()`. This one now does too.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuditLogger, AuditLog, defaultAuditStorePath } from '../../../src/main/audit/AuditLogger';
import type { RegistryStorage } from '../../../src/main/content/IndexRegistry';

/** In-memory RegistryStorage stand-in — no SQLite, no Local services. */
function makeStorage(): RegistryStorage & { data: Record<string, any> } {
  const data: Record<string, any> = {};
  return {
    data,
    get: (key: string) => data[key] ?? null,
    set: (key: string, value: any) => { data[key] = value; },
  };
}

function stored(storage: { data: Record<string, any> }): AuditLog[] {
  return (storage.data['nexus_audit_logs'] ?? []) as AuditLog[];
}

describe('AuditLogger — redaction', () => {
  it('redacts sensitive params before they reach the store', () => {
    const storage = makeStorage();
    const logger = new AuditLogger(storage, '');

    logger.logSuccess('wpe_pull_to_local', 'acme-prod', 'wpe_install', {
      installName: 'acme-prod',
      password: 'hunter2',
      api_token: 'super-secret-value',
    });

    const raw = JSON.stringify(stored(storage));
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('super-secret-value');
    expect(raw).toContain('[REDACTED]');
    expect(raw).toContain('acme-prod'); // non-sensitive context survives
  });

  it('masks credential-shaped values in a raw IPC request object', () => {
    // Five call sites pass the whole IPC request through as `params` on failure.
    const storage = makeStorage();
    const logger = new AuditLogger(storage, '');

    logger.logFailure('wpe_pull_to_local', 'acme-prod', 'wpe_install', 'Pull failed', {
      request: { installId: 'i-1', wpeApiPassword: 'Tr0ub4dor&3' },
      command: ['config', 'set', 'DB_PASSWORD', 'Pr0dDbP4ssw0rd'],
      // Not on the withhold list, so it still exercises argv masking on this
      // sink — the name must survive while the value must not.
      unlistedArgv: ['config', 'set', 'AUTH_KEY', 'x8Tq2i9KdV4z'],
    });

    const raw = JSON.stringify(stored(storage));
    expect(raw).not.toContain('Tr0ub4dor&3');
    expect(raw).not.toContain('Pr0dDbP4ssw0rd');
    expect(raw).not.toContain('x8Tq2i9KdV4z');
    // CHANGED EXPECTATION (withhold list): `command` is withheld on this sink
    // too, so `DB_PASSWORD` no longer survives via that key. The "name
    // survives, value does not" property is now asserted on `unlistedArgv`.
    expect(raw).toContain('[WITHHELD: freeform input');
    expect(raw).toContain('AUTH_KEY');
  });

  it('masks credential-shaped values in the error field', () => {
    const storage = makeStorage();
    const logger = new AuditLogger(storage, '');

    logger.logFailure(
      'remote_wp_db_export',
      'acme-prod',
      'wpe_install',
      'could not connect to mysql://wpuser:hunter2pass@10.0.0.9/wp',
    );

    const entry = stored(storage)[0];
    expect(entry.error).not.toContain('hunter2pass');
    expect(entry.error).toContain('could not connect'); // diagnostic context survives
  });

  it('masks a bare credential in the 16-36 char band', () => {
    const storage = makeStorage();
    const logger = new AuditLogger(storage, '');

    logger.logSuccess('bulk_sync_credentials', 'acme-prod', 'wpe_install', {
      note: '0123456789abcdef0123456789abcdef',
    });

    expect(JSON.stringify(stored(storage))).not.toContain('0123456789abcdef0123456789abcdef');
  });

  it('still records ordinary params unchanged', () => {
    const storage = makeStorage();
    const logger = new AuditLogger(storage, '');

    logger.logSuccess('wpe_create_backup', 'acme-prod', 'wpe_install', {
      installId: 'i-123',
      description: 'nightly backup',
    });

    const entry = stored(storage)[0];
    expect(entry.params.installId).toBe('i-123');
    expect(entry.params.description).toBe('nightly backup');
    expect(entry.result).toBe('success');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('never throws on a cyclic params object', () => {
    const storage = makeStorage();
    const logger = new AuditLogger(storage, '');
    const cyclic: Record<string, unknown> = { site: 'a' };
    cyclic.self = cyclic;

    expect(() =>
      logger.logSuccess('bulk_setup_ai', 'a', 'bulk_operation', cyclic),
    ).not.toThrow();
    expect(stored(storage)).toHaveLength(1);
  });

  it('still enforces the 1000-entry cap', () => {
    const storage = makeStorage();
    const logger = new AuditLogger(storage, '');
    for (let i = 0; i < 1010; i++) {
      logger.logSuccess('op', `t-${i}`, 'registry', {});
    }
    const logs = stored(storage);
    expect(logs).toHaveLength(1000);
    expect(logs[logs.length - 1].target).toBe('t-1009');
  });
});

describe('AuditLogger — store permissions', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-auditstore-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('tightens an existing 0644 store to 0600', () => {
    const storePath = path.join(dir, 'nexus_audit_logs.json');
    fs.writeFileSync(storePath, '[]');
    fs.chmodSync(storePath, 0o644);
    expect(fs.statSync(storePath).mode & 0o777).toBe(0o644);

    const logger = new AuditLogger(makeStorage(), storePath);
    logger.logSuccess('wpe_delete_install', 'acme-prod', 'wpe_install', {});

    expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
  });

  it('does not throw when the store file does not exist', () => {
    const logger = new AuditLogger(makeStorage(), path.join(dir, 'absent.json'));
    expect(() => logger.logSuccess('op', 't', 'registry', {})).not.toThrow();
  });

  it('defaults to the real store path under Local application support', () => {
    expect(defaultAuditStorePath()).toContain(path.join('Local', 'nexus_audit_logs.json'));
  });
});
