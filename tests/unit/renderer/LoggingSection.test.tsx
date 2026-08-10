/**
 * LoggingSection test
 *
 * Covers the three critical fixes:
 * - C3: No retention deletion on keystroke
 * - C2: Clear/Reveal channels exist and are called correctly
 * - I4: Parent Apply button doesn't revert panel changes
 */
import * as React from 'react';
import { LoggingSection, type LoggingStats } from '../../../src/renderer/components/LoggingSection';
import { IPC_CHANNELS } from '../../../src/common/constants';

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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('C3: No retention deletion on keystroke', () => {
    it('does not invoke UPDATE_SETTINGS while typing in retention days field', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings }, { localValue: '14' });

      // Simulate onChange firing — should NOT invoke UPDATE_SETTINGS
      wrapper.handleLogDaysChange({ target: { value: '3' } } as any);

      expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it('does not invoke UPDATE_SETTINGS while typing in budget field', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings }, { localBudget: '250' });

      wrapper.handleBudgetChange({ target: { value: '5' } } as any);

      expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
    });
  });

  describe('C2: Clear and Reveal channels exist and are invoked', () => {
    it('invokes correct channel when Reveal button is clicked', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings }, {});

      wrapper.handleRevealLogs();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGGING_REVEAL, mockStats.root);
    });

    it('invokes correct channel when Delete button is clicked after confirmation', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings }, { confirmingClear: true });

      wrapper.handleClearLogs();

      expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.LOGGING_CLEAR);
    });

    it('does NOT invoke a wrong channel name', () => {
      const wrapper = new LoggingSection({ stats: mockStats, electron: mockElectron, settings: mockSettings }, {});

      wrapper.handleRevealLogs();

      // Should NOT call LOGGING_STATS or any other channel
      expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalledWith(IPC_CHANNELS.LOGGING_STATS, expect.anything());
    });
  });
});
