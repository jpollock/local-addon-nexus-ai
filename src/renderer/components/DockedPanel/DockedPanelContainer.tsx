import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { injectThemeVars } from '../../utils/theme';
import { DockedPanel, PanelTab } from './DockedPanel';
import { PanelChat } from './PanelChat';
import { nexusStore } from '../../store/NexusStateManager';
import { SessionsSidebar } from './SessionsSidebar';
import {
  type PanelState,
  computeReflowMode,
  computeReservedWidth,
  findLocalRoot,
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
  /** Sessions whose newest message is from the assistant and arrived unseen. */
  unreadChats: number | null;
  /** Fleet health rollup — null until it loads, never coerced to 'ok'. */
  fleetHealth: 'ok' | 'degraded' | 'failing' | 'unknown' | null;
  /** A full-height overlay owns the screen; the collapsed tab stands down. */
  overlayOpen: boolean;
  /** Distance from the bottom of the viewport, in px. Dragged, then persisted. */
  railBottom: number;
}

const STORAGE_KEY = 'nexus-panel-state';

/**
 * Signals start absent, not zero. A badge reading 0 and a badge that hasn't loaded look
 * identical to the eye but mean opposite things, and this is the surface whose whole job
 * is to be trusted at a glance.
 */
/**
 * Where the collapsed tab sits by default, as a distance from the bottom.
 *
 * It used to be vertically centred, which is exactly where full-height content lives —
 * the host picker's right-hand column ran straight underneath it. Corners are the part
 * of a window least likely to carry content.
 */
const RAIL_BOTTOM_DEFAULT = 88;
const RAIL_POS_KEY = 'nexus-panel-rail-bottom';

const SIGNAL_DEFAULTS = {
  unreadChats: null as number | null,
  fleetHealth: null as 'ok' | 'degraded' | 'failing' | 'unknown' | null,
  overlayOpen: false,
  railBottom: readRailBottom(),
};

/** Persisted tab position. Clamped on read — a stale value from a taller window
 *  must not park the tab off-screen where it cannot be dragged back. */
function readRailBottom(): number {
  try {
    const raw = Number(localStorage.getItem(RAIL_POS_KEY));
    if (Number.isFinite(raw) && raw > 0) return clampRailBottom(raw);
  } catch { /* ignore */ }
  return RAIL_BOTTOM_DEFAULT;
}

