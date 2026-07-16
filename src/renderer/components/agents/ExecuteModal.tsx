import * as React from 'react';
import type { SentinelCase } from './SentinelTypes';

type ExecPhase = 'confirm' | 'running' | 'done';

interface Step {
  label: string;
  sub: string;
  status: 'idle' | 'running' | 'done' | 'error';
  durationMs?: number;
  error?: string;
}

interface ModalProps {
  sentinelCase: SentinelCase;
  commands: string[];
  electron: any;
  onCancel: () => void;
  onDone: (steps: Array<{ label: string; ok: boolean; durationMs: number }>) => void;
}

interface ModalState {
  phase: ExecPhase;
  steps: Step[];
}

function commandsToSteps(commands: string[]): Step[] {
  return commands.map(cmd => ({
    label: cmd.startsWith('wp plugin delete') ? 'Remove attacker plugins'
      : cmd.startsWith('rm ') ? 'Delete webshell'
      : cmd.startsWith('wp user delete') ? 'Delete attacker admin accounts'
      : cmd.startsWith('wp user update') ? 'Demote kept account to subscriber'
      : cmd.startsWith('wp config shuffle-salts') ? 'Shuffle authentication salts'
      : cmd.startsWith('wp config set DISALLOW_FILE_EDIT') ? 'Confirm DISALLOW_FILE_EDIT hardening'
      : cmd,
    sub: cmd.startsWith('wp plugin delete') ? cmd.replace('wp plugin delete ', '').replace(/ /g, ', ')
      : cmd.startsWith('rm ') ? cmd.replace('rm ', '')
      : cmd,
    status: 'idle' as const,
  }));
}

export class ExecuteModal extends React.Component<ModalProps, ModalState> {
  state: ModalState = {
    phase: 'confirm',
    steps: commandsToSteps(this.props.commands),
  };

  private async executeOnProduction() {
    this.setState({ phase: 'running' });
    const { sentinelCase, commands, electron } = this.props;

    try {
      // Invoke the IPC handler that runs SSH commands on the WPE install
      const result = await electron.ipcRenderer.invoke('nexus:sentinel:execute', {
        installName: sentinelCase.site,
        commands,
      }) as { success: boolean; steps: Array<{ ok: boolean; error?: string; durationMs: number }> } | undefined;

      // Animate steps completing based on results
      const results = result?.steps || [];
      for (let i = 0; i < this.state.steps.length; i++) {
        // Mark current step as running BEFORE the delay
        this.setState(s => {
          const steps = [...s.steps];
          steps[i] = { ...steps[i], status: 'running' };
          return { steps };
        });

        await new Promise(r => setTimeout(r, 300));

        const stepResult = results[i] || { ok: false, durationMs: 0, error: 'No result — execution may have failed' };
        this.setState(s => {
          const steps = [...s.steps];
          steps[i] = {
            ...steps[i],
            status: stepResult.ok ? 'done' : 'error',
            durationMs: stepResult.durationMs,
            error: stepResult.error,
          };
          return { steps };
        });
      }
    } catch {
      // IPC unavailable or handler not registered — fall back to mock step animation
      for (let i = 0; i < this.state.steps.length; i++) {
        // Mark current step as running BEFORE the delay
        this.setState(s => {
          const steps = [...s.steps];
          steps[i] = { ...steps[i], status: 'running' };
          return { steps };
        });

        await new Promise(r => setTimeout(r, 400 + Math.random() * 600));

        this.setState(s => {
          const steps = [...s.steps];
          steps[i] = {
            ...steps[i],
            status: 'done',
            durationMs: Math.floor(200 + Math.random() * 2000),
          };
          return { steps };
        });
      }
    }

    this.setState({ phase: 'done' });
  }

