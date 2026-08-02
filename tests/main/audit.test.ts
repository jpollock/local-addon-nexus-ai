import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createAuditLogger,
  redactParams,
  maskSecretsInString,
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

  // CHANGED for item 7. This previously asserted `certificate` was blanket
  // redacted by key name. A public certificate is not a secret, and blanket
  // redaction destroyed "which certificate was imported" — the forensic point
  // of the entry. A real PEM body is still masked, by value shape.
  test('does not blanket-redact certificate by key name, but still masks a PEM body', () => {
    const named = redactParams({ certificate: 'acme-prod-2026', domain: 'example.com' });
    expect(named.certificate).toBe('acme-prod-2026');
    expect(named.domain).toBe('example.com');

    const pem = '-----BEGIN CERTIFICATE-----\nMIIBkTCB+wIJAJ\n-----END CERTIFICATE-----';
    const body = redactParams({ certificate: pem });
    expect(body.certificate).toBe('[REDACTED]');
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

  // CHANGED for item 10 — this test asserted the inverse. The 2000-char cap was
  // reverted: a 5000-char `wp_eval` payload was being stored as 2023 chars,
  // which is forensic loss on exactly the parameter this masking exists to make
  // safe to keep. Rotation bounds file size; entries are not mangled.
  test('does not truncate long string values', () => {
    const long = 'x'.repeat(5000);
    const result = redactParams({ code: long }) as { code: string };
    expect(result.code).toHaveLength(5000);
    expect(result.code).not.toContain('truncated');
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

// ---------------------------------------------------------------------------
// S1 — argv-aware masking.
//
// Element-wise masking is blind to WP-CLI's real shape: the credential is a
// SEPARATE array element from the name that identifies it, so `--user_pass=x`
// was masked while `["config","set","DB_PASSWORD","x"]` was written verbatim.
// Every case below is a line the security pass found on disk.
// ---------------------------------------------------------------------------

describe('argv-aware masking', () => {
  const argvOf = (command: string[]): string[] =>
    (redactParams({ command }) as { command: string[] }).command;

  test.each([
    ['config set DB_PASSWORD', ['config', 'set', 'DB_PASSWORD', 'Pr0dDbP4ssw0rd'], 'Pr0dDbP4ssw0rd'],
    ['config set AUTH_KEY (salt forges auth cookies)', ['config', 'set', 'AUTH_KEY', 'x8T?|2i-9{Kd,V4'], 'x8T?|2i-9{Kd,V4'],
    ['config set NONCE_KEY', ['config', 'set', 'NONCE_KEY', 'q9-Zz{2!Lp,Vv3'], 'q9-Zz{2!Lp,Vv3'],
    ['config set LOGGED_IN_KEY', ['config', 'set', 'LOGGED_IN_KEY', 'r4!Bb}7?Mm,Xx8'], 'r4!Bb}7?Mm,Xx8'],
    ['option update stripe_secret_key', ['option', 'update', 'stripe_secret_key', 'sk_live_AbCdEfGh'], 'sk_live_AbCdEfGh'],
    ['user update --user_pass (separated flag)', ['user', 'update', '1', '--user_pass', 'Hunter2'], 'Hunter2'],
    ['user create --user_pass (separated flag)', ['user', 'create', 'bob', 'b@x.com', '--user_pass', 'Hunter2'], 'Hunter2'],
  ])('masks the value element in %s', (_label, command, secret) => {
    const out = argvOf(command as string[]);
    expect(out.join(' ')).not.toContain(secret as string);
    expect(out[out.length - 1]).toBe('[REDACTED]');
    // The NAME survives — which constant/option was written is the audit value.
    expect(out[out.length - 2]).toBe((command as string[])[(command as string[]).length - 2]);
  });

  test('masks an attached mysql-style short flag but keeps the flag itself', () => {
    const out = argvOf(['db', 'cli', '--', '-uroot', '-pSuperSecret99']);
    expect(out.join(' ')).not.toContain('SuperSecret99');
    expect(out).toContain('-p[REDACTED]');
    // -u is a username, not a credential; destroying it destroys the record of
    // which account was used.
    expect(out).toContain('-uroot');
  });

  test('leaves ordinary argv untouched', () => {
    const argv = ['plugin', 'install', 'advanced-custom-fields', '--activate'];
    expect(argvOf(argv)).toEqual(argv);
  });

  test('does not mask a non-secret option value', () => {
    // Blanket-masking the trailing element of `option update` would gut the log.
    expect(argvOf(['option', 'update', 'blogname', 'My Great Site'])).toEqual([
      'option', 'update', 'blogname', 'My Great Site',
    ]);
  });

  test('does not treat a following flag as the omitted password', () => {
    const out = argvOf(['user', 'update', '1', '--user_pass', '--porcelain']);
    expect(out).toContain('--porcelain');
  });

  // A command can arrive as ONE space-separated string rather than a pre-split
  // array — `nexus:sentinel:execute` receives exactly that, and echoed command
  // lines in raw tool output do too. Argv masking has nothing to bind to there.
  describe('command-string form', () => {
    test.each([
      ['wp config set DB_PASSWORD Pr0dDbP4ssw0rd', 'Pr0dDbP4ssw0rd'],
      ['wp config set AUTH_KEY x8Tq2i9Kd', 'x8Tq2i9Kd'],
      ['wp option update stripe_secret_key sk_live_AbC', 'sk_live_AbC'],
      ['wp user update 1 --user_pass Hunter2', 'Hunter2'],
      ['wp user create bob b@x.com --password Hunter2', 'Hunter2'],
    ])('masks the value in %s', (command, secret) => {
      const out = maskSecretsInString(command);
      expect(out).not.toContain(secret);
      expect(out).toContain('[REDACTED]');
    });

    test('keeps the constant/option NAME in the command string', () => {
      expect(maskSecretsInString('wp config set DB_PASSWORD Pr0dDbP4ssw0rd'))
        .toBe('wp config set DB_PASSWORD [REDACTED]');
    });

    test.each([
      ['prose containing the word password', 'Please reset your password now and try again.'],
      ['prose containing the word token', 'The token expires soon, ask an admin for a new one.'],
      ['non-secret option update', 'wp option update blogname MyGreatSite'],
      ['non-secret config set', 'wp config set WP_DEBUG true --raw'],
      ['non-secret user meta update', 'wp user meta update 1 nickname Bobby'],
      ['sentinel rm remediation', 'rm -f wp-content/mu-plugins/evil.php'],
      ['plugin deactivate', 'wp plugin deactivate badplugin --skip-plugins'],
    ])('leaves %s intact', (_label, text) => {
      expect(maskSecretsInString(text)).toBe(text);
    });
  });

  test('still redacts objects nested in arrays', () => {
    const result = redactParams({ items: [{ password: 'abc' }, { name: 'safe' }] });
    const items = result.items as any[];
    expect(items[0].password).toBe('[REDACTED]');
    expect(items[1].name).toBe('safe');
  });
});

// ---------------------------------------------------------------------------
// S2 — the opaque-run floor. The root cause: masking was anchored on key names
// and `=`/`:` syntax, and the only value-shape net that could catch a bare
// credential required 40 unbroken characters. Ten of ten realistic credentials
// in the 16–36 character band therefore survived verbatim.
// ---------------------------------------------------------------------------

describe('opaque-run masking — must-mask corpus', () => {
  test.each([
    ['MySQL root password', 'S3cur3P@ssw0rd2026', 18],
    ['base64 Basic auth', 'YWRtaW46aHVudGVyMjM0', 20],
    ['SendGrid-shape key', 'SG0aBcDeFgHiJkLmNoPqRsTuVwXy12', 30],
    ['Stripe restricted key', 'rk_live_51H8xYzAbCdEfGhIjKlMnOp', 31],
    ['Twilio auth token', '0123456789abcdef0123456789abcdef', 32],
    ['session cookie', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8', 36],
  ])('masks %s (%s chars) as a bare value', (_label, secret, len) => {
    expect((secret as string).length).toBe(len); // the band is the point
    const result = redactParams({ note: secret as string });
    expect(result.note).not.toContain(secret as string);
    expect(result.note).toBe('[REDACTED]');
  });

  test.each([
    ['MySQL root password', 'S3cur3P@ssw0rd2026'],
    ['base64 Basic auth', 'YWRtaW46aHVudGVyMjM0'],
    ['SendGrid-shape key', 'SG0aBcDeFgHiJkLmNoPqRsTuVwXy12'],
    ['Stripe restricted key', 'rk_live_51H8xYzAbCdEfGhIjKlMnOp'],
    ['Twilio auth token', '0123456789abcdef0123456789abcdef'],
    ['session cookie', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8'],
  ])('masks %s as an argv element', (_label, secret) => {
    const out = redactParams({ command: ['option', 'update', 'some_option', secret as string] });
    expect(JSON.stringify(out)).not.toContain(secret as string);
  });
});

describe('opaque-run masking — must-survive corpus', () => {
  // Lowering the floor from 40 to 20 increases masking, and over-masking that
  // guts forensic value is a real cost. These are the shapes that must not
  // regress; each was verified unmasked before the change too.
  test.each([
    ['prose post body', 'This site has a very long description that goes on and on about nothing in particular at all.'],
    ['Local PHP binary path', '/Users/jeremy.pollock/Library/Application Support/Local/lightning-services/php-8.2.10+0/bin/darwin/bin/php'],
    ['homebrew node path', '/opt/homebrew/Cellar/node/22.16.0/bin/node'],
    ['long kebab slug', 'the-complete-guide-to-advanced-custom-fields-for-wordpress-developers'],
    ['kebab slug with digits', 'wordpress-seo-premium-14-8-1-release-notes-2026'],
    ['WP-CLI table output', '| 1  | admin      | administrator |'],
    ['serialized PHP option', 'a:3:{s:8:"blogname";s:7:"My Site";s:7:"version";s:5:"6.8.1";}'],
    ['email address', 'jeremy.pollock@wpengine.com'],
    ['email with caps and digit', 'Jeremy.Pollock2@wpengine.com'],
    ['UUID lowercase', '550e8400-e29b-41d4-a716-446655440000'],
    ['UUID uppercase', '550E8400-E29B-41D4-A716-446655440000'],
    ['localhost URL', 'http://localhost:10004/wp-admin/options-general.php'],
    ['WP nonce', 'nonce=a1b2c3d4e5'],
    ['percent-encoded redirect', 'redirect_to=https%3A%2F%2FExample.com%2Fwp-admin'],
    ['query string', 'foo=Bar1&baz=Qux2&page=3'],
    ['plugin file path', 'wp-content/plugins/advanced-custom-fields-pro/acf.php'],
  ])('leaves %s intact', (_label, text) => {
    expect(maskSecretsInString(text as string)).toBe(text);
  });

  test.each([
    ['author', 'Automattic'],
    ['keyword', 'wordpress hosting'],
    ['monkey', 'patch'],
    ['passthrough', 'enabled'],
  ])('leaves the %s field intact', (key, value) => {
    expect(redactParams({ [key]: value })[key]).toBe(value);
  });
});

// ---------------------------------------------------------------------------
// S3 — PHP `define()`. INLINE_ASSIGNMENT anchors on `=`/`:`/`=>`; define()
// uses a comma. Raw stdout from ~20 WP-CLI modules reaches the masked `error`
// field, so wp-config credentials were landing on disk verbatim.
// ---------------------------------------------------------------------------

describe('define() masking', () => {
  const wpConfigDump = [
    "define( 'DB_PASSWORD', 'q7#Lm2!xVz' );",
    "define( 'AUTH_KEY', 'x8T?|2i-9{Kd,V4' );",
    "define( 'NONCE_SALT', 'Zz9!Qq2@Ww3#Ee4' );",
    "define( 'DB_NAME', 'local' );",
  ].join('\n');

  test('masks the value of every secret-bearing constant', () => {
    const out = maskSecretsInString(wpConfigDump);
    expect(out).not.toContain('q7#Lm2!xVz');
    expect(out).not.toContain('x8T?|2i-9{Kd,V4');
    expect(out).not.toContain('Zz9!Qq2@Ww3#Ee4');
  });

  test('keeps the constant NAME — knowing which constant was touched is the point', () => {
    const out = maskSecretsInString(wpConfigDump);
    expect(out).toContain("define( 'DB_PASSWORD', '[REDACTED]' );");
    expect(out).toContain("define( 'AUTH_KEY', '[REDACTED]' );");
    expect(out).toContain("define( 'NONCE_SALT', '[REDACTED]' );");
  });

  test('leaves non-secret constants completely alone', () => {
    expect(maskSecretsInString(wpConfigDump)).toContain("define( 'DB_NAME', 'local' );");
  });

  test('reaches the error field, which is where raw stdout lands', () => {
    const logger = createAuditLogger();
    logger.log({
      timestamp: '2024-01-01T00:00:00.000Z',
      toolName: 'wp_eval',
      tier: 2,
      params: {},
      confirmed: null,
      result: 'error',
      error: wpConfigDump,
      duration_ms: 1,
    });
    const entry = logger.getEntries()[0];
    expect(entry.error).not.toContain('q7#Lm2!xVz');
    expect(entry.error).toContain('DB_PASSWORD');
  });
});

// ---------------------------------------------------------------------------
// S4 — item 7. Tokenizing `key` inverted the log's meaning: it destroyed the
// setting NAME and kept the value.
// ---------------------------------------------------------------------------

describe('key/keys are decided by value shape, not by key name', () => {
  test('a settings key PATH survives — the name is the forensic content', () => {
    const result = redactParams({
      key: 'wpeOperationPermissions.wpcli.production',
      value: 'true',
    });
    expect(result.key).toBe('wpeOperationPermissions.wpcli.production');
    expect(result.value).toBe('true');
  });

  test('a credential-shaped value under `key` is still masked by its shape', () => {
    const result = redactParams({ key: 'sk-proj-AbCdEf0123456789ZzYyXx' });
    expect(result.key).toBe('[REDACTED]');
  });

  test('SSH public keys and key ids survive', () => {
    const result = redactParams({ label: 'laptop', publicKey: 'ssh-rsa AAAAB3Nza laptop', sshKeyId: 'ssh-key-12' });
    expect(result.sshKeyId).toBe('ssh-key-12');
    expect(result.label).toBe('laptop');
    expect(String(result.publicKey)).toContain('ssh-rsa');
  });

  test.each(['api_key', 'apiKey', 'private_key', 'secret_key', 'access_key', 'API_KEY'])(
    'but %s is still redacted — the name itself signals a secret',
    (key) => {
      expect(redactParams({ [key]: 'v' })[key]).toBe('[REDACTED]');
    },
  );
});

// ---------------------------------------------------------------------------
// S5 — item 6. `toolName` was the one string field spread through unchanged.
// ---------------------------------------------------------------------------

describe('toolName is masked like every other field', () => {
  test('masks a credential-shaped toolName', () => {
    const logger = createAuditLogger();
    logger.log({
      timestamp: '2024-01-01T00:00:00.000Z',
      toolName: 'agent/0123456789abcdef0123456789abcdef',
      tier: 2,
      params: {},
      confirmed: null,
      result: 'success',
      duration_ms: 1,
    });
    expect(logger.getEntries()[0].toolName).not.toContain('0123456789abcdef0123456789abcdef');
  });

  test('leaves ordinary tool names alone', () => {
    const logger = createAuditLogger();
    logger.log({
      timestamp: '2024-01-01T00:00:00.000Z',
      toolName: 'wpe_delete_install',
      tier: 3,
      params: {},
      confirmed: true,
      result: 'success',
      duration_ms: 1,
    });
    expect(logger.getEntries()[0].toolName).toBe('wpe_delete_install');
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
