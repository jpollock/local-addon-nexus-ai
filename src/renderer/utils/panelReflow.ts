/**
 * Panel reflow utilities — reserve space for the docked panel when Local's content has room.
 *
 * The governing rule (from the designer):
 * > The panel never compresses Local's content below its minimum usable width.
 * > Nexus is a guest on these screens, and a guest doesn't resize the room.
 *
 * | State    | Behaviour |
 * |----------|-----------|
 * | closed   | Floating tab — always an overlay, reserves nothing |
 * | docked   | 380px — in flow only if remaining width ≥ 1000px AND Local's root was found |
 * | wide     | 620px — always an overlay (at this width the conversation IS the task) |
 * | full     | Always an overlay |
 *
 * In-flow means the panel reserves space via padding-right on Local's root element.
 * Overlay means a border + shadow with no layout change.
 *
 * **Reflow now exists for exactly one case: docked, in-flow.** The collapsed state used to
 * reserve a 48px strip, which meant the mechanism ran nearly all the time — and when it
 * targeted the wrong box, it clipped Local's own site header and the "Open site" action.
 * The collapsed state is a floating tab now (`DockedPanel.tsx`): it overlays, reserves
 * nothing, and structurally cannot occupy the header or footer band. That removes host
 * reflow from the state the panel spends most of its life in.
 */

export type PanelState = 'closed' | 'docked' | 'wide' | 'full';

/** 380px docked panel (from spec: available − 380 ≥ 1000) */
export const PANEL_WIDTH = 380;
/** 620px wide panel */
export const WIDE_WIDTH = 620;
/** Minimum width Local's content must retain when a panel is in-flow */
const MIN_CONTENT_WIDTH = 1000;

/**
 * Compute the reflow mode for a given panel state and available width.
 *
 * @param panelState - Current panel state
 * @param availableWidth - Total width of Local's content container
 * @param hostRootFound - Whether `findLocalRoot()` located Local's content container.
 *   Required, deliberately not defaulted: a default of `true` would let a new caller
 *   silently inherit "assume we can reflow", which is the same silent-fallback failure
 *   this parameter exists to close.
 * @returns 'in-flow' if the panel should reserve space in the layout; 'overlay' otherwise
 */
export function computeReflowMode(
  panelState: PanelState,
  availableWidth: number,
  hostRootFound: boolean,
): 'in-flow' | 'overlay' {
  if (!hostRootFound) {
    // No host root means there is no box to reserve space in. Overlaying is the honest
    // fallback: it renders correctly without needing to modify a layout we cannot find.
    return 'overlay';
  }
  if (panelState === 'docked') {
    // Docked is in-flow only if remaining width ≥ 1000px
    return availableWidth - PANEL_WIDTH >= MIN_CONTENT_WIDTH ? 'in-flow' : 'overlay';
  }
  // closed (floating tab), wide and full are always overlay
  return 'overlay';
}

/**
 * Compute the padding-right to apply to Local's root element.
 *
 * @param panelState - Current panel state
 * @param reflowMode - Whether the panel is in-flow or overlay
 * @returns Padding in pixels
 */
export function computePaddingRight(
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
  // re-enabling in-flow for one of them is a deliberate edit here, not an inherited 48px.
  return 0;
}

/**
 * Find Local's root content element — the one we will pad to reserve space.
 *
 * Only consulted for the docked in-flow case. Returns null when Local's content container
 * cannot be found, and says so: this used to fall back to `#root`, which is the React root
 * of the whole app rather than the content container, so the mechanism padded the wrong box
 * while every downstream measurement still looked healthy. A fallback that changes which
 * element is modified is not a fallback — it is different behaviour wearing the same name.
 *
 * @returns The element to pad, or null if not found
 */
export function findLocalRoot(): HTMLElement | null {
  const app = document.querySelector<HTMLElement>('[class*="App_"]');
  if (app) return app;
  console.warn(
    '[Nexus] Panel reflow disabled: Local\'s content container ([class*="App_"]) was not found. ' +
      'The docked panel will overlay instead of reserving space. If Local\'s markup has changed, ' +
      'update findLocalRoot() in src/renderer/utils/panelReflow.ts rather than adding a fallback selector.',
  );
  return null;
}
