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

import { SCOPE_LINE } from './openingCopy.generated';

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
  /** The content age. Present ONLY when a pull is on record — see `contentAgeChip`. */
  chip?: string;
  /** What the affordance beside the line says. */
  actionLabel: string;
}

/**
 * WP-22b · what the one IPC channel carries back, mirrored (`intelligence-host/
 * siteContentStatus.ts` is the producer).
 *
 * `null` from that channel is a FOURTH state, not a fallback: it means Nexus AI is
 * not recording, which is a fact about Nexus AI. The three states below are facts
 * about the copy, each with its own remedy. The chip is silent for all four except
 * `pulled`, but they arrive distinct so a later surface can still tell them apart.
 */
export interface SiteContentStatus {
  state: 'pulled' | 'no-sync' | 'ambiguous' | 'unlinked';
  sourceName?: string;
  behindSeconds?: number;
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
 * you are; "Asking about the whole fleet" (WP-49 §5) names the subject instead,
 * because there is no *where* to state. The override state adds the only fact
 * the user cannot see for themselves: that the chat is not following the screen.
 */
export function stripCopy(input: {
  mode: SiteContextMode;
  /** The site the chat is scoped to. Null only in 'none'. */
  siteName: string | null;
  /** The site on screen, when a site page is open. */
  viewedSiteName: string | null;
  /** What the record says about this copy's content. Absent until the read answers. */
  content?: SiteContentStatus | null;
}): StripCopy {
  if (input.mode === 'none') {
    // No site, so no copy, so no content age. There is nothing for a chip to be about.
    //
    // WP-49 · §5's SCOPE LINE, RATIFIED — "Asking about *the whole fleet* ·
    // *Choose a site*". Both spans are extracted from the designer's own sheet
    // rather than retyped, and the sheet's emphasis marks are what say which one
    // is the subject and which is the control. It replaces "No site selected —
    // answers will be fleet-wide", which said the same thing as a consequence
    // instead of as a subject; the action label was already the ratified word.
    return {
      primary: `${SCOPE_LINE.LEAD} ${SCOPE_LINE.FLEET}`,
      actionLabel: SCOPE_LINE.ACTION,
    };
  }

  const primary = `Currently in: ${input.siteName} — your copy`;
  const chip = contentAgeChip(input.content);

  if (input.mode === 'viewed') {
    return { primary, ...(chip ? { chip } : {}), actionLabel: 'Change' };
  }

  const elsewhere = input.viewedSiteName && input.viewedSiteName !== input.siteName;
  return {
    primary,
    ...(chip ? { chip } : {}),
    secondary: elsewhere
      ? `You're viewing ${input.viewedSiteName} — it stays on ${input.siteName} until you clear it.`
      : 'You chose this site — it stays until you clear it.',
    actionLabel: 'Clear',
  };
}

/**
 * The IPC boundary's guard: anything that is not recognisably a content status
 * becomes `null`, which is already a state this surface renders correctly.
 *
 * The chip's own conditions would refuse a malformed payload anyway; this exists so
 * a shape nobody designed for cannot be carried around in component state and read
 * by some later consumer as though the boundary had vouched for it.
 */
export function asContentStatus(value: unknown): SiteContentStatus | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { state?: unknown; sourceName?: unknown; behindSeconds?: unknown };
  if (
    row.state !== 'pulled' &&
    row.state !== 'no-sync' &&
    row.state !== 'ambiguous' &&
    row.state !== 'unlinked'
  ) {
    return null;
  }
  return {
    state: row.state,
    ...(typeof row.sourceName === 'string' && row.sourceName ? { sourceName: row.sourceName } : {}),
    ...(typeof row.behindSeconds === 'number' && Number.isFinite(row.behindSeconds)
      ? { behindSeconds: row.behindSeconds }
      : {}),
  };
}

/**
 * WP-22b · the content-age chip, or nothing.
 *
 * Controlled Vocabulary v1: **"pulled from <source> <time> ago"**, and the unit is
 * TIME (docs finding №3 — content is measured in time, code in items; a chip
 * carrying an item count would be the other flow's fact in this one's words).
 *
 * **Omit, never "unknown"** (WP-16 doctrine). Three of the four things the read can
 * say are absences with different remedies — no recorded sync, more than one place
 * it could have come from, nothing on record at all — and a chip reading "content
 * age unknown" would collapse them into one shrug while taking up the space where
 * the answer goes. The prose form (`nexus_where_am_i`) is where those absences are
 * explained; a five-word chip cannot do it and must not pretend to.
 *
 * An age with no source, or a source with no age, is likewise not rendered: half of
 * this sentence is not a shorter sentence, it is a different claim.
 */
export function contentAgeChip(content: SiteContentStatus | null | undefined): string | null {
  if (!content || content.state !== 'pulled') return null;
  if (!content.sourceName) return null;
  const seconds = content.behindSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return `Pulled from ${content.sourceName} ${durationPhrase(seconds)} ago`;
}

/**
 * The same plain-English duration `siteStatus.ts` renders into its prose line.
 *
 * It exists twice because main and renderer do not share a bundle — the same reason
 * `localDay` and `resolveAgentCron` do — and the two copies are pinned together over
 * a shared case table in `tests/unit/renderer/contentAgePhrase.test.ts`. Change one
 * and that test fails; change neither and the chip and the "where am I?" answer can
 * never disagree about how old the same copy is.
 */
function durationPhrase(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 3600) return 'less than an hour';
  if (seconds < 86_400) return plural(Math.round(seconds / 3600), 'hour');
  return plural(Math.round(seconds / 86_400), 'day');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
