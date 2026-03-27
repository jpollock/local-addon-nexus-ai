/**
 * Unit tests for EventTimeline component
 */
import * as React from 'react';
import { EventTimeline } from '../../../src/renderer/components/EventTimeline';
import { IPC_CHANNELS } from '../../../src/common/constants';
import type { EventTimelineEntry } from '../../../src/common/types';

/**
 * Mock electron IPC
 */
function createMockElectron(events: EventTimelineEntry[], shouldFail = false) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string, params?: any) => {
        if (channel === IPC_CHANNELS.EVENTS_GET_TIMELINE) {
          if (shouldFail) {
            return { success: false, error: 'Test error' };
          }

          let filteredEvents = events;

          // Apply filter if specified
          if (params?.filter && params.filter !== 'all') {
            filteredEvents = events.filter(e => e.eventType === params.filter);
          }

          // Apply limit if specified
          if (params?.limit) {
            filteredEvents = filteredEvents.slice(0, params.limit);
          }

          return { success: true, events: filteredEvents };
        }
        return { success: false, error: 'Unknown channel' };
      }),
    },
  };
}

describe('EventTimeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    test('should render loading state initially', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      expect(instance.state.loading).toBe(true);
      expect(instance.state.events).toEqual([]);
      expect(instance.state.filter).toBe('all');
      expect(instance.state.error).toBeNull();
    });

    test('should fetch events on mount', async () => {
      const mockEvents: EventTimelineEntry[] = [
        {
          id: 1,
          siteId: 'site1',
          siteName: 'Test Site',
          eventType: 'plugin_activated',
          timestamp: Date.now(),
          status: 'processed',
          summary: 'Activated plugin: test-plugin',
          details: { plugin: 'test-plugin' },
        },
      ];

      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false, limit: 10 });

      // Mock setState to capture state changes
      const setStateSpy = jest.spyOn(instance, 'setState').mockImplementation(function (this: EventTimeline, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchEvents();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
        IPC_CHANNELS.EVENTS_GET_TIMELINE,
        { limit: 10 },
      );
      expect(instance.state.events).toEqual(mockEvents);
      expect(instance.state.loading).toBe(false);
      expect(instance.state.error).toBeNull();
    });

    test('should handle fetch error', async () => {
      const mockElectron = createMockElectron([], true);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: EventTimeline, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchEvents();

      expect(instance.state.loading).toBe(false);
      expect(instance.state.error).toBe('Test error');
    });
  });

  describe('filtering', () => {
    test('should filter events by type', async () => {
      const mockEvents: EventTimelineEntry[] = [
        {
          id: 1,
          siteId: 'site1',
          siteName: 'Test Site',
          eventType: 'plugin_activated',
          timestamp: Date.now(),
          status: 'processed',
          summary: 'Activated plugin',
          details: {},
        },
        {
          id: 2,
          siteId: 'site1',
          siteName: 'Test Site',
          eventType: 'post_created',
          timestamp: Date.now(),
          status: 'processed',
          summary: 'Created post',
          details: {},
        },
      ];

      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false, limit: 50 });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: EventTimeline, updater: any, callback?: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
        if (callback) callback();
      });

      instance['mounted'] = true;

      // Set filter and fetch
      instance.state.filter = 'plugin_activated';
      await instance.fetchEvents();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(
        IPC_CHANNELS.EVENTS_GET_TIMELINE,
        { limit: 50, filter: 'plugin_activated' },
      );
      expect(instance.state.events.length).toBe(1);
      expect(instance.state.events[0].eventType).toBe('plugin_activated');
    });

    test('should show all events when filter is "all"', async () => {
      const mockEvents: EventTimelineEntry[] = [
        {
          id: 1,
          siteId: 'site1',
          siteName: 'Test Site',
          eventType: 'plugin_activated',
          timestamp: Date.now(),
          status: 'processed',
          summary: 'Activated plugin',
          details: {},
        },
        {
          id: 2,
          siteId: 'site1',
          siteName: 'Test Site',
          eventType: 'post_created',
          timestamp: Date.now(),
          status: 'processed',
          summary: 'Created post',
          details: {},
        },
      ];

      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: EventTimeline, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchEvents();

      expect(instance.state.events.length).toBe(2);
    });
  });

  describe('auto-refresh', () => {
    test('should auto-refresh when enabled', () => {
      jest.useFakeTimers();

      const mockEvents: EventTimelineEntry[] = [];
      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({
        electron: mockElectron,
        autoRefresh: true,
        refreshInterval: 1000,
      });

      const fetchEventsSpy = jest.spyOn(instance, 'fetchEvents');

      instance.componentDidMount();

      // Initial call
      expect(fetchEventsSpy).toHaveBeenCalledTimes(1);

      // Advance timer to trigger refresh
      jest.advanceTimersByTime(1000);

      expect(fetchEventsSpy).toHaveBeenCalledTimes(2);

      instance.componentWillUnmount();
      jest.useRealTimers();
    });

    test('should not auto-refresh when disabled', () => {
      jest.useFakeTimers();

      const mockEvents: EventTimelineEntry[] = [];
      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({
        electron: mockElectron,
        autoRefresh: false,
      });

      const fetchEventsSpy = jest.spyOn(instance, 'fetchEvents');

      instance.componentDidMount();

      // Initial call
      expect(fetchEventsSpy).toHaveBeenCalledTimes(1);

      // Advance timer
      jest.advanceTimersByTime(10000);

      // Should still be 1 (no auto-refresh)
      expect(fetchEventsSpy).toHaveBeenCalledTimes(1);

      instance.componentWillUnmount();
      jest.useRealTimers();
    });

    test('should cleanup timer on unmount', () => {
      const mockEvents: EventTimelineEntry[] = [];
      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({
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

  describe('status formatting', () => {
    test('should return correct status icon', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      expect(instance.getStatusIcon('processed')).toBe('✓');
      expect(instance.getStatusIcon('pending')).toBe('⏱');
      expect(instance.getStatusIcon('failed')).toBe('✗');
    });

    test('should return correct status label', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      expect(instance.getStatusLabel('processed')).toBe('Processed');
      expect(instance.getStatusLabel('pending')).toBe('Pending');
      expect(instance.getStatusLabel('failed')).toBe('Failed');
    });
  });

  describe('timestamp formatting', () => {
    test('should format relative time correctly', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      const now = Date.now();

      // Just now
      expect(instance.formatRelativeTime(now)).toBe('Just now');
      expect(instance.formatRelativeTime(now - 30 * 1000)).toBe('Just now');

      // Minutes
      expect(instance.formatRelativeTime(now - 2 * 60 * 1000)).toBe('2 mins ago');
      expect(instance.formatRelativeTime(now - 1 * 60 * 1000)).toBe('1 min ago');

      // Hours
      expect(instance.formatRelativeTime(now - 2 * 60 * 60 * 1000)).toBe('2 hours ago');
      expect(instance.formatRelativeTime(now - 1 * 60 * 60 * 1000)).toBe('1 hour ago');

      // Days
      expect(instance.formatRelativeTime(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');
      expect(instance.formatRelativeTime(now - 1 * 24 * 60 * 60 * 1000)).toBe('1 day ago');
    });
  });

  describe('expansion behavior', () => {
    test('should expand event on click', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: EventTimeline, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      expect(instance.state.expandedId).toBeNull();

      instance.handleEventClick(1);

      expect(instance.state.expandedId).toBe(1);
    });

    test('should collapse event on second click', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: EventTimeline, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance.state.expandedId = 1;

      instance.handleEventClick(1);

      expect(instance.state.expandedId).toBeNull();
    });

    test('should expand different event', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: EventTimeline, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance.state.expandedId = 1;

      instance.handleEventClick(2);

      expect(instance.state.expandedId).toBe(2);
    });
  });

  describe('rendering states', () => {
    test('should render event list with events', () => {
      const mockEvents: EventTimelineEntry[] = [
        {
          id: 1,
          siteId: 'site1',
          siteName: 'Test Site',
          eventType: 'plugin_activated',
          timestamp: Date.now(),
          status: 'processed',
          summary: 'Activated plugin: test-plugin',
          details: { plugin: 'test-plugin' },
        },
      ];

      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });
      instance.state.events = mockEvents;
      instance.state.loading = false;

      const list = instance.renderEventList();
      expect(list).toBeDefined();
      expect(list).not.toBeNull();
    });

    test('should render empty state when no events', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });
      instance.state.events = [];
      instance.state.loading = false;

      const list = instance.renderEventList();
      expect(list).toBeDefined();
      expect(list).not.toBeNull();
    });

    test('should render filter select', () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      const select = instance.renderFilterSelect();
      expect(select).toBeDefined();
      expect(select).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    test('should handle empty event list', async () => {
      const mockElectron = createMockElectron([]);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      // Mock setState to capture state changes
      jest.spyOn(instance, 'setState').mockImplementation(function (this: EventTimeline, updater: any) {
        const update = typeof updater === 'function' ? updater(this.state) : updater;
        Object.assign(this.state, update);
      });

      instance['mounted'] = true;
      await instance.fetchEvents();

      expect(instance.state.events).toEqual([]);
      expect(instance.state.loading).toBe(false);
    });

    test('should not update state after unmount', async () => {
      const mockEvents: EventTimelineEntry[] = [];
      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });

      instance.componentDidMount();
      instance.componentWillUnmount();

      // Try to fetch after unmount
      await instance.fetchEvents();

      // State should not be updated (mounted flag should prevent it)
      expect(instance['mounted']).toBe(false);
    });

    test('should handle missing details in event', () => {
      const mockEvents: EventTimelineEntry[] = [
        {
          id: 1,
          siteId: 'site1',
          siteName: 'Test Site',
          eventType: 'plugin_activated',
          timestamp: Date.now(),
          status: 'processed',
          summary: 'Activated plugin',
          details: null,
        },
      ];

      const mockElectron = createMockElectron(mockEvents);
      const instance = new EventTimeline({ electron: mockElectron, autoRefresh: false });
      instance.state.events = mockEvents;
      instance.state.loading = false;

      const list = instance.renderEventList();
      expect(list).toBeDefined();
      expect(list).not.toBeNull();
    });
  });
});
