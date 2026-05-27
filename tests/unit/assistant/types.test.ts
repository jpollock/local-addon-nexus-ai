import type { QueryPlan, AssistantContext, FleetInsight } from '../../../src/common/types';

test('QueryPlan intent union covers all expected values', () => {
  const valid: QueryPlan['intent'][] = ['fleet-filter','content-search','site-info','action','explanation'];
  expect(valid.length).toBe(5);
});

test('AssistantContext fleet mode has required fields', () => {
  const fleet: AssistantContext = { mode: 'fleet', localSiteCount: 14, wpeSiteCount: 281, indexedCount: 97 };
  expect(fleet.mode).toBe('fleet');
  expect(fleet.localSiteCount).toBe(14);
});

test('AssistantContext site mode has required fields', () => {
  const site: AssistantContext = { mode: 'site', siteId: 'abc', siteName: 'acme-prod', phpVersion: '7.4', wpVersion: '6.9', pluginCount: 14, indexState: 'indexed' };
  expect(site.mode).toBe('site');
  expect(site.phpVersion).toBe('7.4');
});

test('FleetInsight kind union covers warning, info, action', () => {
  const kinds: FleetInsight['kind'][] = ['warning', 'info', 'action'];
  expect(kinds.length).toBe(3);
});