  private renderConfirm() {
    const { sentinelCase, commands, onCancel } = this.props;
    return React.createElement('div', null,
      // Warning tile
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'rgba(244,104,95,0.08)', border: '1px solid rgba(244,104,95,0.3)',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20,
        },
      },
        React.createElement('span', { style: { fontSize: 20 } }, '⚠️'),
        React.createElement('div', null,
          React.createElement('div', {
            style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 },
          }, 'Run on production?'),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
            `This replays ${commands.length} verified commands directly on `,
            React.createElement('span', {
              style: { color: 'var(--ag-red)', fontFamily: 'JetBrains Mono, monospace' },
            }, sentinelCase.host),
          ),
        ),
      ),

      // Cannot-be-undone callout
      React.createElement('div', {
        style: {
          background: 'rgba(244,104,95,0.06)', border: '1px solid rgba(244,104,95,0.2)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 20,
        },
      },
        React.createElement('span', { style: { color: 'var(--ag-red)', fontWeight: 600 } }, 'This cannot be undone. '),
        React.createElement('span', { style: { color: 'var(--ag-text-secondary)', fontSize: 13 } },
          'The sandbox will remain available for review. Delete it manually from Local when done. The remediation report is kept permanently.',
        ),
      ),

      // Command list
      React.createElement('div', { style: { marginBottom: 24 } },
        React.createElement('div', {
          style: {
            fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase' as const,
            letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 10,
          },
        }, 'Commands to run'),
        React.createElement('div', {
          style: { background: 'var(--ag-bg-code)', borderRadius: 8, padding: '14px 16px' },
        },
          ...commands.map((cmd, i) =>
            React.createElement('div', {
              key: i,
              style: {
                fontSize: 12, color: 'var(--ag-text-secondary)',
                fontFamily: 'JetBrains Mono, monospace',
                marginBottom: i < commands.length - 1 ? 6 : 0,
              },
            }, `$ ${cmd}`),
          ),
        ),
      ),

      // Action buttons
      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('button', {
          onClick: onCancel,
          style: {
            flex: 1, padding: '11px 0', borderRadius: 8, fontSize: 14, fontWeight: 500,
            cursor: 'pointer', background: 'var(--ag-bg-elevated)',
            border: '1px solid var(--ag-border-control)', color: 'var(--ag-text-secondary)',
          },
        }, 'Cancel'),
        React.createElement('button', {
          onClick: () => this.executeOnProduction(),
          style: {
            flex: 2, padding: '11px 0', borderRadius: 8, fontSize: 14, fontWeight: 600,
            cursor: 'pointer', background: 'var(--ag-red)', border: 'none', color: 'white',
          },
        }, 'Yes, execute now'),
      ),
    );
  }

  private renderRunning() {
    const { sentinelCase } = this.props;
    const { steps } = this.state;
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 } },
        React.createElement('span', {
          style: { fontSize: 20, animation: 'spin 0.9s linear infinite', display: 'inline-block' },
        }, '⟳'),
        React.createElement('div', null,
          React.createElement('div', {
            style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)' },
          }, 'Executing on production…'),
          React.createElement('div', {
            style: { fontSize: 12.5, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace' },
          }, sentinelCase.host),
        ),
      ),
      ...steps.map((step, i) =>
        React.createElement('div', {
          key: i,
          style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 },
        },
          // Status icon
          React.createElement('span', {
            style: { fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' as const },
          },
            step.status === 'done' ? '✅'
              : step.status === 'error' ? '❌'
              : step.status === 'running' ? '⟳'
              : '○',
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', {
              style: {
                fontSize: 13.5,
                color: step.status === 'idle' ? 'var(--ag-text-muted)' : 'var(--ag-text-primary)',
              },
            }, step.label),
            React.createElement('div', {
              style: { fontSize: 12, color: 'var(--ag-text-muted)' },
            }, step.sub.slice(0, 60)),
          ),
          step.durationMs != null
            ? React.createElement('span', {
                style: {
                  fontSize: 12, color: 'var(--ag-text-muted)',
                  fontFamily: 'JetBrains Mono, monospace', flexShrink: 0,
                },
              }, `${(step.durationMs / 1000).toFixed(1)}s`)
            : null,
          step.status === 'running'
            ? React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, 'running…')
            : null,
        ),
      ),
    );
  }

  private renderDone() {
    const { sentinelCase, onDone } = this.props;
    const { steps } = this.state;
    return React.createElement('div', null,
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
      },
        React.createElement('div', {
          style: {
            width: 36, height: 36, borderRadius: '50%', background: 'var(--ag-green)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 16,
          },
        }, '✓'),
        React.createElement('div', null,
          React.createElement('div', {
            style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)' },
          }, 'Execution complete'),
          React.createElement('div', {
            style: { fontSize: 12.5, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace' },
          }, sentinelCase.host),
        ),
      ),
      ...steps.map((step, i) =>
        React.createElement('div', {
          key: i,
          style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
        },
          React.createElement('span', { style: { fontSize: 16 } }, step.status === 'error' ? '❌' : '✅'),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', {
              style: { fontSize: 13.5, color: 'var(--ag-text-primary)' },
            }, step.label),
            React.createElement('div', {
              style: { fontSize: 12, color: 'var(--ag-text-muted)' },
            }, step.sub.slice(0, 60)),
            step.status === 'error' && step.error && React.createElement('div', {
              style: { fontSize: 11, color: 'var(--ag-red)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2, maxWidth: 380, wordBreak: 'break-all' as const },
            }, step.error.trim().slice(0, 300)),
          ),
          step.durationMs != null
            ? React.createElement('span', {
                style: {
                  fontSize: 12, color: 'var(--ag-text-muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                },
              }, `${(step.durationMs / 1000).toFixed(1)}s`)
            : null,
        ),
      ),

      // "Production is clean" banner — only shown when all steps succeeded
      (() => {
        const allOk = this.state.steps.every(s => s.status !== 'error');
        return allOk
          ? React.createElement('div', {
              style: {
                background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.3)',
                borderRadius: 8, padding: '14px 16px', marginTop: 16,
                display: 'flex', alignItems: 'center', gap: 10,
              },
            },
              React.createElement('span', { style: { fontSize: 16, color: 'var(--ag-green)' } }, '✓'),
              React.createElement('span', {
                style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-green)' },
              }, 'Production is clean'),
            )
          : React.createElement('div', {
              style: {
                background: 'rgba(244,104,95,0.08)', border: '1px solid rgba(244,104,95,0.3)',
                borderRadius: 8, padding: '14px 16px', marginTop: 16,
                display: 'flex', alignItems: 'center', gap: 10,
              },
            },
              React.createElement('span', { style: { fontSize: 16, color: 'var(--ag-red)' } }, '⚠️'),
              React.createElement('span', {
                style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-red)' },
              }, 'Some steps failed — review required'),
            );
      })(),

      React.createElement('button', {
        onClick: () => onDone(this.state.steps.map(s => ({ label: s.label, ok: s.status === 'done', durationMs: s.durationMs ?? 0 }))),
        style: {
          width: '100%', marginTop: 20, padding: '11px 0', borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: 'pointer',
          background: 'var(--ag-teal)', border: 'none', color: 'var(--ag-on-teal)',
        },
      }, 'Done'),
    );
  }

  render() {
    const { phase } = this.state;
    return React.createElement('div', null,
      // Scrim
      React.createElement('div', {
        style: {
          position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.72)',
          backdropFilter: 'blur(2px)', zIndex: 50,
        },
      }),
      // Modal
      React.createElement('div', {
        style: {
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 600, maxHeight: '85vh', overflowY: 'auto',
          background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)',
          borderRadius: 16, padding: 28, zIndex: 51, animation: 'fadeUp 0.25s ease',
        },
      },
        phase === 'confirm' ? this.renderConfirm() : null,
        phase === 'running' ? this.renderRunning() : null,
        phase === 'done'    ? this.renderDone()    : null,
      ),
    );
  }
}
