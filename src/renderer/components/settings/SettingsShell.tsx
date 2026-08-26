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
import { PermissionsPaneSection } from './PermissionsPaneSection';
import { AdvancedSection } from './AdvancedSection';
import { GovernSection } from './GovernSection';
import type { GovernDoorTarget } from '../../../main/intelligence-host/sequenceGuard';

/**
 * WP-44 · a door a refusal opened, handed down to the section that owns it.
 *
 * The section name in `GovernDoorTarget` is `'capabilities'`, which is why the
 * Section union gained that member rather than reusing `'permissions'` — the
 * refusal's structured target is the addressing scheme, and a shell that mapped
 * one section name onto a different one would be a translation table nobody
 * asked for and the first thing to drift.
 */
export interface SettingsShellProps {
  electron: any;
  door?: GovernDoorTarget | null;
  onDoorHandled?: () => void;
  /**
   * A section another surface asked this shell to open on — the plain sibling of `door`, for
   * senders that name a section and nothing finer. An agent workspace pointing at the shared AWS
   * credential is the motivating case: it used to fire `goToRoute('/main/nexus')`, the route the
   * user was already on, so the button did nothing at all. Landing on the shell's default section
   * would be the same "top of Settings" degradation `door` exists to avoid.
   */
  openSection?: Section | null;
  /** Cleared by the sender once honoured, so asking for the same section twice works twice. */
  onSectionOpened?: () => void;
}

export interface SectionProps<T> {
  data: T;
  onSave: (patch: Partial<NexusSettings>) => void;
  electron: any;
}

/** Exported so a sender can name a section in a type that fails to compile when one is renamed. */
// 'permissions' is THE pane (fixes-082526 phase 5 — the merge the designer's
// sheet ruled). 'bound-editor' and 'capabilities' are door-reached editors,
// deliberately absent from the nav: one surface ANSWERS; the editors are
// doors away, which is the grants pattern generalized.
export type Section = 'connections' | 'chat' | 'background' | 'permissions' | 'bound-editor' | 'capabilities' | 'advanced';

interface SiteItem { id: string; name: string; status: string; }
interface WpeAccount { id: string; name: string; nickname?: string; }
interface WpeInstall { installName: string; environment: string; primaryDomain: string; }

interface SettingsShellState {
  settings: NexusSettings | null;
  sites: SiteItem[];
  wpeAccounts: WpeAccount[];
  wpeInstalls: WpeInstall[];
  externalHosts: Array<{ alias: string; site: string; environment: string; domain: string; wpPath: string; allowRoot: boolean }>;
  loading: boolean;
  active: Section;
  fleetCounts: { wpe: number; external: number; local: number } | null;
  jobRunData: Record<string, { averageMs: number | null; lastRunAt: number | null }> | null;
  pipelineActivity: import('./derived').PipelineActivityData | null;
  indexEntries: Array<{ siteId: string; state: string; documentCount?: number }>;
  mcpInfo: { port: number; stdioPath: string } | null;
}

