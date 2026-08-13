import { rotateCredentials } from '../../../src/main/credentials/rotateCredentials';
import { KeyVault } from '../../../src/main/security/KeyVault';
import { STORAGE_KEYS } from '../../../src/common/constants';

function makeServices(opts: {
  credVersions: Record<string, number>;
  siteConfigs: Record<string, any>;
  sites: Record<string, { name: string }>;
  statuses: Record<string, string>;
  seedKey?: { provider: string; value: string };
}) {
  const data: Record<string, any> = {
    [STORAGE_KEYS.SITE_AI_CONFIG]: JSON.parse(JSON.stringify(opts.siteConfigs)),
    [STORAGE_KEYS.API_KEYS]: {},
  };
  const registryStorage = { get: (k: string) => data[k], set: (k: string, v: any) => { data[k] = v; } };
  // Seed an existing key first (bumps its version), THEN set the versions the test wants — so the
  // vault has a key to sync while the version numbers are as specified.
  if (opts.seedKey) {
    new KeyVault(registryStorage as any, STORAGE_KEYS.API_KEYS).setKey(opts.seedKey.provider, opts.seedKey.value);
  }
  data['nexus-ai_cred_versions'] = { ...opts.credVersions };
  const localServices = {
    getAllSiteStatuses: () => opts.statuses,
    getWpVersion: async () => '7.0',
    wpCliRun: async () => ({ success: true, stdout: '{"connectors":1,"ai_client":true}' }),
  };
  const siteData = { getSites: () => opts.sites };
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { registryStorage, localServices, siteData, logger } as any;
}

describe('rotateCredentials (P1-7)', () => {
  it('syncs a running stale site now (it becomes current) and leaves a stopped one stale', async () => {
    const services = makeServices({
      credVersions: { anthropic: 2 },
      siteConfigs: {
        running1: { provider: 'anthropic', useLocalGateway: false, syncedCredVersion: 1 },
        stopped1: { provider: 'anthropic', useLocalGateway: false, syncedCredVersion: 1 },
      },
      sites: { running1: { name: 'Running One' }, stopped1: { name: 'Stopped One' } },
      statuses: { running1: 'running', stopped1: 'stopped' },
      seedKey: { provider: 'anthropic', value: 'sk-ant-current' },
    });

    const report = await rotateCredentials(services, 'anthropic');

    expect(report.success).toBe(true);
    expect(report.synced).toEqual(['Running One']);            // synced now → current
    expect(report.stale).toEqual(['Stopped One']);             // self-heals on next start
  });

  it('classifies gateway sites as gateway and never syncs them', async () => {
    const services = makeServices({
      credVersions: { anthropic: 2 },
      siteConfigs: { gw: { provider: 'anthropic', useLocalGateway: true, syncedCredVersion: 0 } },
      sites: { gw: { name: 'Gateway Site' } },
      statuses: { gw: 'running' },
    });

    const report = await rotateCredentials(services, 'anthropic');
    expect(report.gateway).toEqual(['Gateway Site']);
    expect(report.stale).toEqual([]);
  });

  it('setting a new key bumps the version so a previously-current site becomes stale until synced', async () => {
    const services = makeServices({
      credVersions: { anthropic: 1 },
      siteConfigs: { stopped1: { provider: 'anthropic', useLocalGateway: false, syncedCredVersion: 1 } },
      sites: { stopped1: { name: 'Stopped One' } },
      statuses: { stopped1: 'stopped' },
    });

    // Rotate with a new key value → version bumps to 2 → the stopped site (synced at 1) is now stale.
    const report = await rotateCredentials(services, 'anthropic', { key: 'sk-ant-new-rotated-key' });
    expect(report.targetVersion).toBe(2);
    expect(report.stale).toEqual(['Stopped One']);
  });

  it('--force-now starts a stopped stale site, syncs it, and restores its stopped state', async () => {
    const services = makeServices({
      credVersions: { anthropic: 2 },
      siteConfigs: { stopped1: { provider: 'anthropic', useLocalGateway: false, syncedCredVersion: 1 } },
      sites: { stopped1: { name: 'Stopped One' } },
      statuses: { stopped1: 'stopped' },
      seedKey: { provider: 'anthropic', value: 'sk-ant-current' },
    });
    const startSites = jest.fn(async () => {});
    const stopSites = jest.fn(async () => {});
    services.localServices.startSites = startSites;
    services.localServices.stopSites = stopSites;

    const report = await rotateCredentials(services, 'anthropic', { force: true });

    expect(startSites).toHaveBeenCalledWith(['stopped1']);
    expect(stopSites).toHaveBeenCalledWith(['stopped1']); // state restored
    expect(report.synced).toEqual(['Stopped One']);       // force-synced → current
    expect(report.stale).toEqual([]);
  });
});
