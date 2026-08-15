/**
 * First producer (migration step 1, README §"Wiring"): WordPress webhook
 * events -> envelope drafts.
 *
 * The event_queue pipeline keeps working exactly as before — this producer
 * TAPS the same flow and stops the data from being dropped. Mapping:
 *
 *   plugin_*          -> state.plugin.observed   (folds into twin_facts)
 *   theme_*           -> state.theme.observed
 *   user_*            -> state.user.observed
 *   site_initialized  -> state.site.observed
 *   post_*            -> semantic.content.changed (re-index trigger, later)
 *
 * observed_at is server-stamped now: the webhook fires at change time, so
 * "now" is honest to within delivery latency. When observers with real
 * source timestamps exist, they pass their own observed_at.
 */
import { EventDraft } from '../../intelligence';
import { provisionalEnvironmentId, provisionalSiteId } from './provisionalEntity';

const PLUGIN_VERBS: Record<string, string> = {
  plugin_installed: 'observed',
  plugin_activated: 'observed',
  plugin_deactivated: 'observed',
  plugin_updated: 'observed',
  plugin_deleted: 'removed',
};

export function draftFromWpEvent(
  siteId: string,
  eventType: string,
  payload: Record<string, unknown>,
  observedAt: Date
): EventDraft | null {
  const base = {
    observed_at: observedAt.toISOString(),
    entity: {
      site: provisionalSiteId(siteId),
      environment: provisionalEnvironmentId(siteId),
    },
    // The MU-plugin webhook is the platform speaking about itself.
    actor: { id: 'act_wp_webhook', kind: 'system' as const },
    source: { class: 'platform' as const, system: 'wp-webhook', trust: 'observed' as const },
  };

  if (eventType.startsWith('plugin_')) {
    const verb = PLUGIN_VERBS[eventType] ?? 'observed';
    return {
      ...base,
      topic: `state.plugin.${verb}`,
      schema: 'plugin.observed/1',
      payload: {
        slug: String(payload.slug ?? ''),
        version: String(payload.version ?? ''),
        active: eventType === 'plugin_deleted' ? false : Boolean(payload.is_active),
        change: eventType,
      },
    };
  }

  if (eventType.startsWith('theme_')) {
    return {
      ...base,
      topic: 'state.theme.observed',
      schema: 'theme.observed/1',
      payload: {
        slug: String(payload.slug ?? ''),
        version: String(payload.version ?? ''),
        active: eventType === 'theme_deleted' ? false : Boolean(payload.is_active),
        change: eventType,
      },
    };
  }

  if (eventType.startsWith('user_')) {
    return {
      ...base,
      topic: 'state.user.observed',
      schema: 'user.observed/1',
      payload: {
        user_id: Number(payload.user_id ?? 0),
        username: String(payload.username ?? ''),
        roles: Array.isArray(payload.roles) ? payload.roles : [],
        change: eventType,
      },
    };
  }

  if (eventType === 'site_initialized') {
    return {
      ...base,
      topic: 'state.site.observed',
      schema: 'site.observed/1',
      payload: {
        name: String(payload.name ?? ''),
        domain: String(payload.domain ?? ''),
        wp_version: String(payload.wp_version ?? ''),
      },
    };
  }

  if (eventType.startsWith('post_')) {
    return {
      ...base,
      topic: 'semantic.content.changed',
      schema: 'content.changed/1',
      payload: {
        post_id: Number(payload.post_id ?? 0),
        post_type: String(payload.post_type ?? ''),
        status: String(payload.status ?? ''),
        change: eventType,
      },
    };
  }

  return null; // unknown event type — the tap ignores rather than guesses
}
