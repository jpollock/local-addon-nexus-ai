/**
 * @jest-environment jsdom
 */
import {
  computeReflowMode,
  computePaddingRight,
  findLocalRoot,
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
      expect(computeReflowMode('wide', 800, true)).toBe('overlay');
      expect(computeReflowMode('wide', 1620, true)).toBe('overlay');
      expect(computeReflowMode('wide', 2000, true)).toBe('overlay');
    });

    it('full state is always overlay', () => {
      expect(computeReflowMode('full', 800, true)).toBe('overlay');
      expect(computeReflowMode('full', 1400, true)).toBe('overlay');
      expect(computeReflowMode('full', 2000, true)).toBe('overlay');
    });
  });

  describe('computePaddingRight', () => {
    it('returns 0 when overlay mode', () => {
      expect(computePaddingRight('docked', 'overlay')).toBe(0);
      expect(computePaddingRight('wide', 'overlay')).toBe(0);
      expect(computePaddingRight('full', 'overlay')).toBe(0);
      expect(computePaddingRight('closed', 'overlay')).toBe(0);
    });

    it('returns 0 for closed in-flow — the collapsed tab reserves no width', () => {
      // Was 48. The combination is unreachable in production now (computeReflowMode never
      // returns 'in-flow' for closed), but the function is kept total on purpose: if
      // someone re-enables in-flow for the collapsed state, they get 0 and have to write
      // the reservation deliberately, rather than inheriting a 48px strip that clips
      // Local's site header and its "Open site" / "WP Admin" actions.
      expect(computePaddingRight('closed', 'in-flow')).toBe(0);
    });

    it('returns 380 for docked in-flow', () => {
      expect(computePaddingRight('docked', 'in-flow')).toBe(PANEL_WIDTH);
    });

    it('returns 0 for wide/full in-flow (they are never in-flow)', () => {
      expect(computePaddingRight('wide', 'in-flow')).toBe(0);
      expect(computePaddingRight('full', 'in-flow')).toBe(0);
    });

    it('docked in-flow is the only combination that reserves anything', () => {
      const states = ['closed', 'docked', 'wide', 'full'] as const;
      const modes = ['in-flow', 'overlay'] as const;
      const reserving = states.flatMap((s) =>
        modes.filter((m) => computePaddingRight(s, m) > 0).map((m) => `${s}/${m}`),
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

    it('returns the App_ container when present', () => {
      document.body.innerHTML = '<div id="root"><div class="App_Wrapper__x1y2">content</div></div>';
      const found = findLocalRoot();
      expect(found).not.toBeNull();
      expect(found!.className).toBe('App_Wrapper__x1y2');
      expect(warn).not.toHaveBeenCalled();
    });

    it('returns null and warns when App_ is missing — it does NOT fall back to #root', () => {
      // #root is present and would have been returned by the old fallback. That fallback
      // is the defect: #root is the React root of the whole app, not Local's content
      // container, so the mechanism silently padded the wrong box while every downstream
      // measurement (including "#root has padding-right: 48px") still looked healthy.
      document.body.innerHTML = '<div id="root"><div class="SomethingElse">content</div></div>';
      expect(document.getElementById('root')).not.toBeNull();
      expect(findLocalRoot()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('App_');
    });

    it('returns null and warns when the document is empty', () => {
      expect(findLocalRoot()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
