/**
 * fixes-082526 · item 6 — nexusHostAdd / nexusHostRemove reach the
 * compliance record.
 *
 * CLAUDE.md's own gaps list named it: "nexusHostAdd/nexusHostRemove write to
 * the graph directly via upsertSite — the exact reasoning that justified
 * auditing nexusHostRefresh/nexusHostIndex — yet remain unaudited
 * themselves." Registering a connection to a third party's production server
 * and cascading a soft-delete over every site under an alias are both
 * mutations of the addon's operational state; both now write
 * operation-audit.log on both outcomes.
 *
 * The add audit lives in registerExternalHostSite — the chokepoint
 * nexusHostAdd AND nexusHostAddSites share — so the wizard's batched entry
 * point is covered by the same write, not by a second copy.
 */
import * as path from 'path';
import * as fs from 'fs';
import { GraphService } from '../../../src/main/events/GraphService';

const mockProbe = jest.fn();
jest.mock('../../../src/main/external/probeExternalHost', () => ({
  probeExternalHost: (...args: unknown[]) => mockProbe(...args),
}));
// verifyExternalSite runs a real SSH exec — stub the module boundary it uses.
jest.mock('../../../src/main/transport', () => ({
  resolveTransport: jest.fn(),
}));

import { createResolvers } from '../../../src/main/graphql/resolvers';

describe('host add/remove audit', () => {
  let graphService: GraphService;
  let dbPath: string;
  let auditMock: jest.Mock;

  beforeEach(async () => {
    dbPath = path.join(__dirname, `test-host-audit-${Date.now()}-${Math.random()}.db`);
    graphService = new GraphService(dbPath);
    await graphService.initialize();
    mockProbe.mockReset();
    auditMock = jest.fn();
  });

  afterEach(async () => {
    await graphService.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  function ctx() {
    const kv = new Map<string, unknown>();
    return {
      services: {
        graphService,
        operationAuditLog: { log: auditMock },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        registryStorage: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) },
        siteData: { getSite: jest.fn(), getSites: jest.fn().mockReturnValue({}) },
      },
      registry: {},
    } as any;
  }

  it('a failed add (probe failure) audits external.host.add as failure', async () => {
    mockProbe.mockResolvedValue({ ok: false, failure: { kind: 'no-wordpress', detail: 'no WP found' } });
    await (createResolvers(ctx()).Mutation as any).nexusHostAdd(null, { alias: 'myhost' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'external.host.add',
      target: 'myhost',
      outcome: 'failure',
    }));
  });

  it('a thrown add audits failure with the error', async () => {
    mockProbe.mockRejectedValue(new Error('ssh exploded'));
    await (createResolvers(ctx()).Mutation as any).nexusHostAdd(null, { alias: 'myhost' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'external.host.add',
      outcome: 'failure',
      error: expect.stringContaining('ssh exploded'),
    }));
  });

  it('remove audits external.host.remove with the cascade count', async () => {
    await graphService.upsertSite({
      id: 'ssh:myhost/site1', name: 'site1', source: 'external', host: 'external',
      domain: 'site1.example', account_id: 'myhost', is_active: true,
      created_at: Date.now(), updated_at: Date.now(),
    });
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRemove(null, { alias: 'myhost' });
    expect(r.success).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'external.host.remove',
      target: 'myhost',
      outcome: 'success',
      parameters: expect.objectContaining({ sitesDeactivated: 1 }),
    }));
  });

  it('a remove that throws audits failure', async () => {
    const c = ctx();
    c.services.registryStorage = null; // storage missing → the early failure exit
    await (createResolvers(c).Mutation as any).nexusHostRemove(null, { alias: 'myhost' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'external.host.remove',
      outcome: 'failure',
    }));
  });
});
