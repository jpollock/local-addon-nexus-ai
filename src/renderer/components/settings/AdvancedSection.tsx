/**
 * AdvancedSection — maintenance capabilities stranded by Spec 5.
 *
 * Five capabilities deliberately left unreachable until this section existed:
 * - Database health scan
 * - Remove ghost installs
 * - SSH diagnostics
 * - Content index rebuild (lowest-cost reset)
 * - Factory reset (highest-cost reset)
 *
 * Plus the three resets ranked by cost-to-undo, MCP panel, and gateway panel.
 */
import * as React from 'react';
import type { NexusSettings } from '../../../common/types';
import { IPC_CHANNELS } from '../../../common/constants';

interface Props {
  settings: NexusSettings;
  indexEntries: Array<{ siteId: string; state: string; documentCount?: number }>;
  mcpInfo: { port: number };
  onSave: (patch: Partial<NexusSettings>) => void;
  electron: {
    ipcRenderer: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
  };
}

interface State {
  // DB Scanner
  dbScanRunning: boolean;
  dbScanResults: Array<{ siteId: string; siteName: string; healthScore?: number; error?: string; issues?: any[] }> | null;

  // Ghost installs
  ghostRunning: boolean;

  // SSH Diagnostics
  diagInstall: string;
  diagRunning: boolean;
  diagResults: Array<{ command: string; output: string; error?: string; duration: number }> | null;

  // Resets
  resetIndexConfirming: boolean;
  resetIndexRunning: boolean;
  resetIndexResult: { siteCount: number; docCount: number } | null;

  resetAllConfirming: boolean;
  resetAllRunning: boolean;

  factoryResetConfirming: boolean;
  factoryResetRunning: boolean;
  factoryResetTyped: string;

  // Vector store size
  vectorStoreSizeMB: number | null;
}

export class AdvancedSection extends React.Component<Props, State> {
  state: State = {
    dbScanRunning: false,
    dbScanResults: null,
    ghostRunning: false,
    diagInstall: '',
    diagRunning: false,
    diagResults: null,
    resetIndexConfirming: false,
    resetIndexRunning: false,
    resetIndexResult: null,
    resetAllConfirming: false,
    resetAllRunning: false,
    factoryResetConfirming: false,
    factoryResetRunning: false,
    factoryResetTyped: '',
    vectorStoreSizeMB: null,
  };

  async componentDidMount() {
    await this.loadVectorStoreSize();
  }

  async loadVectorStoreSize() {
    try {
      // Get Local's userData path and check vectors.db
      const userDataPath = (window as any).getUserDataPath?.();
      if (!userDataPath) return;

      const fs = (window as any).require?.('fs');
      const path = (window as any).require?.('path');
      if (!fs || !path) return;

      const vectorsDbPath = path.join(userDataPath, 'Local', 'nexus-ai', 'vectors.db');
      if (fs.existsSync(vectorsDbPath)) {
        const stats = fs.statSync(vectorsDbPath);
        this.setState({ vectorStoreSizeMB: Math.round(stats.size / (1024 * 1024)) });
      }
    } catch {
      // Silently fail — size is optional UX sugar
    }
  }

