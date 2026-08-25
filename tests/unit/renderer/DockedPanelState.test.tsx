import React from 'react';
import { DockedPanel, NexusGlyph, RING_MIN_SIZE, type PanelState } from '../../../src/renderer/components/DockedPanel/DockedPanel';

describe('DockedPanel — state enum', () => {
  const noop = () => {};
  const mockElectron = { ipcRenderer: { on: jest.fn(), invoke: jest.fn(), send: jest.fn(), removeListener: jest.fn() } };

  function renderPanel(panelState: PanelState) {
    const component = new DockedPanel({
      panelState,
      onOpen: noop,
      onClose: noop,
      onSetPanelState: noop,
    });
    return component.render();
  }

  describe('closed state', () => {
    it('renders the 52px floating tab, not the panel', () => {
      const tree = renderPanel('closed');
      expect(tree).toBeTruthy();
      const props = (tree as any).props;
      // Tab is the control itself, so it carries role='button'; the panel is 'complementary'
      expect(props.role).toBe('button');
      // Tab is narrower than any panel size
      expect(props.style.width).toBe(52);
      expect(props['aria-label']).toMatch(/closed/i);
    });

    it('the whole tab opens the panel — one hit target, not a separate chevron', () => {
      const tree = renderPanel('closed');
      const props = (tree as any).props;
      expect(props.onClick).toBeDefined();
      expect(props.tabIndex).toBe(0);
      const children = (tree as any).props.children;
      expect(children).toHaveLength(3); // mark, label, (stuck marker slot)
    });

    it('does not span the full height — it cannot occupy the header or footer band', () => {
      // This is the regression guard for the clipping bug, and the reason the collapsed
      // state stopped being a full-height rail. A strip pinned top:0/bottom:0 sits across
      // Local's site header and its "Open site" / "WP Admin" actions; reverting to that
      // shape must fail here rather than in a screenshot.
      // Asserted as the property, not the mechanism: the tab is anchored from ONE edge
      // and takes its height from its contents. Pinning both top and bottom, or setting
      // an explicit height, is what makes it a strip. This used to assert top:50% plus a
      // translate, which failed the moment the anchor moved to the bottom even though
      // the guarded property still held.
      const style = (renderPanel('closed') as any).props.style;
      const anchoredFromBothEdges = style.top !== undefined && style.bottom !== undefined;
      expect(anchoredFromBothEdges).toBe(false);
      expect(style.height).toBeUndefined();
    });
  });

  describe('closed state — the signals it exists to carry', () => {
    function renderTab(signals: Partial<React.ComponentProps<typeof DockedPanel>>) {
      return new DockedPanel({
        panelState: 'closed',
        onOpen: noop,
        onClose: noop,
        onSetPanelState: noop,
        ...signals,
      } as any).render();
    }

    /** Depth-first scan for a rendered element whose text content equals `text`. */
    function findByText(node: any, text: string): any {
      if (!node || typeof node !== 'object') return null;
      const kids = node.props?.children;
      const flat = Array.isArray(kids) ? kids : [kids];
      if (flat.length === 1 && flat[0] === text) return node;
      for (const k of flat) {
        const hit = findByText(k, text);
        if (hit) return hit;
      }
      return null;
    }

    it('renders the count badge when there are pending decisions', () => {
      const tree = renderTab({ badgeCount: 7 });
      expect(findByText(tree, '7')).not.toBeNull();
    });

    it('renders the stuck marker when something is stuck', () => {
      const tree = renderTab({ hasStuck: true });
      expect(findByText(tree, '!')).not.toBeNull();
    });

    it('renders no badge at 0 — an all-clear is not a decision waiting', () => {
      expect(findByText(renderTab({ badgeCount: 0 }), '0')).toBeNull();
    });

    it('renders no badge and no marker when the values are not knowable', () => {
      // null is "we could not determine this", which must look different from "none".
      // Rendering 0 or a quiet marker here would state something we have not measured.
      const tree = renderTab({ badgeCount: null, hasStuck: null });
      expect(findByText(tree, '0')).toBeNull();
      expect(findByText(tree, '!')).toBeNull();
    });

    it('renders no stuck marker when explicitly not stuck', () => {
      expect(findByText(renderTab({ hasStuck: false }), '!')).toBeNull();
    });

    it('is suppressed entirely while an overlay owns the screen', () => {
      // The tab is a fixed overlay on the right edge, so it sat on top of the host
      // picker's "Already registered" column. A launcher for something you are not
      // doing must not cover the thing you are.
      expect(renderTab({ railHidden: true })).toBeNull();
      expect(renderTab({ railHidden: false })).not.toBeNull();
    });

    it('sits where it is told, anchored to the bottom rather than centred', () => {
      // Centred is exactly where full-height content lives, which is how it collided.
      const tree: any = renderTab({ railBottom: 240 });
      expect(tree.props.style.bottom).toBe(240);
      expect(tree.props.style.top).toBeUndefined();
    });

    it('offers a drag handle so a bad default can be moved', () => {
      const onRailDragStart = jest.fn();
      const tree: any = renderTab({ onRailDragStart });
      expect(tree.props.onMouseDown).toBe(onRailDragStart);
    });

    it('reads NEXUS, and never the old scope words', () => {
      // The label used to carry scope — 'THIS SITE' on a site screen, 'INSIGHTS' otherwise
      // — but the site branch never rendered: readSiteId matched `/site-info/...` while
      // Local pushes `/main/site-info/<id>`, so every screen fell through to the fleet
      // word. The badge is one fleet-wide figure now, so there is one word.
      const tree = renderTab({});
      expect(findByText(tree, 'NEXUS')).not.toBeNull();
      expect(findByText(tree, 'INSIGHTS')).toBeNull();
      expect(findByText(tree, 'THIS SITE')).toBeNull();
    });
  });

  describe('the Orbit mark', () => {
    const glyph = (size: number) => (NexusGlyph as any)({ size });
    const kids = (g: any) => (Array.isArray(g.props.children) ? g.props.children : [g.props.children]);

    it('is a ring plus a centre dot, not the four-point star', () => {
      const g = glyph(22);
      const types = kids(g).filter(Boolean).map((c: any) => c.type);
      expect(types).toEqual(['ellipse', 'circle']);
    });

    it('never renders the old star path', () => {
      // The star was hard-coded inline, so swapping the SVG assets alone left it on screen.
      expect(JSON.stringify(glyph(22))).not.toContain('M12 2l2.2');
    });

    it('takes its colour from the wrapper, never its own fill', () => {
      // A fill on the svg is what forces a new hard-coded colour per placement.
      const g = glyph(22);
      expect(g.props.fill).toBe('none');
      const [ring, dot] = kids(g);
      expect(ring.props.stroke).toBe('currentColor');
      expect(dot.props.fill).toBe('currentColor');
    });

    it('drops the ring below the minimum size, keeping the dot', () => {
      // The stroke is 1.9 viewBox units, so a smaller declared size thins it until it
      // greys out. Under the threshold the mark is the solid dot alone, not a faint ring.
      const small = kids(glyph(RING_MIN_SIZE - 1)).filter(Boolean);
      expect(small.map((c: any) => c.type)).toEqual(['circle']);
    });

    it('keeps the ring exactly at the minimum size', () => {
      const at = kids(glyph(RING_MIN_SIZE)).filter(Boolean);
      expect(at.map((c: any) => c.type)).toEqual(['ellipse', 'circle']);
    });

    it('asks for the mark at or above the ring minimum at every call site', () => {
      // The tab and the header avatar. If either drops below the threshold the mark
      // silently degrades to a bare dot — a brand change nobody asked for, and one that
      // shows up in a screenshot rather than a failure. Sizes are read from the element
      // props: render() is shallow, so the glyph's own output is not in this tree.
      const sizes = (state: PanelState) => collectGlyphSizes(renderPanel(state));
      expect(sizes('closed')).toEqual([22]);
      expect(sizes('docked')).toEqual([20]);
      [...sizes('closed'), ...sizes('docked')].forEach((s) => {
        expect(s).toBeGreaterThanOrEqual(RING_MIN_SIZE);
      });
    });

    /** Every `size` passed to NexusGlyph anywhere in an element tree. */
    function collectGlyphSizes(node: any, out: number[] = []): number[] {
      if (!node || typeof node !== 'object') return out;
      if (node.type === NexusGlyph) out.push(node.props.size);
      const kids = node.props?.children;
      const flat = Array.isArray(kids) ? kids : [kids];
      flat.forEach((k: any) => collectGlyphSizes(k, out));
      return out;
    }
  });

  describe('docked state', () => {
    it('renders the panel at 380px content width, not the rail', () => {
      const tree = renderPanel('docked');
      const props = (tree as any).props;
      expect(props.role).toBe('complementary');
      expect(props.style.width).toBe(380);
    });

    it('includes the header with segmented control', () => {
      const tree = renderPanel('docked');
      const children = (tree as any).props.children;
      expect(children[0]).toBeTruthy(); // header
      expect(children[1]).toBeTruthy(); // body
    });
  });

  describe('the retired wide state (fixes-082526)', () => {
    it('is not part of the state union any more', () => {
      // The union is compile-time, so the guard has to be a runtime one: no
      // size the panel can be in renders at the retired 620px width.
      const widths = (['closed', 'docked', 'full'] as PanelState[])
        .map((s) => (renderPanel(s) as any).props.style.width);
      expect(widths).not.toContain(620);
    });
  });

  describe('full state', () => {
    it('renders the panel with left: 68, width: undefined', () => {
      const tree = renderPanel('full');
      const style = (tree as any).props.style;
      expect(style.left).toBe(68);
      expect(style.width).toBeUndefined();
    });
  });

  describe('invariant: no state renders neither rail nor panel', () => {
    const allStates: PanelState[] = ['closed', 'docked', 'full'];

    allStates.forEach((state) => {
      it(`${state} renders something`, () => {
        const tree = renderPanel(state);
        expect(tree).toBeTruthy();
        expect((tree as any).props).toBeTruthy();
      });
    });
  });

  describe('mutations verified', () => {
    it('changing closed to render panel fails the test', () => {
      // Mutation: make closed render the panel by forcing panelState='docked' inside the check
      const component = new DockedPanel({
        panelState: 'closed',
        onOpen: noop,
        onClose: noop,
        onSetPanelState: noop,
      });
      const tree = component.render();
      // This assertion MUST fail if the mutation is applied:
      // If closed renders the panel, width becomes 380 instead of 52
      expect((tree as any).props.style.width).toBe(52);
    });

    it('removing the tab render entirely leaves closed with nothing', () => {
      // Mutation: delete the entire if (panelState === 'closed') block
      const tree = renderPanel('closed');
      // If the mutation is applied, tree is undefined or the panel
      expect(tree).toBeTruthy();
      expect((tree as any).props.style.width).toBe(52);
    });
  });
});
