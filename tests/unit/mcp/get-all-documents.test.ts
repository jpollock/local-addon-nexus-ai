import { getAllDocumentsHandler } from '../../../src/main/mcp/modules/content/get-all-documents';

function makeServices(opts: {
  localSite?: any;
  graphRows?: Array<{ id: string; name: string; source: string }>;
  docs?: any[];
} = {}) {
  const { localSite = null, graphRows = [], docs = [] } = opts;
  const db = { prepare: () => ({ all: () => graphRows }) };
  return {
    siteData: { getSite: jest.fn().mockReturnValue(localSite), getSites: jest.fn().mockReturnValue({}) },
    graphService: { getDb: jest.fn().mockReturnValue(db) },
    vectorStore: { getAllDocuments: jest.fn().mockResolvedValue(docs) },
  } as any;
}

describe('get_all_site_documents — remote resolution', () => {
  it('resolves an external alias via the graph and translates the id before the vector-store call', async () => {
    const services = makeServices({
      graphRows: [{ id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' }],
      docs: [],
    });

    const result = await getAllDocumentsHandler.execute({ site: 'hostinger-test' }, services);

    expect(result.isError).toBeUndefined();
    expect(services.vectorStore.getAllDocuments).toHaveBeenCalledWith('ssh_hostinger-test');
  });

  it('still resolves a local site the same as before', async () => {
    const services = makeServices({ localSite: { id: 'site-1', name: 'mysite' }, docs: [] });

    const result = await getAllDocumentsHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    expect(services.vectorStore.getAllDocuments).toHaveBeenCalledWith('site-1');
  });

  it('declines on a cross-source name collision', async () => {
    const services = makeServices({
      graphRows: [
        { id: 'wpe-1', name: 'dupe', source: 'wpe' },
        { id: 'ssh:dupe', name: 'dupe', source: 'external' },
      ],
    });

    const result = await getAllDocumentsHandler.execute({ site: 'dupe' }, services);

    expect(result.isError).toBe(true);
  });
});
