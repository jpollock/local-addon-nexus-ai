/**
 * Site Groups Panel Component (Sprint 3)
 *
 * Displays and manages Local's native site groups.
 * Features:
 * - List of groups with site count
 * - Create new group
 * - Delete non-default groups
 * - Expandable view shows member site names
 *
 * Class-based -- Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import type { SiteGroupInfo } from '../../common/types';

interface SiteGroupsPanelProps {
  electron: any;
  sites?: Array<{ id: string; name: string; domain?: string }>;
}

interface SiteGroupsPanelState {
  groups: SiteGroupInfo[];
  loading: boolean;
  error: string | null;
  showCreateForm: boolean;
  newGroupName: string;
  expandedGroupId: string | null;
}

// -- Styles --

const containerStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
};

const titleRowStyle: React.CSSProperties = {
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

const newButtonStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: '4px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'transparent',
  color: 'var(--nxai-card-text)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const groupListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const GROUP_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const groupCardStyle = (index: number): React.CSSProperties => ({
  padding: '12px 14px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  borderLeft: `4px solid ${GROUP_COLORS[index % GROUP_COLORS.length]}`,
  backgroundColor: 'transparent',
  cursor: 'pointer',
});

const groupHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};

const groupInfoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const groupNameStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const groupMetaStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginTop: '2px',
};

const groupActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  flexShrink: 0,
};

const deleteBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: '#ef444420',
  color: 'var(--color-error, #ef4444)',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
};

const expandedSectionStyle: React.CSSProperties = {
  marginTop: '10px',
  paddingTop: '10px',
  borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
};

const siteListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const siteItemStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--nxai-card-text)',
  padding: '4px 8px',
  borderRadius: '4px',
  backgroundColor: 'var(--nxai-card-border, #e5e7eb)',
};

const noSitesStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontStyle: 'italic',
};

const createFormStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '12px',
  alignItems: 'center',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '4px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  fontSize: '13px',
  color: 'var(--nxai-card-text)',
  backgroundColor: 'transparent',
  outline: 'none',
  flex: 1,
};

const submitBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: '#3b82f6',
  color: '#fff',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '4px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'transparent',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
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
 * SiteGroupsPanel Component — wraps Local's native site groups
 */
export class SiteGroupsPanel extends React.Component<SiteGroupsPanelProps, SiteGroupsPanelState> {
  _mounted = false;

  state: SiteGroupsPanelState = {
    groups: [],
    loading: true,
    error: null,
    showCreateForm: false,
    newGroupName: '',
    expandedGroupId: null,
  };

  componentDidMount(): void {
    this._mounted = true;
    this.fetchGroups();
  }

  componentWillUnmount(): void {
    this._mounted = false;
  }

