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
import { ConnectionsSection } from './ConnectionsSection';
import { ChatSection } from './ChatSection';
import { BackgroundWorkSection } from './BackgroundWorkSection';
import { PermissionsSection } from './PermissionsSection';
import { AdvancedSection } from './AdvancedSection';

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
  fleetCounts: { wpe: number; external: number; local: number } | null;
  jobRunData: Record<string, { averageMs: number | null; lastRunAt: number | null }> | null;
  indexEntries: Array<{ siteId: string; state: string; documentCount?: number }>;
  mcpInfo: { port: number } | null;
}

export class SettingsShell extends React.Component<{ electron: any }, SettingsShellState> {
  static displayName = 'SettingsTab';
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
    indexEntries: [],
    mcpInfo: null,
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
    const [settings, sitesResult, accounts, installs, externalHosts, dashboardStats, jobRunData, indexEntries, mcpInfo] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SETTINGS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_WPE_INSTALLS_CACHE).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_JOB_RUN_DATA).catch(() => ({})),
      ipc.invoke(IPC_CHANNELS.GET_FLEET_STATUS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_MCP_INFO).catch(() => null),
    ]);
    if (!this.mounted) return;

    // Extract fleet counts from dashboardStats.counts
    const counts = dashboardStats?.counts ?? null;
    const fleetCounts = counts ? {
      wpe: counts.wpe?.count ?? 0,
      external: counts.external?.count ?? 0,
      local: counts.local?.count ?? 0,
    } : null;

    this.setState({
      settings: settings ?? { autoIndex: true, excludedSiteIds: [] } as any,
      sites: Array.isArray(sitesResult) ? sitesResult : [],
      wpeAccounts: Array.isArray(accounts) ? accounts : [],
      wpeInstalls: Array.isArray(installs) ? installs : [],
      externalHosts: Array.isArray(externalHosts) ? externalHosts : [],
      fleetCounts,
      jobRunData: jobRunData ?? {},
      indexEntries: Array.isArray(indexEntries) ? indexEntries : [],
      mcpInfo: mcpInfo ?? null,
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
        style: { padding: 24, color: 'var(--nxai-card-text)' },
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
        installCount: fleetCounts.wpe,
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
          borderLeft: active ? '2px solid var(--nxai-accent)' : '2px solid transparent',
          background: active ? 'var(--nxai-section-bg)' : 'transparent',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
        React.createElement('span', {
          style: {
            fontSize: 13,
            fontWeight: active ? 600 : 400,
            color: active ? 'var(--nxai-card-text)' : 'var(--nxai-status-neutral)',
          },
        }, label),
        note ? React.createElement('span', {
          style: {
            fontSize: 11,
            color: 'var(--nxai-card-sub)',
          },
        }, note) : null,
      );
    };

    const nav = React.createElement('div', {
      style: {
        width: 232,
        borderRight: '1px solid var(--nxai-card-border)',
        padding: '16px 0',
        background: 'var(--nxai-card-bg)',
      },
    },
      navItem('connections', 'Connections'),
      navItem('chat', 'Chat'),
      navItem('background', 'Background work'),
      navItem('permissions', 'What agents may do'),
      navItem('advanced', 'Advanced'),
    );

    // Dispatch to the appropriate section
    let sectionContent: React.ReactElement;
    const { active, settings, wpeAccounts, wpeInstalls, externalHosts, sites, indexEntries, mcpInfo } = this.state;

    if (active === 'connections') {
      sectionContent = React.createElement(ConnectionsSection, {
        settings: settings ?? {} as NexusSettings,
        wpeAccounts,
        externalHosts,
        onSave: this.saveSetting,
        electron: this.props.electron,
      });
    } else if (active === 'chat') {
      sectionContent = React.createElement(ChatSection, {
        settings: settings ?? {} as NexusSettings,
        onSave: this.saveSetting,
        electron: this.props.electron,
      });
    } else if (active === 'background') {
      if (!derived) {
        sectionContent = React.createElement('div', {
          style: { padding: 24, color: 'var(--nxai-card-text)' },
        }, 'Loading background work data…');
      } else {
        sectionContent = React.createElement(BackgroundWorkSection, {
          derived,
          onSave: this.saveSetting,
        });
      }
    } else if (active === 'permissions') {
      const exceptions = (settings?.remoteSiteExceptions ?? []) as any[];
      sectionContent = React.createElement(PermissionsSection, {
        permissions: settings ?? {} as NexusSettings,
        exceptions,
        wpeInstalls,
        externalHosts,
        wpeAccounts,
        onSave: this.saveSetting,
      });
    } else {
      // advanced
      sectionContent = React.createElement(AdvancedSection, {
        settings: settings ?? {} as NexusSettings,
        indexEntries,
        mcpInfo,
        sites,
        onSave: this.saveSetting,
        electron: this.props.electron,
      });
    }

    const sectionWrapper = React.createElement('div', {
      style: {
        flex: 1,
        padding: 24,
        overflowY: 'auto',
        color: 'var(--nxai-card-text)',
      },
    }, sectionContent);

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
        background: 'var(--nxai-section-bg)',
      },
    },
      React.createElement('div', {
        style: {
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        },
      }, nav, sectionWrapper),
      footer,
    );
  }
}
