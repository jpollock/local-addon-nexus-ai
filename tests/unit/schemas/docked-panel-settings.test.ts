import { UpdateSettingsSchema } from '../../../src/common/schemas';

describe('UpdateSettingsSchema — chatRetentionDays', () => {
  it('accepts valid retention values', () => {
    for (const v of [7, 30, 90, null]) {
      const result = UpdateSettingsSchema.safeParse({ chatRetentionDays: v });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid values', () => {
    const result = UpdateSettingsSchema.safeParse({ chatRetentionDays: 14 });
    expect(result.success).toBe(false);
  });

  it('does not strip chatRetentionDays from a full settings object', () => {
    const input = { aiProvider: 'anthropic', chatRetentionDays: 30 };
    const result = UpdateSettingsSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect((result as any).data.chatRetentionDays).toBe(30);
  });
});
