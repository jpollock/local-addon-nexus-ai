/**
 * Site Info for WPE Remote Sites
 *
 * Uses Local's native components to match the exact styling and layout
 * of Local's default Site Info page.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';

// Import Local's native components
let SiteInfoInnerPane: any;
let TableList: any;
let TableListRow: any;
let Title: any;
let TextButton: any;
let LoadingIndicator: any;

try {
  const localComponents = require('@getflywheel/local-components');
  console.log('[SiteInfoWPE] Local components module loaded:', !!localComponents);
  console.log('[SiteInfoWPE] Available components:', Object.keys(localComponents || {}).slice(0, 10));

  SiteInfoInnerPane = localComponents.SiteInfoInnerPane;
  TableList = localComponents.TableList;
  TableListRow = localComponents.TableListRow;
  Title = localComponents.Title;
  TextButton = localComponents.TextButton;
  LoadingIndicator = localComponents.LoadingIndicator;

  console.log('[SiteInfoWPE] Component availability:', {
    SiteInfoInnerPane: !!SiteInfoInnerPane,
    TableList: !!TableList,
    TableListRow: !!TableListRow,
    Title: !!Title,
    TextButton: !!TextButton,
    LoadingIndicator: !!LoadingIndicator,
  });
} catch (err) {
  console.error('[SiteInfoWPE] Failed to load Local components:', err);
}

interface SiteInfoWPEProps {
  electron: any;
  installId: string;
}

interface IndexStatus {
  indexed: boolean;
  documentCount: number;
  chunkCount: number;
  lastIndexed: number | null;
}

interface SiteInfoWPEState {
  loading: boolean;
  site: any | null;
  indexStatus: IndexStatus | null;
  error: string | null;
  pulling: boolean;
  syncing: boolean;
}

export class SiteInfoWPE extends React.Component<SiteInfoWPEProps, SiteInfoWPEState> {
  private mounted = false;

  state: SiteInfoWPEState = {
    loading: true,
    site: null,
    indexStatus: null,
    error: null,
    pulling: false,
    syncing: false,
  };

  async componentDidMount() {
    this.mounted = true;
    await this.loadAllData();
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  async loadAllData() {
    this.setState({ loading: true, error: null });

    try {
      // Load site details
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.WPE_GET_SITE_DETAILS,
        this.props.installId
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to load site');
      }

      // Load index status
      const fleetStatus = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_FLEET_STATUS);
      const indexEntry = fleetStatus?.find((entry: any) =>
        entry.siteId === this.props.installId ||
        entry.siteId === `wpe-${this.props.installId}`
      );

      const indexStatus: IndexStatus | null = indexEntry ? {
        indexed: indexEntry.state === 'indexed',
        documentCount: indexEntry.documentCount || 0,
        chunkCount: indexEntry.chunkCount || 0,
        lastIndexed: indexEntry.lastIndexed || null,
      } : null;

      if (this.mounted) {
        this.setState({
          site: result.site,
          indexStatus,
          loading: false,
        });
      }
    } catch (error: any) {
      console.error('[SiteInfoWPE] Failed to load:', error);
      if (this.mounted) {
        this.setState({ error: error.message, loading: false });
      }
    }
  }

  handlePullToLocal = async () => {
    const { site } = this.state;

    if (!confirm(`Pull "${site?.name}" from WP Engine to Local?\n\nThis will create a new local site and download all files and database.`)) {
      return;
    }

    this.setState({ pulling: true });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.WPE_PULL_TO_LOCAL,
        { installId: this.props.installId }
      );

      if (result.success) {
        alert(`✓ Pull started!\n\nSite: ${result.siteName}\n\nCheck the Local app for progress.`);
        if (result.siteId) {
          window.location.hash = `#/main/site-info/${result.siteId}`;
        }
      } else {
        alert(`✗ Failed: ${result.error || result.message}`);
      }
    } catch (error: any) {
      alert(`✗ Error: ${error.message}`);
    } finally {
      this.setState({ pulling: false });
    }
  };

  handleResync = async () => {
    this.setState({ syncing: true });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.WPE_SYNC_SINGLE,
        this.props.installId
      );

      if (result.success) {
        await this.loadAllData();
      } else {
        alert(`✗ Failed to sync: ${result.error}`);
      }
    } catch (error: any) {
      alert(`✗ Error: ${error.message}`);
    } finally {
      this.setState({ syncing: false });
    }
  };

  handleReindex = async () => {
    try {
      await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.INDEX_SITE,
        this.props.installId
      );
      await this.loadAllData();
    } catch (error: any) {
      alert(`✗ Failed to re-index: ${error.message}`);
    }
  };

  handleOpenAdmin = () => {
    const { site } = this.state;
    if (site?.domain) {
      window.open(`https://${site.domain}/wp-admin`, '_blank');
    }
  };

  handleOpenSite = () => {
    const { site } = this.state;
    if (site?.domain) {
      window.open(`https://${site.domain}`, '_blank');
    }
  };

  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    return date.toLocaleDateString();
  }

  /**
   * Fallback renderer when Local's components aren't available
   * Shows all data in a basic but functional layout
   */
  renderFallback(): React.ReactNode {
    const { loading, site, indexStatus, error, pulling, syncing } = this.state;

    const styles = {
      container: {
        padding: '20px',
        maxWidth: '800px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      section: {
        marginBottom: '32px',
      },
      sectionTitle: {
        fontSize: '15px',
        fontWeight: 600,
        marginBottom: '12px',
        color: 'var(--color-text-primary, #111827)',
      },
      row: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid #f3f4f6',
      },
      label: {
        fontSize: '14px',
        color: 'var(--color-text-secondary, #6b7280)',
      },
      value: {
        fontSize: '14px',
        color: 'var(--color-text-primary, #111827)',
      },
      button: {
        padding: '10px 18px',
        borderRadius: '6px',
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        border: '1px solid var(--color-border, #d1d5db)',
        background: 'var(--color-background-primary, #fff)',
        marginRight: '8px',
      },
      buttonPrimary: {
        padding: '10px 18px',
        borderRadius: '6px',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        border: 'none',
        background: 'var(--color-brand-primary, #51bb7b)',
        color: '#fff',
        marginRight: '8px',
      },
      actions: {
        marginTop: '32px',
        paddingTop: '24px',
        borderTop: '1px solid #e5e7eb',
      },
    };

    if (loading) {
      return React.createElement('div', { style: { ...styles.container, textAlign: 'center' } },
        React.createElement('p', null, 'Loading WPE site details...')
      );
    }

    if (error || !site) {
      return React.createElement('div', { style: styles.container },
        React.createElement('h2', { style: { color: 'var(--color-error, #ef4444)' } }, 'Error'),
        React.createElement('p', null, error || 'Site not found'),
        React.createElement('button', {
          style: styles.button,
          onClick: () => window.location.hash = '#/main/fleet',
        }, '← Back to Fleet')
      );
    }

    return React.createElement('div', { style: styles.container },
      React.createElement('div', { style: { marginBottom: '24px' } },
        React.createElement('h1', { style: { fontSize: '24px', marginBottom: '4px' } }, site.name),
        React.createElement('p', { style: { color: 'var(--color-text-secondary, #6b7280)', fontSize: '14px' } },
          `☁️ WP Engine Site • ${site.domain}`
        ),
      ),

      // General Section
      React.createElement('div', { style: styles.section },
        React.createElement('h2', { style: styles.sectionTitle }, 'General'),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Site host'),
          React.createElement('span', { style: styles.value }, site.domain || `${site.name}.wpenginepowered.com`)
        ),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'SSL'),
          React.createElement('span', { style: styles.value }, 'Enabled via WP Engine')
        ),
      ),

      // Environment Section
      React.createElement('div', { style: styles.section },
        React.createElement('h2', { style: styles.sectionTitle }, 'Environment'),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Environment type'),
          React.createElement('span', { style: styles.value }, site.environment || 'production')
        ),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Web server'),
          React.createElement('span', { style: styles.value }, 'WP Engine (nginx)')
        ),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'PHP version'),
          React.createElement('span', { style: styles.value }, site.phpVersion || site.php_version || '8.1')
        ),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Database'),
          React.createElement('span', { style: styles.value }, 'MySQL 8.0.35 (managed)')
        ),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'WordPress version'),
          React.createElement('span', { style: styles.value }, site.wp_version || 'Unknown')
        ),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Status'),
          React.createElement('span', { style: { ...styles.value, color: 'var(--color-brand-primary, #51bb7b)', fontWeight: 600 } },
            site.status || 'active'
          )
        ),
      ),

      // Connection Section
      React.createElement('div', { style: styles.section },
        React.createElement('h2', { style: styles.sectionTitle }, 'Connection'),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Primary domain'),
          React.createElement('span', { style: styles.value }, site.domain || `${site.name}.wpenginepowered.com`)
        ),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'CNAME'),
          React.createElement('span', { style: styles.value }, site.cname || site.domain || `${site.name}.wpenginepowered.com`)
        ),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Install ID'),
          React.createElement('span', {
            style: { ...styles.value, fontFamily: 'monospace', fontSize: '13px' }
          }, this.props.installId)
        ),
      ),

      // Nexus AI Section
      React.createElement('div', { style: styles.section },
        React.createElement('h2', { style: styles.sectionTitle }, 'Nexus AI'),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Index status'),
          React.createElement('div', null,
            React.createElement('span', {
              style: {
                ...styles.value,
                color: indexStatus?.indexed ? '#51bb7b' : '#6b7280',
                marginRight: '10px',
              }
            }, indexStatus?.indexed ? '● Indexed' : '○ Not indexed'),
            React.createElement('a', {
              style: { color: 'var(--color-brand-primary, #51bb7b)', cursor: 'pointer', fontSize: '14px' },
              onClick: this.handleReindex,
            }, 'Re-index')
          )
        ),
        indexStatus ? React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Documents'),
          React.createElement('span', { style: styles.value },
            `${indexStatus.documentCount} documents • ${indexStatus.chunkCount} chunks`
          )
        ) : null,
        indexStatus?.lastIndexed ? React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.label }, 'Last indexed'),
          React.createElement('span', { style: styles.value }, this.formatDate(indexStatus.lastIndexed))
        ) : null,
      ),

      // Actions
      React.createElement('div', { style: styles.actions },
        React.createElement('button', {
          style: pulling ? { ...styles.buttonPrimary, opacity: 0.6 } : styles.buttonPrimary,
          onClick: this.handlePullToLocal,
          disabled: pulling,
        }, pulling ? 'Pulling...' : 'Pull to Local'),

        React.createElement('button', {
          style: styles.button,
          onClick: this.handleOpenAdmin,
        }, 'WP Admin'),

        React.createElement('button', {
          style: styles.button,
          onClick: this.handleOpenSite,
        }, 'Open site'),

        React.createElement('button', {
          style: syncing ? { ...styles.button, opacity: 0.6 } : styles.button,
          onClick: this.handleResync,
          disabled: syncing,
        }, syncing ? 'Syncing...' : 'Refresh metadata'),
      ),

      // Debug info
      React.createElement('div', {
        style: {
          marginTop: '32px',
          padding: '16px',
          background: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: '6px',
          fontSize: '13px',
        },
      },
        React.createElement('p', { style: { fontWeight: 600, marginBottom: '8px' } },
          '⚠️ Using Fallback Renderer'
        ),
        React.createElement('p', { style: { margin: 0 } },
          'Local components not available. Check console for details.'
        ),
      ),
    );
  }

  render() {
    const { loading, site, indexStatus, error, pulling, syncing } = this.state;

    // Fallback if Local components not available
    if (!SiteInfoInnerPane || !TableList || !TableListRow || !Title) {
      console.warn('[SiteInfoWPE] Using fallback renderer - Local components not available');
      return this.renderFallback();
    }

    if (loading) {
      return React.createElement(SiteInfoInnerPane, null,
        LoadingIndicator
          ? React.createElement(LoadingIndicator)
          : React.createElement('div', { style: { padding: '48px', textAlign: 'center' } }, 'Loading...')
      );
    }

    if (error || !site) {
      return React.createElement(SiteInfoInnerPane, null,
        React.createElement('div', {
          style: {
            padding: '48px',
            textAlign: 'center',
          },
        },
          React.createElement('p', {
            style: { color: 'var(--color-error, #ef4444)', marginBottom: '16px' },
          }, `Error loading site: ${error || 'Site not found'}`),
          React.createElement('button', {
            style: {
              padding: '8px 16px',
              border: '1px solid var(--color-border, #d1d5db)',
              borderRadius: '4px',
              background: 'var(--color-background-primary, #fff)',
              cursor: 'pointer',
            },
            onClick: () => window.location.hash = '#/main/fleet',
          }, '← Back to Fleet'),
        )
      );
    }

    return React.createElement(SiteInfoInnerPane, null,
      React.createElement('div', { style: { width: '100%', paddingBottom: '80px' } },
        // Header Section (matches Local's Site Info header)
        React.createElement('div', {
          style: {
            padding: '24px 32px 16px 32px',
            borderBottom: '1px solid var(--color-border, #e5e7eb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          },
        },
          // Left side: Site name and badge
          React.createElement('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            },
          },
            React.createElement('h1', {
              style: {
                fontSize: '24px',
                fontWeight: 400,
                margin: 0,
                color: 'var(--color-text-primary, #1f2937)',
                letterSpacing: '-0.01em',
              },
            }, site.name),

            // WPE Badge
            React.createElement('span', {
              style: {
                background: '#0ECAD4',
                color: '#fff',
                padding: '3px 8px',
                borderRadius: '3px',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.3px',
                textTransform: 'uppercase',
              },
            }, 'WPE'),

            // "WP Engine" text
            React.createElement('span', {
              style: {
                color: 'var(--color-text-secondary, #9ca3af)',
                fontSize: '13px',
                marginLeft: '4px',
              },
            }, 'WP Engine'),
          ),

          // Right side: Action buttons
          React.createElement('div', {
            style: {
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
            },
          },
            TextButton ? React.createElement(TextButton, {
              onClick: this.handleOpenAdmin,
              style: {
                padding: '8px 16px',
                border: '1.5px solid #51bb7b',
                borderRadius: '4px',
                color: 'var(--color-brand-primary, #51bb7b)',
                background: 'var(--color-background-primary, #fff)',
                fontWeight: 500,
                fontSize: '13px',
                cursor: 'pointer',
              },
            }, 'WP Admin') : null,

            TextButton ? React.createElement(TextButton, {
              onClick: this.handleOpenSite,
              style: {
                padding: '8px 16px',
                border: '1.5px solid #51bb7b',
                borderRadius: '4px',
                color: 'var(--color-brand-primary, #51bb7b)',
                background: 'var(--color-background-primary, #fff)',
                fontWeight: 500,
                fontSize: '13px',
                cursor: 'pointer',
              },
            }, 'Open site') : null,
          ),
        ),

        // General Section
        React.createElement(Title, { container: { margin: '20 30' } }, 'General'),
        React.createElement(TableList, null,
          React.createElement(TableListRow, {
            label: 'Site host',
            selectable: true,
          }, site.domain || `${site.name}.wpenginepowered.com`),

          React.createElement(TableListRow, {
            label: 'SSL',
          }, 'Enabled via WP Engine'),
        ),

        // Environment Section
        React.createElement(Title, { container: { margin: '30 30' } }, 'Environment'),
        React.createElement(TableList, null,
          React.createElement(TableListRow, {
            label: 'Environment type',
          }, site.environment || 'production'),

          React.createElement(TableListRow, {
            label: 'Web server',
          }, 'WP Engine (nginx)'),

          React.createElement(TableListRow, {
            label: 'PHP version',
            selectable: true,
          }, site.phpVersion || site.php_version || '8.1'),

          React.createElement(TableListRow, {
            label: 'Database',
          }, 'MySQL 8.0.35 (managed)'),

          React.createElement(TableListRow, {
            label: 'WordPress version',
            selectable: true,
          }, site.wp_version || 'Unknown'),

          React.createElement(TableListRow, {
            label: 'Status',
          }, React.createElement('span', {
            style: { color: 'var(--color-brand-primary, #51bb7b)', fontWeight: 600 },
          }, site.status || 'active')),
        ),

        // Connection Section
        React.createElement(Title, { container: { margin: '30 30' } }, 'Connection'),
        React.createElement(TableList, null,
          React.createElement(TableListRow, {
            label: 'Primary domain',
            selectable: true,
          }, site.domain || `${site.name}.wpenginepowered.com`),

          React.createElement(TableListRow, {
            label: 'CNAME',
            selectable: true,
          }, site.cname || site.domain || `${site.name}.wpenginepowered.com`),

          React.createElement(TableListRow, {
            label: 'Install ID',
            selectable: true,
          }, this.props.installId),
        ),

        // Nexus AI Section
        React.createElement(Title, { container: { margin: '30 30' } }, 'Nexus AI'),
        React.createElement(TableList, null,
          React.createElement(TableListRow, {
            label: 'Index status',
          },
            React.createElement('span', {
              style: {
                color: indexStatus?.indexed ? '#51bb7b' : '#6b7280',
              },
            }, indexStatus?.indexed ? '● Indexed' : '○ Not indexed'),

            TextButton ? React.createElement(TextButton, {
              inline: true,
              style: { paddingLeft: '10px' },
              onClick: this.handleReindex,
            }, 'Re-index') : null,
          ),

          indexStatus ? React.createElement(TableListRow, {
            label: 'Documents',
          }, `${indexStatus.documentCount} documents • ${indexStatus.chunkCount} chunks`) : null,

          indexStatus?.lastIndexed ? React.createElement(TableListRow, {
            label: 'Last indexed',
          }, this.formatDate(indexStatus.lastIndexed)) : null,
        ),

        // Footer (matches Local's Site Info footer with Pull action)
        React.createElement('div', {
          style: {
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: '60px',
            background: 'var(--color-background-primary, #fff)',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 32px',
            gap: '16px',
            zIndex: 10,
          },
        },
          // Refresh metadata link (subtle)
          TextButton ? React.createElement(TextButton, {
            onClick: this.handleResync,
            disabled: syncing,
            inline: true,
            style: {
              color: 'var(--color-text-secondary, #6b7280)',
              fontSize: '13px',
              padding: '6px 12px',
            },
          }, syncing ? 'Syncing...' : 'Refresh metadata') : null,

          // Pull to Local button (primary action)
          TextButton ? React.createElement(TextButton, {
            onClick: this.handlePullToLocal,
            disabled: pulling,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: 'var(--color-background-primary, #fff)',
              border: '1.5px solid #d1d5db',
              borderRadius: '4px',
              color: 'var(--color-text-primary, #374151)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: pulling ? 'not-allowed' : 'pointer',
              opacity: pulling ? 0.6 : 1,
            },
          },
            // Pull icon (cloud download)
            React.createElement('svg', {
              width: '16',
              height: '16',
              viewBox: '0 0 16 16',
              fill: 'none',
              xmlns: 'http://www.w3.org/2000/svg',
            },
              React.createElement('path', {
                d: 'M8 11L8 3M8 11L5.5 8.5M8 11L10.5 8.5',
                stroke: 'currentColor',
                strokeWidth: '1.5',
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
              React.createElement('path', {
                d: 'M2 13H14',
                stroke: 'currentColor',
                strokeWidth: '1.5',
                strokeLinecap: 'round',
              }),
            ),
            pulling ? 'Pulling...' : 'Pull',
          ) : null,
        ),
      )
    );
  }
}
