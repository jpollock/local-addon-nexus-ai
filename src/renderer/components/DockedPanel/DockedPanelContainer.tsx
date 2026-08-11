import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { injectThemeVars } from '../../utils/theme';
import { ContextSelector } from './ContextSelector';
import { DockedPanel, PanelTab } from './DockedPanel';
import { PanelChat } from './PanelChat';
import { PanelInsights } from './PanelInsights';
import { SessionsSidebar } from './SessionsSidebar';
import { agentStore } from '../agents/AgentStore';
import {
  type PanelState,
  computeReflowMode,
  computeReservedWidth,
  findLocalRoot,
  readSiteId,
} from '../../utils/panelReflow';

interface ContainerProps {
  electron: any;
}

interface ContainerState {
  panelState: PanelState;
  activeTab: PanelTab;
  activeSessionId: string | null;
  showSessions: boolean;
  sessionListVersion: number;
  selectedSiteIds: string[];
  streamingStatus: string | null;
  reflowMode: 'in-flow' | 'overlay';
  /** Site id from Local's route, or null when not on a site screen. */
  scopedSiteId: string | null;
  /** Local site id → name, for matching activity events (which key on site name). */
  siteNames: Record<string, string>;
  /** Pending activity events, unscoped; scoping happens at render. */
  pendingEvents: Array<{ siteName?: string }>;
  /** Fleet health rollup — null until it loads, never coerced to 'ok'. */
  fleetHealth: 'ok' | 'degraded' | 'failing' | 'unknown' | null;
}

const STORAGE_KEY = 'nexus-panel-state';

/**
 * Signals start absent, not zero. A badge reading 0 and a badge that hasn't loaded look
 * identical to the eye but mean opposite things, and this is the surface whose whole job
 * is to be trusted at a glance.
 */
const SIGNAL_DEFAULTS = {
  scopedSiteId: null as string | null,
  siteNames: {} as Record<string, string>,
  pendingEvents: [] as Array<{ siteName?: string }>,
  fleetHealth: null as 'ok' | 'degraded' | 'failing' | 'unknown' | null,
};

/** Fire-and-forget telemetry helper. Never throws. */
function track(ipcRenderer: any, event: string, properties: Record<string, unknown> = {}) {
  try { ipcRenderer.send(IPC_CHANNELS.TELEMETRY_TRACK, { event, properties }); } catch (_) {}
}

function readState(): ContainerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old open+size format to panelState enum
      let panelState: PanelState;
      if (parsed.panelState !== undefined) {
        const valid: PanelState[] = ['closed', 'docked', 'wide', 'full'];
        panelState = valid.includes(parsed.panelState) ? parsed.panelState : 'docked';
      } else if (parsed.open === false) {
        panelState = 'closed';
      } else {
        const validSizes: PanelState[] = ['docked', 'wide', 'full'];
        panelState = validSizes.includes(parsed.size) ? parsed.size : 'docked';
      }
      // Accept both valid tabs, coerce anything unrecognised to 'chat'
      const validTabs: PanelTab[] = ['insights', 'chat'];
      const activeTab: PanelTab = validTabs.includes(parsed.activeTab) ? parsed.activeTab : 'chat';
      return {
        panelState: 'closed', // always start collapsed — never block Local on load
        activeTab,
        activeSessionId: parsed.activeSessionId ?? null,
        showSessions: false,
        sessionListVersion: 0,
        selectedSiteIds: [],
        streamingStatus: null,
        // Overlay is the fail-safe default: it reserves nothing, so a panel that renders
        // before applyReflow() runs draws correctly instead of assuming space it never got.
        reflowMode: 'overlay',
        ...SIGNAL_DEFAULTS,
      };
    }
  } catch { /* ignore */ }
  return { panelState: 'closed', activeTab: 'chat', activeSessionId: null, showSessions: false, sessionListVersion: 0, selectedSiteIds: [], streamingStatus: null, reflowMode: 'overlay', ...SIGNAL_DEFAULTS };
}

export class DockedPanelContainer extends React.Component<ContainerProps, ContainerState> {
  private openSessionListener: ((_: any, payload: { sessionId: string }) => void) | null = null;
  private chatRef = React.createRef<PanelChat>();
  private routeObserver: MutationObserver | null = null;
  private localRoot: HTMLElement | null = null;
  private resizeDebounceTimer: number | null = null;
  private agentStoreUnsub: (() => void) | null = null;

  constructor(props: ContainerProps) {
    super(props);
    this.state = readState();
    this.openPanel = this.openPanel.bind(this);
    this.closePanel = this.closePanel.bind(this);
    this.setSize = this.setSize.bind(this);
    this.setActiveTab = this.setActiveTab.bind(this);
    this.setActiveSession = this.setActiveSession.bind(this);
    this.newChat = this.newChat.bind(this);
    this.openAgentsHub = this.openAgentsHub.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleRouteChange = this.handleRouteChange.bind(this);
  }

