import type { AgentEventBus } from '../AgentEventBus';

// Maps existing WordPress event_type strings to agent event namespace:type
const WP_EVENT_MAP: Record<string, { namespace: string; type: string }> = {
  post_created:         { namespace: 'wp', type: 'post.created' },
  post_updated:         { namespace: 'wp', type: 'post.updated' },
  post_deleted:         { namespace: 'wp', type: 'post.deleted' },
  plugin_installed:     { namespace: 'wp', type: 'plugin.installed' },
  plugin_activated:     { namespace: 'wp', type: 'plugin.activated' },
  plugin_deactivated:   { namespace: 'wp', type: 'plugin.deactivated' },
  plugin_updated:       { namespace: 'wp', type: 'plugin.updated' },
  plugin_deleted:       { namespace: 'wp', type: 'plugin.deleted' },
  theme_installed:      { namespace: 'wp', type: 'theme.installed' },
  theme_activated:      { namespace: 'wp', type: 'theme.activated' },
  theme_deleted:        { namespace: 'wp', type: 'theme.deleted' },
  user_created:         { namespace: 'wp', type: 'user.created' },
  user_updated:         { namespace: 'wp', type: 'user.updated' },
  user_deleted:         { namespace: 'wp', type: 'user.deleted' },
  site_initialized:     { namespace: 'wp', type: 'site.initialized' },
};

/**
 * Returns an onEvent callback to pass to HttpEventInterface.
 * HttpEventInterface must be updated to call this after processing each event.
 */
export function createWpEventsBridgeHandler(bus: AgentEventBus) {
  return function onWpEvent(siteId: string, eventType: string, payload: Record<string, unknown>) {
    const mapped = WP_EVENT_MAP[eventType];
    if (!mapped) return;
    bus.publish({
      namespace: mapped.namespace,
      type: mapped.type,
      key: `${mapped.namespace}:${mapped.type}`,
      siteId,
      payload,
      createdAt: Date.now(),
    });
  };
}
