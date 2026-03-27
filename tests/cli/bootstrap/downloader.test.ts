/**
 * Downloader tests with mocked GitHub API
 */

import * as https from 'https';
import * as fs from 'fs';
import { downloadFromGitHub, formatBytes } from '../../../src/cli/bootstrap/downloader';
import { EventEmitter } from 'events';

describe('GitHub Downloader', () => {
  let httpsGetSpy: jest.SpyInstance;

  beforeEach(() => {
    httpsGetSpy = jest.spyOn(https, 'get');
  });

  afterEach(() => {
    httpsGetSpy.mockRestore();
  });

  it('downloads asset from latest release', async () => {
    const mockRelease = {
      tag_name: 'v0.1.0',
      name: 'Release 0.1.0',
      assets: [
        {
          name: 'nexus-ai-darwin-arm64-0.1.0.tgz',
          browser_download_url: 'https://github.com/test/repo/releases/download/v0.1.0/nexus-ai-darwin-arm64-0.1.0.tgz',
          size: 1024
        }
      ]
    };

    // Mock API request
    httpsGetSpy.mockImplementation((url: any, options: any, callback: any) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;

      if (typeof url === 'string' && url.includes('/releases/latest')) {
        // Return release JSON
        setTimeout(() => {
          res.emit('data', JSON.stringify(mockRelease));
          res.emit('end');
        }, 10);
      } else if (typeof url === 'string' && url.includes('/releases/download/')) {
        // Return file content
        res.pipe = jest.fn((stream: any) => {
          stream.emit('finish');
          return stream;
        });
        setTimeout(() => {
          res.emit('data', Buffer.from('test tarball content'));
          res.emit('end');
        }, 10);
      }

      callback(res);
      return new EventEmitter() as any; // Return request object
    });

    // Mock file operations
    const writeStreamMock = new EventEmitter() as any;
    writeStreamMock.close = jest.fn();
    jest.spyOn(fs, 'createWriteStream').mockReturnValue(writeStreamMock);

    const destPath = '/tmp/test.tgz';

    // Trigger download
    const promise = downloadFromGitHub({
      owner: 'test',
      repo: 'repo',
      assetName: 'nexus-ai-darwin-arm64-0.1.0.tgz',
      destPath
    });

    // Simulate write stream finish
    setTimeout(() => writeStreamMock.emit('finish'), 50);

    await expect(promise).resolves.toBe(destPath);

    (fs.createWriteStream as jest.Mock).mockRestore();
  });

  it('handles asset not found', async () => {
    const mockRelease = {
      tag_name: 'v0.1.0',
      name: 'Release 0.1.0',
      assets: [
        {
          name: 'other-asset.tgz',
          browser_download_url: 'https://example.com/other-asset.tgz',
          size: 1024
        }
      ]
    };

    httpsGetSpy.mockImplementation((url: any, options: any, callback: any) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;

      setTimeout(() => {
        res.emit('data', JSON.stringify(mockRelease));
        res.emit('end');
      }, 10);

      callback(res);
      return new EventEmitter() as any;
    });

    await expect(
      downloadFromGitHub({
        owner: 'test',
        repo: 'repo',
        assetName: 'missing-asset.tgz',
        destPath: '/tmp/test.tgz'
      })
    ).rejects.toThrow('Asset not found: missing-asset.tgz');
  });

  it('handles rate limit', async () => {
    httpsGetSpy.mockImplementation((url: any, options: any, callback: any) => {
      const res = new EventEmitter() as any;
      res.statusCode = 403;
      res.headers = {
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
      };

      setTimeout(() => {
        res.emit('end');
      }, 10);

      callback(res);
      return new EventEmitter() as any;
    });

    await expect(
      downloadFromGitHub({
        owner: 'test',
        repo: 'repo',
        assetName: 'test.tgz',
        destPath: '/tmp/test.tgz'
      })
    ).rejects.toThrow('GitHub API rate limit exceeded');
  });

  it('handles network error', async () => {
    httpsGetSpy.mockImplementation(() => {
      const req = new EventEmitter() as any;
      setTimeout(() => {
        const error: any = new Error('Network error');
        error.code = 'ENOTFOUND';
        req.emit('error', error);
      }, 10);
      return req;
    });

    await expect(
      downloadFromGitHub({
        owner: 'test',
        repo: 'repo',
        assetName: 'test.tgz',
        destPath: '/tmp/test.tgz'
      })
    ).rejects.toThrow('No internet connection');
  });

  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(1073741824)).toBe('1 GB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});
