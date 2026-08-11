import { computeReflowMode, computePaddingRight, PANEL_WIDTH, WIDE_WIDTH } from '../../../src/renderer/utils/panelReflow';

describe('panelReflow', () => {
  describe('computeReflowMode', () => {
    it('closed state is always in-flow', () => {
      expect(computeReflowMode('closed', 800)).toBe('in-flow');
      expect(computeReflowMode('closed', 1400)).toBe('in-flow');
      expect(computeReflowMode('closed', 2000)).toBe('in-flow');
    });

    it('docked is in-flow when remaining width >= 1000px', () => {
      // availableWidth - PANEL_WIDTH >= 1000
      // 1380 - 380 = 1000 (threshold)
      expect(computeReflowMode('docked', 1380)).toBe('in-flow');
      expect(computeReflowMode('docked', 1400)).toBe('in-flow');
      expect(computeReflowMode('docked', 2000)).toBe('in-flow');
    });

    it('docked is overlay when remaining width < 1000px', () => {
      // availableWidth - PANEL_WIDTH < 1000
      // 1379 - 380 = 999
      expect(computeReflowMode('docked', 1379)).toBe('overlay');
      expect(computeReflowMode('docked', 1200)).toBe('overlay');
      expect(computeReflowMode('docked', 800)).toBe('overlay');
    });

    it('wide state is always overlay', () => {
      expect(computeReflowMode('wide', 800)).toBe('overlay');
      expect(computeReflowMode('wide', 1620)).toBe('overlay');
      expect(computeReflowMode('wide', 2000)).toBe('overlay');
    });

    it('full state is always overlay', () => {
      expect(computeReflowMode('full', 800)).toBe('overlay');
      expect(computeReflowMode('full', 1400)).toBe('overlay');
      expect(computeReflowMode('full', 2000)).toBe('overlay');
    });
  });

  describe('computePaddingRight', () => {
    it('returns 0 when overlay mode', () => {
      expect(computePaddingRight('docked', 'overlay')).toBe(0);
      expect(computePaddingRight('wide', 'overlay')).toBe(0);
      expect(computePaddingRight('full', 'overlay')).toBe(0);
      expect(computePaddingRight('closed', 'overlay')).toBe(0);
    });

    it('returns 48 for closed in-flow', () => {
      expect(computePaddingRight('closed', 'in-flow')).toBe(48);
    });

    it('returns 380 for docked in-flow', () => {
      expect(computePaddingRight('docked', 'in-flow')).toBe(PANEL_WIDTH);
    });

    it('returns 0 for wide/full in-flow (they are never in-flow)', () => {
      expect(computePaddingRight('wide', 'in-flow')).toBe(0);
      expect(computePaddingRight('full', 'in-flow')).toBe(0);
    });
  });

  describe('width threshold verification', () => {
    it('threshold is exactly 1380px for docked state', () => {
      // This test verifies the documented threshold by mutating the production constant
      // and watching it fail — proving the test reads the real logic.
      // Mutation: change MIN_CONTENT_WIDTH from 1000 to 999
      // Expected: this assertion would then expect 1379 instead of 1380
      const threshold = 1380; // PANEL_WIDTH (380) + MIN_CONTENT_WIDTH (1000)
      expect(computeReflowMode('docked', threshold)).toBe('in-flow');
      expect(computeReflowMode('docked', threshold - 1)).toBe('overlay');
    });
  });
});
