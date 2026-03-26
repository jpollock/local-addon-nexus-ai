/**
 * Tarball extraction for addon installation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';

export interface ExtractOptions {
  tarPath: string;       // '/tmp/nexus-ai-addon.tgz'
  destDir: string;       // '~/Library/Application Support/Local/addons/local-addon-nexus-ai'
  stripComponents?: number;  // Default: 1 (removes top-level directory)
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

  // Extract tarball
  try {
    await tar.extract({
      file: tarPath,
      cwd: destDir,
      strip: stripComponents,
      onentry: (entry: tar.ReadEntry) => {
        // Skip .DS_Store and other hidden files
        if (entry.path.includes('.DS_Store') || entry.path.startsWith('._')) {
          entry.ignore = true;
        }
      }
    });
  } catch (error: any) {
    throw new Error(
      `Failed to extract tarball: ${error.message}\n` +
      `The download may be corrupted. Please try again.`
    );
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
    return pkg.name === 'local-addon-nexus-ai';
  } catch {
    return false;
  }
}
