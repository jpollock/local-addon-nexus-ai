/**
 * Fleet Breadcrumb
 *
 * Renders "← Fleet Overview" NavLink on every site's overview page.
 * Registered via SiteInfoOverview:Before hook.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { UI_COLORS } from '../../common/constants';

interface FleetBreadcrumbProps {
  NavLink: any;
}

export class FleetBreadcrumb extends React.Component<FleetBreadcrumbProps> {
  render(): React.ReactNode {
    const { NavLink } = this.props;

    return React.createElement(
      'div',
      {
        style: {
          padding: '8px 0',
          marginBottom: '4px',
        },
      },
      React.createElement(
        NavLink,
        {
          to: '/main/fleet-overview',
          style: {
            color: UI_COLORS.WPE_BRAND,
            textDecoration: 'none',
            fontSize: '13px',
            fontWeight: 500,
          },
        },
        '\u2190 Fleet Overview',
      ),
    );
  }
}
