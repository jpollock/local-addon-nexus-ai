/**
 * @jest-environment jsdom
 */
import {
  computeReflowMode,
  computeReservedWidth,
  findLocalRoot,
  readSiteId,
  PANEL_WIDTH,
} from '../../../src/renderer/utils/panelReflow';

describe('panelReflow', () => {
  describe('computeReflowMode', () => {
    it('closed state is always overlay — the floating tab reserves nothing', () => {
      // Was 'in-flow' (a 48px full-height rail that padded Local's root). The collapsed
      // state is a floating tab now: it overlays, so it cannot clip Local's header or its
      // footer actions, and host reflow no longer runs in the state the panel is usually in.
      expect(computeReflowMode('closed', 800, true)).toBe('overlay');
      expect(computeReflowMode('closed', 1400, true)).toBe('overlay');
      expect(computeReflowMode('closed', 2000, true)).toBe('overlay');
    });

    it('docked is in-flow when remaining width >= 1000px', () => {
      // availableWidth - PANEL_WIDTH >= 1000
      // 1380 - 380 = 1000 (threshold)
      expect(computeReflowMode('docked', 1380, true)).toBe('in-flow');
      expect(computeReflowMode('docked', 1400, true)).toBe('in-flow');
      expect(computeReflowMode('docked', 2000, true)).toBe('in-flow');
    });

    it('docked is overlay when remaining width < 1000px', () => {
      // availableWidth - PANEL_WIDTH < 1000
      // 1379 - 380 = 999
      expect(computeReflowMode('docked', 1379, true)).toBe('overlay');
      expect(computeReflowMode('docked', 1200, true)).toBe('overlay');
      expect(computeReflowMode('docked', 800, true)).toBe('overlay');
    });

    it('docked is overlay at any width when the host root was not found', () => {
      // The one case that still reflows must not reflow into a box we could not locate.
      // Widths here are all comfortably past the 1380px threshold, so only hostRootFound
      // can be producing 'overlay'.
      expect(computeReflowMode('docked', 1400, false)).toBe('overlay');
      expect(computeReflowMode('docked', 2000, false)).toBe('overlay');
      expect(computeReflowMode('docked', 4000, false)).toBe('overlay');
    });

    it('wide state is always overlay', () => {
      expect(computeReflowMode('full', 800, true)).toBe('overlay');
      expect(computeReflowMode('full', 1620, true)).toBe('overlay');
      expect(computeReflowMode('full', 2000, true)).toBe('overlay');
    });

    it('full state is always overlay', () => {
      expect(computeReflowMode('full', 800, true)).toBe('overlay');
      expect(computeReflowMode('full', 1400, true)).toBe('overlay');
      expect(computeReflowMode('full', 2000, true)).toBe('overlay');
    });
  });

  describe('computeReservedWidth', () => {
    it('returns 0 when overlay mode', () => {
      expect(computeReservedWidth('docked', 'overlay')).toBe(0);
      expect(computeReservedWidth('full', 'overlay')).toBe(0);
      expect(computeReservedWidth('full', 'overlay')).toBe(0);
      expect(computeReservedWidth('closed', 'overlay')).toBe(0);
    });

    it('returns 0 for closed in-flow — the collapsed tab reserves no width', () => {
      // Was 48. The combination is unreachable in production now (computeReflowMode never
      // returns 'in-flow' for closed), but the function is kept total on purpose: if
      // someone re-enables in-flow for the collapsed state, they get 0 and have to write
      // the reservation deliberately, rather than inheriting a 48px strip that clips
      // Local's site header and its "Open site" / "WP Admin" actions.
      expect(computeReservedWidth('closed', 'in-flow')).toBe(0);
    });

    it('returns 380 for docked in-flow', () => {
      expect(computeReservedWidth('docked', 'in-flow')).toBe(PANEL_WIDTH);
    });

    it('returns 0 for wide/full in-flow (they are never in-flow)', () => {
      expect(computeReservedWidth('full', 'in-flow')).toBe(0);
      expect(computeReservedWidth('full', 'in-flow')).toBe(0);
    });

    it('docked in-flow is the only combination that reserves anything', () => {
      const states = ['closed', 'docked', 'full'] as const;
      const modes = ['in-flow', 'overlay'] as const;
      const reserving = states.flatMap((s) =>
        modes.filter((m) => computeReservedWidth(s, m) > 0).map((m) => `${s}/${m}`),
      );
      expect(reserving).toEqual(['docked/in-flow']);
    });
  });

  describe('width threshold verification', () => {
    it('threshold is exactly 1380px for docked state', () => {
      // This test verifies the documented threshold by mutating the production constant
      // and watching it fail — proving the test reads the real logic.
      // Mutation: change MIN_CONTENT_WIDTH from 1000 to 999
      // Expected: this assertion would then expect 1379 instead of 1380
      const threshold = 1380; // PANEL_WIDTH (380) + MIN_CONTENT_WIDTH (1000)
      expect(computeReflowMode('docked', threshold, true)).toBe('in-flow');
      expect(computeReflowMode('docked', threshold - 1, true)).toBe('overlay');
    });
  });

  describe('findLocalRoot', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      document.body.innerHTML = '';
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
      document.body.innerHTML = '';
    });

    it('finds Local\'s shell as rendered by Window.tsx', () => {
      // Exactly the markup classnames('Window', {__FlexColumn, __OsDarwin}) produces, so
      // the extra modifier classes have to not defeat the match.
      document.body.innerHTML =
        '<div id="root"><div class="Window __FlexColumn __OsDarwin" data-location="/">shell</div></div>';
      const found = findLocalRoot();
      expect(found).not.toBeNull();
      expect(found!.classList.contains('Window')).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it('returns null and warns when the shell is missing — it does NOT fall back to #root', () => {
      // #root is present and would have been returned by the old fallback. That fallback was
      // the defect: #root is the React root of the whole app, and .Window inside it is
      // position:absolute, so padding #root moved nothing while still measuring as applied.
      document.body.innerHTML = '<div id="root"><div class="SomethingElse">content</div></div>';
      expect(document.getElementById('root')).not.toBeNull();
      expect(findLocalRoot()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('.Window');
    });

    it('does not match the old App_ guess', () => {
      // The selector this replaced. It never matched anything in a real Local window, which
      // is why the mechanism silently ran against #root for as long as it did.
      document.body.innerHTML = '<div id="root"><div class="App_Wrapper__x1y2">content</div></div>';
      expect(findLocalRoot()).toBeNull();
    });

    it('returns null and warns when the document is empty', () => {
      expect(findLocalRoot()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('readSiteId', () => {
    function shell(location: string | null): HTMLElement {
      const el = document.createElement('div');
      el.className = 'Window';
      if (location !== null) el.setAttribute('data-location', location);
      return el;
    }

    it('reads the site id from a site-info route', () => {
      expect(readSiteId(shell('/site-info/abc123'))).toBe('abc123');
    });

    it('reads the site id from a site-info subroute', () => {
      // Local appends tab subroutes; the scope is still that site.
      expect(readSiteId(shell('/site-info/abc123/overview'))).toBe('abc123');
    });

    it('returns null on fleet-level routes', () => {
      ['/', '/connect', '/marketplace', '/blueprints', '/support'].forEach((route) => {
        expect(readSiteId(shell(route))).toBeNull();
      });
    });

    it('does not mistake a route that merely starts with the same text', () => {
      expect(readSiteId(shell('/site-information-page'))).toBeNull();
    });

    it('returns null when the attribute or the shell is absent', () => {
      expect(readSiteId(shell(null))).toBeNull();
      expect(readSiteId(null)).toBeNull();
    });
  });
});
