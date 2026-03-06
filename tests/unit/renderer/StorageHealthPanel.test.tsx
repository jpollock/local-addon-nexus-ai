/**
 * Unit tests for StorageHealthPanel component
 */
import * as React from 'react';
import { StorageHealthPanel } from '../../../src/renderer/components/StorageHealthPanel';
import { IPC_CHANNELS } from '../../../src/common/constants';
import type { StorageHealth } from '../../../src/common/types';

/**
 * Mock electron IPC
 */
function createMockElectron(health: StorageHealth | null, shouldFail = false, cleanupResult?: any) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string, params?: any) => {
        if (channel === IPC_CHANNELS.STORAGE_GET_HEALTH) {
          if (shouldFail) {
            return { success: false, error: 'Test error' };
          }
          return { success: true, health };
        }
        if (channel === IPC_CHANNELS.STORAGE_CLEANUP) {
          if (cleanupResult) {
            return cleanupResult;
          }
          return { success: true, deletedCount: 10 };
        }
        return { success: false, error: 'Unknown channel' };
      }),
    },
  };
}

describe('StorageHealthPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('rendering', () => {
    test('should render loading state initially', () => {
      const mockElectron = createMockElectron(null);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      expect(instance.state.loading).toBe(true);
      expect(instance.state.health).toBeNull();
      expect(instance.state.error).toBeNull();
      expect(instance.state.cleaning).toBe(false);
    });

    test('should fetch health on mount', async () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024 * 1024 * 10, // 10 MB
          path: '/path/to/graph.db',
          eventCount: 100,
          oldestEvent: Date.now() - 7 * 24 * 60 * 60 * 1000,
          newestEvent: Date.now(),
        },
        vectorDb: {
          sizeBytes: 1024 * 1024 * 50, // 50 MB
          path: '/path/to/vectors',
          tableCount: 5,
        },
        pendingEvents: 2,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: StorageHealthPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchHealth();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_GET_HEALTH);
      expect(instance.state.health).toEqual(mockHealth);
      expect(instance.state.loading).toBe(false);
      expect(instance.state.error).toBeNull();
    });

    test('should handle fetch error', async () => {
      const mockElectron = createMockElectron(null, true);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: StorageHealthPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchHealth();

      expect(instance.state.loading).toBe(false);
      expect(instance.state.error).toBe('Test error');
    });
  });

  describe('auto-refresh', () => {
    test('should auto-refresh when enabled', () => {
      jest.useFakeTimers();

      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 0,
          oldestEvent: null,
          newestEvent: null,
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 0,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({
        electron: mockElectron,
        autoRefresh: true,
        refreshInterval: 1000,
      });

      const fetchHealthSpy = jest.spyOn(instance, 'fetchHealth');

      instance.componentDidMount();

      // Initial call
      expect(fetchHealthSpy).toHaveBeenCalledTimes(1);

      // Advance timer to trigger refresh
      jest.advanceTimersByTime(1000);

      expect(fetchHealthSpy).toHaveBeenCalledTimes(2);

      instance.componentWillUnmount();
      jest.useRealTimers();
    });

    test('should not auto-refresh when disabled', () => {
      jest.useFakeTimers();

      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 0,
          oldestEvent: null,
          newestEvent: null,
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 0,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({
        electron: mockElectron,
        autoRefresh: false,
      });

      const fetchHealthSpy = jest.spyOn(instance, 'fetchHealth');

      instance.componentDidMount();

      // Initial call
      expect(fetchHealthSpy).toHaveBeenCalledTimes(1);

      // Advance timer
      jest.advanceTimersByTime(60000);

      // Should still be 1 (no auto-refresh)
      expect(fetchHealthSpy).toHaveBeenCalledTimes(1);

      instance.componentWillUnmount();
      jest.useRealTimers();
    });

    test('should cleanup timer on unmount', () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 0,
          oldestEvent: null,
          newestEvent: null,
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 0,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({
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

  describe('cleanup action', () => {
    test('should call cleanup handler', async () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 100,
          oldestEvent: Date.now(),
          newestEvent: Date.now(),
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 5,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth, false, { success: true, deletedCount: 15 });
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: StorageHealthPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;

      await instance.handleCleanup();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
        IPC_CHANNELS.STORAGE_CLEANUP,
        { retentionDays: 30 },
      );
      expect(instance.state.cleanupSuccess).toBe('Cleaned up 15 old events');
      expect(instance.state.cleaning).toBe(false);
    });

    test('should handle cleanup error', async () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 100,
          oldestEvent: Date.now(),
          newestEvent: Date.now(),
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 5,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth, false, { success: false, error: 'Cleanup failed' });
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: StorageHealthPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;

      await instance.handleCleanup();

      expect(instance.state.cleaning).toBe(false);
      expect(instance.state.error).toBe('Cleanup failed');
    });

    test('should prevent double cleanup', async () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 100,
          oldestEvent: Date.now(),
          newestEvent: Date.now(),
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 5,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      instance.state.cleaning = true;

      await instance.handleCleanup();

      // Should not make IPC call when already cleaning
      expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
        IPC_CHANNELS.STORAGE_CLEANUP,
        expect.anything(),
      );
    });
  });

  describe('formatting utilities', () => {
    test('should format bytes correctly', () => {
      const mockElectron = createMockElectron(null);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      expect(instance.formatBytes(0)).toBe('0 B');
      expect(instance.formatBytes(1024)).toBe('1 KB');
      expect(instance.formatBytes(1024 * 1024)).toBe('1 MB');
      expect(instance.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
      expect(instance.formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1 TB');
    });

    test('should format dates correctly', () => {
      const mockElectron = createMockElectron(null);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      expect(instance.formatDate(null)).toBe('N/A');

      const testDate = new Date('2026-03-05').getTime();
      const formatted = instance.formatDate(testDate);
      expect(formatted).toContain('2026');
    });

    test('should calculate percentage correctly', () => {
      const mockElectron = createMockElectron(null);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      const maxBytes = 10 * 1024 * 1024 * 1024; // 10 GB

      expect(instance.calculatePercentage(0, maxBytes)).toBe(0);
      expect(instance.calculatePercentage(1024 * 1024 * 1024, maxBytes)).toBe(10); // 1 GB = 10%
      expect(instance.calculatePercentage(5 * 1024 * 1024 * 1024, maxBytes)).toBe(50); // 5 GB = 50%
      expect(instance.calculatePercentage(10 * 1024 * 1024 * 1024, maxBytes)).toBe(100); // 10 GB = 100%
    });
  });

  describe('rendering components', () => {
    test('should render graph DB storage bar', () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024 * 1024 * 10, // 10 MB
          path: '/path/to/graph.db',
          eventCount: 100,
          oldestEvent: Date.now() - 7 * 24 * 60 * 60 * 1000,
          newestEvent: Date.now(),
        },
        vectorDb: {
          sizeBytes: 1024 * 1024 * 50,
          path: '/path/to/vectors',
          tableCount: 5,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });
      instance.state.health = mockHealth;
      instance.state.loading = false;

      const bar = instance.renderGraphDb();
      expect(bar).toBeDefined();
      expect(bar).not.toBeNull();
    });

    test('should render vector DB storage bar', () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024 * 1024 * 10,
          path: '/path/to/graph.db',
          eventCount: 100,
          oldestEvent: Date.now(),
          newestEvent: Date.now(),
        },
        vectorDb: {
          sizeBytes: 1024 * 1024 * 50, // 50 MB
          path: '/path/to/vectors',
          tableCount: 5,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });
      instance.state.health = mockHealth;
      instance.state.loading = false;

      const bar = instance.renderVectorDb();
      expect(bar).toBeDefined();
      expect(bar).not.toBeNull();
    });

    test('should render actions', () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 100,
          oldestEvent: Date.now(),
          newestEvent: Date.now(),
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 5,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });
      instance.state.health = mockHealth;
      instance.state.loading = false;

      const actions = instance.renderActions();
      expect(actions).toBeDefined();
      expect(actions).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    test('should handle null oldest/newest events', () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 0,
          oldestEvent: null,
          newestEvent: null,
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 0,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });
      instance.state.health = mockHealth;
      instance.state.loading = false;

      const bar = instance.renderGraphDb();
      expect(bar).toBeDefined();
      expect(bar).not.toBeNull();
    });

    test('should not update state after unmount', async () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 0,
          oldestEvent: null,
          newestEvent: null,
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 0,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth);
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      instance.componentDidMount();
      instance.componentWillUnmount();

      // Try to fetch after unmount
      await instance.fetchHealth();

      // State should not be updated (mounted flag should prevent it)
      expect(instance['mounted']).toBe(false);
    });

    test('should handle singular vs plural in success message', async () => {
      const mockHealth: StorageHealth = {
        graphDb: {
          sizeBytes: 1024,
          path: '/path',
          eventCount: 1,
          oldestEvent: Date.now(),
          newestEvent: Date.now(),
        },
        vectorDb: {
          sizeBytes: 1024,
          path: '/path',
          tableCount: 1,
        },
        pendingEvents: 0,
        failedEvents: 0,
      };

      const mockElectron = createMockElectron(mockHealth, false, { success: true, deletedCount: 1 });
      const instance = new StorageHealthPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: StorageHealthPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;

      await instance.handleCleanup();

      expect(instance.state.cleanupSuccess).toBe('Cleaned up 1 old event');
    });
  });
});
