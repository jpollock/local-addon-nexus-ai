/**
 * Toast Notification Manager
 *
 * Global toast notification system for user feedback.
 * Shows success, error, warning, and info messages with auto-dismiss.
 *
 * Usage:
 * - Mount <ToastManager /> once in the app
 * - Call window.showToast(message, type, duration) from anywhere
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration: number;
}

interface ToastManagerState {
  toasts: Toast[];
}

export class ToastManager extends React.Component<{}, ToastManagerState> {
  state: ToastManagerState = {
    toasts: [],
  };

  private timers: Map<string, NodeJS.Timeout> = new Map();

  componentDidMount(): void {
    // Expose global showToast method
    (window as any).showToast = this.showToast;
  }

  componentWillUnmount(): void {
    // Clean up timers
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    delete (window as any).showToast;
  }

  showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration: number = 4000): void => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const toast: Toast = { id, message, type, duration };

    this.setState(prev => ({
      toasts: [...prev.toasts, toast],
    }));

    // Auto-dismiss after duration
    if (duration > 0) {
      const timer = setTimeout(() => {
        this.dismissToast(id);
      }, duration);
      this.timers.set(id, timer);
    }
  };

  dismissToast = (id: string): void => {
    // Clear timer
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    // Remove toast
    this.setState(prev => ({
      toasts: prev.toasts.filter(t => t.id !== id),
    }));
  };

  render(): React.ReactNode {
    const { toasts } = this.state;

    if (toasts.length === 0) return null;

    const containerStyle: React.CSSProperties = {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      pointerEvents: 'none',
    };

    return React.createElement('div', { style: containerStyle },
      ...toasts.map(toast => this.renderToast(toast))
    );
  }

  renderToast(toast: Toast): React.ReactNode {
    const colors = this.getToastColors(toast.type);

    const toastStyle: React.CSSProperties = {
      minWidth: '300px',
      maxWidth: '500px',
      padding: '16px 20px',
      borderRadius: '8px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      pointerEvents: 'auto',
      animation: 'slideInRight 0.3s ease-out',
    };

    const iconStyle: React.CSSProperties = {
      fontSize: '18px',
      lineHeight: 1,
      flexShrink: 0,
    };

    const contentStyle: React.CSSProperties = {
      flex: 1,
      fontSize: '14px',
      lineHeight: 1.5,
      color: colors.text,
      wordBreak: 'break-word',
    };

    const closeButtonStyle: React.CSSProperties = {
      background: 'none',
      border: 'none',
      color: colors.text,
      fontSize: '18px',
      lineHeight: 1,
      cursor: 'pointer',
      padding: '0',
      opacity: 0.7,
      flexShrink: 0,
    };

    const icon = this.getToastIcon(toast.type);

    return React.createElement('div', {
      key: toast.id,
      style: toastStyle,
    },
      React.createElement('span', { style: { ...iconStyle, color: colors.icon } }, icon),
      React.createElement('div', { style: contentStyle }, toast.message),
      React.createElement('button', {
        style: closeButtonStyle,
        onClick: () => this.dismissToast(toast.id),
        onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
          (e.target as HTMLButtonElement).style.opacity = '1';
        },
        onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
          (e.target as HTMLButtonElement).style.opacity = '0.7';
        },
      }, '×'),
    );
  }

  getToastColors(type: string): { bg: string; border: string; text: string; icon: string } {
    switch (type) {
      case 'success':
        return {
          bg: 'var(--color-background-success-subtle, rgba(34, 197, 94, 0.1))',
          border: 'var(--color-border-success, rgba(34, 197, 94, 0.3))',
          text: 'var(--color-text-success, #16a34a)',
          icon: 'var(--color-text-success, #16a34a)',
        };
      case 'error':
        return {
          bg: 'var(--color-background-error-subtle, rgba(239, 68, 68, 0.1))',
          border: 'var(--color-border-error, rgba(239, 68, 68, 0.3))',
          text: 'var(--color-text-error, #dc2626)',
          icon: 'var(--color-text-error, #dc2626)',
        };
      case 'warning':
        return {
          bg: 'var(--color-background-warning-subtle, rgba(245, 158, 11, 0.1))',
          border: 'var(--color-border-warning, rgba(245, 158, 11, 0.3))',
          text: 'var(--color-text-warning, #d97706)',
          icon: 'var(--color-text-warning, #d97706)',
        };
      case 'info':
      default:
        return {
          bg: 'var(--color-background-info-subtle, rgba(59, 130, 246, 0.1))',
          border: 'var(--color-border-info, rgba(59, 130, 246, 0.3))',
          text: 'var(--color-text-info, #2563eb)',
          icon: 'var(--color-text-info, #2563eb)',
        };
    }
  }

  getToastIcon(type: string): string {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'warning': return '⚠';
      case 'info': return 'ℹ';
      default: return 'ℹ';
    }
  }
}

// Inject animation keyframes
const styleId = 'toast-animations';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes slideInRight {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
}
