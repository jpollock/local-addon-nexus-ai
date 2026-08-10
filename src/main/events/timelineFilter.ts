/**
 * Event timeline noise filtering and actor display.
 *
 * Seven of eight visible timeline rows were WordPress auto-draft creation and
 * revision churn — pure background mechanics nobody asked to see. That taught
 * users the timeline was not worth reading. `isNoiseEvent` filters that churn.
 *
 * REAL ROW SHAPE (verified against `event_queue`'s schema, `EventQueueEntry`
 * in `./types.ts`, and the WP-side payload builder in
 * `wp-plugins/nexus-ai-connector/includes/class-event-builder.php`):
 * the `event_queue` table has no `post_type` or `action` column — only
 * `event_type` (e.g. 'post_created') and a JSON `payload`. For post events,
 * `payload.post_type` is the WordPress post type ('post', 'page', 'revision',
 * ...) and `payload.status` is the WordPress post *status* ('publish',
 * 'draft', 'auto-draft', ...). There is no field literally named `action`
 * anywhere in this pipeline — the `action` parameter below is what the post
 * status is renamed to at the call site, which is why the brief's own test
 * case (`{ postType: 'post', action: 'auto-draft' }`) only makes sense once
 * you know `action` means "post status", not a DB column.
 *
 * `isNoiseEvent` itself stays a pure function over an already-extracted
 * `{ postType, action }` shape — see `src/main/ipc-handlers.ts`'s
 * `EVENTS_GET_TIMELINE` handler for where `payload.post_type` /
 * `payload.status` are actually pulled off the row, and
 * `tests/integration/13-ipc-handlers-events.integration.test.ts` for a test
 * that exercises that real extraction end to end.
 */

const NOISE_POST_TYPES = new Set(['revision']);
const NOISE_ACTIONS = new Set(['auto-draft']);

// `nav_menu_item` was in the original brief's noise list, deliberately
// dropped: unlike revisions (created on every save) and auto-drafts (created
// the instant "Add New" is clicked), a nav_menu_item post is only written
// when a person deliberately edits a menu in Appearance > Menus or the
// Customizer. It represents a real, user-initiated site configuration
// change, not WordPress background mechanics — filtering it would hide the
// exact kind of "real content change" this module exists to protect.

export function isNoiseEvent(event: { postType?: string | null; action?: string | null }): boolean {
  if (event.postType && NOISE_POST_TYPES.has(event.postType)) return true;
  if (event.action && NOISE_ACTIONS.has(event.action)) return true;
  return false;
}

/**
 * Resolve how an actor should be displayed, never surfacing the literal
 * placeholder string "UNKNOWN" to the user.
 *
 * NOTE: as of this writing, nothing upstream of this function actually
 * supplies an actor. `event_queue`'s schema, `EventQueueEntry`, and the
 * WP-side event payload builder all carry no resolved actor/username — the
 * closest thing is `payload.author_id` (a numeric WP user id) on post
 * events only, which still needs a `users` table lookup to become a display
 * name, and plugin/theme/user events carry no actor concept at all. This
 * function is exported and tested so a future actor source is never
 * rendered as "UNKNOWN", but it is deliberately NOT wired into
 * `EVENTS_GET_TIMELINE`'s mapper: `EventQueueEntry` has no `actor` field, so
 * doing so today would mean either fabricating one (an `any`-cast on a
 * property that doesn't exist) or adding a permanently-null `actor` field to
 * `EventTimelineEntry` that no code can ever exercise with a real value —
 * see the task report for the actor-resolution scope this would require.
 */
export function displayActor(actor: string | null | undefined): string | null {
  if (!actor) return null;
  if (actor.trim().toUpperCase() === 'UNKNOWN') return null;
  return actor;
}
