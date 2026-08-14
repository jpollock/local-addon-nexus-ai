/**
 * Fleet Tab — WP Engine fleet identity view
 *
 * Renders installs grouped by WPE site, showing provenance and sandboxes.
 * Read-only: no linking, no actions. This proves the fleet data layer is real.
 */
import * as React from 'react';
import type { FleetSiteGroup, FleetInstall, UnresolvedSite } from '../../../main/fleet/types';
import type { DataProvenance } from '../../../common/types';
import { FixedSizeList as List } from 'react-window';

interface FleetTabProps {
  loaded: boolean;
  failed: boolean;
  groups: FleetSiteGroup[];
  unresolved: UnresolvedSite[];
  onRetry: () => void;
}

interface FleetTabState {
  windowHeight: number;
}

const wrapStyle: React.CSSProperties = {
  padding: '4px 0',
};

const headerStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-sub)',
  marginBottom: '16px',
  lineHeight: '1.4',
};

const messageStyle: React.CSSProperties = {
  padding: '32px 20px',
  textAlign: 'center',
  fontSize: '13px',
  color: 'var(--nxai-card-sub)',
  border: '1px solid var(--nxai-card-border)',
  borderRadius: '10px',
  backgroundColor: 'var(--nxai-card-bg)',
};

const errorTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--nxai-danger-text)',
  marginBottom: '8px',
};

const retryBtnStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '6px 14px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: 'var(--nxai-accent)',
  color: 'var(--nxai-accent-text)',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
};

const siteGroupStyle: React.CSSProperties = {
  marginBottom: '20px',
};

const siteNameStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  marginBottom: '8px',
};

const installRowStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  color: 'var(--nxai-card-text)',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};

const installCardStyle: React.CSSProperties = {
  ...installRowStyle,
  border: '1px solid var(--nxai-card-border)',
  borderRadius: '8px',
  backgroundColor: 'var(--nxai-card-bg)',
  marginBottom: '6px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
};

const envPillStyle: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 500,
  backgroundColor: 'var(--nxai-section-bg)',
  color: 'var(--nxai-card-sub)',
  border: '1px solid var(--nxai-card-border)',
  marginRight: '6px',
};

const sandboxBadgeStyle: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 500,
  backgroundColor: 'var(--nxai-accent)',
  color: 'var(--nxai-accent-text)',
  marginLeft: '8px',
};

const provenanceDotStyle = (level: DataProvenance['level']): React.CSSProperties => {
  const colors: Record<DataProvenance['level'], string> = {
    live: 'var(--nxai-status-ok)',
    configured: 'var(--nxai-card-sub)',
    'external-api': 'var(--nxai-card-sub)',
    scanned: 'var(--nxai-danger-text)',
    searchable: 'var(--nxai-card-sub)',
  };
  return {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: colors[level],
    flexShrink: 0,
  };
};

const provenanceLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontFamily: 'monospace',
  color: 'var(--nxai-card-sub)',
};

const unresolvedSectionStyle: React.CSSProperties = {
  marginTop: '32px',
  paddingTop: '16px',
  borderTop: '1px solid var(--nxai-card-border)',
};

const unresolvedTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  marginBottom: '10px',
};

const unresolvedItemStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '13px',
  color: 'var(--nxai-card-text)',
  marginBottom: '4px',
};

function formatAge(ageSeconds: number | null): string {
  if (ageSeconds === null) return '';
  if (ageSeconds < 60) return 'checked just now';
  const mins = Math.floor(ageSeconds / 60);
  if (mins < 60) return `checked ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `checked ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `checked ${days}d ago`;
}

function formatProvenance(p: DataProvenance): string {
  if (p.level === 'live') return formatAge(p.ageSeconds);
  if (p.level === 'configured') {
    const age = formatAge(p.ageSeconds);
    return age ? `from last sync, ${age.replace('checked ', '')}` : 'from last sync';
  }
  if (p.level === 'external-api') return 'from WP Engine, not yet reached';
  if (p.level === 'scanned' && p.caveat) return p.caveat;
  return p.source;
}

/** Installs earn visual weight by having a problem. */
function needsVisualWeight(install: FleetInstall): boolean {
  if (install.sandbox) return true; // sandbox attached
  if (install.provenance.level === 'live') return false; // current and clean
  return true; // stale, unreachable, or external-api
}

function countNeedingAttention(groups: FleetSiteGroup[]): number {
  let count = 0;
  for (const group of groups) {
    for (const install of group.installs) {
      if (needsVisualWeight(install)) count++;
    }
  }
  return count;
}

