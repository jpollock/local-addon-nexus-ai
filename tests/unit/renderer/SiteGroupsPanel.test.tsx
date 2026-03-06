/**
 * Unit tests for SiteGroupsPanel component (Local native groups)
 */
import * as React from 'react';
import { SiteGroupsPanel } from '../../../src/renderer/components/SiteGroupsPanel';
import { IPC_CHANNELS } from '../../../src/common/constants';
import type { SiteGroupInfo } from '../../../src/common/types';

function createMockGroups(): SiteGroupInfo[] {
  return [
    { id: 'default', name: 'Sites', siteIds: ['site-1', 'site-2', 'site-3'], index: 0 },
    { id: 'g2', name: 'Staging', siteIds: ['site-4'], index: 1 },
    { id: 'g3', name: 'Clients', siteIds: ['site-1', 'site-4'], index: 2 },
  ];
}

function createMockSites() {
  return [
    { id: 'site-1', name: 'Blog', domain: 'blog.local' },
    { id: 'site-2', name: 'Shop', domain: 'shop.local' },
    { id: 'site-3', name: 'Docs', domain: 'docs.local' },
    { id: 'site-4', name: 'Staging', domain: 'staging.local' },
  ];
}

function createMockElectron(groups: SiteGroupInfo[] = [], shouldFail = false) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string, ...args: any[]) => {
        if (channel === IPC_CHANNELS.GROUPS_LIST) {
          if (shouldFail) return { success: false, error: 'Failed to load groups' };
          return { success: true, groups };
        }
        if (channel === IPC_CHANNELS.GROUPS_CREATE) {
          return {
            success: true,
            group: { id: 'g-new', name: args[0]?.name || 'New Group', siteIds: [], index: groups.length },
          };
        }
        if (channel === IPC_CHANNELS.GROUPS_DELETE) {
          return { success: true };
        }
        return { success: false, error: 'Unknown channel' };
      }),
    },
  };
}

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

describe('SiteGroupsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).window = { confirm: jest.fn().mockReturnValue(true) };
  });

  test('should render loading state initially', () => {
    const mockElectron = createMockElectron([]);
    const instance = new SiteGroupsPanel({ electron: mockElectron });

    expect(instance.state.loading).toBe(true);
    expect(instance.state.groups).toEqual([]);
    expect(instance.state.error).toBeNull();
  });

  test('should render empty state when no groups', async () => {
    const mockElectron = createMockElectron([]);
    const instance = new SiteGroupsPanel({ electron: mockElectron });

    spySetState(instance);
    instance._mounted = true;
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.groups).toHaveLength(0);
    expect(instance.state.loading).toBe(false);
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.GROUPS_LIST);
  });

  test('should render groups list', async () => {
    const groups = createMockGroups();
    const mockElectron = createMockElectron(groups);
    const instance = new SiteGroupsPanel({ electron: mockElectron });

    spySetState(instance);
    instance._mounted = true;
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.groups).toHaveLength(3);
    expect(instance.state.loading).toBe(false);
    expect(instance.state.groups[0].name).toBe('Sites');
    expect(instance.state.groups[0].siteIds).toHaveLength(3);
    expect(instance.state.groups[1].name).toBe('Staging');
  });

  test('should not allow deleting default group', async () => {
    const groups = createMockGroups();
    const mockElectron = createMockElectron(groups);
    const instance = new SiteGroupsPanel({ electron: mockElectron });

    spySetState(instance);
    instance._mounted = true;
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    // Try to delete the default group — should be a no-op
    await instance.handleDelete('default');
    expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
      IPC_CHANNELS.GROUPS_DELETE,
      'default',
    );
  });

  test('should toggle create form visibility', () => {
    const mockElectron = createMockElectron([]);
    const instance = new SiteGroupsPanel({ electron: mockElectron });

    spySetState(instance);

    expect(instance.state.showCreateForm).toBe(false);
    instance.setState({ showCreateForm: true });
    expect(instance.state.showCreateForm).toBe(true);
    instance.setState({ showCreateForm: false });
    expect(instance.state.showCreateForm).toBe(false);
  });

  test('should handle group creation', async () => {
    const mockElectron = createMockElectron([]);
    const instance = new SiteGroupsPanel({ electron: mockElectron });

    spySetState(instance);
    instance._mounted = true;
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.groups).toHaveLength(0);

    instance.setState({ showCreateForm: true, newGroupName: 'My New Group' });
    await instance.handleCreate();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.GROUPS_CREATE,
      expect.objectContaining({ name: 'My New Group' }),
    );

    expect(instance.state.groups).toHaveLength(1);
    expect(instance.state.groups[0].id).toBe('g-new');
    expect(instance.state.groups[0].name).toBe('My New Group');
    expect(instance.state.showCreateForm).toBe(false);
    expect(instance.state.newGroupName).toBe('');
  });

  test('should handle group deletion', async () => {
    const groups = createMockGroups();
    const mockElectron = createMockElectron(groups);
    const instance = new SiteGroupsPanel({ electron: mockElectron });

    spySetState(instance);
    instance._mounted = true;
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.groups).toHaveLength(3);

    await instance.handleDelete('g2');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.GROUPS_DELETE, 'g2');
    expect(instance.state.groups).toHaveLength(2);
    expect(instance.state.groups.find((g: any) => g.id === 'g2')).toBeUndefined();
  });

  test('should handle fetch error gracefully', async () => {
    const mockElectron = createMockElectron([], true);
    const instance = new SiteGroupsPanel({ electron: mockElectron });

    spySetState(instance);
    instance._mounted = true;
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.loading).toBe(false);
    expect(instance.state.error).toBe('Failed to load groups');
    expect(instance.state.groups).toHaveLength(0);
  });

  test('should expand group to show member sites', async () => {
    const groups = createMockGroups();
    const sites = createMockSites();
    const mockElectron = createMockElectron(groups);
    const instance = new SiteGroupsPanel({ electron: mockElectron, sites });

    spySetState(instance);
    instance._mounted = true;
    instance.componentDidMount();
    await new Promise((r) => setTimeout(r, 0));

    expect(instance.state.expandedGroupId).toBeNull();

    instance.handleToggleExpand('default');
    expect(instance.state.expandedGroupId).toBe('default');

    const expandedGroup = instance.state.groups.find((g: any) => g.id === 'default');
    expect(expandedGroup!.siteIds).toEqual(['site-1', 'site-2', 'site-3']);

    instance.handleToggleExpand('default');
    expect(instance.state.expandedGroupId).toBeNull();
  });

  test('should resolve site names from props', () => {
    const sites = createMockSites();
    const mockElectron = createMockElectron([]);
    const instance = new SiteGroupsPanel({ electron: mockElectron, sites });

    expect(instance.getSiteName('site-1')).toBe('Blog');
    expect(instance.getSiteName('site-4')).toBe('Staging');
    expect(instance.getSiteName('unknown-id')).toBe('unknown-id');
  });
});
