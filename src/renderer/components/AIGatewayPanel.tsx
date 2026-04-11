/**
 * AI Gateway Panel
 *
 * Combined usage panel with two tabs:
 *   - Requests: per-request log with time, site, caller, model, tokens, cost, duration
 *   - By Caller: aggregated view by plugin/theme/core
 *
 * Fetches data once and shares it between both tabs. Shows trend indicators
 * (vs. the equivalent previous time period) on the summary stat cards.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { FixedSizeList as List } from 'react-window';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';

interface AIGatewayPanelProps {
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
  callerPlugin?: string;
  callerTheme?: string;
  callerFeature?: string;
  callerSource?: string;
  callerUserId?: number;
  callerUserRole?: string;
}

interface CallerStats {
  callerKey: string;
  callerDisplay: string;
  callerType: 'plugin' | 'theme' | 'core' | 'unknown';
  requests: number;
  totalTokens: number;
  costUsd: number;
  features: Set<string>;
}

interface TrendStats {
  requests: number;
  totalTokens: number;
  costUsd: number;
}

type TimeFilter = '1h' | '24h' | '7d' | 'all';
type ActiveTab = 'requests' | 'callers';

interface AIGatewayPanelState {
  // Raw records (all time, unfiltered — filtered client-side)
  allRecords: UsageRecord[];
  // Filtered to current period
  records: UsageRecord[];
  callerStats: CallerStats[];
  // Trend: previous equivalent period
  prevStats: TrendStats | null;
  // Summary
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  loading: boolean;
  clearing: boolean;
  timeFilter: TimeFilter;
  activeTab: ActiveTab;
}

export class AIGatewayPanel extends React.Component<AIGatewayPanelProps, AIGatewayPanelState> {
  private mounted = false;

  state: AIGatewayPanelState = {
    allRecords: [],
    records: [],
    callerStats: [],
    prevStats: null,
    totalRequests: 0,
    totalTokens: 0,
    totalCost: 0,
    loading: true,
    clearing: false,
    timeFilter: '24h',
    activeTab: 'requests',
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
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.AI_GATEWAY_GET_USAGE);
      if (!this.mounted) return;

      if (result?.success && result?.records) {
        this.processRecords(result.records);
      } else {
        this.setState({ loading: false });
      }
    } catch {
      if (this.mounted) this.setState({ loading: false });
    }
  };

  processRecords = (allRecords: UsageRecord[]): void => {
    const { timeFilter } = this.state;
    const now = Date.now();

    const periodMs = this.periodMs(timeFilter);
    const cutoff = periodMs ? now - periodMs : 0;
    const prevCutoff = periodMs ? now - 2 * periodMs : null;

    const records = allRecords.filter((r) => r.timestamp >= cutoff);
    const prevRecords = (periodMs && prevCutoff !== null)
      ? allRecords.filter((r) => r.timestamp >= prevCutoff && r.timestamp < cutoff)
      : null;

    const callerStats = this.aggregateByCaller(records);

    const totalRequests = records.length;
    const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);
    const totalCost = records.reduce((s, r) => s + r.costUsd, 0);

    const prevStats = prevRecords
      ? {
          requests: prevRecords.length,
          totalTokens: prevRecords.reduce((s, r) => s + r.totalTokens, 0),
          costUsd: prevRecords.reduce((s, r) => s + r.costUsd, 0),
        }
      : null;

    this.setState({
      allRecords,
      records,
      callerStats,
      prevStats,
      totalRequests,
      totalTokens,
      totalCost,
      loading: false,
    });
  };

  periodMs = (filter: TimeFilter): number | null => {
    switch (filter) {
      case '1h':  return 60 * 60 * 1000;
      case '24h': return 24 * 60 * 60 * 1000;
      case '7d':  return 7 * 24 * 60 * 60 * 1000;
      case 'all': return null;
    }
  };

  aggregateByCaller = (records: UsageRecord[]): CallerStats[] => {
    const map = new Map<string, CallerStats>();

    for (const r of records) {
      const { callerKey, callerDisplay, callerType } = this.callerInfo(r);

      if (!map.has(callerKey)) {
        map.set(callerKey, { callerKey, callerDisplay, callerType, requests: 0, totalTokens: 0, costUsd: 0, features: new Set() });
      }

      const s = map.get(callerKey)!;
      s.requests += 1;
      s.totalTokens += r.totalTokens;
      s.costUsd += r.costUsd;
      if (r.callerFeature) s.features.add(r.callerFeature);
    }

    return Array.from(map.values()).sort((a, b) => b.costUsd - a.costUsd);
  };

  callerInfo = (r: UsageRecord): { callerKey: string; callerDisplay: string; callerType: CallerStats['callerType'] } => {
    if (r.callerPlugin) return { callerKey: `plugin:${r.callerPlugin}`, callerDisplay: r.callerPlugin, callerType: 'plugin' };
    if (r.callerTheme)  return { callerKey: `theme:${r.callerTheme}`,  callerDisplay: `${r.callerTheme} (theme)`, callerType: 'theme' };
    if (r.callerSource === 'core') return { callerKey: 'core', callerDisplay: 'WordPress Core', callerType: 'core' };
    return { callerKey: 'unknown', callerDisplay: 'Unknown', callerType: 'unknown' };
  };

  handleTimeFilterChange = (timeFilter: TimeFilter): void => {
    this.setState({ timeFilter }, () => this.processRecords(this.state.allRecords));
  };

  handleClearUsage = async (): Promise<void> => {
    if (!confirm('Clear all AI Gateway usage data? This cannot be undone.')) return;
    this.setState({ clearing: true });
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.AI_GATEWAY_CLEAR_USAGE);
      if (!this.mounted) return;
      await this.fetchUsage();
    } catch { /* ignore */ }
    if (this.mounted) this.setState({ clearing: false });
  };

  formatTimestamp = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  formatModel = (model: string): string => {
    if (model.includes('haiku'))  return 'Haiku';
    if (model.includes('sonnet')) return 'Sonnet';
    if (model.includes('opus'))   return 'Opus';
    return model;
  };

  formatCaller = (r: UsageRecord): string => {
    if (r.callerPlugin) return r.callerFeature ? `${r.callerPlugin} / ${r.callerFeature}` : r.callerPlugin;
    if (r.callerTheme)  return `${r.callerTheme} (theme)`;
    if (r.callerSource === 'core') return r.callerFeature ? `WordPress / ${r.callerFeature}` : 'WordPress';
    return '—';
  };

  /** Compute % delta vs previous period. Returns null when not available. */
  trend = (current: number, prev: number | undefined): { pct: number; dir: 'up' | 'down' | 'flat' } | null => {
    if (this.state.timeFilter === 'all' || prev === undefined || this.state.prevStats === null) return null;
    if (prev === 0 && current === 0) return null;
    if (prev === 0) return { pct: 100, dir: 'up' };
    const pct = Math.round(((current - prev) / prev) * 100);
    return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
  };

  renderTrendBadge = (t: ReturnType<typeof this.trend>): React.ReactNode => {
    if (!t) return null;
    const color = t.dir === 'up' ? '#ef4444' : t.dir === 'down' ? '#22c55e' : 'var(--secondaryTextColor)';
    const arrow = t.dir === 'up' ? '↑' : t.dir === 'down' ? '↓' : '—';
    return React.createElement(
      'span',
      { style: { fontSize: '11px', color, marginLeft: '6px', fontWeight: 500 } },
      `${arrow} ${t.pct}%`,
    );
  };

  renderStatCards(): React.ReactNode {
    const { totalRequests, totalTokens, totalCost, prevStats } = this.state;

    const cardStyle: React.CSSProperties = {
      padding: '12px 16px',
      backgroundColor: 'var(--inputBackgroundColor)',
      borderRadius: '4px',
      border: '1px solid var(--dividerColor)',
    };
    const labelStyle: React.CSSProperties = {
      fontSize: '11px',
      color: 'var(--secondaryTextColor)',
      marginBottom: '4px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    };
    const valueRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: '4px' };
    const valueStyle: React.CSSProperties = { fontSize: '20px', fontWeight: 600, color: 'var(--primaryTextColor)' };

    const reqTrend = this.trend(totalRequests, prevStats?.requests);
    const tokTrend = this.trend(totalTokens, prevStats?.totalTokens);
    const costTrend = this.trend(totalCost, prevStats?.costUsd);

    return React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' } },
      React.createElement(
        'div',
        { style: cardStyle },
        React.createElement('div', { style: labelStyle }, 'Total Requests'),
        React.createElement(
          'div',
          { style: valueRowStyle },
          React.createElement('span', { style: valueStyle }, totalRequests.toLocaleString()),
          this.renderTrendBadge(reqTrend),
        ),
      ),
      React.createElement(
        'div',
        { style: cardStyle },
        React.createElement('div', { style: labelStyle }, 'Total Tokens'),
        React.createElement(
          'div',
          { style: valueRowStyle },
          React.createElement('span', { style: valueStyle }, totalTokens.toLocaleString()),
          this.renderTrendBadge(tokTrend),
        ),
      ),
      React.createElement(
        'div',
        { style: cardStyle },
        React.createElement('div', { style: labelStyle }, 'Total Cost'),
        React.createElement(
          'div',
          { style: valueRowStyle },
          React.createElement('span', { style: { ...valueStyle, color: UI_COLORS.WPE_BRAND } }, `$${totalCost.toFixed(4)}`),
          this.renderTrendBadge(costTrend),
        ),
      ),
    );
  }

  renderRequestsTab(): React.ReactNode {
    const { records } = this.state;

    const thStyle: React.CSSProperties = {
      padding: '6px 8px',
      color: 'var(--secondaryTextColor)',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      fontWeight: 500,
    };
    const tdStyle: React.CSSProperties = {
      padding: '0 8px 0 0',
      color: 'var(--primaryTextColor)',
      fontSize: '13px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    };

    const emptyStyle: React.CSSProperties = {
      textAlign: 'center',
      padding: '32px',
      color: 'var(--secondaryTextColor)',
      fontSize: '14px',
    };

    if (records.length === 0) {
      return React.createElement('div', { style: emptyStyle }, 'No AI requests in this time period.');
    }

    const { formatTimestamp, formatCaller, formatModel } = this;

    return React.createElement(
      'div',
      null,
      // Header row
      React.createElement(
        'div',
        { style: { display: 'flex', borderBottom: '1px solid var(--dividerColor)', padding: '0 8px' } },
        React.createElement('div', { style: { ...thStyle, width: '110px', flexShrink: 0 } }, 'Time'),
        React.createElement('div', { style: { ...thStyle, width: '120px', flexShrink: 0 } }, 'Site'),
        React.createElement('div', { style: { ...thStyle, width: '170px', flexShrink: 0 } }, 'Caller'),
        React.createElement('div', { style: { ...thStyle, width: '70px', flexShrink: 0 } }, 'Model'),
        React.createElement('div', { style: { ...thStyle, flex: 1, textAlign: 'right' } }, 'Tokens'),
        React.createElement('div', { style: { ...thStyle, width: '75px', flexShrink: 0, textAlign: 'right' } }, 'Cost'),
        React.createElement('div', { style: { ...thStyle, width: '65px', flexShrink: 0, textAlign: 'right' } }, 'Duration'),
      ),
      // Virtual rows
      React.createElement(List, {
        height: 360,
        itemCount: records.length,
        itemSize: 38,
        width: '100%',
        itemData: { records, formatTimestamp, formatCaller, formatModel, tdStyle },
        children: ({ index, style, data }: any) => {
          const r = data.records[index];
          const hasCallerInfo = r.callerPlugin || r.callerTheme || r.callerSource;
          return React.createElement(
            'div',
            {
              style: {
                ...style,
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid var(--dividerColor)',
                padding: '0 8px',
                boxSizing: 'border-box',
              },
            },
            React.createElement('div', { style: { ...data.tdStyle, width: '110px', flexShrink: 0, fontSize: '12px' } }, data.formatTimestamp(r.timestamp)),
            React.createElement('div', { style: { ...data.tdStyle, width: '120px', flexShrink: 0 } }, r.siteName || r.siteId),
            React.createElement('div', {
              style: {
                ...data.tdStyle,
                width: '170px',
                flexShrink: 0,
                fontSize: '12px',
                color: hasCallerInfo ? 'var(--primaryTextColor)' : 'var(--secondaryTextColor)',
              },
            }, data.formatCaller(r)),
            React.createElement('div', { style: { ...data.tdStyle, width: '70px', flexShrink: 0, fontSize: '12px' } }, data.formatModel(r.model)),
            React.createElement('div', { style: { ...data.tdStyle, flex: 1, textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' } }, `${r.totalTokens.toLocaleString()} (${r.promptTokens}+${r.completionTokens})`),
            React.createElement('div', { style: { ...data.tdStyle, width: '75px', flexShrink: 0, textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' } }, `$${r.costUsd.toFixed(4)}`),
            React.createElement('div', { style: { ...data.tdStyle, width: '65px', flexShrink: 0, textAlign: 'right', fontFamily: 'monospace', fontSize: '12px' } }, `${(r.durationMs / 1000).toFixed(2)}s`),
          );
        },
      }),
    );
  }

  renderCallersTab(): React.ReactNode {
    const { callerStats } = this.state;

    const thStyle: React.CSSProperties = {
      padding: '6px 8px',
      color: 'var(--secondaryTextColor)',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      fontWeight: 500,
    };
    const tdStyle: React.CSSProperties = {
      padding: '0 8px 0 0',
      color: 'var(--primaryTextColor)',
      fontSize: '13px',
    };
    const emptyStyle: React.CSSProperties = {
      textAlign: 'center',
      padding: '32px',
      color: 'var(--secondaryTextColor)',
      fontSize: '14px',
    };

    const badgeColors: Record<string, string> = {
      plugin: '#2563eb',
      theme: '#7c3aed',
      core: '#059669',
      unknown: '#6b7280',
    };

    const badgeStyle = (type: string): React.CSSProperties => ({
      fontSize: '10px',
      fontWeight: 600,
      padding: '1px 5px',
      borderRadius: '3px',
      backgroundColor: badgeColors[type] || '#6b7280',
      color: '#fff',
      letterSpacing: '0.3px',
      flexShrink: 0,
    });

    if (callerStats.length === 0) {
      return React.createElement('div', { style: emptyStyle }, 'No AI requests in this time period.');
    }

    return React.createElement(
      'div',
      null,
      // Header row
      React.createElement(
        'div',
        { style: { display: 'flex', borderBottom: '1px solid var(--dividerColor)', padding: '0 8px' } },
        React.createElement('div', { style: { ...thStyle, width: '260px', flexShrink: 0 } }, 'Caller'),
        React.createElement('div', { style: { ...thStyle, width: '90px', flexShrink: 0, textAlign: 'right' } }, 'Requests'),
        React.createElement('div', { style: { ...thStyle, width: '110px', flexShrink: 0, textAlign: 'right' } }, 'Tokens'),
        React.createElement('div', { style: { ...thStyle, width: '85px', flexShrink: 0, textAlign: 'right' } }, 'Cost'),
        React.createElement('div', { style: { ...thStyle, flex: 1 } }, 'Features'),
      ),
      // Virtual rows
      React.createElement(List, {
        height: 360,
        itemCount: callerStats.length,
        itemSize: 42,
        width: '100%',
        itemData: { callerStats, badgeStyle, tdStyle, UI_COLORS },
        children: ({ index, style, data }: any) => {
          const s = data.callerStats[index];
          return React.createElement(
            'div',
            {
              style: {
                ...style,
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid var(--dividerColor)',
                padding: '0 8px',
                boxSizing: 'border-box',
              },
            },
            // Caller badge + name
            React.createElement(
              'div',
              { style: { ...data.tdStyle, width: '260px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' } },
              React.createElement('span', { style: data.badgeStyle(s.callerType) }, s.callerType.toUpperCase()),
              React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' } }, s.callerDisplay),
            ),
            React.createElement('div', { style: { ...data.tdStyle, width: '90px', flexShrink: 0, textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' } }, s.requests.toLocaleString()),
            React.createElement('div', { style: { ...data.tdStyle, width: '110px', flexShrink: 0, textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' } }, s.totalTokens.toLocaleString()),
            React.createElement('div', {
              style: { ...data.tdStyle, width: '85px', flexShrink: 0, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: data.UI_COLORS.WPE_BRAND, fontSize: '13px' },
            }, `$${s.costUsd.toFixed(4)}`),
            React.createElement('div', {
              style: { ...data.tdStyle, flex: 1, fontSize: '12px', color: 'var(--secondaryTextColor)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }, s.features.size > 0
              ? Array.from(s.features).slice(0, 3).join(', ') + (s.features.size > 3 ? ` +${s.features.size - 3}` : '')
              : '—',
            ),
          );
        },
      }),
    );
  }

  render(): React.ReactNode {
    const { loading, clearing, timeFilter, activeTab } = this.state;

    const containerStyle: React.CSSProperties = {
      backgroundColor: 'var(--containerBackgroundColor)',
      border: '1px solid var(--dividerColor)',
      borderRadius: '6px',
      padding: '16px',
      marginTop: '16px',
    };

    const filterBtnStyle = (active: boolean): React.CSSProperties => ({
      padding: '4px 10px',
      fontSize: '12px',
      border: '1px solid ' + (active ? UI_COLORS.WPE_BRAND : 'var(--dividerColor)'),
      borderRadius: '4px',
      backgroundColor: active ? UI_COLORS.WPE_BRAND : 'transparent',
      color: active ? '#fff' : 'var(--primaryTextColor)',
      cursor: 'pointer',
    });

    const tabStyle = (active: boolean): React.CSSProperties => ({
      padding: '6px 14px',
      fontSize: '13px',
      fontWeight: active ? 600 : 400,
      color: active ? 'var(--primaryTextColor)' : 'var(--secondaryTextColor)',
      borderBottom: active ? `2px solid ${UI_COLORS.WPE_BRAND}` : '2px solid transparent',
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      paddingBottom: '6px',
    });

    const clearBtnStyle: React.CSSProperties = {
      padding: '4px 10px',
      fontSize: '12px',
      border: '1px solid var(--dividerColor)',
      borderRadius: '4px',
      backgroundColor: 'transparent',
      color: 'var(--secondaryTextColor)',
      cursor: 'pointer',
    };

    if (loading) {
      return React.createElement(
        'div',
        { style: containerStyle },
        React.createElement('div', { style: { padding: '32px', textAlign: 'center', color: 'var(--secondaryTextColor)' } }, 'Loading usage data…'),
      );
    }

    return React.createElement(
      'div',
      { style: containerStyle },

      // ── Top bar: title + time filters + clear ──────────────────────────────
      React.createElement(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' } },
        React.createElement('div', { style: { fontSize: '15px', fontWeight: 600, color: 'var(--primaryTextColor)' } }, 'AI Gateway Usage'),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          ...(['1h', '24h', '7d', 'all'] as TimeFilter[]).map((f) =>
            React.createElement('button', { key: f, style: filterBtnStyle(timeFilter === f), onClick: () => this.handleTimeFilterChange(f) },
              f === '1h' ? '1 Hour' : f === '24h' ? '24 Hours' : f === '7d' ? '7 Days' : 'All Time',
            ),
          ),
          React.createElement(
            'button',
            { style: { ...clearBtnStyle, marginLeft: '8px' }, onClick: this.handleClearUsage, disabled: clearing },
            clearing ? 'Clearing…' : 'Clear All',
          ),
        ),
      ),

      // ── Stat cards with trend indicators ──────────────────────────────────
      this.renderStatCards(),

      // ── Tabs ──────────────────────────────────────────────────────────────
      React.createElement(
        'div',
        { style: { display: 'flex', borderBottom: '1px solid var(--dividerColor)', marginBottom: '12px', gap: '0' } },
        React.createElement('button', { style: tabStyle(activeTab === 'requests'), onClick: () => this.setState({ activeTab: 'requests' }) }, 'Requests'),
        React.createElement('button', { style: tabStyle(activeTab === 'callers'), onClick: () => this.setState({ activeTab: 'callers' }) }, 'By Caller'),
      ),

      // ── Active tab content ─────────────────────────────────────────────────
      activeTab === 'requests' ? this.renderRequestsTab() : this.renderCallersTab(),
    );
  }
}
