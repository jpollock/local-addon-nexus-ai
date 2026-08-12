/**
 * Tarball extraction for addon installation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import { ADDON_PACKAGE_NAME } from './paths';

export interface ExtractOptions {
  tarPath: string;       // '/tmp/nexus-ai-addon.tgz'
  destDir: string;       // '~/Library/Application Support/Local/addons/local-addon-nexus-ai'
  stripComponents?: number;  // Default: 1 (removes top-level directory)
}

/**
 * Refuse tar entries that enable the link-poisoning / path-escape attacks covered by node-tar's
 * advisories. The addon tarball is files and directories only — a symlink or hardlink entry, or
 * a path that escapes the destination, has no legitimate reason to be there and is the shape of
 * an attack. Thrown from the extraction onentry so a malicious archive aborts before the unsafe
 * entry is materialized. (This defends even on the currently-pinned tar 6.2.x; a tar>=7.5.22
 * upgrade is still recommended as defense in depth, but requires an install/build cycle.)
 */
export function assertSafeTarEntry(entry: { path: string; type?: string }): void {
  const type = entry.type ?? '';
  if (type === 'SymbolicLink' || type === 'Link') {
    const err: any = new Error(`Refusing tarball with a ${type} entry ("${entry.path}") — possible link-poisoning attack.`);
    err.__unsafeTarEntry = true;
    throw err;
  }
  const p = entry.path.replace(/\\/g, '/');
  if (p.startsWith('/') || p.split('/').includes('..')) {
    const err: any = new Error(`Refusing tarball entry with an unsafe path ("${entry.path}").`);
    err.__unsafeTarEntry = true;
    throw err;
  }
}

/**
 * Extract tarball to destination directory
 */
export async function extractTarball(options: ExtractOptions): Promise<void> {
  const { tarPath, destDir, stripComponents = 1 } = options;

  // Verify tarball exists
  if (!fs.existsSync(tarPath)) {
    throw new Error(`Tarball not found: ${tarPath}`);
  }

  // Ensure destination directory exists
  if (!fs.existsSync(destDir)) {
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(
          `Permission denied: Cannot create directory ${destDir}\n` +
          `Try running with elevated permissions:\n` +
          `sudo npm install -g @local-labs-jpollock/local-addon-nexus-ai`
        );
      }
      throw error;
    }
  }

  // Extract tarball. An unsafe entry is skipped (entry.ignore) so it is never materialized on
  // disk, and the reason is recorded so the whole extraction is rejected afterward — throwing
  // inside node-tar's onentry does not abort a file extraction (it hangs), so we skip-then-throw.
  let unsafeEntry: Error | null = null;
  try {
    await tar.extract({
      file: tarPath,
      cwd: destDir,
      strip: stripComponents,
      // Never restore absolute or `..` paths (node-tar's default, made explicit).
      preservePaths: false,
      // `filter` is evaluated BEFORE an entry is written, so returning false definitively
      // prevents a symlink/hardlink/escape entry from ever touching the filesystem — unlike
      // onentry's entry.ignore, which fires too late for link entries.
      filter: (p: string, stat: tar.FileStat) => {
        // node-tar types the second arg as FileStat, but at runtime it is the ReadEntry, which
        // carries the entry `type` (File / Directory / SymbolicLink / Link) we need.
        const entryPath = (stat as any)?.path ?? p;
        const entryType = (stat as any)?.type as string | undefined;
        if (entryPath.includes('.DS_Store') || entryPath.startsWith('._')) return false;
        try {
          assertSafeTarEntry({ path: entryPath, type: entryType });
          return true;
        } catch (e) {
          unsafeEntry = unsafeEntry ?? (e as Error);
          return false;
        }
      },
    });
  } catch (error: any) {
    throw new Error(
      `Failed to extract tarball: ${error.message}\n` +
      `The download may be corrupted. Please try again.`
    );
  }

  // A security refusal surfaces as-is (not masked as a corrupt download).
  if (unsafeEntry) {
    throw unsafeEntry;
  }

  // Set permissions (Unix only)
  if (process.platform !== 'win32') {
    try {
      chmodRecursive(destDir, 0o755);
    } catch (error: any) {
      // Non-fatal: permissions might already be correct
      console.warn(`Warning: Could not set permissions: ${error.message}`);
    }
  }
}

/**
 * Recursively set permissions on directory
 */
function chmodRecursive(dir: string, mode: number): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);

    try {
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        fs.chmodSync(filePath, mode);
        chmodRecursive(filePath, mode);
      } else {
        // Files get read/write for owner, read for others
        fs.chmodSync(filePath, 0o644);
      }
    } catch (error: any) {
      // Skip files we can't access
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
        throw error;
      }
    }
  });
}

/**
 * Verify extracted addon is valid
 */
export function verifyExtractedAddon(destDir: string): boolean {
  // Check for package.json
  const pkgPath = path.join(destDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return false;
  }

  // Verify it's the nexus-ai addon
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.name === ADDON_PACKAGE_NAME;
  } catch {
    return false;
  }
}
