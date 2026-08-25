/**
 * The seam between Nexus's panel and Local's application shell.
 *
 * The governing rule (from the designer):
 * > The panel never compresses Local's content below its minimum usable width.
 * > Nexus is a guest on these screens, and a guest doesn't resize the room.
 *
 * | State    | Behaviour |
 * |----------|-----------|
 * | closed   | Floating tab — always an overlay, reserves nothing |
 * | docked   | 380px — in flow only if remaining width ≥ 1000px AND Local's shell was found |
 * | wide     | 620px — always an overlay (at this width the conversation IS the task) |
 * | full     | Always an overlay |
 *
 * ## Why `.Window`, and why `right` rather than `padding-right`
 *
 * Local's shell is `<div class="Window ..." data-location="/site-info/:id">`, rendered by
 * `app/renderer/_components/Window.tsx` via `classnames('Window', …)`. That class is a
 * plain global string, NOT a CSS-module hash, so it is stable to match on — unlike the
 * `App_`-prefixed guess this used to make, which never matched anything.
 *
 * `Window.scss` styles it `position: absolute; top/right/bottom/left: 0`. An absolutely
 * positioned element resolves its offsets against the nearest *positioned* ancestor, so
 * `padding-right` on `#root` did not move it — that is why the padding was measurably
 * applied and visibly did nothing, and why Local's site header and its "Open site" /
 * "WP Admin" actions kept getting covered.
 *
 * Setting `right` on `.Window` itself moves the shell's own right edge, so every flex
 * child inside it — header, tab row, content — reflows. One property, no containing-block
 * subtleties, and clearing it restores the stylesheet's `right: 0`.
 */

export type PanelState = 'closed' | 'docked' | 'full';

/** 380px docked panel (from spec: available − 380 ≥ 1000) */
export const PANEL_WIDTH = 380;
/** Minimum width Local's content must retain when a panel is in-flow */
const MIN_CONTENT_WIDTH = 1000;

/**
 * Compute the reflow mode for a given panel state and available width.
 *
 * @param panelState - Current panel state
 * @param availableWidth - The window's FULL width, not the shell's current width. Measuring
 *   the shell after it has already been shrunk feeds the reservation back into its own
 *   input: shrink 380 → remeasure → now below the threshold → flip to overlay → shell
 *   returns to full width → back above the threshold → flip again, forever.
 * @param hostRootFound - Whether `findLocalRoot()` located Local's shell. Required,
 *   deliberately not defaulted: a default of `true` would let a new caller silently
 *   inherit "assume we can reflow", which is the failure this parameter exists to close.
 * @returns 'in-flow' if the panel should reserve space in the layout; 'overlay' otherwise
 */
export function computeReflowMode(
  panelState: PanelState,
  availableWidth: number,
  hostRootFound: boolean,
): 'in-flow' | 'overlay' {
  if (!hostRootFound) {
    // No shell means there is no box to reserve space in. Overlaying is the honest
    // fallback: it renders correctly without needing to modify a layout we cannot find.
    return 'overlay';
  }
  if (panelState === 'docked') {
    return availableWidth - PANEL_WIDTH >= MIN_CONTENT_WIDTH ? 'in-flow' : 'overlay';
  }
  // closed (floating tab) and full are always overlay
  return 'overlay';
}

/**
 * Compute the width to reserve on Local's shell (applied as `right`).
 *
 * @returns Width in pixels; 0 means reserve nothing
 */
export function computeReservedWidth(
  panelState: PanelState,
  reflowMode: 'in-flow' | 'overlay',
): number {
  if (reflowMode === 'overlay') {
    return 0;
  }
  if (panelState === 'docked') {
    return PANEL_WIDTH;
  }
  // closed, wide and full are never in-flow. Kept total rather than throwing so that
  // re-enabling in-flow for one of them is a deliberate edit here, not an inherited strip.
  return 0;
}

/**
 * Find Local's application shell — the element whose right edge we move.
 *
 * Returns null when the shell cannot be found, and says so. This used to fall back to
 * `#root`, which is the React root of the whole app rather than the shell, so the
 * mechanism modified the wrong element while every downstream measurement still looked
 * healthy. A fallback that changes which element is modified is not a fallback — it is
 * different behaviour wearing the same name.
 */
export function findLocalRoot(): HTMLElement | null {
  // NEXUS-DOM-REACH: window-right-reservation
  const shell = document.querySelector<HTMLElement>('.Window');
  if (shell) return shell;
  console.warn(
    '[Nexus] Panel reflow disabled: Local\'s application shell (.Window) was not found. ' +
      'The docked panel will overlay instead of reserving space. If Local\'s markup has changed, ' +
      'update findLocalRoot() in src/renderer/utils/panelReflow.ts rather than adding a fallback selector.',
  );
  return null;
}

/**
 * Read the id of the site Local is currently showing, or null when not on a site screen.
 *
 * **DEAD, AND WRONG — do not call it.** It has no callers: it was written for the
 * collapsed tab's badge, that scoping was abandoned for an honest fleet-wide count (see
 * `DockedPanelContainer.tabSignals`), and the regex below never matched anything anyway,
 * because Local pushes `/main/site-info/<id>` and this looks for `/site-info/<id>`.
 * The live parser is `readViewedSiteId` in
 * `components/DockedPanel/siteContextModel.ts` (WP-22), which handles both forms and is
 * pinned by tests. This one is kept only because the comment below documents where
 * Local publishes its route, which is still the seam the live parser reads.
 *
 * Local puts the active route on the shell as `data-location` (`MainPage.tsx` passes
 * `data-location={currentPath}` into `Window`), so the current site is a DOM attribute
 * rather than something we have to infer. This is what makes the collapsed tab's badge
 * and stuck marker honest: they can be scoped to the site on screen instead of showing a
 * fleet number on a site page.
 *
 * @param root - Local's shell, from `findLocalRoot()`
 */
export function readSiteId(root: HTMLElement | null): string | null {
  // NEXUS-DOM-REACH: window-data-location-read
  const location = root?.getAttribute('data-location');
  if (!location) return null;
  // '/site-info/<id>' and '/site-info/<id>/<subroute>' both scope to <id>.
  const match = /^\/site-info\/([^/]+)/.exec(location);
  return match ? match[1] : null;
}
