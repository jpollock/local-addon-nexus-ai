import React from 'react';
import { UI_COLORS } from '../../../common/constants';
import { MARK_VIEWBOX, MARK_RING, MARK_DOT, RING_MIN_SIZE } from '../../utils/nexusMark';

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
  isOverlay?: boolean;
  /** Chats waiting on a reply, fleet-wide. null = not knowable; renders nothing. */
  badgeCount?: number | null;
  /** Whether anything is stuck. null = not knowable; renders nothing. */
  hasStuck?: boolean | null;
}

interface DockedPanelState {
  hoveredBtn: string | null;
}

export const PANEL_WIDTH = 380;
export const WIDE_WIDTH = 620;
/**
 * The collapsed state is a floating tab, not a full-height strip. It overlays, reserves
 * nothing in Local's layout, and — because it never spans the full height — structurally
 * cannot sit in the header or footer band where Local's own actions ("Start site",
 * "Open site", "WP Admin") live. A 48px full-height rail did, which is how it clipped them.
 * Height is content-derived; only the width is fixed.
 *
 * 52px rather than the prototype's 44: at 44 against a white site screen the tab read as a
 * faint sliver — closer to a rendering artifact than a control — because the mark inside it
 * was too small to register. The border and shadow are literal values, not theme variables,
 * for the same reason: this edge has to be visible, so it does not get to be subtle.
 */
const TAB_WIDTH = 52;

/**
 * The collapsed tab's word. It used to carry scope -- 'THIS SITE' on a site screen,
 * 'INSIGHTS' otherwise -- but the scope half never actually rendered: readSiteId matched
 * `/site-info/...` while Local pushes `/main/site-info/<id>`, so every screen fell through
 * to the fleet branch. The badge is now a single fleet-wide figure, so there is one word.
 */
const RAIL_LABEL = 'NEXUS';

// ── SVG icon components (24×24 viewBox, rendered at 17px in header) ───────────

/**
 * The Orbit mark: a tilted ring with a solid centre. Replaces the four-point star.
 *
 * Geometry comes from `utils/nexusMark`, shared with the SVG-string renderer that injects
 * the same mark into Local's vertical nav. Two hand-maintained copies is how the panel
 * ended up showing a star while the nav showed a gauge dial.
 *
 * Colour comes from `currentColor` on the wrapper, never a fill on the svg — that is what
 * lets the same component sit on the tab, on the brand avatar, and on Local's green nav
 * without a hard-coded colour being invented for each.
 *
 * **The ring drops below RING_MIN_SIZE, automatically.** The threshold is applied here
 * rather than at the call sites: a rule every caller has to remember is one a caller will
 * eventually forget, and the failure is silent — a slightly grey smudge, not an error.
 *
 * Note the mark looks slightly larger than the star at the same declared size. The star
 * was symmetric about y=10 in a 24-unit box, so it sat two units high; Orbit is centred on
 * (12,12). That is the centring being corrected — do not shrink it to compensate.
 */
export { RING_MIN_SIZE };

