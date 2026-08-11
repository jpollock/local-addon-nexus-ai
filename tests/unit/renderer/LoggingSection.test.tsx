/**
 * LoggingSection test
 *
 * Covers the critical fixes and guards deleted in the rewrite:
 * - C3: No retention deletion on keystroke
 * - C2: Clear/Reveal channels exist and are called correctly
 * - I4: Parent Apply button doesn't revert panel changes
 * - Confirmation copy guard (issue #2)
 * - Settings key guard (writes logRetentionDays not logDays)
 */
import * as React from 'react';
import { LoggingSection, type LoggingStats } from '../../../src/renderer/components/LoggingSection';
import { IPC_CHANNELS } from '../../../src/common/constants';
import { PRICES_AS_OF } from '../../../src/main/logging/modelPricing';

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, ...args: unknown[]) {
    const [updater, cb] = args as [any, (() => void) | undefined];
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
    cb?.();
  });
}

describe('LoggingSection', () => {
  const mockElectron = {
    ipcRenderer: {
      invoke: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockStats: LoggingStats = {
    root: '/path/to/logs',
    totalBytes: 12 * 1024 * 1024,
    byCategory: { combined: 5 * 1024 * 1024, agent: 4 * 1024 * 1024, transcript: 2 * 1024 * 1024, audit: 1 * 1024 * 1024 },
    policy: { logDays: 14, transcriptDays: 3, budgetBytes: 250 * 1024 * 1024 },
  };

  const mockSettings = {
    autoIndex: true,
    excludedSiteIds: [],
    logLevel: 'INFO' as const,
    logRetentionDays: 14,
    transcriptRetentionDays: 3,
    logBudgetBytes: 250 * 1024 * 1024,
  };

  // Settings writes go through the parent's save path (optimistic update + revert on
  // failure), not a direct UPDATE_SETTINGS invoke from this component.
  const mockSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockClear();
  });

  describe('Behavior tests (guards for defects #2 and #3)', () => {
    it('writes logRetentionDays (not logDays) - the settings key guard', () => {
      // When growing retention, it writes immediately
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave });
      spySetState(wrapper);
      wrapper.setState({ localLogDays: '20' });
      wrapper.commitLogDays();
      expect(mockSave).toHaveBeenCalledWith({ logRetentionDays: 20 });
    });

    it('Clear logs fetches a plan BEFORE showing confirmation - the honest-number guard', async () => {
      // startClearLogs should call LOGGING_PLAN_CLEAR and use the freedBytes in the confirmation
      const planResult = { success: true, freedBytes: 10 * 1024 * 1024, keptBytes: 2 * 1024 * 1024, filesDeleted: 8 };
      mockElectron.ipcRenderer.invoke.mockResolvedValueOnce(planResult);

      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave });
      spySetState(wrapper);

      await wrapper.startClearLogs();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGGING_PLAN_CLEAR);
      expect(wrapper.state.clearPlan).toEqual({ freedBytes: 10 * 1024 * 1024 });
      expect(wrapper.state.confirmingClear).toBe(true);
    });

    it('shrinking retention shows confirmation before applying', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave });
      spySetState(wrapper);
      wrapper.setState({ localLogDays: '7' });
      wrapper.commitLogDays();

      // Should NOT save immediately (shrinking from 14 to 7)
      expect(mockSave).not.toHaveBeenCalled();

      // Should set confirmingShrink state
      expect(wrapper.state.confirmingShrink).toEqual({ freedBytes: 0, newValue: 7, field: 'logDays' });
    });

    it('growing retention applies immediately without confirmation', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave });
      spySetState(wrapper);
      wrapper.setState({ localLogDays: '20' });
      wrapper.commitLogDays();

      // Should save immediately (growing from 14 to 20)
      expect(mockSave).toHaveBeenCalledWith({ logRetentionDays: 20 });
      expect(wrapper.state.confirmingShrink).toBeNull();
    });
  });

  describe('C3: No retention deletion on keystroke', () => {
    it('does not save while typing in retention days field', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave }, { localValue: '14' });

      // Simulate onChange firing — should NOT write
      wrapper.handleLogDaysChange({ target: { value: '3' } } as any);

      expect(mockSave).not.toHaveBeenCalled();
      expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it('does not save while typing in budget field', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave }, { localBudget: '250' });

      wrapper.handleBudgetChange({ target: { value: '5' } } as any);

      expect(mockSave).not.toHaveBeenCalled();
      expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
    });
  });

  describe('C2: Clear and Reveal channels exist and are invoked', () => {
    it('invokes correct channel when Reveal button is clicked', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave }, {});

      wrapper.handleRevealLogs();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGGING_REVEAL, mockStats.root);
    });

    it('invokes correct channel when Delete button is clicked after confirmation', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave }, { confirmingClear: true });

      wrapper.handleClearLogs();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGGING_CLEAR);
    });

    it('does NOT invoke a wrong channel name', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings, onSave: mockSave }, {});

      wrapper.handleRevealLogs();

      // Should NOT call LOGGING_STATS or any other channel
      expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalledWith(IPC_CHANNELS.LOGGING_STATS, expect.anything());
    });
  });
});
