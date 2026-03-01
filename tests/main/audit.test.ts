import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAuditLogger, redactParams, AuditEntry } from '../../src/main/mcp/audit';

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