  componentDidUpdate(_: {}, prevState: ContainerState) {
    const { panelState, activeTab, activeSessionId } = this.state;
    if (
      prevState.panelState !== panelState ||
      prevState.activeTab !== activeTab ||
      prevState.activeSessionId !== activeSessionId
    ) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ panelState, activeTab, activeSessionId }));
    }
    // Persist session when closing the panel
    if (prevState.panelState !== 'closed' && panelState === 'closed') {
      this.persistChatSession();
    }
    // Reapply reflow when panel state changes
    if (prevState.panelState !== panelState) {
      this.applyReflow();
    }
  }

  componentDidMount() {
    injectThemeVars();
    this.setupReflow();
    this.setupSignals();
    // Deep-link: open panel and activate a specific session from the Activity tab.
    // Receives from Activity tab "View chat →" link once activity events carry session_id.
    this.openSessionListener = (_: any, { sessionId }: { sessionId: string }) => {
      this.setState({ panelState: 'docked', activeSessionId: sessionId, activeTab: 'chat' });
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.OPEN_CHAT_SESSION, this.openSessionListener);
  }

  componentWillUnmount() {
    this.teardownReflow();
    if (this.agentStoreUnsub) {
      this.agentStoreUnsub();
      this.agentStoreUnsub = null;
    }
    if (this.openSessionListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.OPEN_CHAT_SESSION, this.openSessionListener);
      this.openSessionListener = null;
    }
    if (this.resizeDebounceTimer !== null) {
      clearTimeout(this.resizeDebounceTimer);
    }
  }

  private setupReflow() {
    this.localRoot = findLocalRoot();
    // Listen on the window, not a ResizeObserver on the shell. Observing the shell while
    // also resizing it is a feedback loop: shrink 380 → observer fires → remeasure the
    // now-narrower shell → below the threshold → flip to overlay → shell widens → fire
    // again. window.innerWidth is the one measurement the reservation cannot affect.
    window.addEventListener('resize', this.handleResize);
    if (this.localRoot) {
      // Local rewrites data-location on every route change, which is how the collapsed
      // tab knows whether it is on a site screen. Attribute-filtered, so unrelated class
      // churn on the shell does not wake this up.
      this.routeObserver = new MutationObserver(this.handleRouteChange);
      this.routeObserver.observe(this.localRoot, { attributes: true, attributeFilter: ['data-location'] });
    }
    // Runs either way. With no shell there is nothing to observe and nothing to resize,
    // but the panel still has to know it must overlay — skipping this left reflowMode at
    // its initial value, so a docked panel drew with no shadow AND reserved no space.
    this.applyReflow();
    this.handleRouteChange();
  }

  private teardownReflow() {
    window.removeEventListener('resize', this.handleResize);
    if (this.routeObserver) {
      this.routeObserver.disconnect();
      this.routeObserver = null;
    }
    if (this.localRoot) {
      // Clearing the inline value restores Window.scss's own `right: 0`.
      this.localRoot.style.right = '';
      this.localRoot.style.transition = '';
      this.localRoot = null;
    }
  }

  private handleResize() {
    // Debounce to avoid thrashing on every resize pixel
    if (this.resizeDebounceTimer !== null) {
      clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeDebounceTimer = window.setTimeout(() => {
      this.resizeDebounceTimer = null;
      this.applyReflow();
    }, 100);
  }

  /**
   * Load the two things the collapsed tab exists to carry: how many decisions are waiting,
   * and whether anything is stuck. Both are also what the open panel's Insights tab shows,
   * so they come from the same sources rather than a second reckoning.
   */
  private setupSignals() {
    const update = () => {
      const events = agentStore.getState().activityEvents;
      this.setState({
        pendingEvents: events
          .filter((e) => e.status === 'review')
          .map((e) => ({ siteName: e.siteName })),
      });
    };
    update();
    agentStore.subscribe(update);
    this.agentStoreUnsub = () => agentStore.unsubscribe(update);

    // Activity events name their site by NAME; Local's route gives an ID. Without this map
    // a site-scoped badge cannot be computed, and we show none rather than a fleet number.
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.GET_SITES)
      .then((result: any) => {
        const siteNames: Record<string, string> = {};
        (Array.isArray(result) ? result : []).forEach((s: any) => {
          if (s?.id && s?.name) siteNames[String(s.id)] = String(s.name);
        });
        this.setState({ siteNames });
      })
      .catch(() => { /* leaves siteNames empty — badge stays absent, never wrong */ });

    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.GET_DASHBOARD_STATS)
      .then((stats: any) => {
        this.setState({ fleetHealth: stats?.systemHealth?.overall ?? 'unknown' });
      })
      .catch(() => { /* leaves fleetHealth null — stuck marker stays absent */ });
  }

  /**
   * The collapsed tab's two signals, scoped to what is on screen.
   *
   * On a site screen the tab speaks only for that site: a fleet count there is a false
   * statement about the thing the user is looking at, and a fleet problem elsewhere is not
   * this site's problem and must not look like one. When scope cannot be resolved the
   * signal is absent (null), never zero and never the fleet figure.
   */
  private tabSignals(): { badgeCount: number | null; hasStuck: boolean | null; scopeLabel: string } {
    const { scopedSiteId, siteNames, pendingEvents, fleetHealth } = this.state;

    if (scopedSiteId) {
      const siteName = siteNames[scopedSiteId];
      return {
        // Unresolved name → no badge. Falling back to the fleet count here would print a
        // number about 373 sites on a page showing one.
        badgeCount: siteName ? pendingEvents.filter((e) => e.siteName === siteName).length : null,
        // Stuck is a fleet-level statement; on a site screen it is not this site's problem.
        hasStuck: false,
        scopeLabel: 'THIS SITE',
      };
    }

    return {
      badgeCount: pendingEvents.length,
      hasStuck: fleetHealth === null ? null : fleetHealth === 'degraded' || fleetHealth === 'failing',
      scopeLabel: 'INSIGHTS',
    };
  }

  private handleRouteChange() {
    const scopedSiteId = readSiteId(this.localRoot);
    if (scopedSiteId !== this.state.scopedSiteId) {
      this.setState({ scopedSiteId });
    }
  }

  private applyReflow() {
    const hostRoot = this.localRoot;
    const reflowMode = computeReflowMode(this.state.panelState, window.innerWidth, hostRoot !== null);
    if (hostRoot) {
      const reserved = computeReservedWidth(this.state.panelState, reflowMode);
      hostRoot.style.right = reserved > 0 ? `${reserved}px` : '';
      hostRoot.style.transition = 'right 0.2s ease';
    }
    // Update state if reflowMode changed
    if (this.state.reflowMode !== reflowMode) {
      this.setState({ reflowMode });
    }
  }

  openPanel() {
    this.setState({ panelState: 'docked' });
    try { track(this.props.electron.ipcRenderer, 'nexus_panel_opened', { state: 'docked' }); } catch (_) {}
  }

  closePanel() {
    this.setState({ panelState: 'closed' });
  }

  setSize(state: PanelState) {
    this.setState({ panelState: state });
  }

  private persistChatSession() {
    const chatRef = this.chatRef.current;
    if (chatRef && typeof (chatRef as any).persistSession === 'function') {
      (chatRef as any).persistSession().catch(() => {});
    }
  }

  setActiveTab(activeTab: PanelTab) {
    this.setState({ activeTab });
  }

  setActiveSession(id: string | null) {
    this.setState({ activeSessionId: id, activeTab: 'chat' });
  }

  newChat() {
    this.setState({ activeSessionId: null, showSessions: false, activeTab: 'chat' });
  }

  openAgentsHub() {
    // Navigate to Agents Hub (Activity tab in Local)
    // This is a placeholder - the actual implementation would trigger navigation
    // For now, we'll just log it since the wiring to Local's tab system isn't exposed
    console.log('[Nexus] Navigate to Agents Hub requested');
  }

  render() {
    const { panelState, activeTab, activeSessionId, showSessions, sessionListVersion, selectedSiteIds, reflowMode } = this.state;

    const panelContent = activeTab === 'insights'
      ? React.createElement(PanelInsights, {
          electron: this.props.electron,
          onOpenAgents: this.openAgentsHub,
        })
      : React.createElement(PanelChat, {
          ref: this.chatRef,
          electron: this.props.electron,
          sessionId: activeSessionId,
          selectedSiteIds,
          visible: panelState !== 'closed',
          onSessionCreated: (id: string) => this.setState({ activeSessionId: id }),
          onSessionSaved: () => this.setState((s) => ({ sessionListVersion: s.sessionListVersion + 1 })),
          onStreamingStatusChange: (status: string | null) => this.setState({ streamingStatus: status }),
        });

    const contextSelector = React.createElement(ContextSelector, {
      electron: this.props.electron,
      selectedSiteIds,
      onChange: (ids: string[]) => this.setState({ selectedSiteIds: ids }),
    });

    const sessionsSidebar = panelState === 'full' || showSessions
      ? React.createElement(SessionsSidebar, {
          electron: this.props.electron,
          activeSessionId,
          version: sessionListVersion,
          onSelectSession: this.setActiveSession,
          onNewSession: () => this.setActiveSession(null),
        })
      : null;

    return React.createElement(
      DockedPanel,
      {
        panelState,
        activeTab,
        onSetActiveTab: this.setActiveTab,
        onOpen: this.openPanel,
        onClose: this.closePanel,
        onSetPanelState: this.setSize,
        onNewChat: this.newChat,
        sessionsSidebar,
        showSessions,
        onToggleSessions: () => this.setState((s) => ({ showSessions: !s.showSessions })),
        streamingStatus: this.state.streamingStatus,
        isOverlay: reflowMode === 'overlay',
        contextSelector,
        ...this.tabSignals(),
      },
      panelContent,
    );
  }
}
