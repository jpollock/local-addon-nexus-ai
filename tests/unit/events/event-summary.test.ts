/**
 * Unit tests for event summary helpers
 */
import { generateEventSummary, generateEventSummaryShort } from '../../../src/main/events/event-summary';
import { EventQueueEntry } from '../../../src/main/events/types';

describe('Event Summary Helpers', () => {
  describe('generateEventSummary', () => {
    it('should generate summary for plugin_activated', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: { slug: 'akismet', name: 'Akismet Anti-Spam' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Plugin Activated: Akismet Anti-Spam');
    });

    it('should use slug if name is missing', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: { slug: 'test-plugin' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: null,
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Plugin Activated: test-plugin');
    });

    it('should generate summary for plugin_deactivated', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'plugin_deactivated',
        payload: { slug: 'hello-dolly', name: 'Hello Dolly' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Plugin Deactivated: Hello Dolly');
    });

    it('should generate summary for plugin_updated with version', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'plugin_updated',
        payload: { slug: 'akismet', name: 'Akismet', version: '5.0.2' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Plugin Updated: Akismet to v5.0.2');
    });

    it('should generate summary for post_created', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'post_created',
        payload: { post_id: 123, title: 'Hello World', post_type: 'post' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Post Created: "Hello World" (#123)');
    });

    it('should generate summary for post_updated', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'post_updated',
        payload: { post_id: 456, title: 'Updated Post' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Post Updated: "Updated Post" (#456)');
    });

    it('should handle post_deleted with missing title', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'post_deleted',
        payload: { post_id: 789 },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Post Deleted: "Untitled" (#789)');
    });

    it('should generate summary for user_created', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'user_created',
        payload: { user_id: 5, username: 'johndoe', email: 'john@example.com' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('User Created: johndoe (john@example.com)');
    });

    it('should handle user_created without email', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'user_created',
        payload: { user_id: 5, username: 'johndoe' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('User Created: johndoe (no email)');
    });

    it('should generate summary for user_updated', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'user_updated',
        payload: { user_id: 5, username: 'janedoe' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('User Updated: janedoe');
    });

    it('should generate summary for site_initialized', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'site_initialized',
        payload: { name: 'My WordPress Site', domain: 'example.local' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Site Initialized: My WordPress Site (example.local)');
    });

    it('should handle unknown event types gracefully', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'unknown_event_type' as any,
        payload: {},
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummary(event);
      expect(summary).toBe('Unknown Event Type');
    });
  });

  describe('generateEventSummaryShort', () => {
    it('should return plugin slug for plugin events', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: { slug: 'akismet', name: 'Akismet Anti-Spam' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummaryShort(event);
      expect(summary).toBe('akismet');
    });

    it('should return post title for content events', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'post_created',
        payload: { post_id: 123, title: 'Hello World' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummaryShort(event);
      expect(summary).toBe('Hello World');
    });

    it('should return post ID if title is missing', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'post_updated',
        payload: { post_id: 456 },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummaryShort(event);
      expect(summary).toBe('Post #456');
    });

    it('should return username for user events', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'user_created',
        payload: { user_id: 5, username: 'johndoe', email: 'john@example.com' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummaryShort(event);
      expect(summary).toBe('johndoe');
    });

    it('should return domain for site events', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'site_initialized',
        payload: { name: 'My Site', domain: 'example.local' },
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummaryShort(event);
      expect(summary).toBe('example.local');
    });

    it('should handle unknown event types', () => {
      const event: EventQueueEntry = {
        id: 1,
        site_id: 'site1',
        event_type: 'custom_event' as any,
        payload: {},
        status: 'processed',
        created_at: Date.now(),
        processed_at: Date.now(),
        error: null,
        retry_count: 0,
      };

      const summary = generateEventSummaryShort(event);
      expect(summary).toBe('custom event');
    });
  });
});
