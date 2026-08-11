import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';
import { PRICES_AS_OF } from '../../main/logging/modelPricing';

export interface LoggingStats {
  root: string;
  totalBytes: number;
  byCategory: { combined: number; agent: number; transcript: number; audit: number };
  policy: { logDays: number; transcriptDays: number; budgetBytes: number };
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const CATEGORY_LABELS: Array<[keyof LoggingStats['byCategory'], string]> = [
  ['combined', 'Combined'], ['agent', 'Per-agent'], ['transcript', 'Transcripts'], ['audit', 'Audit'],
];

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '13px',
  borderRadius: '4px',
  border: '1px solid rgba(128, 128, 128, 0.3)',
  outline: 'none',
  width: '80px',
  background: 'var(--nxai-input-bg, transparent)',
  color: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  marginRight: '8px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginBottom: '12px',
};

interface LoggingSectionState {
  confirmingClear: boolean;
  clearPlan: { freedBytes: number } | null;
  localLogDays: string;
  localTranscriptDays: string;
  localBudgetMB: string;
  confirmingShrink: { freedBytes: number; newValue: number; field: 'logDays' | 'transcriptDays' | 'budgetMB' } | null;
  error: string | null;
}

export class LoggingSection extends React.Component<
  { stats: LoggingStats | null; electron: any; settings: NexusSettings; notifyChange?: (settings: NexusSettings) => void; refreshStats?: () => void },
  LoggingSectionState
