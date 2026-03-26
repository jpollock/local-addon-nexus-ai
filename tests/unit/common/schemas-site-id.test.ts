/**
 * Test SiteIdSchema to ensure it accepts both UUID and non-UUID site IDs
 */
import { SiteIdSchema } from '../../../src/common/schemas';

describe('SiteIdSchema', () => {
  it('should accept UUID format site IDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(() => SiteIdSchema.parse(uuid)).not.toThrow();
    expect(SiteIdSchema.parse(uuid)).toBe(uuid);
  });

  it('should accept slug format site IDs', () => {
    const slug = 'my-wordpress-site';
    expect(() => SiteIdSchema.parse(slug)).not.toThrow();
    expect(SiteIdSchema.parse(slug)).toBe(slug);
  });

  it('should accept alphanumeric site IDs', () => {
    const id = 'site123';
    expect(() => SiteIdSchema.parse(id)).not.toThrow();
    expect(SiteIdSchema.parse(id)).toBe(id);
  });

  it('should reject empty string', () => {
    expect(() => SiteIdSchema.parse('')).toThrow('Site ID cannot be empty');
  });

  it('should reject non-string values', () => {
    expect(() => SiteIdSchema.parse(123)).toThrow();
    expect(() => SiteIdSchema.parse(null)).toThrow();
    expect(() => SiteIdSchema.parse(undefined)).toThrow();
  });
});
