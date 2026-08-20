/**
 * WP-47 · the dual-track capability probe.
 *
 * Two tracks, both driven here: a mock host that advertises `context.capabilities`,
 * and the STOCK 10.1.1 shape — the host we actually run against today, where the
 * member does not exist at all and every probe must be falsy so the guest path runs
 * unchanged. The Local architect's recon (§6) is explicit that no capability API
 * exists on 10.1.1; this suite is what makes "degrades cleanly" a measurement rather
 * than a promise.
 */
import {
  probeHost,
  HOST_CAPABILITIES,
  type HostCapabilityName,
} from '../../../src/renderer/hostCapabilities';

/** The host we ship against today: renderer context per recon §6, no `capabilities`. */
const STOCK_10_1_1 = {
  environment: { version: '10.1.1' },
  hooks: {},
  React: {},
};

describe('probeHost — stock Local 10.1.1 (the guest track)', () => {
  it('reports every declared capability as absent', () => {
    const host = probeHost(STOCK_10_1_1);
    expect(HOST_CAPABILITIES.length).toBeGreaterThan(0);
    for (const name of HOST_CAPABILITIES) {
      expect(host.level(name)).toBeUndefined();
      expect(host.has(name)).toBe(false);
    }
  });

  it('records the version alongside, as the fallback signal', () => {
    expect(probeHost(STOCK_10_1_1).version).toBe('10.1.1');
  });

  it('exposes an empty capability map rather than throwing on the missing member', () => {
    expect(probeHost(STOCK_10_1_1).capabilities).toEqual({});
  });

  it('says so in one line, so a support log names the track that ran', () => {
    expect(probeHost(STOCK_10_1_1).summary()).toBe('host=10.1.1 capabilities=none');
  });
});

describe('probeHost — a host that advertises capabilities (the contract track)', () => {
  const CONTRACT_HOST = {
    environment: { version: '10.4.0' },
    capabilities: {
      themeTokens: 1,
      mainVerticalNav: 1,
      layoutReservation: 1,
      regionProviders: 1,
    },
  };

  it('selects the contract path for every member the host advertises', () => {
    const host = probeHost(CONTRACT_HOST);
    for (const name of HOST_CAPABILITIES) {
      expect(host.has(name)).toBe(true);
      expect(host.level(name)).toBe(1);
    }
  });

  it('honours the integer version — a v1 host does not satisfy a v2 requirement', () => {
    const host = probeHost(CONTRACT_HOST);
    expect(host.has('regionProviders', 1)).toBe(true);
    expect(host.has('regionProviders', 2)).toBe(false);
  });

  it('supports a partial rollout: one capability landing does not imply the others', () => {
    const host = probeHost({
      environment: { version: '10.2.0' },
      capabilities: { themeTokens: 1 },
    });
    expect(host.has('themeTokens')).toBe(true);
    expect(host.has('mainVerticalNav')).toBe(false);
    expect(host.has('layoutReservation')).toBe(false);
    expect(host.has('regionProviders')).toBe(false);
  });

  it('carries a newer host\'s unknown members through to the summary without acting on them', () => {
    const host = probeHost({
      environment: { version: '12.0.0' },
      capabilities: { themeTokens: 3, somethingWeHaveNeverHeardOf: 2 },
    });
    expect(host.has('themeTokens', 3)).toBe(true);
    expect(host.summary()).toBe('host=12.0.0 capabilities=somethingWeHaveNeverHeardOf@2,themeTokens@3');
    // Not a declared member, so nothing in the addon can key on it.
    expect(HOST_CAPABILITIES).not.toContain('somethingWeHaveNeverHeardOf' as HostCapabilityName);
  });
});

