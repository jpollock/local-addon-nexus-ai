/**
 * NexusSiteTabSummary — Compact overview row for the site overview panel.
 *
 * Shows a single-line summary: index status, provider, DB score, with a link
 * to open the full Nexus AI tab.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { NexusSettings, SiteAIConfig, DbScanResult } from '../../common/types';

export interface NexusSiteTabSummaryProps {
  site: { id: string; name: string; path: string; status?: string };
  siteStatus?: string;
  electron: any;
}

interface IndexEntry {
  siteId: string;
  state: string;
  documentCount: number;
  chunkCount: number;
  lastIndexed: number;
}

interface NexusSiteTabSummaryState {
  indexEntry: IndexEntry | null;
  siteAIConfig: SiteAIConfig | null;
  dbScan: DbScanResult | null;
  loading: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
  ollama: 'Ollama (local)',
  'local-gateway': 'Local AI Gateway',
};

const dot = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: 6,
  verticalAlign: 'middle',
  flexShrink: 0,
});

export class NexusSiteTabSummary extends React.Component<NexusSiteTabSummaryProps, NexusSiteTabSummaryState> {
  private mounted = false;

  state: NexusSiteTabSummaryState = {
    indexEntry: null,
    siteAIConfig: null,
    dbScan: null,
    loading: true,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchData();
  }

  componentDidUpdate(prevProps: NexusSiteTabSummaryProps): void {
    if (prevProps.site.id !== this.props.site.id) {
      this.fetchData();
    }
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  fetchData = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;

    // Fetch fleet status for index entry
    try {
      const entries = await ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS);
      if (!this.mounted) return;
      const entry = (entries ?? []).find((e: IndexEntry) => e.siteId === this.props.site.id) ?? null;
      this.setState({ indexEntry: entry, loading: false });
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false });
    }

    // Fetch per-site AI config
    try {
      const configResult = await ipc.invoke(IPC_CHANNELS.GET_SITE_AI_CONFIG, this.props.site.id);
      if (!this.mounted) return;
      if (configResult?.success) {
        this.setState({ siteAIConfig: configResult.config ?? null });
      }
    } catch {
      // Non-fatal
    }

    // Fetch last DB scan
    try {
      const lastScanResult = await ipc.invoke(IPC_CHANNELS.DB_GET_LAST_SCAN, this.props.site.id);
      if (!this.mounted) return;
      if (lastScanResult?.success) {
        this.setState({ dbScan: lastScanResult.scan ?? null });
      }
    } catch {
      // Non-fatal
    }
  };

  navigateToTab = (): void => {
    const siteId = this.props.site.id;
    // Use Local's routing — update window location hash/path
    const target = `/main/site-info/${siteId}/nexus`;
    try {
      // Try ReactRouter history if available on window
      const history = (window as any).__nexusHistory;
      if (history && history.push) {
        history.push(target);
        return;
      }
    } catch {
      // Ignore
    }
    // Fallback: navigate via hash
    window.location.hash = target;
  };

  render(): React.ReactNode {
    const { indexEntry, siteAIConfig, dbScan, loading } = this.state;

    if (loading) {
      return React.createElement('div', { style: { fontSize: 12, opacity: 0.5 } }, 'Loading...');
    }

    // Index status
    const indexColor = !indexEntry ? '#888'
      : indexEntry.state === 'indexed' ? UI_COLORS.STATUS_RUNNING
      : indexEntry.state === 'stale' ? UI_COLORS.STATUS_WARNING
      : indexEntry.state === 'error' ? UI_COLORS.STATUS_ERROR
      : UI_COLORS.WPE_BRAND;
    const indexLabel = indexEntry
      ? indexEntry.state.charAt(0).toUpperCase() + indexEntry.state.slice(1)
      : 'Not indexed';

    // Provider
    const providerLabel = siteAIConfig
      ? (PROVIDER_LABELS[siteAIConfig.provider] ?? siteAIConfig.provider)
      : 'No AI';

    // DB score
    const dbScoreColor = !dbScan ? '#888'
      : dbScan.healthScore >= 80 ? UI_COLORS.STATUS_RUNNING
      : dbScan.healthScore >= 50 ? UI_COLORS.STATUS_WARNING
      : UI_COLORS.STATUS_ERROR;
    const dbScoreLabel = dbScan ? `${dbScan.healthScore}/100` : null;

    // Separator element
    const sep = React.createElement('span', {
      style: { opacity: 0.3, marginLeft: 6, marginRight: 6 },
    }, '\u00B7');

    return React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 13,
        padding: '2px 0',
      },
    },
      // Summary text
      React.createElement('span', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: 0 } },
        React.createElement('span', { style: dot(indexColor) }),
        React.createElement('span', null, indexLabel),
        sep,
        React.createElement('span', null, providerLabel),
        dbScoreLabel
          ? React.createElement('span', null,
              sep,
              React.createElement('span', { style: dot(dbScoreColor) }),
              React.createElement('span', null, dbScoreLabel),
            )
          : null,
      ),
      // Open tab link
      React.createElement('a', {
        onClick: this.navigateToTab,
        style: {
          fontSize: 12,
          color: '#51c356',
          cursor: 'pointer',
          textDecoration: 'none',
          whiteSpace: 'nowrap' as const,
          marginLeft: 12,
          flexShrink: 0,
        },
        onMouseEnter: (e: any) => { e.target.style.textDecoration = 'underline'; },
        onMouseLeave: (e: any) => { e.target.style.textDecoration = 'none'; },
      }, 'Open tab \u2192'),
    );
  }
}
