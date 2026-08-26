/**
 * fixes-082526 · Tier A 5b — D10's second defect, external half.
 *
 * The WPE path (D12, WPESyncService.syncContent) already distinguishes "the
 * READ failed" from "the site is empty". `ExternalContentIndexService.indexOne`
 * still collapsed them: a host whose SSH resolve failed was marked
 * state='indexed' with documentCount 0, and the bulk adapter printed "No
 * content returned by the extractor" — WP-67's amber lie, verbatim, for a
 * host that may be full of content we never reached.
 *
 * These drive the REAL extractor through a mock transport, so the coverage
 * plumbing (page-failed + detail carrying the transport's own words) is the
 * thing under test, not a mock of it.
 */
import { ExternalContentIndexService } from '../../../src/main/events/ExternalContentIndexService';

const SSH_ERROR = 'ssh: Could not resolve hostname nope.example: nodename nor servname provided';

function makeDeps() {
  const registryUpdates: any[] = [];
  return {
    graphService: { upsertContent: jest.fn(async () => 1) },
    embeddingService: { embedBatch: jest.fn(async (t: string[]) => t.map(() => new Float32Array([0.1]))) },
    vectorStore: { upsert: jest.fn(async () => undefined) },
    indexRegistry: { update: jest.fn((siteId: string, partial: any) => registryUpdates.push({ siteId, partial })) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    _registryUpdates: registryUpdates,
  };
}

const failingTransport = {
  kind: 'external-ssh' as any,
  siteRef: { kind: 'external', alias: 'nope' } as any,
  supports: () => true,
  probe: async () => ({ reachable: false }),
  deleteRemoteFile: async () => ({ success: false, output: 'n/a' }),
  runWpCli: async () => ({ success: false, stdout: SSH_ERROR }),
};

const emptyTransport = {
  ...failingTransport,
  runWpCli: async () => ({ success: true, stdout: '[]' }),
};

describe('indexOne — a failed read is a failure, never an empty site', () => {
  it('THROWS with the transport\'s own words when the first page fails', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    await expect(service.indexOne(failingTransport as any, 'ssh:nope', 'nope')).rejects.toThrow(
      /Could not resolve hostname/
    );
  });

  it('marks the registry state=error for the failed read — never indexed-with-zero', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    await service.indexOne(failingTransport as any, 'ssh:nope', 'nope').catch(() => undefined);
    const states = deps._registryUpdates.map((u) => u.partial.state);
    expect(states).toContain('error');
    expect(states).not.toContain('indexed');
  });

  it('a genuinely empty site stays indexed-with-zero and names its emptiness', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const result = await service.indexOne(emptyTransport as any, 'ssh:empty', 'empty');
    expect(result.documentCount).toBe(0);
    expect(result.emptyReason).toBe('no published posts');
    expect(deps._registryUpdates[0].partial.state).toBe('indexed');
  });
});