> {
  state: LoggingSectionState = {
    confirmingClear: false,
    clearPlan: null,
    localLogDays: String(this.props.settings.logRetentionDays ?? 14),
    localTranscriptDays: String(this.props.settings.transcriptRetentionDays ?? 3),
    localBudgetMB: String(Math.round((this.props.settings.logBudgetBytes ?? 250 * 1024 * 1024) / 1024 / 1024)),
    confirmingShrink: null,
    error: null,
  };

  componentDidUpdate(prevProps: { settings: NexusSettings }): void {
    // Sync local state when settings change externally (e.g., from parent Apply button)
    if (prevProps.settings.logRetentionDays !== this.props.settings.logRetentionDays) {
      this.setState({ localLogDays: String(this.props.settings.logRetentionDays ?? 14) });
    }
    if (prevProps.settings.transcriptRetentionDays !== this.props.settings.transcriptRetentionDays) {
      this.setState({ localTranscriptDays: String(this.props.settings.transcriptRetentionDays ?? 3) });
    }
    if (prevProps.settings.logBudgetBytes !== this.props.settings.logBudgetBytes) {
      this.setState({ localBudgetMB: String(Math.round((this.props.settings.logBudgetBytes ?? 250 * 1024 * 1024) / 1024 / 1024)) });
    }
  }

  handleLevelChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const logLevel = e.target.value as 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
    const next = { ...this.props.settings, logLevel };
    this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { logLevel });
    this.props.notifyChange?.(next);
  };

  handleLogDaysChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ localLogDays: e.target.value });
  };

  handleTranscriptDaysChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ localTranscriptDays: e.target.value });
  };

  handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ localBudgetMB: e.target.value });
  };

  commitLogDays = (): void => {
    const val = parseInt(this.state.localLogDays, 10);
    if (isNaN(val) || val < 1 || val > 365) {
      // Revert to current setting on invalid input
      this.setState({ localLogDays: String(this.props.settings.logRetentionDays ?? 14) });
      return;
    }
    const currentVal = this.props.settings.logRetentionDays ?? 14;
    if (val < currentVal) {
      // Shrinking — show confirmation
      this.setState({ confirmingShrink: { freedBytes: 0, newValue: val, field: 'logDays' } });
    } else {
      // Growing or unchanged — apply immediately
      const next = { ...this.props.settings, logRetentionDays: val };
      this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { logRetentionDays: val }).then(() => {
        this.props.refreshStats?.();
      });
      this.props.notifyChange?.(next);
    }
  };

  applyShrink = (): void => {
    const { confirmingShrink } = this.state;
    if (!confirmingShrink) return;

    const { field, newValue } = confirmingShrink;
    if (field === 'logDays') {
      const next = { ...this.props.settings, logRetentionDays: newValue };
      this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { logRetentionDays: newValue }).then(() => {
        this.props.refreshStats?.();
        this.setState({ confirmingShrink: null });
      }).catch((err: Error) => {
        this.setState({ error: `Failed to apply retention: ${err.message}`, confirmingShrink: null });
      });
      this.props.notifyChange?.(next);
    } else if (field === 'transcriptDays') {
      const next = { ...this.props.settings, transcriptRetentionDays: newValue };
      this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { transcriptRetentionDays: newValue }).then(() => {
        this.props.refreshStats?.();
        this.setState({ confirmingShrink: null });
      }).catch((err: Error) => {
        this.setState({ error: `Failed to apply retention: ${err.message}`, confirmingShrink: null });
      });
      this.props.notifyChange?.(next);
    } else if (field === 'budgetMB') {
      const budgetBytes = newValue * 1024 * 1024;
      const next = { ...this.props.settings, logBudgetBytes: budgetBytes };
      this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { logBudgetBytes: budgetBytes }).then(() => {
        this.props.refreshStats?.();
        this.setState({ confirmingShrink: null });
      }).catch((err: Error) => {
        this.setState({ error: `Failed to apply retention: ${err.message}`, confirmingShrink: null });
      });
      this.props.notifyChange?.(next);
    }
  };

  commitTranscriptDays = (): void => {
    const val = parseInt(this.state.localTranscriptDays, 10);
    if (isNaN(val) || val < 1 || val > 365) {
      this.setState({ localTranscriptDays: String(this.props.settings.transcriptRetentionDays ?? 3) });
      return;
    }
    const currentVal = this.props.settings.transcriptRetentionDays ?? 3;
    if (val < currentVal) {
      // Shrinking — show confirmation
      this.setState({ confirmingShrink: { freedBytes: 0, newValue: val, field: 'transcriptDays' } });
    } else {
      const next = { ...this.props.settings, transcriptRetentionDays: val };
      this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { transcriptRetentionDays: val }).then(() => {
        this.props.refreshStats?.();
      });
      this.props.notifyChange?.(next);
    }
  };

  commitBudget = (): void => {
    const val = parseInt(this.state.localBudgetMB, 10);
    if (isNaN(val) || val < 1) {
      this.setState({ localBudgetMB: String(Math.round((this.props.settings.logBudgetBytes ?? 250 * 1024 * 1024) / 1024 / 1024)) });
      return;
    }
    const currentMB = Math.round((this.props.settings.logBudgetBytes ?? 250 * 1024 * 1024) / 1024 / 1024);
    if (val < currentMB) {
      // Shrinking — show confirmation
      this.setState({ confirmingShrink: { freedBytes: 0, newValue: val, field: 'budgetMB' } });
    } else {
      const budgetBytes = val * 1024 * 1024;
      const next = { ...this.props.settings, logBudgetBytes: budgetBytes };
      this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { logBudgetBytes: budgetBytes }).then(() => {
        this.props.refreshStats?.();
      });
      this.props.notifyChange?.(next);
    }
  };

  handleRevealLogs = (): void => {
    const { stats } = this.props;
    if (!stats) return;
    this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.LOGGING_REVEAL, stats.root).then((result: any) => {
      if (!result.success) {
        this.setState({ error: `Failed to reveal logs: ${result.error}` });
      }
    }).catch((err: Error) => {
      this.setState({ error: `Failed to reveal logs: ${err.message}` });
    });
  };

  startClearLogs = (): void => {
    // Fetch the plan to show what will actually be deleted
    this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.LOGGING_PLAN_CLEAR).then((result: any) => {
      if (result.success) {
        this.setState({ confirmingClear: true, clearPlan: { freedBytes: result.freedBytes } });
      } else {
        this.setState({ error: `Failed to plan clear: ${result.error}` });
      }
    }).catch((err: Error) => {
      this.setState({ error: `Failed to plan clear: ${err.message}` });
    });
  };

  handleClearLogs = (): void => {
    this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.LOGGING_CLEAR).then((result: any) => {
      if (result.success) {
        this.setState({ confirmingClear: false, clearPlan: null });
        this.props.refreshStats?.();
      } else {
        this.setState({ error: `Failed to clear logs: ${result.error}`, confirmingClear: false, clearPlan: null });
      }
    }).catch((err: Error) => {
      this.setState({ error: `Failed to clear logs: ${err.message}`, confirmingClear: false, clearPlan: null });
    });
  };

  render(): React.ReactElement {
    const { stats, settings } = this.props;
    if (!stats) return React.createElement('div', null, 'Loading log statistics…');

    const logLevel = settings.logLevel ?? 'INFO';

    return React.createElement('div', null,
      // Where they are
      React.createElement('div', { style: { marginBottom: '16px' } },
        React.createElement('div', { style: { fontSize: '13px', marginBottom: '6px' } }, stats.root),
        React.createElement('button', {
          onClick: this.handleRevealLogs,
          style: { padding: '6px 12px', fontSize: '13px', cursor: 'pointer' },
        }, 'Reveal in Finder'),
      ),

      // Usage against budget
      React.createElement('div', { style: { marginBottom: '16px' } },
        React.createElement('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '8px' } },
          `${mb(stats.totalBytes)} of ${mb(stats.policy.budgetBytes)}`),
        ...CATEGORY_LABELS.map(([key, label]) =>
          React.createElement('div', { key, style: { fontSize: '13px', marginLeft: '12px', marginBottom: '4px' } },
            `${label}: ${mb(stats.byCategory[key])}`)),
      ),

      // Level control
      React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: labelStyle }, 'Log level'),
        React.createElement('select', {
          value: logLevel,
          onChange: this.handleLevelChange,
          style: { ...inputStyle, width: '100px' },
        },
          React.createElement('option', { value: 'ERROR' }, 'ERROR'),
          React.createElement('option', { value: 'WARN' }, 'WARN'),
          React.createElement('option', { value: 'INFO' }, 'INFO'),
          React.createElement('option', { value: 'DEBUG' }, 'DEBUG'),
        ),
      ),

      // Retention controls
      React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: labelStyle }, 'Keep logs'),
        React.createElement('input', {
          type: 'number',
          min: 1,
          max: 365,
          value: this.state.localLogDays,
          onChange: this.handleLogDaysChange,
          onBlur: this.commitLogDays,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') this.commitLogDays(); },
          style: inputStyle,
        }),
        React.createElement('span', { style: { fontSize: '13px', marginLeft: '6px' } }, 'days'),
      ),

      React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: labelStyle }, 'Keep transcripts'),
        React.createElement('input', {
          type: 'number',
          min: 1,
          max: 365,
          value: this.state.localTranscriptDays,
          onChange: this.handleTranscriptDaysChange,
          onBlur: this.commitTranscriptDays,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') this.commitTranscriptDays(); },
          style: inputStyle,
        }),
        React.createElement('span', { style: { fontSize: '13px', marginLeft: '6px' } }, 'days'),
      ),

      React.createElement('div', { style: rowStyle },
        React.createElement('span', { style: labelStyle }, 'Disk budget'),
        React.createElement('input', {
          type: 'number',
          min: 1,
          max: 10000,
          value: this.state.localBudgetMB,
          onChange: this.handleBudgetChange,
          onBlur: this.commitBudget,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') this.commitBudget(); },
          style: inputStyle,
        }),
        React.createElement('span', { style: { fontSize: '13px', marginLeft: '6px' } }, 'MB'),
      ),

      // Errors
      this.state.error
        ? React.createElement('div', { style: { marginTop: '16px', padding: '8px', background: 'rgba(255,0,0,0.1)', border: '1px solid rgba(255,0,0,0.3)', borderRadius: '4px', fontSize: '13px' } },
            this.state.error,
            React.createElement('button', {
              onClick: () => this.setState({ error: null }),
              style: { marginLeft: '12px', padding: '4px 8px', fontSize: '12px', cursor: 'pointer' },
            }, 'Dismiss'),
          )
        : null,

      // Shrink confirmation
      this.state.confirmingShrink
        ? React.createElement('div', { style: { marginTop: '16px', padding: '12px', background: 'rgba(255,165,0,0.1)', border: '1px solid rgba(255,165,0,0.3)', borderRadius: '4px' } },
            React.createElement('div', { style: { fontSize: '13px', marginBottom: '12px' } },
              `Shrinking retention will delete logs immediately. Runs that failed are kept.`),
            React.createElement('button', {
              onClick: this.applyShrink,
              style: { padding: '6px 12px', marginRight: '8px', fontSize: '13px', cursor: 'pointer' },
            }, 'Apply'),
            React.createElement('button', {
              onClick: () => {
                this.setState({ confirmingShrink: null });
                // Revert the input to current value
                if (this.state.confirmingShrink?.field === 'logDays') {
                  this.setState({ localLogDays: String(this.props.settings.logRetentionDays ?? 14) });
                } else if (this.state.confirmingShrink?.field === 'transcriptDays') {
                  this.setState({ localTranscriptDays: String(this.props.settings.transcriptRetentionDays ?? 3) });
                } else if (this.state.confirmingShrink?.field === 'budgetMB') {
                  this.setState({ localBudgetMB: String(Math.round((this.props.settings.logBudgetBytes ?? 250 * 1024 * 1024) / 1024 / 1024)) });
                }
              },
              style: { padding: '6px 12px', fontSize: '13px', cursor: 'pointer' },
            }, 'Cancel'),
          )
        : null,

      // Clear logs
      React.createElement('div', { style: { marginTop: '16px' } },
        this.state.confirmingClear
          ? React.createElement('div', null,
              React.createElement('div', { style: { fontSize: '13px', marginBottom: '12px' } },
                this.state.clearPlan
                  ? `This will delete ${mb(this.state.clearPlan.freedBytes)} of logs. Runs that failed are kept.`
                  : 'Computing what will be deleted...'),
              React.createElement('button', {
                onClick: this.handleClearLogs,
                disabled: !this.state.clearPlan,
                style: { padding: '6px 12px', marginRight: '8px', fontSize: '13px', cursor: this.state.clearPlan ? 'pointer' : 'not-allowed', opacity: this.state.clearPlan ? 1 : 0.5 },
              }, 'Delete them'),
              React.createElement('button', {
                onClick: () => this.setState({ confirmingClear: false, clearPlan: null }),
                style: { padding: '6px 12px', fontSize: '13px', cursor: 'pointer' },
              }, 'Cancel'),
            )
          : React.createElement('button', {
              onClick: this.startClearLogs,
              style: { padding: '6px 12px', fontSize: '13px', cursor: 'pointer' },
            }, 'Clear logs'),
      ),

      // Pricing date footer
      React.createElement('div', { style: { marginTop: '16px', fontSize: '11px', opacity: 0.6 } },
        `Model pricing as of ${PRICES_AS_OF}`),
    );
  }
}
