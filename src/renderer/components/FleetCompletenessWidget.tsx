/**
 * FleetCompletenessWidget
 *
 * Shows three progress bars (Scanned / Configured / Searchable).
 * Seeds nexusStore.fleetCompleteness on mount via FLEET_COMPLETENESS IPC, then
 * subscribes to the store — no setInterval polling.
 * Class-based, React.createElement only — no JSX, no hooks.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import type { FleetCompleteness } from '../../common/types';
import { nexusStore } from '../store/NexusStateManager';

interface FleetCompletenessWidgetProps {
  electron: any;
  onSchedule?: () => void;
  onIndexSites?: () => void;
}

interface FleetCompletenessWidgetState {
  data: FleetCompleteness | null;
  loading: boolean;
}

export class FleetCompletenessWidget extends React.Component<FleetCompletenessWidgetProps, FleetCompletenessWidgetState> {
  private mounted = false;
  private unsub?: () => void;

  state: FleetCompletenessWidgetState = { data: null, loading: true };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    // Seed the store with a fresh IPC call, then subscribe for future updates
    this.load();
    this.unsub = nexusStore.subscribe(() => {
      if (!this.mounted) return;
      const data = nexusStore.get().fleetCompleteness;
      this.setState({ data, loading: false });
    });
  }

  componentWillUnmount(): void {
    this.mounted = false;
    this.unsub?.();
  }

  async load(): Promise<void> {
    const data = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.FLEET_COMPLETENESS)
      .catch(() => null);
    if (!this.mounted) return;
    // Push to store — the subscription above will sync state
    nexusStore.update({ fleetCompleteness: data });
    // If graph.db wasn't ready yet (startup timing), retry after 5s
    if (data && !data.graphReady) {
      setTimeout(() => { if (this.mounted) this.load(); }, 5000);
    }
  }

  ago(ms: number | null): string {
    if (!ms) return 'never';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  renderBar(label: string, description: string, count: number, total: number, color: string, hint?: string): React.ReactNode {
    const pct = total > 0 ? (count / total) * 100 : 0;
    const testId = `completeness-hint-${label.toLowerCase().replace(/\s+/g, '-')}`;
    return React.createElement('div', { style: { marginBottom: 14 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color, minWidth: 90 } }, label),
        React.createElement('div', {
          style: { flex: 1, background: 'var(--nxai-code-bg, #1f1f1f)', borderRadius: 3, height: 6, overflow: 'hidden' },
        },
          React.createElement('div', {
            style: { height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.6s' },
          }),
        ),
        React.createElement('span', { style: { fontSize: 12, fontWeight: 700, minWidth: 60, textAlign: 'right' as const } },
          `${count}/${total}`,
        ),
        React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', minWidth: 36, textAlign: 'right' as const } },
          `${Math.round(pct)}%`,
        ),
      ),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', paddingLeft: 98 } },
        description,
      ),
      count === 0 && total > 0 && hint
        ? React.createElement('div', {
            style: { fontSize: 11, color: '#0ECAD4', paddingLeft: 98, marginTop: 3 },
            'data-testid': testId,
          }, hint)
        : null,
    );
  }

  render(): React.ReactNode {
    const { data, loading } = this.state;
    const { onSchedule, onIndexSites } = this.props;
    const total = data?.total ?? 0;

    return React.createElement('div', {
      'data-testid': 'fleet-completeness-widget',
      style: {
        background: 'var(--nxai-card-bg, #21262d)',
        border: '1px solid var(--nxai-card-border, #30363d)',
        borderRadius: 10,
        padding: '14px 18px',
      },
    },
      React.createElement('div', {
        style: {
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
          letterSpacing: '.06em', color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 14,
        },
      }, 'Data completeness'),

      loading
        ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)' } }, 'Loading…')
        : React.createElement('div', null,
            this.renderBar('Scanned',    'WP version · installed plugins/themes known', data?.scanned ?? 0,    total, '#51BB7B'),
            this.renderBar('Configured', 'Active plugins · users · post counts known',  data?.configured ?? 0, total, '#a78bfa',
              'Start a site in Local to populate active plugins, users, and post counts.'),
            this.renderBar('Searchable', 'Posts · pages · custom content indexed',       data?.searchable ?? 0, total, '#0ECAD4',
              'Click ⚡ Index sites to make content searchable, or enable the Content index interval in Settings.'),
          ),

      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--nxai-card-border, #30363d)',
        },
      },
        React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } },
          data?.lastUpdatedMs ? `Last updated ${this.ago(data.lastUpdatedMs)}` : '',
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          onIndexSites
            ? React.createElement('button', {
                onClick: onIndexSites,
                style: {
                  padding: '4px 10px', borderRadius: 5, background: 'transparent',
                  color: 'var(--nxai-card-sub, #6b7280)', fontSize: 11,
                  border: '1px solid var(--nxai-card-border, #30363d)',
                  cursor: 'pointer', fontFamily: 'inherit',
                },
              }, '⚡ Index sites')
            : null,
          onSchedule
            ? React.createElement('button', {
                onClick: onSchedule,
                style: {
                  padding: '4px 10px', borderRadius: 5, background: 'transparent',
                  color: 'var(--nxai-card-sub, #6b7280)', fontSize: 11,
                  border: '1px solid var(--nxai-card-border, #30363d)',
                  cursor: 'pointer', fontFamily: 'inherit',
                },
              }, '⏱ Schedule')
            : null,
        ),
      ),
    );
  }
}
