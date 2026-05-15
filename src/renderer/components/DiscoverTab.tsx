/**
 * DiscoverTab — First-run experience and comparison search.
 *
 * State machine:
 *   'fresh'    — no sites indexed, show index prompt
 *   'indexing' — indexing in progress, show per-site progress
 *   'ready'    — sites indexed, show comparison search
 *
 * Class-based, React.createElement only — no JSX, no hooks (Local React).
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';
import { injectThemeVars } from '../utils/theme';

interface IndexEntry {
  siteId: string;
  siteName: string;
  state: 'indexed' | 'indexing' | 'pending' | 'error';
  documentCount?: number;
}

interface DiscoverTabProps {
  electron: any;
  sites: Array<{ id: string; name: string; status: string }>;
  indexEntries: IndexEntry[];
  settings: NexusSettings;
  onSettingsChange: (s: NexusSettings) => void;
}

interface DiscoverTabState {
  viewState: 'fresh' | 'indexing' | 'ready';
  indexEntries: IndexEntry[];
}

export class DiscoverTab extends React.Component<DiscoverTabProps, DiscoverTabState> {
  private mounted = false;

  state: DiscoverTabState = {
    viewState: 'fresh',
    indexEntries: [],
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.deriveViewState();
  }

  componentDidUpdate(prevProps: DiscoverTabProps): void {
    if (prevProps.indexEntries !== this.props.indexEntries) {
      this.deriveViewState();
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  deriveViewState(): void {
    const { indexEntries } = this.props;
    const indexed = indexEntries.filter((e) => e.state === 'indexed');
    const indexing = indexEntries.filter((e) => e.state === 'indexing');

    let viewState: DiscoverTabState['viewState'];
    if (indexed.length > 0) {
      viewState = 'ready';
    } else if (indexing.length > 0) {
      viewState = 'indexing';
    } else {
      viewState = 'fresh';
    }

    if (this.mounted) this.setState({ viewState, indexEntries });
  }

  handleStartIndexing = async (): Promise<void> => {
    this.setState({ viewState: 'indexing' });
    const ipc = this.props.electron.ipcRenderer;
    for (const site of this.props.sites) {
      const entry = this.props.indexEntries.find((e) => e.siteId === site.id);
      if (!entry || entry.state !== 'indexed') {
        ipc.invoke(IPC_CHANNELS.INDEX_SITE, { siteId: site.id, force: false }).catch(() => {});
      }
    }
  };

  renderFresh(): React.ReactNode {
    return React.createElement('div', {
      style: { maxWidth: 520, margin: '48px auto', textAlign: 'center' as const },
    },
      React.createElement('div', {
        style: { width: 56, height: 56, borderRadius: 16, background: 'rgba(14,202,212,0.1)', border: '1px solid rgba(14,202,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 20px' },
      }, '🔍'),
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 8 } }, 'Search across all your sites'),
      React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', lineHeight: 1.6, marginBottom: 24 } },
        'Nexus indexes your WordPress content and lets you search semantically — finding relevant pages even when they don\'t use your exact words.',
      ),
      React.createElement('div', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(81,187,123,0.08)', border: '1px solid rgba(81,187,123,0.2)', borderRadius: 20, padding: '4px 12px', fontSize: 11, color: '#51BB7B', marginBottom: 28 },
      }, '✓ No API key required — works out of the box'),
      React.createElement('br'),
      this.props.sites.length === 0
        ? React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)' } }, 'No local WordPress sites found. Create a site in Local first.')
        : React.createElement('button', {
            onClick: this.handleStartIndexing,
            style: { background: '#0ECAD4', color: '#000', fontWeight: 700, fontSize: 13, padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
          }, '⚡ Index my sites now'),
    );
  }

  renderIndexing(): React.ReactNode {
    const { sites } = this.props;
    const { indexEntries } = this.state;
    const indexed = indexEntries.filter((e) => e.state === 'indexed').length;
    const total = sites.length;
    const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;

    return React.createElement('div', {
      style: { maxWidth: 520, margin: '40px auto', textAlign: 'center' as const },
    },
      React.createElement('div', { style: { fontSize: 24, marginBottom: 16 } }, '⚡'),
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 8 } }, 'Indexing your sites…'),
      React.createElement('p', { style: { fontSize: 13, color: 'var(--nxai-card-sub)', marginBottom: 20 } }, 'Reading content from your WordPress sites.'),
      React.createElement('div', { style: { background: '#222', borderRadius: 4, height: 4, maxWidth: 400, margin: '0 auto 8px', overflow: 'hidden' } },
        React.createElement('div', { style: { height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #0ECAD4, #51BB7B)', borderRadius: 4, transition: 'width 0.5s' } }),
      ),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', marginBottom: 20 } }, `${indexed} of ${total} sites indexed`),
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, textAlign: 'left' as const },
      },
        ...sites.map((site) => {
          const entry = indexEntries.find((e) => e.siteId === site.id);
          const st = entry?.state ?? 'pending';
          const dotColor = st === 'indexed' ? '#51BB7B' : st === 'indexing' ? '#0ECAD4' : '#333';
          const label = st === 'indexed' ? `${entry?.documentCount ?? '?'} pages` : st === 'indexing' ? 'indexing…' : 'waiting';
          return React.createElement('div', {
            key: site.id,
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--nxai-card-bg)', border: '1px solid var(--nxai-card-border)', borderRadius: 6, fontSize: 12 },
          },
            React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
            React.createElement('span', { style: { flex: 1, color: 'var(--nxai-card-text)' } }, site.name),
            React.createElement('span', { style: { fontSize: 10, color: st === 'indexed' ? '#51BB7B' : 'var(--nxai-card-sub)' } }, label),
          );
        }),
      ),
    );
  }

  renderReady(): React.ReactNode {
    // Placeholder — replaced in Task 5
    return React.createElement('div', { style: { textAlign: 'center' as const, padding: 48, color: 'var(--nxai-card-sub)' } }, 'Search UI coming in Task 5');
  }

  render(): React.ReactNode {
    const { viewState } = this.state;
    return React.createElement('div', { style: { padding: '24px' } },
      viewState === 'fresh'    ? this.renderFresh()    : null,
      viewState === 'indexing' ? this.renderIndexing() : null,
      viewState === 'ready'    ? this.renderReady()    : null,
    );
  }
}