  handleDbScan = async () => {
    this.setState({ dbScanRunning: true, dbScanResults: null });
    const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.DB_SCAN_ALL);
    this.setState({
      dbScanRunning: false,
      dbScanResults: result.success ? result.scans : null,
    });
    if (!result.success) {
      (window as any).showToast?.(`DB scan failed: ${result.error}`, 'error');
    }
  };

  handleGhostCleanup = async () => {
    this.setState({ ghostRunning: true });
    const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_GHOST_INSTALLS);
    this.setState({ ghostRunning: false });
    if (result.success) {
      (window as any).showToast?.(
        `Removed ${result.removed} ghost install${result.removed !== 1 ? 's' : ''} from graph`,
        'success',
      );
    }
  };

  handleDiag = async (args: string[]) => {
    if (!this.state.diagInstall.trim()) return;
    this.setState({ diagRunning: true });
    const start = Date.now();
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.WPE_DIAGNOSE,
        this.state.diagInstall.trim(),
        args,
      );
      const duration = Date.now() - start;
      const existing = this.state.diagResults ?? [];
      this.setState({
        diagRunning: false,
        diagResults: [
          ...existing,
          {
            command: `wp ${args.join(' ')}`,
            output: result.success ? result.output : '',
            error: result.success ? undefined : result.error,
            duration,
          },
        ],
      });
    } catch (error: any) {
      this.setState({
        diagRunning: false,
        diagResults: [
          ...(this.state.diagResults ?? []),
          {
            command: `wp ${args.join(' ')}`,
            output: '',
            error: error.message,
            duration: Date.now() - start,
          },
        ],
      });
    }
  };

  handleResetIndex = async () => {
    this.setState({ resetIndexRunning: true });
    const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.RESET_CONTENT_INDEX);
    this.setState({
      resetIndexRunning: false,
      resetIndexConfirming: false,
      resetIndexResult: result.success ? { siteCount: result.siteCount, docCount: result.docCount } : null,
    });
    if (!result.success) {
      (window as any).showToast?.(`Reset failed: ${result.error}`, 'error');
    }
    await this.loadVectorStoreSize();
  };

  handleResetAll = async () => {
    this.setState({ resetAllRunning: true });
    const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.RESET_AND_REFRESH);
    this.setState({ resetAllRunning: false, resetAllConfirming: false });
    if (result.success) {
      (window as any).showToast?.(
        `Reset complete: ${result.capiInstalls} CAPI installs, ${result.sshSynced} SSH synced`,
        'success',
      );
    } else {
      (window as any).showToast?.(`Reset failed: ${result.error}`, 'error');
    }
  };

  handleFactoryReset = async () => {
    this.setState({ factoryResetRunning: true });
    const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.FACTORY_RESET);
    this.setState({ factoryResetRunning: false, factoryResetConfirming: false, factoryResetTyped: '' });
    if (result?.success) {
      (window as any).showToast?.('Factory reset complete. Restart Local to complete the reset.', 'success');
    } else {
      (window as any).showToast?.(`Reset failed: ${result?.error}`, 'error');
    }
  };

  render(): React.ReactNode {
    const { settings, indexEntries, mcpInfo } = this.props;
    const {
      dbScanRunning, dbScanResults,
      ghostRunning,
      diagInstall, diagRunning, diagResults,
      resetIndexConfirming, resetIndexRunning, resetIndexResult,
      resetAllConfirming, resetAllRunning,
      factoryResetConfirming, factoryResetRunning, factoryResetTyped,
      vectorStoreSizeMB,
    } = this.state;

    const indexedCount = indexEntries.filter(e => e.state === 'indexed' || e.state === 'stale').length;
    const totalDocs = indexEntries.reduce((s, e) => s + (e.documentCount ?? 0), 0);

    return React.createElement('div', null,
      // Opening line
      React.createElement('div', {
        style: {
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--nxai-card-sub)',
          marginBottom: 24,
        },
      },
        'You should not need anything on this page unless something has gone wrong or you are wiring Nexus into your own tools.',
      ),

      // MCP Server
      this.renderMcpPanel(),

      // AI Gateway
      this.renderGatewayPanel(),

      // Search index
      this.renderSearchIndex(),

      // Database health
      this.renderDbScan(),

      // Remove ghost installs
      this.renderGhostCleanup(),

      // SSH diagnostics
      this.renderSshDiagnostics(),

      // Auto-indexing section
      this.renderAutoIndexingSection(),

      // Rebuilding and starting over
      this.renderResetsGroup(),
    );
  }

  renderMcpPanel(): React.ReactNode {
    const { mcpInfo } = this.props;
    const command = `npx -y @modelcontextprotocol/inspector http://localhost:${mcpInfo.port}/sse`;

    return React.createElement('div', {
      style: {
        marginBottom: 24,
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 8 },
      }, 'Connect your own AI tools'),
      React.createElement('div', {
        style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, `MCP server running on port ${mcpInfo.port}`),
      React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 10,
          background: 'var(--nxai-code-bg)',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
        },
      },
        React.createElement('code', { style: { flex: 1, color: 'var(--nxai-card-text)' } }, command),
        React.createElement('button', {
          onClick: () => {
            navigator.clipboard?.writeText(command);
            (window as any).showToast?.('Copied to clipboard', 'success');
          },
          style: {
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: 'var(--nxai-card-bg)',
            border: '1px solid var(--nxai-card-border)',
            borderRadius: 4,
            cursor: 'pointer',
            color: 'var(--nxai-card-text)',
          },
        }, 'Copy'),
      ),
    );
  }

  renderGatewayPanel(): React.ReactNode {
    return React.createElement('div', {
      style: {
        marginBottom: 24,
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 8 },
      }, 'AI gateway'),
      React.createElement('div', {
        style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, 'Gateway running on port 13100'),
      React.createElement('button', {
        onClick: async () => {
          const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.AI_GATEWAY_GET_STATS);
          if (result.success) {
            const { totalRequests, totalCost, providers } = result.stats;
            alert(
              `Gateway Usage:\n\n` +
              `Total requests: ${totalRequests.toLocaleString()}\n` +
              `Total cost: $${totalCost.toFixed(4)}\n\n` +
              Object.entries(providers)
                .map(([p, stats]: [string, any]) => `${p}: ${stats.requests} requests`)
                .join('\n'),
            );
          } else {
            (window as any).showToast?.('Failed to load gateway stats', 'error');
          }
        },
        style: {
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--nxai-card-text)',
        },
      }, 'View usage'),
    );
  }

  renderSearchIndex(): React.ReactNode {
    const { indexEntries } = this.props;
    const { vectorStoreSizeMB } = this.state;

    const indexedCount = indexEntries.filter(e => e.state === 'indexed' || e.state === 'stale').length;

    const sizeClause = vectorStoreSizeMB !== null ? `${vectorStoreSizeMB} MB · ` : '';

    return React.createElement('div', {
      style: {
        marginBottom: 24,
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 8 },
      }, 'Search index'),
      React.createElement('div', {
        style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, `${sizeClause}${indexedCount} site${indexedCount !== 1 ? 's' : ''} indexed`),
      React.createElement('button', {
        onClick: () => this.setState({ resetIndexConfirming: true }),
        style: {
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--nxai-card-text)',
        },
      }, 'Rebuild'),
    );
  }

  renderDbScan(): React.ReactNode {
    const { dbScanRunning, dbScanResults } = this.state;

    return React.createElement('div', {
      style: {
        marginBottom: 24,
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 8 },
      }, 'Database health'),
      React.createElement('div', {
        style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, 'Scans all running local sites for database health issues'),
      React.createElement('button', {
        disabled: dbScanRunning,
        onClick: this.handleDbScan,
        style: {
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          background: dbScanRunning ? 'var(--nxai-status-neutral)' : 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 4,
          cursor: dbScanRunning ? 'not-allowed' : 'pointer',
          color: 'var(--nxai-card-text)',
          opacity: dbScanRunning ? 0.7 : 1,
        },
      }, dbScanRunning ? 'Scanning...' : 'Scan'),

      // Results
      dbScanResults && dbScanResults.length > 0
        ? React.createElement('div', {
            style: { marginTop: 12, display: 'flex', flexDirection: 'column' as const, gap: 6 },
          },
            dbScanResults.map((scan) => {
              const scoreColor = (score?: number) => {
                if (score === undefined) return 'var(--nxai-status-neutral)';
                if (score >= 90) return '#51bb7b';
                if (score >= 70) return 'var(--nxai-warn-text)';
                return 'var(--nxai-danger-text)';
              };

              return React.createElement('div', {
                key: scan.siteId,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 8,
                  background: 'var(--nxai-section-bg)',
                  borderRadius: 4,
                },
              },
                React.createElement('span', {
                  style: { fontSize: 12, fontWeight: 500, color: 'var(--nxai-card-text)' },
                }, scan.siteName),
                scan.error
                  ? React.createElement('span', {
                      style: { fontSize: 11, color: 'var(--nxai-danger-text)' },
                    }, `Error: ${scan.error}`)
                  : React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                      React.createElement('span', {
                        style: { fontSize: 13, fontWeight: 700, color: scoreColor(scan.healthScore) },
                      }, `${scan.healthScore ?? '?'}/100`),
                      scan.issues && scan.issues.length > 0
                        ? React.createElement('span', {
                            style: { fontSize: 11, color: 'var(--nxai-card-sub)' },
                          }, `${scan.issues.length} issue${scan.issues.length !== 1 ? 's' : ''}`)
                        : React.createElement('span', {
                            style: { fontSize: 11, color: '#51bb7b' },
                          }, '✓ clean'),
                    ),
              );
            }),
          )
        : null,
    );
  }

  renderGhostCleanup(): React.ReactNode {
    const { ghostRunning } = this.state;

    return React.createElement('div', {
      style: {
        marginBottom: 24,
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 8 },
      }, 'Remove ghost installs'),
      React.createElement('div', {
        style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, 'Remove WPE installs that no longer exist in CAPI'),
      React.createElement('button', {
        disabled: ghostRunning,
        onClick: this.handleGhostCleanup,
        style: {
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          background: ghostRunning ? 'var(--nxai-status-neutral)' : 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 4,
          cursor: ghostRunning ? 'not-allowed' : 'pointer',
          color: 'var(--nxai-card-text)',
          opacity: ghostRunning ? 0.7 : 1,
        },
      }, ghostRunning ? 'Running...' : 'Run'),
    );
  }

  renderSshDiagnostics(): React.ReactNode {
    const { diagInstall, diagRunning, diagResults } = this.state;

    const PRESETS: Array<{ label: string; args: string[] }> = [
      { label: 'wp core version', args: ['core', 'version'] },
      { label: 'wp plugin list', args: ['plugin', 'list', '--format=json'] },
      { label: 'wp user list', args: ['user', 'list', '--format=json'] },
    ];

    return React.createElement('div', {
      style: {
        marginBottom: 24,
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', marginBottom: 8 },
      }, 'SSH diagnostics'),
      React.createElement('div', {
        style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, 'Run WP-CLI commands against any WPE install to diagnose SSH/timing issues'),

      // Install input
      React.createElement('input', {
        type: 'text',
        placeholder: 'install-name (e.g. acfrecipes)',
        value: diagInstall,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ diagInstall: e.target.value }),
        style: {
          padding: '6px 10px',
          fontSize: 12,
          fontFamily: 'monospace',
          border: '1px solid var(--nxai-input-border)',
          background: 'var(--nxai-input-bg)',
          color: 'var(--nxai-card-text)',
          borderRadius: 4,
          width: '220px',
          marginBottom: 8,
        },
      }),

      // Preset buttons
      React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 12 } },
        PRESETS.map(({ label, args }) =>
          React.createElement('button', {
            key: label,
            disabled: diagRunning || !diagInstall.trim(),
            onClick: () => this.handleDiag(args),
            style: {
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'monospace',
              background: diagRunning || !diagInstall.trim() ? 'var(--nxai-status-neutral)' : 'var(--nxai-card-bg)',
              border: '1px solid var(--nxai-card-border)',
              borderRadius: 4,
              cursor: diagRunning || !diagInstall.trim() ? 'not-allowed' : 'pointer',
              color: 'var(--nxai-card-text)',
              opacity: diagRunning || !diagInstall.trim() ? 0.5 : 1,
            },
          }, label),
        ),
      ),

      // Results
      diagResults && diagResults.length > 0
        ? React.createElement('div', {
            style: {
              marginTop: 12,
              maxHeight: 300,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column' as const,
              gap: 8,
            },
          },
            diagResults.map((r, i) =>
              React.createElement('div', {
                key: i,
                style: {
                  padding: 10,
                  background: 'var(--nxai-code-bg)',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'monospace',
                },
              },
                React.createElement('div', {
                  style: { fontWeight: 600, marginBottom: 6, color: 'var(--nxai-card-text)' },
                }, `$ ${r.command} (${r.duration}ms)`),
                r.error
                  ? React.createElement('div', { style: { color: 'var(--nxai-danger-text)' } }, r.error)
                  : React.createElement('pre', {
                      style: { margin: 0, whiteSpace: 'pre-wrap' as const, color: 'var(--nxai-card-sub)' },
                    }, r.output),
              ),
            ),
          )
        : null,
    );
  }

  renderAutoIndexingSection(): React.ReactNode {
    const { settings } = this.props;
    const sites: any[] = []; // Would need to be passed as prop in real usage

    return React.createElement('div', {
      style: {
        marginBottom: 24,
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
      },
    },
      React.createElement('label', {
        style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
      },
        React.createElement('input', {
          type: 'checkbox',
          checked: settings.autoIndex,
          onChange: (e: any) => this.props.onSave({ autoIndex: e.target.checked }),
          style: { width: 16, height: 16, cursor: 'pointer' },
        }),
        React.createElement('div', null,
          React.createElement('div', {
            style: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)' },
          }, 'Automatically index sites when started'),
          React.createElement('div', {
            style: { fontSize: 12, color: 'var(--nxai-card-sub)' },
          }, 'Creates searchable content index when a local site starts'),
        ),
      ),
    );
  }

  renderResetsGroup(): React.ReactNode {
    return React.createElement('div', {
      style: {
        marginTop: 32,
        paddingTop: 24,
        borderTop: '2px solid var(--nxai-card-border)',
      },
    },
      React.createElement('div', {
        style: { fontSize: 14, fontWeight: 700, color: 'var(--nxai-card-text)', marginBottom: 8 },
      }, 'REBUILDING AND STARTING OVER'),
      React.createElement('div', {
        style: { fontSize: 13, color: 'var(--nxai-card-sub)', marginBottom: 20, lineHeight: 1.5 },
      }, 'Three different things, in order of what they cost you. Each one says what it keeps and how long you are without it.'),

      this.renderResetIndex(),
      this.renderResetAll(),
      this.renderFactoryReset(),
    );
  }

  renderResetIndex(): React.ReactNode {
    const { resetIndexConfirming, resetIndexRunning, resetIndexResult } = this.state;
    const { indexEntries } = this.props;

    const indexedCount = indexEntries.filter(e => e.state === 'indexed' || e.state === 'stale').length;

    if (resetIndexResult) {
      return React.createElement('div', {
        style: {
          marginBottom: 16,
          padding: 14,
          background: 'rgba(81,187,123,0.06)',
          border: '1px solid rgba(81,187,123,0.2)',
          borderRadius: 6,
        },
      },
        React.createElement('span', { style: { fontSize: 12, color: '#51BB7B' } },
          `✓ Content index cleared — ${resetIndexResult.siteCount} site${resetIndexResult.siteCount !== 1 ? 's' : ''}, ${resetIndexResult.docCount.toLocaleString()} documents removed. Content will be re-indexed when sites start.`,
        ),
        React.createElement('button', {
          onClick: () => this.setState({ resetIndexResult: null }),
          style: {
            marginLeft: 12,
            background: 'none',
            border: 'none',
            color: '#51BB7B',
            fontSize: 11,
            cursor: 'pointer',
          },
        }, 'Dismiss'),
      );
    }

    return React.createElement('div', {
      style: {
        marginBottom: 16,
        padding: 16,
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
      },
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', {
            style: { fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 6 },
          }, 'Rebuild search'),
          React.createElement('div', {
            style: { fontSize: 12, color: '#4b5563', marginBottom: 4 },
          }, 'Keeps everything. Re-reads content you already have on this Mac.'),
          React.createElement('div', {
            style: { fontSize: 12, color: '#374151' },
          }, 'A few minutes · search results are patchy meanwhile'),
        ),
        React.createElement('button', {
          disabled: resetIndexRunning,
          onClick: () => {
            if (resetIndexConfirming) {
              this.handleResetIndex();
            } else {
              this.setState({ resetIndexConfirming: true });
            }
          },
          style: {
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--nxai-card-bg)',
            border: '1px solid var(--nxai-card-border)',
            borderRadius: 4,
            cursor: resetIndexRunning ? 'not-allowed' : 'pointer',
            color: 'var(--nxai-card-text)',
            opacity: resetIndexRunning ? 0.6 : 1,
          },
        }, resetIndexRunning ? 'Rebuilding...' : 'Rebuild'),
      ),

      resetIndexConfirming && !resetIndexRunning
        ? React.createElement('div', {
            style: {
              marginTop: 12,
              padding: 12,
              background: 'var(--nxai-section-bg)',
              borderRadius: 4,
            },
          },
            React.createElement('div', {
              style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 10 },
            }, `This will clear the vector index for ${indexedCount} site${indexedCount !== 1 ? 's' : ''}. Content will be re-indexed when sites start.`),
            React.createElement('div', { style: { display: 'flex', gap: 8 } },
              React.createElement('button', {
                onClick: this.handleResetIndex,
                style: {
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'var(--nxai-danger-text)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                },
              }, 'Confirm Rebuild'),
              React.createElement('button', {
                onClick: () => this.setState({ resetIndexConfirming: false }),
                style: {
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'var(--nxai-card-bg)',
                  border: '1px solid var(--nxai-card-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--nxai-card-text)',
                },
              }, 'Cancel'),
            ),
          )
        : null,
    );
  }

  renderResetAll(): React.ReactNode {
    const { resetAllConfirming, resetAllRunning } = this.state;

    return React.createElement('div', {
      style: {
        marginBottom: 16,
        padding: 16,
        background: '#fffdf7',
        border: '1px solid #fde68a',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
      },
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', {
            style: { fontSize: 14, fontWeight: 600, color: '#b45309', marginBottom: 6 },
          }, 'Rebuild what Nexus knows'),
          React.createElement('div', {
            style: { fontSize: 12, color: '#4b5563', marginBottom: 4 },
          }, 'Keeps your connections and settings. Throws away everything Nexus worked out about your sites and reads all 367 again from scratch.'),
          React.createElement('div', {
            style: { fontSize: 12, color: '#b45309' },
          }, 'About 30 minutes · Nexus cannot answer questions about your fleet until it finishes'),
        ),
        React.createElement('button', {
          disabled: resetAllRunning,
          onClick: () => {
            if (resetAllConfirming) {
              if (confirm('This will delete all graph and vector data then run a full sync. Continue?')) {
                this.handleResetAll();
              }
            } else {
              this.setState({ resetAllConfirming: true });
            }
          },
          style: {
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 4,
            cursor: resetAllRunning ? 'not-allowed' : 'pointer',
            color: '#b45309',
            opacity: resetAllRunning ? 0.6 : 1,
          },
        }, resetAllRunning ? 'Rebuilding...' : 'Rebuild everything'),
      ),
    );
  }

  renderFactoryReset(): React.ReactNode {
    const { factoryResetConfirming, factoryResetRunning, factoryResetTyped } = this.state;

    return React.createElement('div', {
      style: {
        marginBottom: 16,
        padding: 16,
        background: '#fff5f5',
        border: '1px solid #fecaca',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
      },
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', {
            style: { fontSize: 14, fontWeight: 600, color: '#ef4444', marginBottom: 6 },
          }, 'Start over'),
          React.createElement('div', {
            style: { fontSize: 12, color: '#4b5563', marginBottom: 4 },
          }, 'Keeps your connections. Forgets everything else, restores every setting on this page to its default and restarts Local.'),
          React.createElement('div', {
            style: { fontSize: 12, color: '#ef4444' },
          }, 'Restarts Local · nothing is rebuilt until you ask it to be'),
        ),
        React.createElement('button', {
          disabled: factoryResetRunning,
          onClick: () => this.setState({ factoryResetConfirming: !factoryResetConfirming }),
          style: {
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            cursor: factoryResetRunning ? 'not-allowed' : 'pointer',
            color: '#ef4444',
            opacity: factoryResetRunning ? 0.6 : 1,
          },
        }, factoryResetRunning ? 'Resetting...' : 'Start over'),
      ),

      factoryResetConfirming && !factoryResetRunning
        ? React.createElement('div', {
            style: {
              marginTop: 12,
              padding: 12,
              background: 'rgba(239,68,68,0.05)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 4,
            },
          },
            React.createElement('div', {
              style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 10 },
            }, 'This will delete all Nexus AI data except your connections. Type "start over" to confirm:'),
            React.createElement('input', {
              type: 'text',
              value: factoryResetTyped,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                this.setState({ factoryResetTyped: e.target.value }),
              placeholder: 'start over',
              style: {
                width: '100%',
                padding: '6px 10px',
                fontSize: 12,
                border: '1px solid var(--nxai-input-border)',
                background: 'var(--nxai-input-bg)',
                borderRadius: 4,
                marginBottom: 10,
                color: 'var(--nxai-card-text)',
              },
            }),
            React.createElement('div', { style: { display: 'flex', gap: 8 } },
              React.createElement('button', {
                disabled: factoryResetTyped.toLowerCase() !== 'start over',
                onClick: this.handleFactoryReset,
                style: {
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: factoryResetTyped.toLowerCase() === 'start over' ? '#ef4444' : '#ccc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: factoryResetTyped.toLowerCase() === 'start over' ? 'pointer' : 'not-allowed',
                  opacity: factoryResetTyped.toLowerCase() === 'start over' ? 1 : 0.5,
                },
              }, 'Confirm Reset'),
              React.createElement('button', {
                onClick: () => this.setState({ factoryResetConfirming: false, factoryResetTyped: '' }),
                style: {
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'var(--nxai-card-bg)',
                  border: '1px solid var(--nxai-card-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--nxai-card-text)',
                },
              }, 'Cancel'),
            ),
          )
        : null,
    );
  }
}
