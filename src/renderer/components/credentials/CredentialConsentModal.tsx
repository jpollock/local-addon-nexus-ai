import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';

interface ConsentRequest {
  provider: string;
  agentId: string;
  siteId: string;
  scopes: string[];
  agentName?: string;
  reason?: string;
  scopeLabels?: Record<string, string>;
}

interface Props {
  electron: any;
  request: ConsentRequest | null;
  onDismiss: () => void;
}

interface State {
  connecting: boolean;
}

export class CredentialConsentModal extends React.Component<Props, State> {
  state: State = { connecting: false };

  private handleConnect = async () => {
    const { electron, request, onDismiss } = this.props;
    if (!request) return;
    this.setState({ connecting: true });
    try {
      await electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_CONNECT, {
        provider: request.provider,
        agentId: request.agentId,
        siteId: request.siteId,
        scopes: request.scopes,
      });
      onDismiss();
    } finally {
      this.setState({ connecting: false });
    }
  };

  render() {
    const { request, onDismiss } = this.props;
    if (!request) return null;

    const { connecting } = this.state;
    const agentName = request.agentName ?? request.agentId;
    const reason =
      request.reason ?? `Allow ${agentName} to access your ${request.provider} account.`;
    const scopeLines = request.scopes.map((s) =>
      React.createElement(
        'li',
        { key: s, style: { marginBottom: 4 } },
        request.scopeLabels?.[s] ?? s,
      ),
    );

    return React.createElement(
      'div',
      {
        style: {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      React.createElement(
        'div',
        {
          style: {
            background: '#1e1e1e',
            borderRadius: 8,
            padding: 24,
            maxWidth: 420,
            width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          },
        },
        React.createElement(
          'h3',
          { style: { margin: '0 0 12px', fontSize: 16, color: '#fff' } },
          `Connect your ${request.provider} account`,
        ),
        React.createElement(
          'p',
          { style: { margin: '0 0 12px', fontSize: 14, color: '#bbb', lineHeight: 1.5 } },
          reason,
        ),
        scopeLines.length > 0 &&
          React.createElement(
            'ul',
            {
              style: {
                margin: '0 0 20px',
                paddingLeft: 18,
                color: '#bbb',
                fontSize: 13,
              },
            },
            ...scopeLines,
          ),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
          React.createElement(
            'button',
            {
              onClick: onDismiss,
              disabled: connecting,
              style: {
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid #555',
                borderRadius: 4,
                color: '#bbb',
                cursor: 'pointer',
              },
            },
            'Not now',
          ),
          React.createElement(
            'button',
            {
              onClick: this.handleConnect,
              disabled: connecting,
              style: {
                padding: '8px 16px',
                background: '#51bb7b',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                cursor: connecting ? 'wait' : 'pointer',
              },
            },
            connecting ? 'Connecting…' : 'Connect',
          ),
        ),
      ),
    );
  }
}