function computeHeader(groups: FleetSiteGroup[], unresolved: UnresolvedSite[]): string {
  const siteCount = groups.length;
  const needAttention = countNeedingAttention(groups);

  const parts: string[] = [];
  if (siteCount === 1) {
    parts.push('1 site');
  } else {
    parts.push(`${siteCount} sites`);
  }

  if (needAttention > 0) {
    parts.push(`${needAttention} need attention`);
  }

  if (needAttention === 0 && unresolved.length === 0) {
    parts.push('everything else is quiet');
  }

  return parts.join(' · ');
}

export class FleetTab extends React.Component<FleetTabProps, FleetTabState> {
  state: FleetTabState = { windowHeight: 600 };

  componentDidMount() {
    this.updateWindowHeight();
    window.addEventListener('resize', this.updateWindowHeight);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateWindowHeight);
  }

  updateWindowHeight = () => {
    this.setState({ windowHeight: window.innerHeight - 200 });
  };

  private renderInstall(install: FleetInstall, _groupName: string): React.ReactNode {
    const hasVisualWeight = needsVisualWeight(install);
    const style = hasVisualWeight ? installCardStyle : installRowStyle;

    return React.createElement('div', { key: install.installId, style },
      React.createElement('span', { style: provenanceDotStyle(install.provenance.level) }),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' } },
          React.createElement('span', { style: { fontWeight: 500 } }, install.installName),
          install.environment && React.createElement('span', { style: envPillStyle },
            install.environment === 'production' ? 'Prod' :
            install.environment === 'staging' ? 'Staging' : 'Dev'
          ),
          install.sandbox && React.createElement('span', { style: sandboxBadgeStyle },
            `Sandbox: ${install.sandbox.localSiteName}`
          ),
        ),
        install.domain && React.createElement('div', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)' } }, install.domain),
      ),
      React.createElement('span', { style: provenanceLabelStyle }, formatProvenance(install.provenance)),
    );
  }

  private renderGroup(group: FleetSiteGroup): React.ReactNode {
    return React.createElement('div', { key: group.wpeSiteId || group.name, style: siteGroupStyle },
      React.createElement('div', { style: siteNameStyle }, group.name),
      ...group.installs.map((i: FleetInstall) => this.renderInstall(i, group.name)),
    );
  }

  private renderUnresolved(): React.ReactNode {
    const { unresolved } = this.props;
    if (unresolved.length === 0) return null;

    return React.createElement('div', { style: unresolvedSectionStyle },
      React.createElement('div', { style: unresolvedTitleStyle },
        `Unresolved local sites · ${unresolved.length}`
      ),
      React.createElement('div', { style: { fontSize: '12px', color: 'var(--nxai-card-sub)', marginBottom: '10px' } },
        'These sites could not be linked to WP Engine installs.'
      ),
      ...unresolved.map((u: UnresolvedSite) =>
        React.createElement('div', { key: u.localSiteId, style: unresolvedItemStyle },
          u.localSiteName
        )
      ),
    );
  }

  render(): React.ReactNode {
    const { loaded, failed, groups, unresolved } = this.props;

    if (failed) {
      return React.createElement('div', { style: messageStyle },
        React.createElement('div', { style: errorTitleStyle }, "Couldn't read fleet data"),
        React.createElement('div', null, 'This is a problem reading the data, not a sign that your fleet is empty.'),
        React.createElement('button', {
          type: 'button',
          style: retryBtnStyle,
          onClick: this.props.onRetry
        }, 'Try again'),
      );
    }

    if (!loaded) {
      return React.createElement('div', { style: messageStyle }, 'Loading fleet…');
    }

    if (groups.length === 0 && unresolved.length === 0) {
      return React.createElement('div', { style: messageStyle },
        'No WP Engine sites yet. Connect a WP Engine account to see your fleet.'
      );
    }

    const header = computeHeader(groups, unresolved);
    const allItems = groups.flatMap(g => g.installs.map(i => ({ group: g, install: i })));

    // Use virtualization if we have many installs
    const useVirtualization = allItems.length > 50;

    return React.createElement('div', { style: wrapStyle },
      React.createElement('div', { style: headerStyle }, header),

      useVirtualization
        ? React.createElement(List, {
            height: this.state.windowHeight,
            itemCount: groups.length,
            itemSize: 100,
            width: '100%',
            children: ({ index, style }: { index: number; style: React.CSSProperties }) =>
              React.createElement('div', { style }, this.renderGroup(groups[index]))
          })
        : groups.map((g: FleetSiteGroup) => this.renderGroup(g)),

      this.renderUnresolved(),
    );
  }
}
