import {
  externalSiteId, getExternalProfile, upsertExternalProfile, listExternalProfiles,
} from '../../../src/main/external/externalSiteStore';

function fakeStorage() {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k) ?? null,
    set: (k: string, v: unknown) => { data.set(k, v); },
  };
}

describe('externalSiteId', () => {
  it('derives a stable id from the alias', () => {
    expect(externalSiteId('acme-box')).toBe('ssh:acme-box');
  });
});

describe('external site profiles', () => {
  it('returns null for an unknown alias', () => {
    expect(getExternalProfile(fakeStorage() as any, 'nope')).toBeNull();
  });

  it('round-trips a profile', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/var/www/html', environment: 'production',
      firstSeenAt: 1000, lastSeenAt: 1000,
    });
    expect(getExternalProfile(s, 'acme-box')).toEqual({
      alias: 'acme-box', wpPath: '/var/www/html', environment: 'production',
      firstSeenAt: 1000, lastSeenAt: 1000,
    });
  });

  it('preserves firstSeenAt across an update but advances lastSeenAt', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/a', environment: 'staging',
      firstSeenAt: 1000, lastSeenAt: 1000,
    });
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/b', environment: 'production',
      firstSeenAt: 9999, lastSeenAt: 2000,
    });
    const p = getExternalProfile(s, 'acme-box')!;
    expect(p.firstSeenAt).toBe(1000);   // original wins
    expect(p.lastSeenAt).toBe(2000);
    expect(p.wpPath).toBe('/b');        // latest wins
    expect(p.environment).toBe('production');
  });

  it('does not lose an existing wpPath when a later call omits it', () => {
    // A command run without --path must not erase a path we already know.
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/var/www/html', environment: 'production',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    upsertExternalProfile(s, {
      alias: 'acme-box', environment: 'production', firstSeenAt: 2, lastSeenAt: 2,
    });
    expect(getExternalProfile(s, 'acme-box')!.wpPath).toBe('/var/www/html');
  });

  it('lists every stored profile', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, { alias: 'a', environment: 'production', firstSeenAt: 1, lastSeenAt: 1 });
    upsertExternalProfile(s, { alias: 'b', environment: 'staging', firstSeenAt: 1, lastSeenAt: 1 });
    expect(listExternalProfiles(s).map(p => p.alias).sort()).toEqual(['a', 'b']);
  });
});
