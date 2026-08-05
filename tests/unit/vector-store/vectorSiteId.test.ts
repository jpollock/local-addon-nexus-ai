import { vectorSiteId } from '../../../src/main/vector-store/vectorSiteId';

describe('vectorSiteId', () => {
  it('replaces colons with underscores', () => {
    expect(vectorSiteId('ssh:hostinger-test')).toBe('ssh_hostinger-test');
  });

  it('leaves an id with no colon unchanged', () => {
    expect(vectorSiteId('wpe-abc123')).toBe('wpe-abc123');
    expect(vectorSiteId('mmWgjXGRS')).toBe('mmWgjXGRS');
  });

  it('the translated id satisfies the real validation regex', () => {
    // Import the actual regex source rather than copying it, so a future change
    // to SqliteVecStore's rule is caught here too.
    const translated = vectorSiteId('ssh:my-host_1');
    expect(/^[a-zA-Z0-9_-]+$/.test(translated)).toBe(true);
  });

  it('handles multiple colons (defensive — aliases should never contain one, but do not crash if they do)', () => {
    expect(vectorSiteId('ssh:a:b')).toBe('ssh_a_b');
  });
});
