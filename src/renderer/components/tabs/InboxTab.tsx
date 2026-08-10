// src/renderer/components/tabs/InboxTab.tsx
import * as React from 'react';
import type { InboxItem, InboxKind } from '../../../main/inbox/types';

export interface InboxTabProps {
  loaded: boolean;
  failed: boolean;
  items: InboxItem[];
  total: number;
  counts: Record<InboxKind, number>;
  /** Agent ids currently auto-paused, from GET_INBOX. */
  pausedSources: string[];
  onDecide: (id: number, decision: string, status: 'dismissed' | 'done') => void;
  onReopen: (id: number) => void;
  /** Clear an agent's auto-pause so it may run automatically again. */
  onResumeAgent: (agentId: string) => void;
  onRetry?: () => void;
}

const GROUPS: Array<{ kind: InboxKind; title: string }> = [
  { kind: 'decide',  title: 'Needs a decision' },
  { kind: 'problem', title: 'Something is stuck' },
  { kind: 'know',    title: 'Worth knowing' },
];

export class InboxTab extends React.Component<InboxTabProps> {
  private renderItem(item: InboxItem): React.ReactElement {
    const { onDecide, onReopen, pausedSources, onResumeAgent } = this.props;
    const isPaused = pausedSources.includes(item.source);

    return React.createElement('div', {
      key: item.id,
      style: {
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 10,
        background: 'var(--nxai-card-bg)',
        padding: '14px 16px',
        marginBottom: 10,
      },
    },
      React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--nxai-card-text)' } }, item.title),
      item.detail && React.createElement('div', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', marginTop: 4 } }, item.detail),

      // scope is always a labelled string, never a bare number
      React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginTop: 6 } },
        `${item.scopeLabel} · ${item.source}`,
        item.seenCount > 1 ? ` · seen ${item.seenCount} times` : '',
      ),

      isPaused && React.createElement('div', {
        style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginTop: 4, fontStyle: 'italic' }
      }, `Agent paused after repeated failures`),

      item.evidence && React.createElement('details', { style: { marginTop: 8 } },
        React.createElement('summary', { style: { fontSize: 12.5, color: 'var(--nxai-card-sub)', cursor: 'pointer' } }, 'Evidence'),
        React.createElement('pre', { style: { fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--nxai-card-sub)' } }, item.evidence),
      ),

      // "Reopen" reverses the DECISION, never a live change — see Global Constraints.
      item.status === 'open'
        ? React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
            isPaused
              ? React.createElement('button', { onClick: () => onResumeAgent(item.source) }, 'Try again')
              : React.createElement(React.Fragment, null,
                  React.createElement('button', { onClick: () => onDecide(item.id, 'Approve', 'done') }, 'Approve'),
                  React.createElement('button', { onClick: () => onDecide(item.id, 'Not now', 'dismissed') }, 'Not now'),
                ),
          )
        : React.createElement('button', { style: { marginTop: 12 }, onClick: () => onReopen(item.id) }, 'Reopen'),
    );
  }

  render() {
    const { loaded, failed, items, total, onRetry } = this.props;

    // Order matters: a failed read must never fall through to the empty state.
    // "Nothing needs you" when we simply could not look is the worst thing this
    // surface can say.
    if (failed) {
      return React.createElement('div', { style: { padding: 24, color: 'var(--nxai-card-text)' } },
        React.createElement('div', null, "Couldn't read the inbox."),
        onRetry && React.createElement('button', { onClick: onRetry, style: { marginTop: 12 } }, 'Try again'),
      );
    }
    if (!loaded) {
      return React.createElement('div', { style: { padding: 24, color: 'var(--nxai-card-sub)' } }, 'Loading…');
    }
    if (items.length === 0) {
      return React.createElement('div', { style: { padding: 24, color: 'var(--nxai-card-sub)' } },
        'Nothing needs you right now.');
    }

    const groups = GROUPS
      .map(g => ({ ...g, rows: items.filter(i => i.kind === g.kind) }))
      .filter(g => g.rows.length > 0);   // an empty group is not rendered

    return React.createElement('div', { style: { padding: '0 0 24px' } },
      items.length < total && React.createElement('div', {
        style: { fontSize: 12.5, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, `Showing ${items.length} of ${total}`),

      ...groups.map(g => React.createElement('div', { key: g.kind, style: { marginBottom: 24 } },
        React.createElement('div', {
          style: { fontSize: 13, fontWeight: 700, color: 'var(--nxai-card-text)', marginBottom: 10 },
        }, `${g.title} · ${g.rows.length}`),
        ...g.rows.map(r => this.renderItem(r)),
      )),
    );
  }
}
