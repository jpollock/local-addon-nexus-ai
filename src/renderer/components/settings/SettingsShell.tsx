/**
 * SettingsShell — The unified settings home (spec 6a).
 *
 * Owns the nav, section dispatch, data fetch, save handler and footer.
 * The five sections are separate components (Tasks 6-10).
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { injectThemeVars } from '../../utils/theme';
import { computeDerived } from './derived';
import type { NexusSettings } from '../../../common/types';
import type { Derived, JobKey } from './derived';

export interface SectionProps<T> {
  data: T;
  onSave: (patch: Partial<NexusSettings>) => void;
  electron: any;
}

type Section = 'connections' | 'chat' | 'background' | 'permissions' | 'advanced';

interface SiteItem { id: string; name: string; status: string; }
interface WpeAccount { id: string; name: string; nickname?: string; }
interface WpeInstall { installName: string; environment: string; primaryDomain: string; }

interface SettingsShellState {
  settings: NexusSettings | null;
  sites: SiteItem[];
  wpeAccounts: WpeAccount[];
  wpeInstalls: WpeInstall[];
  externalHosts: Array<{ alias: string; site: string; environment: string; domain: string }>;
  loading: boolean;
  active: Section;
  fleetCounts: { installs: number; local: number; wpe: number; external: number } | null;
  jobRunData: Record<string, { averageMs: number | null; lastRunAt: number | null }> | null;
}

export class SettingsShell extends React.Component<{ electron: any }, SettingsShellState> {
  private mounted = false;

  state: SettingsShellState = {
    settings: null,
    sites: [],
    wpeAccounts: [],
    wpeInstalls: [],
    externalHosts: [],
    loading: true,
    active: 'background',
    fleetCounts: null,
    jobRunData: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.loadAll();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  async loadAll(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;
    const [settings, sitesResult, accounts, installs, externalHosts, dashboardStats, jobRunData] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SETTINGS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => ({ sites: [] })),
      ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_WPE_INSTALLS_CACHE).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_JOB_RUN_DATA).catch(() => ({})),
    ]);
    if (!this.mounted) return;

    // Extract fleet counts from dashboardStats.counts
    const counts = dashboardStats?.counts ?? null;
    const fleetCounts = counts ? {
      installs: counts.wpe?.count ?? 0,
      wpe: counts.wpe?.count ?? 0,
      external: counts.external?.count ?? 0,
      local: counts.local?.count ?? 0,
    } : null;

    this.setState({
      settings: settings ?? { autoIndex: true, excludedSiteIds: [] } as any,
      sites: sitesResult?.sites ?? [],
      wpeAccounts: Array.isArray(accounts) ? accounts : [],
      wpeInstalls: Array.isArray(installs) ? installs : [],
      externalHosts: Array.isArray(externalHosts) ? externalHosts : [],
      fleetCounts,
      jobRunData: jobRunData ?? {},
      loading: false,
    });
  }

  saveSetting = (patch: Partial<NexusSettings>): void => {
    if (!this.state.settings) return;
    const next = { ...this.state.settings, ...patch };
    this.setState({ settings: next });
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.UPDATE_SETTINGS, patch)
      .catch(() => {});
  };

  render(): React.ReactElement {
    if (this.state.loading) {
      return React.createElement('div', {
        style: { padding: 24, color: 'var(--nxai-text, #e6edf3)' },
      }, 'Loading…');
    }

    const s = this.state.settings ?? {};
    const { fleetCounts, jobRunData } = this.state;

    // Compute derived figures
    let derived: Derived | null = null;
    if (fleetCounts && jobRunData) {
      const durations: Partial<Record<JobKey, number | null>> = {};
      const lastRunAt: Partial<Record<JobKey, number | null>> = {};
      for (const [key, val] of Object.entries(jobRunData)) {
        durations[key as JobKey] = val.averageMs;
        lastRunAt[key as JobKey] = val.lastRunAt;
      }
      derived = computeDerived({
        settings: s,
        installCount: fleetCounts.installs,
        externalHostCount: fleetCounts.external,
        localSiteCount: fleetCounts.local,
        durations,
        lastRunAt,
        now: Date.now(),
      });
    }

    const navNote = (section: Section): string | null => {
      if (section === 'background') return derived?.navNote ?? null;
      if (section === 'chat') return (s as any).dockedPanelEnabled ? 'panel on' : 'panel off';
      return null;
    };

    const navItem = (section: Section, label: string) => {
      const active = this.state.active === section;
      const note = navNote(section);
      return React.createElement('div', {
        key: section,
        onClick: () => this.setState({ active: section }),
        style: {
          padding: '10px 16px',
          cursor: 'pointer',
          borderLeft: active ? '2px solid var(--nxai-brand-blue, #3b82f6)' : '2px solid transparent',
          background: active ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
        React.createElement('span', {
          style: {
            fontSize: 13,
            fontWeight: active ? 600 : 400,
            color: active ? 'var(--nxai-text, #e6edf3)' : 'var(--nxai-text-muted, #9ca3af)',
          },
        }, label),
        note ? React.createElement('span', {
          style: {
            fontSize: 11,
            color: 'var(--nxai-text-dim, #6b7280)',
          },
        }, note) : null,
      );
    };

    const nav = React.createElement('div', {
      style: {
        width: 232,
        borderRight: '1px solid var(--nxai-card-border, #30363d)',
        padding: '16px 0',
        background: 'var(--nxai-bg, #0d1117)',
      },
    },
      navItem('connections', 'Connections'),
      navItem('chat', 'Chat'),
      navItem('background', 'Background work'),
      navItem('permissions', 'What agents may do'),
      navItem('advanced', 'Advanced'),
    );

    // Placeholders for the five sections (Tasks 6-10 will fill these in)
    const sectionContent = React.createElement('div', {
      style: {
        flex: 1,
        padding: 24,
        overflowY: 'auto',
        color: 'var(--nxai-text, #e6edf3)',
      },
    }, `${this.state.active} section — placeholder`);

    const footer = React.createElement('div', {
      style: {
        padding: '16px 24px',
        borderTop: '1px solid var(--nxai-card-border, #30363d)',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#9ca3af',
      },
    },
      'Everything Nexus can be configured with is here, with one exception: approving a new host the first time you connect to it stays in ',
      React.createElement('span', { style: { color: '#6b7280', fontWeight: 700 } }, 'Local → Preferences → Nexus AI'),
      ', because that approval must not be reachable from anything but Local itself.',
    );

    return React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--nxai-bg, #0d1117)',
      },
    },
      React.createElement('div', {
        style: {
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        },
      }, nav, sectionContent),
      footer,
    );
  }
}
