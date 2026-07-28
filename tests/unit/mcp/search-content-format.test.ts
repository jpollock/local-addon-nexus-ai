import { formatCustomFields, coerceMetadataFilters } from '../../../src/main/mcp/modules/content/search-content';

describe('formatCustomFields', () => {
  it('renders customFields compactly', () => {
    const meta = JSON.stringify({ customFields: { difficulty: '2', distance: '4.5', region: 'Rocky Mountains' } });
    const out = formatCustomFields(meta);
    expect(out).toContain('difficulty: 2');
    expect(out).toContain('distance: 4.5');
    expect(out).toContain('region: Rocky Mountains');
  });

  it('returns empty string when no customFields', () => {
    expect(formatCustomFields(JSON.stringify({ excerpt: 'x' }))).toBe('');
  });
});

describe('coerceMetadataFilters', () => {
  it('parses JSON string array to array', () => {
    const jsonString = '[{"field":"difficulty","op":"lte","value":2}]';
    const result = coerceMetadataFilters(jsonString);
    expect(result).toEqual([{ field: 'difficulty', op: 'lte', value: 2 }]);
  });

  it('returns array as-is when already parsed', () => {
    const arr = [{ field: 'distance', op: 'gte', value: 3.5 }];
    const result = coerceMetadataFilters(arr);
    expect(result).toEqual(arr);
  });

  it('returns undefined for invalid JSON string', () => {
    const result = coerceMetadataFilters('not valid json');
    expect(result).toBeUndefined();
  });

  it('returns undefined for non-array types', () => {
    expect(coerceMetadataFilters(42)).toBeUndefined();
    expect(coerceMetadataFilters({ field: 'x', op: 'eq', value: 1 })).toBeUndefined();
    expect(coerceMetadataFilters(null)).toBeUndefined();
  });

  it('filters out malformed entries from array', () => {
    const arr = [
      { field: 'difficulty', op: 'lte', value: 2 }, // valid
      { field: 'distance' }, // missing op and value
      { op: 'eq', value: 3 }, // missing field
      'not an object', // not an object
      { field: 'region', op: 'eq', value: 'Rocky Mountains' }, // valid
    ];
    const result = coerceMetadataFilters(arr);
    expect(result).toEqual([
      { field: 'difficulty', op: 'lte', value: 2 },
      { field: 'region', op: 'eq', value: 'Rocky Mountains' },
    ]);
  });

  it('returns undefined for empty string', () => {
    expect(coerceMetadataFilters('')).toBeUndefined();
    expect(coerceMetadataFilters('   ')).toBeUndefined();
  });

  it('returns undefined when all entries filtered out', () => {
    const arr = [{ invalid: 'entry' }, { another: 'bad' }];
    const result = coerceMetadataFilters(arr);
    expect(result).toBeUndefined();
  });
});
