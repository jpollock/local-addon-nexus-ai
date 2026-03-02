/**
 * Site Header WPE Badge
 *
 * Appears in the top-right of the site info header for WPE-connected sites.
 * Registered via the SiteInfo_Top_TopRight hook.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { WpeBadge } from './WpeBadge';

interface SiteHeaderBadgeProps {
  site: any;
  siteStatus: string;
}

interface SiteHeaderBadgeState {
  isWpe: boolean;
  environment: string | null;
}

export class SiteHeaderBadge extends React.Component<SiteHeaderBadgeProps, SiteHeaderBadgeState> {
  state: SiteHeaderBadgeState = {
    isWpe: false,
    environment: null,
  };

  componentDidMount(): void {
    this.checkIfWpe();
  }

  componentDidUpdate(prevProps: SiteHeaderBadgeProps): void {
    if (prevProps.site?.id !== this.props.site?.id) {
      this.checkIfWpe();
    }
  }

  checkIfWpe(): void {
    const { site } = this.props;
    const connections = site?.hostConnections;
    if (!connections) {
      this.setState({ isWpe: false, environment: null });
      return;
    }

    // hostConnections can be an array or object keyed by ID
    const connList = Array.isArray(connections) ? connections : Object.values(connections);
    const wpeConn = (connList as any[]).find((c: any) => c.hostId === 'wpe');

    if (wpeConn) {
      this.setState({
        isWpe: true,
        environment: wpeConn.remoteSiteEnv?.environment || null,
      });
    } else {
      this.setState({ isWpe: false, environment: null });
    }
  }

  render(): React.ReactNode {
    const { isWpe, environment } = this.state;

    if (!isWpe) {
      return null;
    }

    return React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          paddingRight: '12px',
          borderRight: '1px solid #e5e7eb',
          marginRight: '12px',
        },
      },
      React.createElement(WpeBadge, { size: 'medium' }),
      React.createElement(
        'span',
        {
          style: {
            fontSize: '12px',
            fontWeight: 500,
            color: '#666',
          },
        },
        environment ? `WP Engine (${environment})` : 'WP Engine',
      ),
    );
  }
}
