/**
 * Unit tests for EventStatsCards component
 */
import * as React from 'react';
import { EventStatsCards } from '../../../src/renderer/components/EventStatsCards';
import { IPC_CHANNELS } from '../../../src/common/constants';
import type { EventStats } from '../../../src/common/types';

/**
 * Mock electron IPC
 */
function createMockElectron(stats: EventStats | null, shouldFail = false) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string) => {
        if (channel === IPC_CHANNELS.EVENTS_GET_STATS) {
          if (shouldFail) {
            return { success: false, error: 'Test error' };
          }
          return { success: true, stats };
        }
        return { success: false, error: 'Unknown channel' };
      }),
    },
  };
}

describe('EventStatsCards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    test('should render loading state initially', () => {
      const mockElectron = createMockElectron(null);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });

      expect(instance.state.loading).toBe(true);
      expect(instance.state.stats).toBeNull();
      expect(instance.state.error).toBeNull();
    });

    test('should fetch stats on mount', async () => {
      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 2,
        failed: 0,
        byType: { plugin_activated: 5, post_created: 5 },
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes without React's mount check
      const setStateSpy = jest.spyOn(instance, 'setState').mockImplementation(function (this: EventStatsCards, updater: any) {
        // Manually apply state update
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      // Set mounted flag and fetch
      instance['mounted'] = true;
      await instance.fetchStats();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.EVENTS_GET_STATS);
      expect(setStateSpy).toHaveBeenCalled();
      expect(instance.state.stats).toEqual(mockStats);
      expect(instance.state.loading).toBe(false);
      expect(instance.state.error).toBeNull();
    });

    test('should handle fetch error', async () => {
      const mockElectron = createMockElectron(null, true);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes without React's mount check
      const setStateSpy = jest.spyOn(instance, 'setState').mockImplementation(function (this: EventStatsCards, updater: any) {
        // Manually apply state update
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      // Set mounted flag and fetch
      instance['mounted'] = true;
      await instance.fetchStats();

      expect(setStateSpy).toHaveBeenCalled();
      expect(instance.state.loading).toBe(false);
      expect(instance.state.error).toBe('Test error');
    });
  });

  describe('auto-refresh', () => {
    test('should auto-refresh when enabled', () => {
      jest.useFakeTimers();

      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 0,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({
        electron: mockElectron,
        autoRefresh: true,
        refreshInterval: 1000,
      });

      // Spy on fetchStats
      const fetchStatsSpy = jest.spyOn(instance, 'fetchStats');

      instance.componentDidMount();

      // Initial call
      expect(fetchStatsSpy).toHaveBeenCalledTimes(1);

      // Advance timer to trigger refresh
      jest.advanceTimersByTime(1000);

      expect(fetchStatsSpy).toHaveBeenCalledTimes(2);

      instance.componentWillUnmount();
      jest.useRealTimers();
    });

    test('should not auto-refresh when disabled', () => {
      jest.useFakeTimers();

      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 0,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({
        electron: mockElectron,
        autoRefresh: false,
      });

      // Spy on fetchStats
      const fetchStatsSpy = jest.spyOn(instance, 'fetchStats');

      instance.componentDidMount();

      // Initial call
      expect(fetchStatsSpy).toHaveBeenCalledTimes(1);

      // Advance timer
      jest.advanceTimersByTime(30000);

      // Should still be 1 (no auto-refresh)
      expect(fetchStatsSpy).toHaveBeenCalledTimes(1);

      instance.componentWillUnmount();
      jest.useRealTimers();
    });

    test('should cleanup timer on unmount', () => {
      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 0,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({
        electron: mockElectron,
        autoRefresh: true,
        refreshInterval: 1000,
      });

      instance.componentDidMount();
      expect(instance['refreshTimer']).not.toBeNull();

      instance.componentWillUnmount();
      expect(instance['refreshTimer']).toBeNull();
    });
  });

  describe('health status calculation', () => {
    test('should return good status when no failures', () => {
      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 5,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats;

      expect(instance.getHealthColor()).toBe('#51c356'); // UI_COLORS.STATUS_RUNNING
      expect(instance.getHealthLabel()).toBe('All Systems Healthy');
      expect(instance.getHealthIcon()).toBe('✓');
    });

    test('should return warning status when >10 pending', () => {
      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 15,
        failed: 0,
        byType: {},
        healthStatus: 'warning',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats;

      expect(instance.getHealthColor()).toBe('#f59e0b'); // UI_COLORS.STATUS_WARNING
      expect(instance.getHealthLabel()).toBe('Pending Events');
      expect(instance.getHealthIcon()).toBe('⚠');
    });

    test('should return error status when failures exist', () => {
      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 5,
        failed: 3,
        byType: {},
        healthStatus: 'error',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats;

      expect(instance.getHealthColor()).toBe('#ef4444'); // UI_COLORS.STATUS_ERROR
      expect(instance.getHealthLabel()).toBe('Failed Events Detected');
      expect(instance.getHealthIcon()).toBe('✗');
    });
  });

  describe('card rendering', () => {
    test('should render total events card', () => {
      const mockStats: EventStats = {
        total: 12345,
        today: 100,
        yesterday: 80,
        pending: 0,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats;
      instance.state.loading = false;

      const card = instance.renderTotalEventsCard();
      expect(card).toBeDefined();
      expect(card).not.toBeNull();
    });

    test('should render today card with positive comparison', () => {
      const mockStats: EventStats = {
        total: 100,
        today: 50,
        yesterday: 30,
        pending: 0,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats;
      instance.state.loading = false;

      const card = instance.renderTodayCard();
      expect(card).toBeDefined();
      expect(card).not.toBeNull();
    });

    test('should render today card with negative comparison', () => {
      const mockStats: EventStats = {
        total: 100,
        today: 30,
        yesterday: 50,
        pending: 0,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats;
      instance.state.loading = false;

      const card = instance.renderTodayCard();
      expect(card).toBeDefined();
      expect(card).not.toBeNull();
    });

    test('should render today card when yesterday is zero', () => {
      const mockStats: EventStats = {
        total: 100,
        today: 50,
        yesterday: 0,
        pending: 0,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats;
      instance.state.loading = false;

      const card = instance.renderTodayCard();
      expect(card).toBeDefined();
      expect(card).not.toBeNull();
    });

    test('should render health card', () => {
      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 5,
        failed: 2,
        byType: {},
        healthStatus: 'error',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats;
      instance.state.loading = false;

      const card = instance.renderHealthCard();
      expect(card).toBeDefined();
      expect(card).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    test('should handle null stats gracefully', () => {
      const mockElectron = createMockElectron(null);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = null;
      instance.state.loading = false;

      expect(instance.getHealthColor()).toBe('#999'); // UI_COLORS.STATUS_HALTED
      expect(instance.getHealthLabel()).toBe('Unknown');
      expect(instance.getHealthIcon()).toBe('○');
    });

    test('should handle missing data in stats', () => {
      const mockStats: Partial<EventStats> = {
        total: 100,
        // Missing today, yesterday, etc.
      } as EventStats;

      const mockElectron = createMockElectron(mockStats as EventStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });
      instance.state.stats = mockStats as EventStats;
      instance.state.loading = false;

      const card = instance.renderTodayCard();
      expect(card).toBeDefined();
      expect(card).not.toBeNull();
    });

    test('should not update state after unmount', async () => {
      const mockStats: EventStats = {
        total: 100,
        today: 10,
        yesterday: 8,
        pending: 0,
        failed: 0,
        byType: {},
        healthStatus: 'good',
      };

      const mockElectron = createMockElectron(mockStats);
      const instance = new EventStatsCards({ electron: mockElectron, autoRefresh: false });

      instance.componentDidMount();
      instance.componentWillUnmount();

      // Try to fetch after unmount
      await instance.fetchStats();

      // State should not be updated (mounted flag should prevent it)
      expect(instance['mounted']).toBe(false);
    });
  });
});
