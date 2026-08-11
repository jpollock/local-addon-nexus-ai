/**
 * The Nexus mark — one definition, two renderers.
 *
 * The mark is drawn in two incompatible ways: as React elements inside the docked panel,
 * and as an HTML string injected into Local's vertical nav (which has no addon hook, so
 * `NavItemInjector` writes markup directly). Both used to carry their own copy of the
 * geometry, and they drifted: the panel showed a four-point star while the nav showed an
 * unrelated gauge dial. Swapping the SVG assets fixed neither, because neither read them.
 *
 * So the geometry lives here and both renderers derive from it. A future mark change is
 * one edit; a future third placement gets it for free.
 *
 * Colour is always `currentColor`. The mark appears on a light tab, on the brand-cyan
 * avatar, and on Local's green nav at 70% white — a fill baked into the shape would need
 * a new hard-coded colour for each.
 */

export const MARK_VIEWBOX = '0 0 24 24';

/** The tilted orbit ring. Stroke is in viewBox units, so it scales with declared size. */
export const MARK_RING = {
  cx: 12,
  cy: 12,
  rx: 10.4,
  ry: 4.7,
  transform: 'rotate(-32 12 12)',
  strokeWidth: 1.9,
} as const;

/** The solid centre. Also the whole mark below RING_MIN_SIZE. */
export const MARK_DOT = { cx: 12, cy: 12, r: 2.9 } as const;

/**
 * Below this declared size the ring's 1.9-unit stroke thins until it greys out and the
 * mark reads as a smudge. Under it, render the dot alone rather than a faint ring.
 */
export const RING_MIN_SIZE = 20;

/**
 * The mark as an SVG string, for the one place that cannot use React: Local's vertical
 * nav, which `NavItemInjector` builds with innerHTML.
 */
export function nexusMarkSvg(size: number): string {
  const ring = size >= RING_MIN_SIZE
    ? `<ellipse cx="${MARK_RING.cx}" cy="${MARK_RING.cy}" rx="${MARK_RING.rx}" ry="${MARK_RING.ry}" `
      + `transform="${MARK_RING.transform}" fill="none" stroke="currentColor" stroke-width="${MARK_RING.strokeWidth}"/>`
    : '';
  return `<svg viewBox="${MARK_VIEWBOX}" fill="none" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + ring
    + `<circle cx="${MARK_DOT.cx}" cy="${MARK_DOT.cy}" r="${MARK_DOT.r}" fill="currentColor"/>`
    + '</svg>';
}
