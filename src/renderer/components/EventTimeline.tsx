/**
 * Event Timeline Component (Sprint 1)
 *
 * Displays a chronological stream of WordPress events across all sites.
 * Features:
 * - Real-time event stream
 * - Filter by event type
 * - Status indicators (✓ Processed, ⏱ Pending, ✗ Failed)
 * - Relative timestamps
 * - Expandable details
 * - Virtual scrolling for large event lists
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { FixedSizeList as List } from 'react-window';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { EventTimelineEntry } from '../../common/types';

interface EventTimelineProps {
  electron: any;
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

interface EventTimelineState {
  events: EventTimelineEntry[];
  filter: string; // 'all' | event_type
  loading: boolean;
  error: string | null;
  expandedId: number | null;
}

// -- Styles --

const containerStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
};

const filterSelectStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  fontSize: '13px',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  color: 'var(--nxai-card-text)',
  cursor: 'pointer',
};

const eventListContainerStyle: React.CSSProperties = {
  // Virtual scrolling container - no maxHeight needed
};

const eventEntryStyle: React.CSSProperties = {
  padding: '12px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  cursor: 'pointer',
  transition: 'background-color 0.2s',
};

const eventHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '4px',
};

const eventSummaryStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-text)',
  marginBottom: '4px',
};

const eventMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
};

const statusBadgeStyle = (status: 'pending' | 'processed' | 'failed'): React.CSSProperties => {
  let bgColor = '';
  let color = '';

  switch (status) {
    case 'processed':
      bgColor = `${UI_COLORS.STATUS_RUNNING}15`;
      color = UI_COLORS.STATUS_RUNNING;
      break;
    case 'pending':
      bgColor = `${UI_COLORS.STATUS_WARNING}15`;
      color = UI_COLORS.STATUS_WARNING;
      break;
    case 'failed':
      bgColor = `${UI_COLORS.STATUS_ERROR}15`;
      color = UI_COLORS.STATUS_ERROR;
      break;
  }

  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    backgroundColor: bgColor,
    color,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };
};

const detailsStyle: React.CSSProperties = {
  marginTop: '8px',
  padding: '12px',
  borderRadius: '4px',
  backgroundColor: 'var(--nxai-card-sub, #f9fafb)',
  fontSize: '12px',
  color: 'var(--nxai-card-text)',
  fontFamily: 'monospace',
  maxHeight: '120px',
  overflowY: 'auto',
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

/**
 * EventTimeline Component
 */
export class EventTimeline extends React.Component<EventTimelineProps, EventTimelineState> {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  static defaultProps = {
    limit: 50,
    autoRefresh: true,
    refreshInterval: 10000, // 10 seconds
  };

