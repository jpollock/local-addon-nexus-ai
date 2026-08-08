import { vectorSiteId } from '../../../src/main/vector-store/vectorSiteId';

describe('vectorSiteId', () => {
  it('replaces colons with underscores', () => {
    // Ids that need sanitizing get a stable 8-hex-char hash suffix appended,
    // so the sanitized prefix is checked rather than an exact literal match.
    expect(vectorSiteId('ssh:hostinger-test')).toMatch(/^ssh_hostinger-test_[0-9a-f]{8}$/);
  });

  it('leaves an id with no invalid character unchanged (identity — no hash suffix)', () => {
    // Load-bearing: writers never call vectorSiteId() for local/WPE ids, so
    // readers must resolve to the exact same, unmodified id or search silently
    // returns empty results for every local/WPE site.
    expect(vectorSiteId('wpe-abc123')).toBe('wpe-abc123');
    expect(vectorSiteId('mmWgjXGRS')).toBe('mmWgjXGRS');
  });

  it('translates a multi-site external id (alias/site) into a valid table name', () => {
    const translated = vectorSiteId('ssh:hostinger-test/site-a');
    expect(/^[a-zA-Z0-9_-]+$/.test(translated)).toBe(true);
  });

  it('the translated id satisfies the real validation regex for every case above', () => {
    for (const id of ['ssh:my-host_1', 'ssh:hostinger-test/site-a', 'ssh:dotted.alias/site', 'wpe-abc123']) {
      expect(/^[a-zA-Z0-9_-]+$/.test(vectorSiteId(id))).toBe(true);
    }
  });

  it('does not collide two different ids that share the same character-class-replaced prefix', () => {
    const a = vectorSiteId('ssh:a/b-c');
    const b = vectorSiteId('ssh:a-b/c');
    expect(a).not.toBe(b);
  });

  it('is deterministic — the same id always translates to the same value', () => {
    expect(vectorSiteId('ssh:hostinger-test/site-a')).toBe(vectorSiteId('ssh:hostinger-test/site-a'));
  });

  it('handles multiple invalid characters (defensive — real ids should not have more than one slash)', () => {
    const translated = vectorSiteId('ssh:a/b/c');
    expect(/^[a-zA-Z0-9_-]+$/.test(translated)).toBe(true);
  });
});
