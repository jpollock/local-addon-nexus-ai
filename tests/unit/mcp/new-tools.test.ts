/**
 * Unit Tests for New MCP Tools
 * Tests the 9 new tools added for feature parity
 */

import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { NexusServices, SiteDataAccessor, LocalSiteInfo } from '../../../src/main/mcp/types';
import { toggleXdebugHandler } from '../../../src/main/mcp/modules/site-management/toggle-xdebug';
import { renameSiteHandler } from '../../../src/main/mcp/modules/site-management/rename-site';
import { importSiteHandler } from '../../../src/main/mcp/modules/site-management/import-site';
import { listBlueprintsHandler } from '../../../src/main/mcp/modules/site-management/list-blueprints';
import { saveBlueprintHandler } from '../../../src/main/mcp/modules/site-management/save-blueprint';
import { getSiteLogsHandler } from '../../../src/main/mcp/modules/site-management/get-site-logs';
import { importDatabaseHandler } from '../../../src/main/mcp/modules/wp-cli/import-database';
import { getSiteChangesHandler } from '../../../src/main/mcp/modules/wpe/get-site-changes';
import { getSyncHistoryHandler } from '../../../src/main/mcp/modules/wpe/get-sync-history';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const createMockSite = (overrides?: Partial<LocalSiteInfo>): LocalSiteInfo => ({
  id: 'test-site-1',
  name: 'test-site',
  domain: 'test-site.local',
  path: '/Users/test/Local Sites/test-site',
  ...overrides,
});

const createMockSiteData = (sites: LocalSiteInfo[]): SiteDataAccessor => {
  const siteMap: Record<string, LocalSiteInfo> = {};
  sites.forEach(s => { siteMap[s.id] = s; siteMap[s.name] = s; });

  return {
    getSite: (id: string) => siteMap[id] ?? null,
    getSites: () => siteMap,
  };
};

const createMockLocalServices = () => ({
  updateSite: jest.fn(),
  importSite: jest.fn().mockResolvedValue({ id: 'imported-1', name: 'imported-site' }),
  getBlueprints: jest.fn().mockResolvedValue([
    { id: 'bp-1', name: 'Blueprint 1', description: 'Test blueprint', createdAt: '2025-01-01' }
  ]),
  saveBlueprint: jest.fn().mockResolvedValue({ id: 'bp-2' }),
  wpCliRun: jest.fn().mockResolvedValue({ stdout: 'Success', stderr: '', exitCode: 0 }),
  resolveWpeInstall: jest.fn().mockResolvedValue({
    installName: 'testinstall',
    installId: 'install-123',
    remoteSiteId: 'site-456',
    primaryDomain: 'testinstall.wpengine.com',
  }),
  getSiteStatus: jest.fn().mockReturnValue('running'),
  startSite: jest.fn().mockResolvedValue(undefined),
  listModifications: jest.fn().mockResolvedValue([
    { path: 'wp-content/themes/custom/style.css', instruction: 'update' },
    { path: 'wp-content/plugins/custom/plugin.php', instruction: 'create' },
  ]),
  getSyncHistory: jest.fn().mockResolvedValue([
    {
      direction: 'push',
      remoteInstallName: 'testinstall',
      environment: 'production',
      status: 'success',
      timestamp: Date.now() - 3600000,
    },
  ]),
});

const createMockServices = (sites: LocalSiteInfo[]): NexusServices => ({
  vectorStore: {} as any,
  embeddingService: {} as any,
  contentPipeline: {} as any,
  indexRegistry: {} as any,
  fileScanner: {} as any,
  siteData: createMockSiteData(sites),
  graphService: {} as any,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as any,
  auditLogger: {} as any,
  localServices: createMockLocalServices() as any,
});

// ---------------------------------------------------------------------------
// Tests: toggle_xdebug
// ---------------------------------------------------------------------------

