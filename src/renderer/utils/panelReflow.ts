/**
 * Panel reflow utilities — make docked/wide states in-flow when Local's content has room.
 *
 * The governing rule (from the designer):
 * > The panel never compresses Local's content below its minimum usable width.
 * > Nexus is a guest on these screens, and a guest doesn't resize the room.
 *
 * | State    | Behaviour |
 * |----------|-----------|
 * | closed   | 48px rail — always in flow (small enough to afford) |
 * | docked   | 384px — in flow only if remaining width ≥ 1000px; overlay otherwise |
 * | wide     | 620px — always an overlay (at this width the conversation IS the task) |
 * | full     | Always an overlay |
 *
 * In-flow means the panel reserves space via padding-right on Local's root element.
 * Overlay means a border + shadow with no layout change.
 */

export type PanelState = 'closed' | 'docked' | 'wide' | 'full';

/** 380px docked panel (from spec: available − 380 ≥ 1000) */
export const PANEL_WIDTH = 380;
/** 620px wide panel */
export const WIDE_WIDTH = 620;
/** 48px rail (closed state) */
const RAIL_WIDTH = 48;
/** Minimum width Local's content must retain when a panel is in-flow */
const MIN_CONTENT_WIDTH = 1000;

/**
 * Compute the reflow mode for a given panel state and available width.
 *
 * @param panelState - Current panel state
 * @param availableWidth - Total width of Local's content container
 * @returns 'in-flow' if the panel should reserve space in the layout; 'overlay' otherwise
 */
export function computeReflowMode(
  panelState: PanelState,
  availableWidth: number,
): 'in-flow' | 'overlay' {
  if (panelState === 'closed') {
    // 48px rail is always in-flow
    return 'in-flow';
  }
  if (panelState === 'docked') {
    // Docked is in-flow only if remaining width ≥ 1000px
    return availableWidth - PANEL_WIDTH >= MIN_CONTENT_WIDTH ? 'in-flow' : 'overlay';
  }
  // wide and full are always overlay
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
  if (panelState === 'closed') {
    return RAIL_WIDTH;
  }
  if (panelState === 'docked') {
    return PANEL_WIDTH;
  }
  // wide and full are never in-flow, so this branch is unreachable when called correctly
  return 0;
}

/**
 * Find Local's root content element — the one we will pad to reserve space.
 *
 * Local's DOM structure (verified 2026-08-11):
 * - `#root` is the React root
 * - `[class*="App_"]` is the actual content container that needs padding
 *
 * @returns The element to pad, or null if not found
 */
export function findLocalRoot(): HTMLElement | null {
  // Try the specific class pattern first
  const app = document.querySelector<HTMLElement>('[class*="App_"]');
  if (app) return app;
  // Fallback to #root if the class pattern changes
  const root = document.getElementById('root');
  return root;
}
