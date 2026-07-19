import * as React from 'react';
import type { SentinelCase, RemediationStep, Finding, AdminAccount } from './SentinelTypes';

export type AccountDecisionMap = Record<string, {
  decision: 'delete' | 'keep' | null;
  keepReason: string;
}>;

interface OverlayProps {
  sentinelCase: SentinelCase;
  onDismiss: () => void;
  onExecute: (decisions: AccountDecisionMap) => void;
  mode?: 'full' | 'panel';
}

interface OverlayState {
  mode: 'full' | 'panel';
  expandedStep: number | null;
  decisions: AccountDecisionMap;
  showSignalIds: boolean;
}

const SEV_COLORS: Record<string, string> = {
  critical: '#f4685f',
  high:     '#f5b544',
  medium:   '#9aa1ac',
};

const BY_CHIP: Record<string, { label: string; color: string; bg: string }> = {
  agent: { label: 'agent',        color: '#35d0c5', bg: 'rgba(53,208,197,0.14)' },
  wpe:   { label: 'WPE platform', color: '#7b8cff', bg: 'rgba(123,140,255,0.14)' },
};

export class SentinelReviewOverlay extends React.Component<OverlayProps, OverlayState> {
  state: OverlayState = {
    mode: this.props.mode || 'full',
    expandedStep: null,
    decisions: {},
    showSignalIds: false,
  };

  private getAccountDecision(accountId: string) {
    return this.state.decisions[accountId] || { decision: null, keepReason: '' };
  }

  private setAccountDecision(accountId: string, decision: 'delete' | 'keep' | null, keepReason?: string) {
    this.setState(s => ({
      decisions: {
        ...s.decisions,
        [accountId]: { decision, keepReason: keepReason ?? s.decisions[accountId]?.keepReason ?? '' },
      },
    }));
  }

  private allResolved(): boolean {
    const { sentinelCase } = this.props;
    const reviewRequired = sentinelCase.accounts.filter(a => !a.autoDeleted && !a.legitimate);
    return reviewRequired.every(a => {
      const d = this.state.decisions[a.id];
      if (!d || d.decision === null) return false;
      if (d.decision === 'keep' && !d.keepReason.trim()) return false;
      return true;
    });
  }

  private canExecute(): boolean {
    return this.allResolved() && this.props.sentinelCase.verdict === 'ready';
  }

  private getFooterNote(): string {
    const { sentinelCase } = this.props;
    if (sentinelCase.verdict === 'blocked') {
      return `Execution is blocked — ${sentinelCase.failedSteps} step(s) failed verification.`;
    }
    const unresolved = sentinelCase.accounts.filter(a => !a.autoDeleted && !a.legitimate)
      .filter(a => !this.state.decisions[a.id]?.decision).length;
    if (unresolved > 0) {
      return `${unresolved} account${unresolved !== 1 ? 's' : ''} still need a decision before you can execute.`;
    }
    const cmdCount = this.generateCommands().length;
    return `All accounts resolved. ${cmdCount} commands will run on ${sentinelCase.host}.`;
  }

  private generateCommands(): string[] {
    const { sentinelCase } = this.props;
    const { decisions } = this.state;
    const cmds: string[] = [];

    // Plugin removal
    const pluginSlugs = ['fileorganizer', 'filester', 'wp-compat', 'file-manager-advanced',
      'noted', 'woocommerce-conversion-tracking', 'wp-file-manager'];
    cmds.push(`wp plugin delete ${pluginSlugs.join(' ')}`);

    // Webshell removal
    cmds.push('rm wp-content/mu-plugins/index.php');

    // User deletion / demotion
    const toDelete = sentinelCase.accounts
      .filter(a => a.autoDeleted || decisions[a.id]?.decision === 'delete')
      .map(a => a.uid)
      .filter(Boolean);
    if (toDelete.length > 0) {
      cmds.push(`wp user delete ${toDelete.join(' ')} --reassign=1`);
    }
    for (const a of sentinelCase.accounts.filter(a => decisions[a.id]?.decision === 'keep')) {
      cmds.push(`wp user update ${a.uid} --role=subscriber  # ${a.user} — kept per decision`);
    }

    // Hardening
    cmds.push('wp config shuffle-salts');
    cmds.push('wp config set DISALLOW_FILE_EDIT true --raw');

    return cmds;
  }

