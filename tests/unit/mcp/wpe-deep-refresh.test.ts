/**
 * Unit tests for wpe_site_deep_refresh MCP tool
 */

import { deepRefreshHandler } from '../../../src/main/mcp/modules/wpe/deep-refresh';

// Minimal plugin/theme fixture data matching WP-CLI JSON output
const PLUGIN_JSON = JSON.stringify([
  { name: 'akismet', title: 'Akismet Anti-Spam', version: '5.3', status: 'active' },
  { name: 'hello', title: 'Hello Dolly', version: '1.7.2', status: 'inactive' },
]);

const THEME_JSON = JSON.stringify([
  { name: 'twentytwentyfive', title: 'Twenty Twenty-Five', version: '1.1', status: 'active' },
]);

function makeLocalServices(overrides: Partial<{
  isSSHKeyAvailable: () => boolean;
  remoteWpCliRun: jest.Mock;
}> = {}) {
  return {
    isSSHKeyAvailable: overrides.isSSHKeyAvailable ?? (() => true),
    remoteWpCliRun: overrides.remoteWpCliRun ?? jest.fn().mockResolvedValue({ success: true, stdout: '' }),
  };
}

function makeGraphService(overrides: Partial<{
  getDb: () => any;
  deletePlugins: jest.Mock;
  upsertPlugin: jest.Mock;
  deleteThemes: jest.Mock;
  upsertTheme: jest.Mock;
}> = {}) {
  const stmt = { get: jest.fn().mockReturnValue({ id: 'site-abc' }), run: jest.fn() };
  return {
    getDb: overrides.getDb ?? (() => ({ prepare: jest.fn().mockReturnValue(stmt) })),
    deletePlugins: overrides.deletePlugins ?? jest.fn().mockResolvedValue(undefined),
    upsertPlugin: overrides.upsertPlugin ?? jest.fn().mockResolvedValue(undefined),
    deleteThemes: overrides.deleteThemes ?? jest.fn().mockResolvedValue(undefined),
    upsertTheme: overrides.upsertTheme ?? jest.fn().mockResolvedValue(undefined),
  };
}

function makeServices(overrides: {
  localServices?: any;
  graphService?: any;
  noLocalServices?: boolean;
} = {}) {
  return {
    localServices: overrides.noLocalServices ? undefined : (overrides.localServices ?? makeLocalServices()),
    graphService: overrides.graphService ?? makeGraphService(),
    // minimal stubs for the rest of NexusServices
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: {} as any,
    fileScanner: {} as any,
    siteData: { getSite: jest.fn(), getSites: jest.fn().mockReturnValue({}) },
    logger: { info: jest.fn(), error: jest.fn() },
  };
}

// Helper: build a remoteWpCliRun mock that returns realistic results for all 7 calls
function makeFullRemoteWpCliRun() {
  return jest.fn()
    .mockResolvedValueOnce({ success: true, stdout: PLUGIN_JSON })          // plugin list
    .mockResolvedValueOnce({ success: true, stdout: THEME_JSON })           // theme list
    .mockResolvedValueOnce({ success: true, stdout: '6.5.2\n' })            // core version
    .mockResolvedValueOnce({ success: true, stdout: 'https://mysite.wpengine.com\n' }) // siteurl
    .mockResolvedValueOnce({ success: true, stdout: 'admin@mysite.com\n' }) // admin_email
    .mockResolvedValueOnce({ success: true, stdout: '42\n' })               // post list --format=count
    .mockResolvedValueOnce({ success: true, stdout: 'twentytwentyfive\n' }); // stylesheet
}

// ──────────────────────────────────────────────────────────────────────────────

