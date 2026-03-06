/**
 * Event summary generation utility
 */
import { EventType, EventQueueEntry } from './types';

/**
 * Generate human-readable summary from event
 */
export function generateEventSummary(event: EventQueueEntry): string {
  const payload = event.payload;
  const eventType: string = event.event_type;

  switch (event.event_type) {
    // Plugin events
    case 'plugin_activated':
      return `Plugin Activated: ${payload.name || payload.slug}`;

    case 'plugin_deactivated':
      return `Plugin Deactivated: ${payload.name || payload.slug}`;

    case 'plugin_updated':
      return `Plugin Updated: ${payload.name || payload.slug} to v${payload.version}`;

    case 'plugin_deleted':
      return `Plugin Deleted: ${payload.name || payload.slug}`;

    // Content events
    case 'post_created':
      return `Post Created: "${payload.title}" (#${payload.post_id})`;

    case 'post_updated':
      return `Post Updated: "${payload.title}" (#${payload.post_id})`;

    case 'post_deleted':
      return `Post Deleted: "${payload.title || 'Untitled'}" (#${payload.post_id})`;

    // User events
    case 'user_created':
      return `User Created: ${payload.username} (${payload.email || 'no email'})`;

    case 'user_updated':
      return `User Updated: ${payload.username}`;

    case 'user_deleted':
      return `User Deleted: ${payload.username}`;

    // Site events
    case 'site_initialized':
      return `Site Initialized: ${payload.name} (${payload.domain})`;

    default:
      // Fallback: convert event_type to Title Case
      return eventType
        .split('_')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
  }
}

/**
 * Generate short summary (for compact displays)
 */
export function generateEventSummaryShort(event: EventQueueEntry): string {
  const payload = event.payload;
  const eventType: string = event.event_type;

  switch (event.event_type) {
    case 'plugin_activated':
    case 'plugin_deactivated':
    case 'plugin_updated':
    case 'plugin_deleted':
      return payload.slug || payload.name || 'Unknown Plugin';

    case 'post_created':
    case 'post_updated':
    case 'post_deleted':
      return payload.title || `Post #${payload.post_id}`;

    case 'user_created':
    case 'user_updated':
    case 'user_deleted':
      return payload.username || payload.email || 'Unknown User';

    case 'site_initialized':
      return payload.domain || payload.name || 'Unknown Site';

    default:
      return eventType.replace(/_/g, ' ');
  }
}
