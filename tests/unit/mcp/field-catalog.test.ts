import { buildFieldCatalog, formatFieldCatalog } from '../../../src/main/mcp/modules/content/field-catalog';

describe('buildFieldCatalog (domain-agnostic field inference)', () => {
  const posts = [
    { postType: 'destination', customFields: { difficulty: '1', distance: '3.1', region: 'Pacific Northwest', permits_required: '0', best_seasons: 'a:2:{i:0;s:6:"Summer";i:1;s:4:"Fall";}', trailhead_gps: '47.1, -121.7' } },
    { postType: 'destination', customFields: { difficulty: '4', distance: '10.4', region: 'Rocky Mountains', permits_required: '1', best_seasons: 'a:1:{i:0;s:6:"Summer";}', trailhead_gps: '41.4, -110.8' } },
    { postType: 'destination', customFields: { difficulty: '2', distance: '8', region: 'Rocky Mountains', permits_required: '0', best_seasons: 'a:3:{i:0;s:6:"Spring";}', trailhead_gps: '39.2, -118.8' } },
    { postType: 'post', customFields: {} },
  ];

  it('infers number fields with min/max', () => {
    const cat = buildFieldCatalog(posts);
    const dest = cat.find((c) => c.postType === 'destination')!;
    const difficulty = dest.fields.find((f) => f.field === 'difficulty')!;
    expect(difficulty.type).toBe('number');
    expect(difficulty.min).toBe(1);
    expect(difficulty.max).toBe(4);
    const distance = dest.fields.find((f) => f.field === 'distance')!;
    expect(distance.type).toBe('number');
    expect(distance.min).toBe(3.1);
    expect(distance.max).toBe(10.4);
  });

  it('infers enum fields with distinct sorted values', () => {
    const dest = buildFieldCatalog(posts).find((c) => c.postType === 'destination')!;
    const region = dest.fields.find((f) => f.field === 'region')!;
    expect(region.type).toBe('enum');
    expect(region.values).toEqual(['Pacific Northwest', 'Rocky Mountains']);
  });

  it('infers boolean (0/1) and array (php-serialized) fields', () => {
    const dest = buildFieldCatalog(posts).find((c) => c.postType === 'destination')!;
    expect(dest.fields.find((f) => f.field === 'permits_required')!.type).toBe('boolean');
    expect(dest.fields.find((f) => f.field === 'best_seasons')!.type).toBe('array');
  });

  it('treats high-cardinality strings as text with a sample', () => {
    // 13 distinct values (> ENUM_MAX of 12) → text, not enum
    const many = Array.from({ length: 13 }, (_, i) => ({
      postType: 'product',
      customFields: { sku: `SKU-${i}` },
    }));
    const product = buildFieldCatalog(many).find((c) => c.postType === 'product')!;
    const sku = product.fields.find((f) => f.field === 'sku')!;
    expect(sku.type).toBe('text');
    expect(sku.sample).toBe('SKU-0');
  });

  it('treats a low-cardinality string field as enum', () => {
    const dest = buildFieldCatalog(posts).find((c) => c.postType === 'destination')!;
    // only 3 distinct GPS values here → enum (≤ ENUM_MAX)
    expect(dest.fields.find((f) => f.field === 'trailhead_gps')!.type).toBe('enum');
  });

  it('reports coverage/total and post counts', () => {
    const dest = buildFieldCatalog(posts).find((c) => c.postType === 'destination')!;
    expect(dest.postCount).toBe(3);
    expect(dest.fields.find((f) => f.field === 'difficulty')!.coverage).toBe(3);
    expect(dest.fields.find((f) => f.field === 'difficulty')!.total).toBe(3);
  });

  it('lists post types with no custom fields as empty (no fields)', () => {
    const post = buildFieldCatalog(posts).find((c) => c.postType === 'post')!;
    expect(post.fields).toEqual([]);
  });

  it('excludes ACF repeater sub-row keys but keeps the parent field', () => {
    const p = [
      { postType: 'trip', customFields: {
        itinerary: '3',
        itinerary_0_day: '1',
        itinerary_0_activities: 'Arrive and gear check for the long trek ahead.',
        itinerary_1_day: '2',
        itinerary_1_activities: 'Ascend to base camp.',
      } },
    ];
    const trip = buildFieldCatalog(p).find((c) => c.postType === 'trip')!;
    const names = trip.fields.map((f) => f.field);
    expect(names).toContain('itinerary');            // parent kept
    expect(names).not.toContain('itinerary_0_day');  // sub-rows excluded
    expect(names).not.toContain('itinerary_0_activities');
    expect(names).not.toContain('itinerary_1_activities');
  });

  it('counts coverage from posts, not chunks (caller dedups by post)', () => {
    // partial coverage: one post missing the field
    const p = [
      { postType: 'trip', customFields: { price: '400' } },
      { postType: 'trip', customFields: { price: '' } },
      { postType: 'trip', customFields: {} },
    ];
    const trip = buildFieldCatalog(p).find((c) => c.postType === 'trip')!;
    const price = trip.fields.find((f) => f.field === 'price')!;
    expect(price.coverage).toBe(1);
    expect(price.total).toBe(3);
  });

  it('formats a readable catalog', () => {
    const out = formatFieldCatalog('Test Site', buildFieldCatalog(posts));
    expect(out).toContain('destination (3 posts)');
    expect(out).toContain('difficulty: number 1–4');
    expect(out).toContain('region: enum [Pacific Northwest, Rocky Mountains]');
    expect(out).toContain('searchMode:"hybrid"');
  });
});