export function NexusGlyph({ size }: { size: number }) {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: MARK_VIEWBOX, fill: 'none', style: { display: 'block' } },
    size >= RING_MIN_SIZE
      ? React.createElement('ellipse', {
          ...MARK_RING,
          fill: 'none',
          stroke: 'currentColor',
        })
      : null,
    React.createElement('circle', { ...MARK_DOT, fill: 'currentColor' }),
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
  // Vertically centred so it lands in the content band, clear of the header and footer
  // bands at the top and bottom of Local's screens. `bottom` is deliberately absent —
  // the tab's height comes from its contents.
  rail: {
    position: 'fixed' as const,
    top: '50%',
    right: 0,
    transform: 'translateY(-50%)',
    width: TAB_WIDTH,
    padding: '14px 0 16px',
    background: 'var(--nxai-card-bg)',
    // --nxai-card-border already resolves to the requested light-theme edge colour, and to
    // a dark equivalent in dark theme. Hardcoding the light value fails the no-raw-hex
    // guard in panel-theme.test.ts and leaves a near-invisible border on a dark screen.
    border: `1px solid var(--nxai-card-border)`,
    borderRight: 'none',
    borderRadius: '11px 0 0 11px',
    boxShadow: '-2px 0 10px rgba(17, 24, 39, 0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 9,
    cursor: 'pointer',
    zIndex: 8999,
    userSelect: 'none' as const,
    pointerEvents: 'all' as const,
  },
  railMark: {
    position: 'relative' as const,
    width: 34,
    height: 34,
    borderRadius: 8,
    background: 'var(--nxai-rail-mark-bg)',
    // The mark reads currentColor — the wrapper is where its colour is decided.
    color: UI_COLORS.NEXUS_MARK,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBadge: {
    position: 'absolute' as const,
    top: -5,
    right: -7,
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
    fontSize: 10,
    fontWeight: 800,
    color: 'var(--nxai-card-sub)',
    writingMode: 'vertical-rl' as const,
    letterSpacing: '0.1em',
    margin: '2px 0',
    textTransform: 'uppercase' as const,
  },
  railStuck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    background: 'var(--nxai-rail-stuck-bg)',
    color: 'var(--nxai-rail-stuck-text)',
    fontSize: 12,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: (state: PanelState, isOverlay: boolean) => ({
    position: 'fixed' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: state === 'full' ? undefined : state === 'wide' ? WIDE_WIDTH : PANEL_WIDTH,
    left: state === 'full' ? 68 : undefined,
    background: 'var(--nxai-card-bg)',
    borderLeft: `1px solid var(--nxai-card-border)`,
    boxShadow: isOverlay ? '0 0 24px rgba(17, 24, 39, 0.10)' : 'none',
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
    // Unchanged from the star: dark mark on the brand circle. Stated explicitly now
    // because the glyph no longer carries its own fill.
    color: UI_COLORS.NEXUS_MARK,
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
      children, sessionsSidebar, onToggleSessions, showSessions, streamingStatus, isOverlay = false,
    } = this.props;

    // Render the floating tab when closed
    if (panelState === 'closed') {
      // The tab's whole reason to stay visible rather than hide is that it carries these two:
      // how many chats are waiting on a reply, and whether anything is stuck. A null is
      // "not knowable" and renders nothing — 0 is indistinguishable from not-yet-loaded,
      // and a badge that says 0 during startup is a claim we cannot make yet.
      const { badgeCount = null, hasStuck = null } = this.props;

      // The whole tab is the control — there is no separate chevron. At this width a second
      // hit target would halve both.
      return React.createElement(
        'div',
        {
          style: this.hov('rail')
            ? { ...styles.rail, boxShadow: '-3px 0 14px rgba(17, 24, 39, 0.14)' }
            : styles.rail,
          onClick: onOpen,
          title: 'Open Nexus AI panel', // generic, no scope claim
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onOpen(); },
          onMouseEnter: this.onEnter('rail'),
          onMouseLeave: this.onLeave(),
          'aria-label': 'Nexus AI panel (closed)',
        },
        // Nexus mark with badge
        React.createElement(
          'div',
          { style: styles.railMark },
          React.createElement(NexusGlyph, { size: 22 }),
          badgeCount !== null && badgeCount > 0
            ? React.createElement(
                'div',
                { style: styles.railBadge, title: `${badgeCount} chat${badgeCount === 1 ? '' : 's'} waiting on you` },
                String(badgeCount),
              )
            : null,
        ),
        // Vertical label
        React.createElement('div', { style: styles.railLabel }, RAIL_LABEL),
        // Stuck marker (only when hasStuck is true, never when null/unknown)
        hasStuck === true
          ? React.createElement('div', { style: styles.railStuck, title: 'Agent stuck' }, '!')
          : null,
      );
    }

    // Panel is open (docked, wide, or full)
    const isFull = panelState === 'full';

    // No segmented control. Insights was dropped and Chat is all that remains, and a
    // one-item segmented control is a control that cannot be operated -- it only tells
    // the user there is a choice, then denies it. The header's "Nexus" already names
    // what the panel is.

    const header = React.createElement(
      'div',
      { style: styles.header },
      // Brand block — avatar
      // 20, not 18: below RING_MIN_SIZE the mark degrades to a bare dot, which is a
      // bigger change to the brand block than the two pixels.
      React.createElement('div', { style: styles.avatar }, React.createElement(NexusGlyph, { size: 20 })),
      // Brand block — title stack
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column' as const, gap: 1 } },
        React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: 'var(--nxai-card-text)', lineHeight: 1.2 } }, 'Nexus'),
        // Second line carries live status only. It used to say "Follows you across tabs" —
        // header space spent restating a behaviour the user can already see — and briefly
        // held a site picker, which was removed: the panel's scope is not something the
        // user manages from here. Nothing to say means nothing rendered.
        streamingStatus
          ? React.createElement(
              'span',
              { style: { fontSize: 12, color: UI_COLORS.WPE_BRAND, lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 5 } },
              React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: UI_COLORS.WPE_BRAND, flexShrink: 0, display: 'inline-block' } }),
              streamingStatus,
            )
          : null,
      ),
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
      { style: styles.panel(panelState, isOverlay), role: 'complementary', 'aria-label': 'Nexus AI chat panel' },
      header,
      body,
    );
  }
}
