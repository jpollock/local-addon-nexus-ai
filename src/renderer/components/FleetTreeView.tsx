/**
 * Fleet Tree View - POC for grouped Account → Site → Install hierarchy
 *
 * Shows WPE sites organized by:
 * - Account (e.g., "Customer 1")
 * - Site (e.g., "acflikebutton")
 * - Install/Environment (e.g., "production", "staging", "development")
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';

interface FleetTreeViewProps {
  electron: any;
}

interface Account {
  id: string;
  name: string;
  nickname?: string;
}

interface Site {
  id: string;
  name: string;
  accountId: string;
  installs: Install[];
}

interface Install {
  id: string;
  name: string;
  environment: string;
  domain: string;
  phpVersion?: string;
  siteId?: string;
  isLocal: boolean; // Will implement in Option D
}

interface TreeNode {
  accounts: Map<string, {
    account: Account;
    sites: Map<string, {
      site: Site;
      installs: Install[];
    }>;
  }>;
}

interface FleetTreeViewState {
  loading: boolean;
  tree: TreeNode | null;
  expandedAccounts: Set<string>;
  expandedSites: Set<string>;
  error: string | null;
}

export class FleetTreeView extends React.Component<FleetTreeViewProps, FleetTreeViewState> {
  state: FleetTreeViewState = {
    loading: true,
    tree: null,
    expandedAccounts: new Set(),
    expandedSites: new Set(),
    error: null,
  };

  async componentDidMount() {
    await this.loadTreeData();
  }

  async loadTreeData() {
    this.setState({ loading: true, error: null });

    try {
      // Fetch accounts from CAPI
      const accountsResult = await this.props.electron.ipcRenderer.invoke('capi:get-accounts');
      const accounts: Account[] = accountsResult || [];

      console.log('[FleetTreeView] Loaded accounts:', accounts.length);

      // Fetch WPE sites from graph (already synced)
      const wpeSites = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WPE_GET_SYNCED_SITES);

      console.log('[FleetTreeView] Loaded WPE sites:', wpeSites?.length || 0);

      // Build tree structure
      const tree = this.buildTree(accounts, wpeSites || []);

      this.setState({
        tree,
        loading: false,
        // Auto-expand first account for demo
        expandedAccounts: accounts.length > 0 ? new Set([accounts[0].id]) : new Set(),
      });
    } catch (error: any) {
      console.error('[FleetTreeView] Failed to load tree data:', error);
      this.setState({
        error: error.message || 'Failed to load tree data',
        loading: false,
      });
    }
  }

  buildTree(accounts: Account[], wpeSites: any[]): TreeNode {
    const tree: TreeNode = {
      accounts: new Map(),
    };

    // Group sites by account
    const sitesByAccount = new Map<string, any[]>();
    wpeSites.forEach((site) => {
      const accountId = site.account_id || site.accountId || 'unknown';
      if (!sitesByAccount.has(accountId)) {
        sitesByAccount.set(accountId, []);
      }
      sitesByAccount.get(accountId)!.push(site);
    });

    // Build tree structure
    accounts.forEach((account) => {
      const accountSites = sitesByAccount.get(account.id) || [];

      // Group installs by site name (for sites with multiple environments)
      const installsBySiteName = new Map<string, any[]>();
      accountSites.forEach((install) => {
        // Extract site name from install name (e.g., "acflikebutton" from "acflikebutton-prod")
        const siteName = this.extractSiteName(install.name, install.environment);
        if (!installsBySiteName.has(siteName)) {
          installsBySiteName.set(siteName, []);
        }
        installsBySiteName.get(siteName)!.push(install);
      });

      const sitesMap = new Map<string, { site: Site; installs: Install[] }>();

      installsBySiteName.forEach((installs, siteName) => {
        const site: Site = {
          id: siteName, // Use site name as ID for now
          name: siteName,
          accountId: account.id,
          installs: installs.map((i) => ({
            id: i.id || i.install_id || i.remote_install_id,
            name: i.name,
            environment: i.environment || 'production',
            domain: i.domain || i.primary_domain || `${i.name}.wpengine.com`,
            phpVersion: i.phpVersion || i.php_version,
            siteId: i.site_id,
            isLocal: false, // TODO: Check if pulled to local
          })),
        };

        sitesMap.set(siteName, { site, installs: site.installs });
      });

      tree.accounts.set(account.id, {
        account,
        sites: sitesMap,
      });
    });

    return tree;
  }

  /**
   * Extract base site name from install name
   * E.g., "acflikebutton-prod" → "acflikebutton"
   *       "mysite" → "mysite"
   */
  extractSiteName(installName: string, environment: string): string {
    // Common environment suffixes
    const envSuffixes = ['-prod', '-production', '-stg', '-staging', '-dev', '-development'];

    for (const suffix of envSuffixes) {
      if (installName.endsWith(suffix)) {
        return installName.slice(0, -suffix.length);
      }
    }

    // If environment is not 'production' and install name contains it, try to strip it
    if (environment !== 'production') {
      const regex = new RegExp(`[-_]?${environment}$`, 'i');
      const match = installName.match(regex);
      if (match) {
        return installName.slice(0, match.index);
      }
    }

    return installName;
  }

  toggleAccount = (accountId: string) => {
    this.setState((prev) => {
      const expanded = new Set(prev.expandedAccounts);
      if (expanded.has(accountId)) {
        expanded.delete(accountId);
      } else {
        expanded.add(accountId);
      }
      return { expandedAccounts: expanded };
    });
  };

  toggleSite = (siteId: string) => {
    this.setState((prev) => {
      const expanded = new Set(prev.expandedSites);
      if (expanded.has(siteId)) {
        expanded.delete(siteId);
      } else {
        expanded.add(siteId);
      }
      return { expandedSites: expanded };
    });
  };

  handleInstallClick = (install: Install) => {
    if (install.isLocal) {
      // Navigate to local site info
      window.location.hash = `#/main/site-info/${install.id}`;
    } else {
      // Navigate to WPE site info
      window.location.hash = `#/main/site-info-wpe/${install.id}`;
    }
  };

  render() {
    const { loading, tree, expandedAccounts, expandedSites, error } = this.state;

    if (loading) {
      return React.createElement('div', {
        style: {
          padding: '48px',
          textAlign: 'center',
          color: '#6b7280',
        },
      }, 'Loading fleet...');
    }

    if (error) {
      return React.createElement('div', {
        style: {
          padding: '48px',
          textAlign: 'center',
          color: '#ef4444',
        },
      }, `Error: ${error}`);
    }

    if (!tree || tree.accounts.size === 0) {
      return React.createElement('div', {
        style: {
          padding: '48px',
          textAlign: 'center',
          color: '#6b7280',
        },
      }, 'No WPE sites found. Sync your WPE account first.');
    }

    const styles = {
      container: {
        padding: '24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      account: {
        marginBottom: '16px',
        border: '1px solid #e5e7eb',
        borderRadius: '6px',
        overflow: 'hidden',
      },
      accountHeader: {
        padding: '12px 16px',
        background: '#f9fafb',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        userSelect: 'none' as const,
      },
      accountName: {
        fontSize: '15px',
        fontWeight: 600,
        color: '#111827',
      },
      accountMeta: {
        fontSize: '13px',
        color: '#6b7280',
        marginLeft: 'auto',
      },
      site: {
        borderTop: '1px solid #e5e7eb',
      },
      siteHeader: {
        padding: '10px 16px 10px 32px',
        background: '#fff',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        userSelect: 'none' as const,
      },
      siteName: {
        fontSize: '14px',
        fontWeight: 500,
        color: '#374151',
      },
      siteMeta: {
        fontSize: '12px',
        color: '#9ca3af',
        marginLeft: 'auto',
      },
      install: {
        padding: '8px 16px 8px 48px',
        background: '#fff',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        borderTop: '1px solid #f3f4f6',
      },
      installHover: {
        background: '#f9fafb',
      },
      installName: {
        fontSize: '13px',
        color: '#374151',
      },
      badge: {
        padding: '2px 8px',
        borderRadius: '3px',
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'uppercase' as const,
      },
      badgeEnv: {
        background: '#f3f4f6',
        color: '#6b7280',
      },
      badgeLocal: {
        background: '#d1fae5',
        color: '#065f46',
        border: '1px solid #10b981',
      },
      badgeWPE: {
        background: '#cffafe',
        color: '#0e7490',
      },
      domain: {
        fontSize: '12px',
        color: '#9ca3af',
        marginLeft: 'auto',
      },
      expandIcon: {
        fontSize: '12px',
        color: '#9ca3af',
      },
    };

    const accountsArray = Array.from(tree.accounts.entries());

    return React.createElement('div', { style: styles.container },
      React.createElement('h2', {
        style: {
          fontSize: '18px',
          fontWeight: 600,
          marginBottom: '24px',
          color: '#111827',
        },
      }, `Fleet Tree View (${accountsArray.length} accounts)`),

      accountsArray.map(([accountId, { account, sites }]) => {
        const isExpanded = expandedAccounts.has(accountId);
        const sitesArray = Array.from(sites.entries());
        const totalInstalls = sitesArray.reduce((sum, [, { installs }]) => sum + installs.length, 0);

        return React.createElement('div', {
          key: accountId,
          style: styles.account,
        },
          // Account header
          React.createElement('div', {
            style: styles.accountHeader,
            onClick: () => this.toggleAccount(accountId),
          },
            React.createElement('span', { style: styles.expandIcon },
              isExpanded ? '▼' : '▶'
            ),
            React.createElement('span', { style: styles.accountName }, account.name),
            React.createElement('span', { style: styles.accountMeta },
              `${sitesArray.length} sites • ${totalInstalls} installs`
            ),
          ),

          // Sites (only if expanded)
          isExpanded ? sitesArray.map(([siteId, { site, installs }]) => {
            const isSiteExpanded = expandedSites.has(siteId);

            return React.createElement('div', {
              key: siteId,
              style: styles.site,
            },
              // Site header
              React.createElement('div', {
                style: styles.siteHeader,
                onClick: () => this.toggleSite(siteId),
              },
                React.createElement('span', { style: styles.expandIcon },
                  isSiteExpanded ? '▼' : '▶'
                ),
                React.createElement('span', { style: styles.siteName }, site.name),
                React.createElement('span', { style: styles.siteMeta },
                  `${installs.length} environment${installs.length === 1 ? '' : 's'}`
                ),
              ),

              // Installs (only if site expanded)
              isSiteExpanded ? installs.map((install) =>
                React.createElement('div', {
                  key: install.id,
                  style: styles.install,
                  onClick: () => this.handleInstallClick(install),
                  onMouseEnter: (e: any) => {
                    e.currentTarget.style.background = '#f9fafb';
                  },
                  onMouseLeave: (e: any) => {
                    e.currentTarget.style.background = '#fff';
                  },
                },
                  React.createElement('span', { style: styles.installName }, install.environment),

                  // WPE/Local badge
                  React.createElement('span', {
                    style: {
                      ...styles.badge,
                      ...(install.isLocal ? styles.badgeLocal : styles.badgeWPE),
                    },
                  }, install.isLocal ? 'Local' : 'WPE'),

                  // PHP version badge (if available)
                  install.phpVersion ? React.createElement('span', {
                    style: { ...styles.badge, ...styles.badgeEnv },
                  }, `PHP ${install.phpVersion}`) : null,

                  // Domain
                  React.createElement('span', { style: styles.domain }, install.domain),
                )
              ) : null,
            );
          }) : null,
        );
      }),
    );
  }
}
