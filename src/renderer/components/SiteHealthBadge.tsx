/**
 * Site Health Badge Component (Sprint 2)
 *
 * A small circular badge showing a site's health score.
 * Features:
 * - Color-coded: green (80+), yellow (50-79), red (<50)
 * - Two sizes: small (24px) and medium (36px)
 * - Optional score prop to skip fetching
 * - Fetches score via IPC if not provided
 * - Optional click handler
 * - Shows dash when loading or error
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';

interface SiteHealthBadgeProps {
  electron: any;
  siteId: string;
  score?: number;
  size?: 'small' | 'medium';
  onClick?: () => void;
}

interface SiteHealthBadgeState {
  score: number | null;
  loading: boolean;
  error: string | null;
}

// -- Color helpers --

function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

// -- Size configs --

const SIZE_CONFIG = {
  small: { diameter: 24, fontSize: 10 },
  medium: { diameter: 36, fontSize: 14 },
};

/**
 * SiteHealthBadge Component
 */
export class SiteHealthBadge extends React.Component<SiteHealthBadgeProps, SiteHealthBadgeState> {
  private _mounted = false;

  state: SiteHealthBadgeState = {
    score: null,
    loading: true,
    error: null,
  };

  componentDidMount(): void {
    this._mounted = true;

    if (this.props.score !== undefined && this.props.score !== null) {
      this.setState({ score: this.props.score, loading: false });
    } else {
      this.fetchScore();
    }
  }

  componentWillUnmount(): void {
    this._mounted = false;
  }

  componentDidUpdate(prevProps: SiteHealthBadgeProps): void {
    if (this.props.score !== undefined && this.props.score !== prevProps.score) {
      this.setState({ score: this.props.score, loading: false, error: null });
    }
  }

  fetchScore = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.HEALTH_GET_SCORE,
        this.props.siteId,
      );

      if (!this._mounted) return;

      if (result.success) {
        this.setState({
          score: result.score,
          loading: false,
          error: null,
        });
      } else {
        this.setState({
          error: result.error || 'Failed to get health score',
          loading: false,
        });
      }
    } catch (err: any) {
      if (!this._mounted) return;
      this.setState({
        error: err.message || 'Failed to get health score',
        loading: false,
      });
    }
  };

  render(): React.ReactNode {
    const { onClick } = this.props;
    const size = this.props.size || 'small';
    const { score, loading, error } = this.state;
    const config = SIZE_CONFIG[size];

    const hasScore = score !== null && !loading && !error;
    const color = hasScore ? getScoreColor(score!) : '#9ca3af';
    const displayText = hasScore ? String(score) : '\u2014';

    const badgeStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: `${config.diameter}px`,
      height: `${config.diameter}px`,
      borderRadius: '50%',
      backgroundColor: `${color}20`,
      color,
      fontSize: `${config.fontSize}px`,
      fontWeight: 700,
      cursor: onClick ? 'pointer' : 'default',
      border: `2px solid ${color}`,
      lineHeight: 1,
      userSelect: 'none',
    };

    return React.createElement(
      'div',
      {
        style: badgeStyle,
        onClick: onClick || undefined,
        title: hasScore ? `Health: ${score}` : 'Health score unavailable',
      },
      displayText,
    );
  }
}
