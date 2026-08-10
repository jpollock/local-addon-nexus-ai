import * as React from 'react';

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

export class LoggingSection extends React.Component<
  { stats: LoggingStats | null; electron: any },
  { confirmingClear: boolean }
> {
  state = { confirmingClear: false };

  render(): React.ReactElement {
    const { stats } = this.props;
    if (!stats) return React.createElement('div', null, 'Loading log statistics…');

    return React.createElement('div', null,
      // Where they are. "Somewhere in Application Support" is not an answer a user can act on.
      React.createElement('div', null, stats.root),
      React.createElement('button', {
        onClick: () => this.props.electron?.ipcRenderer?.invoke('nexus-ai:reveal-path', stats.root),
      }, 'Reveal in Finder'),

      // Usage against the budget, broken down — one opaque total tells you nothing about what to
      // turn off if it is too large.
      React.createElement('div', null, `${mb(stats.totalBytes)} of ${mb(stats.policy.budgetBytes)}`),
      ...CATEGORY_LABELS.map(([key, label]) =>
        React.createElement('div', { key }, `${label}: ${mb(stats.byCategory[key])}`)),

      React.createElement('div', null,
        `Logs kept ${stats.policy.logDays} days · transcripts ${stats.policy.transcriptDays} days`),

      this.state.confirmingClear
        // Say what goes, before it goes. Runs that failed are exempt and the copy says so, or a
        // user clearing space would reasonably believe they had destroyed their own evidence.
        ? React.createElement('div', null,
            React.createElement('div', null,
              `This will delete ${mb(stats.totalBytes)} of logs. Runs that failed are kept.`),
            React.createElement('button', {
              onClick: () => this.props.electron?.ipcRenderer?.invoke('nexus-ai:clear-logs'),
            }, 'Delete them'),
            React.createElement('button', { onClick: () => this.setState({ confirmingClear: false }) }, 'Cancel'),
          )
        : React.createElement('button', { onClick: () => this.setState({ confirmingClear: true }) }, 'Clear logs'),
    );
  }
}
