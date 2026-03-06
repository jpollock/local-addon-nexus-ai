/**
 * Unit tests for SmartFiltersPanel component
 */
import * as React from 'react';
import { SmartFiltersPanel } from '../../../src/renderer/components/SmartFiltersPanel';
import { IPC_CHANNELS } from '../../../src/common/constants';

function createMockFilters() {
  return [
    { id: 'outdated-plugins', category: 'security', label: 'Outdated Plugins', description: 'Sites with outdated plugins', count: 3, severity: 'error' as const },
    { id: 'weak-passwords', category: 'security', label: 'Weak Passwords', description: 'Sites with weak passwords', count: 2, severity: 'warning' as const },
    { id: 'pending-updates', category: 'maintenance', label: 'Pending Updates', description: 'Sites needing updates', count: 5, severity: 'info' as const },
    { id: 'inactive-sites', category: 'activity', label: 'Inactive Sites', description: 'Sites not accessed recently', count: 1, severity: 'info' as const },
    { id: 'low-health', category: 'health', label: 'Low Health Score', description: 'Sites with health below 50', count: 2, severity: 'error' as const },
  ];
}

function createMockElectron(filters: any[] = [], shouldFail = false, applySiteIds: string[] = []) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string, ...args: any[]) => {
        if (channel === IPC_CHANNELS.FILTERS_GET_COUNTS) {
          if (shouldFail) {
            return { success: false, error: 'Test error' };
          }
          return { success: true, filters };
        }
        if (channel === IPC_CHANNELS.FILTERS_APPLY) {
          return { success: true, siteIds: applySiteIds };
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

describe('SmartFiltersPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  test('should render filter categories', async () => {
    const filters = createMockFilters();
    const mockElectron = createMockElectron(filters);
    const instance = new SmartFiltersPanel({ electron: mockElectron });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchFilters();

    const groups = instance.getFiltersByCategory();
    expect(Object.keys(groups)).toContain('security');
    expect(Object.keys(groups)).toContain('maintenance');
    expect(Object.keys(groups)).toContain('activity');
    expect(Object.keys(groups)).toContain('health');
  });

  test('should render filter buttons with counts', async () => {
    const filters = createMockFilters();
    const mockElectron = createMockElectron(filters);
    const instance = new SmartFiltersPanel({ electron: mockElectron });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchFilters();

    expect(instance.state.filters).toHaveLength(5);
    expect(instance.state.filters[0].count).toBe(3);
    expect(instance.state.filters[0].label).toBe('Outdated Plugins');

    // Verify categories group correctly
    const groups = instance.getFiltersByCategory();
    expect(groups['security']).toHaveLength(2);
    expect(groups['maintenance']).toHaveLength(1);
  });

  test('should call onFilterClick when filter is clicked', async () => {
    const filters = createMockFilters();
    const siteIds = ['site-1', 'site-2'];
    const mockElectron = createMockElectron(filters, false, siteIds);
    const onFilterClick = jest.fn();
    const instance = new SmartFiltersPanel({ electron: mockElectron, onFilterClick });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchFilters();
    await instance.handleFilterClick('outdated-plugins');

    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.FILTERS_APPLY,
      'outdated-plugins',
    );
    expect(onFilterClick).toHaveBeenCalledWith('outdated-plugins', siteIds);
  });

  test('should auto-refresh and update counts', () => {
    jest.useFakeTimers();

    const mockElectron = createMockElectron([]);
    const instance = new SmartFiltersPanel({ electron: mockElectron });
    const fetchSpy = jest.spyOn(instance, 'fetchFilters');

    instance.componentDidMount();

    // Initial call
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance 60 seconds
    jest.advanceTimersByTime(60000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Advance another 60 seconds
    jest.advanceTimersByTime(60000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    instance.componentWillUnmount();
    jest.useRealTimers();
  });

  test('should show loading state', () => {
    const mockElectron = createMockElectron([]);
    const instance = new SmartFiltersPanel({ electron: mockElectron });

    expect(instance.state.loading).toBe(true);
    expect(instance.state.filters).toEqual([]);
    expect(instance.state.error).toBeNull();
  });

  test('should show "All Clear" when no filters have count > 0', async () => {
    const zeroFilters = [
      { id: 'f1', category: 'security', label: 'Test', description: 'Test', count: 0, severity: 'info' as const },
      { id: 'f2', category: 'health', label: 'Test 2', description: 'Test 2', count: 0, severity: 'warning' as const },
    ];
    const mockElectron = createMockElectron(zeroFilters);
    const instance = new SmartFiltersPanel({ electron: mockElectron });

    spySetState(instance);
    instance['_mounted'] = true;
    await instance.fetchFilters();

    expect(instance.state.filters).toHaveLength(2);
    expect(instance.hasActiveFilters()).toBe(false);

    // Verify getFiltersByCategory returns empty groups
    const groups = instance.getFiltersByCategory();
    expect(Object.keys(groups)).toHaveLength(0);
  });
});
