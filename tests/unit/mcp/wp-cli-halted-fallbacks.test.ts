/**
 * Tests for halted-site twin fallback paths in wp_plugin_list, wp_theme_list,
 * and wp_core_version. Each tool must return cached twin data when a local site
 * is halted, or a clear error when no twin data exists.
 */

import { pluginListHandler } from '../../../src/main/mcp/modules/wp-cli/plugin-list';
import { themeListHandler } from '../../../src/main/mcp/modules/wp-cli/theme-list';
import { coreVersionHandler } from '../../../src/main/mcp/modules/wp-cli/core-version';
import type { NexusServices, LocalSiteInfo, SiteDataAccessor } from '../../../src/main/mcp/types';
import type { SiteDigitalTwin, TwinPlugin, TwinTheme } from '../../../src/main/twin/SiteDigitalTwin';

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSite(overrides?: Partial<LocalSiteInfo>): LocalSiteInfo {
  return { id: 'site-1', name: 'mysite', domain: 'mysite.local', path: '/sites/mysite', ...overrides };
}

function makeSiteData(site: LocalSiteInfo): SiteDataAccessor {
  return {
    getSite: (id) => (id === site.id ? site : null),
    getSites: () => ({ [site.id]: site }),
  };
}

function makeTwin(overrides: Partial<SiteDigitalTwin> = {}): SiteDigitalTwin {
  return {
    siteId: 'site-1',
    siteName: 'mysite',
    domain: 'mysite.local',
    path: '/sites/mysite',
    source: 'local',
    completeness: 'metadata',
    asOf: Date.now() - 2 * ONE_HOUR_MS, // 2h ago by default (fresh)
    sources: {},
    ...overrides,
  };
}

const SAMPLE_PLUGINS: TwinPlugin[] = [
  { name: 'woocommerce', version: '8.5.0', status: 'active' },
  { name: 'contact-form-7', version: '5.9.0', status: 'inactive' },
];

const SAMPLE_THEMES: TwinTheme[] = [
  { name: 'twentytwentyfour', version: '1.2', status: 'active' },
  { name: 'storefront', version: '4.4.1', status: 'inactive' },
];

function makeServices(site: LocalSiteInfo, opts: {
  siteStatus?: string;
  twin?: SiteDigitalTwin | null;
  getPlugins?: jest.Mock;
  getThemes?: jest.Mock;
  getWpVersion?: jest.Mock;
} = {}): NexusServices {
  const {
    siteStatus = 'halted',
    twin = null,
    getPlugins = jest.fn().mockResolvedValue([]),
    getThemes = jest.fn().mockResolvedValue([]),
    getWpVersion = jest.fn().mockResolvedValue('6.4.2'),
  } = opts;

  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: { get: jest.fn().mockReturnValue(null) } as any,
    fileScanner: {} as any,
    siteData: makeSiteData(site),
    logger: { info: jest.fn(), error: jest.fn() } as any,
    localServices: {
      getSiteStatus: jest.fn().mockReturnValue(siteStatus),
      getPlugins,
      getThemes,
      getWpVersion,
      isCAPIAvailable: jest.fn().mockReturnValue(false),
      isSSHKeyAvailable: jest.fn().mockReturnValue(false),
    } as any,
    twinService: { get: jest.fn().mockReturnValue(twin) } as any,
  } as any;
}

// ---------------------------------------------------------------------------
// wp_plugin_list
// ---------------------------------------------------------------------------

describe('wp_plugin_list — halted site fallbacks', () => {
  it('returns cached plugin list with freshness note when twin is fresh', async () => {
    const site = makeSite();
    const twin = makeTwin({ plugins: SAMPLE_PLUGINS, asOf: Date.now() - 2 * ONE_HOUR_MS });
    const services = makeServices(site, { twin });

    const result = await pluginListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('cached');
    expect(text).toContain('site is halted');
    expect(text).toContain('woocommerce');
    expect(text).toContain('contact-form-7');
    expect(text).toContain('**active**');
    expect(text).toContain('inactive');
    expect(text).not.toContain('⚠️');
  });

  it('returns cached plugin list with stale warning when twin is > 24h old', async () => {
    const site = makeSite();
    const twin = makeTwin({ plugins: SAMPLE_PLUGINS, asOf: Date.now() - 30 * ONE_HOUR_MS });
    const services = makeServices(site, { twin });

    const result = await pluginListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('⚠️');
    expect(text).toContain('Stale cached data');
    expect(text).toContain('woocommerce');
    expect(text).toContain('nexus sites refresh mysite');
  });

  it('returns error when twin has no plugins', async () => {
    const site = makeSite();
    const twin = makeTwin({ plugins: [], wpVersion: '7.0' });
    const services = makeServices(site, { twin });

    const result = await pluginListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('is halted and no cached data exists');
    expect(result.content[0].text).toContain('nexus sites start mysite');
  });

  it('returns error when no twin exists', async () => {
    const site = makeSite();
    const services = makeServices(site, { twin: null });

    const result = await pluginListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('is halted and no cached data exists');
    expect(result.content[0].text).toContain('nexus sites start mysite');
  });

  it('calls live getPlugins when site is running', async () => {
    const site = makeSite();
    const getPlugins = jest.fn().mockResolvedValue([
      { name: 'woocommerce', version: '8.5.0', status: 'active' },
    ]);
    const services = makeServices(site, { siteStatus: 'running', getPlugins });

    const result = await pluginListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    expect(getPlugins).toHaveBeenCalledWith('site-1');
    expect(result.content[0].text).toContain('woocommerce');
    expect(result.content[0].text).not.toContain('cached');
  });
});

