/**
 * GitHub release asset downloader
 */

import * as fs from 'fs';
import * as https from 'https';
import { createWriteStream } from 'fs';
import { IncomingMessage } from 'http';

export interface DownloadOptions {
  owner: string;          // 'your-org'
  repo: string;           // 'local-addon-nexus-ai'
  assetName: string;      // 'nexus-ai-darwin-arm64-0.1.0.tgz'
  version?: string;       // 'v0.1.0' (optional, defaults to latest)
  destPath: string;       // '/tmp/nexus-ai-addon.tgz'
  onProgress?: (percent: number, downloaded: number, total: number) => void;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

/**
 * Download addon from GitHub Releases
 */
export async function downloadFromGitHub(options: DownloadOptions): Promise<string> {
  const { owner, repo, assetName, version, destPath, onProgress } = options;

  // Get release (specific version or latest)
  const release = await (version
    ? getRelease(owner, repo, version)
    : getLatestRelease(owner, repo)
  );

  // Find asset by name
  const asset = release.assets.find(a => a.name === assetName);
  if (!asset) {
    throw new Error(
      `Asset not found: ${assetName}\n` +
      `Available assets: ${release.assets.map(a => a.name).join(', ')}`
    );
  }

  // Download asset
  await downloadFile(asset.browser_download_url, destPath, asset.size, onProgress);

  return destPath;
}

/**
 * Get specific release by tag
 */
async function getRelease(owner: string, repo: string, tag: string): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;

  try {
    return await fetchJson(url);
  } catch (error: any) {
    if (error.statusCode === 404) {
      throw new Error(
        `Release not found: ${tag}\n` +
        `Check https://github.com/${owner}/${repo}/releases`
      );
    }
    throw error;
  }
}

/**
 * Get latest release
 */
async function getLatestRelease(owner: string, repo: string): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  try {
    return await fetchJson(url);
  } catch (error: any) {
    if (error.statusCode === 404) {
      throw new Error(
        `No releases found for ${owner}/${repo}\n` +
        `Check https://github.com/${owner}/${repo}/releases`
      );
    }
    throw error;
  }
}

/**
 * Fetch JSON from GitHub API
 */
async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'nexus-ai-cli',
        'Accept': 'application/vnd.github.v3+json'
      }
    }, (res: IncomingMessage) => {
      // Handle rate limiting
      if (res.statusCode === 403) {
        const resetTime = res.headers['x-ratelimit-reset'];
        const resetDate = resetTime ? new Date(parseInt(resetTime as string) * 1000) : null;
        reject(new Error(
          `GitHub API rate limit exceeded\n` +
          (resetDate ? `Resets at: ${resetDate.toLocaleString()}\n` : '') +
          `Try again later or install manually`
        ));
        return;
      }

      // Handle errors
      if (res.statusCode !== 200) {
        const error: any = new Error(`HTTP ${res.statusCode}`);
        error.statusCode = res.statusCode;
        reject(error);
        return;
      }

      // Collect response
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (parseError) {
          reject(new Error(`Failed to parse GitHub API response: ${parseError}`));
        }
      });
    });

    req.on('error', (error: any) => {
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
