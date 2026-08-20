import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import type { TriageView } from '../../../main/intelligence-host/sessionRegistry';
import { arrivalCounts } from '../return/arrivalModel';
import { openingState, type OpeningState } from './openingAsksModel';
import { injectThemeVars } from '../../utils/theme';
import { DockedPanel, PanelTab } from './DockedPanel';
import { PanelChat, type SiteContextProps } from './PanelChat';
import type { SiteChoice } from './SiteContextStrip';
import {
  readViewedSiteId,
  resolveSiteContext,
  selectionSiteIds,
  asContentStatus,
  type SiteContentStatus,
} from './siteContextModel';
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
  /**
   * The site page Local is currently showing, or null on every other screen. Read from
   * Local's own shell, not stored — navigation is the source, so it is re-read rather
   * than remembered.
   */
  viewedSiteId: string | null;
  /**
   * A site the user pinned explicitly. It BEATS the route and survives navigation until
   * cleared — a user who pins a site and then walks around Local is still asking about
   * the site they pinned. Deliberately not persisted: a pin that outlived the window
   * would silently scope tomorrow's first question to a site nobody chose today.
   */
  siteOverride: string | null;
  /** Local's sites, for naming the current one and for the strip's picker. */
  siteChoices: SiteChoice[];
  /**
   * WP-22b · what the record says about the SELECTED site's content — where it was
   * pulled from and how far behind it is.
   *
   * Null means "nothing to show", and covers three situations on purpose: the read
   * has not answered yet, Nexus AI is not recording, or the read failed. None of them
   * is a fact about the copy, and none of them may put a word on the band. The three
   * facts that ARE about the copy (`no-sync`, `ambiguous`, `unlinked`) arrive as
   * states and are still not rendered — the chip speaks only for `pulled` (WP-16
   * doctrine: omit, never "unknown").
   */
  contentStatus: SiteContentStatus | null;
  streamingStatus: string | null;
  reflowMode: 'in-flow' | 'overlay';
  /** Sessions whose newest message is from the assistant and arrived unseen. */
  unreadChats: number | null;
  /**
   * WP-46 · situations currently escalating — the waiting column's length.
   *
   * XD-23: the ambient badge is an INSTRUMENT, NOT AN INVENTORY. It counts what
   * is escalating right now, which is what the arrival's waiting column holds
   * and nothing else. null until it loads, never coerced to 0.
   */
  needsYou: number | null;
  /**
   * WP-49 · ITEM 4 — the panel's opening state, from the SAME read as the badge.
   *
   * One `RETURN_TRIAGE` call answers both, which is the property `refreshNeedsYou`
   * already had and the reason the opening state is derived here rather than
   * fetched in `PanelChat`: a second read is a second answer, free to disagree
   * with the number on the rail beside it.
   */
  opening: OpeningState | null;
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

/**
 * Site context starts EMPTY, not guessed.
 *
 * `viewedSiteId` is filled by `refreshViewedSite()` on mount, from Local's own shell,
 * rather than read in the constructor: the constructor runs in tests with no DOM, and a
 * container that reads the route at construction time is a container that cannot be
 * built without one. React 16 flushes a `componentDidMount` setState before paint, so
 * the empty first render is never seen.
 */
const SITE_CONTEXT_DEFAULTS = {
  viewedSiteId: null as string | null,
  siteOverride: null as string | null,
  siteChoices: [] as SiteChoice[],
  contentStatus: null as SiteContentStatus | null,
};

const SIGNAL_DEFAULTS = {
  unreadChats: null as number | null,
  needsYou: null as number | null,
  opening: null as OpeningState | null,
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
        ...SITE_CONTEXT_DEFAULTS,
        streamingStatus: null,
        // Overlay is the fail-safe default: it reserves nothing, so a panel that renders
        // before applyReflow() runs draws correctly instead of assuming space it never got.
        reflowMode: 'overlay',
        ...SIGNAL_DEFAULTS,
      };
    }
  } catch { /* ignore */ }
  return { panelState: 'closed', activeTab: 'chat', activeSessionId: null, showSessions: false, sessionListVersion: 0, ...SITE_CONTEXT_DEFAULTS, streamingStatus: null, reflowMode: 'overlay', ...SIGNAL_DEFAULTS };
}

