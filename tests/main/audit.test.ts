import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createAuditLogger,
  redactParams,
  maskSecretsInString,
  MAX_AUDIT_STRING_LENGTH,
  AuditEntry,
} from '../../src/main/mcp/audit';

describe('redactParams', () => {
  test('redacts password fields', () => {
    const result = redactParams({ username: 'admin', password: 'secret123' });
    expect(result.username).toBe('admin');
    expect(result.password).toBe('[REDACTED]');
  });

  test('redacts token fields', () => {
    const result = redactParams({ name: 'test', authToken: 'abc123' });
    expect(result.name).toBe('test');
    expect(result.authToken).toBe('[REDACTED]');
  });

  test('redacts secret fields', () => {
    const result = redactParams({ clientSecret: 'shhh', clientId: 'myapp' });
    expect(result.clientSecret).toBe('[REDACTED]');
    expect(result.clientId).toBe('myapp');
  });

  test('redacts key fields', () => {
    const result = redactParams({ apiKey: 'k-123', name: 'test' });
    expect(result.apiKey).toBe('[REDACTED]');
  });

  test('redacts certificate fields', () => {
    const result = redactParams({ certificate: 'PEM...', domain: 'example.com' });
    expect(result.certificate).toBe('[REDACTED]');
  });

  test('redacts private_key fields', () => {
    const result = redactParams({ private_key: 'RSA...', id: '123' });
    expect(result.private_key).toBe('[REDACTED]');
  });

  test('redacts nested objects', () => {
    const result = redactParams({
      config: { apiKey: 'k-123', name: 'test' },
    });
    expect((result.config as any).apiKey).toBe('[REDACTED]');
    expect((result.config as any).name).toBe('test');
  });

  test('redacts values in arrays', () => {
    const result = redactParams({
      items: [{ password: 'abc' }, { name: 'safe' }],
    });
    const items = result.items as any[];
    expect(items[0].password).toBe('[REDACTED]');
    expect(items[1].name).toBe('safe');
  });

  test('case-insensitive matching', () => {
    const result = redactParams({ PASSWORD: 'secret', API_KEY: 'k-123' });
    expect(result.PASSWORD).toBe('[REDACTED]');
    expect(result.API_KEY).toBe('[REDACTED]');
  });

  test('preserves non-sensitive values', () => {
    const result = redactParams({
      siteId: '123',
      slug: 'akismet',
      name: 'My Site',
      count: 42,
      active: true,
    });
    expect(result.siteId).toBe('123');
    expect(result.slug).toBe('akismet');
    expect(result.name).toBe('My Site');
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
  });

  test('handles null and undefined values', () => {
    const result = redactParams({ a: null, b: undefined });
    expect(result.a).toBeNull();
    expect(result.b).toBeUndefined();
  });

  test('handles empty object', () => {
    const result = redactParams({});
    expect(result).toEqual({});
  });

  // -------------------------------------------------------------------------
  // I3 — key patterns that used to slip through.
  // Note 'db_pass'.includes('password') is false, which is why these were
  // unmatched by the original substring-only list.
  // -------------------------------------------------------------------------

  test.each([
    ['db_pass', 'dbpassword'],
    ['pwd', 'p4ssw0rd'],
    ['auth', 'auth-value'],
    ['authorization', 'Basic YWJj'],
    ['Authorization', 'Basic YWJj'],
    ['bearer', 'bearer-value'],
    ['credential', 'cred-value'],
    ['credentials', 'cred-value'],
    ['cookie', 'wordpress_logged_in=abc'],
    ['session', 'sess-value'],
    ['sessionId', 'sess-value'],
    ['salt', 'salt-value'],
    ['signature', 'sig-value'],
    ['db_password', 'hunter2'],
  ])('redacts key %s', (key, value) => {
    const result = redactParams({ [key]: value });
    expect(result[key]).toBe('[REDACTED]');
  });

  test('does not redact ordinary keys that merely contain a sensitive substring', () => {
    // 'author'.includes('auth') is true — substring matching would gut this.
    const result = redactParams({ author: 'Automattic', monkey: 'patch', passenger: 'x' });
    expect(result.author).toBe('Automattic');
    expect(result.monkey).toBe('patch');
    expect(result.passenger).toBe('x');
  });

  // -------------------------------------------------------------------------
  // I2 — value-level masking, regardless of key name.
  // wp_eval's argument is literally named `code`, so key-name matching cannot
  // protect it.
  // -------------------------------------------------------------------------

  test('masks an sk- API key inside a wp_eval `code` payload', () => {
    const result = redactParams({
      code: "update_option('mysite_openai_api_key', 'sk-proj-AbCdEf0123456789ZzYyXx');",
    });
    expect(result.code).not.toContain('sk-proj-AbCdEf0123456789ZzYyXx');
    expect(result.code).toContain('[REDACTED]');
    // Surrounding context survives — the entry keeps its audit value.
    expect(result.code).toContain('update_option');
  });

  test('masks a PEM private key block under a non-sensitive key name', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAvSecretMaterialHere',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const result = redactParams({ notes: `deploy key follows\n${pem}\ndone` });
    expect(result.notes).not.toContain('MIIEowIBAAKCAQEAvSecretMaterialHere');
    expect(result.notes).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(result.notes).toContain('[REDACTED]');
  });

  test('masks GitHub tokens under a non-sensitive key name', () => {
    const ghp = redactParams({ command: 'git clone https://ghp_0123456789abcdefghijABCDEFGHIJ0123@x' });
    expect(ghp.command).not.toContain('ghp_0123456789abcdefghijABCDEFGHIJ0123');
    const pat = redactParams({ command: 'export T=github_pat_11ABCDEFG0123456789_abcdefghijklmnop' });
    expect(pat.command).not.toContain('github_pat_11ABCDEFG0123456789_abcdefghijklmnop');
  });

  test('masks credentials embedded in a connection string', () => {
    const result = redactParams({ dsn: 'mysql://wp_user:s3cr3tpw@10.0.0.4:3306/wordpress' });
    expect(result.dsn).not.toContain('s3cr3tpw');
    expect(result.dsn).toContain('wp_user'); // username is not the secret
    expect(result.dsn).toContain('10.0.0.4');
  });

  test('masks long opaque token-shaped runs', () => {
    const token = 'a1b2c3d4e5f6g7h8i9j0K1L2M3N4O5P6Q7R8S9T0uvwx';
    const result = redactParams({ note: `value ${token} end` });
    expect(result.note).not.toContain(token);
    expect(result.note).toContain('end');
  });

  test('leaves ordinary long prose alone', () => {
    const prose = 'This site has a very long description that goes on and on about nothing in particular at all.';
    const result = redactParams({ description: prose });
    expect(result.description).toBe(prose);
  });

  test('truncates very long string values', () => {
    const long = 'x'.repeat(MAX_AUDIT_STRING_LENGTH + 500);
    const result = redactParams({ code: long }) as { code: string };
    expect(result.code.length).toBeLessThan(long.length);
    expect(result.code).toContain('[truncated 500 chars]');
  });

  test('maskSecretsInString is exported and idempotent on clean input', () => {
    expect(maskSecretsInString('wp plugin update akismet')).toBe('wp plugin update akismet');
  });

  // -------------------------------------------------------------------------
  // M1 — the recursive walk must survive hostile input.
  // -------------------------------------------------------------------------

  test('does not blow up on a cyclic object', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    let result: Record<string, unknown> | undefined;
    expect(() => { result = redactParams(cyclic); }).not.toThrow();
    expect(result!.name).toBe('loop');
    expect(result!.self).toBe('[Circular]');
  });

  test('does not blow up on a cyclic array', () => {
    const arr: unknown[] = ['a'];
    arr.push(arr);
    expect(() => redactParams({ items: arr })).not.toThrow();
  });
});

