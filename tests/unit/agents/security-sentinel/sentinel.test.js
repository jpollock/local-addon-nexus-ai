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

  describe('runFleetCorrelation', () => {
    const { runFleetCorrelation } = require('../../../../agents/security-sentinel/agent')._test;

    it('flags same unknown plugin slug across 2+ installs', () => {
      const results = [
        { install: { id: 'wpe-1', name: 'site1', plugins: [{ slug: 'wp-compat', is_active: '1' }], adminUsers: [] }, signals: [] },
        { install: { id: 'wpe-2', name: 'site2', plugins: [{ slug: 'wp-compat', is_active: '1' }], adminUsers: [] }, signals: [] },
      ];
      const signals = runFleetCorrelation(results, new Set(['wp-compat']));
      const fleet01 = signals.find(s => s.id === 'FLEET-01');
      expect(fleet01).toBeDefined();
      expect(fleet01.severity).toBe('critical');
      expect(fleet01.installName).toContain('site1');
      expect(fleet01.installName).toContain('site2');
    });

    it('does not flag common legitimate plugins on multiple installs', () => {
      const results = [
        { install: { id: 'wpe-1', name: 'site1', plugins: [{ slug: 'woocommerce', is_active: '1' }], adminUsers: [] }, signals: [] },
        { install: { id: 'wpe-2', name: 'site2', plugins: [{ slug: 'woocommerce', is_active: '1' }], adminUsers: [] }, signals: [] },
      ];
      expect(runFleetCorrelation(results, new Set())).toHaveLength(0);
    });

    it('flags suspicious slug found in suspiciousSlugsFound set', () => {
      const results = [
        { install: { id: 'wpe-1', name: 'site1', plugins: [{ slug: 'evil-plugin', is_active: '1' }], adminUsers: [] }, signals: [] },
        { install: { id: 'wpe-2', name: 'site2', plugins: [{ slug: 'evil-plugin', is_active: '1' }], adminUsers: [] }, signals: [] },
      ];
      const signals = runFleetCorrelation(results, new Set(['evil-plugin']));
      expect(signals.find(s => s.id === 'FLEET-01')).toBeDefined();
    });

    it('flags new admin accounts with matching email domain across installs', () => {
      const results = [
        { install: { id: 'wpe-1', name: 'site1', plugins: [], adminUsers: [{ username: 'admin1', email: 'attacker@evil.com' }] }, signals: [{ id: 'REL-03' }] },
        { install: { id: 'wpe-2', name: 'site2', plugins: [], adminUsers: [{ username: 'admin2', email: 'attacker2@evil.com' }] }, signals: [{ id: 'REL-03' }] },
      ];
      const signals = runFleetCorrelation(results, new Set());
      const fleet02 = signals.find(s => s.id === 'FLEET-02');
      expect(fleet02).toBeDefined();
      expect(fleet02.severity).toBe('critical');
      expect(fleet02.installName).toContain('site1');
      expect(fleet02.installName).toContain('site2');
    });

    it('does not flag FLEET-02 for installs without REL-03 signals', () => {
      const results = [
        { install: { id: 'wpe-1', name: 'site1', plugins: [], adminUsers: [{ username: 'admin1', email: 'attacker@evil.com' }] }, signals: [] },
        { install: { id: 'wpe-2', name: 'site2', plugins: [], adminUsers: [{ username: 'admin2', email: 'attacker2@evil.com' }] }, signals: [] },
      ];
      const signals = runFleetCorrelation(results, new Set());
      expect(signals.find(s => s.id === 'FLEET-02')).toBeUndefined();
    });

    it('ignores example.com domain in FLEET-02 check', () => {
      const results = [
        { install: { id: 'wpe-1', name: 'site1', plugins: [], adminUsers: [{ username: 'admin1', email: 'admin@example.com' }] }, signals: [{ id: 'REL-03' }] },
        { install: { id: 'wpe-2', name: 'site2', plugins: [], adminUsers: [{ username: 'admin2', email: 'admin@example.com' }] }, signals: [{ id: 'REL-03' }] },
      ];
      const signals = runFleetCorrelation(results, new Set());
      expect(signals.find(s => s.id === 'FLEET-02')).toBeUndefined();
    });

    it('returns empty array when no fleet correlations found', () => {
      const results = [
        { install: { id: 'wpe-1', name: 'site1', plugins: [{ slug: 'woocommerce', is_active: '1' }], adminUsers: [] }, signals: [] },
      ];
      expect(runFleetCorrelation(results, new Set())).toHaveLength(0);
    });
  });

  describe('tier2Investigate', () => {
    const { tier2Investigate } = require('../../../../agents/security-sentinel/agent')._test;

    function makeTools(overrides = {}) {
      return {
        invoke: jest.fn().mockImplementation((name, args) => {
          if (name === 'local_create_site') return Promise.resolve('OK');
          if (name === 'local_wpe_pull') return Promise.resolve('OK');
          if (name === 'wp_eval') return Promise.resolve('[]');
          return Promise.resolve('');
        }),
        ...overrides,
      };
    }

    const install = { id: 'wpe-94b2', name: 'theawfulpmtest' };
    const fakeAi = { run: jest.fn().mockResolvedValue('CLEAN') };
    const fakeLog = { info: jest.fn(), warn: jest.fn() };

    it('creates a sandbox site with correct naming pattern', async () => {
      const tools = makeTools();
      await tier2Investigate(install, [], tools, fakeAi, fakeLog);

      const createCall = tools.invoke.mock.calls.find(c => c[0] === 'local_create_site');
      expect(createCall).toBeDefined();
      expect(createCall[1].name).toMatch(/^sentinel-theawfulpmtest-\d+$/);
    });

    it('pulls from WPE using install.id as remote_install_id with include_database true', async () => {
      const tools = makeTools();
      await tier2Investigate(install, [], tools, fakeAi, fakeLog);

      const pullCall = tools.invoke.mock.calls.find(c => c[0] === 'local_wpe_pull');
      expect(pullCall).toBeDefined();
      expect(pullCall[1]).toMatchObject({
        remote_install_id: 'wpe-94b2',
        include_database: true,
      });
    });

    it('sandbox name matches the site used in local_wpe_pull', async () => {
      const tools = makeTools();
      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);

      const pullCall = tools.invoke.mock.calls.find(c => c[0] === 'local_wpe_pull');
      expect(pullCall[1].site).toBe(result.sandboxName);
    });

    it('runs wp_eval checks in the sandbox (not the live site)', async () => {
      const tools = makeTools();
      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);

      const evalCalls = tools.invoke.mock.calls.filter(c => c[0] === 'wp_eval');
      expect(evalCalls.length).toBeGreaterThan(0);
      for (const call of evalCalls) {
        expect(call[1].site).toBe(result.sandboxName);
      }
    });

    it('returns empty filesystemSignals and adminMismatch=false when wp_eval returns empty arrays', async () => {
      const tools = makeTools();
      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);

      expect(result.filesystemSignals).toEqual([]);
      expect(result.adminMismatch).toBe(false);
    });

    it('FS-01: flags unexpected PHP file in mu-plugins/', async () => {
      const tools = {
        invoke: jest.fn().mockImplementation((name, args) => {
          if (name === 'local_create_site') return Promise.resolve('OK');
          if (name === 'local_wpe_pull') return Promise.resolve('OK');
          if (name === 'wp_eval' && args.code.includes('WPMU_PLUGIN_DIR')) {
            return Promise.resolve(JSON.stringify(['/var/www/html/wp-content/mu-plugins/evil.php']));
          }
          return Promise.resolve('[]');
        }),
      };

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);
      const fs01 = result.filesystemSignals.find(s => s.id === 'FS-01');
      expect(fs01).toBeDefined();
      expect(fs01.severity).toBe('critical');
      expect(fs01.title).toContain('evil.php');
    });

    it('FS-02: flags obfuscated code in plugin files', async () => {
      const tools = {
        invoke: jest.fn().mockImplementation((name, args) => {
          if (name === 'local_create_site') return Promise.resolve('OK');
          if (name === 'local_wpe_pull') return Promise.resolve('OK');
          if (name === 'wp_eval' && args.code.includes('eval')) {
            return Promise.resolve(JSON.stringify(['/var/www/html/wp-content/plugins/bad/bad.php']));
          }
          return Promise.resolve('[]');
        }),
      };

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);
      const fs02 = result.filesystemSignals.find(s => s.id === 'FS-02');
      expect(fs02).toBeDefined();
      expect(fs02.severity).toBe('critical');
    });

    it('FS-04: flags PHP file in uploads/', async () => {
      const tools = {
        invoke: jest.fn().mockImplementation((name, args) => {
          if (name === 'local_create_site') return Promise.resolve('OK');
          if (name === 'local_wpe_pull') return Promise.resolve('OK');
          if (name === 'wp_eval' && args.code.includes('wp_upload_dir')) {
            return Promise.resolve(JSON.stringify(['/var/www/html/wp-content/uploads/shell.php']));
          }
          return Promise.resolve('[]');
        }),
      };

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);
      const fs04 = result.filesystemSignals.find(s => s.id === 'FS-04');
      expect(fs04).toBeDefined();
      expect(fs04.severity).toBe('critical');
      expect(fs04.title).toContain('shell.php');
    });

    it('FS-MISMATCH: flags admin count divergence between DB and WordPress API', async () => {
      const tools = {
        invoke: jest.fn().mockImplementation((name, args) => {
          if (name === 'local_create_site') return Promise.resolve('OK');
          if (name === 'local_wpe_pull') return Promise.resolve('OK');
          if (name === 'wp_eval' && args.code.includes('wp_capabilities')) {
            return Promise.resolve(JSON.stringify({ db: 3, wp: 2 }));
          }
          return Promise.resolve('[]');
        }),
      };

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);
      expect(result.adminMismatch).toBe(true);
      const mismatch = result.filesystemSignals.find(s => s.id === 'FS-MISMATCH');
      expect(mismatch).toBeDefined();
      expect(mismatch.severity).toBe('critical');
      expect(mismatch.detail).toContain('hiding');
    });

    it('FS-MISMATCH: does not flag when DB count equals WordPress API count', async () => {
      const tools = {
        invoke: jest.fn().mockImplementation((name, args) => {
          if (name === 'local_create_site') return Promise.resolve('OK');
          if (name === 'local_wpe_pull') return Promise.resolve('OK');
          if (name === 'wp_eval' && args.code.includes('wp_capabilities')) {
            return Promise.resolve(JSON.stringify({ db: 2, wp: 2 }));
          }
          return Promise.resolve('[]');
        }),
      };

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);
      expect(result.adminMismatch).toBe(false);
      expect(result.filesystemSignals.find(s => s.id === 'FS-MISMATCH')).toBeUndefined();
    });

    it('handles malformed wp_eval JSON gracefully (no throw)', async () => {
      const tools = {
        invoke: jest.fn().mockImplementation((name) => {
          if (name === 'local_create_site') return Promise.resolve('OK');
          if (name === 'local_wpe_pull') return Promise.resolve('OK');
          if (name === 'wp_eval') return Promise.resolve('NOT_JSON_{{');
          return Promise.resolve('');
        }),
      };

      await expect(tier2Investigate(install, [], tools, fakeAi, fakeLog)).resolves.toBeDefined();
    });

    it('returns sandboxName in the result', async () => {
      const tools = makeTools();
      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog);

      expect(result.sandboxName).toMatch(/^sentinel-theawfulpmtest-\d+$/);
    });
  });

  describe('llmSynthesis', () => {
    const { llmSynthesis } = require('../../../../agents/security-sentinel/agent')._test;

    const install = { id: 'wpe-1', name: 'testsite', postCount: 16, environment: 'production', adminUsers: [] };
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const tools = { invoke: jest.fn().mockResolvedValue('') };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('calls ai.run with all signals and site metadata', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: active-compromise\nREMEDIATION: delete wp-compat') };
      await llmSynthesis(install, [{ id: 'ABS-05', title: 'wp-compat found' }], [], tools, fakeAi, log, 'sentinel-testsite-123');

      expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('wp-compat found'));
      expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('testsite'));
    });

    it('includes sandboxName in the prompt', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: false-positive\nTIER3: no') };
      await llmSynthesis(install, [], [], tools, fakeAi, log, 'sentinel-testsite-999');

      expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('sentinel-testsite-999'));
    });

    it('includes site environment and postCount in the prompt', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: false-positive\nTIER3: no') };
      await llmSynthesis(install, [], [], tools, fakeAi, log, 'sentinel-testsite-123');

      expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('production'));
      expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('16'));
    });

    it('escalates to Tier 3 when synthesis includes TIER3: yes', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: high-risk\nTIER3: yes') };
      const fakeTools = { invoke: jest.fn().mockResolvedValue('') };
      await llmSynthesis(install, [], [], fakeTools, fakeAi, log, 'sentinel-testsite-123');

      const evalCalls = fakeTools.invoke.mock.calls.filter(c => c[0] === 'wp_eval');
      expect(evalCalls.length).toBeGreaterThan(0);
    });

    it('escalates to Tier 3 when any signal has critical severity', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: high-risk\nTIER3: no') };
      const fakeTools = { invoke: jest.fn().mockResolvedValue('') };
      const criticalSignal = { id: 'ABS-05', severity: 'critical', title: 'Backdoor found', detail: 'wp-compat detected' };

      await llmSynthesis(install, [criticalSignal], [], fakeTools, fakeAi, log, 'sentinel-testsite-123');

      const evalCalls = fakeTools.invoke.mock.calls.filter(c => c[0] === 'wp_eval');
      expect(evalCalls.length).toBeGreaterThan(0);
    });

    it('does not escalate to Tier 3 when TIER3: no and no critical signals', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: misconfiguration\nTIER3: no') };
      const fakeTools = { invoke: jest.fn().mockResolvedValue('') };
      const medSignal = { id: 'EXP-03', severity: 'medium', title: 'File editor enabled', detail: 'DISALLOW_FILE_EDIT not set' };

      await llmSynthesis(install, [medSignal], [], fakeTools, fakeAi, log, 'sentinel-testsite-123');

      const evalCalls = fakeTools.invoke.mock.calls.filter(c => c[0] === 'wp_eval');
      expect(evalCalls.length).toBe(0);
    });

    it('logs the synthesis result', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: false-positive\nTIER3: no') };
      const fakeLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      await llmSynthesis(install, [], [], tools, fakeAi, fakeLog, 'sentinel-testsite-123');

      expect(fakeLog.warn).toHaveBeenCalledWith(expect.stringContaining('[Tier 2 Synthesis]'));
    });

    it('combines tier1 and fs signals in the prompt', async () => {
      const fakeAi = { run: jest.fn().mockResolvedValue('CLASSIFICATION: false-positive\nTIER3: no') };
      const tier1 = [{ id: 'ABS-01', severity: 'high', title: 'admin username', detail: 'Found admin' }];
      const fsSignals = [{ id: 'FS-01', severity: 'critical', title: 'PHP in mu-plugins', detail: 'evil.php' }];

      await llmSynthesis(install, tier1, fsSignals, tools, fakeAi, log, 'sentinel-testsite-123');

      expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('ABS-01'));
      expect(fakeAi.run).toHaveBeenCalledWith(expect.stringContaining('FS-01'));
    });
  });

  describe('tier3Remediate', () => {
    const { tier3Remediate } = require('../../../../agents/security-sentinel/agent')._test;

    const install = { id: 'wpe-1', name: 'testsite', environment: 'production' };
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('removes plugins from ABS-05 signals via wp_eval (delete, not quarantine)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('[]') };
      const signal = { id: 'ABS-05', severity: 'critical', title: 'Known backdoor plugin detected: wp-compat', detail: 'backdoor' };

      await tier3Remediate(install, 'CLASSIFICATION: active-compromise', [signal], 'sandbox-abc', tools, log);

      // Step 3: plugin removal — code contains slug and rmdir/unlink (not quarantine)
      const removeCall = tools.invoke.mock.calls.find(
        c => c[0] === 'wp_eval' && c[1].code.includes('wp-compat') && c[1].code.includes('rmdir')
      );
      expect(removeCall).toBeDefined();
      expect(removeCall[1].site).toBe('sandbox-abc');
      expect(removeCall[1].code).not.toContain('quarantine');
    });

    it('always attempts to remove hardcoded attacker plugin slugs (step 3 always runs)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('[]') };
      // Even with a non-plugin signal, step 3 still runs with the hardcoded list
      const signal = { id: 'EXP-03', severity: 'medium', title: 'File editor enabled', detail: 'no DISALLOW_FILE_EDIT' };

      await tier3Remediate(install, 'CLASSIFICATION: misconfiguration', [signal], 'sandbox-abc', tools, log);

      const removeCall = tools.invoke.mock.calls.find(
        c => c[0] === 'wp_eval' && c[1].code.includes('fileorganizer') && c[1].code.includes('rmdir')
      );
      expect(removeCall).toBeDefined();
    });

    it('includes signal-derived slugs alongside the hardcoded list (ABS-04)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('[]') };
      const signal = { id: 'ABS-04', severity: 'high', title: 'File manager plugin(s) active: fileorganizer', detail: 'file manager' };

      await tier3Remediate(install, 'CLASSIFICATION: high-risk', [signal], 'sandbox-abc', tools, log);

      const removeCall = tools.invoke.mock.calls.find(
        c => c[0] === 'wp_eval' && c[1].code.includes('fileorganizer') && c[1].code.includes('rmdir')
      );
      expect(removeCall).toBeDefined();
    });

    it('invokes wp_eval to attempt automated deletion of suspicious admin accounts (REL-03)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('{"deleted":["hacker"],"remaining":1}') };
      const signal = { id: 'REL-03', severity: 'critical', title: 'New admin: hacker', detail: 'hacker account' };

      await tier3Remediate(install, 'CLASSIFICATION: active-compromise', [signal], 'sandbox-abc', tools, log);

      // Step 2 should fire (admin-related signal) with delete logic
      const adminCall = tools.invoke.mock.calls.find(
        c => c[0] === 'wp_eval' && c[1].code.includes('capabilities') && c[1].code.includes('delete')
      );
      expect(adminCall).toBeDefined();
      expect(adminCall[1].site).toBe('sandbox-abc');
    });

    it('invokes wp_eval to attempt automated deletion of suspicious admin accounts (ABS-03)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('{"deleted":[],"remaining":1}') };
      const signal = { id: 'ABS-03', severity: 'critical', title: 'Admin with example.com email', detail: 'example.com' };

      await tier3Remediate(install, 'CLASSIFICATION: active-compromise', [signal], 'sandbox-abc', tools, log);

      const adminCall = tools.invoke.mock.calls.find(
        c => c[0] === 'wp_eval' && c[1].code.includes('capabilities') && c[1].code.includes('delete')
      );
      expect(adminCall).toBeDefined();
    });

    it('invokes wp_eval to shuffle salts (step 6)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('') };

      await tier3Remediate(install, 'CLASSIFICATION: high-risk', [], 'sandbox-abc', tools, log);

      const saltCall = tools.invoke.mock.calls.find(
        c => c[0] === 'wp_eval' && c[1].code.includes('shuffle-salts')
      );
      expect(saltCall).toBeDefined();
      expect(saltCall[1].site).toBe('sandbox-abc');
    });

    it('invokes wp_eval to add DISALLOW_FILE_EDIT to wp-config.php (step 7)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('') };

      await tier3Remediate(install, 'CLASSIFICATION: high-risk', [], 'sandbox-abc', tools, log);

      const hardenCall = tools.invoke.mock.calls.find(
        c => c[0] === 'wp_eval' && c[1].code.includes('DISALLOW_FILE_EDIT')
      );
      expect(hardenCall).toBeDefined();
      expect(hardenCall[1].site).toBe('sandbox-abc');
    });

    it('logs MANUAL STEP REQUIRED with sandbox name in all cases', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('') };

      await tier3Remediate(install, 'CLASSIFICATION: high-risk', [], 'sandbox-abc', tools, log);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('sandbox-abc'));
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('MANUAL STEP REQUIRED'));
    });

    it('does not call local_wpe_push (requires human confirmation)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('') };

      await tier3Remediate(install, 'CLASSIFICATION: active-compromise', [], 'sandbox-abc', tools, log);

      const pushCall = tools.invoke.mock.calls.find(c => c[0] === 'local_wpe_push');
      expect(pushCall).toBeUndefined();
    });

    it('handles wp_eval errors gracefully — each step wrapped in try/catch', async () => {
      const tools = { invoke: jest.fn().mockRejectedValue(new Error('wp_eval failed')) };

      await expect(
        tier3Remediate(install, 'CLASSIFICATION: high-risk', [], 'sandbox-abc', tools, log)
      ).resolves.toBeUndefined();
    });
  });

  describe('buildRemediationChecklist', () => {
    const { buildRemediationChecklist } = require('../../../../agents/security-sentinel/agent')._test;

    it('includes step 1 only when FS-01 signal is present', () => {
      const withFs01 = [{ id: 'FS-01', severity: 'critical', title: 'webshell' }];
      const withoutFs01 = [{ id: 'ABS-05', severity: 'critical', title: 'wp-compat' }];

      const hasStep1 = (signals) => buildRemediationChecklist({}, signals, 'sandbox').some(s => s.step === 1);
      expect(hasStep1(withFs01)).toBe(true);
      expect(hasStep1(withoutFs01)).toBe(false);
    });

    it('includes step 2 when admin-related signals present (REL-03, ABS-03, LLM-USER-01, ABS-01, ABS-02)', () => {
      const ids = ['REL-03', 'ABS-03', 'LLM-USER-01', 'ABS-01', 'ABS-02'];
      for (const id of ids) {
        const checklist = buildRemediationChecklist({}, [{ id, severity: 'critical', title: id }], 'sandbox');
        expect(checklist.some(s => s.step === 2)).toBe(true);
      }
    });

    it('does not include step 2 when no admin signals', () => {
      const signals = [{ id: 'EXP-03', severity: 'medium', title: 'file editor' }];
      const checklist = buildRemediationChecklist({}, signals, 'sandbox');
      expect(checklist.some(s => s.step === 2)).toBe(false);
    });

    it('always includes step 3 (plugin removal) regardless of signals', () => {
      const checklist = buildRemediationChecklist({}, [], 'sandbox');
      expect(checklist.some(s => s.step === 3)).toBe(true);
    });

    it('step 3 includes hardcoded attacker slugs', () => {
      const checklist = buildRemediationChecklist({}, [], 'sandbox');
      const step3 = checklist.find(s => s.step === 3);
      expect(step3.toolArgs.code).toContain('wp-compat');
      expect(step3.toolArgs.code).toContain('fileorganizer');
    });

    it('step 3 adds signal-derived slugs to the removal list', () => {
      const signals = [{ id: 'ABS-05', severity: 'critical', title: 'Known backdoor plugin detected: evil-custom-slug' }];
      const checklist = buildRemediationChecklist({}, signals, 'sandbox');
      const step3 = checklist.find(s => s.step === 3);
      expect(step3.toolArgs.code).toContain('evil-custom-slug');
    });

    it('always includes steps 4–8', () => {
      const checklist = buildRemediationChecklist({}, [], 'sandbox');
      const steps = checklist.map(s => s.step);
      expect(steps).toContain(4);
      expect(steps).toContain(5);
      expect(steps).toContain(6);
      expect(steps).toContain(7);
      expect(steps).toContain(8);
    });

    it('sets sandboxName as site in all toolArgs', () => {
      const checklist = buildRemediationChecklist({}, [], 'sentinel-mysite-12345');
      for (const item of checklist) {
        expect(item.toolArgs.site).toBe('sentinel-mysite-12345');
      }
    });

    it('step 6 includes shuffle-salts', () => {
      const checklist = buildRemediationChecklist({}, [], 'sandbox');
      const step6 = checklist.find(s => s.step === 6);
      expect(step6.toolArgs.code).toContain('shuffle-salts');
    });

    it('step 7 includes DISALLOW_FILE_EDIT and verifyContains "true"', () => {
      const checklist = buildRemediationChecklist({}, [], 'sandbox');
      const step7 = checklist.find(s => s.step === 7);
      expect(step7.toolArgs.code).toContain('DISALLOW_FILE_EDIT');
      expect(step7.verifyContains).toBe('true');
    });
  });
});
