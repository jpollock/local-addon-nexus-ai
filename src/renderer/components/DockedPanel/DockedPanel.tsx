import React from 'react';

export type PanelSize = 'docked' | 'full';

export interface Props {
  open: boolean;
  size: PanelSize;
  onOpen: () => void;
  onClose: () => void;
  onSetSize: (size: PanelSize) => void;
  onNewChat?: () => void;
  children?: React.ReactNode;
  sessionsSidebar?: React.ReactNode;
  onToggleSessions?: () => void;
  showSessions?: boolean;
  streamingStatus?: string | null;
}

interface DockedPanelState {
  hoveredBtn: string | null;
}

const PANEL_WIDTH = 384;
const BUBBLE_SIZE = 52;

// ── SVG icon components (24×24 viewBox, rendered at 17px in header) ───────────

function NexusGlyph({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: '#05262e', style: { display: 'block' } },
    React.createElement('path', { d: 'M12 2l2.2 6.2L20 10l-5.8 1.8L12 18l-2.2-6.2L4 10l5.8-1.8z' }),
  );
}

function IconSessions({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
    React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
    React.createElement('path', { d: 'M12 7v5l3.5 2' }),
  );
}

function IconNewChat({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
    React.createElement('path', { d: 'M12 5v14M5 12h14' }),
  );
}

function IconExpand({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
    React.createElement('path', { d: 'M9 3H3v6M21 9V3h-6M9 21H3v-6M15 21h6v-6' }),
  );
}

function IconContract({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
    React.createElement('path', { d: 'M3 9h6V3M21 15h-6v6M15 3v6h6M9 21v-6H3' }),
  );
}

