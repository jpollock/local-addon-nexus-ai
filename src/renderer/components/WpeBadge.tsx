/**
 * Reusable WPE badge component.
 * Renders a teal "WPE" pill badge.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { UI_COLORS } from '../../common/constants';

interface WpeBadgeProps {
  size: 'small' | 'medium';
}

const STYLES: Record<WpeBadgeProps['size'], React.CSSProperties> = {
  small: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '14px',
    padding: '0 4px',
    backgroundColor: UI_COLORS.WPE_BRAND,
    color: '#fff',
    fontSize: '8px',
    fontWeight: 700,
    borderRadius: '3px',
    letterSpacing: '0.5px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    flexShrink: 0,
  },
  medium: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '18px',
    padding: '0 6px',
    backgroundColor: UI_COLORS.WPE_BRAND,
    color: '#fff',
    fontSize: '10px',
    fontWeight: 700,
    borderRadius: '4px',
    letterSpacing: '0.5px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    flexShrink: 0,
  },
};

export class WpeBadge extends React.Component<WpeBadgeProps> {
  render(): React.ReactNode {
    const style = STYLES[this.props.size];
    return React.createElement('span', { style, title: 'WP Engine Connected' }, 'WPE');
  }
}
