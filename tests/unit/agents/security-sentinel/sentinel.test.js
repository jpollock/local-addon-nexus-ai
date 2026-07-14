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
});
