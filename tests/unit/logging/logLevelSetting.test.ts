import { resolveLogLevel } from '../../../src/main/logging/resolveLogLevel';
import { UpdateSettingsSchema } from '../../../src/common/schemas';

describe('resolveLogLevel', () => {
  it('defaults to INFO when nothing is set', () => {
    expect(resolveLogLevel(undefined, {})).toBe('INFO');
    expect(resolveLogLevel({}, {})).toBe('INFO');
  });

  it('uses the stored setting', () => {
    expect(resolveLogLevel({ logLevel: 'DEBUG' }, {})).toBe('DEBUG');
  });

  it('lets the environment beat the stored setting', () => {
    // A developer launching from a shell should not have to change a stored preference to get
    // debug output for one session.
    expect(resolveLogLevel({ logLevel: 'ERROR' }, { NEXUS_LOG_LEVEL: 'DEBUG' })).toBe('DEBUG');
  });

  it('ignores a value that is not a level, rather than logging nothing', () => {
    // A typo in an env var must not silently switch the log off. Falling back to the setting —
    // and then to INFO — keeps evidence flowing.
    expect(resolveLogLevel({ logLevel: 'WARN' }, { NEXUS_LOG_LEVEL: 'LOUD' })).toBe('WARN');
    expect(resolveLogLevel({ logLevel: 'nonsense' as any }, {})).toBe('INFO');
  });

  it('accepts a level in any case', () => {
    expect(resolveLogLevel({}, { NEXUS_LOG_LEVEL: 'debug' })).toBe('DEBUG');
  });

  it('env var wins over invalid stored setting', () => {
    expect(resolveLogLevel({ logLevel: 'nonsense' as any }, { NEXUS_LOG_LEVEL: 'ERROR' })).toBe('ERROR');
  });

  it('falls back to INFO when both layers are invalid', () => {
    expect(resolveLogLevel({ logLevel: 'LOUD' as any }, { NEXUS_LOG_LEVEL: 'QUIET' })).toBe('INFO');
  });
});

describe('UpdateSettingsSchema', () => {
  it('persists logLevel through the schema', () => {
    // The schema is .strict(), which silently strips unlisted fields. This test confirms
    // logLevel was added to the schema and is not being stripped.
    const result = UpdateSettingsSchema.parse({ logLevel: 'DEBUG' });
    expect(result.logLevel).toBe('DEBUG');
  });

  it('rejects a value that is not a level', () => {
    // Not decoration: `toBe('DEBUG')` above passes just as happily under
    // `z.string().optional()`, which would let 'LOUD' persist and defeat the asLevel guard.
    // Rejection is the only assertion that distinguishes the enum from a bare string.
    expect(() => UpdateSettingsSchema.parse({ logLevel: 'LOUD' })).toThrow();
  });
});
