/**
 * Fleet Management - Power User Interface
 *
 * Dedicated full-width interface for managing large numbers of sites (local + WPE).
 * Optimized for power users with AI-powered search, advanced filtering, and bulk operations.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import { SiteHealthBadge } from './SiteHealthBadge';
import { FleetTreeView } from './FleetTreeView';

interface FleetProps {
  electron: any;
}

interface SiteRow {
  id: string;
  name: string;
  domain: string;
  source: 'local' | 'wpe';
  status: string; // 'running', 'halted', 'remote'
  wpVersion: string | null;
  phpVersion: string | null;
  indexed: boolean;
  indexedAt: number | null;
  documentCount: number;
  chunkCount: number;
  healthScore: number | null;
  linkedLocalSite?: { id: string; name: string }; // For WPE sites
  wpeInstallId?: string; // For WPE sites
  port: number | null;
  isConnectedToWpe: boolean; // For local sites connected to WPE
}

interface FleetState {
  sites: SiteRow[];
  loading: boolean;
  searchQuery: string;
  aiSearchMode: boolean;
  showLocalSites: boolean;
  showWpeSites: boolean;
  sortBy: 'name' | 'lastUsed' | 'wpVersion' | 'status';
  sortDirection: 'asc' | 'desc';
  expandedRows: Set<string>;
  selectedSites: Set<string>;
  filterStatus: 'all' | 'running' | 'halted' | 'remote';
  actionMenuOpen: string | null; // siteId of the open menu
  viewMode: 'table' | 'tree'; // POC: toggle between flat table and grouped tree
}

export class Fleet extends React.Component<FleetProps, FleetState> {
  private mounted: boolean = false;

  constructor(props: FleetProps) {
    super(props);

    this.state = {
      sites: [],
      loading: true,
      searchQuery: '',
      aiSearchMode: false,
      showLocalSites: true,
      showWpeSites: true,
      sortBy: 'name',
      sortDirection: 'asc',
      expandedRows: new Set(),
      selectedSites: new Set(),
      filterStatus: 'all',
      actionMenuOpen: null,
      viewMode: 'tree', // Start with tree view for POC
    };
  }

  async componentDidMount(): Promise<void> {
    this.mounted = true;
    await this.loadSites();
    document.addEventListener('click', this.handleDocumentClick);
    this.injectStyles();
  }

  injectStyles(): void {
    if (document.getElementById('fleet-action-menu-styles')) return;

    const style = document.createElement('style');
    style.id = 'fleet-action-menu-styles';
    style.textContent = `
      .fleet-action-menu-item:hover:not(:disabled) {
        background: #f3f4f6;
      }
    `;
    document.head.appendChild(style);
  }

  componentWillUnmount(): void {
    this.mounted = false;
    document.removeEventListener('click', this.handleDocumentClick);
  }

  handleDocumentClick = (): void => {
    if (this.state.actionMenuOpen) {
      this.setState({ actionMenuOpen: null });
    }
  };

  async loadSites(): Promise<void> {
    this.setState({ loading: true });

    try {
      // Fetch local sites
      const localSitesResult = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SITES);

      // Fetch WPE sites
      const wpeSitesResult = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES);

      // Fetch index status
      const indexEntries = await this.props.electron.ipcRenderer.invoke('nexus-ai:get-fleet-status');

      // Build index map
      const indexMap = new Map<string, any>();
      if (indexEntries?.indexed) {
        indexEntries.indexed.forEach((entry: any) => {
          indexMap.set(entry.siteId, entry);
        });
      }

      // Build WPE install → local site linkage map
      const wpeInstallIdToLocalSite = new Map<string, { id: string; name: string }>();
      if (localSitesResult) {
        localSitesResult.forEach((site: any) => {
          const connections = site.hostConnections;
          if (!connections) return;

          const connList = Array.isArray(connections) ? connections : Object.values(connections);
          for (const conn of connList as any[]) {
            if (conn.hostId === 'wpe' && conn.installId) {
              wpeInstallIdToLocalSite.set(conn.installId, { id: site.id, name: site.name });
            }
          }
        });
      }

      // Transform local sites
      const localSites: SiteRow[] = (localSitesResult || []).map((site: any) => {
        const indexEntry = indexMap.get(site.id);
        return {
          id: site.id,
          name: site.name,
          domain: site.domain,
          source: 'local' as const,
          status: site.status || 'halted',
          wpVersion: site.wpVersion || null,
          phpVersion: site.phpVersion || null,
          indexed: !!indexEntry,
          indexedAt: indexEntry?.lastIndexed || null,
          documentCount: indexEntry?.documentCount || 0,
          chunkCount: indexEntry?.chunkCount || 0,
          healthScore: null, // TODO: fetch from health service
          port: site.port,
          isConnectedToWpe: site.isWpe || false,
          wpeInstallId: site.wpeInstallId || undefined,
        };
      });

      // Transform WPE sites
      const wpeSites: SiteRow[] = (wpeSitesResult?.sites || []).map((site: any) => {
        const indexEntry = indexMap.get(site.id);
        const linkedLocal = site.remote_install_id ? wpeInstallIdToLocalSite.get(site.remote_install_id) : undefined;

        return {
          id: site.id,
          name: site.name,
          domain: site.domain,
          source: 'wpe' as const,
          status: 'remote',
          wpVersion: site.wp_version || null,
          phpVersion: null, // WPE doesn't provide PHP version via API
          indexed: !!indexEntry,
          indexedAt: indexEntry?.lastIndexed || null,
          documentCount: indexEntry?.documentCount || 0,
          chunkCount: indexEntry?.chunkCount || 0,
          healthScore: null,
          linkedLocalSite: linkedLocal,
          wpeInstallId: site.remote_install_id,
          port: null,
          isConnectedToWpe: false,
        };
      });

      const allSites = [...localSites, ...wpeSites];
      this.setState({ sites: allSites, loading: false });

    } catch (error) {
      console.error('[Fleet] Failed to load sites:', error);
      this.setState({ loading: false });
    }
  }

  toggleRow = (siteId: string): void => {
    const expanded = new Set(this.state.expandedRows);
    if (expanded.has(siteId)) {
      expanded.delete(siteId);
    } else {
      expanded.add(siteId);
    }
    this.setState({ expandedRows: expanded });
  };

  toggleSiteSelection = (siteId: string): void => {
    const selected = new Set(this.state.selectedSites);
    if (selected.has(siteId)) {
      selected.delete(siteId);
    } else {
      selected.add(siteId);
    }
    this.setState({ selectedSites: selected });
  };

  handleSiteClick = (site: SiteRow): void => {
    if (site.source === 'local') {
      // Navigate to Local's site info view
      window.location.hash = `#/main/site-info/${site.id}`;
    } else {
      // WPE site - show info modal
      this.showWPESiteModal(site);
    }
  };

  showWPESiteModal = (site: SiteRow): void => {
    // TODO: Implement proper modal component
    const message = [
      `Site: ${site.name}`,
      `Domain: ${site.domain}`,
      `WordPress: ${site.wpVersion || 'Unknown'}`,
      site.linkedLocalSite ? `\nLinked to local site: ${site.linkedLocalSite.name}` : '',
      `\n[Pull to Local button - TODO]`,
    ].join('\n');
    alert(message);
  };

  toggleActionMenu = (siteId: string): void => {
    this.setState(prev => ({
      actionMenuOpen: prev.actionMenuOpen === siteId ? null : siteId,
    }));
  };

  handleAction = async (site: SiteRow, action: string): Promise<void> => {
    this.setState({ actionMenuOpen: null });

    try {
      switch (action) {
        case 'setup-ai':
          await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SETUP_AI, site.id);
          alert(`AI setup initiated for ${site.name}`);
          break;

        case 'index':
          await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_SITE, site.id);
          alert(`Indexing started for ${site.name}`);
          await this.loadSites(); // Refresh
          break;

        case 'start':
          await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.START_SITE, site.id);
          alert(`Starting ${site.name}...`);
          await this.loadSites();
          break;

        case 'stop':
          await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.STOP_SITE, site.id);
          alert(`Stopping ${site.name}...`);
          await this.loadSites();
          break;

        case 'pull-to-local':
          // TODO: Implement WPE → Local pull
          alert(`Pull to Local for ${site.name} - Coming soon`);
          break;

        case 'view-details':
          this.showWPESiteModal(site);
          break;

        case 'open-site':
          if (site.port) {
            window.open(`http://localhost:${site.port}`, '_blank');
          }
          break;

        case 'open-admin':
          if (site.port) {
            window.open(`http://localhost:${site.port}/wp-admin`, '_blank');
          }
          break;

        default:
          alert(`Action: ${action} for ${site.name}`);
      }
    } catch (error) {
      console.error('[Fleet] Action failed:', error);
      alert(`Failed to ${action}: ${(error as Error).message}`);
    }
  };

  renderSiteTable(): React.ReactNode {
    const { sites, showLocalSites, showWpeSites, filterStatus, expandedRows, selectedSites } = this.state;

    // Filter sites
    let filteredSites = sites.filter(site => {
      if (site.source === 'local' && !showLocalSites) return false;
      if (site.source === 'wpe' && !showWpeSites) return false;
      if (filterStatus !== 'all' && site.status !== filterStatus) return false;
      return true;
    });

    // Sort sites
    filteredSites = filteredSites.sort((a, b) => {
      const { sortBy, sortDirection } = this.state;
      let comparison = 0;

      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'wpVersion') {
        comparison = (a.wpVersion || '').localeCompare(b.wpVersion || '');
      } else if (sortBy === 'status') {
        comparison = a.status.localeCompare(b.status);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return React.createElement('div', {
      style: {
        background: 'var(--nxai-card-bg, #fff)',
        border: '1px solid var(--nxai-card-border, #e5e7eb)',
        borderRadius: '8px',
        overflow: 'hidden',
      },
    },
      React.createElement('table', {
        style: {
          width: '100%',
          borderCollapse: 'collapse' as const,
        },
      },
        // Table header
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', {
              style: thStyle,
              onClick: () => this.setState({ sortBy: 'name', sortDirection: this.state.sortDirection === 'asc' ? 'desc' : 'asc' }),
            }, '▼ Site'),
            React.createElement('th', { style: thStyle }, 'Source'),
            React.createElement('th', { style: thStyle }, 'Status'),
            React.createElement('th', { style: thStyle }, 'WP'),
            React.createElement('th', { style: thStyle }, 'PHP'),
            React.createElement('th', { style: thStyle }, 'Health'),
            React.createElement('th', { style: thStyle }, 'Index'),
            React.createElement('th', { style: { ...thStyle, textAlign: 'right' as const } }, 'Actions'),
          ),
        ),

        // Table body
        React.createElement('tbody', null,
          filteredSites.length === 0
            ? React.createElement('tr', null,
                React.createElement('td', {
                  colSpan: 8,
                  style: {
                    padding: '24px',
                    textAlign: 'center' as const,
                    color: '#9ca3af',
                    fontSize: '13px',
                  },
                }, 'No sites found'),
              )
            : filteredSites.map(site => this.renderSiteRow(site)),
        ),
      ),
    );
  }

  renderSiteRow(site: SiteRow): React.ReactNode {
    const { expandedRows } = this.state;
    const isExpanded = expandedRows.has(site.id);
    const isWpe = site.source === 'wpe';

    return [
      // Main row
      React.createElement('tr', {
        key: site.id,
        style: {
          borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
          cursor: 'pointer',
        },
        onClick: () => this.toggleRow(site.id),
      },
        // Site name + domain
        React.createElement('td', { style: tdStyle },
          React.createElement('div', {
            style: { fontWeight: 500, marginBottom: '1px', fontSize: '13px' },
            onClick: (e: any) => {
              e.stopPropagation();
              this.handleSiteClick(site);
            },
          }, site.name),
          React.createElement('div', {
            style: { fontSize: '11px', color: '#9ca3af' },
          }, site.domain),
        ),

        // Source badge
        React.createElement('td', { style: tdStyle },
          React.createElement('span', {
            style: isWpe
              ? { ...badgeStyle, background: 'rgba(14, 202, 212, 0.1)', color: UI_COLORS.WPE_BRAND }
              : site.isConnectedToWpe
              ? { ...badgeStyle, background: 'rgba(14, 202, 212, 0.05)', color: UI_COLORS.WPE_BRAND, border: `1px solid ${UI_COLORS.WPE_BRAND}` }
              : { ...badgeStyle, background: '#f3f4f6', color: '#6b7280' },
          },
            isWpe
              ? '☁️ WPE'
              : site.isConnectedToWpe
              ? 'Local + WPE'
              : 'Local'
          ),
        ),

        // Status
        React.createElement('td', { style: tdStyle },
          site.status === 'running'
            ? React.createElement('span', { style: { ...badgeStyle, background: '#ecfdf5', color: '#10b981' } }, '● Running')
            : site.status === 'remote'
            ? React.createElement('span', { style: { ...badgeStyle, background: '#f3f4f6', color: '#6b7280' } }, 'Remote')
            : React.createElement('span', { style: { ...badgeStyle, background: '#fef2f2', color: '#ef4444' } }, '○ Halted'),
        ),

        // WP Version
        React.createElement('td', { style: tdStyle }, site.wpVersion || '-'),

        // PHP Version
        React.createElement('td', { style: tdStyle }, site.phpVersion || '-'),

        // Health
        React.createElement('td', { style: { ...tdStyle, textAlign: 'center' as const } },
          site.source === 'local'
            ? React.createElement(SiteHealthBadge, {
                electron: this.props.electron,
                siteId: site.id,
                size: 'small',
              })
            : React.createElement('span', { style: { color: '#9ca3af' } }, '-'),
        ),

        // Index status
        React.createElement('td', { style: tdStyle },
          site.indexed
            ? React.createElement('span', { style: { color: '#10b981' }, title: `${site.documentCount} docs, ${site.chunkCount} chunks` }, '✓')
            : React.createElement('span', { style: { color: '#9ca3af' } }, '○'),
        ),

        // Actions dropdown
        React.createElement('td', { style: { ...tdStyle, textAlign: 'right' as const, position: 'relative' as const } },
          React.createElement('button', {
            style: actionButtonStyle,
            onClick: (e: any) => {
              e.stopPropagation();
              this.toggleActionMenu(site.id);
            },
          }, '⋯'),

          // Actions menu
          this.state.actionMenuOpen === site.id
            ? React.createElement('div', {
                style: actionMenuStyle,
                onClick: (e: any) => e.stopPropagation(),
              },
                this.renderActionMenu(site),
              )
            : null,
        ),
      ),

      // Expanded row details
      isExpanded
        ? React.createElement('tr', { key: `${site.id}-expanded` },
            React.createElement('td', {
              colSpan: 8,
              style: {
                padding: '8px 8px',
                background: '#f9fafb',
                borderTop: '1px solid #e5e7eb',
              },
            },
              React.createElement('div', { style: { fontSize: '11px', color: '#6b7280' } },
                site.healthScore !== null
                  ? `Health: ${site.healthScore}/100 | `
                  : '',
                `Indexed: ${site.documentCount} docs, ${site.chunkCount} chunks`,
                site.indexedAt
                  ? ` (${this.formatTimeAgo(site.indexedAt)} ago)`
                  : '',
                site.linkedLocalSite
                  ? ` | Linked to: ${site.linkedLocalSite.name}`
                  : '',
              ),
            ),
          )
        : null,
    ];
  }

  formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  renderActionMenu(site: SiteRow): React.ReactNode {
    const isLocal = site.source === 'local';
    const isWPE = site.source === 'wpe';
    const isRunning = site.status === 'running';

    const actions: Array<{ label: string; action: string; enabled: boolean }> = [];

    if (isLocal) {
      actions.push(
        { label: isRunning ? 'Stop Site' : 'Start Site', action: isRunning ? 'stop' : 'start', enabled: true },
        { label: 'Setup AI', action: 'setup-ai', enabled: isRunning },
        { label: site.indexed ? 'Re-index' : 'Index Site', action: 'index', enabled: isRunning },
        { label: 'Open Site', action: 'open-site', enabled: isRunning },
        { label: 'WP Admin', action: 'open-admin', enabled: isRunning },
      );
    }

    if (isWPE) {
      actions.push(
        { label: 'Pull to Local', action: 'pull-to-local', enabled: true },
        { label: 'View Details', action: 'view-details', enabled: true },
      );
    }

    return actions.map((item, idx) =>
      React.createElement('button', {
        key: idx,
        className: 'fleet-action-menu-item',
        style: {
          ...actionMenuItemStyle,
          opacity: item.enabled ? 1 : 0.5,
          cursor: item.enabled ? 'pointer' : 'not-allowed',
        },
        onClick: () => item.enabled && this.handleAction(site, item.action),
        disabled: !item.enabled,
      }, item.label)
    );
  }

  render(): React.ReactNode {
    const { loading, showLocalSites, showWpeSites, sites } = this.state;

    const localCount = sites.filter(s => s.source === 'local').length;
    const wpeCount = sites.filter(s => s.source === 'wpe').length;

    return React.createElement('div', {
      style: {
        padding: '12px 16px',
        height: 'calc(100vh - 24px)',
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: {
          marginBottom: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
        React.createElement('h1', {
          style: {
            fontSize: '20px',
            fontWeight: 600,
            margin: 0,
          },
        }, 'Fleet Management'),

        React.createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          },
        },
          // View mode toggle
          React.createElement('button', {
            onClick: () => this.setState({ viewMode: this.state.viewMode === 'table' ? 'tree' : 'table' }),
            style: {
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 500,
              color: '#374151',
            },
          }, this.state.viewMode === 'table' ? '📊 Table View' : '🌳 Tree View'),

          React.createElement('div', {
            style: {
              fontSize: '12px',
              color: '#6b7280',
            },
          }, `${sites.length} sites (${localCount} local, ${wpeCount} WPE)`),
        ),
      ),

      // Search bar with AI toggle
      React.createElement('div', {
        style: {
          marginBottom: '8px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        },
      },
        React.createElement('div', {
          style: {
            flex: 1,
            position: 'relative' as const,
          },
        },
          React.createElement('input', {
            type: 'text',
            placeholder: 'Search sites... (AI-powered - describe what you\'re looking for)',
            style: {
              width: '100%',
              padding: '6px 10px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '13px',
            },
            value: this.state.searchQuery,
            onChange: (e: any) => this.setState({ searchQuery: e.target.value }),
          }),
        ),

        React.createElement('label', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap' as const,
          },
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: this.state.aiSearchMode,
            onChange: (e: any) => this.setState({ aiSearchMode: e.target.checked }),
          }),
          'AI Search',
        ),
      ),

      // Filters
      React.createElement('div', {
        style: {
          marginBottom: '8px',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        },
      },
        React.createElement('label', {
          style: filterLabelStyle,
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: showLocalSites,
            onChange: (e: any) => this.setState({ showLocalSites: e.target.checked }),
          }),
          `Local Sites (${localCount})`,
        ),

        React.createElement('label', {
          style: filterLabelStyle,
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: showWpeSites,
            onChange: (e: any) => this.setState({ showWpeSites: e.target.checked }),
          }),
          `☁️ WP Engine Sites (${wpeCount})`,
        ),
      ),

      // Table container with scrollbar
      React.createElement('div', {
        style: {
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
        },
      },
        loading
          ? React.createElement('div', {
              style: {
                padding: '24px',
                textAlign: 'center' as const,
                color: '#9ca3af',
                fontSize: '13px',
              },
            }, 'Loading sites...')
          : this.state.viewMode === 'tree'
          ? React.createElement(FleetTreeView, { electron: this.props.electron })
          : this.renderSiteTable(),
      ),
    );
  }
}

// Styles
const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'left' as const,
  fontSize: '11px',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  borderBottom: '2px solid #e5e7eb',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 8px',
  fontSize: '13px',
  verticalAlign: 'middle' as const,
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  borderRadius: '3px',
  fontSize: '10px',
  fontWeight: 600,
  whiteSpace: 'nowrap' as const,
};

const filterLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '12px',
  cursor: 'pointer',
};

const actionButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '18px',
  cursor: 'pointer',
  padding: '4px 8px',
  color: '#6b7280',
  borderRadius: '4px',
};

const actionMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '2px',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '4px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  zIndex: 1000,
  minWidth: '140px',
  padding: '2px',
};

const actionMenuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 10px',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  fontSize: '12px',
  cursor: 'pointer',
  borderRadius: '3px',
  transition: 'background 0.1s',
};
