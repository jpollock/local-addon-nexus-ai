/**
 * AI Gateway By Caller Panel
 *
 * Aggregated view of AI usage grouped by caller (plugin/theme/core feature).
 * Shows which parts of WordPress are consuming the most AI tokens/cost.
 * Class-based — Local uses older React, no hooks allowed.
 * Uses react-window for virtual scrolling of large datasets.
 */
import * as React from 'react';
import { FixedSizeList as List } from 'react-window';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';

interface AIGatewayByCallerPanelProps {
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
  // Caller tracking
  callerPlugin?: string;
  callerTheme?: string;
  callerFeature?: string;
  callerSource?: string;
  callerUserId?: number;
  callerUserRole?: string;
}

interface CallerStats {
  callerKey: string;        // Unique key for grouping
  callerDisplay: string;    // Display name
  callerType: 'plugin' | 'theme' | 'core' | 'unknown';
  requests: number;
  totalTokens: number;
  costUsd: number;
  features: Set<string>;    // Unique features used
}

interface AIGatewayByCallerPanelState {
  records: UsageRecord[];
  callerStats: CallerStats[];
  loading: boolean;
  timeFilter: '1h' | '24h' | '7d' | 'all';
}

export class AIGatewayByCallerPanel extends React.Component<
  AIGatewayByCallerPanelProps,
  AIGatewayByCallerPanelState
