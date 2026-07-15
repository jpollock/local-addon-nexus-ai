import * as React from 'react';

export interface GenericApproval {
  id: string;
  title: string;
  meta: string;
  desc: string;
  actions: string[];
  reversible: string;
}

interface DrawerProps {
  approval: GenericApproval | null;
  onDismiss: () => void;
  onApprove: () => void;
}

export class GenericApprovalDrawer extends React.Component<DrawerProps> {
  render() {
    const { approval, onDismiss, onApprove } = this.props;

    if (!approval) return null;

    return React.createElement('div', null,
      // Scrim
      React.createElement('div', {
        onClick: onDismiss,
        style: {
          position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.55)',
          zIndex: 40,
        },
      }),

      // Drawer
      React.createElement('div', {
        style: {
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 560,
          background: 'var(--ag-bg-card)', borderLeft: '1px solid var(--ag-border)',
          zIndex: 41, display: 'flex', flexDirection: 'column',
          animation: 'slideIn 0.28s ease',
        },
      },
        // Header
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'flex-start', gap: 16, padding: '24px 24px 20px', borderBottom: '1px solid var(--ag-border-subtle)' },
        },
          React.createElement('button', {
            onClick: onDismiss,
            style: { background: 'none', border: 'none', color: 'var(--ag-text-secondary)', cursor: 'pointer', fontSize: 18, padding: 0, flexShrink: 0 },
          }, '✕'),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 17, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 4 } }, approval.title),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)' } }, approval.meta),
          ),
        ),

        // Body
        React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: 24 } },
          React.createElement('p', { style: { fontSize: 13.5, color: 'var(--ag-text-secondary)', lineHeight: 1.6, margin: '0 0 20px' } }, approval.desc),

          React.createElement('div', { style: { marginBottom: 20 } },
            React.createElement('div', { style: { fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 10 } }, 'Proposed actions'),
            React.createElement('div', {
              style: { background: 'var(--ag-bg-code)', borderRadius: 8, padding: '14px 16px' },
            },
              ...approval.actions.map((action, i) =>
                React.createElement('div', {
                  key: i,
                  style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', fontFamily: 'JetBrains Mono, monospace', marginBottom: i < approval.actions.length - 1 ? 6 : 0 },
                }, `$ ${action}`),
              ),
            ),
          ),

          React.createElement('div', {
            style: { background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--ag-green)' },
          }, `✓ Reversible. ${approval.reversible}`),
        ),

        // Footer
        React.createElement('div', {
          style: { display: 'flex', gap: 10, padding: '16px 24px', borderTop: '1px solid var(--ag-border-subtle)' },
        },
          React.createElement('button', {
            onClick: onDismiss,
            style: {
              flex: 1, background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
              borderRadius: 8, padding: '10px 0', fontSize: 13.5, fontWeight: 500,
              color: 'var(--ag-text-secondary)', cursor: 'pointer',
            },
          }, 'Dismiss'),
          React.createElement('button', {
            onClick: onApprove,
            style: {
              flex: 2, background: 'var(--ag-teal)', border: 'none',
              borderRadius: 8, padding: '10px 0', fontSize: 13.5, fontWeight: 600,
              color: 'var(--ag-on-teal)', cursor: 'pointer',
            },
          }, 'Approve & run'),
        ),
      ),
    );
  }
}
