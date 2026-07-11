/* eslint-disable @typescript-eslint/no-explicit-any */
const React = require('react');

type PanelSize = 'docked' | 'full';

interface ContainerState {
  open: boolean;
  size: PanelSize;
  activeSessionId: string | null;
}

const STORAGE_KEY = 'nexus-panel-state';
const REFLOW_STYLE_ID = 'nexus-panel-reflow';

function readState(): ContainerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        open: Boolean(parsed.open),
        size: parsed.size === 'full' ? 'full' : 'docked',
        activeSessionId: parsed.activeSessionId ?? null,
      };
    }
  } catch { /* ignore */ }
  return { open: false, size: 'docked', activeSessionId: null };
}

export class DockedPanelContainer extends React.Component<any, ContainerState> {
  constructor(props: {}) {
    super(props);
    this.state = readState();
    this.openPanel = this.openPanel.bind(this);
    this.closePanel = this.closePanel.bind(this);
    this.setSize = this.setSize.bind(this);
    this.setActiveSession = this.setActiveSession.bind(this);
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
    this.syncReflowStyle();
  }

  componentWillUnmount() {
    this.removeReflowStyle();
  }

  private syncReflowStyle() {
    if (this.state.open && this.state.size === 'docked') {
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
    style.textContent = `[class*="SiteInfo_"], [class*="Dashboard_"], [class*="siteinfo-wrapper"] { margin-right: 384px !important; transition: margin-right 0.2s ease; }`;
    document.head.appendChild(style);
  }

  private removeReflowStyle() {
    const el = document.getElementById(REFLOW_STYLE_ID);
    if (el) el.remove();
  }

  openPanel() {
    this.setState({ open: true });
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

  render() {
    const { open, size, activeSessionId } = this.state;

    // DockedPanel component wired in Task 6
    return React.createElement(
      'div',
      { id: 'nexus-docked-panel-root' },
      // placeholder — Task 6 wires in DockedPanel
      null,
    );
  }
}
