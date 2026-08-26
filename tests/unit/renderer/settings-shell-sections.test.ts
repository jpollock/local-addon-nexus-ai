/**
 * Verifies that the five sections are reachable from SettingsShell.
 *
 * Each section is wired during Task 11 step 0.
 */
import { SettingsShell } from '../../../src/renderer/components/settings/SettingsShell';
import { ConnectionsSection } from '../../../src/renderer/components/settings/ConnectionsSection';
import { ChatSection } from '../../../src/renderer/components/settings/ChatSection';
import { BackgroundWorkSection } from '../../../src/renderer/components/settings/BackgroundWorkSection';
import { PermissionsPaneSection } from '../../../src/renderer/components/settings/PermissionsPaneSection';
import { PermissionsSection } from '../../../src/renderer/components/settings/PermissionsSection';
import { AdvancedSection } from '../../../src/renderer/components/settings/AdvancedSection';
import * as React from 'react';

jest.mock('../../../src/renderer/utils/theme', () => ({
  injectThemeVars: jest.fn(),
}));

const mockElectron = {
  ipcRenderer: {
    invoke: jest.fn().mockResolvedValue(null),
  },
};

function findComponentInTree(tree: any, componentType: any): boolean {
  if (!tree) return false;
  if (tree.type === componentType) return true;
  if (tree.props?.children) {
    if (Array.isArray(tree.props.children)) {
      return tree.props.children.some((c: any) => findComponentInTree(c, componentType));
    }
    return findComponentInTree(tree.props.children, componentType);
  }
  return false;
}

/** The element for `componentType`, so its props can be inspected. */
function elementFor(tree: any, componentType: any): any {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) {
    for (const t of tree) { const hit = elementFor(t, componentType); if (hit) return hit; }
    return null;
  }
  if (tree.type === componentType) return tree;
  const kids = tree.props?.children;
  const list = Array.isArray(kids) ? kids : [kids];
  for (const k of list) { const hit = elementFor(k, componentType); if (hit) return hit; }
  return null;
}

describe('SettingsShell section dispatch', () => {
  it('renders ConnectionsSection when active=connections', () => {
    const shell = new SettingsShell({ electron: mockElectron });
    shell.state = {
      loading: false,
      active: 'connections',
      settings: { autoIndex: true, excludedSiteIds: [] } as any,
      sites: [],
      wpeAccounts: [{ id: 'a1', name: 'Account 1' }],
      wpeInstalls: [],
      externalHosts: [{ alias: 'h1', site: 's1', environment: 'production', domain: 'example.com', wpPath: '/home/u/s1', allowRoot: false }],
      fleetCounts: { wpe: 1, external: 1, local: 1 },
      jobRunData: {},
    pipelineActivity: null,
      indexEntries: [],
      mcpInfo: null,
    };
    const tree = shell.render();
    expect(findComponentInTree(tree, ConnectionsSection)).toBe(true);
  });

  it('renders ChatSection when active=chat', () => {
    const shell = new SettingsShell({ electron: mockElectron });
    shell.state = {
      loading: false,
      active: 'chat',
      settings: { autoIndex: true, excludedSiteIds: [] } as any,
      sites: [],
      wpeAccounts: [],
      wpeInstalls: [],
      externalHosts: [],
      fleetCounts: null,
      jobRunData: {},
    pipelineActivity: null,
      indexEntries: [],
      mcpInfo: null,
    };
    const tree = shell.render();
    expect(findComponentInTree(tree, ChatSection)).toBe(true);
  });

  it('renders BackgroundWorkSection when active=background', () => {
    const shell = new SettingsShell({ electron: mockElectron });
    shell.state = {
      loading: false,
      active: 'background',
      settings: { autoIndex: true, excludedSiteIds: [] } as any,
      sites: [],
      wpeAccounts: [],
      wpeInstalls: [],
      externalHosts: [],
      fleetCounts: { wpe: 1, external: 1, local: 1 },
      jobRunData: { wpeRefresh: { averageMs: 1000, lastRunAt: Date.now() } },
      pipelineActivity: null,
      indexEntries: [],
      mcpInfo: null,
    };
    const tree = shell.render();
    expect(findComponentInTree(tree, BackgroundWorkSection)).toBe(true);
  });

  it('renders the merged PermissionsPaneSection when active=permissions — phase 5, one answering surface', () => {
    const shell = new SettingsShell({ electron: mockElectron });
    shell.state = {
      loading: false,
      active: 'permissions',
      settings: { autoIndex: true, excludedSiteIds: [] } as any,
      sites: [],
      wpeAccounts: [{ id: 'a1', name: 'Account 1' }],
      wpeInstalls: [{ installName: 'i1', environment: 'production', primaryDomain: 'example.com' }],
      externalHosts: [{ alias: 'h1', site: 's1', environment: 'production', domain: 'example.com', wpPath: '/home/u/s1', allowRoot: false }],
      fleetCounts: null,
      jobRunData: {},
    pipelineActivity: null,
      indexEntries: [],
      mcpInfo: null,
    };
    const tree = shell.render();
    expect(findComponentInTree(tree, PermissionsPaneSection)).toBe(true);
    // The bound's EDITOR survives, door-reached — never a nav destination.
    shell.state = { ...shell.state, active: 'bound-editor' as never };
    expect(findComponentInTree(shell.render(), PermissionsSection)).toBe(true);
  });

  it('renders AdvancedSection when active=advanced', () => {
    const shell = new SettingsShell({ electron: mockElectron });
    shell.state = {
      loading: false,
      active: 'advanced',
      settings: { autoIndex: true, excludedSiteIds: [] } as any,
      sites: [{ id: 's1', name: 'Site 1', status: 'running' }],
      wpeAccounts: [],
      wpeInstalls: [],
      externalHosts: [],
      fleetCounts: null,
      jobRunData: {},
    pipelineActivity: null,
      indexEntries: [{ siteId: 's1', state: 'indexed', documentCount: 10 }],
      mcpInfo: { port: 13100, stdioPath: '/path/to/stdio.js' },
    };
    const tree = shell.render();
    expect(findComponentInTree(tree, AdvancedSection)).toBe(true);
  });
});

