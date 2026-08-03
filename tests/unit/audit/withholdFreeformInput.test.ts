/**
 * S10 — freeform command surfaces are WITHHELD, not masked.
 *
 * Four review rounds found four credential-exposure paths on this branch, and
 * every one of them was on a freeform command surface: `wp_eval`'s `code`,
 * `nexusWpCommand`'s argv array, `SentinelExecutor`'s command strings. Not one
 * was a structured tool parameter. Each round's fix then shipped defects of its
 * own inside the security code it had just written.
 *
 * So the syntax is no longer written at all. These tests assert the property
 * that matters — the value is ABSENT FROM THE FILE ON DISK — rather than
 * inspecting the returned object, because the object is not the artifact that
 * leaks.
 *
 * No SQLite: every sink here is backed by a temp file or an inert storage stub.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperationAuditLog } from '../../../src/main/audit/OperationAuditLog';
import { AuditLogger } from '../../../src/main/audit/AuditLogger';
import {
  createAuditLogger,
  redactParams,
  isFreeformField,
  withheldMarker,
  WITHHELD_PREFIX,
} from '../../../src/main/mcp/audit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-withhold-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const logPath = () => path.join(dir, 'operation-audit.log');

/**
 * A RegistryStorage stub that actually persists to disk, the way Local's does.
 * `AuditLogger` writes through `storage.set`, so this is the real artifact for
 * that sink rather than a proxy for it.
 */
function makeFileStorage(file: string) {
  return {
    get: (_k: string) => {
      try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
    },
    set: (_k: string, v: unknown) => { fs.writeFileSync(file, JSON.stringify(v)); },
  } as any;
}

/**
 * The credential every case embeds. Distinctive enough that a substring search
 * over the whole file cannot produce a false pass.
 */
const SECRET = 'sk_live_51H8xYzAbCdEfGhIjKlMnOp';

// ---------------------------------------------------------------------------
// The list itself
// ---------------------------------------------------------------------------

describe('freeform field list', () => {
  it.each([
    ['code', 'wp_eval PHP'],
    ['command', 'nexusWpCommand / ipc.wp.command argv'],
    ['commands', 'nexus:sentinel:execute command lines'],
    ['args', 'raw IPC request argv dumps'],
    ['argv', 'argv by its other name'],
    ['query', 'fleet_sql SQL'],
    ['sql', 'forward-looking'],
    ['script', 'forward-looking'],
    ['patch', 'nexus_update_settings JSON blob'],
  ])('recognises %s (%s)', (key) => {
    expect(isFreeformField(key as string)).toBe(true);
  });

  // Names are normalised (lowercased, `_`/`-` stripped) before matching.
  it.each(['Command', 'COMMANDS', 'Args', 'SQL'])(
    'is case-insensitive: %s', (key) => {
      expect(isFreeformField(key)).toBe(true);
    },
  );

  // Matching is EXACT, not tokenised. Tokenising `code` would withhold
  // `statusCode`, `errorCode` and `zipCode`, which are ordinary audit content.
  it.each([
    'statusCode', 'errorCode', 'zipCode', 'countryCode',
    'title', 'content', 'search', 'replace', 'value', 'option',
    'prompt', 'system', 'input', 'name', 'target', 'installName',
  ])('does not treat %s as freeform', (key) => {
    expect(isFreeformField(key)).toBe(false);
  });
});

describe('withheld marker', () => {
  it('reports the length of a string', () => {
    expect(withheldMarker('x'.repeat(412))).toBe(`${WITHHELD_PREFIX}, 412 chars]`);
  });

  it('reports element count and total length of an array', () => {
    expect(withheldMarker(['ab', 'cde'])).toBe(`${WITHHELD_PREFIX}, 2 elements, 5 chars]`);
  });

  it('is an explicit marker, never a deletion', () => {
    // An entry whose field simply vanished reads as an operation that took no
    // arguments. The key must remain, carrying the marker.
    const out = redactParams({ code: 'x' });
    expect(Object.keys(out)).toContain('code');
    expect(String(out.code)).toContain('WITHHELD');
  });
});

