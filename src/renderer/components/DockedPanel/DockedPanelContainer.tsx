import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { injectThemeVars } from '../../utils/theme';
import { ContextSelector } from './ContextSelector';
import { DockedPanel } from './DockedPanel';
import { PanelChat } from './PanelChat';
import { SessionsSidebar } from './SessionsSidebar';

type PanelSize = 'docked' | 'wide' | 'full';

interface ContainerProps {
  electron: any;
}

interface ContainerState {
  open: boolean;
  size: PanelSize;
  activeSessionId: string | null;
  showSessions: boolean;
  sessionListVersion: number;
  selectedSiteIds: string[];
  streamingStatus: string | null;
}

const STORAGE_KEY = 'nexus-panel-state';
const REFLOW_STYLE_ID = 'nexus-panel-reflow';

/** Fire-and-forget telemetry helper. Never throws. */
function track(ipcRenderer: any, event: string, properties: Record<string, unknown> = {}) {
  try { ipcRenderer.send(IPC_CHANNELS.TELEMETRY_TRACK, { event, properties }); } catch (_) {}
}

function readState(): ContainerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Accept all three valid sizes, coerce anything unrecognised to 'docked'
      const validSizes: PanelSize[] = ['docked', 'wide', 'full'];
      const size: PanelSize = validSizes.includes(parsed.size) ? parsed.size : 'docked';
      return {
        open: false, // always start collapsed — never block Local on load
        size,
        activeSessionId: parsed.activeSessionId ?? null,
        showSessions: false,
        sessionListVersion: 0,
        selectedSiteIds: [],
        streamingStatus: null,
      };
    }
  } catch { /* ignore */ }
  return { open: false, size: 'docked', activeSessionId: null, showSessions: false, sessionListVersion: 0, selectedSiteIds: [], streamingStatus: null };
}

export class DockedPanelContainer extends React.Component<ContainerProps, ContainerState> {
  private openSessionListener: ((_: any, payload: { sessionId: string }) => void) | null = null;

  constructor(props: ContainerProps) {
    super(props);
    this.state = readState();
    this.openPanel = this.openPanel.bind(this);
    this.closePanel = this.closePanel.bind(this);
    this.setSize = this.setSize.bind(this);
    this.setActiveSession = this.setActiveSession.bind(this);
    this.newChat = this.newChat.bind(this);
  }

  componentDidUpdate(_: {}, prevState: ContainerState) {
    const { open, size, activeSessionId } = this.state;
    if (
      prevState.open !== open ||
      prevState.size !== size ||
      prevState.activeSessionId !== activeSessionId
    ) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, size, activeSessionId }));
    }
    this.syncReflowStyle();
  }

  componentDidMount() {
    injectThemeVars();
    this.syncReflowStyle();
    // Deep-link: open panel and activate a specific session from the Activity tab.
    // Receives from Activity tab "View chat →" link once activity events carry session_id.
    this.openSessionListener = (_: any, { sessionId }: { sessionId: string }) => {
      this.setState({ open: true, activeSessionId: sessionId });
    };
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.OPEN_CHAT_SESSION, this.openSessionListener);
  }

  componentWillUnmount() {
    this.removeReflowStyle();
    if (this.openSessionListener) {
      this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.OPEN_CHAT_SESSION, this.openSessionListener);
      this.openSessionListener = null;
    }
  }

  private syncReflowStyle() {
    if (this.state.open && (this.state.size === 'docked' || this.state.size === 'wide')) {
      this.injectReflowStyle();
    } else {
      this.removeReflowStyle();
    }
  }

  private injectReflowStyle() {
    if (document.getElementById(REFLOW_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = REFLOW_STYLE_ID;
    // Target Local's content wrapper — confirmed via DOM inspection at build time.
    // Adjust selector if Local's class names change.
    const marginRight = this.state.size === 'wide' ? 620 : 384;
    style.textContent = `[class*="SiteInfo_"], [class*="Dashboard_"], [class*="siteinfo-wrapper"] { margin-right: ${marginRight}px !important; transition: margin-right 0.2s ease; }`;
    document.head.appendChild(style);
  }

  private removeReflowStyle() {
    const el = document.getElementById(REFLOW_STYLE_ID);
    if (el) el.remove();
  }

  openPanel() {
    this.setState({ open: true });
    try { track(this.props.electron.ipcRenderer, 'nexus_panel_opened', { size: this.state.size }); } catch (_) {}
  }

  closePanel() {
    this.setState({ open: false });
  }

  setSize(size: PanelSize) {
    this.setState({ size });
  }

  setActiveSession(id: string | null) {
    this.setState({ activeSessionId: id });
  }

  newChat() {
    this.setState({ activeSessionId: null, showSessions: false });
  }

  render() {
    const { open, size, activeSessionId, showSessions, sessionListVersion, selectedSiteIds } = this.state;

    const panelContent = React.createElement(PanelChat, {
      electron: this.props.electron,
      sessionId: activeSessionId,
      selectedSiteIds,
      onSessionCreated: (id: string) => this.setState({ activeSessionId: id }),
      onSessionSaved: () => this.setState((s) => ({ sessionListVersion: s.sessionListVersion + 1 })),
      onStreamingStatusChange: (status: string | null) => this.setState({ streamingStatus: status }),
    });

    // ContextSelector hidden — site scope selection not yet exposed in UI
    const panelBody = panelContent;

    const sessionsSidebar = size === 'full' || showSessions
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
        open,
        size,
        onOpen: this.openPanel,
        onClose: this.closePanel,
        onSetSize: this.setSize,
        onNewChat: this.newChat,
        sessionsSidebar,
        showSessions,
        onToggleSessions: () => this.setState((s) => ({ showSessions: !s.showSessions })),
        streamingStatus: this.state.streamingStatus,
      },
      panelBody,
    );
  }
}