describe('wpe_site_deep_refresh', () => {
  // 1. Returns error when localServices unavailable
  it('returns error when localServices is not available', async () => {
    const services = makeServices({ noLocalServices: true });

    const result = await deepRefreshHandler.execute({ install_name: 'mysite' }, services as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Local services not available/i);
  });

  // 2. Returns error when SSH key not available
  it('returns error when SSH key is not configured', async () => {
    const services = makeServices({
      localServices: makeLocalServices({ isSSHKeyAvailable: () => false }),
    });

    const result = await deepRefreshHandler.execute({ install_name: 'mysite' }, services as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/SSH key not found/i);
  });

  // 3. Calls all 7 SSH WP-CLI commands in parallel
  it('calls 7 SSH WP-CLI commands', async () => {
    const remoteWpCliRun = makeFullRemoteWpCliRun();
    const services = makeServices({
      localServices: makeLocalServices({ remoteWpCliRun }),
    });

    await deepRefreshHandler.execute({ install_name: 'mysite' }, services as any);

    expect(remoteWpCliRun).toHaveBeenCalledTimes(7);

    // Verify each expected command was issued
    expect(remoteWpCliRun).toHaveBeenCalledWith('mysite', ['plugin', 'list', '--format=json', '--fields=name,title,version,status']);
    expect(remoteWpCliRun).toHaveBeenCalledWith('mysite', ['theme', 'list', '--format=json', '--fields=name,title,version,status']);
    expect(remoteWpCliRun).toHaveBeenCalledWith('mysite', ['core', 'version']);
    expect(remoteWpCliRun).toHaveBeenCalledWith('mysite', ['option', 'get', 'siteurl']);
    expect(remoteWpCliRun).toHaveBeenCalledWith('mysite', ['option', 'get', 'admin_email']);
    expect(remoteWpCliRun).toHaveBeenCalledWith('mysite', ['post', 'list', '--post_status=publish', '--format=count']);
    expect(remoteWpCliRun).toHaveBeenCalledWith('mysite', ['option', 'get', 'stylesheet']);
  });

  // 4. Persists plugins to GraphService
  it('persists plugins via deletePlugins + upsertPlugin', async () => {
    const deletePlugins = jest.fn().mockResolvedValue(undefined);
    const upsertPlugin = jest.fn().mockResolvedValue(undefined);
    const remoteWpCliRun = makeFullRemoteWpCliRun();

    const services = makeServices({
      localServices: makeLocalServices({ remoteWpCliRun }),
      graphService: makeGraphService({ deletePlugins, upsertPlugin }),
    });

    await deepRefreshHandler.execute({ install_name: 'mysite' }, services as any);

    // deletePlugins called once for the site
    expect(deletePlugins).toHaveBeenCalledTimes(1);
    expect(deletePlugins).toHaveBeenCalledWith('site-abc');

    // upsertPlugin called for each plugin in the fixture (2)
    expect(upsertPlugin).toHaveBeenCalledTimes(2);
    expect(upsertPlugin).toHaveBeenCalledWith(expect.objectContaining({
      site_id: 'site-abc',
      slug: 'akismet',
      name: 'Akismet Anti-Spam',
      version: '5.3',
      is_active: true,
    }));
    expect(upsertPlugin).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'hello',
      is_active: false,
    }));
  });

  // 5. Returns formatted markdown summary on success
  it('returns formatted markdown summary with all fields', async () => {
    const remoteWpCliRun = makeFullRemoteWpCliRun();
    const services = makeServices({
      localServices: makeLocalServices({ remoteWpCliRun }),
    });

    const result = await deepRefreshHandler.execute({ install_name: 'mysite' }, services as any);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toMatch(/mysite/);
    expect(text).toMatch(/6\.5\.2/);
    expect(text).toMatch(/2 plugins/);
    expect(text).toMatch(/1 themes/);
    expect(text).toMatch(/https:\/\/mysite\.wpengine\.com/);
    expect(text).toMatch(/admin@mysite\.com/);
    expect(text).toMatch(/42 published posts/);
  });

  // 6. Handles SSH failure gracefully (partial results)
  it('includes partial error note when some SSH calls fail', async () => {
    const remoteWpCliRun = jest.fn()
      .mockResolvedValueOnce({ success: false, stdout: 'SSH error', stderr: '' }) // plugin list fails
      .mockResolvedValueOnce({ success: true, stdout: THEME_JSON })              // theme list ok
      .mockResolvedValueOnce({ success: true, stdout: '6.5.2\n' })
      .mockResolvedValueOnce({ success: true, stdout: 'https://mysite.wpengine.com\n' })
      .mockResolvedValueOnce({ success: true, stdout: 'admin@mysite.com\n' })
      .mockResolvedValueOnce({ success: true, stdout: '10\n' })
      .mockResolvedValueOnce({ success: true, stdout: 'twentytwentyfive\n' });

    const services = makeServices({
      localServices: makeLocalServices({ remoteWpCliRun }),
    });

    const result = await deepRefreshHandler.execute({ install_name: 'mysite' }, services as any);

    // Should not be a fatal error — partial data is returned
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    // Plugin list error is surfaced
    expect(text).toMatch(/plugin list failed/i);

    // Themes still persisted
    expect(text).toMatch(/1 themes/);
  });
});
