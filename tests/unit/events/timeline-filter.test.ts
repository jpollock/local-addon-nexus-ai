import { isNoiseEvent, displayActor } from '../../../src/main/events/timelineFilter';
import type { EventQueueEntry } from '../../../src/main/events/types';

describe('isNoiseEvent', () => {
  test('auto-drafts and revisions are WordPress background churn', () => {
    expect(isNoiseEvent({ postType: 'revision', action: 'created' })).toBe(true);
    expect(isNoiseEvent({ postType: 'post', action: 'auto-draft' })).toBe(true);
  });

  test('real content changes are kept', () => {
    expect(isNoiseEvent({ postType: 'post', action: 'published' })).toBe(false);
    expect(isNoiseEvent({ postType: 'page', action: 'updated' })).toBe(false);
  });

  test('a missing post type is not assumed to be noise', () => {
    expect(isNoiseEvent({})).toBe(false);
  });

  test('a deliberate menu edit (nav_menu_item) is NOT treated as noise', () => {
    // Unlike revisions/auto-drafts, nav_menu_item posts are only written when
    // a person edits a menu in Appearance > Menus or the Customizer — a real
    // user-initiated change, not WordPress background mechanics. See the
    // module comment in timelineFilter.ts for the full reasoning.
    expect(isNoiseEvent({ postType: 'nav_menu_item', action: 'updated' })).toBe(false);
  });

  test('plugin and user events (no postType at all) are never classified as noise', () => {
    // Plugin/theme/user events never carry a postType or WordPress post
    // status — confirm the filter cannot accidentally swallow them.
    expect(isNoiseEvent({ postType: undefined, action: undefined })).toBe(false);
  });

  describe('integration shape — the real row the handler receives', () => {
    // EVENTS_GET_TIMELINE (src/main/ipc-handlers.ts) maps EventQueueEntry
    // rows from GraphService.getRecentEvents(). post_type and status live
    // inside `payload`, not at the top level of the row — there is no
    // `post_type` or `action` column on `event_queue` at all (see schema in
    // GraphService.ts). This test builds a real EventQueueEntry and proves
    // that extracting from `payload` (the correct path) classifies noise
    // correctly, and that extracting from nonexistent top-level fields (the
    // brief's original, wrong call-site code) would silently filter nothing
    // — exactly the bug this module exists to prevent.
    const autoDraftRow: EventQueueEntry = {
      id: 1,
      site_id: 'site-1',
      event_type: 'post_created',
      payload: {
        post_id: 42,
        post_type: 'post',
        title: 'Auto Draft',
        status: 'auto-draft',
        author_id: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      status: 'processed',
      created_at: Date.now(),
      processed_at: null,
      error: null,
      retry_count: 0,
    };

    test('extracting from payload.post_type/payload.status correctly flags churn', () => {
      expect(
        isNoiseEvent({ postType: autoDraftRow.payload.post_type, action: autoDraftRow.payload.status }),
      ).toBe(true);
    });

    test('demonstration: the top-level fields the brief originally named do not exist on the row', () => {
      // (autoDraftRow as any).post_type / .action are both undefined because
      // event_queue has no such columns — only payload.post_type and
      // payload.status carry this data. This documents why a call site that
      // reads e.post_type / e.action directly (as the brief's original Step
      // 5 code did) would silently filter nothing. This is a pure-function
      // demonstration, not proof of the real handler's behavior — that pin
      // lives in tests/integration/13-ipc-handlers-events.integration.test.ts,
      // which inserts a raw event_queue row and asserts on
      // EVENTS_GET_TIMELINE's actual output.
      const wrongExtraction = {
        postType: (autoDraftRow as any).post_type,
        action: (autoDraftRow as any).action,
      };
      expect(wrongExtraction.postType).toBeUndefined();
      expect(wrongExtraction.action).toBeUndefined();
      expect(isNoiseEvent(wrongExtraction)).toBe(false);
    });

    test('a real published post in the same row shape is kept', () => {
      const publishedRow: EventQueueEntry = {
        ...autoDraftRow,
        id: 2,
        event_type: 'post_published',
        payload: { ...autoDraftRow.payload, status: 'publish', title: 'Hello World' },
      };
      expect(
        isNoiseEvent({ postType: publishedRow.payload.post_type, action: publishedRow.payload.status }),
      ).toBe(false);
    });
  });
});

describe('displayActor', () => {
  test('an unresolvable actor is omitted, not printed as UNKNOWN', () => {
    expect(displayActor(null)).toBeNull();
    expect(displayActor(undefined)).toBeNull();
    expect(displayActor('UNKNOWN')).toBeNull();
    expect(displayActor('')).toBeNull();
  });

  test('UNKNOWN is matched case-insensitively and trims whitespace', () => {
    expect(displayActor('unknown')).toBeNull();
    expect(displayActor('  UNKNOWN  ')).toBeNull();
  });

  test('a real actor is passed through', () => {
    expect(displayActor('jeremy')).toBe('jeremy');
  });
});
