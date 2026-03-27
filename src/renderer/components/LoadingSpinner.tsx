/**
 * Loading Spinner Component
 *
 * A simple, reusable loading spinner for indicating async operations.
 * Theme-aware with CSS variable support.
 */
import * as React from 'react';

interface LoadingSpinnerProps {
  size?: number;
  color?: string;
  inline?: boolean;
}

export class LoadingSpinner extends React.Component<LoadingSpinnerProps> {
  render(): React.ReactNode {
    const { size = 20, color = 'var(--color-primary, #3b82f6)', inline = false } = this.props;

    const containerStyle: React.CSSProperties = inline
      ? { display: 'inline-block', verticalAlign: 'middle' }
      : { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };

    const spinnerStyle: React.CSSProperties = {
      width: `${size}px`,
      height: `${size}px`,
      border: `2px solid var(--color-border-primary, #e5e7eb)`,
      borderTop: `2px solid ${color}`,
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    };

    // Inject animation if not already present
    this.injectAnimation();

    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: spinnerStyle }),
    );
  }

  injectAnimation(): void {
    const styleId = 'loading-spinner-animation';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }
}