// ---------------------------------------------------------------------------
// wp_theme_list
// ---------------------------------------------------------------------------

describe('wp_theme_list — halted site fallbacks', () => {
  it('returns cached theme list with freshness note when twin is fresh', async () => {
    const site = makeSite();
    const twin = makeTwin({ themes: SAMPLE_THEMES, asOf: Date.now() - ONE_HOUR_MS });
    const services = makeServices(site, { twin });

    const result = await themeListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('cached');
    expect(text).toContain('site is halted');
    expect(text).toContain('twentytwentyfour');
    expect(text).toContain('storefront');
    expect(text).toContain('**active**');
    expect(text).not.toContain('⚠️');
  });

  it('returns cached theme list with stale warning when twin is > 24h old', async () => {
    const site = makeSite();
    const twin = makeTwin({ themes: SAMPLE_THEMES, asOf: Date.now() - 48 * ONE_HOUR_MS });
    const services = makeServices(site, { twin });

    const result = await themeListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('⚠️');
    expect(text).toContain('Stale cached data');
    expect(text).toContain('twentytwentyfour');
    expect(text).toContain('nexus sites refresh mysite');
  });

  it('returns error when twin has no themes', async () => {
    const site = makeSite();
    const twin = makeTwin({ themes: [] });
    const services = makeServices(site, { twin });

    const result = await themeListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('is halted and no cached data exists');
    expect(result.content[0].text).toContain('nexus sites start mysite');
  });

  it('returns error when no twin exists', async () => {
    const site = makeSite();
    const services = makeServices(site, { twin: null });

    const result = await themeListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('is halted and no cached data exists');
  });

  it('calls live getThemes when site is running', async () => {
    const site = makeSite();
    const getThemes = jest.fn().mockResolvedValue([
      { name: 'twentytwentyfour', version: '1.2', status: 'active' },
    ]);
    const services = makeServices(site, { siteStatus: 'running', getThemes });

    const result = await themeListHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    expect(getThemes).toHaveBeenCalledWith('site-1');
    expect(result.content[0].text).toContain('twentytwentyfour');
    expect(result.content[0].text).not.toContain('cached');
  });
});

// ---------------------------------------------------------------------------
// wp_core_version
// ---------------------------------------------------------------------------

describe('wp_core_version — halted site fallbacks', () => {
  it('returns cached version with freshness note when twin is fresh', async () => {
    const site = makeSite();
    const twin = makeTwin({ wpVersion: '7.0', asOf: Date.now() - 3 * ONE_HOUR_MS });
    const services = makeServices(site, { twin });

    const result = await coreVersionHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('WordPress 7.0');
    expect(text).toContain('cached');
    expect(text).toContain('site is halted');
    expect(text).not.toContain('⚠️');
  });

  it('returns cached version with stale warning when twin is > 24h old', async () => {
    const site = makeSite();
    const twin = makeTwin({ wpVersion: '6.7.1', asOf: Date.now() - 3 * ONE_DAY_MS });
    const services = makeServices(site, { twin });

    const result = await coreVersionHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('WordPress 6.7.1');
    expect(text).toContain('⚠️');
    expect(text).toContain('Stale cached data');
    expect(text).toContain('nexus sites refresh mysite');
  });

  it('returns error when twin has no wpVersion', async () => {
    const site = makeSite();
    const twin = makeTwin({ wpVersion: undefined });
    const services = makeServices(site, { twin });

    const result = await coreVersionHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('is halted and no cached data exists');
    expect(result.content[0].text).toContain('nexus sites start mysite');
  });

  it('returns error when no twin exists', async () => {
    const site = makeSite();
    const services = makeServices(site, { twin: null });

    const result = await coreVersionHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('is halted and no cached data exists');
  });

  it('calls live getWpVersion when site is running', async () => {
    const site = makeSite();
    const getWpVersion = jest.fn().mockResolvedValue('7.0');
    const services = makeServices(site, { siteStatus: 'running', getWpVersion });

    const result = await coreVersionHandler.execute({ site: 'mysite' }, services);

    expect(result.isError).toBeUndefined();
    expect(getWpVersion).toHaveBeenCalledWith('site-1');
    expect(result.content[0].text).toBe('WordPress 7.0');
  });
});
