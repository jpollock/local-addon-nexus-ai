// tests/unit/agents/security-sentinel/scan-scope.test.js
'use strict';

// Scheduled scanning is opt-in per site.
//
// The cron trigger carries no event, so nothing in the trigger narrows the scope. Before this,
// an unscoped sweep took whatever was in graph.db — 375 sites nobody had chosen. The failure
// mode being defended against is NOT "too slow"; it is a permissive default. `getAgentSetting`'s
// `?? true` fallback is what had this agent sweeping the fleet every 15 minutes for weeks with
// nothing configured, and `scanScope ?? { mode: 'all' }` would be the identical bug renamed.
//
// So: absent, malformed, or empty configuration scans NOTHING, and says so.

const agent = require('../../../../agents/security-sentinel/agent');
const { resolveScanScope } = agent._test;

const mkLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('Absence never means "scan everything"', () => {
  it.each([
    ['undefined settings', undefined],
    ['null settings', null],
    ['empty settings', {}],
    ['settings with no scanScope', { autonomy: 'ask', enabled: true }],
    ['scanScope null', { scanScope: null }],
    ['scanScope not an object', { scanScope: 'all' }],
  ])('%s resolves to explicit-and-empty', (_label, settings) => {
    const scope = resolveScanScope(settings, mkLog());
    expect(scope.mode).toBe('explicit');
    expect(scope.siteIds.size).toBe(0);
  });

  it('the string "all" in the wrong place does NOT enable everything', () => {
    // scanScope: 'all' is a plausible mistake. It must not be read as mode 'all'.
    const scope = resolveScanScope({ scanScope: 'all' }, mkLog());
    expect(scope.mode).toBe('explicit');
    expect(scope.siteIds.size).toBe(0);
  });

  it('an unrecognised mode falls back to explicit and warns', () => {
    const log = mkLog();
    const scope = resolveScanScope({ scanScope: { mode: 'everything', siteIds: ['a'] } }, log);
    expect(scope.mode).toBe('explicit');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('unrecognised scanScope.mode'));
  });
});

describe('Explicit mode carries exactly what was chosen', () => {
  it('keeps the selected ids', () => {
    const scope = resolveScanScope({ scanScope: { mode: 'explicit', siteIds: ['a', 'b'] } }, mkLog());
    expect(scope.mode).toBe('explicit');
    expect([...scope.siteIds].sort()).toEqual(['a', 'b']);
  });

  it('mode may be omitted when siteIds are present', () => {
    const scope = resolveScanScope({ scanScope: { siteIds: ['only-this'] } }, mkLog());
    expect(scope.mode).toBe('explicit');
    expect([...scope.siteIds]).toEqual(['only-this']);
  });

  it('discards non-string and empty ids rather than matching everything', () => {
    const scope = resolveScanScope(
      { scanScope: { mode: 'explicit', siteIds: ['ok', '', null, 42, undefined, {}] } }, mkLog());
    expect([...scope.siteIds]).toEqual(['ok']);
  });

  it('siteIds not an array yields an empty set, not a crash', () => {
    const scope = resolveScanScope({ scanScope: { mode: 'explicit', siteIds: 'a,b' } }, mkLog());
    expect(scope.siteIds.size).toBe(0);
  });
});

describe('"all" must be chosen deliberately', () => {
  it('mode "all" opts into the whole fleet', () => {
    const scope = resolveScanScope({ scanScope: { mode: 'all' } }, mkLog());
    expect(scope.mode).toBe('all');
    expect(scope.siteIds).toBeNull();   // null = no filter, distinct from an empty set
  });

  it('"all" is distinguishable from explicit-and-empty', () => {
    // The two must never collapse: one scans everything, the other scans nothing.
    const all = resolveScanScope({ scanScope: { mode: 'all' } }, mkLog());
    const none = resolveScanScope({}, mkLog());
    expect(all.mode).not.toBe(none.mode);
    expect(all.siteIds).toBeNull();
    expect(none.siteIds.size).toBe(0);
  });

  it('"all" ignores any stale siteIds left over from explicit mode', () => {
    const scope = resolveScanScope({ scanScope: { mode: 'all', siteIds: ['x'] } }, mkLog());
    expect(scope.siteIds).toBeNull();
  });
});

describe('The default the UI writes matches what the agent enforces', () => {
  // Two independent implementations of the same rule — AgentStore.getDefaultSettings in the
  // renderer, resolveScanScope in the agent. If they disagree, the UI shows one thing and the
  // scheduler does another.
  const fs = require('fs');
  const path = require('path');

  it('AgentStore defaults to explicit with an empty list', () => {
    const store = fs.readFileSync(
      path.join(__dirname, '../../../../src/renderer/components/agents/AgentStore.ts'), 'utf8');
    expect(store).toMatch(/scanScope:\s*\{\s*mode:\s*'explicit',\s*siteIds:\s*\[\]\s*\}/);
  });

  it('and the agent resolves that same value to "scan nothing"', () => {
    const scope = resolveScanScope({ scanScope: { mode: 'explicit', siteIds: [] } }, mkLog());
    expect(scope.mode).toBe('explicit');
    expect(scope.siteIds.size).toBe(0);
  });
});
