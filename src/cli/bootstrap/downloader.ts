/**
 * Release asset downloader — Cloudflare R2
 *
 * Tarballs are hosted at releases.elasticapi.io/nexus-ai/v{version}/{assetName}
 * No authentication required — public bucket with custom domain.
 * URL is constructed directly from CLI version + platform, no API call needed.
 */

import * as fs from 'fs';
import * as https from 'https';
import { createWriteStream } from 'fs';
import { IncomingMessage } from 'http';

const RELEASES_BASE_URL = 'https://releases.elasticapi.io/nexus-ai';

export interface DownloadOptions {
  assetName: string;      // 'nexus-ai-darwin-arm64-0.1.5.tgz'
  version: string;        // '0.1.5' (without 'v' prefix)
  destPath: string;       // '/tmp/nexus-ai-addon.tgz'
  onProgress?: (percent: number, downloaded: number, total: number) => void;
}

/**
 * Download addon tarball from Cloudflare R2
 */
export async function downloadAddon(options: DownloadOptions): Promise<string> {
  const { assetName, version, destPath, onProgress } = options;

  const url = `${RELEASES_BASE_URL}/v${version}/${assetName}`;

  await downloadFile(url, destPath, 0, onProgress);

  return destPath;
}

/**
 * Download file from URL with progress tracking
 */
async function downloadFile(
  url: string,
  destPath: string,
  totalSize: number,
  onProgress?: (percent: number, downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'nexus-ai-cli' }
    }, (res: IncomingMessage) => {
      // Handle redirects
      if (res.statusCode === 302 || res.statusCode === 301) {
        const location = res.headers.location;
        if (!location) {
          reject(new Error('Redirect without location header'));
          return;
        }
        return downloadFile(location, destPath, totalSize, onProgress)
          .then(resolve)
          .catch(reject);
      }

      // Handle errors
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      // Track progress
      let downloaded = 0;
      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (onProgress) {
          const percent = Math.round((downloaded / totalSize) * 100);
          onProgress(percent, downloaded, totalSize);
        }
      });

      // Write to file
      const fileStream = createWriteStream(destPath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (error) => {
        fs.unlink(destPath, () => {}); // Clean up partial download
        reject(error);
      });
    });

    req.on('error', (error: any) => {
      fs.unlink(destPath, () => {}); // Clean up partial download

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        reject(new Error(
          `No internet connection\n` +
          `Please check your network and try again`
        ));
      } else {
        reject(error);
      }
    });
  });
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