> {
  private mounted = false;

  state: AIGatewayByCallerPanelState = {
    records: [],
    callerStats: [],
    loading: true,
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
        const callerStats = this.aggregateByCaller(filtered);

        this.setState({
          records: filtered,
          callerStats,
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

  aggregateByCaller = (records: UsageRecord[]): CallerStats[] => {
    const statsMap = new Map<string, CallerStats>();

    for (const record of records) {
      const { callerKey, callerDisplay, callerType } = this.getCallerInfo(record);

      if (!statsMap.has(callerKey)) {
        statsMap.set(callerKey, {
          callerKey,
          callerDisplay,
          callerType,
          requests: 0,
          totalTokens: 0,
          costUsd: 0,
          features: new Set(),
        });
      }

      const stats = statsMap.get(callerKey)!;
      stats.requests += 1;
      stats.totalTokens += record.totalTokens;
      stats.costUsd += record.costUsd;

      if (record.callerFeature) {
        stats.features.add(record.callerFeature);
      }
    }

    // Convert to array and sort by cost (descending)
    return Array.from(statsMap.values()).sort((a, b) => b.costUsd - a.costUsd);
  };

  getCallerInfo = (
    record: UsageRecord,
  ): { callerKey: string; callerDisplay: string; callerType: CallerStats['callerType'] } => {
    // Plugin
    if (record.callerPlugin) {
      return {
        callerKey: `plugin:${record.callerPlugin}`,
        callerDisplay: record.callerPlugin,
        callerType: 'plugin',
      };
    }

    // Theme
    if (record.callerTheme) {
      return {
        callerKey: `theme:${record.callerTheme}`,
        callerDisplay: `${record.callerTheme} (theme)`,
        callerType: 'theme',
      };
    }

    // WordPress Core
    if (record.callerSource === 'core') {
      return {
        callerKey: 'core',
        callerDisplay: 'WordPress Core',
        callerType: 'core',
      };
    }

    // Unknown/legacy records
    return {
      callerKey: 'unknown',
      callerDisplay: 'Unknown',
      callerType: 'unknown',
    };
  };

  handleTimeFilterChange = (timeFilter: '1h' | '24h' | '7d' | 'all'): void => {
    this.setState({ timeFilter }, () => this.fetchUsage());
  };

  render(): React.ReactNode {
    const { callerStats, loading, timeFilter } = this.state;

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

    const emptyStyle: React.CSSProperties = {
      textAlign: 'center',
      padding: '32px',
      color: 'var(--secondaryTextColor)',
      fontSize: '14px',
    };

    const badgeStyle = (type: CallerStats['callerType']): React.CSSProperties => {
      let bgColor: string;
      let textColor: string;

      switch (type) {
        case 'plugin':
          bgColor = 'rgba(81, 195, 86, 0.15)';
          textColor = UI_COLORS.STATUS_RUNNING;
          break;
        case 'theme':
          bgColor = 'rgba(14, 202, 212, 0.15)';
          textColor = UI_COLORS.WPE_BRAND;
          break;
        case 'core':
          bgColor = 'rgba(245, 158, 11, 0.15)';
          textColor = UI_COLORS.STATUS_WARNING;
          break;
        default:
          bgColor = 'rgba(153, 153, 153, 0.15)';
          textColor = UI_COLORS.STATUS_HALTED;
      }

      return {
        display: 'inline-block',
        padding: '2px 8px',
        fontSize: '11px',
        borderRadius: '3px',
        backgroundColor: bgColor,
        color: textColor,
        fontWeight: 500,
        marginRight: '8px',
      };
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
        React.createElement('div', { style: titleStyle }, 'AI Usage by Caller'),
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
        ),
      ),

      // Caller stats table with virtual scrolling
      callerStats.length === 0
        ? React.createElement(
            'div',
            { style: emptyStyle },
            'No AI requests in the selected time period.',
          )
        : React.createElement(
            'div',
            null,
            // Table header
            React.createElement(
              'table',
              { style: tableStyle },
              React.createElement(
                'thead',
                null,
                React.createElement(
                  'tr',
                  null,
                  React.createElement('th', { style: { ...thStyle, width: '280px' } }, 'Caller'),
                  React.createElement('th', { style: { ...thStyle, textAlign: 'right', width: '100px' } }, 'Requests'),
                  React.createElement('th', { style: { ...thStyle, textAlign: 'right', width: '120px' } }, 'Tokens'),
                  React.createElement('th', { style: { ...thStyle, textAlign: 'right', width: '100px' } }, 'Cost'),
                  React.createElement('th', { style: { ...thStyle, width: '200px' } }, 'Features'),
                ),
              ),
            ),
            // Virtual scrolling list
            React.createElement(List, {
              height: 500,
              itemCount: callerStats.length,
              itemSize: 45,
              width: '100%',
              itemData: { callerStats, badgeStyle, tdStyle, UI_COLORS },
              children: ({ index, style, data }: any) => {
                const stats = data.callerStats[index];
                return React.createElement(
                  'table',
                  { style: { ...tableStyle, marginTop: 0 } },
                  React.createElement(
                    'tbody',
                    null,
                    React.createElement(
                      'tr',
                      { style },
                      React.createElement(
                        'td',
                        { style: { ...data.tdStyle, width: '280px' } },
                        React.createElement(
                          'span',
                          { style: data.badgeStyle(stats.callerType) },
                          stats.callerType.toUpperCase(),
                        ),
                        stats.callerDisplay,
                      ),
                      React.createElement(
                        'td',
                        { style: { ...data.tdStyle, textAlign: 'right', fontFamily: 'monospace', width: '100px' } },
                        stats.requests.toLocaleString(),
                      ),
                      React.createElement(
                        'td',
                        { style: { ...data.tdStyle, textAlign: 'right', fontFamily: 'monospace', width: '120px' } },
                        stats.totalTokens.toLocaleString(),
                      ),
                      React.createElement(
                        'td',
                        {
                          style: {
                            ...data.tdStyle,
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            color: data.UI_COLORS.WPE_BRAND,
                            width: '100px',
                          },
                        },
                        `$${stats.costUsd.toFixed(4)}`,
                      ),
                      React.createElement(
                        'td',
                        { style: { ...data.tdStyle, fontSize: '12px', color: 'var(--secondaryTextColor)', width: '200px' } },
                        stats.features.size > 0
                          ? Array.from(stats.features).slice(0, 3).join(', ') +
                            (stats.features.size > 3 ? ` +${stats.features.size - 3}` : '')
                          : '—',
                      ),
                    ),
                  ),
                );
              }
            }),
          ),
    );
  }
}
