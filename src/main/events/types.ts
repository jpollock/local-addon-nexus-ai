/**
 * WordPress event types and data structures
 */

export type EventType =
  | 'post_created'
  | 'post_updated'
  | 'post_deleted'
  | 'post_trashed'
  | 'post_untrashed'
  | 'plugin_installed'
  | 'plugin_activated'
  | 'plugin_deactivated'
  | 'plugin_updated'
  | 'plugin_deleted'
  | 'theme_installed'
  | 'theme_activated'
  | 'theme_deleted'
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'site_initialized';

export type EventStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface WordPressEvent {
  site_id: string;
  event_type: EventType;
  timestamp: number;
  payload: EventPayload;
}

export type EventPayload =
  | PostEventPayload
  | PluginEventPayload
  | ThemeEventPayload
  | UserEventPayload
  | SiteEventPayload;

export interface PostEventPayload {
  post_id: number;
  post_type: string;
  title: string;
  content?: string;
  excerpt?: string;
  status: string;
  author_id: number;
  created_at: number;
  updated_at: number;
}

export interface PluginEventPayload {
  slug: string;
  name: string;
  version: string;
  is_active: boolean;
  author?: string;
  description?: string;
}

export interface ThemeEventPayload {
  slug: string;
  name: string;
  version: string;
  is_active: boolean;
  author?: string;
  description?: string;
}

export interface UserEventPayload {
  user_id: number;
  username: string;
  email?: string;
  roles: string[];
  created_at: number;
}

export interface SiteEventPayload {
  name: string;
  domain: string;
  wp_version: string;
  plugins?: Array<{
    slug: string;
    name: string;
    version: string;
    is_active: boolean;
  }>;
}

export interface QueuedEvent {
  id: number;
  site_id: string;
  event_type: EventType;
  payload: string;  // JSON
  status: EventStatus;
  created_at: number;
  processed_at: number | null;
  error: string | null;
  retry_count: number;
}

export interface Site {
  id: string;
  name: string;
  domain: string;
  wp_version?: string;
  last_sync_at?: number;
  is_active: boolean;
  created_at: number;
  updated_at: number;
  source?: 'local' | 'wpe';
  remote_install_id?: string;
  remote_domain?: string;
}

export interface Content {
  id: number;
  site_id: string;
  post_id: number;
  post_type: string;
  title: string;
  status: string;
  author_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface Plugin {
  id: number;
  site_id: string;
  slug: string;
  name: string;
  version: string | null;
  is_active: boolean;
  author: string | null;
  created_at: number;
  updated_at: number;
}

export interface Theme {
  id: number;
  site_id: string;
  slug: string;
  name: string;
  version: string | null;
  is_active: boolean;
  author: string | null;
  created_at: number;
  updated_at: number;
}

export interface User {
  id: number;
  site_id: string;
  user_id: number;
  username: string;
  email: string | null;
  roles: string;  // JSON array
  created_at: number;
  updated_at: number;
}

export interface Relationship {
  id: number;
  site_id: string;
  from_type: 'content' | 'plugin' | 'user';
  from_id: number;
  to_type: 'content' | 'plugin' | 'user';
  to_id: number;
  relationship_type: string;
  created_at: number;
}

export interface EventProcessorStats {
  total_events: number;
  pending_events: number;
  failed_events: number;
  processed_today: number;
  average_processing_time_ms: number;
}

export interface GraphStats {
  total_content: number;
  total_plugins: number;
  total_users: number;
  total_relationships: number;
  storage_size_bytes: number;
}

// ===== Sprint 1: Visibility Types =====

/**
 * Event queue entry with parsed payload
 */
export interface EventQueueEntry {
  id: number;
  site_id: string;
  event_type: EventType;
  payload: any;  // Parsed JSON
  status: 'pending' | 'processed' | 'failed';
  created_at: number;
  processed_at: number | null;
  error: string | null;
  retry_count: number;
}

/**
 * Event statistics for dashboard
 */
export interface EventStatsData {
  total: number;
  today: number;
  yesterday: number;
  pending: number;
  failed: number;
  by_type: Record<EventType, number>;
}

/**
 * Storage health metrics
 */
export interface StorageHealthData {
  graph_db: {
    size_bytes: number;
    path: string;
    event_count: number;
    oldest_event: number | null;
    newest_event: number | null;
  };
  vector_db: {
    size_bytes: number;
    path: string;
    table_count: number;
  };
  pending_events: number;
  failed_events: number;
}

/**
 * Issue detection for proactive alerts
 */
export interface IssueData {
  id: string;
  type: string;
  severity: 'warning' | 'error';
  title: string;
  description: string;
  count: number;
}