  state: EventTimelineState = {
    events: [],
    filter: 'all',
    loading: true,
    error: null,
    expandedId: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchEvents();

    if (this.props.autoRefresh) {
      this.refreshTimer = setInterval(
        () => this.fetchEvents(),
        this.props.refreshInterval!,
      );
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  fetchEvents = async (): Promise<void> => {
    try {
      const { limit } = this.props;
      const { filter } = this.state;

      const params: any = { limit };
      if (filter !== 'all') {
        params.filter = filter;
      }

      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.EVENTS_GET_TIMELINE,
        params,
      );

      if (!this.mounted) return;

      if (result.success) {
        this.setState({
          events: result.events || [],
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to load events',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this.mounted) return;
      this.setState({
        error: err.message || 'Failed to load events',
        loading: false,
      });
    }
  };

  handleFilterChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const newFilter = event.target.value;
    this.setState({ filter: newFilter, loading: true }, () => {
      this.fetchEvents();
    });
  };

  handleEventClick = (id: number): void => {
    this.setState(prevState => ({
      expandedId: prevState.expandedId === id ? null : id,
    }));
  };

  getStatusIcon(status: 'pending' | 'processed' | 'failed'): string {
    switch (status) {
      case 'processed':
        return '✓';
      case 'pending':
        return '⏱';
      case 'failed':
        return '✗';
      default:
        return '○';
    }
  }

  getStatusLabel(status: 'pending' | 'processed' | 'failed'): string {
    switch (status) {
      case 'processed':
        return 'Processed';
      case 'pending':
        return 'Pending';
      case 'failed':
        return 'Failed';
      default:
        return 'Unknown';
    }
  }

  formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
    if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    if (minutes > 0) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
    return 'Just now';
  }

  renderFilterSelect(): React.ReactNode {
    const { filter } = this.state;

    return React.createElement(
      'select',
      {
        style: filterSelectStyle,
        value: filter,
        onChange: this.handleFilterChange,
      },
      React.createElement('option', { value: 'all' }, 'All Events'),
      React.createElement('option', { value: 'post_created' }, 'Content - Created'),
      React.createElement('option', { value: 'post_updated' }, 'Content - Updated'),
      React.createElement('option', { value: 'post_deleted' }, 'Content - Deleted'),
      React.createElement('option', { value: 'plugin_activated' }, 'Plugins - Activated'),
      React.createElement('option', { value: 'plugin_deactivated' }, 'Plugins - Deactivated'),
      React.createElement('option', { value: 'plugin_updated' }, 'Plugins - Updated'),
      React.createElement('option', { value: 'plugin_deleted' }, 'Plugins - Deleted'),
      React.createElement('option', { value: 'user_created' }, 'Users - Created'),
      React.createElement('option', { value: 'user_updated' }, 'Users - Updated'),
      React.createElement('option', { value: 'user_deleted' }, 'Users - Deleted'),
    );
  }

  renderEventList(): React.ReactNode {
    const { events, expandedId } = this.state;

    if (events.length === 0) {
      return React.createElement(
        'div',
        { style: emptyStateStyle },
        'No events found. WordPress events will appear here as they occur.',
      );
    }

    return React.createElement(
      'div',
      { style: eventListContainerStyle },
      React.createElement(List, {
        height: 400,
        itemCount: events.length,
        itemSize: 90,
        width: '100%',
        itemData: {
          events,
          expandedId,
          handleEventClick: this.handleEventClick,
          getStatusIcon: this.getStatusIcon,
          getStatusLabel: this.getStatusLabel,
          formatRelativeTime: this.formatRelativeTime,
        },
        children: ({ index, style, data }: any) => {
          const event = data.events[index];
          const isExpanded = data.expandedId === event.id;

          return React.createElement(
            'div',
            {
              style: {
                ...style,
                paddingBottom: '8px',
              },
            },
            React.createElement(
              'div',
              {
                style: {
                  ...eventEntryStyle,
                  backgroundColor: isExpanded ? 'var(--nxai-card-sub, #f9fafb)' : 'transparent',
                },
                onClick: () => data.handleEventClick(event.id),
              },
              // Event header
              React.createElement(
                'div',
                { style: eventHeaderStyle },
                React.createElement(
                  'span',
                  { style: { fontSize: '16px' } },
                  data.getStatusIcon(event.status),
                ),
                React.createElement('div', { style: { flex: 1 } },
                  React.createElement('div', { style: eventSummaryStyle }, event.summary),
                  React.createElement(
                    'div',
                    { style: eventMetaStyle },
                    React.createElement('span', null, event.siteName),
                    React.createElement('span', null, '•'),
                    React.createElement('span', null, data.formatRelativeTime(event.timestamp)),
                    React.createElement(
                      'span',
                      { style: statusBadgeStyle(event.status) },
                      React.createElement('span', null, data.getStatusIcon(event.status)),
                      React.createElement('span', null, data.getStatusLabel(event.status)),
                    ),
                  ),
                ),
              ),
              // Expanded details
              isExpanded && event.details && React.createElement(
                'div',
                { style: detailsStyle },
                React.createElement('pre', null, JSON.stringify(event.details, null, 2)),
              ),
            ),
          );
        },
      }),
    );
  }

  renderLoading(): React.ReactNode {
    return React.createElement(
      'div',
      { style: { ...emptyStateStyle, padding: '40px 20px' } },
      'Loading events...',
    );
  }

  renderError(): React.ReactNode {
    const { error } = this.state;
    return React.createElement(
      'div',
      {
        style: {
          padding: '20px',
          border: `1px solid ${UI_COLORS.STATUS_ERROR}`,
          borderRadius: '6px',
          backgroundColor: `${UI_COLORS.STATUS_ERROR}10`,
          color: UI_COLORS.STATUS_ERROR,
          fontSize: '13px',
        },
      },
      `Error: ${error}`,
    );
  }

  render(): React.ReactNode {
    const { loading, error, events } = this.state;

    return React.createElement(
      'div',
      { style: containerStyle },
      // Header with title and filter
      React.createElement(
        'div',
        { style: headerStyle },
        React.createElement('div', { style: titleStyle }, 'Event Timeline'),
        this.renderFilterSelect(),
      ),
      // Content
      loading && events.length === 0
        ? this.renderLoading()
        : error
        ? this.renderError()
        : this.renderEventList(),
    );
  }
}
