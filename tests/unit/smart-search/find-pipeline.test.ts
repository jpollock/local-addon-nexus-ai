import {
  expandSynonyms,
  applySearchBias,
  applyPostProcess,
  computeAggregations,
  applyTimeDecay,
} from '../../../src/main/smart-search/find-pipeline';
import type { SynonymRule } from '../../../src/main/smart-search/SynonymStore';
import type { FindDoc, PostProcessOptions } from '../../../src/main/smart-search/find-pipeline';

describe('expandSynonyms', () => {
  it('returns query unchanged when no rules', () => {
    expect(expandSynonyms('laptop', [])).toBe('laptop');
  });

  it('expands equivalent synonyms bidirectionally', () => {
    const rules: SynonymRule[] = [{ id: '1', siteId: 'x', synonyms: 'laptop, notebook, computer', createdAt: 0 }];
    const result = expandSynonyms('laptop', rules);
    expect(result).toContain('notebook');
    expect(result).toContain('computer');
  });

  it('expands one-way synonyms (left => right only)', () => {
    const rules: SynonymRule[] = [{ id: '1', siteId: 'x', synonyms: 'phone => smartphone', createdAt: 0 }];
    expect(expandSynonyms('phone', rules)).toContain('smartphone');
    // One-way rules are directional: "phone => smartphone" expands phone to smartphone,
    // but querying "smartphone" should not reverse-expand to include "phone"
    expect(expandSynonyms('smartphone', rules)).toBe('smartphone');
  });
});

describe('applySearchBias', () => {
  it('returns vectorWeight 0 for bias 0', () => {
    expect(applySearchBias(0)).toBe(0);
  });

  it('returns vectorWeight 1 for bias 10', () => {
    expect(applySearchBias(10)).toBe(1);
  });

  it('returns 0.5 for bias 5', () => {
    expect(applySearchBias(5)).toBeCloseTo(0.5);
  });
});

describe('applyTimeDecay', () => {
  it('returns documents unchanged when no decay config', () => {
    const docs: FindDoc[] = [
      {
        id: 'post:1',
        score: 0.9,
        sort: [],
        data: { post_date_gmt: '2024-01-01T00:00:00' },
      },
    ];
    const result = applyTimeDecay(docs, []);
    expect(result).toEqual(docs);
  });

  it('applies time decay multiplier based on age', () => {
    const now = Date.now();
    const pastDate = new Date(now - 30 * 86400000).toISOString(); // 30 days ago
    const docs: FindDoc[] = [
      {
        id: 'post:1',
        score: 1.0,
        sort: [],
        data: { post_date_gmt: pastDate },
      },
    ];
    const decayConfig = [{ field: 'post_date_gmt', scale: '30', decayRate: 0.1 }];
    const result = applyTimeDecay(docs, decayConfig);
    expect(result[0].score).toBeLessThan(1.0);
    expect(result[0].score).toBeGreaterThan(0);
  });
});

describe('applyPostProcess', () => {
  const makeDocs = (ids: string[]): FindDoc[] =>
    ids.map(id => ({
      id,
      score: 0.9,
      sort: [String(0.9), id],
      data: {
        post_type: 'post',
        post_title: `Title ${id}`,
        post_date_gmt: '2024-01-01T00:00:00',
        categories: [],
      },
    }));

  it('prepends promoted documents', () => {
    const docs = makeDocs(['post:1', 'post:2']);
    const promoted: FindDoc[] = [
      {
        id: 'post:99',
        score: 1,
        sort: ['1', 'post:99'],
        data: {
          post_type: 'post',
          post_title: 'Pinned',
          post_date_gmt: '',
          categories: [],
        },
      },
    ];
    const result = applyPostProcess(docs, { promotedDocs: promoted });
    expect(result[0].id).toBe('post:99');
  });

  it('applies includeFields to data', () => {
    const docs = makeDocs(['post:1']);
    const result = applyPostProcess(docs, { includeFields: ['post_title'] });
    expect(Object.keys(result[0].data)).toEqual(['post_title']);
  });

  it('applies excludeFields to data', () => {
    const docs = makeDocs(['post:1']);
    const result = applyPostProcess(docs, { excludeFields: ['post_type'] });
    expect(result[0].data).not.toHaveProperty('post_type');
    expect(result[0].data).toHaveProperty('post_title');
  });
});

describe('computeAggregations', () => {
  const docs: FindDoc[] = [
    {
      id: '1',
      score: 1,
      sort: [],
      data: { post_type: 'post', categories: [{ name: 'Sports' }] },
    },
    {
      id: '2',
      score: 1,
      sort: [],
      data: { post_type: 'page', categories: [{ name: 'Sports' }] },
    },
    {
      id: '3',
      score: 1,
      sort: [],
      data: { post_type: 'post', categories: [{ name: 'News' }] },
    },
  ];

  it('computes term counts for a field', () => {
    const agg = computeAggregations(docs, [{ field: 'post_type', size: 10 }]);
    const postType = agg.terms.find(t => t.field === 'post_type');
    expect(postType?.terms.find(t => t.term === 'post')?.count).toBe(2);
    expect(postType?.terms.find(t => t.term === 'page')?.count).toBe(1);
  });

  it('computes term counts for nested array field', () => {
    const agg = computeAggregations(docs, [{ field: 'categories', size: 10 }]);
    const catAgg = agg.terms.find(t => t.field === 'categories');
    expect(catAgg?.terms.find(t => t.term === 'Sports')?.count).toBe(2);
    expect(catAgg?.terms.find(t => t.term === 'News')?.count).toBe(1);
  });

  it('respects size limit in aggregations', () => {
    const docs: FindDoc[] = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      score: 1,
      sort: [],
      data: { post_type: `type${i % 3}` },
    }));
    const agg = computeAggregations(docs, [{ field: 'post_type', size: 2 }]);
    const postType = agg.terms.find(t => t.field === 'post_type');
    expect(postType?.terms.length).toBe(2);
  });
});
