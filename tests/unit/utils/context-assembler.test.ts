import { assembleContext, redactSecrets } from '../../../src/main/utils/context-assembler';

describe('redactSecrets', () => {
  it('redacts DB_PASSWORD', () => {
    const input = `define('DB_PASSWORD', 'super-secret-123');`;
    expect(redactSecrets(input)).not.toContain('super-secret-123');
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts AUTH_KEY and SECURE_AUTH_KEY', () => {
    const input = `define('AUTH_KEY', 'abc'); define('SECURE_AUTH_KEY', 'def');`;
    const out = redactSecrets(input);
    expect(out).not.toContain('abc');
    expect(out).not.toContain('def');
  });

  it('redacts LOGGED_IN_KEY and NONCE_KEY', () => {
    const input = `define('LOGGED_IN_KEY', 'val1'); define('NONCE_KEY', 'val2');`;
    const out = redactSecrets(input);
    expect(out).not.toContain('val1');
    expect(out).not.toContain('val2');
  });

  it('redacts _SALT variants', () => {
    const input = `define('AUTH_SALT', 'saltval');`;
    expect(redactSecrets(input)).not.toContain('saltval');
  });

  it('redacts sk- API keys', () => {
    const input = `sk-proj-abcdefghijklmnop`;
    expect(redactSecrets(input)).not.toContain('sk-proj-abcdefghijklmnop');
  });

  it('redacts AIza Google keys', () => {
    const input = `AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;
    expect(redactSecrets(input)).not.toContain('AIzaSy');
  });

  it('redacts AKIA AWS keys', () => {
    const input = `AKIAIOSFODNN7EXAMPLE`;
    expect(redactSecrets(input)).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('passes through ordinary text untouched', () => {
    const input = 'This is a normal log line with no secrets.';
    expect(redactSecrets(input)).toBe(input);
  });
});

describe('assembleContext', () => {
  it('wraps each site in site-context tags', async () => {
    const mockDb = {
      prepare: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue({
          name: 'my-site',
          wp_version: '6.9',
          php_version: '8.2',
          source: 'local',
        }),
        all: jest.fn().mockReturnValue([]),
      }),
    } as any;

    const result = await assembleContext(['site-1'], 20000, mockDb);
    expect(result).toContain('<site-context');
    expect(result).toContain('</site-context>');
    expect(result).toContain('my-site');
  });

  it('includes the system prompt prefix', async () => {
    const mockDb = {
      prepare: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue({
          name: 'x', wp_version: '6.9', php_version: '8.2', source: 'local',
        }),
        all: jest.fn().mockReturnValue([]),
      }),
    } as any;
    const result = await assembleContext(['site-1'], 20000, mockDb);
    expect(result).toContain('You are Nexus');
    expect(result).toContain('web development');
  });

  it('returns a summary line for sites that exceed the token budget', async () => {
    // With a budget of 1 token, any real content will exceed it
    const mockDb = {
      prepare: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue({
          name: 'big-site', wp_version: '6.9', php_version: '8.2', source: 'local',
        }),
        all: jest.fn().mockReturnValue(
          Array.from({ length: 50 }, (_, i) => ({ name: `plugin-${i}`, version: '1.0', is_active: 1 }))
        ),
      }),
    } as any;
    const result = await assembleContext(['site-1', 'site-2'], 1, mockDb);
    // At least one site should be summarised
    expect(result).toContain('(summary)');
  });
});
