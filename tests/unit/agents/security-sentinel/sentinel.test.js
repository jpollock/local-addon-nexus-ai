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
});
