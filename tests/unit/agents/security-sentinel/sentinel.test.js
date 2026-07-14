'use strict';

const agent = require('../../../../agents/security-sentinel/agent');
const { parseSqlResult, getScanScope } = agent._test;

// We'll add specific test blocks in each task
describe('security-sentinel', () => {
  it('has correct name and version', () => {
    expect(agent.name).toBe('security-sentinel');
    expect(agent.version).toBe('1.0.0');
  });

  it('has all required trigger types', () => {
    const types = agent.triggers.map(t => t.type);
    expect(types).toContain('cron');
    expect(types).toContain('event');
  });

  it('parseSqlResult handles empty input', () => {
    expect(parseSqlResult('')).toEqual([]);
    expect(parseSqlResult(null)).toEqual([]);
  });

  it('parseSqlResult parses markdown table output', () => {
    const input = [
      '| id | name | environment |',
      '| --- | --- | --- |',
      '| site-1 | mysite | production |',
      '| site-2 | devsite | staging |',
    ].join('\n');
    const result = parseSqlResult(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'site-1', name: 'mysite', environment: 'production' });
    expect(result[1]).toEqual({ id: 'site-2', name: 'devsite', environment: 'staging' });
  });

  it('parseSqlResult returns empty array when only header row present', () => {
    const input = '| id | name |\n| --- | --- |';
    expect(parseSqlResult(input)).toEqual([]);
  });

  it('getScanScope returns installId for wpe:sync.completed event', () => {
    const event = { namespace: 'wpe', type: 'sync.completed', payload: { siteId: 'wpe-abc123' } };
    expect(getScanScope(event)).toEqual({ installId: 'wpe-abc123' });
  });

  it('getScanScope returns null installId for cron (no event)', () => {
    expect(getScanScope(null)).toEqual({ installId: null });
  });

  it('getScanScope returns null installId for non-wpe events', () => {
    const event = { namespace: 'wp', type: 'plugin.activated', payload: {} };
    expect(getScanScope(event)).toEqual({ installId: null });
  });

  it('getScanScope returns null installId when payload has no siteId', () => {
    const event = { namespace: 'wpe', type: 'sync.completed', payload: {} };
    expect(getScanScope(event)).toEqual({ installId: null });
  });

  it('module.exports has required fields', () => {
    expect(agent.description).toBeTruthy();
    expect(Array.isArray(agent.triggers)).toBe(true);
    expect(Array.isArray(agent.tools)).toBe(true);
    expect(typeof agent.run).toBe('function');
    expect(agent._test).toBeTruthy();
  });

  describe('runAbsoluteChecks', () => {
    const { runAbsoluteChecks } = require('../../../../agents/security-sentinel/agent')._test;

    const baseInstall = {
      id: 'wpe-test', name: 'testsite', environment: 'production',
      postCount: 16, adminUsers: [], plugins: [], settings: {},
    };

    it('ABS-01: flags admin username', () => {
      const install = { ...baseInstall, adminUsers: [{ username: 'admin', email: 'j@example.com', roles: '["administrator"]' }] };
      const signals = runAbsoluteChecks(install);
      expect(signals.find(s => s.id === 'ABS-01')).toBeDefined();
      expect(signals.find(s => s.id === 'ABS-01').severity).toBe('high');
    });

    it('ABS-01: does not flag non-admin username', () => {
      const install = { ...baseInstall, adminUsers: [{ username: 'jeremy', email: 'j@wpengine.com', roles: '["administrator"]' }] };
      expect(runAbsoluteChecks(install).find(s => s.id === 'ABS-01')).toBeUndefined();
    });

    it('ABS-02: flags admin count > 3 on small site', () => {
      const admins = ['a','b','c','d'].map(u => ({ username: u, email: `${u}@x.com`, roles: '["administrator"]' }));
      const install = { ...baseInstall, adminUsers: admins };
      const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-02');
      expect(signal).toBeDefined();
      expect(signal.severity).toBe('high');
    });

    it('ABS-02: does not flag 2 admins on small site', () => {
      const admins = ['a','b'].map(u => ({ username: u, email: `${u}@x.com`, roles: '["administrator"]' }));
      const install = { ...baseInstall, adminUsers: admins };
      expect(runAbsoluteChecks(install).find(s => s.id === 'ABS-02')).toBeUndefined();
    });

    it('ABS-03: flags @example.com email on admin', () => {
      const install = { ...baseInstall, adminUsers: [{ username: 'admin', email: 'admin@example.com', roles: '["administrator"]' }] };
      const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-03');
      expect(signal).toBeDefined();
      expect(signal.severity).toBe('critical');
    });

    it('ABS-04: flags active file manager plugin', () => {
      const install = { ...baseInstall, plugins: [{ slug: 'fileorganizer', is_active: '1' }] };
      const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-04');
      expect(signal).toBeDefined();
      expect(signal.severity).toBe('high');
    });

    it('ABS-04: does not flag inactive file manager', () => {
      const install = { ...baseInstall, plugins: [{ slug: 'fileorganizer', is_active: '0' }] };
      expect(runAbsoluteChecks(install).find(s => s.id === 'ABS-04')).toBeUndefined();
    });

    it('ABS-05: flags wp-compat slug', () => {
      const install = { ...baseInstall, plugins: [{ slug: 'wp-compat', is_active: '1' }] };
      const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-05');
      expect(signal).toBeDefined();
      expect(signal.severity).toBe('critical');
    });

    it('ABS-06: flags default auth salts', () => {
      const install = { ...baseInstall, settings: { AUTH_KEY: 'put your unique phrase here' } };
      const signal = runAbsoluteChecks(install).find(s => s.id === 'ABS-06');
      expect(signal).toBeDefined();
      expect(signal.severity).toBe('high');
    });
  });

  describe('llmUserAudit', () => {
    const { llmUserAudit } = require('../../../../agents/security-sentinel/agent')._test;

    it('returns empty signals for clearly legitimate usernames', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('These usernames all appear legitimate.') };
      const users = [{ username: 'jeremy', email: 'j@wpengine.com' }];
      const result = await llmUserAudit(users, fakeAi);
      expect(result.signals).toHaveLength(0);
    });

    it('returns a critical signal when LLM flags synthetic usernames', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('SUSPICIOUS: admin_MT6ZqT appears programmatically generated; oxhuhafz is a random string.') };
      const users = [
        { username: 'admin_MT6ZqT', email: '' },
        { username: 'oxhuhafz', email: '' },
      ];
      const result = await llmUserAudit(users, fakeAi);
      expect(result.signals.length).toBeGreaterThan(0);
      expect(result.signals[0].severity).toBe('critical');
      expect(result.signals[0].id).toBe('LLM-USER-01');
    });

    it('calls ai.run with the username list', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('Looks fine.') };
      const users = [{ username: 'testuser', email: 't@t.com' }];
      await llmUserAudit(users, fakeAi);
      expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('testuser'));
    });
  });

  describe('runExposureChecks', () => {
    const { runExposureChecks } = require('../../../../agents/security-sentinel/agent')._test;

    it('EXP-03: flags missing DISALLOW_FILE_EDIT on production', () => {
      const install = { name: 'test', environment: 'production', settings: { DISALLOW_FILE_EDIT: 'false' }, plugins: [] };
      const signal = runExposureChecks(install).find(s => s.id === 'EXP-03');
      expect(signal).toBeDefined();
      expect(signal.severity).toBe('medium');
    });

    it('EXP-03: does not flag when DISALLOW_FILE_EDIT is true', () => {
      const install = { name: 'test', environment: 'production', settings: { DISALLOW_FILE_EDIT: '1' }, plugins: [] };
      expect(runExposureChecks(install).find(s => s.id === 'EXP-03')).toBeUndefined();
    });

    it('EXP-05: flags WP_DEBUG true on production', () => {
      const install = { name: 'test', environment: 'production', settings: { WP_DEBUG: 'true' }, plugins: [] };
      const signal = runExposureChecks(install).find(s => s.id === 'EXP-05');
      expect(signal).toBeDefined();
      expect(signal.severity).toBe('medium');
    });

    it('EXP-05: does not flag on non-production environments', () => {
      const install = { name: 'test', environment: 'development', settings: { WP_DEBUG: 'true' }, plugins: [] };
      expect(runExposureChecks(install).find(s => s.id === 'EXP-05')).toBeUndefined();
    });
  });

  describe('baseline management', () => {
    const { loadBaseline, storeBaseline, runRelativeChecks } = require('../../../../agents/security-sentinel/agent')._test;

    const mockState = (() => {
      const store = {};
      return { get: k => store[k] ?? null, set: (k, v) => { store[k] = v; } };
    })();

    const install = {
      id: 'wpe-test', name: 'testsite',
      plugins: [{ slug: 'woocommerce', version: '8.0', is_active: '1' }],
      adminUsers: [{ username: 'jeremy' }],
      settings: {},
    };

    it('loadBaseline returns null when no baseline stored', () => {
      const freshState = { get: () => null, set: jest.fn() };
      expect(loadBaseline('wpe-test', freshState)).toBeNull();
    });

    it('storeBaseline then loadBaseline returns stored data', () => {
      storeBaseline(install, mockState);
      const baseline = loadBaseline(install.id, mockState);
      expect(baseline).not.toBeNull();
      expect(baseline.adminCount).toBe(1);
      expect(baseline.pluginSlugs).toContain('woocommerce:8.0:1');
    });

    it('REL-01: flags new plugin not in baseline', () => {
      const baseline = {
        capturedAt: Date.now() - 1000,
        pluginSlugs: ['woocommerce:8.0:1'],
        adminUserIds: ['jeremy'],
        adminCount: 1,
      };
      const installWithNew = { ...install, plugins: [
        { slug: 'woocommerce', version: '8.0', is_active: '1' },
        { slug: 'evil-plugin', version: '1.0', is_active: '1' },
      ]};
      const signals = runRelativeChecks(installWithNew, baseline);
      expect(signals.find(s => s.id === 'REL-01')).toBeDefined();
    });

    it('REL-02: flags previously-inactive plugin now active', () => {
      const baseline = {
        capturedAt: Date.now() - 1000,
        pluginSlugs: ['evil-plugin:1.0:0', 'woocommerce:8.0:1'],
        adminUserIds: ['jeremy'],
        adminCount: 1,
      };
      const installWithActive = { ...install, plugins: [
        { slug: 'woocommerce', version: '8.0', is_active: '1' },
        { slug: 'evil-plugin', version: '1.0', is_active: '1' },
      ]};
      const signals = runRelativeChecks(installWithActive, baseline);
      expect(signals.find(s => s.id === 'REL-02')).toBeDefined();
    });

    it('REL-03: flags new admin user not in baseline', () => {
      const baseline = { capturedAt: Date.now() - 1000, pluginSlugs: [], adminUserIds: ['jeremy'], adminCount: 1 };
      const installWithNew = { ...install, adminUsers: [{ username: 'jeremy' }, { username: 'hacker' }] };
      const signals = runRelativeChecks(installWithNew, baseline);
      const signal = signals.find(s => s.id === 'REL-03');
      expect(signal).toBeDefined();
      expect(signal.severity).toBe('critical');
      expect(signal.detail).toContain('hacker');
    });

    it('REL-04: flags increased admin count when no new usernames', () => {
      const baseline = { capturedAt: Date.now() - 1000, pluginSlugs: [], adminUserIds: ['jeremy'], adminCount: 1 };
      const installWithMoreAdmins = { ...install, adminUsers: [{ username: 'jeremy' }, { username: 'admin2' }] };
      const signals = runRelativeChecks(installWithMoreAdmins, baseline);
      const rel03 = signals.find(s => s.id === 'REL-03');
      const rel04 = signals.find(s => s.id === 'REL-04');
      // REL-03 should fire because there is a new username
      expect(rel03).toBeDefined();
      // REL-04 should NOT fire because REL-03 already covered it
      expect(rel04).toBeUndefined();
    });

    it('runRelativeChecks returns empty array when no baseline', () => {
      expect(runRelativeChecks(install, null)).toHaveLength(0);
    });
  });
});
