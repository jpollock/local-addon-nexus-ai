import { maskPii } from '../../../src/main/mcp/pii';

describe('maskPii — outbound-to-LLM PII scrubber (P1-6)', () => {
  it('masks an email address', () => {
    expect(maskPii('admin is jeremy.pollock@example.com here')).not.toContain('jeremy.pollock@example.com');
  });

  it('masks every email in a fleet-wide list', () => {
    const out = maskPii('a@x.com, b@y.org, c.d+tag@sub.z.co.uk');
    expect(out).not.toMatch(/@x\.com|@y\.org|@sub\.z\.co\.uk/);
  });

  it('masks an IPv4 address', () => {
    expect(maskPii('client 203.0.113.42 hit /wp-login')).not.toContain('203.0.113.42');
  });

  it('leaves ordinary content intact', () => {
    const s = 'gateway on port 13000; PHP version 8.3.33; user "deploy"';
    expect(maskPii(s)).toBe(s);
  });

  it('is a no-op on empty/undefined-ish input', () => {
    expect(maskPii('')).toBe('');
  });

  it('masks emails embedded in a JSON/markdown blob', () => {
    const blob = '| admin_email | site |\n| owner@acme.com | acme |';
    expect(maskPii(blob)).not.toContain('owner@acme.com');
    expect(maskPii(blob)).toContain('acme'); // non-email cell survives
  });
});
