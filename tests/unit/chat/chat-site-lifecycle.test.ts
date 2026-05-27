// tests/unit/chat/chat-site-lifecycle.test.ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ChatService } from '../../../src/main/chat/ChatService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockServices(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    siteData: {
      // resolveSite() calls getSite(query) first (exact ID match), then getSites()
      getSite: jest.fn((id: string) => {
        if (id === 'site-halted') return { id: 'site-halted', name: 'Halted Site', path: '/tmp/halted' };
        if (id === 'site-running') return { id: 'site-running', name: 'Running Site', path: '/tmp/running' };
        return null;
      }),
      getSites: jest.fn().mockReturnValue({}),
    },
    localServices: {
      // NOTE: getSiteStatus is called TWICE per site in prepareSiteLifecycle:
      //   1. In the debug logging loop
      //   2. In the toStart filter
      // Default: all sites report 'running' (so nothing gets started)
      getSiteStatus: jest.fn((id: string) => {
        if (id === 'site-running') return 'running';
        if (id === 'site-halted') return 'halted';
        return 'unknown';
      }),
      startSites: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stopSites: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      startSite: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stopSite: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function makeRegistry() {
  return {
    call: jest.fn().mockImplementation(async () => ({ content: [{ text: 'result' }], isError: false })),
    listTools: jest.fn().mockReturnValue([]),
  };
}

function makeChatService(servicesOverrides: Record<string, any> = {}) {
  const services = makeMockServices(servicesOverrides);
  const svc = new ChatService({
    registry: makeRegistry() as any,
    services: services as any,
    sendToRenderer: jest.fn(),
  });
  // Expose the internal services for assertion convenience
  (svc as any).__services = services;
  return svc;
}

function getServices(svc: ChatService) {
  return (svc as any).__services;
}

function prepareSiteLifecycle(svc: ChatService, toolName: string, args: Record<string, unknown>) {
  return (svc as any).prepareSiteLifecycle(toolName, args);
}

function teardownSiteLifecycle(svc: ChatService, ids: string[], autoStop: boolean) {
  return (svc as any).teardownSiteLifecycle(ids, autoStop);
}

// ---------------------------------------------------------------------------
// prepareSiteLifecycle
// ---------------------------------------------------------------------------

describe('prepareSiteLifecycle', () => {
  it('returns empty startedIds when tool is not in NEEDS_RUNNING_SITE', async () => {
    const svc = makeChatService();
    const result = await prepareSiteLifecycle(svc, 'local_list_sites', {});
    expect(result.startedIds).toHaveLength(0);
  });

  it('returns empty startedIds when localServices is unavailable', async () => {
    const svc = makeChatService({ localServices: undefined });
    const result = await prepareSiteLifecycle(svc, 'wp_plugin_list', { site: 'site-halted' });
    expect(result.startedIds).toHaveLength(0);
  });

  it('does NOT start a site that is already running', async () => {
    const svc = makeChatService();
    const services = getServices(svc);
    // site-running resolves and is already 'running'
    const result = await prepareSiteLifecycle(svc, 'wp_plugin_list', { site: 'site-running' });
    expect(result.startedIds).toHaveLength(0);
    expect(services.localServices.startSites).not.toHaveBeenCalled();
  });

  it('starts a halted site before a sync tool', async () => {
    const svc = makeChatService();
    const services = getServices(svc);

    // getSiteStatus is called twice per site:
    //   call 1 (toStart filter): 'halted'  → site goes into toStart
    //   call 2 (startedIds filter after startSites): 'running'
    services.localServices.getSiteStatus
      .mockReturnValueOnce('halted')   // toStart filter
      .mockReturnValueOnce('running'); // confirmation filter

    const result = await prepareSiteLifecycle(svc, 'wp_plugin_list', { site: 'site-halted' });
    expect(services.localServices.startSites).toHaveBeenCalledWith(['site-halted']);
    expect(result.startedIds).toContain('site-halted');
  });

  it('returns autoStop=true for synchronous tools (wp_plugin_list)', async () => {
    const svc = makeChatService();
    // site-running is already running, so no start — autoStop still reflects config
    const result = await prepareSiteLifecycle(svc, 'wp_plugin_list', { site: 'site-running' });
    expect(result.autoStop).toBe(true);
  });

  it('returns autoStop=false for async tools (bulk_reindex)', async () => {
    const svc = makeChatService();
    // site_ids=[] → no targets → early return with config.autoStop
    const result = await prepareSiteLifecycle(svc, 'bulk_reindex', { site_ids: [] });
    expect(result.autoStop).toBe(false);
  });

  it('handles bulk_reindex with multiple halted site_ids', async () => {
    const svc = makeChatService();
    const services = getServices(svc);

    // Override getSite to recognise site-a and site-b
    services.siteData.getSite.mockImplementation((id: string) => ({ id, name: `Site ${id}`, path: '/tmp' }));

    // For each site: call 1 (toStart filter), call 2 (startedIds confirmation)
    services.localServices.getSiteStatus
      .mockReturnValueOnce('halted')   // site-a toStart filter
      .mockReturnValueOnce('halted')   // site-b toStart filter
      .mockReturnValueOnce('running')  // site-a confirmation
      .mockReturnValueOnce('running'); // site-b confirmation

    const result = await prepareSiteLifecycle(svc, 'bulk_reindex', { site_ids: ['site-a', 'site-b'] });
    expect(services.localServices.startSites).toHaveBeenCalledWith(['site-a', 'site-b']);
    expect(result.startedIds).toHaveLength(2);
    expect(result.autoStop).toBe(false);
  });

  it('does not add site to startedIds if it fails to reach running state', async () => {
    const svc = makeChatService();
    const services = getServices(svc);

    // logging: halted, filter: halted → goes into toStart
    // confirmation: still 'starting' (not 'running') → excluded from startedIds
    services.localServices.getSiteStatus
      .mockReturnValueOnce('halted')    // logging
      .mockReturnValueOnce('halted')    // toStart filter
      .mockReturnValueOnce('starting'); // confirmation

    const result = await prepareSiteLifecycle(svc, 'wp_plugin_list', { site: 'site-halted' });
    expect(result.startedIds).toHaveLength(0);
  });

  it('does not throw if startSites rejects', async () => {
    const svc = makeChatService();
    const services = getServices(svc);

    services.localServices.getSiteStatus.mockReturnValue('halted');
    services.localServices.startSites.mockRejectedValue(new Error('Router crashed'));

    await expect(prepareSiteLifecycle(svc, 'wp_plugin_list', { site: 'site-halted' }))
      .resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// teardownSiteLifecycle
// ---------------------------------------------------------------------------

describe('teardownSiteLifecycle', () => {
  it('stops sites when autoStop=true', async () => {
    const svc = makeChatService();
    const services = getServices(svc);
    await teardownSiteLifecycle(svc, ['site-halted'], true);
    expect(services.localServices.stopSites).toHaveBeenCalledWith(['site-halted']);
  });

  it('does NOT stop sites when autoStop=false', async () => {
    const svc = makeChatService();
    const services = getServices(svc);
    await teardownSiteLifecycle(svc, ['site-halted'], false);
    expect(services.localServices.stopSites).not.toHaveBeenCalled();
  });

  it('returns lifecycle note mentioning site name', async () => {
    const svc = makeChatService();
    const note = await teardownSiteLifecycle(svc, ['site-halted'], true);
    // Actual format: "\n\n[Auto-lifecycle: started and stopped Halted Site]"
    expect(note).toContain('Halted Site');
    expect(note).toContain('stopped');
  });

  it('returns note indicating site left running for async tools', async () => {
    const svc = makeChatService();
    const note = await teardownSiteLifecycle(svc, ['site-halted'], false);
    // Actual format: "\n\n[Auto-lifecycle: started Halted Site — left running for background task]"
    expect(note).toContain('left running');
  });

  it('returns empty string when no sites were started', async () => {
    const svc = makeChatService();
    const note = await teardownSiteLifecycle(svc, [], true);
    expect(note).toBe('');
  });

  it('returns empty string when localServices is unavailable', async () => {
    const svc = makeChatService({ localServices: undefined });
    const note = await teardownSiteLifecycle(svc, ['site-halted'], true);
    expect(note).toBe('');
  });
});
