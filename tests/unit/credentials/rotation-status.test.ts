import { computeRotationStatus } from '../../../src/main/credentials/rotationStatus';
import { STORAGE_KEYS } from '../../../src/common/constants';

function storageWith(credVersions: Record<string, number>, siteConfigs: Record<string, any>) {
  const data: Record<string, any> = {
    'nexus-ai_cred_versions': credVersions,
    [STORAGE_KEYS.SITE_AI_CONFIG]: siteConfigs,
  };
  return { get: (k: string) => data[k], set: (k: string, v: any) => { data[k] = v; } } as any;
}

describe('computeRotationStatus (P1-7 creds rotate)', () => {
  it('flags a non-gateway site behind the current version as stale', () => {
    const s = storageWith({ anthropic: 3 }, {
      siteA: { provider: 'anthropic', useLocalGateway: false, syncedCredVersion: 2 },
    });
    const r = computeRotationStatus(s, 'anthropic');
    expect(r.targetVersion).toBe(3);
    expect(r.stale).toEqual(['siteA']);
    expect(r.current).toEqual([]);
  });

  it('treats a site synced to the current version as current', () => {
    const s = storageWith({ anthropic: 3 }, {
      siteA: { provider: 'anthropic', useLocalGateway: false, syncedCredVersion: 3 },
    });
    expect(computeRotationStatus(s, 'anthropic').current).toEqual(['siteA']);
  });

  it('treats a site with no recorded version (never synced) as stale', () => {
    const s = storageWith({ anthropic: 1 }, {
      siteA: { provider: 'anthropic', useLocalGateway: false },
    });
    expect(computeRotationStatus(s, 'anthropic').stale).toEqual(['siteA']);
  });

  it('classifies gateway sites separately — never stale (gateway reads the vault live)', () => {
    const s = storageWith({ anthropic: 3 }, {
      siteA: { provider: 'anthropic', useLocalGateway: true, syncedCredVersion: 1 },
    });
    const r = computeRotationStatus(s, 'anthropic');
    expect(r.gateway).toEqual(['siteA']);
    expect(r.stale).toEqual([]);
  });

  it('ignores sites configured for a different provider', () => {
    const s = storageWith({ anthropic: 3, openai: 1 }, {
      siteA: { provider: 'openai', useLocalGateway: false, syncedCredVersion: 1 },
    });
    const r = computeRotationStatus(s, 'anthropic');
    expect(r.stale).toEqual([]);
    expect(r.current).toEqual([]);
    expect(r.gateway).toEqual([]);
  });
});
