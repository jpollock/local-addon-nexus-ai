import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import type { Connection } from '../../../main/credentials/types';

interface Props {
  electron: any;
}

interface State {
  connections: Connection[];
  loading: boolean;
  disconnecting: Set<string>;
}

export class ConnectionsPanel extends React.Component<Props, State> {
  state: State = { connections: [], loading: true, disconnecting: new Set() };

  componentDidMount() {
    this.loadConnections();
    this.props.electron.ipcRenderer.on(IPC_CHANNELS.CREDENTIAL_EVENT, this.handleCredentialEvent);
  }

  componentWillUnmount() {
    this.props.electron.ipcRenderer.removeListener(IPC_CHANNELS.CREDENTIAL_EVENT, this.handleCredentialEvent);
  }

  private handleCredentialEvent = () => {
    this.loadConnections();
  };

  private async loadConnections() {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_STATUS);
      this.setState({ connections: result.connections ?? [], loading: false });
    } catch {
      this.setState({ loading: false });
    }
  }

  private handleDisconnect = async (connectionId: string) => {
    this.setState(prev => ({ disconnecting: new Set(prev.disconnecting).add(connectionId) }));
    try {
      await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_DISCONNECT, { connectionId });
      await this.loadConnections();
    } finally {
      this.setState(prev => {
        const next = new Set(prev.disconnecting);
        next.delete(connectionId);
        return { disconnecting: next };
      });
    }
  };

  render() {
    const { connections, loading, disconnecting } = this.state;

    if (loading) {
      return React.createElement('div', { style: { padding: 16, color: '#bbb' } }, 'Loading…');
    }

    if (connections.length === 0) {
      return React.createElement(
        'div',
        { style: { padding: 16 } },
        React.createElement('p', { style: { color: '#888', margin: 0, fontSize: 14 } },
          'No Google accounts connected. Agents that need Google access will prompt you to connect.',
        ),
      );
    }

    const rows = connections.map(conn =>
      React.createElement(
        'li',
        {
          key: conn.id,
          className: 'TableListRow',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
        },
        React.createElement(
          'div',
          null,
          React.createElement('strong', null, conn.accountLabel),
          React.createElement(
            'div',
            { style: { fontSize: 12, color: conn.status === 'revoked' ? '#ef4444' : '#888', marginTop: 2 } },
            conn.status === 'revoked'
              ? 'Revoked — reconnect to restore access'
              : `Google · ${conn.grantedScopes.length} scope${conn.grantedScopes.length !== 1 ? 's' : ''}`,
          ),
        ),
        React.createElement(
          'button',
          {
            onClick: () => this.handleDisconnect(conn.id),
            disabled: disconnecting.has(conn.id),
            style: {
              padding: '4px 12px', fontSize: 12,
              background: 'transparent', border: '1px solid #555',
              borderRadius: 4, color: '#bbb', cursor: 'pointer',
            },
          },
          disconnecting.has(conn.id) ? 'Disconnecting…' : 'Disconnect',
        ),
      ),
    );

    return React.createElement(
      'div',
      { style: { padding: '0 16px 16px' } },
      React.createElement('h4', { style: { margin: '0 0 12px', fontSize: 14, color: '#fff' } }, 'Connected accounts'),
      React.createElement('ul', { className: 'TableList' }, ...rows),
    );
  }
}
