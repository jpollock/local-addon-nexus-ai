import { UpdateSettingsSchema } from '../../../src/common/schemas';

describe('external refresh settings survive the strict schema', () => {
  it('accepts both keys', () => {
    const parsed = UpdateSettingsSchema.parse({
      externalRefreshAutoEnabled: true,
      externalRefreshIntervalHours: 12,
    });
    expect(parsed.externalRefreshAutoEnabled).toBe(true);
    expect(parsed.externalRefreshIntervalHours).toBe(12);
  });

  it('rejects an out-of-range interval', () => {
    expect(() => UpdateSettingsSchema.parse({ externalRefreshIntervalHours: 0 })).toThrow();
    expect(() => UpdateSettingsSchema.parse({ externalRefreshIntervalHours: 999 })).toThrow();
  });
});
