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
  /** Recently decided items (dismissed or done), for Reopen. */
  recentlyDecided: InboxItem[];
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
    const { onDecide, onReopen } = this.props;

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

      item.evidence && React.createElement('details', { style: { marginTop: 8 } },
        React.createElement('summary', { style: { fontSize: 12.5, color: 'var(--nxai-card-sub)', cursor: 'pointer' } }, 'Evidence'),
        React.createElement('pre', { style: { fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--nxai-card-sub)' } }, item.evidence),
      ),

      // "Reopen" reverses the DECISION, never a live change — see Global Constraints.
      // For open items, always show decide actions — the pause banner is per-agent, not per-item.
      item.status === 'open'
        ? React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
            React.createElement('button', { onClick: () => onDecide(item.id, 'Approve', 'done') }, 'Approve'),
            React.createElement('button', { onClick: () => onDecide(item.id, 'Not now', 'dismissed') }, 'Not now'),
          )
        : React.createElement('button', { style: { marginTop: 12 }, onClick: () => onReopen(item.id) }, 'Reopen'),
    );
  }

  private renderPausedBanner(agentName: string): React.ReactElement {
    const { onResumeAgent } = this.props;
    return React.createElement('div', {
      key: `pause-banner-${agentName}`,
      style: {
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 10,
        background: 'var(--nxai-card-bg)',
        padding: '12px 16px',
        marginBottom: 10,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      },
    },
      React.createElement('div', {
        style: { fontSize: 13, color: 'var(--nxai-card-sub)', fontStyle: 'italic' },
      }, `${agentName} paused after repeated failures`),
      React.createElement('button', { onClick: () => onResumeAgent(agentName) }, 'Try again'),
    );
  }

  render() {
    const { loaded, failed, items, total, recentlyDecided, pausedSources, onRetry } = this.props;

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
    // A paused agent counts as needing you even with an empty queue — it is the
    // only place the pause can be cleared, and nothing else clears it. Returning
    // the all-clear here would strand exactly the case this banner exists for:
    // agent paused, its failure item already dismissed, nothing left on screen.
    if (items.length === 0 && recentlyDecided.length === 0 && pausedSources.length === 0) {
      return React.createElement('div', { style: { padding: 24, color: 'var(--nxai-card-sub)' } },
        'Nothing needs you right now.');
    }

    const groups = GROUPS
      .map(g => ({ ...g, rows: items.filter(i => i.kind === g.kind) }))
      .filter(g => g.rows.length > 0);   // an empty group is not rendered

    return React.createElement('div', { style: { padding: '0 0 24px' } },
      // Paused-agent banners come from `pausedSources` DIRECTLY, above the groups —
      // never from the items on screen. An agent pauses precisely when it keeps
      // failing, and the user may well have dismissed its failure item, leaving it
      // with zero open items. Deriving the banner from `items` meant that agent got
      // no "Try again" and nothing else clears `_autoPausedAt`, so it stayed
      // silently disabled forever. `items` is also only one page, so a paused agent
      // beyond the first INBOX_PAGE_SIZE rows would have been missed too.
      // One banner per paused agent, whatever it does or does not have in the queue.
      ...pausedSources.map(agent => this.renderPausedBanner(agent)),

      items.length < total && React.createElement('div', {
        style: { fontSize: 12.5, color: 'var(--nxai-card-sub)', marginBottom: 12 },
      }, `Showing ${items.length} of ${total}`),

      ...groups.map(g => React.createElement('div', { key: g.kind, style: { marginBottom: 24 } },
        React.createElement('div', {
          style: { fontSize: 13, fontWeight: 700, color: 'var(--nxai-card-text)', marginBottom: 10 },
        }, `${g.title} · ${g.rows.length}`),
        ...g.rows.map(r => this.renderItem(r)),
      )),

      // Recently decided items — visually quieter, below the open groups
      recentlyDecided.length > 0 && React.createElement('div', { style: { marginTop: 32, borderTop: '1px solid var(--nxai-card-border)', paddingTop: 16 } },
        React.createElement('div', {
          style: { fontSize: 12.5, fontWeight: 600, color: 'var(--nxai-card-sub)', marginBottom: 10 },
        }, `Recently decided · ${recentlyDecided.length}`),
        ...recentlyDecided.map(r => this.renderItem(r)),
      ),
    );
  }
}
