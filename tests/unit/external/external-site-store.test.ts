import {
  externalSiteId, getExternalProfile, upsertExternalProfile, listExternalProfiles, removeExternalProfile,
} from '../../../src/main/external/externalSiteStore';

function fakeStorage() {
  const data = new Map<string, unknown>();
  const storage: any = {
    get: (k: string) => data.get(k) ?? null,
    set: (k: string, v: unknown) => { data.set(k, v); storage.writeCount++; },
    writeCount: 0,
  };
  return storage;
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
    // ...but NOT the environment: this is a sighting (the default), and the
    // environment is the write gate. Only a 'registration' write may change it.
    expect(p.environment).toBe('staging');
  });

  it('returns the merged profile, not the input', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpPath: '/a', environment: 'staging', firstSeenAt: 1000, lastSeenAt: 1000,
    });
    const merged = upsertExternalProfile(s, {
      alias: 'acme-box', environment: 'production', firstSeenAt: 9999, lastSeenAt: 2000,
    });
    expect(merged).toEqual(getExternalProfile(s, 'acme-box'));
    expect(merged.environment).toBe('staging');
    expect(merged.wpPath).toBe('/a');
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

describe('wpCliPath', () => {
  it('round-trips an absolute WP-CLI path', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'h1', environment: 'production', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/usr/local/bin/wp');
  });

  it('is not erased by a later upsert that omits it', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'h1', environment: 'production', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    upsertExternalProfile(s, { alias: 'h1', environment: 'production', firstSeenAt: 2, lastSeenAt: 2 });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/usr/local/bin/wp');
  });

  it('is replaced when a later upsert supplies a different one', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'h1', environment: 'production', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    upsertExternalProfile(s, {
      alias: 'h1', environment: 'production', wpCliPath: '/opt/wp',
      firstSeenAt: 2, lastSeenAt: 2,
    });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/opt/wp');
  });
});

describe('environment — sighting vs registration', () => {
  it('a sighting never changes a registered environment', () => {
    // `nexus wp core version ssh:prod-box@development` is a permitted read.
    // It must not relabel a production host on its way through.
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'prod-box', environment: 'production', firstSeenAt: 1, lastSeenAt: 1,
    }, 'registration');
    upsertExternalProfile(s, {
      alias: 'prod-box', environment: 'development', firstSeenAt: 2, lastSeenAt: 2,
    }, 'sighting');
    expect(getExternalProfile(s, 'prod-box')!.environment).toBe('production');
  });

  it('defaults to sighting when no source is given', () => {
    // The conservative behaviour must be what a forgetful call site gets.
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'prod-box', environment: 'production', firstSeenAt: 1, lastSeenAt: 1,
    }, 'registration');
    upsertExternalProfile(s, {
      alias: 'prod-box', environment: 'development', firstSeenAt: 2, lastSeenAt: 2,
    });
    expect(getExternalProfile(s, 'prod-box')!.environment).toBe('production');
  });

  it('a sighting still sets the environment for a host it has never seen', () => {
    // No registration to protect, so the suffix is the only signal there is —
    // this is B1's lazy-registration behaviour and it must survive.
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'new-box', environment: 'staging', firstSeenAt: 1, lastSeenAt: 1,
    }, 'sighting');
    expect(getExternalProfile(s, 'new-box')!.environment).toBe('staging');
  });

  it('a registration overrides what a sighting stored', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'box', environment: 'production', firstSeenAt: 1, lastSeenAt: 1,
    }, 'sighting');
    upsertExternalProfile(s, {
      alias: 'box', environment: 'development', firstSeenAt: 2, lastSeenAt: 2,
    }, 'registration');
    expect(getExternalProfile(s, 'box')!.environment).toBe('development');
  });
});

describe('removeExternalProfile', () => {
  it('removes only the named alias and reports true', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, { alias: 'h1', environment: 'production', firstSeenAt: 1, lastSeenAt: 1 });
    upsertExternalProfile(s, { alias: 'h2', environment: 'staging', firstSeenAt: 1, lastSeenAt: 1 });
    expect(removeExternalProfile(s, 'h1')).toBe(true);
    expect(getExternalProfile(s, 'h1')).toBeNull();
    expect(getExternalProfile(s, 'h2')).not.toBeNull();
  });

  it('reports false for an unknown alias and writes nothing', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, { alias: 'h1', environment: 'production', firstSeenAt: 1, lastSeenAt: 1 });
    const writesBefore = s.writeCount;
    expect(removeExternalProfile(s, 'nope')).toBe(false);
    expect(s.writeCount).toBe(writesBefore);
    expect(listExternalProfiles(s)).toHaveLength(1);
  });
});
