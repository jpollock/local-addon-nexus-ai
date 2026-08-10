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

export class LoggingSection extends React.Component<
  { stats: LoggingStats | null; electron: any; settings: NexusSettings },
  { confirmingClear: boolean }
> {
  state = { confirmingClear: false };

  handleLevelChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const logLevel = e.target.value as 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
    this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { logLevel });
  };

  handleLogDaysChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1 || val > 365) return;
    this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { logRetentionDays: val });
  };

  handleTranscriptDaysChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1 || val > 365) return;
    this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { transcriptRetentionDays: val });
  };

  handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1) return;
    this.props.electron?.ipcRenderer?.invoke(IPC_CHANNELS.UPDATE_SETTINGS, { logBudgetBytes: val * 1024 * 1024 });
  };

  render(): React.ReactElement {
    const { stats, settings } = this.props;
    if (!stats) return React.createElement('div', null, 'Loading log statistics…');

    const logLevel = settings.logLevel ?? 'INFO';
    const logDays = settings.logRetentionDays ?? 14;
    const transcriptDays = settings.transcriptRetentionDays ?? 3;
    const budgetMB = Math.round((settings.logBudgetBytes ?? 250 * 1024 * 1024) / 1024 / 1024);

    return React.createElement('div', null,
      // Where they are
      React.createElement('div', { style: { marginBottom: '16px' } },
        React.createElement('div', { style: { fontSize: '13px', marginBottom: '6px' } }, stats.root),
        React.createElement('button', {
          onClick: () => this.props.electron?.ipcRenderer?.invoke('nexus-ai:reveal-path', stats.root),
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
          value: logDays,
          onChange: this.handleLogDaysChange,
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
          value: transcriptDays,
          onChange: this.handleTranscriptDaysChange,
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
          value: budgetMB,
          onChange: this.handleBudgetChange,
          style: inputStyle,
        }),
        React.createElement('span', { style: { fontSize: '13px', marginLeft: '6px' } }, 'MB'),
      ),

      // Clear logs
      React.createElement('div', { style: { marginTop: '16px' } },
        this.state.confirmingClear
          ? React.createElement('div', null,
              React.createElement('div', { style: { fontSize: '13px', marginBottom: '12px' } },
                `This will delete ${mb(stats.totalBytes)} of logs. Runs that failed are kept.`),
              React.createElement('button', {
                onClick: () => this.props.electron?.ipcRenderer?.invoke('nexus-ai:clear-logs'),
                style: { padding: '6px 12px', marginRight: '8px', fontSize: '13px', cursor: 'pointer' },
              }, 'Delete them'),
              React.createElement('button', {
                onClick: () => this.setState({ confirmingClear: false }),
                style: { padding: '6px 12px', fontSize: '13px', cursor: 'pointer' },
              }, 'Cancel'),
            )
          : React.createElement('button', {
              onClick: () => this.setState({ confirmingClear: true }),
              style: { padding: '6px 12px', fontSize: '13px', cursor: 'pointer' },
            }, 'Clear logs'),
      ),

      // Pricing date footer
      React.createElement('div', { style: { marginTop: '16px', fontSize: '11px', opacity: 0.6 } },
        `Model pricing as of ${PRICES_AS_OF}`),
    );
  }
}
