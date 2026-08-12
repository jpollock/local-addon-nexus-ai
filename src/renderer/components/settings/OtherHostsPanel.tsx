import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { externalHostCapabilities, Capability, CapabilityState } from './hostCapabilities';
import { ExternalHostAddWizard } from './ExternalHostAddWizard';
import { rendererGql } from '../../utils/rendererGql';

/**
 * Same value as HOST_PROBE_CLIENT_TIMEOUT_MS in ExternalHostAddWizard.
 * Duplicated deliberately to avoid cross-file coupling on a magic timeout constant.
 */
const HOST_PROBE_CLIENT_TIMEOUT_MS = 210000;

export interface ExternalHostRow { alias: string; site: string; environment: string; domain: string; wpPath: string; allowRoot: boolean }
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

interface HostIdentity {
  approved: string;
  current: string;
  approvedAt: string;
}

interface OtherHostsPanelState {
  screen: HostScreen;
  sshConfigHosts: SshConfigHost[];
  hosts: ExternalHostRow[];
  /** Newly-discovered installs per alias, not yet followed. */
  discovered: Record<string, string[]>;
  /** Which host is currently being re-probed, if any. */
  checking: string | null;
  /** Identity data for hosts whose fingerprint changed. */
  identity: Record<string, HostIdentity>;
  /** Whether to show the routing instruction after accept was clicked. */
  showAcceptInstruction: boolean;
  /** Error message from the last probe, if any. */
  probeError: string | null;
  /** Error message from the last setRootMode call, if any. */
  rootModeError: string | null;
  /** Error message from the last removal, if any. */
  removeError: string | null;
}

export class OtherHostsPanel extends React.Component<OtherHostsPanelProps, OtherHostsPanelState> {
  private mounted = false;