// ---------------------------------------------------------------------------
// Sink 1 — OperationAuditLog (durable JSONL)
// ---------------------------------------------------------------------------

describe('OperationAuditLog withholds freeform input', () => {
  it.each([
    ['code (wp_eval)', 'wp_eval', 'code', `update_option('stripe_key','${SECRET}');`],
    ['command (argv)', 'cli.wp.command', 'command', ['config', 'set', 'DB_PASSWORD', SECRET]],
    ['commands (sentinel)', 'ipc.sentinel.execute', 'commands', [`wp config set DB_PASSWORD ${SECRET}`]],
    ['query (fleet_sql)', 'fleet_sql', 'query', `SELECT * FROM sites WHERE api_token = '${SECRET}'`],
    ['args', 'ipc.wp.command', 'args', ['user', 'meta', 'update', '1', 'api_token', SECRET]],
    ['argv', 'ipc.wp.command', 'argv', ['eval', `echo '${SECRET}';`]],
    ['sql', 'fleet_sql', 'sql', `SELECT '${SECRET}'`],
    ['script', 'agent/run', 'script', `#!/bin/sh\necho ${SECRET}`],
    ['patch', 'nexus_update_settings', 'patch', `{"anthropicApiKey":"${SECRET}"}`],
  ])('withholds %s', (_label, operation, key, value) => {
    const log = new OperationAuditLog(logPath());
    log.log({
      operation: operation as string,
      target: 'acme-prod',
      parameters: { [key as string]: value, siteId: 'site-1' },
      outcome: 'success',
    });

    const raw = fs.readFileSync(logPath(), 'utf-8');

    // The property that matters: the value is not on disk, in any form.
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('DB_PASSWORD');
    expect(raw).not.toContain('SELECT');

    // The entry still exists and still identifies the operation.
    const entry = log.list()[0];
    expect(entry.operation).toBe(operation);
    expect(entry.target).toBe('acme-prod');
    expect(entry.outcome).toBe('success');
    // Structured siblings are untouched — withholding is per-field.
    expect(entry.parameters.siteId).toBe('site-1');
    // The field is present and explicitly marked, not deleted.
    expect(String(entry.parameters[key as string])).toContain(WITHHELD_PREFIX);
  });

  // The brief's headline case, stated on its own so it cannot be lost in a
  // parameterised list.
  it('never writes a live Stripe key embedded in a wp_eval `code` payload', () => {
    const log = new OperationAuditLog(logPath());
    log.log({
      operation: 'wp_eval',
      target: 'my-site',
      parameters: {
        code: "update_option('stripe_key','sk_live_51H8xYzAbCdEfGhIjKlMnOpQrStUv');",
        _tier: 3,
      },
      outcome: 'success',
    });

    const raw = fs.readFileSync(logPath(), 'utf-8');
    expect(raw).not.toContain('sk_live_51H8xYzAbCdEfGhIjKlMnOpQrStUv');
    expect(raw).not.toContain('sk_live');
    expect(raw).not.toContain('stripe_key');
    expect(raw).not.toContain('update_option');
    expect(raw).toContain(WITHHELD_PREFIX);
    // The operation is still fully attributable.
    expect(raw).toContain('wp_eval');
    expect(raw).toContain('my-site');
  });

  it('withholds a nested freeform field too', () => {
    const log = new OperationAuditLog(logPath());
    log.log({
      operation: 'agent/tool',
      target: 'acme-prod',
      parameters: { payload: { nested: { code: `echo '${SECRET}';` } } },
      outcome: 'success',
    });
    expect(fs.readFileSync(logPath(), 'utf-8')).not.toContain(SECRET);
  });
});

// ---------------------------------------------------------------------------
// Sink 2 — the buffered logger in mcp/audit.ts
// ---------------------------------------------------------------------------

