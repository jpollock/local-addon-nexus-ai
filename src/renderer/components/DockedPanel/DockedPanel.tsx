import React from 'react';

export type PanelSize = 'docked' | 'full';

export interface Props {
  open: boolean;
  size: PanelSize;
  onOpen: () => void;
  onClose: () => void;
  onSetSize: (size: PanelSize) => void;
  children?: React.ReactNode;
  sessionsSidebar?: React.ReactNode;
}

const PANEL_WIDTH = 384;
const BUBBLE_SIZE = 52;

const styles = {
  bubble: {
    position: 'fixed' as const,
    bottom: 20,
    right: 20,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: '50%',
    background: '#29b6cf',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    zIndex: 9000,
    userSelect: 'none' as const,
  },
  bubbleIcon: {
    color: '#05262e',
    fontSize: 22,
    fontWeight: 700,
  },
  panel: (full: boolean) => ({
    position: 'fixed' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: full ? undefined : PANEL_WIDTH,
    left: full ? 358 : undefined, // 58px rail + 300px site list
    background: '#23272f',
    borderLeft: '1px solid #2c313a',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 8999,
    fontFamily: 'inherit',
  }),
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    height: 44,
    borderBottom: '1px solid #2c313a',
    flexShrink: 0,
    background: '#1a1e24',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#5fd2e5',
    fontWeight: 600,
    fontSize: 13,
  },
  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#868d98',
    cursor: 'pointer',
    padding: '4px 6px',
    borderRadius: 4,
    fontSize: 14,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
  },
  panelBody: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
};

export class DockedPanel extends React.Component<Props> {
  render() {
    const { open, size, onOpen, onClose, onSetSize, children, sessionsSidebar } = this.props;

    if (!open) {
      return React.createElement(
        'div',
        {
          style: styles.bubble,
          onClick: onOpen,
          title: 'Open Nexus Chat',
          'aria-label': 'Open Nexus AI chat panel',
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onOpen(); },
        },
        React.createElement('span', { style: styles.bubbleIcon }, 'N'),
      );
    }

    const isFull = size === 'full';

    return React.createElement(
      'div',
      { style: styles.panel(isFull), role: 'complementary', 'aria-label': 'Nexus AI chat panel' },
      // Header
      React.createElement(
        'div',
        { style: styles.header },
        React.createElement(
          'div',
          { style: styles.headerLeft },
          React.createElement('span', null, 'Nexus'),
        ),
        React.createElement(
          'div',
          { style: styles.headerControls },
          // Expand/compress toggle
          React.createElement(
            'button',
            {
              style: styles.iconBtn,
              onClick: () => onSetSize(isFull ? 'docked' : 'full'),
              title: isFull ? 'Compress' : 'Expand',
            },
            isFull ? '⊟' : '⊞',
          ),
          // Collapse to bubble
          React.createElement(
            'button',
            {
              style: styles.iconBtn,
              onClick: onClose,
              title: 'Collapse',
            },
            '✕',
          ),
        ),
      ),
      // Body
      isFull
        ? React.createElement(
            'div',
            { style: { display: 'flex', height: '100%' } },
            // Sessions column
            React.createElement(
              'div',
              { style: { width: 264, flexShrink: 0, borderRight: '1px solid #2c313a' } },
              sessionsSidebar ?? null,
            ),
            // Chat centered
            React.createElement(
              'div',
              { style: { flex: 1, maxWidth: 720, margin: '0 auto', height: '100%', overflow: 'hidden' } },
              children ?? null,
            ),
          )
        : React.createElement('div', { style: styles.panelBody }, children ?? null),
    );
  }
}
