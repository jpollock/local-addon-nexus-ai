/**
 * The mark has two renderers — React elements in the docked panel, an SVG string in
 * Local's vertical nav (which has no addon hook, so NavItemInjector writes markup).
 *
 * They drifted once already: the panel drew a four-point star, the nav drew an unrelated
 * gauge dial, and swapping the SVG asset files changed neither because neither read them.
 * These tests pin the thing that prevents a recurrence — both renderers derive from one
 * geometry — rather than pinning the two outputs separately, which would let them drift
 * again in lockstep with two edits.
 */
import { NexusGlyph } from '../../../src/renderer/components/DockedPanel/DockedPanel';
import {
  nexusMarkSvg,
  MARK_RING,
  MARK_DOT,
  RING_MIN_SIZE,
} from '../../../src/renderer/utils/nexusMark';

const kids = (g: any) => (Array.isArray(g.props.children) ? g.props.children : [g.props.children]).filter(Boolean);

describe('the Nexus mark has one definition', () => {
  it('both renderers draw the same ring geometry', () => {
    const svg = nexusMarkSvg(38);
    const [ring] = kids((NexusGlyph as any)({ size: 38 }));
    // Every number that defines the shape, asserted on both sides against the shared
    // source. A hand-edit to either renderer alone fails here.
    expect(ring.props.rx).toBe(MARK_RING.rx);
    expect(ring.props.ry).toBe(MARK_RING.ry);
    expect(ring.props.transform).toBe(MARK_RING.transform);
    expect(ring.props.strokeWidth).toBe(MARK_RING.strokeWidth);
    expect(svg).toContain(`rx="${MARK_RING.rx}"`);
    expect(svg).toContain(`ry="${MARK_RING.ry}"`);
    expect(svg).toContain(`transform="${MARK_RING.transform}"`);
    expect(svg).toContain(`stroke-width="${MARK_RING.strokeWidth}"`);
  });

  it('both renderers draw the same centre dot', () => {
    const svg = nexusMarkSvg(38);
    const dot = kids((NexusGlyph as any)({ size: 38 }))[1];
    expect(dot.props.r).toBe(MARK_DOT.r);
    expect(svg).toContain(`r="${MARK_DOT.r}"`);
  });

  it('both renderers apply the ring minimum identically', () => {
    const below = RING_MIN_SIZE - 1;
    expect(nexusMarkSvg(below)).not.toContain('ellipse');
    expect(kids((NexusGlyph as any)({ size: below })).map((c: any) => c.type)).toEqual(['circle']);

    expect(nexusMarkSvg(RING_MIN_SIZE)).toContain('ellipse');
    expect(kids((NexusGlyph as any)({ size: RING_MIN_SIZE })).map((c: any) => c.type))
      .toEqual(['ellipse', 'circle']);
  });

  it('both renderers take colour from context, never a baked fill', () => {
    // The mark sits on a light tab, on the brand-cyan avatar, and on Local's green nav.
    // A fill in the shape means a new hard-coded colour per placement.
    const svg = nexusMarkSvg(38);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('<svg viewBox="0 0 24 24" fill="none"');
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('the nav renders no mark other than this one', () => {
    // NavItemInjector's icon is built from nexusMarkSvg, not its own markup. The gauge it
    // used to carry was a <path> — the mark is an ellipse and a circle, nothing else.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/renderer/NavItemInjector.ts'),
      'utf8',
    );
    expect(src).toContain('nexusMarkSvg');
    expect(src).not.toContain('<path');
  });

  it('the nav asks for a size that keeps the ring', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/renderer/NavItemInjector.ts'),
      'utf8',
    );
    const declared = /const NAV_ICON_SIZE = (\d+);/.exec(src);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBeGreaterThanOrEqual(RING_MIN_SIZE);
    // The CSS width overrides the markup's, so a mismatch would silently bypass the
    // ring-minimum check the size is supposed to satisfy.
    expect(src).toContain('width: ${NAV_ICON_SIZE}px');
  });
});
