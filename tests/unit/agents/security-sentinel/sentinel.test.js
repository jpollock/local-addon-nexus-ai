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
    expect(getScanScope(event)).toEqual({ installId: 'wpe-abc123', installName: null });
  });

  it('getScanScope returns null installId for cron (no event)', () => {
    expect(getScanScope(null)).toEqual({ installId: null, installName: null });
  });

  it('getScanScope returns null installId for non-wpe events', () => {
    const event = { namespace: 'wp', type: 'plugin.activated', payload: {} };
    expect(getScanScope(event)).toEqual({ installId: null, installName: null });
  });

  it('getScanScope returns null installId when payload has no siteId', () => {
    const event = { namespace: 'wpe', type: 'sync.completed', payload: {} };
    expect(getScanScope(event)).toEqual({ installId: null, installName: null });
  });

  it('module.exports has required fields', () => {
    expect(agent.description).toBeTruthy();
    expect(Array.isArray(agent.triggers)).toBe(true);
    expect(Array.isArray(agent.tools)).toBe(true);
    expect(typeof agent.run).toBe('function');
    expect(agent._test).toBeTruthy();
  });

  describe('collectFleetData protectedEmails', () => {
    it('uses graph.db admin_email for WPE installs (no live portal lookup)', async () => {
      const { collectFleetData } = agent._test;
      // fleet_sql returns one WPE install; protectedEmails should come from admin_email only
      const tools = {
        invoke: jest.fn().mockImplementation(async (name, args) => {
          if (name === 'fleet_sql' && (args.query || '').includes('FROM sites')) {
            return '| id | name | source | environment | ssh_last_sync_at | post_count | user_count | settings_json | wp_version | php_version | admin_email | account_id |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| s1 | mysite | wpe | production | 123 | 10 | 1 | {} | 6.5 | 8.2 | wp@mysite.com | acct1 |';
          }
          if (name === 'fleet_sql') return ''; // plugins/users queries
          return '[]';
        }),
      };
      const log = { info: jest.fn(), warn: jest.fn() };
      const installs = await collectFleetData(tools, null, null, log);
      expect(installs[0].protectedEmails).toContain('wp@mysite.com');
      expect(tools.invoke).not.toHaveBeenCalledWith('wpe_get_accounts', expect.anything());
      expect(tools.invoke).not.toHaveBeenCalledWith('wpe_get_account_users', expect.anything());
    });

    it('falls back to admin_email for local installs (no WPE API call)', async () => {
      const { collectFleetData } = agent._test;
      const tools = {
        invoke: jest.fn().mockImplementation(async (name, args) => {
          if (name === 'fleet_sql' && (args.query || '').includes('FROM sites')) {
            return '| id | name | source | environment | ssh_last_sync_at | post_count | user_count | settings_json | wp_version | php_version | admin_email |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| s2 | localsite | local | NULL | NULL | 5 | 1 | {} | 6.5 | 8.2 | admin@local.com |';
          }
          if (name === 'fleet_sql') return '';
          return '[]';
        }),
      };
      const log = { info: jest.fn(), warn: jest.fn() };
      const installs = await collectFleetData(tools, null, null, log);
      expect(installs[0].protectedEmails).toContain('admin@local.com');
      expect(tools.invoke).not.toHaveBeenCalledWith('wpe_get_accounts', expect.anything());
    });
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
      let opStatusCalls = 0;
      return {
        invoke: jest.fn().mockImplementation((name, args) => {
          if (name === 'local_create_site') return Promise.resolve('OK');
          if (name === 'local_wpe_pull') return Promise.resolve(JSON.stringify({ status: 'in_progress' }));
          if (name === 'local_operation_status') {
            opStatusCalls++;
            // First call: "active" (pull in progress), subsequent calls: idle (pull done)
            return opStatusCalls === 1
              ? Promise.resolve(JSON.stringify({ status: 'active', local_status: 'pulling' }))
              : Promise.resolve(JSON.stringify({ site: 'sandbox', operation: null, site_status: 'running' }));
          }
          if (name === 'wp_eval') return Promise.resolve('[]');
          return Promise.resolve('');
        }),
        ...overrides,
      };
    }

    const install = { id: 'wpe-94b2', name: 'theawfulpmtest' };
    const fakeAi = {
      run: jest.fn().mockResolvedValue('CLEAN'),
      generateObject: jest.fn().mockResolvedValue({ verdict: 'high-risk', attackSummary: 'mock', remediationSteps: [], entryPoint: 'unknown', blindSpots: [], attackerItems: [], legitimateItems: [], temporalNarrative: '' }),
    };
    const fakeLog = { info: jest.fn(), warn: jest.fn(), phase: jest.fn(), action: jest.fn(), finding: jest.fn() };

    it('creates a sandbox site with correct naming pattern', async () => {
      const tools = makeTools();
      await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);

      const createCall = tools.invoke.mock.calls.find(c => c[0] === 'local_create_site');
      expect(createCall).toBeDefined();
      expect(createCall[1].name).toMatch(/^sentinel-theawfulpmtest-\d+$/);
    });

    it('pulls from WPE using install.id as remote_install_id with include_database true', async () => {
      const tools = makeTools();
      await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);

      const pullCall = tools.invoke.mock.calls.find(c => c[0] === 'local_wpe_pull');
      expect(pullCall).toBeDefined();
      expect(pullCall[1]).toMatchObject({
        remote_install_id: 'theawfulpmtest',
        include_database: true,
      });
    });

    it('sandbox name matches the site used in local_wpe_pull', async () => {
      const tools = makeTools();
      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);

      const pullCall = tools.invoke.mock.calls.find(c => c[0] === 'local_wpe_pull');
      expect(pullCall[1].site).toBe(result.sandbox);
    });

    it('runs wp_eval checks in the sandbox (not the live site)', async () => {
      const tools = makeTools();
      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);

      const evalCalls = tools.invoke.mock.calls.filter(c => c[0] === 'wp_eval');
      expect(evalCalls.length).toBeGreaterThan(0);
      for (const call of evalCalls) {
        expect(call[1].site).toBe(result.sandbox);
      }
    });

    it('returns a valid remediation plan when wp_eval returns empty arrays', async () => {
      const tools = makeTools();
      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);

      expect(result).toBeDefined();
      expect(result.sandbox).toMatch(/^sentinel-theawfulpmtest-\d+$/);
      expect(result.steps).toBeDefined();
    });

    it('FS-01: flags unexpected PHP file in mu-plugins/ (adds webshell removal step)', async () => {
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

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);
      expect(result).toBeDefined();
      expect(result.steps.some(s => s.label.includes('webshell') || s.label.includes('mu-plugins'))).toBe(true);
    });

    it('FS-02: wp_eval is invoked to check for obfuscated code in plugin files', async () => {
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

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);
      expect(result).toBeDefined();
      const evalCalls = tools.invoke.mock.calls.filter(c => c[0] === 'wp_eval' && c[1].code.includes('eval'));
      expect(evalCalls.length).toBeGreaterThan(0);
    });

    it('FS-04: wp_eval is invoked to check for PHP files in uploads/', async () => {
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

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);
      expect(result).toBeDefined();
      const uploadsCalls = tools.invoke.mock.calls.filter(c => c[0] === 'wp_eval' && c[1].code.includes('wp_upload_dir'));
      expect(uploadsCalls.length).toBeGreaterThan(0);
    });

    it('FS-MISMATCH: wp_eval checks admin count divergence between DB and WordPress API', async () => {
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

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);
      expect(result).toBeDefined();
      const adminCalls = tools.invoke.mock.calls.filter(c => c[0] === 'wp_eval' && c[1].code.includes('wp_capabilities'));
      expect(adminCalls.length).toBeGreaterThan(0);
    });

    it('FS-MISMATCH: does not crash when DB count equals WordPress API count', async () => {
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

      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);
      expect(result).toBeDefined();
      // Step 1 (webshell removal) only fires when FS-01 is detected — should be absent here
      expect(result.steps.some(s => s.label === 'Remove mu-plugins webshell(s)')).toBe(false);
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

      await expect(tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0)).resolves.toBeDefined();
    });

    it('returns sandbox name in the result', async () => {
      const tools = makeTools();
      const result = await tier2Investigate(install, [], tools, fakeAi, fakeLog, { get: () => null, set: () => {} }, 0);

      expect(result.sandbox).toMatch(/^sentinel-theawfulpmtest-\d+$/);
    });
  });

  describe('llmSynthesis', () => {
    const { llmSynthesis } = require('../../../../agents/security-sentinel/agent')._test;

    const install = { id: 'wpe-1', name: 'testsite', postCount: 16, environment: 'production', adminUsers: [] };
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), phase: jest.fn(), action: jest.fn() };
    const tools = { invoke: jest.fn().mockResolvedValue('') };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('calls ai.generateObject with all signals and site metadata', async () => {
      const fakeAi = { generateObject: jest.fn().mockResolvedValue({ classification: 'active-compromise', summary: 'backdoor detected', escalateToTier3: true }) };
      await llmSynthesis(install, [{ id: 'ABS-05', title: 'wp-compat found' }], [], tools, fakeAi, log, 'sentinel-testsite-123');

      expect(fakeAi.generateObject).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('wp-compat found') }));
      expect(fakeAi.generateObject).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('testsite') }));
    });

    it('includes sandboxName in the system prompt', async () => {
      const fakeAi = { generateObject: jest.fn().mockResolvedValue({ classification: 'false-positive', summary: 'clean', escalateToTier3: false }) };
      await llmSynthesis(install, [], [], tools, fakeAi, log, 'sentinel-testsite-999');

      expect(fakeAi.generateObject).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('sentinel-testsite-999') }));
    });

    it('includes site environment and postCount in the system prompt', async () => {
      const fakeAi = { generateObject: jest.fn().mockResolvedValue({ classification: 'false-positive', summary: 'clean', escalateToTier3: false }) };
      await llmSynthesis(install, [], [], tools, fakeAi, log, 'sentinel-testsite-123');

      expect(fakeAi.generateObject).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('production') }));
      expect(fakeAi.generateObject).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('16') }));
    });

    it('escalates to Tier 3 when escalateToTier3 is true', async () => {
      const fakeAi = { generateObject: jest.fn().mockResolvedValue({ classification: 'high-risk', summary: 'escalate', escalateToTier3: true }) };
      const fakeTools = { invoke: jest.fn().mockResolvedValue('') };
      await llmSynthesis(install, [], [], fakeTools, fakeAi, log, 'sentinel-testsite-123');

      const evalCalls = fakeTools.invoke.mock.calls.filter(c => c[0] === 'wp_eval');
      expect(evalCalls.length).toBeGreaterThan(0);
    });

    it('escalates to Tier 3 when any signal has critical severity', async () => {
      const fakeAi = { generateObject: jest.fn().mockResolvedValue({ classification: 'high-risk', summary: 'risky', escalateToTier3: false }) };
      const fakeTools = { invoke: jest.fn().mockResolvedValue('') };
      const criticalSignal = { id: 'ABS-05', severity: 'critical', title: 'Backdoor found', detail: 'wp-compat detected' };

      await llmSynthesis(install, [criticalSignal], [], fakeTools, fakeAi, log, 'sentinel-testsite-123');

      const evalCalls = fakeTools.invoke.mock.calls.filter(c => c[0] === 'wp_eval');
      expect(evalCalls.length).toBeGreaterThan(0);
    });

    it('does not escalate to Tier 3 when escalateToTier3 is false and no critical signals', async () => {
      const fakeAi = { generateObject: jest.fn().mockResolvedValue({ classification: 'misconfiguration', summary: 'config issue', escalateToTier3: false }) };
      const fakeTools = { invoke: jest.fn().mockResolvedValue('') };
      const medSignal = { id: 'EXP-03', severity: 'medium', title: 'File editor enabled', detail: 'DISALLOW_FILE_EDIT not set' };

      await llmSynthesis(install, [medSignal], [], fakeTools, fakeAi, log, 'sentinel-testsite-123');

      const evalCalls = fakeTools.invoke.mock.calls.filter(c => c[0] === 'wp_eval');
      expect(evalCalls.length).toBe(0);
    });

    it('logs the synthesis result', async () => {
      const fakeAi = { generateObject: jest.fn().mockResolvedValue({ classification: 'false-positive', summary: 'no issues found', escalateToTier3: false }) };
      const fakeLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), phase: jest.fn(), action: jest.fn() };
      await llmSynthesis(install, [], [], tools, fakeAi, fakeLog, 'sentinel-testsite-123');

      expect(fakeLog.warn).toHaveBeenCalledWith(expect.stringContaining('[Tier 2 Synthesis]'));
    });

    it('combines tier1 and fs signals in the prompt', async () => {
      const fakeAi = { generateObject: jest.fn().mockResolvedValue({ classification: 'false-positive', summary: 'clean', escalateToTier3: false }) };
      const tier1 = [{ id: 'ABS-01', severity: 'high', title: 'admin username', detail: 'Found admin' }];
      const fsSignals = [{ id: 'FS-01', severity: 'critical', title: 'PHP in mu-plugins', detail: 'evil.php' }];

      await llmSynthesis(install, tier1, fsSignals, tools, fakeAi, log, 'sentinel-testsite-123');

      expect(fakeAi.generateObject).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('ABS-01') }));
      expect(fakeAi.generateObject).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('FS-01') }));
    });
  });

  describe('tier3Remediate', () => {
    const { tier3Remediate } = require('../../../../agents/security-sentinel/agent')._test;

    const install = { id: 'wpe-1', name: 'testsite', environment: 'production' };
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), phase: jest.fn(), action: jest.fn() };

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

    it('logs remediation step results with tier3 prefix', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('') };

      await tier3Remediate(install, 'CLASSIFICATION: high-risk', [], 'sandbox-abc', tools, log);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[Tier 3]'));
    });

    it('does not call local_wpe_push (requires human confirmation)', async () => {
      const tools = { invoke: jest.fn().mockResolvedValue('') };

      await tier3Remediate(install, 'CLASSIFICATION: active-compromise', [], 'sandbox-abc', tools, log);

      const pushCall = tools.invoke.mock.calls.find(c => c[0] === 'local_wpe_push');
      expect(pushCall).toBeUndefined();
    });

    it('handles wp_eval errors gracefully — each step wrapped in try/catch', async () => {
      const tools = { invoke: jest.fn().mockRejectedValue(new Error('wp_eval failed')) };

      const result = await tier3Remediate(install, 'CLASSIFICATION: high-risk', [], 'sandbox-abc', tools, log);
      expect(result).toBeDefined();
      expect(result.verdict).toBe('blocked');
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

    it('always includes steps 4, 6, 7, 8 (step 5 checksums deferred — not in checklist)', () => {
      const checklist = buildRemediationChecklist({}, [], 'sandbox');
      const steps = checklist.map(s => s.step);
      expect(steps).toContain(4);
      expect(steps).not.toContain(5); // Step 5 deferred: wp core verify-checksums runs via SSH, not wp_eval
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

  describe('runContentExamination', () => {
    const makeSignal = (id, evidence) => ({
      id, severity: 'critical', category: 'active-compromise',
      installName: 'test-site', title: 'test', detail: '', fix: '', evidence,
    });

    it('enriches FS-03 evidence with dangerous functions found', async () => {
      const { runContentExamination } = agent._test;
      const signal = makeSignal('FS-03', ['goods.php (unknown PHP in web root)']);
      const mockResult = JSON.stringify({
        'goods.php': {
          preview: '<?php eval(base64_decode("abc")); system($_GET["cmd"]);',
          functions: ['eval', 'base64_decode', 'system'],
          ips: ['1.2.3.4'],
          urls: ['http://evil.com/payload'],
          md5: 'abc123',
          size: 52,
        },
      });
      const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runContentExamination([signal], 'sandbox-abc', tools, log);

      expect(signal.evidence.some(e => e.includes('eval'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('1.2.3.4'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('evil.com'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('preview'))).toBe(true);
    });

    it('skips signals that are not FS-01/FS-03/ABS-09', async () => {
      const { runContentExamination } = agent._test;
      const signal = makeSignal('FS-02', ['some/file.php — pattern: /eval/']);
      const tools = { invoke: jest.fn() };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runContentExamination([signal], 'sandbox-abc', tools, log);

      expect(tools.invoke).not.toHaveBeenCalled();
    });

    it('does not throw when tools.invoke rejects', async () => {
      const { runContentExamination } = agent._test;
      const signal = makeSignal('FS-03', ['goods.php (unknown PHP in web root)']);
      const tools = { invoke: jest.fn().mockRejectedValue(new Error('wp_eval failed')) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await expect(runContentExamination([signal], 'sandbox-abc', tools, log))
        .resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Content examination failed'));
    });
  });

  describe('runObfuscationDecoder', () => {
    it('decodes base64 payloads from FS-02 evidence and appends to evidence', async () => {
      const { runObfuscationDecoder } = agent._test;
      const encodedPayload = Buffer.from('<?php system($_GET["cmd"]); ?>').toString('base64');
      const signal = {
        id: 'FS-02', severity: 'critical', category: 'active-compromise',
        installName: 'test', title: 'test', detail: '', fix: '',
        evidence: [`wp-content/plugins/noted/bad.php — pattern: /base64_decode/`],
      };
      const mockResult = JSON.stringify({
        'wp-content/plugins/noted/bad.php': [`<?php system($_GET["cmd"]); ?>`],
      });
      const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runObfuscationDecoder([signal], 'sandbox-abc', tools, log);

      expect(signal.evidence.some(e => e.includes('decoded payload'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('system'))).toBe(true);
    });

    it('no-ops when no FS-02 signal present', async () => {
      const { runObfuscationDecoder } = agent._test;
      const tools = { invoke: jest.fn() };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runObfuscationDecoder([], 'sandbox-abc', tools, log);
      expect(tools.invoke).not.toHaveBeenCalled();
    });

    it('does not throw when tools.invoke rejects', async () => {
      const { runObfuscationDecoder } = agent._test;
      const signal = {
        id: 'FS-02', severity: 'critical', category: 'active-compromise',
        installName: 'test', title: 'test', detail: '', fix: '',
        evidence: ['some/file.php — pattern: /base64_decode/'],
      };
      const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await expect(runObfuscationDecoder([signal], 'sandbox-abc', tools, log))
        .resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Obfuscation decoder failed'));
    });
  });

  describe('runCoreDiff', () => {
    it('appends injected lines to CHK-01 evidence', async () => {
      const { runCoreDiff } = agent._test;
      const signal = {
        id: 'CHK-01', severity: 'critical', category: 'active-compromise',
        installName: 'test', title: 'test', detail: '', fix: '',
        evidence: ["Error: File doesn't verify against checksum: wp-blog-header.php"],
      };
      const mockResult = JSON.stringify({
        'wp-blog-header.php': { injected: ["<?php eval(base64_decode('INJECTED')); ?>"] },
      });
      const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runCoreDiff([signal], 'sandbox-abc', tools, log);

      expect(signal.evidence.some(e => e.includes('injected lines'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('INJECTED'))).toBe(true);
    });

    it('no-ops when no CHK-01 signal present', async () => {
      const { runCoreDiff } = agent._test;
      const tools = { invoke: jest.fn() };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runCoreDiff([], 'sandbox-abc', tools, log);
      expect(tools.invoke).not.toHaveBeenCalled();
    });

    it('skips wp-content files', async () => {
      const { runCoreDiff } = agent._test;
      const signal = {
        id: 'CHK-01', severity: 'critical', category: 'active-compromise',
        installName: 'test', title: 'test', detail: '', fix: '',
        evidence: ["Error: File doesn't verify against checksum: wp-content/themes/t/style.css"],
      };
      const tools = { invoke: jest.fn().mockResolvedValue('{}') };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runCoreDiff([signal], 'sandbox-abc', tools, log);
      // tools.invoke called but with empty files array → PHP returns {}
      const call = tools.invoke.mock.calls[0];
      expect(call[1].code).toContain('[]'); // empty $files
    });

    it('does not throw when tools.invoke rejects', async () => {
      const { runCoreDiff } = agent._test;
      const signal = {
        id: 'CHK-01', severity: 'critical', category: 'active-compromise',
        installName: 'test', title: 'test', detail: '', fix: '',
        evidence: ["Error: File doesn't verify against checksum: index.php"],
      };
      const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await expect(runCoreDiff([signal], 'sandbox-abc', tools, log)).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Core diff failed'));
    });
  });

  describe('runElfStrings', () => {
    it('appends strings indicators to FS-06 evidence', async () => {
      const { runElfStrings } = agent._test;
      const signal = {
        id: 'FS-06', severity: 'critical', category: 'active-compromise',
        installName: 'test', title: 'test', detail: '', fix: '',
        evidence: ['wp-content/plugins/noted/vendor/top_referrals (2512.2 KB)'],
      };
      const mockResult = JSON.stringify({
        md5: 'abc123def456',
        indicators: ['http://evil.com/c2', '/bin/sh', 'connect'],
        analyzed: 'top_referrals',
      });
      const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runElfStrings([signal], 'sandbox-abc', tools, log);

      expect(signal.evidence.some(e => e.includes('strings analysis'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('evil.com'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('/bin/sh'))).toBe(true);
    });

    it('no-ops when no FS-06 signal present', async () => {
      const { runElfStrings } = agent._test;
      const tools = { invoke: jest.fn() };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runElfStrings([], 'sandbox-abc', tools, log);
      expect(tools.invoke).not.toHaveBeenCalled();
    });

    it('does not throw when tools.invoke rejects', async () => {
      const { runElfStrings } = agent._test;
      const signal = {
        id: 'FS-06', severity: 'critical', category: 'active-compromise',
        installName: 'test', title: 'test', detail: '', fix: '',
        evidence: ['wp-content/plugins/noted/vendor/top_referrals (2512.2 KB)'],
      };
      const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await expect(runElfStrings([signal], 'sandbox-abc', tools, log)).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ELF strings failed'));
    });
  });

  describe('runNetworkIndicators', () => {
    const makeSignal = (id, evidence) => ({
      id, severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '', evidence,
    });

    it('creates FS-07 signal when IPs and URLs found', async () => {
      const { runNetworkIndicators } = agent._test;
      const signals = [makeSignal('FS-03', ['goods.php (unknown PHP in web root)'])];
      const mockResult = JSON.stringify({
        ips: ['185.220.101.5', '45.33.32.156'],
        urls: ['http://evil.com/payload.php', 'https://c2.attacker.net/gate.php'],
      });
      const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runNetworkIndicators(signals, 'test-site', 'sandbox-abc', tools, log);

      const fs07 = signals.find(s => s.id === 'FS-07');
      expect(fs07).toBeDefined();
      expect(fs07.severity).toBe('critical');
      expect(fs07.evidence.some(e => e.includes('185.220.101.5'))).toBe(true);
      expect(fs07.evidence.some(e => e.includes('evil.com'))).toBe(true);
    });

    it('does not create FS-07 when no indicators found', async () => {
      const { runNetworkIndicators } = agent._test;
      const signals = [makeSignal('FS-03', ['goods.php (unknown PHP in web root)'])];
      const mockResult = JSON.stringify({ ips: [], urls: [] });
      const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runNetworkIndicators(signals, 'test-site', 'sandbox-abc', tools, log);

      expect(signals.find(s => s.id === 'FS-07')).toBeUndefined();
    });

    it('does not throw when tools.invoke rejects', async () => {
      const { runNetworkIndicators } = agent._test;
      const signals = [makeSignal('FS-03', ['goods.php (unknown PHP in web root)'])];
      const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await expect(runNetworkIndicators(signals, 'test-site', 'sandbox-abc', tools, log))
        .resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Network indicator scan failed'));
    });
  });

  describe('runRootFileAnalysis', () => {
    const makeFs03 = (evidence) => ({
      id: 'FS-03', severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '', evidence,
    });

    it('classifies a webshell and appends analysis to FS-03 evidence', async () => {
      const { runRootFileAnalysis } = agent._test;
      const signal = makeFs03(['goods.php (unknown PHP in web root)']);
      const content = '<?php eval($_POST["cmd"]); ?>';
      const mockResult = JSON.stringify({
        'goods.php': { content, size: content.length, category: 'webshell', iocs: [] },
      });
      const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runRootFileAnalysis([signal], 'sandbox-abc', tools, log);

      expect(signal.evidence.some(e => e.includes('webshell'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('goods.php'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('eval($_POST'))).toBe(true);
    });

    it('no-ops when no FS-03 signal present', async () => {
      const { runRootFileAnalysis } = agent._test;
      const tools = { invoke: jest.fn() };
      const log = { info: jest.fn(), warn: jest.fn() };
      await runRootFileAnalysis([], 'sandbox-abc', tools, log);
      expect(tools.invoke).not.toHaveBeenCalled();
    });

    it('decodes a base64/gzinflate obfuscated payload', async () => {
      const { runRootFileAnalysis } = agent._test;
      const signal = makeFs03(['shop.php (unknown PHP in web root)']);
      const decoded = '<?php system($_GET["c"]); ?>';
      const mockResult = JSON.stringify({
        'shop.php': { content: '<?php eval(base64_decode("xyz")); ?>', size: 40, category: 'obfuscated-dropper', iocs: [], decodedPayload: decoded },
      });
      const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
      const log = { info: jest.fn(), warn: jest.fn() };

      await runRootFileAnalysis([signal], 'sandbox-abc', tools, log);
      expect(signal.evidence.some(e => e.includes('obfuscated-dropper'))).toBe(true);
      expect(signal.evidence.some(e => e.includes('system($_GET'))).toBe(true);
    });

    it('does not throw when tools.invoke rejects', async () => {
      const { runRootFileAnalysis } = agent._test;
      const signal = makeFs03(['goods.php (unknown PHP in web root)']);
      const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
      const log = { info: jest.fn(), warn: jest.fn() };
      await expect(runRootFileAnalysis([signal], 'sandbox-abc', tools, log)).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Root file analysis failed'));
    });
  });

  describe('ask-mode autonomy', () => {
    it('does not execute checklist when autonomy is ask', async () => {
      const { tier2Investigate } = agent._test;
      const installObj = { id: 's1', name: 'testsite', source: 'local', environment: null,
        postCount: 5, userCount: 1, wpVersion: '6.5', phpVersion: '8.2', plugins: [],
        adminUsers: [], settings: {}, protectedEmails: [], sshLastSyncAt: null };

      let checklistExecuted = false;
      const tools = {
        invoke: jest.fn().mockImplementation(async (name, args) => {
          if (name === 'local_start_site') return 'ok';
          if (name === 'local_clone_site') return '{}';
          if (name === 'local_operation_status') return JSON.stringify({ site_status: 'running', message: 'ok' });
          if (name === 'wp_eval') {
            // Mark if executeChecklist runs (it calls wp_eval with shuffle-salts)
            if ((args.code || '').includes('shuffle-salts')) checklistExecuted = true;
            return '[]';
          }
          return '{}';
        }),
        registerSandbox: jest.fn(),
      };
      const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(),
        phase: jest.fn(), finding: jest.fn(), action: jest.fn(), siteStatus: jest.fn() };
      const state = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {},
        isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() };
      const ai = { run: jest.fn(), generateObject: jest.fn().mockResolvedValue({
        verdict: 'active-compromise', attackSummary: 'test', entryPoint: 'unknown',
        temporalNarrative: '', attackerItems: [], legitimateItems: [],
        blindSpots: [], remediationSteps: [],
      }) };

      const signals = [{ id: 'ABS-05', severity: 'critical', category: 'active-compromise',
        installName: 'testsite', title: 'Known backdoor', detail: '', fix: '', evidence: [] }];

      const plan = await tier2Investigate(installObj, signals, tools, ai, log, state, 0, 'ask');

      expect(checklistExecuted).toBe(false);
      expect(plan).not.toBeNull();
      expect(plan.pendingApproval).toBe(true);
      expect(Array.isArray(plan.checklist)).toBe(true);
      expect(plan.checklist.length).toBeGreaterThan(0);
    });

    it('executes checklist normally when autonomy is auto', async () => {
      const { tier2Investigate } = agent._test;
      const installObj = { id: 's1', name: 'testsite', source: 'local', environment: null,
        postCount: 5, userCount: 1, wpVersion: '6.5', phpVersion: '8.2', plugins: [],
        adminUsers: [], settings: {}, protectedEmails: [], sshLastSyncAt: null };

      let checklistExecuted = false;
      const tools = {
        invoke: jest.fn().mockImplementation(async (name, args) => {
          if (name === 'local_start_site') return 'ok';
          if (name === 'local_clone_site') return '{}';
          if (name === 'local_operation_status') return JSON.stringify({ site_status: 'running', message: 'ok' });
          if (name === 'wp_eval') {
            if ((args.code || '').includes('shuffle-salts')) checklistExecuted = true;
            return '[]';
          }
          return '{}';
        }),
        registerSandbox: jest.fn(),
      };
      const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(),
        phase: jest.fn(), finding: jest.fn(), action: jest.fn(), siteStatus: jest.fn() };
      const state = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {},
        isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() };
      const ai = { run: jest.fn(), generateObject: jest.fn().mockResolvedValue({
        verdict: 'active-compromise', attackSummary: 'test', entryPoint: 'unknown',
        temporalNarrative: '', attackerItems: [], legitimateItems: [],
        blindSpots: [], remediationSteps: [],
      }) };

      const signals = [{ id: 'ABS-05', severity: 'critical', category: 'active-compromise',
        installName: 'testsite', title: 'Known backdoor', detail: '', fix: '', evidence: [] }];

      const plan = await tier2Investigate(installObj, signals, tools, ai, log, state, 0, 'auto');

      expect(checklistExecuted).toBe(true);
      expect(plan?.pendingApproval).toBeFalsy();
    });
  });
});
