/**
 * AI Gateway Usage Panel
 *
 * Displays usage statistics, recent requests, and cost tracking for the AI Gateway.
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';

interface AIGatewayUsagePanelProps {
  electron: any;
}

interface UsageRecord {
  id: string;
  siteId: string;
  siteName: string;
  model: string;
  provider: string;
  timestamp: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

interface AIGatewayUsagePanelState {
  records: UsageRecord[];
  totalCost: number;
  totalRequests: number;
  totalTokens: number;
  loading: boolean;
  clearing: boolean;
  timeFilter: '1h' | '24h' | '7d' | 'all';
}

export class AIGatewayUsagePanel extends React.Component<
  AIGatewayUsagePanelProps,
  AIGatewayUsagePanelState
> {
  private mounted = false;

  state: AIGatewayUsagePanelState = {
    records: [],
    totalCost: 0,
    totalRequests: 0,
    totalTokens: 0,
    loading: true,
    clearing: false,
    timeFilter: '24h',
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchUsage();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  fetchUsage = async (): Promise<void> => {
    this.setState({ loading: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.AI_GATEWAY_GET_USAGE,
      );

      if (!this.mounted) return;

      if (result?.success && result?.records) {
        const filtered = this.filterRecordsByTime(result.records);
        const totalCost = filtered.reduce((sum, r) => sum + r.costUsd, 0);
        const totalTokens = filtered.reduce((sum, r) => sum + r.totalTokens, 0);

        this.setState({
          records: filtered,
          totalCost,
          totalRequests: filtered.length,
          totalTokens,
          loading: false,
        });
      } else {
        this.setState({ loading: false });
      }
    } catch (err) {
      if (this.mounted) {
        this.setState({ loading: false });
      }
    }
  };

  filterRecordsByTime = (records: UsageRecord[]): UsageRecord[] => {
    const now = Date.now();
    const { timeFilter } = this.state;

    let cutoff: number;
    switch (timeFilter) {
      case '1h':
        cutoff = now - 60 * 60 * 1000;
        break;
      case '24h':
        cutoff = now - 24 * 60 * 60 * 1000;
        break;
      case '7d':
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'all':
        cutoff = 0;
        break;
    }

    return records.filter((r) => r.timestamp >= cutoff);
  };

  handleClearUsage = async (): Promise<void> => {
    if (!confirm('Clear all AI Gateway usage data? This cannot be undone.')) {
      return;
    }

    this.setState({ clearing: true });
    try {
      await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.AI_GATEWAY_CLEAR_USAGE,
      );
      if (!this.mounted) return;
      await this.fetchUsage();
    } catch (err) {
      // Error handled
    }
    if (this.mounted) {
      this.setState({ clearing: false });
    }
  };

  handleTimeFilterChange = (timeFilter: '1h' | '24h' | '7d' | 'all'): void => {
    this.setState({ timeFilter }, () => this.fetchUsage());
  };

  formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();

    // If today, show time only
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
    }

    // Otherwise show date + time
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  formatModel = (model: string): string => {
    if (model.includes('haiku')) return 'Haiku';
    if (model.includes('sonnet')) return 'Sonnet';
    if (model.includes('opus')) return 'Opus';
    return model;
  };

  render(): React.ReactNode {
    const {
      records,
      totalCost,
      totalRequests,
      totalTokens,
      loading,
      clearing,
      timeFilter,
    } = this.state;

    const containerStyle: React.CSSProperties = {
      backgroundColor: 'var(--containerBackgroundColor)',
      border: '1px solid var(--dividerColor)',
      borderRadius: '6px',
      padding: '16px',
      marginTop: '16px',
    };

    const headerStyle: React.CSSProperties = {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '16px',
    };

    const titleStyle: React.CSSProperties = {
      fontSize: '16px',
      fontWeight: 600,
      color: 'var(--primaryTextColor)',
    };

    const filterBarStyle: React.CSSProperties = {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
    };

    const filterButtonStyle = (active: boolean): React.CSSProperties => ({
      padding: '4px 12px',
      fontSize: '13px',
      border: '1px solid var(--dividerColor)',
      borderRadius: '4px',
      backgroundColor: active ? UI_COLORS.WPE_BRAND : 'transparent',
      color: active ? '#fff' : 'var(--primaryTextColor)',
      cursor: 'pointer',
    });

    const statsRowStyle: React.CSSProperties = {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px',
      marginBottom: '16px',
    };

    const statCardStyle: React.CSSProperties = {
      padding: '12px',
      backgroundColor: 'var(--inputBackgroundColor)',
      borderRadius: '4px',
      border: '1px solid var(--dividerColor)',
    };

    const statLabelStyle: React.CSSProperties = {
      fontSize: '11px',
      color: 'var(--secondaryTextColor)',
      marginBottom: '4px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    };

    const statValueStyle: React.CSSProperties = {
      fontSize: '20px',
      fontWeight: 600,
      color: 'var(--primaryTextColor)',
    };

    const tableStyle: React.CSSProperties = {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '13px',
    };

    const thStyle: React.CSSProperties = {
      textAlign: 'left',
      padding: '8px',
      borderBottom: '1px solid var(--dividerColor)',
      color: 'var(--secondaryTextColor)',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    };

    const tdStyle: React.CSSProperties = {
      padding: '8px',
      borderBottom: '1px solid var(--dividerColor)',
      color: 'var(--primaryTextColor)',
    };

    const buttonStyle: React.CSSProperties = {
      padding: '6px 12px',
      fontSize: '13px',
      border: '1px solid var(--dividerColor)',
      borderRadius: '4px',
      backgroundColor: 'transparent',
      color: 'var(--primaryTextColor)',
      cursor: 'pointer',
    };

    const emptyStyle: React.CSSProperties = {
      textAlign: 'center',
      padding: '32px',
      color: 'var(--secondaryTextColor)',
      fontSize: '14px',
    };

    if (loading) {
      return React.createElement(
        'div',
        { style: containerStyle },
        React.createElement('div', { style: emptyStyle }, 'Loading usage data...'),
      );
    }

    return React.createElement(
      'div',
      { style: containerStyle },

      // Header with filters
      React.createElement(
        'div',
        { style: headerStyle },
        React.createElement('div', { style: titleStyle }, 'AI Gateway Usage'),
        React.createElement(
          'div',
          { style: filterBarStyle },
          React.createElement(
            'button',
            {
              style: filterButtonStyle(timeFilter === '1h'),
              onClick: () => this.handleTimeFilterChange('1h'),
            },
            '1 Hour',
          ),
          React.createElement(
            'button',
            {
              style: filterButtonStyle(timeFilter === '24h'),
              onClick: () => this.handleTimeFilterChange('24h'),
            },
            '24 Hours',
          ),
          React.createElement(
            'button',
            {
              style: filterButtonStyle(timeFilter === '7d'),
              onClick: () => this.handleTimeFilterChange('7d'),
            },
            '7 Days',
          ),
          React.createElement(
            'button',
            {
              style: filterButtonStyle(timeFilter === 'all'),
              onClick: () => this.handleTimeFilterChange('all'),
            },
            'All Time',
          ),
          React.createElement(
            'button',
            {
              style: { ...buttonStyle, marginLeft: '16px' },
              onClick: this.handleClearUsage,
              disabled: clearing || records.length === 0,
            },
            clearing ? 'Clearing...' : 'Clear All',
          ),
        ),
      ),

      // Stats cards
      React.createElement(
        'div',
        { style: statsRowStyle },
        React.createElement(
          'div',
          { style: statCardStyle },
          React.createElement('div', { style: statLabelStyle }, 'Total Requests'),
          React.createElement('div', { style: statValueStyle }, totalRequests.toLocaleString()),
        ),
        React.createElement(
          'div',
          { style: statCardStyle },
          React.createElement('div', { style: statLabelStyle }, 'Total Tokens'),
          React.createElement(
            'div',
            { style: statValueStyle },
            totalTokens.toLocaleString(),
          ),
        ),
        React.createElement(
          'div',
          { style: statCardStyle },
          React.createElement('div', { style: statLabelStyle }, 'Total Cost'),
          React.createElement(
            'div',
            { style: { ...statValueStyle, color: UI_COLORS.WPE_BRAND } },
            `$${totalCost.toFixed(4)}`,
          ),
        ),
      ),

      // Recent requests table
      records.length === 0
        ? React.createElement(
            'div',
            { style: emptyStyle },
            'No AI requests in the selected time period.',
          )
        : React.createElement(
            'div',
            { style: { maxHeight: '400px', overflowY: 'auto' } },
            React.createElement(
              'table',
              { style: tableStyle },
              React.createElement(
                'thead',
                null,
                React.createElement(
                  'tr',
                  null,
                  React.createElement('th', { style: thStyle }, 'Time'),
                  React.createElement('th', { style: thStyle }, 'Site'),
                  React.createElement('th', { style: thStyle }, 'Model'),
                  React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Tokens'),
                  React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Cost'),
                  React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Duration'),
                ),
              ),
              React.createElement(
                'tbody',
                null,
                records.slice(0, 100).map((record) =>
                  React.createElement(
                    'tr',
                    { key: record.id },
                    React.createElement(
                      'td',
                      { style: tdStyle },
                      this.formatTimestamp(record.timestamp),
                    ),
                    React.createElement(
                      'td',
                      { style: tdStyle },
                      record.siteName || record.siteId,
                    ),
                    React.createElement(
                      'td',
                      { style: tdStyle },
                      this.formatModel(record.model),
                    ),
                    React.createElement(
                      'td',
                      { style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace' } },
                      `${record.totalTokens.toLocaleString()} (${record.promptTokens}+${record.completionTokens})`,
                    ),
                    React.createElement(
                      'td',
                      { style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace' } },
                      `$${record.costUsd.toFixed(4)}`,
                    ),
                    React.createElement(
                      'td',
                      { style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace' } },
                      `${(record.durationMs / 1000).toFixed(2)}s`,
                    ),
                  ),
                ),
              ),
            ),
          ),
    );
  }
}
