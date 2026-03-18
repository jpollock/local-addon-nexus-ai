/**
 * Smart Filters Panel Component (Sprint 2)
 *
 * Displays smart filters grouped by category with count badges.
 * Features:
 * - Fetches filter counts via IPC on mount
 * - Auto-refresh every 60 seconds
 * - Filters grouped by category (security, maintenance, activity, health)
 * - Clickable filter buttons with count badges
 * - Color-coded by severity (error, warning, info)
 * - "All Clear" state when all counts are 0
 * - Loading and error states
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';

interface SmartFilter {
  id: string;
  category: string;
  label: string;
  description: string;
  count: number;
  severity: 'info' | 'warning' | 'error';
}

interface SmartFiltersPanelProps {
  electron: any;
  onFilterClick?: (filterId: string, siteIds: string[]) => void;
}

interface SmartFiltersPanelState {
  filters: SmartFilter[];
  loading: boolean;
  error: string | null;
  activeFilter: string | null;
  applying: boolean;
}

// -- Severity colors --

const SEVERITY_COLORS: Record<string, string> = {
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

// -- Category display names --

const CATEGORY_LABELS: Record<string, string> = {
  security: 'Security',
  maintenance: 'Maintenance',
  activity: 'Activity',
  health: 'Health',
};

// -- Styles --

const containerStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '16px',
};

const categoryGroupStyle: React.CSSProperties = {
  marginBottom: '14px',
};

const categoryLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginBottom: '8px',
};

const filterListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const filterButtonStyle = (severity: string, active: boolean): React.CSSProperties => {
  const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.info;
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    borderRadius: '20px',
    border: active ? `2px solid ${color}` : '1px solid var(--nxai-card-border, #e5e7eb)',
    backgroundColor: active ? `${color}10` : 'transparent',
    borderLeft: `3px solid ${color}`,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--nxai-card-text)',
    transition: 'all 0.2s',
    width: '100%',
    textAlign: 'left' as const,
  };
};

const countBadgeStyle = (severity: string): React.CSSProperties => {
  const color = SEVERITY_COLORS[severity] || SEVERITY_COLORS.info;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '22px',
    height: '22px',
    borderRadius: '11px',
    backgroundColor: `${color}20`,
    color,
    fontSize: '11px',
    fontWeight: 700,
    padding: '0 6px',
  };
};

const filterLabelStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
};

const emptyIconStyle: React.CSSProperties = {
  fontSize: '48px',
  marginBottom: '12px',
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#22c55e',
  marginBottom: '4px',
};

const emptySubtextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
};

const loadingStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

const errorStyle: React.CSSProperties = {
  padding: '20px',
  border: '1px solid #ef4444',
  borderRadius: '6px',
  backgroundColor: '#ef444410',
  color: 'var(--color-error, #ef4444)',
  fontSize: '13px',
};

/**
 * SmartFiltersPanel Component
 */
export class SmartFiltersPanel extends React.Component<SmartFiltersPanelProps, SmartFiltersPanelState> {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _mounted = false;

  state: SmartFiltersPanelState = {
    filters: [],
    loading: true,
    error: null,
    activeFilter: null,
    applying: false,
  };

  componentDidMount(): void {
    this._mounted = true;
    this.fetchFilters();
    this.refreshTimer = setInterval(() => this.fetchFilters(), 60000);
  }

  componentWillUnmount(): void {
    this._mounted = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  fetchFilters = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.FILTERS_GET_COUNTS,
      );

      if (!this._mounted) return;

      if (result.success) {
        this.setState({
          filters: result.filters || [],
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to load filters',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this._mounted) return;
      this.setState({
        error: err.message || 'Failed to load filters',
        loading: false,
      });
    }
  };

  handleFilterClick = async (filterId: string): Promise<void> => {
    if (this.state.applying) return;

    this.setState({ activeFilter: filterId, applying: true });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.FILTERS_APPLY,
        filterId,
      );

      if (!this._mounted) return;

      this.setState({ applying: false });

      if (result.success && this.props.onFilterClick) {
        this.props.onFilterClick(filterId, result.siteIds || []);
      }
    } catch (err: any) {
      if (!this._mounted) return;
      this.setState({ applying: false });
    }
  };

  getFiltersByCategory(): Record<string, SmartFilter[]> {
    const groups: Record<string, SmartFilter[]> = {};
    for (const filter of this.state.filters) {
      if (filter.count > 0) {
        if (!groups[filter.category]) {
          groups[filter.category] = [];
        }
        groups[filter.category].push(filter);
      }
    }
    return groups;
  }

  hasActiveFilters(): boolean {
    return this.state.filters.some(f => f.count > 0);
  }

  renderFilter(filter: SmartFilter): React.ReactNode {
    const { activeFilter, applying } = this.state;
    const isActive = activeFilter === filter.id;

    return React.createElement(
      'button',
      {
        key: filter.id,
        style: filterButtonStyle(filter.severity, isActive),
        onClick: () => this.handleFilterClick(filter.id),
        disabled: applying,
        title: filter.description,
      },
      React.createElement('span', { style: countBadgeStyle(filter.severity) }, String(filter.count)),
      React.createElement('span', { style: filterLabelStyle }, filter.label),
    );
  }

  renderCategory(category: string, filters: SmartFilter[]): React.ReactNode {
    return React.createElement(
      'div',
      { key: category, style: categoryGroupStyle },
      React.createElement('div', { style: categoryLabelStyle }, CATEGORY_LABELS[category] || category),
      React.createElement(
        'div',
        { style: filterListStyle },
        filters.map(f => this.renderFilter(f)),
      ),
    );
  }

  renderAllClear(): React.ReactNode {
    return React.createElement(
      'div',
      { style: emptyStateStyle },
      React.createElement('div', { style: emptyIconStyle }, '\u2713'),
      React.createElement('div', { style: emptyTextStyle }, 'All Clear'),
      React.createElement('div', { style: emptySubtextStyle }, 'No issues detected across your fleet'),
    );
  }

  renderLoading(): React.ReactNode {
    return React.createElement('div', { style: loadingStyle }, 'Loading filters...');
  }

  renderError(): React.ReactNode {
    return React.createElement('div', { style: errorStyle }, `Error: ${this.state.error}`);
  }

  render(): React.ReactNode {
    const { loading, error } = this.state;

    let content: React.ReactNode;
    if (loading) {
      content = this.renderLoading();
    } else if (error) {
      content = this.renderError();
    } else if (!this.hasActiveFilters()) {
      content = this.renderAllClear();
    } else {
      const groups = this.getFiltersByCategory();
      const categoryOrder = ['security', 'maintenance', 'activity', 'health'];
      const sortedCategories = Object.keys(groups).sort((a, b) => {
        const ai = categoryOrder.indexOf(a);
        const bi = categoryOrder.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      content = React.createElement(
        'div',
        null,
        sortedCategories.map(cat => this.renderCategory(cat, groups[cat])),
      );
    }

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement('div', { style: titleStyle }, 'Smart Filters'),
      content,
    );
  }
}