  private renderHeader() {
    const { sentinelCase, onDismiss } = this.props;
    const { mode } = this.state;
    return React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 16, padding: '20px 32px',
        borderBottom: '1px solid var(--ag-border-subtle)', flexShrink: 0,
      },
    },
      React.createElement('button', {
        onClick: onDismiss,
        style: { background: 'none', border: 'none', color: 'var(--ag-text-secondary)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 },
      }, '‹ Back'),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 } },
          React.createElement('span', { style: { fontSize: 17, fontWeight: 600, color: 'var(--ag-text-primary)' } }, sentinelCase.site),
          React.createElement('span', {
            style: { fontSize: 10, fontWeight: 700, color: '#9aa1ac', background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border)', borderRadius: 5, padding: '2px 8px' },
          }, `${sentinelCase.env} · WPE`),
        ),
        React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } },
          `${sentinelCase.host} · detected ${new Date(sentinelCase.detectedAt).toLocaleString()}`,
        ),
      ),
      // View forensic report
      sentinelCase.reportPath
        ? React.createElement('button', {
            onClick: () => {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { shell } = require('electron');
              shell.openPath(sentinelCase.reportPath);
            },
            style: {
              background: 'none', border: '1px solid var(--ag-border)', borderRadius: 7,
              padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              color: 'var(--ag-text-secondary)',
            },
          }, '📄 View report')
        : null,
      // Layout toggle
      React.createElement('div', {
        style: { display: 'flex', background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border)', borderRadius: 8, padding: 3 },
      },
        (['full', 'panel'] as const).map(m =>
          React.createElement('button', {
            key: m, onClick: () => this.setState({ mode: m }),
            style: {
              padding: '4px 12px', borderRadius: 5, border: 'none', fontSize: 12, cursor: 'pointer',
              background: mode === m ? 'var(--ag-teal)' : 'transparent',
              color: mode === m ? 'var(--ag-on-teal)' : 'var(--ag-text-secondary)',
            },
          }, m === 'full' ? 'Full screen' : 'Side panel'),
        ),
      ),
    );
  }

  private renderVerdict() {
    const { verdict, failedSteps } = this.props.sentinelCase;
    const ready = verdict === 'ready';
    return React.createElement('div', {
      style: {
        margin: '0 0 24px', padding: '16px 22px', borderRadius: 12,
        background: ready ? 'rgba(62,207,142,0.08)' : 'rgba(244,104,95,0.08)',
        border: `1px solid ${ready ? 'rgba(62,207,142,0.35)' : 'rgba(244,104,95,0.35)'}`,
        display: 'flex', alignItems: 'center', gap: 14,
      },
    },
      React.createElement('span', { style: { fontSize: 20, color: ready ? 'var(--ag-green)' : 'var(--ag-red)' } }, ready ? '✓' : '!'),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 700, color: ready ? 'var(--ag-green)' : 'var(--ag-red)' } },
          ready ? 'READY TO PUSH' : `NOT SAFE TO PUSH — ${failedSteps} step(s) failed`,
        ),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginTop: 2 } },
          ready
            ? `All ${this.props.sentinelCase.steps.filter(s => s.ok).length} remediation steps passed verification on the sandbox.`
            : 'Fix the failed steps before executing on production.',
        ),
      ),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)', textAlign: 'right' } },
        'Verified on isolated\nlocal sandbox',
      ),
    );
  }

  private renderFindings() {
    const { findings } = this.props.sentinelCase;
    const crits = findings.filter(f => f.sev === 'critical');
    const highs = findings.filter(f => f.sev === 'high');
    const mediums = findings.filter(f => f.sev === 'medium');
    return React.createElement('div', { style: { marginBottom: 28 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 } },
        React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: 'var(--ag-text-primary)', margin: 0 } }, 'What the Sentinel found'),
        React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, `${findings.length} signals triggered this investigation`),
      ),
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
      },
        ...[...crits, ...highs, ...mediums].map(f => this.renderFindingCard(f)),
      ),
    );
  }

  private renderFindingCard(f: Finding) {
    const color = SEV_COLORS[f.sev] || '#9aa1ac';
    return React.createElement('div', {
      key: f.id,
      style: {
        background: `${color}09`, borderLeft: `3px solid ${color}`,
        borderRadius: '0 10px 10px 0', padding: '14px 16px',
      },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
        React.createElement('span', {
          style: { fontSize: 9.5, fontWeight: 700, color, background: `${color}20`, padding: '2px 7px', borderRadius: 4 },
        }, f.sev.toUpperCase()),
        React.createElement('span', {
          style: { fontSize: 10.5, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer' },
          onClick: () => this.setState(s => ({ showSignalIds: !s.showSignalIds })),
        }, this.state.showSignalIds ? f.id : ''),
      ),
      React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 5 } }, f.title),
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', lineHeight: 1.5 } }, f.plain),
    );
  }

  private renderChecklist() {
    const { steps } = this.props.sentinelCase;
    const { expandedStep } = this.state;
    return React.createElement('div', { style: { marginBottom: 28 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 } },
        React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: 'var(--ag-text-primary)', margin: 0 } }, 'Remediation plan'),
        // Legend
        React.createElement('div', { style: { display: 'flex', gap: 12, marginLeft: 'auto' } },
          (['agent', 'wpe'] as const).map(by =>
            React.createElement('span', {
              key: by,
              style: { fontSize: 11, color: BY_CHIP[by].color, background: BY_CHIP[by].bg, padding: '2px 8px', borderRadius: 5 },
            }, BY_CHIP[by].label),
          ),
        ),
      ),
      React.createElement('div', {
        style: { background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12, overflow: 'hidden' },
      },
        ...steps.map((step, i) => this.renderStep(step, i, expandedStep, steps.length)),
      ),
    );
  }

  private renderStep(step: RemediationStep, i: number, expandedStep: number | null, total: number) {
    // total reserved for Task 3 border/divider logic
    const isExpanded = expandedStep === step.n;
    const byChip = BY_CHIP[step.by];
    const statusIcon = step.ok ? '✅' : step.deferred ? '⚪' : '❌';

    return React.createElement('div', { key: step.n },
      React.createElement('div', {
        onClick: () => this.setState({ expandedStep: isExpanded ? null : step.n }),
        style: {
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
          borderTop: i > 0 ? '1px solid var(--ag-border-subtle)' : 'none',
          cursor: 'pointer',
        },
      },
        React.createElement('span', { style: { fontSize: 16, flexShrink: 0 } }, statusIcon),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, `Step ${step.n} ·`),
            React.createElement('span', { style: { fontSize: 13.5, fontWeight: 500, color: 'var(--ag-text-primary)' } }, step.title),
          ),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginTop: 3 } }, step.action.slice(0, 80)),
        ),
        React.createElement('span', {
          style: { fontSize: 10.5, color: byChip.color, background: byChip.bg, padding: '2px 8px', borderRadius: 5, flexShrink: 0 },
        }, byChip.label),
        step.review && React.createElement('span', {
          style: { fontSize: 10.5, color: 'var(--ag-amber)', background: 'rgba(245,181,68,0.14)', padding: '2px 8px', borderRadius: 5, flexShrink: 0 },
        }, 'REVIEW REQUIRED'),
        React.createElement('span', {
          style: { fontSize: 12, color: 'var(--ag-text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' },
        }, '▾'),
      ),
      isExpanded && React.createElement('div', {
        style: { padding: '10px 18px 14px 54px', background: 'var(--ag-bg-inset)', borderTop: '1px solid var(--ag-border-subtle)' },
      },
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } }, `Verified: ${step.proof}`),
      ),
    );
  }

  private renderAccounts() {
    const { accounts } = this.props.sentinelCase;
    const reviewRequired = accounts.filter(a => !a.autoDeleted && !a.legitimate);
    if (reviewRequired.length === 0) return null;

    const unresolved = reviewRequired.filter(a => !this.state.decisions[a.id]?.decision).length;
    const allDone = unresolved === 0;

    return React.createElement('div', { style: { marginBottom: 28 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 } },
        React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: 'var(--ag-text-primary)', margin: 0 } }, 'Accounts needing your decision'),
        React.createElement('span', {
          style: {
            fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
            background: allDone ? 'rgba(62,207,142,0.14)' : 'rgba(245,181,68,0.14)',
            color: allDone ? 'var(--ag-green)' : 'var(--ag-amber)',
          },
        }, allDone ? 'All resolved' : `${unresolved} pending`),
      ),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        ...reviewRequired.map(a => this.renderAccountCard(a)),
      ),
    );
  }

  private renderAccountCard(account: AdminAccount) {
    const { id, user, email, score, breakdown, staged } = account;
    const dec = this.state.decisions[id] || { decision: null, keepReason: '' };
    const { decision, keepReason } = dec;

    const borderColor = decision === 'delete' ? 'rgba(244,104,95,0.4)'
      : decision === 'keep' ? 'rgba(62,207,142,0.4)' : 'rgba(245,181,68,0.3)';
    const bgColor = decision === 'delete' ? 'rgba(244,104,95,0.05)'
      : decision === 'keep' ? 'rgba(62,207,142,0.05)' : 'transparent';

    // Score bar color
    const barColor = score >= 80 ? 'var(--ag-red)' : score >= 50 ? 'var(--ag-amber)' : 'var(--ag-green)';

    return React.createElement('div', {
      key: id,
      style: {
        background: `var(--ag-bg-card) ${bgColor}`, border: `1px solid ${borderColor}`,
        borderRadius: 12, padding: '18px 20px', transition: 'border-color 0.15s, background 0.15s',
      },
    },
      // Top: username + staged info
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 14 } },
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 3 } }, user),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
            `${email || '(no email)'} · ${staged}`,
          ),
        ),
      ),

      // Score bar
      React.createElement('div', { style: { marginBottom: 14 } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 5 } },
          React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, 'Suspicion score'),
          React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: barColor } }, `${score}/100`),
        ),
        React.createElement('div', {
          style: { height: 6, background: 'var(--ag-bg-elevated)', borderRadius: 3, overflow: 'hidden' },
        },
          React.createElement('div', { style: { height: '100%', width: `${score}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' } }),
        ),
        // Breakdown chips
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } },
          ...breakdown.map((b, i) =>
            React.createElement('span', {
              key: i,
              style: {
                fontSize: 11, color: 'var(--ag-red)', background: 'rgba(244,104,95,0.1)',
                padding: '2px 8px', borderRadius: 5,
              },
            }, `${b.t} ${b.pts}`),
          ),
        ),
      ),

      // Decision buttons
      React.createElement('div', { style: { display: 'flex', gap: 10 } },
        React.createElement('button', {
          onClick: () => this.setAccountDecision(id, decision === 'delete' ? null : 'delete'),
          style: {
            flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
            background: decision === 'delete' ? 'var(--ag-red)' : 'transparent',
            color: decision === 'delete' ? 'white' : 'var(--ag-red)',
            border: `1.5px solid var(--ag-red)`,
          },
        }, 'Delete account'),
        React.createElement('button', {
          onClick: () => this.setAccountDecision(id, decision === 'keep' ? null : 'keep'),
          style: {
            flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
            background: decision === 'keep' ? 'var(--ag-green)' : 'transparent',
            color: decision === 'keep' ? 'white' : 'var(--ag-green)',
            border: `1.5px solid var(--ag-green)`,
          },
        }, 'Keep account'),
      ),

      // Keep reason field (when keep is selected)
      decision === 'keep' && React.createElement('div', { style: { marginTop: 10 } },
        React.createElement('input', {
          type: 'text',
          placeholder: 'Required: reason for keeping this account',
          value: keepReason,
          onChange: (e: any) => this.setAccountDecision(id, 'keep', e.target.value),
          style: {
            width: '100%', background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border)',
            borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--ag-text-primary)',
            boxSizing: 'border-box',
          },
        }),
      ),

      // Decision status line
      decision && React.createElement('div', {
        style: { marginTop: 10, fontSize: 12.5, color: decision === 'delete' ? 'var(--ag-red)' : 'var(--ag-green)' },
      },
        decision === 'delete'
          ? 'Will be permanently deleted on production.'
          : keepReason ? `Will be kept — demotion reverted. Reason: ${keepReason}` : 'Add a reason above to confirm.',
      ),
    );
  }

  private renderFooter() {
    const canExec = this.canExecute();
    const note = this.getFooterNote();
    return React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 32px',
        borderTop: '1px solid var(--ag-border-subtle)', flexShrink: 0, background: 'var(--ag-bg-app)',
      },
    },
      React.createElement('div', { style: { flex: 1, fontSize: 13, color: 'var(--ag-text-muted)' } }, note),
      React.createElement('button', {
        onClick: () => canExec && this.props.onExecute(this.state.decisions),
        style: {
          background: canExec ? 'var(--ag-teal)' : 'var(--ag-bg-elevated)',
          color: canExec ? 'var(--ag-on-teal)' : 'var(--ag-text-faint)',
          border: 'none', borderRadius: 8, padding: '11px 24px',
          fontSize: 14, fontWeight: 600, cursor: canExec ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        },
      }, '▶ Execute plan on production'),
    );
  }

  render() {
    const { onDismiss, sentinelCase } = this.props;
    const { mode } = this.state;
    const isPanel = mode === 'panel';

    const content = React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--ag-bg-app)' },
    },
      this.renderHeader(),
      React.createElement('div', {
        style: { flex: 1, overflowY: 'auto', padding: '24px 32px' },
      },
        this.renderVerdict(),
        this.renderFindings(),
        this.renderChecklist(),
        this.renderAccounts(),
      ),
      this.renderFooter(),
    );

    if (isPanel) {
      return React.createElement('div', null,
        React.createElement('div', {
          onClick: onDismiss,
          style: { position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.55)', zIndex: 40 },
        }),
        React.createElement('div', {
          style: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 680, zIndex: 41, animation: 'slideIn 0.28s ease' },
        }, content),
      );
    }

    return React.createElement('div', {
      style: { position: 'fixed', inset: 0, background: 'var(--ag-bg-app)', zIndex: 40, display: 'flex', flexDirection: 'column' },
    }, content);
  }
}
