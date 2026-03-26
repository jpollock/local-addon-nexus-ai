/**
 * Platform detection for auto-install
 */

import * as path from 'path';
import { readFileSync } from 'fs';

export interface PlatformInfo {
  platform: string;      // 'darwin', 'win32', 'linux'
  arch: string;          // 'arm64', 'x64'
  platformArch: string;  // 'darwin-arm64'
  assetName: string;     // 'nexus-ai-darwin-arm64-0.1.0.tgz'
  version: string;       // '0.1.0'
}

/**
 * Detect current platform and construct asset name for GitHub release
 */
export function detectPlatform(): PlatformInfo {
  const platform = process.platform;
  const arch = process.arch;

  // Validate supported platform
  const supported = [
    'darwin-arm64',
    'darwin-x64',
    'win32-x64',
    'linux-x64'
  ];

  const platformArch = `${platform}-${arch}`;
  if (!supported.includes(platformArch)) {
    throw new Error(
      `Unsupported platform: ${platformArch}\n` +
      `Supported platforms: ${supported.join(', ')}`
    );
  }

  // Get CLI version from package.json
  const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const version = pkg.version;

  return {
    platform,
    arch,
    platformArch,
    assetName: `nexus-ai-${platformArch}-${version}.tgz`,
    version
  };
}

/**
 * Get human-readable platform name for display
 */
export function getPlatformDisplayName(info: PlatformInfo): string {
  const names: Record<string, string> = {
    'darwin-arm64': 'macOS (Apple Silicon)',
    'darwin-x64': 'macOS (Intel)',
    'win32-x64': 'Windows (64-bit)',
    'linux-x64': 'Linux (64-bit)'
  };

  return names[info.platformArch] || info.platformArch;
}
