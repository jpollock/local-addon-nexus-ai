import { applyMetadataFilters } from '../../../src/main/vector-store/metadata-filters';

describe('applyMetadataFilters (generic, domain-agnostic)', () => {
  const doc = { difficulty: '2', distance: '4.5', region: 'Rocky Mountains' };

  it('numeric lte passes and fails correctly', () => {
    expect(applyMetadataFilters(doc, [{ field: 'difficulty', op: 'lte', value: 2 }])).toBe(true);
    expect(applyMetadataFilters(doc, [{ field: 'difficulty', op: 'lte', value: 1 }])).toBe(false);
  });

  it('numeric gt/lt on distance', () => {
    expect(applyMetadataFilters(doc, [{ field: 'distance', op: 'lt', value: 5 }])).toBe(true);
    expect(applyMetadataFilters(doc, [{ field: 'distance', op: 'gt', value: 5 }])).toBe(false);
  });

  it('string eq and contains', () => {
    expect(applyMetadataFilters(doc, [{ field: 'region', op: 'eq', value: 'Rocky Mountains' }])).toBe(true);
    expect(applyMetadataFilters(doc, [{ field: 'region', op: 'contains', value: 'rocky' }])).toBe(true);
    expect(applyMetadataFilters(doc, [{ field: 'region', op: 'ne', value: 'Sierra Nevada' }])).toBe(true);
  });

  it('missing field fails closed', () => {
    expect(applyMetadataFilters(doc, [{ field: 'elevation_gain', op: 'lte', value: 1000 }])).toBe(false);
  });

  it('ALL filters must pass (AND semantics)', () => {
    expect(applyMetadataFilters(doc, [
      { field: 'difficulty', op: 'lte', value: 2 },
      { field: 'distance', op: 'lte', value: 5 },
    ])).toBe(true);
    expect(applyMetadataFilters(doc, [
      { field: 'difficulty', op: 'lte', value: 2 },
      { field: 'distance', op: 'lte', value: 3 },
    ])).toBe(false);
  });
});