export class SettingsShell extends React.Component<SettingsShellProps, SettingsShellState> {
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
    pipelineActivity: null,
    indexEntries: [],
    mcpInfo: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
    this.loadAll();
    // A door that arrived with the mount must open the section it names. Without
    // this the shell would land on its default section and the refusal's deep
    // link would degrade to "the top of Settings" — the exact failure J-Refusal
    // names, reached by doing nothing rather than by doing something wrong.
    if (this.props.door?.section === 'capabilities') this.setState({ active: 'capabilities' });
    if (this.props.openSection) this.openRequestedSection(this.props.openSection);
  }

  componentDidUpdate(prev: SettingsShellProps): void {
    if (prev.door !== this.props.door && this.props.door?.section === 'capabilities') {
      this.setState({ active: 'capabilities' });
    }
    // Compared by value, not identity: the sender clears it back to null after each request, so a
    // second request for the same section is a real transition and opens it again.
    if (prev.openSection !== this.props.openSection && this.props.openSection) {
      this.openRequestedSection(this.props.openSection);
    }
  }

  /** Honour an `openSection` request and tell the sender, so it can clear its own state. */
  private openRequestedSection(section: Section): void {
    this.setState({ active: section });
    this.props.onSectionOpened?.();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  async loadAll(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;
    const [settings, sitesResult, accounts, installs, externalHosts, dashboardStats, jobRunData, pipelineActivity, indexEntries, mcpInfo] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SETTINGS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_WPE_INSTALLS_CACHE).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_DASHBOARD_STATS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_JOB_RUN_DATA).catch(() => ({})),
      ipc.invoke(IPC_CHANNELS.GET_PIPELINE_ACTIVITY).catch(() => null),
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
      pipelineActivity: pipelineActivity ?? null,
      indexEntries: Array.isArray(indexEntries) ? indexEntries : [],
      mcpInfo: mcpInfo ?? null,
      loading: false,
    });
  }

  /**
   * Optimistic write, with a real failure path.
   *
   * UPDATE_SETTINGS NEVER REJECTS. Its handler catches every internal failure
   * and resolves with `{ ...current, _error }` (ipc-handlers.ts), so a
   * `.catch()` is dead code and checking only the happy path made a rejected
   * save — a stale field, a schema violation — indistinguishable from success:
   * no toast, no console line, and the optimistic value left on screen
   * asserting a change that never reached disk. `src/renderer/index.tsx`
   * already checks `_error` explicitly for exactly this reason; this is the
   * same check for every setting on the page.
   *
   * On failure only the keys in THIS patch are rolled back, so a concurrent
   * successful save is not clobbered by the revert.
   */
  saveSetting = (patch: Partial<NexusSettings>): void => {
    const prev = this.state.settings;
    if (!prev) return;
    this.setState({ settings: { ...prev, ...patch } });

    const revert = (reason: string): void => {
      if (!this.mounted) return;
      this.setState((s) => {
        if (!s.settings) return null;
        const restored: any = { ...s.settings };
        for (const key of Object.keys(patch)) restored[key] = (prev as any)[key];
        return { settings: restored } as Pick<SettingsShellState, 'settings'>;
      });
      (window as any).showToast?.(`Could not save that setting: ${reason}`, 'error');
    };

    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.UPDATE_SETTINGS, patch)
      .then((result: any) => {
        if (result?._error) revert(result._error);
      })
      .catch((err: any) => revert(err?.message ?? String(err)));
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
      // `!== false`, not truthiness. `dockedPanelEnabled` is absent from
      // DEFAULT_SETTINGS, and both the real gate (index.tsx's DockedPanelGate)
      // and ChatSection's own toggle default an absent value to ON. Truthiness
      // put "panel off" in the nav beside a ticked toggle and a running panel
      // on every fresh install.
      if (section === 'chat') return (s as any).dockedPanelEnabled !== false ? 'panel on' : 'panel off';
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
      // ONE answering surface (the sheet's §8: two panes answering one
      // question was the defect). The editors are doors inside it.
      navItem('permissions', 'Permissions'),
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
          activity: this.state.pipelineActivity ?? null,
          onSave: this.saveSetting,
        });
      }
    } else if (active === 'permissions') {
      sectionContent = React.createElement(PermissionsPaneSection, {
        settings: settings ?? ({} as NexusSettings),
        wpeAccounts,
        electron: this.props.electron,
        onOpenBoundEditor: () => this.setState({ active: 'bound-editor' }),
        onOpenGovern: () => this.setState({ active: 'capabilities' }),
      });
    } else if (active === 'bound-editor') {
      // The bound's EDITOR — door-reached from the pane, not a nav item.
      const exceptions = (settings?.remoteSiteExceptions ?? []) as any[];
      sectionContent = React.createElement(PermissionsSection, {
        permissions: settings ?? {} as NexusSettings,
        exceptions,
        wpeInstalls,
        externalHosts,
        wpeAccounts,
        onSave: this.saveSetting,
      });
    } else if (active === 'capabilities') {
      // WP-44 · the Govern matrix. It fetches its own rows: every fact on them
      // is derived in the seam from the law registry and the live grant record,
      // and none of it is in the settings blob this shell already loaded.
      sectionContent = React.createElement(GovernSection, {
        electron: this.props.electron,
        door: this.props.door ?? null,
        ...(this.props.onDoorHandled ? { onDoorHandled: this.props.onDoorHandled } : {}),
      });
    } else {
      // advanced
      sectionContent = React.createElement(AdvancedSection, {
        settings: settings ?? {} as NexusSettings,
        indexEntries,
        mcpInfo,
        sites,
        fleetCounts,
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

    // #9ca3af on --nxai-section-bg measures 2.43:1 in light theme — below AA on
    // the acceptance-test sentence itself. --nxai-card-sub is a declared token
    // that already carries the "secondary body text" role in both themes
    // (#6b7280 light / #9ca3af dark), and --nxai-card-text the emphasis role.
    // Tokenised rather than invented.
    const footer = React.createElement('div', {
      style: {
        padding: '16px 24px',
        borderTop: '1px solid var(--nxai-card-border)',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--nxai-card-sub)',
      },
    },
      'Everything Nexus can be configured with is here, with one exception: approving a host\'s fingerprint is reachable only through ',
      React.createElement('span', { style: { color: 'var(--nxai-card-text)', fontWeight: 700 } }, 'Local itself'),
      ', over a private channel — never over the API — because that approval must not be scriptable.',
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
