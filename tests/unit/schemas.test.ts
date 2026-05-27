import { UpdateSettingsSchema } from '../../src/common/schemas';

describe('UpdateSettingsSchema', () => {
  test('accepts localContentIndexIntervalHours', () => {
    const result = UpdateSettingsSchema.safeParse({
      autoIndex: true,
      excludedSiteIds: [],
      localContentIndexIntervalHours: 8,
      localContentIndexAutoEnabled: true,
    });
    expect(result.success).toBe(true);
  });

  test('rejects unknown fields due to strict mode', () => {
    const result = UpdateSettingsSchema.safeParse({
      autoIndex: true,
      excludedSiteIds: [],
      unknownField: 'oops',
    });
    // strict() mode causes unknown fields to trigger validation failure
    expect(result.success).toBe(false);
  });

  test('validates localContentIndexIntervalHours as 0-168', () => {
    // Valid: 0 (manual only)
    const result1 = UpdateSettingsSchema.safeParse({
      localContentIndexIntervalHours: 0,
    });
    expect(result1.success).toBe(true);

    // Valid: 8
    const result2 = UpdateSettingsSchema.safeParse({
      localContentIndexIntervalHours: 8,
    });
    expect(result2.success).toBe(true);

    // Valid: 168 (one week)
    const result3 = UpdateSettingsSchema.safeParse({
      localContentIndexIntervalHours: 168,
    });
    expect(result3.success).toBe(true);

    // Invalid: negative
    const result4 = UpdateSettingsSchema.safeParse({
      localContentIndexIntervalHours: -1,
    });
    expect(result4.success).toBe(false);

    // Invalid: exceeds max
    const result5 = UpdateSettingsSchema.safeParse({
      localContentIndexIntervalHours: 169,
    });
    expect(result5.success).toBe(false);
  });

  test('allows optional localContentIndexAutoEnabled', () => {
    const result1 = UpdateSettingsSchema.safeParse({
      localContentIndexAutoEnabled: true,
    });
    expect(result1.success).toBe(true);

    const result2 = UpdateSettingsSchema.safeParse({
      localContentIndexAutoEnabled: false,
    });
    expect(result2.success).toBe(true);
  });
});
