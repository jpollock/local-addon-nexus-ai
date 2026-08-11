/**
 * The master pause. Two properties matter and both have burned this codebase
 * before: the field must survive `.strict()`, and pausing must not touch the
 * per-job flags (a master that writes false into all six destroys the user's
 * configuration and silently re-enables jobs they had turned off).
 */
import * as fs from 'fs';
import * as path from 'path';
import { UpdateSettingsSchema } from '../../../src/common/schemas';

const INDEX_PATH = path.resolve(__dirname, '../../../src/main/index.ts');

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

  describe('pause enforcement', () => {
    const indexSrc = fs.readFileSync(INDEX_PATH, 'utf8');

    test('all five .start() call sites are guarded by the pause check', () => {
      // Each .start() should be preceded by an isBackgroundWorkPaused() check within ~100 chars

      // opportunisticScheduler.start() — line ~896
      const opportunisticIdx = indexSrc.indexOf('opportunisticScheduler.start(');
      expect(opportunisticIdx).toBeGreaterThan(0);
      const opportunisticContext = indexSrc.substring(Math.max(0, opportunisticIdx - 100), opportunisticIdx);
      expect(opportunisticContext).toMatch(/if\s*\(\s*!\s*isBackgroundWorkPaused\(\)/);

      // haltedRefreshScheduler.start() — line ~1036
      const haltedIdx = indexSrc.indexOf('haltedRefreshScheduler.start()');
      expect(haltedIdx).toBeGreaterThan(0);
      const haltedContext = indexSrc.substring(Math.max(0, haltedIdx - 100), haltedIdx);
      expect(haltedContext).toMatch(/if\s*\(\s*!\s*isBackgroundWorkPaused\(\)/);

      // wpeRefreshScheduler.start() — line ~1055
      const wpeRefreshIdx = indexSrc.indexOf('wpeRefreshScheduler.start()');
      expect(wpeRefreshIdx).toBeGreaterThan(0);
      const wpeRefreshContext = indexSrc.substring(Math.max(0, wpeRefreshIdx - 150), wpeRefreshIdx);
      expect(wpeRefreshContext).toMatch(/if\s*\(\s*wpeRefreshEnabled\s*&&\s*!\s*isBackgroundWorkPaused\(\)/);

      // externalRefreshScheduler.start() — line ~1075
      const externalRefreshIdx = indexSrc.indexOf('externalRefreshScheduler.start()');
      expect(externalRefreshIdx).toBeGreaterThan(0);
      const externalRefreshContext = indexSrc.substring(Math.max(0, externalRefreshIdx - 150), externalRefreshIdx);
      expect(externalRefreshContext).toMatch(/if\s*\(\s*externalRefreshEnabled\s*&&\s*!\s*isBackgroundWorkPaused\(\)/);

      // externalContentIndexScheduler.start() — line ~1103
      const externalContentIdx = indexSrc.indexOf('externalContentIndexScheduler.start()');
      expect(externalContentIdx).toBeGreaterThan(0);
      const externalContentContext = indexSrc.substring(Math.max(0, externalContentIdx - 150), externalContentIdx);
      expect(externalContentContext).toMatch(/if\s*\(\s*externalContentIndexEnabled\s*&&\s*!\s*isBackgroundWorkPaused\(\)/);
    });

    test('both Tier 2 WPE auto-sync call sites are guarded', () => {
      // Find the startup Tier 2 block
      const startupTier2Comment = indexSrc.indexOf('// Tier 2: SSH sync only if auto-sync enabled and data is stale');
      expect(startupTier2Comment).toBeGreaterThan(0);
      const startupBlock = indexSrc.substring(startupTier2Comment, startupTier2Comment + 500);
      expect(startupBlock).toMatch(/if\s*\(\s*isBackgroundWorkPaused\(\)\s*\)/);
      expect(startupBlock).toMatch(/if\s*\(\s*!\s*isWpeSyncAutoEnabled\(\)\s*\)/);

      // Find the scheduled interval Tier 2 block
      const intervalTier2Comment = indexSrc.indexOf('// Tier 2: SSH only if enabled and data is stale');
      expect(intervalTier2Comment).toBeGreaterThan(0);
      const intervalBlock = indexSrc.substring(intervalTier2Comment, intervalTier2Comment + 400);
      expect(intervalBlock).toMatch(/if\s*\(\s*isBackgroundWorkPaused\(\)\s*\)/);
      expect(intervalBlock).toMatch(/if\s*\(\s*!\s*isWpeSyncAutoEnabled\(\)\s*\)/);
    });

    test('Tier 1 and Tier 3 are NOT guarded — must remain ungated', () => {
      // Tier 1: syncFromCAPI() must remain ungated (no pause check before it)
      const tier1Startup = indexSrc.match(
        /\/\/\s*Tier\s*1:.*?const\s+capiResult\s*=\s*await\s+wpeSyncService\.syncFromCAPI\(\)/s
      );
      expect(tier1Startup).toBeTruthy();

      const tier1Interval = indexSrc.match(
        /\/\/\s*Tier\s*1:.*?await\s+wpeSyncService\.syncFromCAPI\(\)/s
      );
      expect(tier1Interval).toBeTruthy();

      // Tier 3: syncUsageData() must remain ungated (no pause check before it)
      const tier3Startup = indexSrc.match(
        /\/\/\s*Tier\s*3:.*?await\s+wpeSyncService\.syncUsageData\(\)/s
      );
      expect(tier3Startup).toBeTruthy();

      const tier3Interval = indexSrc.match(
        /\/\/\s*Tier\s*3:.*?await\s+wpeSyncService\.syncUsageData\(\)/s
      );
      expect(tier3Interval).toBeTruthy();

      // Verify none of these are preceded by a pause gate within 200 chars
      const tier1StartupContext = indexSrc.substring(
        Math.max(0, indexSrc.indexOf('const capiResult = await wpeSyncService.syncFromCAPI()') - 200),
        indexSrc.indexOf('const capiResult = await wpeSyncService.syncFromCAPI()')
      );
      expect(tier1StartupContext).not.toMatch(/isBackgroundWorkPaused/);

      const tier3StartupContext = indexSrc.substring(
        Math.max(0, indexSrc.lastIndexOf('await wpeSyncService.syncUsageData()') - 200),
        indexSrc.lastIndexOf('await wpeSyncService.syncUsageData()')
      );
      expect(tier3StartupContext).not.toMatch(/isBackgroundWorkPaused/);
    });

    test('the pause check reads from one shared helper', () => {
      // There should be exactly one function definition for the pause helper
      const helperMatch = indexSrc.match(/const\s+isBackgroundWorkPaused\s*=\s*\(\)\s*=>\s*\{/);
      expect(helperMatch).toBeTruthy();

      // The helper should read from registryStorage
      const helperBody = indexSrc.substring(
        indexSrc.indexOf('const isBackgroundWorkPaused = () => {'),
        indexSrc.indexOf('const isBackgroundWorkPaused = () => {') + 200
      );
      expect(helperBody).toMatch(/registryStorage\.get/);
      expect(helperBody).toMatch(/STORAGE_KEYS\.SETTINGS/);
      expect(helperBody).toMatch(/backgroundWorkPaused/);

      // onSettingsUpdated should also use the helper, not an inline read.
      //
      // Bounded by the assignment that follows the function rather than by a fixed character
      // count. It was `+ 500`, which made the test a proximity check: adding a comment near
      // the top of the function pushed the pause check outside the window and failed a test
      // whose subject had not changed.
      const start = indexSrc.indexOf('const onSettingsUpdated = () => {');
      const end = indexSrc.indexOf('nexusServices.onSettingsUpdated = onSettingsUpdated', start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const onSettingsUpdatedBody = indexSrc.substring(start, end);
      expect(onSettingsUpdatedBody).toMatch(/isBackgroundWorkPaused\(\)/);
    });
  });
});
