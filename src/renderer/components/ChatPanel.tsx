/**
 * Chat Panel — Global slide-out AI chat accessible from anywhere in Local
 *
 * Wraps ChatTab in a slide-out panel with:
 * - Overlay positioning (slides from right)
 * - Keyboard shortcut (Cmd+J / Ctrl+J)
 * - Close on Escape or click outside
 * - Floating chat button to open
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { ChatTab } from './ChatTab';

interface ChatPanelProps {
  electron: any;
  isOpen: boolean;
  onClose: () => void;
}

interface ChatPanelState {
  // No internal state needed - all controlled by parent
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  zIndex: 99999,
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'stretch',
};

const panelContainerStyle: React.CSSProperties = {
  width: '480px',
  maxWidth: '100%',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid var(--nxai-card-border, #e5e7eb)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--nxai-card-text, #111827)',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  cursor: 'pointer',
  padding: '4px 8px',
  lineHeight: 1,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  padding: '0 20px 20px',
  display: 'flex',
  flexDirection: 'column',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class ChatPanel extends React.Component<ChatPanelProps, ChatPanelState> {
  private panelRef: HTMLDivElement | null = null;

  componentDidMount(): void {
    document.addEventListener('keydown', this.handleKeyDown);
  }

  componentWillUnmount(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  handleKeyDown = (e: KeyboardEvent): void => {
    if (this.props.isOpen && e.key === 'Escape') {
      e.preventDefault();
      this.props.onClose();
    }
  };

  handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Close if clicking the overlay backdrop (not the panel itself)
    if (e.target === e.currentTarget) {
      this.props.onClose();
    }
  };

  render(): React.ReactNode {
    if (!this.props.isOpen) return null;

    return React.createElement('div', {
      style: overlayStyle,
      onClick: this.handleOverlayClick,
    },
      React.createElement('div', {
        ref: (el: HTMLDivElement | null) => { this.panelRef = el; },
        style: panelContainerStyle,
      },
        // Header
        React.createElement('div', { style: headerStyle },
          React.createElement('h2', { style: titleStyle }, 'Nexus AI Chat'),
          React.createElement('button', {
            style: closeButtonStyle,
            onClick: this.props.onClose,
            title: 'Close (Esc)',
          }, '×'),
        ),

        // Chat content
        React.createElement('div', { style: contentStyle },
          React.createElement(ChatTab, { electron: this.props.electron }),
        ),
      ),
    );
  }
}
