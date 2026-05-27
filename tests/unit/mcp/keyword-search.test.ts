import { keywordSearch } from '../../../src/main/search/keyword-search';

function makeTable(rows: any[]) {
  return {
    query: () => ({
      fullTextSearch: (_text: string, _opts: any) => ({
        limit: (_n: number) => ({
          toArray: async () => rows,
        }),
      }),
    }),
  };
}

describe('keywordSearch', () => {
  it('returns empty array when table is null', async () => {
    const result = await keywordSearch(null, 'test', 5);
    expect(result).toEqual([]);
  });

  it('returns mapped results from fullTextSearch', async () => {
    const rows = [
      { id: 'a1', title: 'Hello world', content: 'some content', postType: 'post', postId: 1, metadata: '{}' },
      { id: 'a2', title: 'Second result', content: 'more content', postType: 'page', postId: 2, metadata: '{}' },
    ];
    const result = await keywordSearch(makeTable(rows), 'hello', 10);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Hello world');
    expect(result[0].score).toBe(1.0);
    expect(result[0].postId).toBe(1);
  });

  it('deduplicates by postId keeping first occurrence', async () => {
    const rows = [
      { id: 'a1', title: 'Chunk 1', content: 'content', postType: 'post', postId: 42, metadata: '{}' },
      { id: 'a2', title: 'Chunk 2', content: 'content', postType: 'post', postId: 42, metadata: '{}' },
    ];
    const result = await keywordSearch(makeTable(rows), 'content', 10);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('respects limit', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `id${i}`, title: `Title ${i}`, content: 'text', postType: 'post', postId: i, metadata: '{}',
    }));
    const result = await keywordSearch(makeTable(rows), 'text', 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('returns empty array when fullTextSearch throws', async () => {
    const badTable = {
      query: () => ({
        fullTextSearch: () => ({ limit: () => ({ toArray: async () => { throw new Error('no FTS index'); } }) }),
      }),
    };
    const result = await keywordSearch(badTable, 'test', 5);
    expect(result).toEqual([]);
  });
});
