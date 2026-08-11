import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { externalHostCapabilities, Capability, CapabilityState } from './hostCapabilities';

export interface ExternalHostRow { alias: string; site: string; environment: string; domain: string }
interface SshConfigHost { alias: string; hostname: string; user: string; port: string; identityFile?: string; proxyJump?: string; alreadyRegistered: boolean }

export type HostScreen =
  | { name: 'list' }
  | { name: 'add' }
  | { name: 'detail'; alias: string }
  | { name: 'identityChanged'; alias: string }
  | { name: 'remove'; alias: string };

export interface HostRow { alias: string; connection: string | null; siteCount: number; configured: boolean }

export interface OtherHostsPanelProps {
  /** Seed only. The panel re-fetches into state after any mutation. */
  externalHosts: ExternalHostRow[];
  electron: any;
}

interface OtherHostsPanelState {
  screen: HostScreen;
  sshConfigHosts: SshConfigHost[];
  hosts: ExternalHostRow[];
}

export class OtherHostsPanel extends React.Component<OtherHostsPanelProps, OtherHostsPanelState> {
  private mounted = false;

  state: OtherHostsPanelState = {
    screen: { name: 'list' },
    sshConfigHosts: [],
    hosts: this.props.externalHosts,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.reload();
  }

  componentWillUnmount(): void { this.mounted = false; }

  /**
   * Owns its own refresh. SettingsShell fetches GET_EXTERNAL_HOSTS once at
   * mount and offers no reload callback; its onSave is for settings patches,
   * so borrowing it to force a refresh would write an empty patch to
   * UPDATE_SETTINGS on every host change.
   */
  reload = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    const [cfg, hosts] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS).catch(() => null),
    ]);
    if (!this.mounted) return;
    this.setState({
      sshConfigHosts: Array.isArray(cfg?.hosts) ? cfg.hosts : [],
      hosts: Array.isArray(hosts) ? hosts : this.state.hosts,
    });
  };

  /**
   * One row per HOST. GET_EXTERNAL_HOSTS returns one row per SITE, and a host
   * with zero followed sites has no row there at all (F3) -- so registered
   * aliases from ssh config are unioned in rather than the site list being the
   * only source.
   */
  hostRows(): HostRow[] {
    const byAlias = new Map<string, number>();
    for (const h of this.state.hosts) {
      byAlias.set(h.alias, (byAlias.get(h.alias) ?? 0) + 1);
    }
    for (const c of this.state.sshConfigHosts) {
      if (c.alreadyRegistered && !byAlias.has(c.alias)) byAlias.set(c.alias, 0);
    }
    return Array.from(byAlias.entries()).map(([alias, siteCount]) => {
      const cfg = this.state.sshConfigHosts.find(c => c.alias === alias);
      return {
        alias,
        siteCount,
        configured: !!cfg,
        connection: cfg ? `${cfg.user}@${cfg.hostname}:${cfg.port} · from ~/.ssh/config` : null,
      };
    });
  }

  renderEmpty(): React.ReactElement {
    const capabilities = externalHostCapabilities();
    const allowed = capabilities.filter(c => c.state === 'allowed' || c.state === 'gated');
    const unavailable = capabilities.filter(c => c.state === 'unavailable');

    return React.createElement('div', {
      style: {
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
        marginBottom: 8,
      },
    },
      // Heading
      React.createElement('div', {
        style: {
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--nxai-card-text)',
          marginBottom: 12,
        },
      }, 'Other hosts'),

      // Two-column layout
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginBottom: 16,
        },
      },
        // Left column: What it can do
        React.createElement('div', {},
          React.createElement('div', {
            style: {
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--nxai-card-text)',
              marginBottom: 6,
            },
          }, 'What it can do'),
          React.createElement('div', {
            style: {
              fontSize: 12,
              color: 'var(--nxai-card-sub)',
              lineHeight: 1.4,
            },
          }, 'Read what is installed · index page and post text so they are searchable · notice broken links and errors · answer questions in chat · install or update things, if you allow it'),
        ),

        // Right column: What it cannot
        React.createElement('div', {},
          React.createElement('div', {
            style: {
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--nxai-card-text)',
              marginBottom: 6,
            },
          }, 'What it cannot'),
          React.createElement('div', {
            style: {
              fontSize: 12,
              color: 'var(--nxai-card-sub)',
              lineHeight: 1.4,
            },
          }, "Copy a site down, push local changes up, or delete and promote environments — those are WP Engine only. Backups and staging stay with your host's own tools."),
        ),
      ),

      // Add button
      React.createElement('div', {
        onClick: () => this.setState({ screen: { name: 'add' } }),
        style: {
          display: 'inline-block',
          padding: '6px 12px',
          background: 'var(--nxai-accent)',
          color: '#fff',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        },
      }, 'Add a host'),
    );
  }

  renderList(): React.ReactElement {
    const rows = this.hostRows();

    return React.createElement('div', {},
      React.createElement('div', {
        style: {
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--nxai-card-text)',
          marginBottom: 8,
        },
      }, 'Other hosts'),

      rows.map((row) =>
        React.createElement('div', {
          key: row.alias,
          onClick: () => this.setState({ screen: { name: 'detail', alias: row.alias } }),
          style: {
            padding: 16,
            background: 'var(--nxai-card-bg)',
            border: '1px solid var(--nxai-card-border)',
            borderRadius: 6,
            marginBottom: 8,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          },
        },
          // Left side: alias, connection, sites
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', {
              style: {
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--nxai-card-text)',
                marginBottom: 4,
              },
            }, row.alias),
            React.createElement('div', {
              style: {
                fontSize: 12,
                color: 'var(--nxai-card-sub)',
                marginBottom: 4,
              },
            }, row.connection ?? 'Connection unknown — this alias is no longer in ~/.ssh/config'),
            React.createElement('div', {
              style: {
                fontSize: 12,
                color: 'var(--nxai-card-sub)',
              },
            }, `${row.siteCount} ${row.siteCount === 1 ? 'site' : 'sites'}`),
          ),

          // Right side: status dot and chevron
          React.createElement('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            },
          },
            // Status dot
            React.createElement('div', {
              style: {
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: row.configured ? 'var(--nxai-accent)' : 'var(--nxai-status-neutral)',
              },
            }),
            // Chevron
            React.createElement('div', {
              style: {
                fontSize: 16,
                color: 'var(--nxai-card-sub)',
              },
            }, '›'),
          ),
        ),
      ),
    );
  }

  render(): React.ReactElement {
    const rows = this.hostRows();

    // Empty state when no hosts
    if (rows.length === 0) {
      return this.renderEmpty();
    }

    // List state
    if (this.state.screen.name === 'list') {
      return this.renderList();
    }

    // Placeholder for other screens (Tasks 3-6)
    return React.createElement('div', {}, `Screen: ${this.state.screen.name}`);
  }
}
