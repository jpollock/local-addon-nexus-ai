import { getAllDocumentsHandler } from '../../../src/main/mcp/modules/content/get-all-documents';

function makeServices(opts: {
  localSite?: any;
  graphRows?: Array<{ id: string; name: string; source: string }>;
  docs?: any[];
} = {}) {
  const { localSite = null, graphRows = [], docs = [] } = opts;
  const db = {
    prepare: (sql: string) => ({
      all: (name?: string) => {
        if (!name) return graphRows;
        const sourceMatch = sql.match(/source = '(\w+)'/);
        return graphRows.filter(
          (r) => r.name === name && (!sourceMatch || r.source === sourceMatch[1]),
        );
      },
    }),
  };
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
    expect(services.vectorStore.getAllDocuments).toHaveBeenCalledWith(expect.stringMatching(/^ssh_hostinger-test_[0-9a-f]{8}$/));
  });

  it('still resolves a local site the same as before', async () => {
    const services = makeServices({ localSite: { id: 'site-1', name: 'mysite' }, docs: [] });

    const result = await getAllDocumentsHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    expect(services.vectorStore.getAllDocuments).toHaveBeenCalledWith(expect.stringMatching(/^site-1_[0-9a-f]{8}$/));
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

/**
 * Fix 3 — get_all_site_documents rejected the qualified target string that
 * nexus_list_sites tells the agent to use.
 */
describe('get_all_site_documents — qualified target strings', () => {
  const ROWS = [
    { id: 'ssh:hostinger-test', name: 'hostinger-test', source: 'external' },
    { id: 'wpe-abc', name: 'myinstall', source: 'wpe' },
  ];

  it('accepts ssh:<alias>@production and asks for the same translated vector id', async () => {
    const services = makeServices({ graphRows: ROWS, docs: [] });

    const result = await getAllDocumentsHandler.execute({ site: 'ssh:hostinger-test@production' }, services);

    expect(result.isError).toBeUndefined();
    // Same id the bare alias produces — colon translated + hash-suffixed for the vector store.
    expect(services.vectorStore.getAllDocuments).toHaveBeenCalledWith(expect.stringMatching(/^ssh_hostinger-test_[0-9a-f]{8}$/));
  });

  it('accepts wpe:<account>/<install>@<env> and leaves the colon-free id untouched', async () => {
    const services = makeServices({ graphRows: ROWS, docs: [] });

    const result = await getAllDocumentsHandler.execute({ site: 'wpe:acct/myinstall@production' }, services);

    expect(result.isError).toBeUndefined();
    expect(services.vectorStore.getAllDocuments).toHaveBeenCalledWith(expect.stringMatching(/^wpe-abc_[0-9a-f]{8}$/));
  });

  it('errors cleanly (no throw) on an unknown qualified target', async () => {
    const services = makeServices({ graphRows: ROWS, docs: [] });

    const result = await getAllDocumentsHandler.execute({ site: 'ssh:doesnotexist@production' }, services);

    expect(result.isError).toBe(true);
    expect(services.vectorStore.getAllDocuments).not.toHaveBeenCalled();
  });
});
