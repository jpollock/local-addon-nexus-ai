// tests/unit/agents/security-sentinel/scan-scope.test.js
'use strict';

// Scheduled scanning is opt-in per site.
//
// The cron trigger carries no event, so nothing in the trigger narrows the scope. Before this,
// an unscoped sweep took whatever was in graph.db — 375 sites nobody had chosen. The failure
// mode being defended against is NOT "too slow"; it is a permissive default.
//
// So: absent, malformed, or empty configuration scans NOTHING, and says so.
//
// 2026-08-07: `settings.scanScope` (`{mode:'explicit'|'all', siteIds}`) was retired in favor of
// the unified `settings.scope` (`{siteIds}`) the site scope picker's Settings tab and Run Now
// modal both read/write — there is no more "scan everything" mode, since selecting all known
// sites in the picker now IS the explicit list. `resolveScanScope` still reads the legacy
// `scanScope` shape as a one-time migration fallback for on-disk settings from before this.

const agent = require('../../../../agents/security-sentinel/agent');
const { resolveScanScope } = agent._test;

const mkLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('Absence never means "scan everything"', () => {
  it.each([
    ['undefined settings', undefined],
    ['null settings', null],
    ['empty settings', {}],
    ['settings with no scope', { autonomy: 'ask', enabled: true }],
    ['scope null', { scope: null }],
    ['scope not an object', { scope: 'all' }],
    ['scope with no siteIds array', { scope: {} }],
  ])('%s resolves to an empty scope', (_label, settings) => {
    const scope = resolveScanScope(settings, mkLog());
    expect(scope.siteIds.size).toBe(0);
  });
});

describe('Explicit scope carries exactly what was chosen', () => {
  it('keeps the selected ids', () => {
    const scope = resolveScanScope({ scope: { siteIds: ['a', 'b'] } }, mkLog());
    expect([...scope.siteIds].sort()).toEqual(['a', 'b']);
  });

  it('discards non-string and empty ids rather than matching everything', () => {
    const scope = resolveScanScope(
      { scope: { siteIds: ['ok', '', null, 42, undefined, {}] } }, mkLog());
    expect([...scope.siteIds]).toEqual(['ok']);
  });

  it('siteIds not an array yields an empty set, not a crash', () => {
    const scope = resolveScanScope({ scope: { siteIds: 'a,b' } }, mkLog());
    expect(scope.siteIds.size).toBe(0);
  });
});

describe('There is no "scan everything" mode', () => {
  it('a scope containing every known site is still just an explicit list, not a live rule', () => {
    const scope = resolveScanScope({ scope: { siteIds: ['a', 'b', 'c'] } }, mkLog());
    expect([...scope.siteIds].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('Legacy scanScope migration fallback', () => {
  it('reads legacy explicit-mode siteIds when scope is entirely absent', () => {
    const scope = resolveScanScope({ scanScope: { mode: 'explicit', siteIds: ['a', 'b'] } }, mkLog());
    expect([...scope.siteIds].sort()).toEqual(['a', 'b']);
  });

  it('legacy mode:"all" has no equivalent and resolves to an empty scope, with a warning', () => {
    const log = mkLog();
    const scope = resolveScanScope({ scanScope: { mode: 'all' } }, log);
    expect(scope.siteIds.size).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('legacy scanScope.mode "all"'));
  });

  it('scope takes priority over a legacy scanScope when both are present', () => {
    const scope = resolveScanScope({ scope: { siteIds: ['new'] }, scanScope: { mode: 'explicit', siteIds: ['old'] } }, mkLog());
    expect([...scope.siteIds]).toEqual(['new']);
  });

  it('legacy scanScope with malformed siteIds yields an empty set, not a crash', () => {
    const scope = resolveScanScope({ scanScope: { mode: 'explicit', siteIds: 'a,b' } }, mkLog());
    expect(scope.siteIds.size).toBe(0);
  });
});

describe('The default the UI writes matches what the agent enforces', () => {
  // Two independent implementations of the same rule — AgentStore.getDefaultSettings in the
  // renderer, resolveScanScope in the agent. If they disagree, the UI shows one thing and the
  // scheduler does another.
  const fs = require('fs');
  const path = require('path');

  it('AgentStore defaults to an empty scope', () => {
    const store = fs.readFileSync(
      path.join(__dirname, '../../../../src/renderer/components/agents/AgentStore.ts'), 'utf8');
    expect(store).toMatch(/scope:\s*\{\s*siteIds:\s*\[\]\s*\}/);
  });

  it('and the agent resolves that same value to "scan nothing"', () => {
    const scope = resolveScanScope({ scope: { siteIds: [] } }, mkLog());
    expect(scope.siteIds.size).toBe(0);
  });
});
