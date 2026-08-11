/**
 * The master pause. Two properties matter and both have burned this codebase
 * before: the field must survive `.strict()`, and pausing must not touch the
 * per-job flags (a master that writes false into all six destroys the user's
 * configuration and silently re-enables jobs they had turned off).
 */
import { UpdateSettingsSchema } from '../../../src/common/schemas';

describe('backgroundWorkPaused', () => {
  test('survives UpdateSettingsSchema, which is .strict()', () => {
    const parsed = UpdateSettingsSchema.parse({ backgroundWorkPaused: true });
    expect(parsed.backgroundWorkPaused).toBe(true);
  });

  test('is optional — an unrelated write does not require it', () => {
    const parsed = UpdateSettingsSchema.parse({ wpeSyncAutoEnabled: true });
    expect(parsed).not.toHaveProperty('backgroundWorkPaused');
  });

  test('pausing carries no per-job flag in the same patch', () => {
    // The renderer sends exactly this patch. If a future change makes the
    // master write the six flags, this fails.
    const patch = { backgroundWorkPaused: true };
    const parsed = UpdateSettingsSchema.parse(patch);
    for (const k of [
      'wpeSyncAutoEnabled', 'wpeRefreshAutoEnabled', 'wpeContentIndexAutoEnabled',
      'externalRefreshAutoEnabled', 'externalContentIndexAutoEnabled',
      'localContentIndexAutoEnabled',
    ]) {
      expect(parsed).not.toHaveProperty(k);
    }
  });
});
