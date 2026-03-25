/**
 * Tests for auto-generate AI context file
 */

import { autoGenerateContextFile } from '../../../src/main/ai-context/auto-generate';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('autoGenerateContextFile', () => {
  let tempDir: string;
  let logger: any;
  let localServices: any;
  let metadataCache: any;
  let registryStorage: any;

  beforeEach(async () => {
    // Create temporary directory for test sites
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-ai-test-'));

    // Mock logger
    logger = {
      info: jest.fn(),
      error: jest.fn(),
    };

    // Mock local services (not needed for this test)
    localServices = {};

    // Mock metadata cache
    metadataCache = {
      getWithAge: jest.fn().mockReturnValue({
        wpVersion: '7.0.0',
        plugins: [
          { name: 'ai', title: 'AI', version: '0.6.0', status: 'active' },
        ],
        themes: [
          { name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' },
        ],
        activeTheme: 'twentytwentyfour',
      }),
    };

    // Mock registry storage
    registryStorage = {
      get: jest.fn().mockReturnValue({
        url: 'http://127.0.0.1:13000/ai-gateway/v1',
        authToken: 'test-token-12345',
        models: ['Claude Haiku 4.5'],
      }),
    };
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should generate AI context file when missing', async () => {
    const sitePath = path.join(tempDir, 'test-site');
    await fs.mkdir(path.join(sitePath, 'app', 'public'), { recursive: true });

    const site = {
      id: 'test-site-id',
      name: 'test-site',
      path: sitePath,
      url: 'http://test-site.local',
      domain: 'test-site.local',
      phpVersion: '8.3.13',
      mysqlPort: 10003,
    };

    await autoGenerateContextFile(site, localServices, metadataCache, registryStorage, logger);

    // Check that file was created
    const filePath = path.join(sitePath, 'app', 'public', 'AI-CONTEXT.md');
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // Check file contents
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('# AI Development Context - test-site');
    expect(content).toContain('WordPress Version:** 7.0.0');
    expect(content).toContain('PHP Version:** 8.3.13');
    expect(content).toContain('MySQL:** localhost:10003');
    expect(content).toContain('**AI** (v0.6.0)');
    expect(content).toContain('**Twenty Twenty-Four** (v1.0)');
    expect(content).toContain('http://127.0.0.1:13000/ai-gateway/v1');

    // Check that info was logged
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Auto-generated AI context file for test-site'),
    );
  });

  it('should skip generation if file already exists', async () => {
    const sitePath = path.join(tempDir, 'test-site-2');
    await fs.mkdir(path.join(sitePath, 'app', 'public'), { recursive: true });

    const filePath = path.join(sitePath, 'app', 'public', 'AI-CONTEXT.md');
    await fs.writeFile(filePath, '# Existing file', 'utf-8');

    const site = {
      id: 'test-site-2-id',
      name: 'test-site-2',
      path: sitePath,
      url: 'http://test-site-2.local',
    };

    await autoGenerateContextFile(site, localServices, metadataCache, registryStorage, logger);

    // Check that file was not modified
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('# Existing file');

    // Check that skip was logged
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('AI context file already exists for test-site-2, skipping auto-generation'),
    );
  });

  it('should handle missing metadata gracefully', async () => {
    const sitePath = path.join(tempDir, 'test-site-3');
    await fs.mkdir(path.join(sitePath, 'app', 'public'), { recursive: true });

    const site = {
      id: 'test-site-3-id',
      name: 'test-site-3',
      path: sitePath,
      url: 'http://test-site-3.local',
    };

    // Mock empty metadata
    metadataCache.getWithAge.mockReturnValue(undefined);
    registryStorage.get.mockReturnValue(null);

    await autoGenerateContextFile(site, localServices, metadataCache, registryStorage, logger);

    // Check that file was created with minimal data
    const filePath = path.join(sitePath, 'app', 'public', 'AI-CONTEXT.md');
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('# AI Development Context - test-site-3');
    expect(content).toContain('http://test-site-3.local');
  });

  it('should handle errors gracefully without throwing', async () => {
    const sitePath = '/nonexistent/path/that/does/not/exist';

    const site = {
      id: 'bad-site-id',
      name: 'bad-site',
      path: sitePath,
      url: 'http://bad-site.local',
    };

    // Should not throw
    await expect(
      autoGenerateContextFile(site, localServices, metadataCache, registryStorage, logger),
    ).resolves.toBeUndefined();

    // Should log error
    expect(logger.error).toHaveBeenCalled();
    const errorCall = logger.error.mock.calls[0];
    expect(errorCall[0]).toBe('[NexusAI] Auto-generate context file failed for bad-site:');
    expect(errorCall[1]).toBeTruthy();
    expect(errorCall[1].message).toContain('ENOENT');
  });
});
