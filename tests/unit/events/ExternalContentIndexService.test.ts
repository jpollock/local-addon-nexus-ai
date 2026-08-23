import { ExternalContentIndexService } from '../../../src/main/events/ExternalContentIndexService';
import { vectorSiteId } from '../../../src/main/vector-store/vectorSiteId';

function makeTransport(posts: any[]) {
  return {
    kind: 'external-ssh' as any,
    siteRef: { kind: 'external', alias: 'test' } as any,
    supports: () => true,
    probe: async () => ({ reachable: true }),
    deleteRemoteFile: async () => ({ success: false, output: 'n/a' }),
    runWpCli: async () => ({ stdout: JSON.stringify(posts), success: true }),
  };
}

function makeDeps(overrides: Partial<any> = {}) {
  const upsertContentCalls: any[] = [];
  const upsertCalls: any[] = [];
  const registryUpdates: any[] = [];
  return {
    graphService: {
      upsertContent: jest.fn(async (c: any) => { upsertContentCalls.push(c); return 1; }),
    },
    embeddingService: {
      embedBatch: jest.fn(async (texts: string[]) => texts.map(() => new Float32Array([0.1, 0.2]))),
    },
    vectorStore: {
      upsert: jest.fn(async (siteId: string, docs: any[]) => { upsertCalls.push({ siteId, docs }); }),
    },
    indexRegistry: {
      update: jest.fn((siteId: string, partial: any) => { registryUpdates.push({ siteId, partial }); }),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    _upsertContentCalls: upsertContentCalls,
    _upsertCalls: upsertCalls,
    _registryUpdates: registryUpdates,
    ...overrides,
  };
}

const post = (id: number) => ({
  ID: id, post_title: `Post ${id}`, post_content: `<p>Content ${id}</p>`,
  post_excerpt: '', post_type: 'post', post_status: 'publish', post_author: '1',
  post_date: '2026-01-01 00:00:00',
});

describe('ExternalContentIndexService.indexOne', () => {
  it('extracts, embeds, stores, and marks the registry indexed', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const transport = makeTransport([post(1), post(2)]);
    const result = await service.indexOne(transport, 'ssh:myhost', 'myhost');

    expect(result.documentCount).toBe(2);
    expect(deps._upsertContentCalls).toHaveLength(2);
    expect(deps._upsertContentCalls[0].site_id).toBe('ssh:myhost');
    expect(deps._upsertCalls).toHaveLength(1);
    expect(deps._upsertCalls[0].siteId).toBe(vectorSiteId('ssh:myhost')); // vectorSiteId translation
    expect(deps._registryUpdates[0].siteId).toBe('ssh:myhost'); // real id, not translated
    expect(deps._registryUpdates[0].partial.state).toBe('indexed');
    expect(deps._registryUpdates[0].partial.documentCount).toBe(2);
  });

  it('completes without throwing for a real two-segment multi-site external id', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const transport = makeTransport([post(1), post(2)]);
    const result = await service.indexOne(transport, 'ssh:myhost/mysite', 'myhost/mysite');

    expect(result.documentCount).toBe(2);
    expect(deps._registryUpdates[0].partial.state).toBe('indexed');
    expect(deps._upsertCalls).toHaveLength(1);
    const upsertMock = deps.vectorStore.upsert as jest.Mock;
    expect(/^[a-zA-Z0-9_-]+$/.test(upsertMock.mock.calls[0][0])).toBe(true);
    expect(upsertMock.mock.calls[0][0]).toBe(vectorSiteId('ssh:myhost/mysite'));
  });

  it('writes source: external in every vector document\'s metadata, never wpe', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const transport = makeTransport([post(1)]);
    await service.indexOne(transport, 'ssh:myhost', 'myhost');

    const doc = deps._upsertCalls[0].docs[0];
    const metadata = JSON.parse(doc.metadata);
    expect(metadata.source).toBe('external');
    expect(metadata.source).not.toBe('wpe');
  });

  it('marks the registry indexed with documentCount 0 when there are no posts, not error', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const transport = makeTransport([]);
    const result = await service.indexOne(transport, 'ssh:myhost', 'myhost');

    expect(result.documentCount).toBe(0);
    expect(deps._registryUpdates[0].partial.state).toBe('indexed');
    expect(deps._registryUpdates[0].partial.documentCount).toBe(0);
  });

  // REVERSED 2026-08-23 (pipeline-observability packet). This used to pin
  // "does not throw when extraction fails" — the swallow returned
  // {documentCount: 0}, the same shape as an empty site, so callers reported
  // "no content returned" for hosts that were never read, and
  // indexAllExternalContent counted the failure as indexed++. WP-67's
  // fabrication, one layer down. Every caller already handles a throw
  // (scheduler failed++, fleet loop errors++, nexusHostIndex success:false,
  // bulk manager 'failed'), so the swallow protected nothing.
  it('marks the registry state=error and RETHROWS when extraction fails', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const throwingTransport = {
      ...makeTransport([]),
      runWpCli: async () => { throw new Error('SSH connection refused'); },
    };
    await expect(service.indexOne(throwingTransport as any, 'ssh:myhost', 'myhost'))
      .rejects.toThrow('SSH connection refused');
    expect(deps._registryUpdates[0].partial.state).toBe('error');
  });

  it('embeds in batches of 10, matching the existing WPESyncService batch size', async () => {
    const deps = makeDeps();
    const service = new ExternalContentIndexService(deps as any);
    const posts = Array.from({ length: 25 }, (_, i) => post(i + 1));
    const transport = makeTransport(posts);
    await service.indexOne(transport, 'ssh:myhost', 'myhost');
    expect(deps.embeddingService.embedBatch).toHaveBeenCalledTimes(3); // 10, 10, 5
  });
});

describe('ExternalContentIndexService.indexAllExternalContent', () => {
  it('queries only source=external, never wpe', async () => {
    const deps = makeDeps();
    let capturedSql = '';
    (deps.graphService as any).getDb = () => ({
      prepare: (sql: string) => { capturedSql = sql; return { all: () => [] }; },
    });
    const service = new ExternalContentIndexService(deps as any);
    await service.indexAllExternalContent();
    expect(capturedSql).toContain("source = 'external'");
    expect(capturedSql).toContain('is_active = 1');
    expect(capturedSql).not.toContain("'wpe'");
  });
});