describe('AuditLogger', () => {
  const makeEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
    timestamp: '2024-01-01T00:00:00.000Z',
    toolName: 'local_list_sites',
    tier: 1,
    params: {},
    confirmed: null,
    result: 'success',
    duration_ms: 10,
    ...overrides,
  });

  test('logs entries and returns them', () => {
    const logger = createAuditLogger();
    logger.log(makeEntry());
    logger.log(makeEntry({ toolName: 'local_start_site', tier: 2 }));

    const entries = logger.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].toolName).toBe('local_list_sites');
    expect(entries[1].toolName).toBe('local_start_site');
  });

  test('getEntries returns a copy', () => {
    const logger = createAuditLogger();
    logger.log(makeEntry());

    const entries1 = logger.getEntries();
    const entries2 = logger.getEntries();
    expect(entries1).not.toBe(entries2);
    expect(entries1).toEqual(entries2);
  });

  test('redacts sensitive params on log', () => {
    const logger = createAuditLogger();
    logger.log(makeEntry({ params: { siteId: '123', password: 'secret' } }));

    const entries = logger.getEntries();
    expect(entries[0].params.siteId).toBe('123');
    expect(entries[0].params.password).toBe('[REDACTED]');
  });

  test('flush writes NDJSON to disk', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-'));
    const logPath = path.join(tmpDir, 'audit.log');

    const logger = createAuditLogger(logPath);
    logger.log(makeEntry({ toolName: 'tool_a' }));
    logger.log(makeEntry({ toolName: 'tool_b' }));

    await logger.flush();

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).toolName).toBe('tool_a');
    expect(JSON.parse(lines[1]).toolName).toBe('tool_b');

    // Cleanup
    fs.unlinkSync(logPath);
    fs.rmdirSync(tmpDir);
  });

  test('flush clears entries after writing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-'));
    const logPath = path.join(tmpDir, 'audit.log');

    const logger = createAuditLogger(logPath);
    logger.log(makeEntry());
    expect(logger.getEntries()).toHaveLength(1);

    await logger.flush();
    expect(logger.getEntries()).toHaveLength(0);

    // Cleanup
    fs.unlinkSync(logPath);
    fs.rmdirSync(tmpDir);
  });

  test('flush is no-op without logPath', async () => {
    const logger = createAuditLogger();
    logger.log(makeEntry());
    await logger.flush(); // should not throw
    // entries remain since nothing was flushed to disk
  });

  test('flush is no-op when no entries', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-'));
    const logPath = path.join(tmpDir, 'audit.log');

    const logger = createAuditLogger(logPath);
    await logger.flush(); // should not throw, should not create file

    expect(fs.existsSync(logPath)).toBe(false);

    // Cleanup
    fs.rmdirSync(tmpDir);
  });

  test('flush creates directory if it does not exist', async () => {
    const tmpDir = path.join(os.tmpdir(), `nexus-audit-nested-${Date.now()}`);
    const logPath = path.join(tmpDir, 'sub', 'audit.log');

    const logger = createAuditLogger(logPath);
    logger.log(makeEntry());
    await logger.flush();

    expect(fs.existsSync(logPath)).toBe(true);

    // Cleanup
    fs.unlinkSync(logPath);
    fs.rmdirSync(path.join(tmpDir, 'sub'));
    fs.rmdirSync(tmpDir);
  });

  // C1 — flush() is now called on before-quit and every 5 minutes, so audit.log
  // exists in production for the first time. It is the higher-volume of the two
  // audit files and was the only durable writer left with no size cap.
  test('flush rotates audit.log once it exceeds the size cap', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-rot-'));
    const logPath = path.join(tmpDir, 'audit.log');

    const logger = createAuditLogger(logPath, { maxBytes: 1024, keep: 2 });

    // First flush writes well over 1 KiB, so the file exceeds the cap but has
    // not yet been rotated (rotation is checked before each append).
    for (let i = 0; i < 30; i++) logger.log(makeEntry({ toolName: `tool_${i}` }));
    await logger.flush();
    expect(fs.statSync(logPath).size).toBeGreaterThan(1024);
    expect(fs.existsSync(`${logPath}.1`)).toBe(false);

    // Second flush must rotate the oversized file out of the way first.
    logger.log(makeEntry({ toolName: 'after_rotation' }));
    await logger.flush();

    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.statSync(logPath).size).toBeLessThan(1024);
    const live = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(live).toHaveLength(1);
    expect(JSON.parse(live[0]).toolName).toBe('after_rotation');
    // History is preserved in the rotated generation, not truncated away.
    expect(fs.readFileSync(`${logPath}.1`, 'utf-8')).toContain('tool_0');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('flush does not rotate a file still under the cap', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-norot-'));
    const logPath = path.join(tmpDir, 'audit.log');

    const logger = createAuditLogger(logPath, { maxBytes: 1024 * 1024 });
    logger.log(makeEntry());
    await logger.flush();
    logger.log(makeEntry());
    await logger.flush();

    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
    expect(fs.readFileSync(logPath, 'utf-8').trim().split('\n')).toHaveLength(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('flush masks credential-shaped values in the error field', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-err-'));
    const logPath = path.join(tmpDir, 'audit.log');

    const logger = createAuditLogger(logPath);
    logger.log(makeEntry({
      result: 'error',
      error: "wp-cli failed: mysql://wp:tr0ub4dor@db.internal/wordpress",
    }));
    await logger.flush();

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('tr0ub4dor');
    expect(raw).toContain('[REDACTED]');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('flush appends to existing file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-audit-'));
    const logPath = path.join(tmpDir, 'audit.log');

    const logger = createAuditLogger(logPath);
    logger.log(makeEntry({ toolName: 'batch1' }));
    await logger.flush();

    logger.log(makeEntry({ toolName: 'batch2' }));
    await logger.flush();

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).toolName).toBe('batch1');
    expect(JSON.parse(lines[1]).toolName).toBe('batch2');

    // Cleanup
    fs.unlinkSync(logPath);
    fs.rmdirSync(tmpDir);
  });
});