describe('probeHost — a capability is never inferred from a version', () => {
  it('refuses every capability on a host whose version is far newer but advertises nothing', () => {
    const host = probeHost({ environment: { version: '99.0.0' } });
    expect(host.version).toBe('99.0.0');
    for (const name of HOST_CAPABILITIES) expect(host.has(name)).toBe(false);
  });

  it('grants a capability on a host whose version is OLDER than today, when it advertises one', () => {
    // The member is the fact; the version is not evidence in either direction.
    const host = probeHost({ environment: { version: '9.0.0' }, capabilities: { themeTokens: 1 } });
    expect(host.has('themeTokens')).toBe(true);
  });
});

describe('probeHost — unreadable input degrades to the guest track, never throws', () => {
  const UNREADABLE: Array<[string, unknown]> = [
    ['undefined context', undefined],
    ['null context', null],
    ['a string context', 'nope'],
    ['capabilities as null', { capabilities: null }],
    ['capabilities as an array', { capabilities: [1, 2, 3] }],
    ['capabilities as a string', { capabilities: 'themeTokens' }],
  ];

  it.each(UNREADABLE)('%s → no capabilities, no version, no throw', (_label, ctx) => {
    const host = probeHost(ctx);
    expect(host.capabilities).toEqual({});
    expect(host.version).toBeNull();
    for (const name of HOST_CAPABILITIES) expect(host.has(name)).toBe(false);
  });

  it('survives a context whose property access throws', () => {
    const hostile = {
      get capabilities(): unknown {
        throw new Error('boom');
      },
      get environment(): unknown {
        throw new Error('boom');
      },
    };
    const host = probeHost(hostile);
    expect(host.capabilities).toEqual({});
    expect(host.version).toBeNull();
    expect(host.has('themeTokens')).toBe(false);
  });

  it('drops members that are not usable integer levels, rather than treating presence as support', () => {
    const host = probeHost({
      capabilities: {
        themeTokens: 0,
        mainVerticalNav: -1,
        layoutReservation: 1.5,
        regionProviders: '1',
      },
    });
    for (const name of HOST_CAPABILITIES) {
      expect(host.level(name)).toBeUndefined();
      expect(host.has(name)).toBe(false);
    }
    expect(host.capabilities).toEqual({});
  });

  it('reads a non-string version as unknown rather than coercing it', () => {
    expect(probeHost({ environment: { version: 10 } }).version).toBeNull();
    expect(probeHost({ environment: null }).version).toBeNull();
    expect(probeHost({ environment: { version: '10.1.1' } }).summary())
      .toBe('host=10.1.1 capabilities=none');
    expect(probeHost({}).summary()).toBe('host=unknown capabilities=none');
  });
});

describe('probeHost — the returned map cannot be edited into a capability', () => {
  it('is frozen, so no caller can grant itself a path the host never offered', () => {
    const host = probeHost(STOCK_10_1_1);
    expect(Object.isFrozen(host.capabilities)).toBe(true);
    try {
      (host.capabilities as Record<string, number>).themeTokens = 1;
    } catch {
      /* strict mode throws; sloppy mode silently ignores. Either is fine. */
    }
    expect(host.has('themeTokens')).toBe(false);
  });

  it('is frozen on a POPULATED map too, not only on the empty one', () => {
    // WP-47 battery M07 found this gap: the assertion above is satisfied by the
    // absent-capabilities early return, so the freeze on the map actually built from a
    // host's members was never exercised. Removing that freeze survived the suite.
    const host = probeHost({ capabilities: { themeTokens: 1 } });
    expect(Object.isFrozen(host.capabilities)).toBe(true);
    try {
      (host.capabilities as Record<string, number>).regionProviders = 1;
    } catch {
      /* as above */
    }
    expect(host.has('regionProviders')).toBe(false);
    expect(host.summary()).toBe('host=unknown capabilities=themeTokens@1');
  });

  it('does not alias the host object it read from', () => {
    const caps = { themeTokens: 1 };
    const host = probeHost({ capabilities: caps });
    caps.themeTokens = 9;
    expect(host.level('themeTokens')).toBe(1);
  });
});
