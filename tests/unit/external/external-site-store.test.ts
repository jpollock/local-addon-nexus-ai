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
  it('derives a stable id from the alias and site, joined by a slash', () => {
    expect(externalSiteId('acme-box', 'my-site')).toBe('ssh:acme-box/my-site');
  });
});

describe('ExternalConnectionProfile — connection-only fields', () => {
  it('externalSiteId takes alias and site, joined by a slash', () => {
    expect(externalSiteId('hostinger-test', 'mediumslateblue-hyena'))
      .toBe('ssh:hostinger-test/mediumslateblue-hyena');
  });

  it('a stored connection profile has no wpPath or environment field', () => {
    const storage = fakeStorage();
    const stored = upsertExternalProfile(storage, {
      alias: 'hostinger-test',
      wpCliPath: '/usr/bin/wp',
      firstSeenAt: 1000,
      lastSeenAt: 1000,
    } as any);
    expect(stored).not.toHaveProperty('wpPath');
    expect(stored).not.toHaveProperty('environment');
  });
});

describe('external connection profiles', () => {
  it('returns null for an unknown alias', () => {
    expect(getExternalProfile(fakeStorage() as any, 'nope')).toBeNull();
  });

  it('round-trips a profile', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1000, lastSeenAt: 1000,
    });
    expect(getExternalProfile(s, 'acme-box')).toEqual({
      alias: 'acme-box', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1000, lastSeenAt: 1000,
    });
  });

  it('preserves firstSeenAt across an update but advances lastSeenAt', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', firstSeenAt: 1000, lastSeenAt: 1000,
    });
    upsertExternalProfile(s, {
      alias: 'acme-box', firstSeenAt: 9999, lastSeenAt: 2000,
    });
    const p = getExternalProfile(s, 'acme-box')!;
    expect(p.firstSeenAt).toBe(1000);   // original wins
    expect(p.lastSeenAt).toBe(2000);
  });

  it('returns the merged profile, not the input', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'acme-box', wpCliPath: '/a', firstSeenAt: 1000, lastSeenAt: 1000,
    });
    const merged = upsertExternalProfile(s, {
      alias: 'acme-box', firstSeenAt: 9999, lastSeenAt: 2000,
    });
    expect(merged).toEqual(getExternalProfile(s, 'acme-box'));
    expect(merged.wpCliPath).toBe('/a');
  });

  it('lists every stored profile', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, { alias: 'a', firstSeenAt: 1, lastSeenAt: 1 });
    upsertExternalProfile(s, { alias: 'b', firstSeenAt: 1, lastSeenAt: 1 });
    expect(listExternalProfiles(s).map(p => p.alias).sort()).toEqual(['a', 'b']);
  });
});

describe('wpCliPath', () => {
  it('round-trips an absolute WP-CLI path', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'h1', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/usr/local/bin/wp');
  });

  it('is not erased by a later upsert that omits it', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'h1', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    upsertExternalProfile(s, { alias: 'h1', firstSeenAt: 2, lastSeenAt: 2 });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/usr/local/bin/wp');
  });

  it('is replaced when a later upsert supplies a different one', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, {
      alias: 'h1', wpCliPath: '/usr/local/bin/wp',
      firstSeenAt: 1, lastSeenAt: 1,
    });
    upsertExternalProfile(s, {
      alias: 'h1', wpCliPath: '/opt/wp',
      firstSeenAt: 2, lastSeenAt: 2,
    });
    expect(getExternalProfile(s, 'h1')?.wpCliPath).toBe('/opt/wp');
  });
});

describe('removeExternalProfile', () => {
  it('removes only the named alias and reports true', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, { alias: 'h1', firstSeenAt: 1, lastSeenAt: 1 });
    upsertExternalProfile(s, { alias: 'h2', firstSeenAt: 1, lastSeenAt: 1 });
    expect(removeExternalProfile(s, 'h1')).toBe(true);
    expect(getExternalProfile(s, 'h1')).toBeNull();
    expect(getExternalProfile(s, 'h2')).not.toBeNull();
  });

  it('reports false for an unknown alias and writes nothing', () => {
    const s = fakeStorage() as any;
    upsertExternalProfile(s, { alias: 'h1', firstSeenAt: 1, lastSeenAt: 1 });
    const writesBefore = s.writeCount;
    expect(removeExternalProfile(s, 'nope')).toBe(false);
    expect(s.writeCount).toBe(writesBefore);
    expect(listExternalProfiles(s)).toHaveLength(1);
  });
});
