/**
 * Downloader tests with mocked Cloudflare R2 download
 */

import { EventEmitter } from 'events';

// Mock https before importing the module
const mockHttpsGet = jest.fn();
jest.mock('https', () => ({
  get: mockHttpsGet,
}));

// Mock fs.createWriteStream
const mockWriteStream = Object.assign(new EventEmitter(), { close: jest.fn() }) as any;
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createWriteStream: jest.fn(() => mockWriteStream),
}));

import { downloadAddon, formatBytes } from '../../../src/cli/bootstrap/downloader';

describe('R2 Downloader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteStream.removeAllListeners();
  });

  it('downloads addon from R2 and returns destPath', async () => {
    mockHttpsGet.mockImplementation((url: string, options: any, callback: any) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      res.headers = { 'content-length': '1024' };
      res.pipe = jest.fn(() => {
        setTimeout(() => mockWriteStream.emit('finish'), 10);
        return mockWriteStream;
      });
      callback(res);
      return new EventEmitter();
    });

    const destPath = '/tmp/test-addon.tgz';
    const result = await downloadAddon({
      assetName: 'nexus-ai-darwin-arm64-0.2.0.tgz',
      version: '0.2.0',
      destPath,
    });

    expect(result).toBe(destPath);

    const calledUrl = mockHttpsGet.mock.calls[0][0] as string;
    expect(calledUrl).toContain('releases.elasticapi.io/nexus-ai/v0.2.0/nexus-ai-darwin-arm64-0.2.0.tgz');
  });

  it('handles network error', async () => {
    mockHttpsGet.mockImplementation(() => {
      const req = new EventEmitter() as any;
      setTimeout(() => {
        const err: any = new Error('ENOTFOUND');
        err.code = 'ENOTFOUND';
        req.emit('error', err);
      }, 10);
      return req;
    });

    await expect(
      downloadAddon({
        assetName: 'nexus-ai-darwin-arm64-0.2.0.tgz',
        version: '0.2.0',
        destPath: '/tmp/test.tgz',
      })
    ).rejects.toThrow();
  });

  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(1073741824)).toBe('1 GB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});