describe('local_toggle_xdebug', () => {
  it('should enable Xdebug for a site', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await toggleXdebugHandler.execute(
      { site: 'mysite', enabled: true },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Xdebug enabled');
    expect(services.localServices!.updateSite).toHaveBeenCalledWith('site-1', { xdebugEnabled: true });
  });

  it('should disable Xdebug for a site', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await toggleXdebugHandler.execute(
      { site: 'mysite', enabled: false },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Xdebug disabled');
  });

  it('should return error if site not found', async () => {
    const services = createMockServices([]);

    const result = await toggleXdebugHandler.execute(
      { site: 'nonexistent', enabled: true },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should return error if enabled is not boolean', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await toggleXdebugHandler.execute(
      { site: 'mysite', enabled: 'yes' },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('must be true or false');
  });
});

// ---------------------------------------------------------------------------
// Tests: rename_site
// ---------------------------------------------------------------------------

describe('local_rename_site', () => {
  it('should rename a site successfully', async () => {
    const site = createMockSite({ id: 'site-1', name: 'oldname' });
    const services = createMockServices([site]);

    const result = await renameSiteHandler.execute(
      { site: 'oldname', newName: 'newname' },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('renamed site from "oldname" to "newname"');
    expect(services.localServices!.updateSite).toHaveBeenCalledWith('site-1', { name: 'newname' });
  });

  it('should trim whitespace from new name', async () => {
    const site = createMockSite({ id: 'site-1', name: 'oldname' });
    const services = createMockServices([site]);

    const result = await renameSiteHandler.execute(
      { site: 'oldname', newName: '  newname  ' },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(services.localServices!.updateSite).toHaveBeenCalledWith('site-1', { name: 'newname' });
  });

  it('should return error if newName is empty', async () => {
    const site = createMockSite({ id: 'site-1', name: 'oldname' });
    const services = createMockServices([site]);

    const result = await renameSiteHandler.execute(
      { site: 'oldname', newName: '   ' },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cannot be empty');
  });
});

// ---------------------------------------------------------------------------
// Tests: import_site
// ---------------------------------------------------------------------------

describe('local_import_site', () => {
  const testZipPath = path.join(os.tmpdir(), 'test-import.zip');

  beforeEach(() => {
    // Create a dummy zip file for testing
    fs.writeFileSync(testZipPath, 'fake zip content');
  });

  afterEach(() => {
    if (fs.existsSync(testZipPath)) {
      fs.unlinkSync(testZipPath);
    }
  });

  it('should import a site from zip file', async () => {
    const services = createMockServices([]);

    const result = await importSiteHandler.execute(
      { zipPath: testZipPath },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Successfully imported site');
    expect(services.localServices!.importSite).toHaveBeenCalledWith(testZipPath, undefined);
  });

  it('should use provided site name', async () => {
    const services = createMockServices([]);

    const result = await importSiteHandler.execute(
      { zipPath: testZipPath, siteName: 'custom-name' },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(services.localServices!.importSite).toHaveBeenCalledWith(testZipPath, 'custom-name');
  });

  it('should reject non-zip files', async () => {
    const txtPath = path.join(os.tmpdir(), 'test.txt');
    fs.writeFileSync(txtPath, 'not a zip');

    const services = createMockServices([]);

    const result = await importSiteHandler.execute(
      { zipPath: txtPath },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('must be a .zip archive');

    fs.unlinkSync(txtPath);
  });

  it('should reject files outside home/tmp directories', async () => {
    const services = createMockServices([]);

    const result = await importSiteHandler.execute(
      { zipPath: '/etc/passwd.zip' },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid zip file path');
  });

  it('should return error if file does not exist', async () => {
    const services = createMockServices([]);

    const result = await importSiteHandler.execute(
      { zipPath: path.join(os.tmpdir(), 'nonexistent.zip') },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Tests: list_blueprints
// ---------------------------------------------------------------------------

describe('local_list_blueprints', () => {
  it('should list available blueprints', async () => {
    const services = createMockServices([]);

    const result = await listBlueprintsHandler.execute({}, services);

    expect(result.isError).toBeUndefined();
    const blueprints = JSON.parse(result.content[0].text);
    expect(blueprints).toHaveLength(1);
    expect(blueprints[0].name).toBe('Blueprint 1');
  });

  it('should handle empty blueprint list', async () => {
    const services = createMockServices([]);
    services.localServices!.getBlueprints = jest.fn().mockResolvedValue([]);

    const result = await listBlueprintsHandler.execute({}, services);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No blueprints found');
  });

  it('should handle missing blueprints service', async () => {
    const services = createMockServices([]);
    services.localServices!.getBlueprints = jest.fn().mockResolvedValue(undefined);

    const result = await listBlueprintsHandler.execute({}, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available');
  });
});

// ---------------------------------------------------------------------------
// Tests: save_blueprint
// ---------------------------------------------------------------------------

describe('local_save_blueprint', () => {
  it('should save a site as blueprint', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await saveBlueprintHandler.execute(
      { site: 'mysite', name: 'My Blueprint', description: 'Test desc' },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Successfully saved blueprint');
    expect(services.localServices!.saveBlueprint).toHaveBeenCalledWith('site-1', {
      name: 'My Blueprint',
      description: 'Test desc',
    });
  });

  it('should handle missing description', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await saveBlueprintHandler.execute(
      { site: 'mysite', name: 'My Blueprint' },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(services.localServices!.saveBlueprint).toHaveBeenCalledWith('site-1', {
      name: 'My Blueprint',
      description: '',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: get_site_logs
// ---------------------------------------------------------------------------

describe('local_get_site_logs', () => {
  const sitePath = path.join(os.tmpdir(), 'test-site-logs');
  const logsDir = path.join(sitePath, 'logs');
  const phpLogsDir = path.join(logsDir, 'php');

  beforeEach(() => {
    // Create test log structure
    fs.mkdirSync(phpLogsDir, { recursive: true });
    fs.writeFileSync(
      path.join(phpLogsDir, 'error.log'),
      'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
    );
  });

  afterEach(() => {
    // Clean up
    fs.rmSync(sitePath, { recursive: true, force: true });
  });

  it('should read PHP error logs', async () => {
    const site = createMockSite({
      id: 'site-1',
      name: 'mysite',
      path: sitePath,
    });
    const services = createMockServices([site]);

    const result = await getSiteLogsHandler.execute(
      { site: 'mysite', logType: 'php', lines: 3 },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Line 3');
    expect(result.content[0].text).toContain('Line 4');
    expect(result.content[0].text).toContain('Line 5');
  });

  it('should handle missing log files', async () => {
    const site = createMockSite({
      id: 'site-1',
      name: 'mysite',
      path: path.join(os.tmpdir(), 'site-no-logs'),
    });
    const services = createMockServices([site]);

    const result = await getSiteLogsHandler.execute(
      { site: 'mysite' },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should clamp line count to valid range', async () => {
    const site = createMockSite({
      id: 'site-1',
      name: 'mysite',
      path: sitePath,
    });
    const services = createMockServices([site]);

    // Test minimum clamp
    const result1 = await getSiteLogsHandler.execute(
      { site: 'mysite', lines: 1 },
      services
    );
    expect(result1.content[0].text).toContain('last 10 lines'); // Clamped to 10

    // Test maximum clamp
    const result2 = await getSiteLogsHandler.execute(
      { site: 'mysite', lines: 2000 },
      services
    );
    expect(result2.content[0].text).toContain('last 1000 lines'); // Clamped to 1000
  });
});

// ---------------------------------------------------------------------------
// Tests: import_database
// ---------------------------------------------------------------------------

describe('wp_import_database', () => {
  const testSqlPath = path.join(os.tmpdir(), 'test-import.sql');

  beforeEach(() => {
    fs.writeFileSync(testSqlPath, 'CREATE TABLE test (id INT);');
  });

  afterEach(() => {
    if (fs.existsSync(testSqlPath)) {
      fs.unlinkSync(testSqlPath);
    }
  });

  it('should import SQL file into database', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await importDatabaseHandler.execute(
      { site: 'mysite', sqlPath: testSqlPath },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Successfully imported');
    expect(services.localServices!.wpCliRun).toHaveBeenCalledWith(
      'site-1',
      ['db', 'import', testSqlPath]
    );
  });

  it('should reject non-SQL files', async () => {
    const txtPath = path.join(os.tmpdir(), 'test.txt');
    fs.writeFileSync(txtPath, 'not sql');

    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await importDatabaseHandler.execute(
      { site: 'mysite', sqlPath: txtPath },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('must end in .sql');

    fs.unlinkSync(txtPath);
  });

  it('should reject files outside home/tmp directories', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await importDatabaseHandler.execute(
      { site: 'mysite', sqlPath: '/etc/passwd.sql' },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid SQL file path');
  });
});

// ---------------------------------------------------------------------------
// Tests: get_site_changes
// ---------------------------------------------------------------------------

describe('local_get_site_changes', () => {
  it('should get file changes for push', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await getSiteChangesHandler.execute(
      { site: 'mysite', direction: 'push' },
      services
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.direction).toBe('push');
    expect(data.totalChanges).toBe(2);
    expect(data.changes).toHaveLength(2);
  });

  it('should default to push direction', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await getSiteChangesHandler.execute(
      { site: 'mysite' },
      services
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.direction).toBe('push');
  });

  it('should return error if site not linked to WPE', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);
    services.localServices!.resolveWpeInstall = jest.fn().mockResolvedValue(null);

    const result = await getSiteChangesHandler.execute(
      { site: 'mysite' },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not linked');
  });
});

// ---------------------------------------------------------------------------
// Tests: get_sync_history
// ---------------------------------------------------------------------------

describe('local_get_sync_history', () => {
  it('should get sync history for a site', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await getSyncHistoryHandler.execute(
      { site: 'mysite', limit: 10 },
      services
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.site).toBe('mysite');
    expect(data.totalEvents).toBe(1);
    expect(data.events[0].direction).toBe('push');
  });

  it('should use default limit of 10', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);

    const result = await getSyncHistoryHandler.execute(
      { site: 'mysite' },
      services
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.showing).toBeLessThanOrEqual(10);
  });

  it('should handle missing sync history service', async () => {
    const site = createMockSite({ id: 'site-1', name: 'mysite' });
    const services = createMockServices([site]);
    services.localServices!.getSyncHistory = jest.fn().mockResolvedValue(undefined);

    const result = await getSyncHistoryHandler.execute(
      { site: 'mysite' },
      services
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available');
  });
});
