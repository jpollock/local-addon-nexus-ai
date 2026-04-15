import { createResolvers } from '../../src/main/graphql/resolvers';

function makeServices(overrides: any = {}) {
  const embed = jest.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));
  const search = jest.fn().mockResolvedValue([
    { id: 'wp_site-a_10', title: 'About Us', content: 'Long form about page content body', postType: 'page', postId: 10, score: 0.87, metadata: '' },
    { id: 'wp_site-a_11', title: 'Contact',  content: 'Contact form and hours of operation',   postType: 'page', postId: 11, score: 0.71, metadata: '' },
  ]);
  const searchAcrossSites = jest.fn().mockResolvedValue(new Map([
    ['site-a', [
      { id: 'wp_site-a_10', title: 'About Us', content: 'Long form about page content body', postType: 'page', postId: 10, score: 0.87, metadata: '' },
    ]],
    ['site-b', [
      { id: 'wp_site-b_5', title: 'Blog Intro', content: 'Welcome to the blog home page', postType: 'post', postId: 5, score: 0.64, metadata: '' },
    ]],
  ]));

  return {
    vectorStore: { search, searchAcrossSites },
    embeddingService: { embed },
    indexRegistry: {
      listAll: jest.fn().mockReturnValue([
        { siteId: 'site-a', siteName: 'Site A', state: 'indexed' },
        { siteId: 'site-b', siteName: 'Site B', state: 'indexed' },
      ]),
    },
    siteData: {
      getSites: () => ({
        'site-a': { id: 'site-a', name: 'Site A' },
      }),
    },
    graphService: { getDb: () => null },
    registryStorage: { get: () => ({}), set: () => {} },
    ...overrides,
  };
}

function getResolvers(servicesOverrides: any = {}) {
  const services = makeServices(servicesOverrides);
  const registry = { call: jest.fn() } as any;
  const { Mutation } = createResolvers({ services, registry });
  return { Mutation, services };
}

describe('nexusFleetSearch resolver', () => {
  it('embeds the query and calls searchAcrossSites with the correct argument shape', async () => {
    const { Mutation, services } = getResolvers();

    const result = await (Mutation as any).nexusFleetSearch(null, { query: 'about page', limit: 10 });

    expect(services.embeddingService.embed).toHaveBeenCalledTimes(1);
    expect(services.embeddingService.embed).toHaveBeenCalledWith('about page');

    expect(services.vectorStore.searchAcrossSites).toHaveBeenCalledTimes(1);
    const [siteIds, vector, options, concurrency] = services.vectorStore.searchAcrossSites.mock.calls[0];
    expect(Array.isArray(siteIds)).toBe(true);
    expect(siteIds).toEqual(expect.arrayContaining(['site-a', 'site-b']));
    expect(vector).toBeInstanceOf(Float32Array);
    expect(options).toMatchObject({ queryText: 'about page' });
    expect(typeof concurrency).toBe('number');

    expect(result.success).toBe(true);
    expect(result.error).toBeFalsy();
    expect(result.results).toHaveLength(2);

    const topHit = result.results[0];
    expect(topHit.siteName).toBe('Site A');
    expect(topHit.target).toBe('Site A@local');
    expect(topHit.type).toBe('page');
    expect(topHit.score).toBeCloseTo(0.87);
    expect(topHit.snippet).toContain('About Us');
  });

  it('does NOT call the old broken signature vectorStore.search(string, number)', async () => {
    const { Mutation, services } = getResolvers();
    await (Mutation as any).nexusFleetSearch(null, { query: 'x', limit: 20 });

    if (services.vectorStore.search.mock.calls.length > 0) {
      const [firstArg] = services.vectorStore.search.mock.calls[0];
      expect(typeof firstArg).not.toBe('string');
    }
  });

  it('returns error shape when vectorStore is missing', async () => {
    const { Mutation } = getResolvers({ vectorStore: null });
    const result = await (Mutation as any).nexusFleetSearch(null, { query: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available/i);
    expect(result.results).toEqual([]);
  });

  it('returns error shape when embeddingService is missing', async () => {
    const { Mutation } = getResolvers({ embeddingService: null });
    const result = await (Mutation as any).nexusFleetSearch(null, { query: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available/i);
  });
});

describe('nexusContentSearch resolver', () => {
  it('embeds the query and calls vectorStore.search with (siteId, vector, options)', async () => {
    const { Mutation, services } = getResolvers();

    const result = await (Mutation as any).nexusContentSearch(null, {
      target: 'Site A@local',
      query: 'contact',
      limit: 5,
    });

    expect(services.embeddingService.embed).toHaveBeenCalledWith('contact');
    expect(services.vectorStore.search).toHaveBeenCalledTimes(1);
    const [siteId, vector, options] = services.vectorStore.search.mock.calls[0];
    expect(siteId).toBe('site-a');
    expect(vector).toBeInstanceOf(Float32Array);
    expect(options).toMatchObject({ limit: 5 });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);

    const first = result.results[0];
    expect(first.path).toBe('About Us');
    expect(first.type).toBe('page');
    expect(first.score).toBeCloseTo(0.87);
    expect(first.snippet).toContain('about page content');
    expect(first.lineNumber).toBeNull();
  });

  it('does NOT call the old broken signature vectorStore.search(string, number, {siteId})', async () => {
    const { Mutation, services } = getResolvers();
    await (Mutation as any).nexusContentSearch(null, {
      target: 'Site A@local',
      query: 'x',
    });

    const [firstArg] = services.vectorStore.search.mock.calls[0];
    expect(typeof firstArg).toBe('string');
    expect(firstArg).toBe('site-a');
  });

  it('returns site-not-found error for unknown target', async () => {
    const { Mutation } = getResolvers();
    const result = await (Mutation as any).nexusContentSearch(null, {
      target: 'nonexistent@local',
      query: 'x',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error shape when services missing', async () => {
    const { Mutation } = getResolvers({ embeddingService: null });
    const result = await (Mutation as any).nexusContentSearch(null, {
      target: 'Site A@local',
      query: 'x',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available/i);
  });
});