/**
 * "It renders" is not "it works". Task 11 shipped `sites: []` hardcoded into
 * the AdvancedSection call, so the exclusions accordion never appeared no
 * matter how many sites the shell had loaded — and every dispatch test above
 * stayed green, because each one asserts only that the component is present.
 * These assert that what the shell holds is what the section receives.
 */
describe('SettingsShell passes real data, not placeholders', () => {
  const loaded = {
    loading: false,
    settings: { autoIndex: true, excludedSiteIds: ['s2'] } as any,
    sites: [{ id: 's1', name: 'Site One', status: 'running' }, { id: 's2', name: 'Site Two', status: 'halted' }],
    wpeAccounts: [{ id: 'a1', name: 'Account 1' }],
    wpeInstalls: [{ installName: 'i1', environment: 'production', primaryDomain: 'example.com' }],
    externalHosts: [{ alias: 'h1', site: 's1', environment: 'production', domain: 'example.com' }],
    fleetCounts: { wpe: 412, external: 1, local: 2 },
    jobRunData: { wpeRefresh: { averageMs: 1000, lastRunAt: Date.now() } },
      pipelineActivity: null,
    indexEntries: [{ siteId: 's1', state: 'indexed', documentCount: 10 }],
    mcpInfo: { port: 13100 },
  };

  const sectionProps = (active: string, componentType: any) => {
    const shell = new SettingsShell({ electron: mockElectron });
    shell.state = { ...loaded, active } as any;
    return elementFor(shell.render(), componentType)?.props;
  };

  it('gives AdvancedSection the loaded sites, index entries, mcpInfo and fleet counts', () => {
    const props = sectionProps('advanced', AdvancedSection);
    expect(props.sites).toBe(loaded.sites);
    expect(props.indexEntries).toBe(loaded.indexEntries);
    expect(props.mcpInfo).toBe(loaded.mcpInfo);
    // fleetCounts is what replaced the hardcoded "reads all 367 again".
    expect(props.fleetCounts).toEqual(loaded.fleetCounts);
    expect(props.settings).toBe(loaded.settings);
    expect(typeof props.onSave).toBe('function');
  });

  it('gives ConnectionsSection the loaded accounts and external hosts', () => {
    const props = sectionProps('connections', ConnectionsSection);
    expect(props.wpeAccounts).toBe(loaded.wpeAccounts);
    expect(props.externalHosts).toBe(loaded.externalHosts);
    expect(props.settings).toBe(loaded.settings);
  });

  it('gives PermissionsSection the loaded installs, hosts and accounts', () => {
    const props = sectionProps('bound-editor', PermissionsSection);
    expect(props.wpeInstalls).toBe(loaded.wpeInstalls);
    expect(props.externalHosts).toBe(loaded.externalHosts);
    expect(props.wpeAccounts).toBe(loaded.wpeAccounts);
    expect(props.permissions).toBe(loaded.settings);
  });

  it('gives BackgroundWorkSection a derived object built from the loaded counts', () => {
    const props = sectionProps('background', BackgroundWorkSection);
    // 412 installs, not a placeholder — the figure text proves the count flowed.
    expect(props.derived.summary.wpe.scope).toBe('across 412 installs');
    expect(props.derived.rows.length).toBeGreaterThan(0);
  });

  it('gives ChatSection the loaded settings', () => {
    expect(sectionProps('chat', ChatSection).settings).toBe(loaded.settings);
  });

  it('no section is handed an empty array the shell has data for', () => {
    // The generic form of the Task 11 defect: a section prop that is `[]` while
    // the shell's corresponding state is not.
    const checks: Array<[string, any, string, keyof typeof loaded]> = [
      ['advanced', AdvancedSection, 'sites', 'sites'],
      ['advanced', AdvancedSection, 'indexEntries', 'indexEntries'],
      ['connections', ConnectionsSection, 'wpeAccounts', 'wpeAccounts'],
      ['connections', ConnectionsSection, 'externalHosts', 'externalHosts'],
      ['bound-editor', PermissionsSection, 'wpeInstalls', 'wpeInstalls'],
      ['bound-editor', PermissionsSection, 'externalHosts', 'externalHosts'],
      ['bound-editor', PermissionsSection, 'wpeAccounts', 'wpeAccounts'],
    ];
    const empty = checks.filter(([active, type, prop]) => {
      const value = sectionProps(active, type)[prop];
      return Array.isArray(value) && value.length === 0;
    }).map(([active, , prop]) => `${active}.${prop}`);
    expect(empty).toEqual([]);
  });
});
