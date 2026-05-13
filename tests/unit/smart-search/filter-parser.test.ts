import { matchesFilter } from '../../../src/main/smart-search/filter-parser';

describe('matchesFilter', () => {
  const doc = {
    post_type: 'post',
    post_title: 'Hello World',
    post_date_gmt: '2024-06-01T00:00:00',
    categories: [{ name: 'Sports' }, { name: 'News' }],
    tags: [{ name: 'breaking' }],
  };

  it('returns true when filter is empty or null', () => {
    expect(matchesFilter(doc, '')).toBe(true);
    expect(matchesFilter(doc, null)).toBe(true);
  });

  it('matches simple field:value', () => {
    expect(matchesFilter(doc, 'post_type:post')).toBe(true);
    expect(matchesFilter(doc, 'post_type:page')).toBe(false);
  });

  it('matches nested field (categories.name)', () => {
    expect(matchesFilter(doc, 'categories.name:Sports')).toBe(true);
    expect(matchesFilter(doc, 'categories.name:Politics')).toBe(false);
  });

  it('handles AND operator', () => {
    expect(matchesFilter(doc, 'post_type:post AND categories.name:Sports')).toBe(true);
    expect(matchesFilter(doc, 'post_type:post AND categories.name:Politics')).toBe(false);
  });

  it('handles OR operator', () => {
    expect(matchesFilter(doc, 'post_type:page OR categories.name:Sports')).toBe(true);
    expect(matchesFilter(doc, 'post_type:page OR categories.name:Politics')).toBe(false);
  });

  it('handles NOT operator', () => {
    expect(matchesFilter(doc, 'NOT post_type:page')).toBe(true);
    expect(matchesFilter(doc, 'NOT post_type:post')).toBe(false);
  });

  it('matches quoted values', () => {
    expect(matchesFilter(doc, 'post_title:"Hello World"')).toBe(true);
  });

  it('silently passes unknown fields (returns true)', () => {
    expect(matchesFilter(doc, 'unknown_field:value')).toBe(true);
  });
});