  state: OtherHostsPanelState = {
    screen: { name: 'list' },
    sshConfigHosts: [],
    hosts: this.props.externalHosts,
    discovered: {},
    checking: null,
    identity: {},
    showAcceptInstruction: false,
    probeError: null,
    rootModeError: null,
    removeError: null,
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

  closeAdd = (): void => {
    this.setState({
      screen: { name: 'list' },
      showAcceptInstruction: false,
      discovered: {},
      probeError: null,
      rootModeError: null,
      removeError: null,
    });
  };

  completeAdd = (_alias: string): void => {
    this.setState({ screen: { name: 'list' } });
    this.reload();
  };

  /**
   * Re-probe one host. Returns an object with installs array and error on success,
   * or throws on failure.
   */
  runProbe = async (alias: string): Promise<{ installs: string[]; changedHostKey?: { fingerprint: string; previousFingerprint: string } }> => {
    const data = await rendererGql<{
      nexusHostProbe: {
        success: boolean;
        error: string | null;
        multiIssue: {
          installs: string[];
          issues: Array<{ kind: string; fingerprint?: string; previousFingerprint?: string }>;
        } | null;
      };
    }>(`
      mutation ProbeHost($alias: String!) {
        nexusHostProbe(alias: $alias) {
          success
          error
          multiIssue {
            installs
            issues { kind fingerprint previousFingerprint }
          }
        }
      }
    `, { alias }, HOST_PROBE_CLIENT_TIMEOUT_MS);

    const result = data.nexusHostProbe;
    if (!result.success) {
      throw new Error(result.error || 'Probe failed');
    }
    if (!result.multiIssue) {
      return { installs: [] };
    }

    const changedKey = result.multiIssue.issues?.find((i) => i.kind === 'changedHostKey');
    return {
      installs: result.multiIssue.installs || [],
      changedHostKey: changedKey && changedKey.fingerprint && changedKey.previousFingerprint
        ? { fingerprint: changedKey.fingerprint, previousFingerprint: changedKey.previousFingerprint }
        : undefined,
    };
  };

  /**
   * Re-run discovery for one host and surface newly-discovered installs.
   * Already-followed sites are never modified, unfollowed, or re-verified.
   */
  checkItNow = async (alias: string): Promise<void> => {
    this.setState({ checking: alias, probeError: null });
    try {
      const result = await this.runProbe(alias);
      if (!this.mounted) return;

      // If the host key changed, route to the identity-changed screen
      if (result.changedHostKey) {
        this.setState({
          checking: null,
          screen: { name: 'identityChanged', alias },
          identity: {
            ...this.state.identity,
            [alias]: {
              current: result.changedHostKey.fingerprint,
              approved: result.changedHostKey.previousFingerprint,
              approvedAt: 'previously', // We don't have the date from the probe
            },
          },
        });
        return;
      }

      // Filter out installs that are already followed by comparing the probe's
      // discovered paths against the wp_path values stored for this alias.
      // Normalize trailing slashes on both sides so /home/u/one and /home/u/one/ match.
      const normalize = (p: string) => p.replace(/\/$/, '');
      const followedPaths = new Set(
        this.state.hosts
          .filter(h => h.alias === alias)
          .map(h => normalize(h.wpPath))
      );
      const newInstalls = result.installs.filter(path => !followedPaths.has(normalize(path)));

      this.setState({
        checking: null,
        discovered: {
          ...this.state.discovered,
          [alias]: newInstalls,
        },
      });
    } catch (e: any) {
      if (!this.mounted) return;
      // Surface the error to the user
      this.setState({
        checking: null,
        probeError: e?.message || 'Probe failed',
      });
    }
  };

  /**
   * Persist the root-mode setting for one host.
   */
  setRootMode = async (alias: string, allowRoot: boolean): Promise<void> => {
    this.setState({ rootModeError: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, alias, allowRoot);
      if (!result.success) {
        this.setState({ rootModeError: result.error || 'Failed to update root mode' });
      } else {
        // Reload to pick up the new allowRoot value
        this.reload();
      }
    } catch (e: any) {
      this.setState({ rootModeError: e?.message || 'Failed to update root mode' });
    }
  };

  /**
   * Surface the instruction to accept a changed host key in Local's Preferences.
   * Does NOT call TRUST_EXTERNAL_HOST_KEY — that is renderer-only by design.
   */
  acceptIdentity = (alias: string): void => {
    // Only surfaces the instruction — no IPC call to trust the key.
    // The user must approve it in Local → Preferences → Nexus AI.
    void alias;
    this.setState({ showAcceptInstruction: true });
  };

  /**
   * Follow a discovered install by calling nexusHostAddSites, then refresh.
   */
  followDiscoveredInstall = async (alias: string, path: string): Promise<void> => {
    try {
      await rendererGql(`
        mutation FollowSite($alias: String!, $sites: [NexusHostSiteEnvironmentInput!]!) {
          nexusHostAddSites(alias: $alias, sites: $sites) {
            success
            error
          }
        }
      `, {
        alias,
        sites: [{ path, environment: 'production', site: path.split('/').pop() || 'site' }],
      });
      // Remove from discovered and reload
      const newDiscovered = { ...this.state.discovered };
      newDiscovered[alias] = (newDiscovered[alias] || []).filter(p => p !== path);
      this.setState({ discovered: newDiscovered });
      this.reload();
    } catch (e: any) {
      console.error('Failed to follow install:', e);
    }
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
    const unavailable = capabilities.filter(c => c.state === 'unavailable');

    // Derive the cannot list from unavailable capabilities
    const cannotItems = unavailable.map(c => c.label).join(', ');
    const cannotText = cannotItems
      ? `${cannotItems} — those are WP Engine only. Backups and staging stay with your host's own tools.`
      : "Backups and staging stay with your host's own tools.";

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
          }, cannotText),
        ),
      ),

      // Add button
      React.createElement('button', {
        onClick: () => this.setState({ screen: { name: 'add' } }),
        style: {
          border: 'none',
          font: 'inherit',
          display: 'inline-block',
          padding: '6px 12px',
          background: 'var(--nxai-accent)',
          color: 'var(--nxai-accent-text)',
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
        React.createElement('button', {
          key: row.alias,
          onClick: () => this.setState({ screen: { name: 'detail', alias: row.alias } }),
          style: {
            border: 'none',
            font: 'inherit',
            width: '100%',
            textAlign: 'left',
            padding: 16,
            background: 'var(--nxai-card-bg)',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: 'var(--nxai-card-border)',
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

      // Add a host button
      React.createElement('button', {
        onClick: () => this.setState({ screen: { name: 'add' } }),
        style: {
          border: 'none',
          font: 'inherit',
          display: 'inline-block',
          padding: '6px 12px',
          background: 'var(--nxai-accent)',
          color: 'var(--nxai-accent-text)',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          marginTop: 8,
        },
      }, 'Add a host'),
    );
  }

  renderDetail(alias: string): React.ReactElement {
    const capabilities = externalHostCapabilities();
    const hostSites = this.state.hosts.filter(h => h.alias === alias);
    const discovered = this.state.discovered[alias] || [];
    const cfg = this.state.sshConfigHosts.find(c => c.alias === alias);
    const allowRoot = hostSites.length > 0 ? hostSites[0].allowRoot : false;

    return React.createElement('div', {},
      // Back button
      React.createElement('button', {
        onClick: () => this.setState({ screen: { name: 'list' }, showAcceptInstruction: false, discovered: {}, probeError: null, rootModeError: null, removeError: null }),
        style: {
          border: 'none',
          font: 'inherit',
          background: 'transparent',
          padding: 0,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--nxai-accent)',
          marginBottom: 16,
          cursor: 'pointer',
        },
      }, '← Back to hosts'),

      // Connection card
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 16,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 8,
          },
        }, alias),
        cfg && React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
            marginBottom: 4,
          },
        }, `${cfg.user}@${cfg.hostname}:${cfg.port}`),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
            marginTop: 12,
          },
        }, `Nexus opens at most 3 connections at a time to a host other than WP Engine, and batches its questions into one session where it can. That is a fixed limit on our side, not something read from your server — which is why checks here run less often than on WP Engine.`),
      ),

      // Sites
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 16,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 8,
          },
        }, 'Sites'),
        hostSites.length === 0 && discovered.length === 0
          ? React.createElement('div', {
              style: {
                fontSize: 12,
                color: 'var(--nxai-card-sub)',
              },
            }, 'No sites followed yet')
          : null,
        hostSites.map((site, idx) =>
          React.createElement('div', {
            key: idx,
            style: {
              fontSize: 12,
              color: 'var(--nxai-card-text)',
              padding: '8px 0',
              borderBottom: idx < hostSites.length - 1 || discovered.length > 0 ? '1px solid var(--nxai-card-border)' : 'none',
            },
          },
            React.createElement('div', {
              style: {
                fontWeight: 600,
                marginBottom: 2,
              },
            }, site.domain || site.site),
            React.createElement('div', {
              style: {
                color: 'var(--nxai-card-sub)',
              },
            }, `${site.site} · ${site.environment}`),
          ),
        ),
        discovered.map((path, idx) =>
          React.createElement('div', {
            key: `discovered-${idx}`,
            style: {
              fontSize: 12,
              color: 'var(--nxai-card-text)',
              padding: '8px 0',
              borderBottom: idx < discovered.length - 1 ? '1px solid var(--nxai-card-border)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            },
          },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', {
                style: {
                  fontWeight: 600,
                  marginBottom: 2,
                },
              }, path),
              React.createElement('div', {
                style: {
                  color: 'var(--nxai-card-sub)',
                },
              }, 'Not yet followed'),
            ),
            React.createElement('button', {
              onClick: () => this.followDiscoveredInstall(alias, path),
              style: {
                border: 'none',
                font: 'inherit',
                display: 'inline-block',
                padding: '4px 8px',
                background: 'var(--nxai-accent)',
                color: 'var(--nxai-accent-text)',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              },
            }, 'Follow'),
          ),
        ),
        React.createElement('button', {
          onClick: this.state.checking === alias ? undefined : () => this.checkItNow(alias),
          disabled: this.state.checking === alias,
          style: {
            border: 'none',
            font: 'inherit',
            display: 'inline-block',
            padding: '6px 12px',
            background: this.state.checking === alias ? 'var(--nxai-status-neutral)' : 'var(--nxai-accent)',
            color: 'var(--nxai-accent-text)',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: this.state.checking === alias ? 'default' : 'pointer',
            marginTop: 12,
          },
        }, this.state.checking === alias ? 'Checking...' : 'Check it now'),
        this.state.probeError && React.createElement('div', {
          style: {
            marginTop: 8,
            fontSize: 12,
            color: 'var(--nxai-error-text)',
          },
        }, this.state.probeError),
      ),

      // Capabilities
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 16,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 8,
          },
        }, 'What Nexus may do here'),
        capabilities.map((cap, idx) =>
          React.createElement('div', {
            key: cap.id,
            style: {
              fontSize: 12,
              padding: '8px 0',
              borderBottom: idx < capabilities.length - 1 ? '1px solid var(--nxai-card-border)' : 'none',
            },
          },
            React.createElement('div', {
              style: {
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              },
            },
              React.createElement('div', {
                style: {
                  fontSize: 14,
                  color: cap.state === 'allowed' ? 'var(--nxai-accent)' : cap.state === 'gated' ? 'var(--nxai-amber-text)' : 'var(--nxai-card-sub)',
                  minWidth: 16,
                },
              }, cap.state === 'allowed' ? '✓' : cap.state === 'gated' ? '~' : '—'),
              React.createElement('div', { style: { flex: 1 } },
                React.createElement('div', {
                  style: {
                    color: 'var(--nxai-card-text)',
                    fontWeight: 600,
                    marginBottom: cap.note ? 4 : 0,
                  },
                }, cap.label),
                cap.note && React.createElement('div', {
                  style: {
                    color: cap.state === 'gated' ? 'var(--nxai-amber-text)' : 'var(--nxai-card-sub)',
                    fontSize: 11,
                  },
                }, cap.note),
              ),
            ),
          ),
        ),
      ),

      // Root mode control
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 16,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 8,
          },
        }, 'Root mode'),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
            marginBottom: 12,
          },
        }, 'Allow commands to run as root on this host'),
        React.createElement('label', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          },
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: allowRoot,
            onChange: (e: any) => this.setRootMode(alias, e.target.checked),
          }),
          React.createElement('span', {
            style: {
              fontSize: 12,
              color: 'var(--nxai-card-text)',
            },
          }, 'Allow root access'),
        ),
        this.state.rootModeError && React.createElement('div', {
          style: {
            marginTop: 8,
            fontSize: 12,
            color: 'var(--nxai-error-text)',
          },
        }, this.state.rootModeError),
      ),

      // Removal
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-error-border)',
          borderRadius: 6,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 8,
          },
        }, 'Remove this host'),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
            marginBottom: 12,
          },
        }, 'Disconnect from this host and remove all its sites from Nexus'),
        React.createElement('button', {
          onClick: () => this.setState({ screen: { name: 'remove', alias } }),
          style: {
            border: 'none',
            font: 'inherit',
            display: 'inline-block',
            padding: '6px 12px',
            background: 'var(--nxai-error-bg)',
            color: 'var(--nxai-error-text)',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          },
        }, 'Remove'),
      ),
    );
  }

  renderIdentityChanged(alias: string): React.ReactElement {
    const identity = this.state.identity[alias];
    if (!identity) {
      return React.createElement('div', {}, 'No identity data for this host');
    }

    return React.createElement('div', {},
      // Back button
      React.createElement('button', {
        onClick: () => this.setState({ screen: { name: 'list' }, showAcceptInstruction: false, discovered: {}, probeError: null, rootModeError: null, removeError: null }),
        style: {
          border: 'none',
          font: 'inherit',
          background: 'transparent',
          padding: 0,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--nxai-accent)',
          marginBottom: 16,
          cursor: 'pointer',
        },
      }, '← Back to hosts'),

      // Main card
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-error-border)',
          borderRadius: 6,
          marginBottom: 16,
        },
      },
        // Title
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 12,
          },
        }, "This server's identity changed"),

        // Main message
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-text)',
            lineHeight: 1.5,
            marginBottom: 16,
          },
        },
          React.createElement('p', { style: { marginBottom: 12 } },
            `${alias} is answering with a different fingerprint than the one you approved on ${identity.approvedAt}. Nexus has stopped connecting to it and will not try again until you say so.`,
          ),
          React.createElement('p', { style: { marginBottom: 12 } },
            'Usually this means the host rebuilt the server. Occasionally it means something is impersonating it — which is why this is not something Nexus should decide for you.',
          ),
          React.createElement('p', { style: { marginBottom: 12 } },
            'Ask your host to confirm the new fingerprint before you accept it. Do not accept it because the site seems fine — a site seeming fine is exactly what an impersonation looks like.',
          ),
        ),

        // Fingerprints
        React.createElement('div', {
          style: {
            marginBottom: 16,
          },
        },
          React.createElement('div', {
            style: {
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--nxai-card-sub)',
              marginBottom: 4,
            },
          }, `Approved on ${identity.approvedAt}`),
          React.createElement('div', {
            style: {
              fontSize: 12,
              color: 'var(--nxai-card-text)',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              marginBottom: 12,
            },
          }, identity.approved),

          React.createElement('div', {
            style: {
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--nxai-card-sub)',
              marginBottom: 4,
            },
          }, 'Current fingerprint'),
          React.createElement('div', {
            style: {
              fontSize: 12,
              color: 'var(--nxai-card-text)',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            },
          }, identity.current),
        ),

        // Buttons
        React.createElement('div', {
          style: {
            display: 'flex',
            gap: 8,
          },
        },
          React.createElement('button', {
            onClick: () => this.setState({ screen: { name: 'list' }, showAcceptInstruction: false, discovered: {}, probeError: null, rootModeError: null, removeError: null }),
            style: {
              border: 'none',
              font: 'inherit',
              display: 'inline-block',
              padding: '6px 12px',
              background: 'var(--nxai-card-border)',
              color: 'var(--nxai-card-text)',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            },
          }, 'Leave it disconnected'),
          React.createElement('button', {
            onClick: () => this.acceptIdentity(alias),
            style: {
              border: 'none',
              font: 'inherit',
              display: 'inline-block',
              padding: '6px 12px',
              background: 'var(--nxai-accent)',
              color: 'var(--nxai-accent-text)',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            },
          }, 'I confirmed it with my host — accept'),
        ),

        // Instruction shown after accept is clicked
        this.state.showAcceptInstruction && React.createElement('div', {
          style: {
            marginTop: 16,
            padding: 12,
            background: 'var(--nxai-amber-bg)',
            border: '1px solid var(--nxai-amber-border)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--nxai-card-text)',
            lineHeight: 1.5,
          },
        },
          React.createElement('div', {
            style: {
              fontWeight: 600,
              marginBottom: 4,
            },
          }, 'Where to approve the new key'),
          React.createElement('div', {},
            'Go to Local → Preferences → Nexus AI to approve the changed fingerprint. That approval stays in Local\'s Preferences, because it must not be reachable from anything but Local itself.',
          ),
        ),
      ),
    );
  }

  renderRemove(alias: string): React.ReactElement {
    const siteCount = this.state.hosts.filter(h => h.alias === alias).length;

    const handleRemove = async () => {
      this.setState({ removeError: null });
      try {
        const data = await rendererGql<{ nexusHostRemove: { success: boolean; error: string | null } }>(`
          mutation RemoveHost($alias: String!) {
            nexusHostRemove(alias: $alias) {
              success
              error
            }
          }
        `, { alias });
        if (!data.nexusHostRemove.success) {
          this.setState({ removeError: data.nexusHostRemove.error || 'Failed to remove host' });
          return;
        }
        this.setState({ screen: { name: 'list' }, showAcceptInstruction: false, discovered: {}, probeError: null, rootModeError: null, removeError: null });
        this.reload();
      } catch (e: any) {
        this.setState({ removeError: e?.message || 'Failed to remove host' });
      }
    };

    return React.createElement('div', {},
      // Back button
      React.createElement('button', {
        onClick: () => this.setState({ screen: { name: 'detail', alias } }),
        style: {
          border: 'none',
          font: 'inherit',
          background: 'transparent',
          padding: 0,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--nxai-accent)',
          marginBottom: 16,
          cursor: 'pointer',
        },
      }, `← ${alias}`),

      // Confirmation card
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-error-border)',
          borderRadius: 6,
        },
      },
        // Title
        React.createElement('div', {
          style: {
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 16,
          },
        }, `Remove ${alias}?`),

        // Main message
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-text)',
            lineHeight: 1.5,
            marginBottom: 16,
          },
        },
          `Its ${siteCount} followed ${siteCount === 1 ? 'site' : 'sites'} disappear from your sites list, and everything Nexus worked out about them is deleted — what is installed, what is published, past findings.`,
          ' ',
          React.createElement('strong', {}, 'The server is not touched.'),
          ` Nothing is deleted on ${alias}, and you can add it again later — it will read everything from scratch.`,
        ),

        // Buttons
        React.createElement('div', {
          style: {
            display: 'flex',
            gap: 8,
          },
        },
          React.createElement('button', {
            onClick: () => this.setState({ screen: { name: 'detail', alias } }),
            autoFocus: true,
            style: {
              border: 'none',
              font: 'inherit',
              display: 'inline-block',
              padding: '6px 12px',
              background: 'var(--nxai-card-border)',
              color: 'var(--nxai-card-text)',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            },
          }, 'Cancel'),
          React.createElement('button', {
            onClick: handleRemove,
            style: {
              border: 'none',
              font: 'inherit',
              display: 'inline-block',
              padding: '6px 12px',
              background: 'var(--nxai-error-bg)',
              color: 'var(--nxai-error-text)',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            },
          }, 'Remove host'),
        ),
        this.state.removeError && React.createElement('div', {
          style: {
            marginTop: 12,
            fontSize: 12,
            color: 'var(--nxai-error-text)',
          },
        }, this.state.removeError),
      ),
    );
  }

  render(): React.ReactElement {
    // Add screen
    if (this.state.screen.name === 'add') {
      return React.createElement(ExternalHostAddWizard, {
        electron: this.props.electron,
        onClose: this.closeAdd,
        onCompleted: this.completeAdd,
        onProbeClean: () => undefined,
      });
    }

    // Detail screen
    if (this.state.screen.name === 'detail') {
      return this.renderDetail(this.state.screen.alias);
    }

    // Identity changed screen
    if (this.state.screen.name === 'identityChanged') {
      return this.renderIdentityChanged(this.state.screen.alias);
    }

    // Remove screen
    if (this.state.screen.name === 'remove') {
      return this.renderRemove(this.state.screen.alias);
    }

    const rows = this.hostRows();

    // Empty state when no hosts
    if (rows.length === 0) {
      return this.renderEmpty();
    }

    // List state
    return this.renderList();
  }
}
