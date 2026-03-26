/**
 * Platform detection tests
 */

import { detectPlatform, getPlatformDisplayName } from '../../../src/cli/bootstrap/platform';

describe('Platform Detection', () => {
  it('detects current platform', () => {
    const platform = detectPlatform();

    expect(platform.platform).toBe(process.platform);
    expect(platform.arch).toBe(process.arch);
    expect(platform.platformArch).toBe(`${process.platform}-${process.arch}`);
    expect(platform.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('constructs correct asset name', () => {
    const platform = detectPlatform();

    expect(platform.assetName).toMatch(/^nexus-ai-/);
    expect(platform.assetName).toContain(platform.platformArch);
    expect(platform.assetName).toContain(platform.version);
    expect(platform.assetName).toMatch(/\.tgz$/);
  });

  it('throws on unsupported platform', () => {
    // Mock unsupported platform
    const originalPlatform = process.platform;
    const originalArch = process.arch;

    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    Object.defineProperty(process, 'arch', { value: 'arm' });

    expect(() => detectPlatform()).toThrow('Unsupported platform: freebsd-arm');

    // Restore
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'arch', { value: originalArch });
  });

  it('returns correct display names', () => {
    const testCases = [
      { platformArch: 'darwin-arm64', expected: 'macOS (Apple Silicon)' },
      { platformArch: 'darwin-x64', expected: 'macOS (Intel)' },
      { platformArch: 'win32-x64', expected: 'Windows (64-bit)' },
      { platformArch: 'linux-x64', expected: 'Linux (64-bit)' }
    ];

    testCases.forEach(({ platformArch, expected }) => {
      const info = {
        platform: platformArch.split('-')[0],
        arch: platformArch.split('-')[1],
        platformArch,
        assetName: `nexus-ai-${platformArch}-0.1.0.tgz`,
        version: '0.1.0'
      };

      expect(getPlatformDisplayName(info)).toBe(expected);
    });
  });
});
