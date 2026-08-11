import React from 'react';
import { UI_COLORS } from '../../../common/constants';

export type PanelState = 'closed' | 'docked' | 'wide' | 'full';
export type PanelTab = 'insights' | 'chat';

export interface Props {
  panelState: PanelState;
  activeTab?: PanelTab;
  onSetActiveTab?: (tab: PanelTab) => void;
  onOpen: () => void;
  onClose: () => void;
  onSetPanelState: (state: PanelState) => void;
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

export const PANEL_WIDTH = 384;
export const WIDE_WIDTH = 620;
const RAIL_WIDTH = 48;

// ── SVG icon components (24×24 viewBox, rendered at 17px in header) ───────────

function NexusGlyph({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: UI_COLORS.NEXUS_MARK, style: { display: 'block' } },
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

function IconChevronLeft({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
    React.createElement('path', { d: 'M15 18l-6-6 6-6' }),
  );
}

function IconWide({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
    React.createElement('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
    React.createElement('path', { d: 'M9 5v14' }),
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function iconBtnStyle(hovered: boolean, active = false) {
  return {
    background: hovered || active ? 'var(--nxai-table-hover)' : 'none',
    border: 'none',
    color: active ? UI_COLORS.WPE_BRAND : hovered ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
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
  rail: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: RAIL_WIDTH,
    background: 'var(--nxai-card-bg)',
    borderLeft: `1px solid var(--nxai-card-border)`,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '14px 0',
    gap: 14,
    zIndex: 8999,
    userSelect: 'none' as const,
    pointerEvents: 'all' as const,
  },
  railExpand: {
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--nxai-card-sub)',
  },
  railMark: {
    position: 'relative' as const,
    width: 38,
    height: 38,
    borderRadius: 8,
    background: 'var(--nxai-rail-mark-bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  railBadge: {
    position: 'absolute' as const,
    top: -5,
    right: -8,
    minWidth: 18,
    height: 15,
    padding: '0 4px',
    borderRadius: 3,
    background: UI_COLORS.WPE_BRAND,
    color: 'var(--nxai-accent-text)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 0 2px var(--nxai-rail-badge-shadow)',
  },
  railLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--nxai-card-sub)',
    writingMode: 'vertical-rl' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  railStuck: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: 'var(--nxai-rail-stuck-bg)',
    color: 'var(--nxai-rail-stuck-text)',
    fontSize: 16,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: (state: PanelState) => ({
    position: 'fixed' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: state === 'full' ? undefined : state === 'wide' ? WIDE_WIDTH : PANEL_WIDTH,
    left: state === 'full' ? 68 : undefined,
    background: 'var(--nxai-card-bg)',
    borderLeft: `1px solid var(--nxai-card-border)`,
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
    borderBottom: `1px solid var(--nxai-card-border)`,
    flexShrink: 0,
    background: 'var(--nxai-card-bg)',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: '50%' as const,
    background: UI_COLORS.WPE_BRAND,
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
      panelState, activeTab = 'chat', onSetActiveTab, onOpen, onClose, onSetPanelState, onNewChat,
      children, sessionsSidebar, onToggleSessions, showSessions, streamingStatus,
    } = this.props;

    // Render 48px rail when closed
    if (panelState === 'closed') {
      // Badge and stuck marker omitted: scope is unknown (see docs/planning/2026-08-11-rail-signal-gap.md).
      // The panel is mounted globally and cannot determine if it's on a site screen or fleet screen
      // without parsing window.location (forbidden) or accessing router context (unavailable).
      // Per spec, both indicators must scope together — showing a fleet count on a site screen is
      // false information. Omitting them is honest; showing the wrong number is a lie.
      const badgeCount = null; // omitted where scope unknown
      const hasStuck = null;   // omitted where scope unknown
      const railLabel = 'NEXUS AI'; // generic, no scope claim

      return React.createElement(
        'div',
        {
          style: styles.rail,
          'aria-label': 'Nexus AI panel (closed)',
        },
        // Expand chevron
        React.createElement(
          'div',
          {
            style: styles.railExpand,
            onClick: onOpen,
            title: 'Expand panel',
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onOpen(); },
          },
          React.createElement(IconChevronLeft, { size: 18 }),
        ),
        // Nexus mark with badge
        React.createElement(
          'div',
          {
            style: styles.railMark,
            onClick: onOpen,
            title: 'Open Nexus AI panel', // generic, no scope claim
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onOpen(); },
          },
          React.createElement(NexusGlyph, { size: 18 }),
          badgeCount !== null && badgeCount > 0
            ? React.createElement('div', { style: styles.railBadge }, String(badgeCount))
            : null,
        ),
        // Vertical label
        React.createElement('div', { style: styles.railLabel }, railLabel),
        // Spacer
        React.createElement('div', { style: { flex: 1 } }),
        // Stuck marker at bottom (only when hasStuck is true, never when null/unknown)
        hasStuck === true
          ? React.createElement('div', { style: styles.railStuck, title: 'Agent stuck' }, '!')
          : null,
      );
    }

    // Panel is open (docked, wide, or full)
    const isFull = panelState === 'full';

    // Segmented control for Insights / Chat
    const segmentedControl = React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          background: 'var(--nxai-table-hover)',
          borderRadius: 6,
          padding: 2,
          gap: 2,
        },
      },
      React.createElement(
        'button',
        {
          style: {
            background: activeTab === 'insights' ? 'var(--nxai-card-bg)' : 'transparent',
            border: 'none',
            color: activeTab === 'insights' ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
            cursor: 'pointer',
            padding: '5px 11px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 5,
            transition: 'all 0.15s ease',
          },
          onClick: () => onSetActiveTab?.('insights'),
          'aria-label': 'Insights',
        },
        'Insights',
      ),
      React.createElement(
        'button',
        {
          style: {
            background: activeTab === 'chat' ? 'var(--nxai-card-bg)' : 'transparent',
            border: 'none',
            color: activeTab === 'chat' ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
            cursor: 'pointer',
            padding: '5px 11px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 5,
            transition: 'all 0.15s ease',
          },
          onClick: () => onSetActiveTab?.('chat'),
          'aria-label': 'Chat',
        },
        'Chat',
      ),
    );

    const header = React.createElement(
      'div',
      { style: styles.header },
      // Brand block — avatar
      React.createElement('div', { style: styles.avatar }, React.createElement(NexusGlyph, { size: 18 })),
      // Brand block — title stack
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column' as const, gap: 1 } },
        React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: 'var(--nxai-card-text)', lineHeight: 1.2 } }, 'Nexus'),
        streamingStatus
          ? React.createElement(
              'span',
              { style: { fontSize: 12, color: UI_COLORS.WPE_BRAND, lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 5 } },
              React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: UI_COLORS.WPE_BRAND, flexShrink: 0, display: 'inline-block' } }),
              streamingStatus,
            )
          : React.createElement('span', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', lineHeight: 1.2 } }, 'Follows you across tabs'),
      ),
      // Segmented control
      segmentedControl,
      // Control cluster
      React.createElement(
        'div',
        { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 } },
        // #1 Sessions — docked and wide only (null in full)
        isFull ? null : React.createElement(
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
        ),
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
        // #3 Contract (wide only) — back to docked
        panelState === 'wide' ? React.createElement(
          'button',
          {
            style: iconBtnStyle(this.hov('contract-docked')),
            onClick: () => onSetPanelState('docked'),
            title: 'Back to docked',
            'aria-label': 'Back to docked',
            onMouseEnter: this.onEnter('contract-docked'),
            onMouseLeave: this.onLeave(),
          },
          React.createElement(IconContract, { size: 17 }),
        ) : null,
        // #4 Expand (docked→wide, wide→full) OR Contract (full→docked)
        panelState === 'docked'
          ? React.createElement(
              'button',
              {
                style: iconBtnStyle(this.hov('expand')),
                onClick: () => onSetPanelState('wide'),
                title: 'Wide view',
                'aria-label': 'Wide view',
                onMouseEnter: this.onEnter('expand'),
                onMouseLeave: this.onLeave(),
              },
              React.createElement(IconWide, { size: 17 }),
            )
          : panelState === 'wide'
          ? React.createElement(
              'button',
              {
                style: iconBtnStyle(this.hov('expand')),
                onClick: () => onSetPanelState('full'),
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
                onClick: () => onSetPanelState('docked'),
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
            { style: { width: 264, flexShrink: 0, borderRight: `1px solid var(--nxai-card-border)`, overflow: 'hidden' } },
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
                { style: { position: 'absolute' as const, inset: 0, background: 'var(--nxai-card-bg)', zIndex: 1 } },
                sessionsSidebar ?? null,
              )
            : null,
          children ?? null,
        );

    return React.createElement(
      'div',
      { style: styles.panel(panelState), role: 'complementary', 'aria-label': 'Nexus AI chat panel' },
      header,
      body,
    );
  }
}