describe('buffered audit logger withholds freeform input', () => {
  it('does not flush a wp_eval `code` payload to disk', async () => {
    const file = path.join(dir, 'audit.log');
    const logger = createAuditLogger(file);

    logger.log({
      timestamp: new Date().toISOString(),
      toolName: 'wp_eval',
      tier: 3,
      params: { code: `update_option('stripe_key','${SECRET}');`, site: 'acme' },
      confirmed: true,
      result: 'success',
      duration_ms: 12,
    });
    await logger.flush();

    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('update_option');
    expect(raw).toContain(WITHHELD_PREFIX);
    // Everything that identifies the call survives.
    expect(raw).toContain('wp_eval');
    expect(raw).toContain('acme');

    const entry = JSON.parse(raw.trim());
    expect(entry.toolName).toBe('wp_eval');
    expect(entry.result).toBe('success');
    expect(entry.tier).toBe(3);
  });

  it('does not flush a sentinel command array to disk', async () => {
    const file = path.join(dir, 'audit.log');
    const logger = createAuditLogger(file);

    logger.log({
      timestamp: new Date().toISOString(),
      toolName: 'security-sentinel/execute',
      tier: 3,
      params: { commands: [`wp config set DB_PASSWORD ${SECRET}`, 'rm -f evil.php'] },
      confirmed: true,
      result: 'success',
      duration_ms: 4,
    });
    await logger.flush();

    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('rm -f evil.php');
    expect(raw).toContain(`${WITHHELD_PREFIX}, 2 elements`);
  });
});

// ---------------------------------------------------------------------------
// Sink 3 — AuditLogger (RegistryStorage-backed JSON)
// ---------------------------------------------------------------------------

describe('AuditLogger withholds freeform input', () => {
  it('does not persist a withheld field to the backing store', () => {
    const file = path.join(dir, 'nexus_audit_logs.json');
    const logger = new AuditLogger(makeFileStorage(file), file);

    logger.logFailure('wpe_pull_to_local', 'acme-prod', 'wpe_install', 'Pull failed', {
      // Five (in fact seven) call sites pass the whole IPC request through.
      command: ['config', 'set', 'DB_PASSWORD', SECRET],
      code: `update_option('stripe_key','${SECRET}');`,
      installId: 'i-1',
    });

    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('DB_PASSWORD');
    expect(raw).not.toContain('update_option');
    expect(raw).toContain(WITHHELD_PREFIX);

    // The record of what happened survives in full.
    const entries = JSON.parse(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('wpe_pull_to_local');
    expect(entries[0].target).toBe('acme-prod');
    expect(entries[0].result).toBe('failure');
    expect(entries[0].params.installId).toBe('i-1');
  });
});

// ---------------------------------------------------------------------------
// Withholding must not become a way to break the audit path
// ---------------------------------------------------------------------------

describe('withholding never throws and never over-reaches', () => {
  it('leaves non-string, non-array values to the normal walk', () => {
    const out = redactParams({ code: 42, script: null, patch: undefined, query: true });
    expect(out.code).toBe(42);
    expect(out.script).toBeNull();
    expect(out.query).toBe(true);
  });

  it('recurses into an object-valued freeform key rather than withholding it', () => {
    // A structured payload is still redacted key by key — key-name and
    // value-shape masking remain the backstop.
    const out = redactParams({ args: { api_key: SECRET, plugin: 'akismet' } }) as any;
    expect(out.args.api_key).toBe('[REDACTED]');
    expect(out.args.plugin).toBe('akismet');
  });

  it('survives a cyclic array under a freeform key', () => {
    const arr: unknown[] = ['a'];
    arr.push(arr);
    expect(() => redactParams({ command: arr })).not.toThrow();
  });

  it('leaves body-text and structured parameters readable', () => {
    // The withhold list covers composed SYNTAX. Post bodies, search/replace
    // values and option names stay legible; masking is their net.
    const out = redactParams({
      title: 'My Great Post',
      content: 'This is the body of the post.',
      search: 'old-domain.test',
      replace: 'new-domain.test',
      option: 'blogname',
      value: 'My Great Site',
    });
    expect(out).toEqual({
      title: 'My Great Post',
      content: 'This is the body of the post.',
      search: 'old-domain.test',
      replace: 'new-domain.test',
      option: 'blogname',
      value: 'My Great Site',
    });
  });
});
