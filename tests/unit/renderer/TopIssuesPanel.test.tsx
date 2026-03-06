/**
 * Unit tests for TopIssuesPanel component
 */
import * as React from 'react';
import { TopIssuesPanel } from '../../../src/renderer/components/TopIssuesPanel';
import { IPC_CHANNELS } from '../../../src/common/constants';
import type { Issue } from '../../../src/common/types';

/**
 * Mock electron IPC
 */
function createMockElectron(issues: Issue[], shouldFail = false, actionResult?: any) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string, params?: any) => {
        if (channel === IPC_CHANNELS.ISSUES_DETECT) {
          if (shouldFail) {
            return { success: false, error: 'Test error' };
          }
          return { success: true, issues };
        }
        if (channel === IPC_CHANNELS.EVENTS_RETRY_FAILED) {
          if (actionResult?.retryFail) {
            return { success: false, error: 'Retry failed' };
          }
          return { success: true, retriedCount: 5 };
        }
        if (channel === IPC_CHANNELS.STORAGE_CLEANUP) {
          if (actionResult?.cleanupFail) {
            return { success: false, error: 'Cleanup failed' };
          }
          return { success: true, deletedCount: 10 };
        }
        return { success: false, error: 'Unknown channel' };
      }),
    },
  };
}

describe('TopIssuesPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('rendering', () => {
    test('should render loading state initially', () => {
      const mockElectron = createMockElectron([]);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      expect(instance.state.loading).toBe(true);
      expect(instance.state.issues).toEqual([]);
      expect(instance.state.error).toBeNull();
      expect(instance.state.actionInProgress).toBeNull();
    });

    test('should fetch issues on mount', async () => {
      const mockIssues: Issue[] = [
        {
          id: 'issue-1',
          type: 'failed_events',
          severity: 'error',
          title: 'Failed Events',
          description: '3 events failed to process',
          count: 3,
        },
      ];

      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: TopIssuesPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchIssues();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.ISSUES_DETECT);
      expect(instance.state.issues).toEqual(mockIssues);
      expect(instance.state.loading).toBe(false);
      expect(instance.state.error).toBeNull();
    });

    test('should handle fetch error', async () => {
      const mockElectron = createMockElectron([], true);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: TopIssuesPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchIssues();

      expect(instance.state.loading).toBe(false);
      expect(instance.state.error).toBe('Test error');
    });
  });

  describe('issue sorting', () => {
    test('should sort errors before warnings', async () => {
      const mockIssues: Issue[] = [
        {
          id: 'issue-1',
          type: 'pending_events',
          severity: 'warning',
          title: 'Pending Events',
          description: '5 events pending',
          count: 5,
        },
        {
          id: 'issue-2',
          type: 'failed_events',
          severity: 'error',
          title: 'Failed Events',
          description: '3 events failed',
          count: 3,
        },
      ];

      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: TopIssuesPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchIssues();

      // Errors should come first
      expect(instance.state.issues[0].severity).toBe('error');
      expect(instance.state.issues[1].severity).toBe('warning');
    });

    test('should sort by count within same severity', async () => {
      const mockIssues: Issue[] = [
        {
          id: 'issue-1',
          type: 'failed_events',
          severity: 'error',
          title: 'Failed Events',
          description: '3 events failed',
          count: 3,
        },
        {
          id: 'issue-2',
          type: 'storage_high',
          severity: 'error',
          title: 'Storage High',
          description: 'Storage at 80%',
          count: 10,
        },
      ];

      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: TopIssuesPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchIssues();

      // Higher count should come first
      expect(instance.state.issues[0].count).toBe(10);
      expect(instance.state.issues[1].count).toBe(3);
    });

    test('should limit to 5 issues', async () => {
      const mockIssues: Issue[] = Array.from({ length: 10 }, (_, i) => ({
        id: `issue-${i}`,
        type: 'test',
        severity: 'warning',
        title: `Issue ${i}`,
        description: `Description ${i}`,
        count: i,
      }));

      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: TopIssuesPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchIssues();

      expect(instance.state.issues.length).toBe(5);
    });
  });

  describe('auto-refresh', () => {
    test('should auto-refresh when enabled', () => {
      jest.useFakeTimers();

      const mockIssues: Issue[] = [];
      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({
        electron: mockElectron,
        autoRefresh: true,
        refreshInterval: 1000,
      });

      const fetchIssuesSpy = jest.spyOn(instance, 'fetchIssues');

      instance.componentDidMount();

      // Initial call
      expect(fetchIssuesSpy).toHaveBeenCalledTimes(1);

      // Advance timer to trigger refresh
      jest.advanceTimersByTime(1000);

      expect(fetchIssuesSpy).toHaveBeenCalledTimes(2);

      instance.componentWillUnmount();
      jest.useRealTimers();
    });

    test('should not auto-refresh when disabled', () => {
      jest.useFakeTimers();

      const mockIssues: Issue[] = [];
      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({
        electron: mockElectron,
        autoRefresh: false,
      });

      const fetchIssuesSpy = jest.spyOn(instance, 'fetchIssues');

      instance.componentDidMount();

      // Initial call
      expect(fetchIssuesSpy).toHaveBeenCalledTimes(1);

      // Advance timer
      jest.advanceTimersByTime(60000);

      // Should still be 1 (no auto-refresh)
      expect(fetchIssuesSpy).toHaveBeenCalledTimes(1);

      instance.componentWillUnmount();
      jest.useRealTimers();
    });

    test('should cleanup timer on unmount', () => {
      const mockIssues: Issue[] = [];
      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({
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

  describe('action handlers', () => {
    test('should handle retry failed events', async () => {
      const mockIssues: Issue[] = [
        {
          id: 'issue-1',
          type: 'failed_events',
          severity: 'error',
          title: 'Failed Events',
          description: '3 events failed',
          count: 3,
        },
      ];

      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: TopIssuesPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;

      await instance.handleRetryFailed();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.EVENTS_RETRY_FAILED);
      expect(instance.state.actionInProgress).toBeNull();
    });

    test('should handle cleanup storage', async () => {
      const mockIssues: Issue[] = [
        {
          id: 'issue-1',
          type: 'storage_high',
          severity: 'warning',
          title: 'Storage High',
          description: 'Storage at 80%',
          count: 1,
        },
      ];

      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: TopIssuesPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;

      await instance.handleCleanupStorage();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
        IPC_CHANNELS.STORAGE_CLEANUP,
        { retentionDays: 30 },
      );
      expect(instance.state.actionInProgress).toBeNull();
    });

    test('should prevent double action', async () => {
      const mockIssues: Issue[] = [];
      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      instance.state.actionInProgress = 'retry-failed';

      await instance.handleRetryFailed();

      // Should not make IPC call when action in progress
      expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
        IPC_CHANNELS.EVENTS_RETRY_FAILED,
      );
    });
  });

  describe('rendering helpers', () => {
    test('should return correct severity icon', () => {
      const mockElectron = createMockElectron([]);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      expect(instance.getSeverityIcon('error')).toBe('✗');
      expect(instance.getSeverityIcon('warning')).toBe('⚠');
    });

    test('should render action button for failed events', () => {
      const mockElectron = createMockElectron([]);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      const issue: Issue = {
        id: 'issue-1',
        type: 'failed_events',
        severity: 'error',
        title: 'Failed Events',
        description: '3 events failed',
        count: 3,
      };

      const button = instance.getActionButton(issue);
      expect(button).toBeDefined();
      expect(button).not.toBeNull();
    });

    test('should render action button for storage high', () => {
      const mockElectron = createMockElectron([]);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      const issue: Issue = {
        id: 'issue-1',
        type: 'storage_high',
        severity: 'warning',
        title: 'Storage High',
        description: 'Storage at 80%',
        count: 1,
      };

      const button = instance.getActionButton(issue);
      expect(button).toBeDefined();
      expect(button).not.toBeNull();
    });

    test('should not render action button for unknown type', () => {
      const mockElectron = createMockElectron([]);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      const issue: Issue = {
        id: 'issue-1',
        type: 'unknown_type',
        severity: 'warning',
        title: 'Unknown Issue',
        description: 'Some issue',
        count: 1,
      };

      const button = instance.getActionButton(issue);
      expect(button).toBeNull();
    });
  });

  describe('rendering states', () => {
    test('should render empty state when no issues', () => {
      const mockElectron = createMockElectron([]);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });
      instance.state.issues = [];
      instance.state.loading = false;

      const emptyState = instance.renderEmptyState();
      expect(emptyState).toBeDefined();
      expect(emptyState).not.toBeNull();
    });

    test('should render issue list', () => {
      const mockIssues: Issue[] = [
        {
          id: 'issue-1',
          type: 'failed_events',
          severity: 'error',
          title: 'Failed Events',
          description: '3 events failed',
          count: 3,
        },
      ];

      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });
      instance.state.issues = mockIssues;
      instance.state.loading = false;

      const issue = instance.renderIssue(mockIssues[0]);
      expect(issue).toBeDefined();
      expect(issue).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    test('should handle empty issue array', async () => {
      const mockElectron = createMockElectron([]);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: TopIssuesPanel, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchIssues();

      expect(instance.state.issues).toEqual([]);
      expect(instance.state.loading).toBe(false);
    });

    test('should not update state after unmount', async () => {
      const mockIssues: Issue[] = [];
      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      instance.componentDidMount();
      instance.componentWillUnmount();

      // Try to fetch after unmount
      await instance.fetchIssues();

      // State should not be updated (mounted flag should prevent it)
      expect(instance['mounted']).toBe(false);
    });

    test('should not update state during action after unmount', async () => {
      const mockIssues: Issue[] = [];
      const mockElectron = createMockElectron(mockIssues);
      const instance = new TopIssuesPanel({ electron: mockElectron, autoRefresh: false });

      instance.componentDidMount();
      instance.componentWillUnmount();

      // Try to perform action after unmount
      await instance.handleRetryFailed();

      // State should not be updated (mounted flag should prevent it)
      expect(instance['mounted']).toBe(false);
    });
  });
});
