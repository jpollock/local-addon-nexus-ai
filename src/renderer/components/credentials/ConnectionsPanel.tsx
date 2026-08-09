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
      return React.createElement('div', { style: { padding: '8px 0', color: 'var(--ag-text-muted)', fontSize: 13 } }, 'Loading…');
    }

    if (connections.length === 0) {
      return React.createElement('div', { style: { padding: '4px 0 8px' } },
        React.createElement('p', { style: { color: 'var(--ag-text-secondary)', margin: 0, fontSize: 13, lineHeight: 1.55 } },
          'No accounts connected.',
        ),
        // Naming the real path matters: this panel deliberately has no Connect button. Which
        // Google APIs to authorise is the agent's decision — it declares the scopes it needs, and
        // asking for more from here would over-authorise, or guess wrong and fail on first use.
        React.createElement('p', {
          style: { color: 'var(--ag-text-muted)', margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.55 },
        },
          'Connect from an agent\'s Settings tab — Agents → the agent → Settings → Connected Accounts. ' +
          'The agent asks for exactly the access it needs, and the connection is then shared with every agent.',
        ),
      );
    }

    const rows = connections.map(conn => {
      const revoked = conn.status === 'revoked';
      return React.createElement('div', {
        key: conn.id,
        style: {
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
          borderRadius: 8, marginBottom: 8,
          background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border-subtle)',
        },
      },
        React.createElement('span', {
          style: {
            flex: 'none', width: 8, height: 8, borderRadius: '50%',
            background: revoked ? 'var(--ag-red)' : 'var(--ag-green)',
          },
        }),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', {
            style: { fontSize: 13, fontWeight: 500, color: 'var(--ag-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
          }, conn.accountLabel),
          React.createElement('div', {
            style: { fontSize: 12, color: revoked ? 'var(--ag-red)' : 'var(--ag-text-muted)', marginTop: 2 },
          }, revoked
            ? 'Revoked — reconnect from the agent that needs it'
            : `Google · ${conn.grantedScopes.length} scope${conn.grantedScopes.length !== 1 ? 's' : ''}`),
        ),
        React.createElement('button', {
          onClick: () => this.handleDisconnect(conn.id),
          disabled: disconnecting.has(conn.id),
          style: {
            flex: 'none', padding: '6px 13px', fontSize: 12,
            background: 'transparent', border: '1px solid var(--ag-border-control)',
            borderRadius: 6, color: 'var(--ag-text-secondary)',
            cursor: disconnecting.has(conn.id) ? 'wait' : 'pointer',
          },
        }, disconnecting.has(conn.id) ? 'Disconnecting…' : 'Disconnect'),
      );
    });

    return React.createElement('div', { style: { padding: '4px 0 8px' } },
      ...rows,
      React.createElement('div', {
        style: { fontSize: 12, color: 'var(--ag-text-muted)', marginTop: 4, lineHeight: 1.55 },
      }, 'Disconnecting revokes access for every agent. Anything already collected is kept.'),
    );
  }
}
