/**
 * Credential Consent Modal
 *
 * Displays a consent prompt for OAuth authorization requests.
 * Shows agent name, provider, requested scopes with human-readable labels,
 * and the agent's reason string.
 *
 * Class-based component — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../../common/constants';

export interface ConsentRequest {
  agentId: string;
  agentName: string;
  provider: 'google';
  providerDisplayName: string;
  reason: string;
  scopes: Array<{
    scope: string;
    label: string;
    description?: string;
  }>;
}

interface CredentialConsentModalProps {
  electron: any;
  request: ConsentRequest | null;
  onDismiss: () => void;
}

interface CredentialConsentModalState {
  connecting: boolean;
}

export class CredentialConsentModal extends React.Component<CredentialConsentModalProps, CredentialConsentModalState> {
  state: CredentialConsentModalState = {
    connecting: false,
  };

  private handleConnect = async (): Promise<void> => {
    const { request, electron, onDismiss } = this.props;
    if (!request || !electron) return;

    this.setState({ connecting: true });

    try {
      const { ipcRenderer } = electron;
      await ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_CONNECT, {
        agentId: request.agentId,
        provider: request.provider,
      });
    } catch (err: any) {
      console.error('Failed to connect credential:', err);
    } finally {
      this.setState({ connecting: false });
      onDismiss();
    }
  };

  private handleNotNow = (): void => {
    this.props.onDismiss();
  };

  render(): React.ReactNode {
    const { request } = this.props;
    const { connecting } = this.state;

    if (!request) return null;

    // Modal overlay styles
    const overlayStyle: React.CSSProperties = {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
    };

    // Modal container styles
    const modalStyle: React.CSSProperties = {
      backgroundColor: '#fff',
      borderRadius: 8,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      padding: 24,
      maxWidth: 500,
      width: '90%',
      maxHeight: '80vh',
      overflowY: 'auto',
    };

    // Dark mode support (if Dark.css is loaded)
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
      modalStyle.backgroundColor = '#1e1e1e';
      modalStyle.color = '#e0e0e0';
    }

    // Title styles
    const titleStyle: React.CSSProperties = {
      fontSize: 18,
      fontWeight: 600,
      marginBottom: 8,
      color: 'inherit',
    };

    // Subtitle styles
    const subtitleStyle: React.CSSProperties = {
      fontSize: 14,
      opacity: 0.8,
      marginBottom: 16,
      color: 'inherit',
    };

    // Reason box styles
    const reasonBoxStyle: React.CSSProperties = {
      backgroundColor: 'rgba(0, 0, 0, 0.02)',
      border: '1px solid rgba(0, 0, 0, 0.08)',
      borderRadius: 6,
      padding: 12,
      marginBottom: 16,
      fontSize: 13,
      lineHeight: '1.5',
      color: 'inherit',
    };

    if (document.documentElement.getAttribute('data-theme') === 'dark') {
      reasonBoxStyle.backgroundColor = 'rgba(255, 255, 255, 0.05)';
      reasonBoxStyle.borderColor = 'rgba(255, 255, 255, 0.1)';
    }

    // Scope list styles
    const scopeListStyle: React.CSSProperties = {
      listStyle: 'none',
      margin: '12px 0 24px 0',
      padding: 0,
    };

    const scopeItemStyle: React.CSSProperties = {
      padding: '8px 0',
      borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
      fontSize: 13,
      color: 'inherit',
    };

    if (document.documentElement.getAttribute('data-theme') === 'dark') {
      scopeItemStyle.borderBottomColor = 'rgba(255, 255, 255, 0.05)';
    }

    const scopeLabelStyle: React.CSSProperties = {
      fontWeight: 500,
      display: 'block',
      marginBottom: 2,
    };

    const scopeDescriptionStyle: React.CSSProperties = {
      fontSize: 12,
      opacity: 0.7,
      marginTop: 2,
      color: 'inherit',
    };

    // Button container styles
    const buttonContainerStyle: React.CSSProperties = {
      display: 'flex',
      gap: 12,
      justifyContent: 'flex-end',
      marginTop: 24,
    };

    // Button styles
    const baseButtonStyle: React.CSSProperties = {
      padding: '8px 16px',
      borderRadius: 6,
      fontSize: 14,
      fontWeight: 500,
      border: 'none',
      cursor: 'pointer',
      transition: 'opacity 0.2s, background-color 0.2s',
      fontFamily: 'inherit',
    };

    const notNowButtonStyle: React.CSSProperties = {
      ...baseButtonStyle,
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      color: 'inherit',
    };

    const connectButtonStyle: React.CSSProperties = {
      ...baseButtonStyle,
      backgroundColor: '#51bb7b',
      color: '#fff',
      opacity: connecting ? 0.7 : 1,
      cursor: connecting ? 'default' : 'pointer',
    };

    if (document.documentElement.getAttribute('data-theme') === 'dark') {
      notNowButtonStyle.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    }

    return React.createElement('div', { style: overlayStyle },
      React.createElement('div', { style: modalStyle },
        // Title
        React.createElement('h2', { style: titleStyle },
          `Authorize ${request.agentName}`,
        ),

        // Subtitle with provider
        React.createElement('p', { style: subtitleStyle },
          `Needs access to ${request.providerDisplayName}`,
        ),

        // Reason text
        React.createElement('div', { style: reasonBoxStyle },
          request.reason,
        ),

        // Requested scopes
        React.createElement('div', null,
          React.createElement('p', { style: { fontSize: 13, fontWeight: 500, marginBottom: 8 } },
            'Requesting access to:',
          ),
          React.createElement('ul', { style: scopeListStyle },
            ...request.scopes.map((scope) =>
              React.createElement('li', { key: scope.scope, style: scopeItemStyle },
                React.createElement('span', { style: scopeLabelStyle }, scope.label),
                scope.description ? React.createElement('span', { style: scopeDescriptionStyle }, scope.description) : null,
              ),
            ),
          ),
        ),

        // Button row
        React.createElement('div', { style: buttonContainerStyle },
          React.createElement('button', {
            onClick: this.handleNotNow,
            disabled: connecting,
            style: {
              ...notNowButtonStyle,
              opacity: connecting ? 0.5 : 1,
              cursor: connecting ? 'default' : 'pointer',
            },
          },
            'Not now',
          ),
          React.createElement('button', {
            onClick: this.handleConnect,
            disabled: connecting,
            style: connectButtonStyle,
          },
            connecting ? 'Connecting…' : 'Connect',
          ),
        ),
      ),
    );
  }
}
