/**
 * WP-22 · which site the chat is standing in, and what the strip says about it.
 *
 * The panel used to send `selectedSiteIds[0]` from a state field that nothing ever
 * populated, so every turn reached `ChatService` with `siteId: undefined` — the site
 * block, the task frame and `nexus_where_am_i` all received nothing while the user
 * was looking straight at a site page. Everything downstream already worked; this
 * module is the missing input, expressed as data rather than as component state.
 *
 * Three rules live here and nowhere else:
 *
 * 1. **The route is the default.** Local puts its current path on its own shell
 *    (`<div class="Window" data-location="…">`, from `MainPage.tsx`), so the site on
 *    screen is a fact we can read rather than one we have to be told.
 * 2. **An explicit choice beats the route, and survives navigation** until the user
 *    clears it. This is the packet's one subtle behaviour: a user who pins a site and
 *    then walks around Local is still asking about the site they pinned.
 * 3. **No site means NO site** — an empty list, never a placeholder. A fabricated id
 *    would silently scope the answer to the wrong copy; an empty one is the honest
 *    input that makes the answer fleet-wide, which is what the strip then says.
 *
 * Controlled Vocabulary v1 governs every user-facing string below: "your copy", never
 * working copy / sandbox / environment. Docs finding №6 ("development (at WP Engine)"
 * on every reference) does not bind here because this strip never names a WP Engine
 * environment — it names a Local site, which is always the user's own copy. If a later
 * packet puts an environment in this band, that finding starts binding.
 *
 * Pure and dependency-free on purpose: it is the piece with the rules in it, so it is
 * the piece that gets tested and mutated.
 */

export type SiteContextMode = 'viewed' | 'override' | 'none';

export interface SiteContextSelection {
  mode: SiteContextMode;
  /** The site whose id rides on every CHAT_SEND. Null in 'none'. */
  siteId: string | null;
}

export interface StripCopy {
  /** The band's one line. */
  primary: string;
  /** The disclosure line. Present only when there is something the user cannot see. */
  secondary?: string;
  /** What the affordance beside the line says. */
  actionLabel: string;
}

/**
 * The id of the site page Local is showing, or null on every other screen.
 *
 * Matched against the route Local actually pushes — `/main/site-info/<id>`
 * (`app/renderer/app/App.tsx`). The renderer already had a `readSiteId()` in
 * `utils/panelReflow.ts` that matched `/site-info/<id>` with no `/main`, so it never
 * returned anything on a real screen; it has no callers and is left alone rather than
 * repaired, because the thing it was written for (scoping the collapsed tab's badge)
 * was deliberately abandoned for a fleet-wide count. This is the live parser.
 *
 * Anchored, not searched: `/main/blueprints/site-info/x` is not a site page, and a
 * substring match would scope the chat to a site from a screen that is not one.
 */
export function readViewedSiteId(location: string | null | undefined): string | null {
  if (!location) return null;
  // Local uses HashHistory, so the same route arrives as `#/main/site-info/<id>` when
  // it is read off `window.location.hash` instead of off the shell attribute.
  const path = location.charAt(0) === '#' ? location.slice(1) : location;
  const match = /^(?:\/main)?\/site-info\/([^/?#]+)/.exec(path);
  return match ? match[1] : null;
}

/**
 * The precedence reducer: an explicit choice, else the route, else nothing.
 *
 * A choice equal to the viewed site stays `'override'` rather than decaying to
 * `'viewed'`. They are the same site today and different rules tomorrow — decaying it
 * would drop the pin the moment the user navigated away, which is exactly the
 * behaviour the pin exists to prevent.
 */
export function resolveSiteContext(
  viewedSiteId: string | null,
  override: string | null,
): SiteContextSelection {
  if (override) return { mode: 'override', siteId: override };
  if (viewedSiteId) return { mode: 'viewed', siteId: viewedSiteId };
  return { mode: 'none', siteId: null };
}

/** The `selectedSiteIds` the chat sends. Empty is a real answer, not a missing one. */
export function selectionSiteIds(selection: SiteContextSelection): string[] {
  return selection.siteId ? [selection.siteId] : [];
}

/**
 * Every string the strip renders, in one place, so the vocabulary can be asserted
 * without mounting a component.
 *
 * The three states read differently on purpose. "Currently in" is a statement of where
 * you are; "No site selected — answers will be fleet-wide" is a statement of what will
 * happen, because there is no *where* to state. The override state adds the only fact
 * the user cannot see for themselves: that the chat is not following the screen.
 */
export function stripCopy(input: {
  mode: SiteContextMode;
  /** The site the chat is scoped to. Null only in 'none'. */
  siteName: string | null;
  /** The site on screen, when a site page is open. */
  viewedSiteName: string | null;
}): StripCopy {
  if (input.mode === 'none') {
    return {
      primary: 'No site selected — answers will be fleet-wide',
      actionLabel: 'Choose a site',
    };
  }

  const primary = `Currently in: ${input.siteName} — your copy`;

  if (input.mode === 'viewed') {
    return { primary, actionLabel: 'Change' };
  }

  const elsewhere = input.viewedSiteName && input.viewedSiteName !== input.siteName;
  return {
    primary,
    secondary: elsewhere
      ? `You're viewing ${input.viewedSiteName} — it stays on ${input.siteName} until you clear it.`
      : 'You chose this site — it stays until you clear it.',
    actionLabel: 'Clear',
  };
}