function IconCollapse({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
    React.createElement('path', { d: 'M13 6l6 6-6 6M6 6l6 6-6 6' }),
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function iconBtnStyle(hovered: boolean, active = false) {
  return {
    background: hovered || active ? '#22303a' : 'none',
    border: 'none',
    color: active ? '#5fd2e5' : hovered ? '#e4e7ec' : '#868d98',
    cursor: 'pointer',
    padding: 6,
    display: 'flex',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  };
}

const styles = {
  bubble: {
    position: 'fixed' as const,
    bottom: 20,
    right: 20,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #29b6cf, #1fc0d8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    zIndex: 9000,
    userSelect: 'none' as const,
    pointerEvents: 'all' as const,
  },
  panel: (full: boolean) => ({
    position: 'fixed' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: full ? undefined : PANEL_WIDTH,
    left: full ? 68 : undefined,
    background: '#23272f',
    borderLeft: '1px solid #2c313a',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 8999,
    fontFamily: 'inherit',
    pointerEvents: 'all' as const,
  }),
  header: {
    padding: '15px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    borderBottom: '1px solid #2c313a',
    flexShrink: 0,
    background: '#1a1e24',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: '50%' as const,
    background: 'linear-gradient(135deg, #29b6cf, #1fc0d8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  panelBody: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    position: 'relative' as const,
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export class DockedPanel extends React.Component<Props, DockedPanelState> {
  constructor(props: Props) {
    super(props);
    this.state = { hoveredBtn: null };
  }

  private hov(id: string) { return this.state.hoveredBtn === id; }
  private onEnter(id: string) { return () => this.setState({ hoveredBtn: id }); }
  private onLeave() { return () => this.setState({ hoveredBtn: null }); }

  render() {
    const {
      open, size, onOpen, onClose, onSetSize, onNewChat,
      children, sessionsSidebar, onToggleSessions, showSessions, streamingStatus,
    } = this.props;

    if (!open) {
      return React.createElement(
        'div',
        {
          style: styles.bubble,
          onClick: onOpen,
          title: 'Open Nexus',
          'aria-label': 'Open Nexus AI chat panel',
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onOpen(); },
        },
        React.createElement(NexusGlyph, { size: 26 }),
      );
    }

    const isFull = size === 'full';

    const header = React.createElement(
      'div',
      { style: styles.header },
      // Brand block — avatar
      React.createElement('div', { style: styles.avatar }, React.createElement(NexusGlyph, { size: 18 })),
      // Brand block — title stack
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column' as const, gap: 1 } },
        React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: '#f2f4f6', lineHeight: 1.2 } }, 'Nexus'),
        streamingStatus
          ? React.createElement(
              'span',
              { style: { fontSize: 12, color: '#5fd2e5', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 5 } },
              React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: '#5fd2e5', flexShrink: 0, display: 'inline-block' } }),
              streamingStatus,
            )
          : React.createElement('span', { style: { fontSize: 12, color: '#868d98', lineHeight: 1.2 } }, 'Follows you across tabs'),
      ),
      // Control cluster
      React.createElement(
        'div',
        { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 } },
        // #1 Sessions — docked only
        !isFull ? React.createElement(
          'button',
          {
            style: iconBtnStyle(this.hov('sessions'), showSessions),
            onClick: onToggleSessions,
            title: 'Sessions',
            'aria-label': 'Sessions',
            onMouseEnter: this.onEnter('sessions'),
            onMouseLeave: this.onLeave(),
          },
          React.createElement(IconSessions, { size: 17 }),
        ) : null,
        // #2 New chat — always
        React.createElement(
          'button',
          {
            style: iconBtnStyle(this.hov('new')),
            onClick: onNewChat,
            title: 'New chat',
            'aria-label': 'New chat',
            onMouseEnter: this.onEnter('new'),
            onMouseLeave: this.onLeave(),
          },
          React.createElement(IconNewChat, { size: 17 }),
        ),
        // #3 Expand / #4 Contract — same slot, swapped by state
        !isFull
          ? React.createElement(
              'button',
              {
                style: iconBtnStyle(this.hov('expand')),
                onClick: () => onSetSize('full'),
                'aria-label': 'Expand to full screen',
                onMouseEnter: this.onEnter('expand'),
                onMouseLeave: this.onLeave(),
              },
              React.createElement(IconExpand, { size: 17 }),
            )
          : React.createElement(
              'button',
              {
                style: iconBtnStyle(this.hov('contract')),
                onClick: () => onSetSize('docked'),
                'aria-label': 'Back to docked',
                onMouseEnter: this.onEnter('contract'),
                onMouseLeave: this.onLeave(),
              },
              React.createElement(IconContract, { size: 17 }),
            ),
        // #5 Collapse — always
        React.createElement(
          'button',
          {
            style: iconBtnStyle(this.hov('collapse')),
            onClick: onClose,
            'aria-label': 'Collapse to bubble',
            onMouseEnter: this.onEnter('collapse'),
            onMouseLeave: this.onLeave(),
          },
          React.createElement(IconCollapse, { size: 17 }),
        ),
      ),
    );

    const body = isFull
      ? React.createElement(
          'div',
          { style: { display: 'flex', flex: 1, overflow: 'hidden' } },
          React.createElement(
            'div',
            { style: { width: 264, flexShrink: 0, borderRight: '1px solid #2c313a', overflow: 'hidden' } },
            sessionsSidebar ?? null,
          ),
          React.createElement(
            'div',
            { style: { flex: 1, maxWidth: 720, margin: '0 auto', overflow: 'hidden' } },
            children ?? null,
          ),
        )
      : React.createElement(
          'div',
          { style: styles.panelBody },
          showSessions
            ? React.createElement(
                'div',
                { style: { position: 'absolute' as const, inset: 0, background: '#1a1e24', zIndex: 1 } },
                sessionsSidebar ?? null,
              )
            : null,
          children ?? null,
        );

    return React.createElement(
      'div',
      { style: styles.panel(isFull), role: 'complementary', 'aria-label': 'Nexus AI chat panel' },
      header,
      body,
    );
  }
}