  fetchGroups = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.GROUPS_LIST,
      );

      if (!this._mounted) return;

      if (result.success) {
        this.setState({
          groups: result.groups || [],
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to load groups',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this._mounted) return;
      this.setState({
        error: err.message || 'Failed to load groups',
        loading: false,
      });
    }
  };

  handleCreate = async (): Promise<void> => {
    const { newGroupName } = this.state;
    if (!newGroupName.trim()) return;

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.GROUPS_CREATE,
        { name: newGroupName.trim() },
      );

      if (!this._mounted) return;

      if (result.success && result.group) {
        this.setState(prev => ({
          groups: [...prev.groups, result.group],
          showCreateForm: false,
          newGroupName: '',
        }));
      }
    } catch {
      // Silently handle
    }
  };

  handleDelete = async (groupId: string): Promise<void> => {
    const group = this.state.groups.find(g => g.id === groupId);
    if (!group || groupId === 'default') return;

    const confirmed = window.confirm(`Delete group "${group.name}"? Sites will be moved to the default group.`);
    if (!confirmed) return;

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.GROUPS_DELETE,
        groupId,
      );

      if (!this._mounted) return;

      if (result.success) {
        this.setState(prev => ({
          groups: prev.groups.filter(g => g.id !== groupId),
          expandedGroupId: prev.expandedGroupId === groupId ? null : prev.expandedGroupId,
        }));
      }
    } catch {
      // Silently handle
    }
  };

  handleToggleExpand = (groupId: string): void => {
    this.setState(prev => ({
      expandedGroupId: prev.expandedGroupId === groupId ? null : groupId,
    }));
  };

  getSiteName(siteId: string): string {
    const sites = this.props.sites || [];
    const site = sites.find(s => s.id === siteId);
    return site ? site.name : siteId;
  }

  renderCreateForm(): React.ReactNode {
    const { newGroupName } = this.state;

    return React.createElement(
      'div',
      { style: createFormStyle },
      React.createElement('input', {
        style: inputStyle,
        type: 'text',
        placeholder: 'Group name...',
        value: newGroupName,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ newGroupName: e.target.value }),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter') this.handleCreate();
          if (e.key === 'Escape') this.setState({ showCreateForm: false, newGroupName: '' });
        },
      }),
      React.createElement(
        'button',
        { style: submitBtnStyle, onClick: () => this.handleCreate() },
        'Create',
      ),
      React.createElement(
        'button',
        { style: cancelBtnStyle, onClick: () => this.setState({ showCreateForm: false, newGroupName: '' }) },
        'Cancel',
      ),
    );
  }

  renderExpandedSection(group: SiteGroupInfo): React.ReactNode {
    const siteIds = group.siteIds || [];

    return React.createElement(
      'div',
      { style: expandedSectionStyle },
      siteIds.length > 0
        ? React.createElement(
            'div',
            { style: siteListStyle },
            siteIds.map(siteId =>
              React.createElement('div', { key: siteId, style: siteItemStyle }, this.getSiteName(siteId)),
            ),
          )
        : React.createElement('div', { style: noSitesStyle }, 'No sites in this group'),
    );
  }

  renderGroup(group: SiteGroupInfo, idx: number): React.ReactNode {
    const isExpanded = this.state.expandedGroupId === group.id;
    const siteCount = (group.siteIds || []).length;
    const isDefault = group.id === 'default';

    return React.createElement(
      'div',
      { key: group.id, style: groupCardStyle(idx) },
      React.createElement(
        'div',
        { style: groupHeaderStyle, onClick: () => this.handleToggleExpand(group.id) },
        React.createElement(
          'div',
          { style: groupInfoStyle },
          React.createElement('div', { style: groupNameStyle }, group.name),
          React.createElement(
            'div',
            { style: groupMetaStyle },
            `${siteCount} site${siteCount === 1 ? '' : 's'}`,
          ),
        ),
        !isDefault
          ? React.createElement(
              'div',
              { style: groupActionsStyle, onClick: (e: React.MouseEvent) => e.stopPropagation() },
              React.createElement(
                'button',
                { style: deleteBtnStyle, onClick: () => this.handleDelete(group.id) },
                'Delete',
              ),
            )
          : null,
      ),
      isExpanded ? this.renderExpandedSection(group) : null,
    );
  }

  renderEmptyState(): React.ReactNode {
    return React.createElement(
      'div',
      { style: emptyStateStyle },
      'No site groups found.',
    );
  }

  renderLoading(): React.ReactNode {
    return React.createElement('div', { style: loadingStyle }, 'Loading groups...');
  }

  renderError(): React.ReactNode {
    return React.createElement('div', { style: errorStyle }, `Error: ${this.state.error}`);
  }

  render(): React.ReactNode {
    const { loading, error, showCreateForm, groups } = this.state;

    let content: React.ReactNode;
    if (loading) {
      content = this.renderLoading();
    } else if (error) {
      content = this.renderError();
    } else if (groups.length === 0 && !showCreateForm) {
      content = this.renderEmptyState();
    } else {
      content = React.createElement(
        'div',
        { style: groupListStyle },
        groups.map((g, i) => this.renderGroup(g, i)),
      );
    }

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement(
        'div',
        { style: titleRowStyle },
        React.createElement('div', { style: titleStyle }, 'Site Groups'),
        React.createElement(
          'button',
          {
            style: newButtonStyle,
            onClick: () => this.setState({ showCreateForm: !showCreateForm }),
          },
          showCreateForm ? 'Cancel' : '+ New Group',
        ),
      ),
      showCreateForm ? this.renderCreateForm() : null,
      content,
    );
  }
}