export class DockedPanelContainer extends React.Component<ContainerProps, ContainerState> {
  private openSessionListener: ((_: any, payload: { sessionId: string }) => void) | null = null;
  private chatRef = React.createRef<PanelChat>();
  private localRoot: HTMLElement | null = null;
  private unreadListener: (() => void) | null = null;
  private storeUnsub: (() => void) | null = null;
  private railWasDragged = false;
  private resizeDebounceTimer: number | null = null;
  private locationObserver: MutationObserver | null = null;
  /** Ids we have already re-fetched the site list for, so a genuinely unknown id
   *  costs one extra call rather than one per navigation back to it. */
  private siteFetchAttempted = new Set<string>();
  /** True once `GET_SITES` has answered. Until then an unknown id means "not loaded
   *  yet", not "new site" — without this, mount fetches the list twice. */
  private siteChoicesLoaded = false;
  /** The site the in-flight content read is FOR. A reply for anything else is stale
   *  and dropped: one site's content age beside another site's name would be a
   *  confident wrong answer, which is worse than the chip being absent. */
  private contentRequestFor: string | null = null;

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
    this.setupSiteContext();
    // Deep-link: open panel and activate a specific session from the Activity tab.
    // Receives from Activity tab "View chat →" link once activity events carry session_id.
    this.openSessionListener = (_: any, { sessionId }: { sessionId: string }) => {
      this.setState({ panelState: 'docked', activeSessionId: sessionId, activeTab: 'chat' });
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.OPEN_CHAT_SESSION, this.openSessionListener);
  }

  componentWillUnmount() {
    this.teardownReflow();
    this.teardownSiteContext();
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
      // NEXUS-DOM-REACH: window-right-reservation
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
    this.refreshNeedsYou();

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

  // ── Site context ───────────────────────────────────────────────────────────────
  //
  // The panel is mounted on `document.body`, OUTSIDE Local's router (see
  // `renderer/index.tsx`), so there is no route prop to read and no history to
  // subscribe to. Local publishes its current path on its own shell instead —
  // `<div class="Window" data-location={currentPath}>` from `app/renderer/app/
  // MainPage.tsx` — which makes the site on screen a DOM fact rather than an inference.
  //
  // Two listeners, because either one alone has a hole: the attribute mutation catches
  // navigation WITHIN the main window (React updates the attribute in place), and
  // `hashchange` catches the case where the shell element is replaced rather than
  // updated (Local uses HashHistory, so every route change fires it). Both funnel into
  // one idempotent re-read.

  private setupSiteContext(): void {
    this.refreshViewedSite();
    this.loadSiteChoices();
    this.refreshContentStatus();

    try {
      window.addEventListener('hashchange', this.refreshViewedSite);
      // NEXUS-DOM-REACH: window-data-location-read
      this.locationObserver = new MutationObserver(this.refreshViewedSite);
      this.locationObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-location'],
        subtree: true,
      });
    } catch {
      // No DOM to observe (or no MutationObserver). The strip then reports what it
      // honestly knows — nothing — rather than the panel failing to mount.
    }
  }

  private teardownSiteContext(): void {
    window.removeEventListener('hashchange', this.refreshViewedSite);
    if (this.locationObserver) {
      this.locationObserver.disconnect();
      this.locationObserver = null;
    }
  }

  /**
   * The route Local is showing.
   *
   * `querySelector` returns the FIRST match in document order, which is the outer shell:
   * some screens (CreateSite, PullSite) render their own `Window` nested inside
   * MainPage's, and the outer one is the one carrying the real current path.
   *
   * Falls back to the hash, which carries the same route, for the case where the shell
   * has not rendered yet.
   */
  currentLocation(): string | null {
    try {
      // NEXUS-DOM-REACH: window-data-location-read
      const shell = document.querySelector('.Window[data-location]');
      const attr = shell && shell.getAttribute('data-location');
      if (attr) return attr;
      return window.location.hash || null;
    } catch {
      return null;
    }
  }

  /** Re-read the route. Idempotent — both listeners call it, and so does mount. */
  refreshViewedSite = (): void => {
    const next = readViewedSiteId(this.currentLocation());
    if (next === this.state.viewedSiteId) return;
    this.setState({ viewedSiteId: next });
    // A site created since the list was loaded has no name yet. One re-fetch per
    // unknown id, so a name we will never learn does not become a fetch per keystroke
    // of navigation.
    if (next && this.siteChoicesLoaded && !this.siteFetchAttempted.has(next) && !this.state.siteChoices.some((s) => s.id === next)) {
      this.siteFetchAttempted.add(next);
      this.loadSiteChoices();
    }
    this.refreshContentStatus();
  };

  /**
   * WP-22b · ask what the record says about the selected copy's content.
   *
   * Fire-and-forget, and deliberately so: the chip is detail on a band whose job is
   * to say which site the chat is scoped to, and that job is already done from props
   * the container holds. Nothing here is awaited, nothing gates the composer, and
   * every failure path — no core, no channel, a throw, a shape we don't recognise —
   * lands on the same `null`, which renders as the band exactly as WP-22 shipped it.
   *
   * Keyed on the SELECTED site (pin beats route, same rule as everything else here),
   * so pinning a site re-reads for the site the answers are about, not the one on
   * screen.
   */
  refreshContentStatus = (): void => {
    const { siteId } = resolveSiteContext(this.state.viewedSiteId, this.state.siteOverride);
    if (siteId === this.contentRequestFor) return;
    this.contentRequestFor = siteId;
    // Clear FIRST: the previous site's age must never sit under the new site's name
    // for the length of a round trip.
    if (this.state.contentStatus) this.setState({ contentStatus: null });
    if (!siteId) return;

    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.GET_SITE_CONTENT_STATUS, siteId)
      .then((status: unknown) => {
        if (this.contentRequestFor !== siteId) return; // answered for a site we left
        this.setState({ contentStatus: asContentStatus(status) });
      })
      .catch(() => {
        if (this.contentRequestFor === siteId) this.setState({ contentStatus: null });
      });
  };

  /**
   * Local's sites, for the strip's name and its picker. Failure leaves the list empty.
   *
   * `GET_SITES` is deliberately the local-only channel, not `GET_SITE_ROWS` (the whole
   * fleet). The band says "your copy", which is true of a Local site and false of a WP
   * Engine install or an SSH host — offering those in this picker would put a sentence
   * on screen that is not true of the thing the user just picked. A fleet-wide scope
   * picker is a different surface with different words.
   */
  loadSiteChoices = (): void => {
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.GET_SITES)
      .then((sites: unknown) => {
        this.siteChoicesLoaded = true;
        if (!Array.isArray(sites)) return;
        const choices: SiteChoice[] = sites
          .filter((s: any) => s && typeof s.id === 'string')
          .map((s: any) => ({ id: s.id, name: typeof s.name === 'string' && s.name ? s.name : s.id }))
          .sort((a, b) => a.name.localeCompare(b.name));
        this.setState({ siteChoices: choices });
      })
      .catch(() => { /* leaves the list empty — the strip falls back to the id, never blocks */ });
  };

  /**
   * The name to show for a site id.
   *
   * Falls back to the id rather than to a placeholder or an empty band: the id is ugly
   * and true, and it appears only in the moment before the list arrives (or for a site
   * Local's own store no longer lists). "Currently in: — your copy" would be worse.
   */
  siteNameFor(siteId: string | null): string | null {
    if (!siteId) return null;
    const match = this.state.siteChoices.find((s) => s.id === siteId);
    return match ? match.name : siteId;
  }

  /** Pin a site. Beats navigation until cleared. */
  pickSite = (siteId: string): void => {
    this.setState({ siteOverride: siteId });
    this.refreshContentStatus();
    try { track(this.props.electron.ipcRenderer, 'nexus_panel_site_pinned', {}); } catch (_) {}
  };

  /** Drop the pin and follow the screen again. */
  clearSiteOverride = (): void => {
    this.setState({ siteOverride: null });
    this.refreshContentStatus();
  };

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
   * WP-46 · how many situations are escalating. null on any failure — never 0.
   *
   * READS `RETURN_TRIAGE` AND COUNTS THE ROWS IT WOULD RENDER. The count is not
   * asked for separately, because a badge served by its own query is a second
   * answer to the question the arrival answers, free to disagree with the column
   * beneath it. `arrivalCounts` is the same function the arrival's own header
   * uses.
   */
  private refreshNeedsYou = (): void => {
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.RETURN_TRIAGE)
      .then((triage: TriageView) => {
        this.setState({
          needsYou: triage ? arrivalCounts(triage).needsYou : null,
          opening: openingState(triage),
        });
      })
      .catch(() => { this.setState({ needsYou: null, opening: null }); });
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
    const { needsYou, fleetHealth } = this.state;
    return {
      // WP-46 · the rail badge is the WAITING COUNT (XD-23/XD-26), not the unread
      // chat count. The two answer different questions and only one of them is
      // what the ambient rank is for: a chat awaiting a reply is a conversation,
      // while a waiting SITUATION is a gate or a halt that cannot move without
      // this person. `unreadChats` is still collected and still marks sessions
      // read — it is the sessions list's own signal — and it is no longer what
      // the rail escalates with.
      badgeCount: needsYou,
      hasStuck: fleetHealth === null ? null : fleetHealth === 'degraded' || fleetHealth === 'failing',
    };
  }

  private applyReflow() {
    const hostRoot = this.localRoot;
    const reflowMode = computeReflowMode(this.state.panelState, window.innerWidth, hostRoot !== null);
    if (hostRoot) {
      const reserved = computeReservedWidth(this.state.panelState, reflowMode);
      // NEXUS-DOM-REACH: window-right-reservation
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
    const { panelState, activeTab, activeSessionId, showSessions, sessionListVersion, viewedSiteId, siteOverride, siteChoices, contentStatus, reflowMode } = this.state;

    // ONE source, read twice: the ids that ride on CHAT_SEND and the band the user reads
    // are both derived from the same selection here, which is what stops the chat from
    // answering about one site while the strip names another.
    const selection = resolveSiteContext(viewedSiteId, siteOverride);
    const selectedSiteIds = selectionSiteIds(selection);
    const siteContext: SiteContextProps = {
      mode: selection.mode,
      siteName: this.siteNameFor(selection.siteId),
      viewedSiteName: this.siteNameFor(viewedSiteId),
      sites: siteChoices,
      // The chip's fact comes from the same selection the band and the outgoing id
      // do — a content age read for one site and shown beside another's name is the
      // disagreement this whole module exists to make impossible.
      content: contentStatus,
      onPick: this.pickSite,
      onClear: this.clearSiteOverride,
    };

    // Chat is the panel's only content now that Insights is gone.
    const panelContent = React.createElement(PanelChat, {
      ref: this.chatRef,
      electron: this.props.electron,
      sessionId: activeSessionId,
      selectedSiteIds,
      siteContext,
      opening: this.state.opening,
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
