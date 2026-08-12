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

  it('prevents collision on underscore pairs', () => {
    // Real collision: ssh:a/b_c and ssh:a_b/c both sanitize to ssh_a_b_c.
    // The hash suffix disambiguates them. Note: the ssh:a/b-c vs ssh:a-b/c
    // example in CLAUDE.md is FALSE — hyphen is preserved, so those never collide.
    const id1 = vectorSiteId('ssh:a/b_c');
    const id2 = vectorSiteId('ssh:a_b/c');
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^ssh_a_b_c_[0-9a-f]{8}$/);
    expect(id2).toMatch(/^ssh_a_b_c_[0-9a-f]{8}$/);
  });

  it('is deterministic — the same id always translates to the same value', () => {
    expect(vectorSiteId('ssh:hostinger-test/site-a')).toBe(vectorSiteId('ssh:hostinger-test/site-a'));
  });

  it('handles multiple invalid characters (defensive — real ids should not have more than one slash)', () => {
    const translated = vectorSiteId('ssh:a/b/c');
    expect(/^[a-zA-Z0-9_-]+$/.test(translated)).toBe(true);
  });
});
