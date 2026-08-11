/**
 * Verifies that the five sections are reachable from SettingsShell.
 *
 * Each section is wired during Task 11 step 0.
 */
import { SettingsShell } from '../../../src/renderer/components/settings/SettingsShell';
import { ConnectionsSection } from '../../../src/renderer/components/settings/ConnectionsSection';
import { ChatSection } from '../../../src/renderer/components/settings/ChatSection';
import { BackgroundWorkSection } from '../../../src/renderer/components/settings/BackgroundWorkSection';
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
      externalHosts: [{ alias: 'h1', site: 's1', environment: 'production', domain: 'example.com' }],
      fleetCounts: { wpe: 1, external: 1, local: 1 },
      jobRunData: {},
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
      indexEntries: [],
      mcpInfo: null,
    };
    const tree = shell.render();
    expect(findComponentInTree(tree, BackgroundWorkSection)).toBe(true);
  });

  it('renders PermissionsSection when active=permissions', () => {
    const shell = new SettingsShell({ electron: mockElectron });
    shell.state = {
      loading: false,
      active: 'permissions',
      settings: { autoIndex: true, excludedSiteIds: [] } as any,
      sites: [],
      wpeAccounts: [{ id: 'a1', name: 'Account 1' }],
      wpeInstalls: [{ installName: 'i1', environment: 'production', primaryDomain: 'example.com' }],
      externalHosts: [{ alias: 'h1', site: 's1', environment: 'production', domain: 'example.com' }],
      fleetCounts: null,
      jobRunData: {},
      indexEntries: [],
      mcpInfo: null,
    };
    const tree = shell.render();
    expect(findComponentInTree(tree, PermissionsSection)).toBe(true);
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
      indexEntries: [{ siteId: 's1', state: 'indexed', documentCount: 10 }],
      mcpInfo: { port: 13100 },
    };
    const tree = shell.render();
    expect(findComponentInTree(tree, AdvancedSection)).toBe(true);
  });
});