function clampRailBottom(v: number): number {
  const max = Math.max(RAIL_BOTTOM_DEFAULT, window.innerHeight - 140);
  return Math.min(Math.max(v, 8), max);
}

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
      // Chat is the only tab now that Insights is gone; a persisted 'insights' from an
      // older build coerces to it rather than leaving the panel on a tab that no longer exists.
      const activeTab: PanelTab = 'chat';
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
  private localRoot: HTMLElement | null = null;
  private unreadListener: (() => void) | null = null;
  private storeUnsub: (() => void) | null = null;
  private railWasDragged = false;
  private resizeDebounceTimer: number | null = null;

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
    // Looking at a session is what marks it read — opening the panel onto one, or
    // switching to it. Closing the panel deliberately does not.
    const openedSession =
      panelState !== 'closed' &&
      activeSessionId &&
      (prevState.activeSessionId !== activeSessionId || prevState.panelState === 'closed');
    if (openedSession) {
      this.markRead(activeSessionId).then(this.refreshUnread);
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
    if (this.storeUnsub) {
      this.storeUnsub();
      this.storeUnsub = null;
    }
    if (this.unreadListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM, this.unreadListener);
      this.unreadListener = null;
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
    // Runs either way. With no shell there is nothing to observe and nothing to resize,
    // but the panel still has to know it must overlay — skipping this left reflowMode at
    // its initial value, so a docked panel drew with no shadow AND reserved no space.
    this.applyReflow();
  }

  private teardownReflow() {
    window.removeEventListener('resize', this.handleResize);
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
   * Load the two things the collapsed tab exists to carry: how many chats are waiting on
   * a reply, and whether anything is stuck.
   *
   * Unread is computed in the database rather than here — it needs each session's newest
   * message role, which the session list does not carry, and deriving it from updatedAt
   * would count a message the user just sent as waiting on them.
   */
  private setupSignals() {
    this.refreshUnread();

    // A reply landing while the panel is closed is exactly the case the badge exists for,
    // so the stream event refreshes it rather than waiting for the next mount. When the
    // panel IS open on that session the user is watching the reply arrive, so it is marked
    // read first — otherwise the badge would count the conversation on screen.
    this.unreadListener = () => {
      const { panelState, activeSessionId } = this.state;
      if (panelState !== 'closed' && activeSessionId) {
        this.markRead(activeSessionId).then(this.refreshUnread);
      } else {
        this.refreshUnread();
      }
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM, this.unreadListener);

    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.GET_DASHBOARD_STATS)
      .then((stats: any) => {
        this.setState({ fleetHealth: stats?.systemHealth?.overall ?? 'unknown' });
      })
      .catch(() => { /* leaves fleetHealth null — stuck marker stays absent */ });

    // Read once as well as subscribing: an overlay opened before this mounted would
    // never fire a notification, and the tab would sit on top of it.
    this.setState({ overlayOpen: nexusStore.get().overlayOpen === true });
    this.storeUnsub = nexusStore.subscribe(() => {
      const open = nexusStore.get().overlayOpen === true;
      if (open !== this.state.overlayOpen) this.setState({ overlayOpen: open });
    });
  }

  /** Drag the collapsed tab up and down its edge. Vertical only — it is anchored right. */
  private startRailDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startBottom = this.state.railBottom;
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      // A few pixels of slop, so a click that wobbles still opens the panel rather than
      // being swallowed as a drag.
      if (!moved && Math.abs(ev.clientY - startY) < 4) return;
      moved = true;
      this.setState({ railBottom: clampRailBottom(startBottom + (startY - ev.clientY)) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moved) {
        this.railWasDragged = true;
        try { localStorage.setItem(RAIL_POS_KEY, String(this.state.railBottom)); } catch { /* ignore */ }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** Swallow the click that ends a drag, so releasing the tab does not also open it. */
  private handleRailOpen = (): void => {
    if (this.railWasDragged) { this.railWasDragged = false; return; }
    this.openPanel();
  };

  /** Stamp a session as seen. Best-effort: a failure leaves it counted, never wrongly cleared. */
  private markRead = (sessionId: string): Promise<void> =>
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.CHAT_SESSION_MARK_READ, { sessionId })
      .catch(() => undefined);

  /** Ask the database how many sessions are waiting. null on any failure — never 0. */
  private refreshUnread = (): void => {
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.CHAT_UNREAD_COUNT)
      .then((n: unknown) => {
        this.setState({ unreadChats: typeof n === 'number' ? n : null });
      })
      .catch(() => { this.setState({ unreadChats: null }); });
  };

  /**
   * The collapsed tab's two signals.
   *
   * Both are fleet-wide. An earlier version scoped them to the site on screen, but that
   * branch never ran — readSiteId matched `/site-info/...` while Local pushes
   * `/main/site-info/<id>` — so the tab had always shown the fleet figure regardless.
   * Rather than repair scoping nobody had seen, the badge is now one honest global count.
   */
  private tabSignals(): { badgeCount: number | null; hasStuck: boolean | null } {
    const { unreadChats, fleetHealth } = this.state;
    return {
      badgeCount: unreadChats,
      hasStuck: fleetHealth === null ? null : fleetHealth === 'degraded' || fleetHealth === 'failing',
    };
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

    // Chat is the panel's only content now that Insights is gone.
    const panelContent = React.createElement(PanelChat, {
      ref: this.chatRef,
      electron: this.props.electron,
      sessionId: activeSessionId,
      selectedSiteIds,
      visible: panelState !== 'closed',
      onSessionCreated: (id: string) => this.setState({ activeSessionId: id }),
      onSessionSaved: () => this.setState((s) => ({ sessionListVersion: s.sessionListVersion + 1 })),
      onStreamingStatusChange: (status: string | null) => this.setState({ streamingStatus: status }),
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
        railBottom: this.state.railBottom,
        railHidden: this.state.overlayOpen,
        onRailDragStart: this.startRailDrag,
        onSetActiveTab: this.setActiveTab,
        onOpen: this.handleRailOpen,
        onClose: this.closePanel,
        onSetPanelState: this.setSize,
        onNewChat: this.newChat,
        sessionsSidebar,
        showSessions,
        onToggleSessions: () => this.setState((s) => ({ showSessions: !s.showSessions })),
        streamingStatus: this.state.streamingStatus,
        isOverlay: reflowMode === 'overlay',
        ...this.tabSignals(),
      },
      panelContent,
    );
  }
}
