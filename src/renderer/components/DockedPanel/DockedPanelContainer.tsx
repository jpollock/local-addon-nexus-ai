import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { injectThemeVars } from '../../utils/theme';
import { ContextSelector } from './ContextSelector';
import { DockedPanel, PanelTab, PANEL_WIDTH, WIDE_WIDTH } from './DockedPanel';
import { PanelChat } from './PanelChat';
import { PanelInsights } from './PanelInsights';
import { SessionsSidebar } from './SessionsSidebar';

type PanelState = 'closed' | 'docked' | 'wide' | 'full';

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
      };
    }
  } catch { /* ignore */ }
  return { panelState: 'closed', activeTab: 'chat', activeSessionId: null, showSessions: false, sessionListVersion: 0, selectedSiteIds: [], streamingStatus: null };
}

export class DockedPanelContainer extends React.Component<ContainerProps, ContainerState> {
  private openSessionListener: ((_: any, payload: { sessionId: string }) => void) | null = null;
  private chatRef = React.createRef<PanelChat>();

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
    this.syncReflowStyle();
  }

  componentDidMount() {
    injectThemeVars();
    this.syncReflowStyle();
    // Deep-link: open panel and activate a specific session from the Activity tab.
    // Receives from Activity tab "View chat →" link once activity events carry session_id.
    this.openSessionListener = (_: any, { sessionId }: { sessionId: string }) => {
      this.setState({ panelState: 'docked', activeSessionId: sessionId, activeTab: 'chat' });
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
    if (this.state.panelState === 'docked' || this.state.panelState === 'wide') {
      this.injectReflowStyle();
    } else {
      this.removeReflowStyle();
    }
  }

  private injectReflowStyle() {
    const marginRight = this.state.panelState === 'wide' ? WIDE_WIDTH : PANEL_WIDTH;
    const existing = document.getElementById(REFLOW_STYLE_ID);
    if (existing) {
      // Update existing style element on size change
      existing.textContent = `[class*="SiteInfo_"], [class*="Dashboard_"], [class*="siteinfo-wrapper"] { margin-right: ${marginRight}px !important; transition: margin-right 0.2s ease; }`;
    } else {
      // Create new style element
      const style = document.createElement('style');
      style.id = REFLOW_STYLE_ID;
      style.textContent = `[class*="SiteInfo_"], [class*="Dashboard_"], [class*="siteinfo-wrapper"] { margin-right: ${marginRight}px !important; transition: margin-right 0.2s ease; }`;
      document.head.appendChild(style);
    }
  }

  private removeReflowStyle() {
    const el = document.getElementById(REFLOW_STYLE_ID);
    if (el) el.remove();
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
    const { panelState, activeTab, activeSessionId, showSessions, sessionListVersion, selectedSiteIds } = this.state;

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

    // ContextSelector hidden — site scope selection not yet exposed in UI
    const panelBody = panelContent;

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
      },
      panelBody,
    );
  }
}
