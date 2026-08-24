/**
 * D24/D25 — ordering in metadata filters is typed per value pair, and a
 * filter that cannot work says so.
 *
 * The Meridian gate proved both silent failures: an ISO date never parses as
 * a number, so `last_reviewed lt 2024-08-21` matched ZERO of 1,400 qualifying
 * posts (D25); and "2.10" coerced to 2.1, sorting below 2.9 (D24). Both were
 * empty-or-wrong results with no indication anything was off.
 */
import { applyMetadataFilters, UnorderableFilterError } from '../../../src/main/vector-store/metadata-filters';
import type { MetadataFilter } from '../../../src/common/types';

const f = (field: string, op: MetadataFilter['op'], value: unknown): MetadataFilter[] =>
  [{ field, op, value } as MetadataFilter];

describe('D25 — ISO dates order chronologically', () => {
  test('lt on an ISO date matches genuinely older dates', () => {
    expect(applyMetadataFilters({ last_reviewed: '2022-03-01' }, f('last_reviewed', 'lt', '2024-08-21'))).toBe(true);
    expect(applyMetadataFilters({ last_reviewed: '2025-05-15' }, f('last_reviewed', 'lt', '2024-08-21'))).toBe(false);
  });

  test('gte and datetime-suffixed values work', () => {
    expect(applyMetadataFilters({ d: '2024-08-21T10:00:00' }, f('d', 'gte', '2024-08-21'))).toBe(true);
    expect(applyMetadataFilters({ d: '2024-08-20' }, f('d', 'gte', '2024-08-21'))).toBe(false);
  });

  test('a non-date doc value against a date filter fails closed, not loudly', () => {
    expect(applyMetadataFilters({ d: 'n/a' }, f('d', 'lt', '2024-08-21'))).toBe(false);
  });
});

describe('D24 — version strings compare segment-wise', () => {
  test('the Meridian case: 2.10 is NEWER than 2.9', () => {
    expect(applyMetadataFilters({ v: '2.10' }, f('v', 'gte', '2.9'))).toBe(true);
    expect(applyMetadataFilters({ v: '2.10' }, f('v', 'lt', '2.9'))).toBe(false);
  });

  test('multi-dot versions: 1.2.10 > 1.2.9', () => {
    expect(applyMetadataFilters({ v: '1.2.10' }, f('v', 'gt', '1.2.9'))).toBe(true);
  });

  test('faithful decimals STAY numeric: 1.5 > 1.25', () => {
    expect(applyMetadataFilters({ price: '1.5' }, f('price', 'gt', '1.25'))).toBe(true);
    expect(applyMetadataFilters({ price: '1.25' }, f('price', 'lt', '1.5'))).toBe(true);
  });

  test('equality does not launder precision: "2.10" ne "2.1"', () => {
    expect(applyMetadataFilters({ v: '2.10' }, f('v', 'eq', '2.1'))).toBe(false);
    expect(applyMetadataFilters({ v: '2.10' }, f('v', 'ne', '2.1'))).toBe(true);
    expect(applyMetadataFilters({ v: '2.10' }, f('v', 'eq', '2.10'))).toBe(true);
  });
});

describe('a filter that cannot work says so', () => {
  test('an ordering op with an unorderable filter value throws, naming the field and op', () => {
    expect(() => applyMetadataFilters({ status: 'draft' }, f('status', 'lt', 'stale')))
      .toThrow(UnorderableFilterError);
    try {
      applyMetadataFilters({ status: 'draft' }, f('status', 'gte', 'stale'));
    } catch (e) {
      expect((e as UnorderableFilterError).field).toBe('status');
      expect((e as Error).message).toContain('gte');
      expect((e as Error).message).toContain('status');
    }
  });

  test('plain numeric ordering, contains, and fail-closed missing fields are unchanged', () => {
    expect(applyMetadataFilters({ n: '400' }, f('n', 'lt', 500))).toBe(true);
    expect(applyMetadataFilters({ t: 'Hello World' }, f('t', 'contains', 'world'))).toBe(true);
    expect(applyMetadataFilters({}, f('missing', 'eq', 'x'))).toBe(false);
  });
});
