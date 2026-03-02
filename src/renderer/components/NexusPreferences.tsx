/**
 * Nexus AI Preferences Panel
 *
 * Registered via Local's `preferencesMenuItems` filter hook.
 * Controls auto-index behavior and per-site exclusions.
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';

interface NexusPreferencesProps {
  electron: any;
}

interface SiteListItem {
  id: string;
  name: string;
  status: string;
}

interface NexusPreferencesState {
  settings: NexusSettings;
  sites: SiteListItem[];
  loading: boolean;
  saved: boolean;
}

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--nxai-card-text, #111827)',
  marginBottom: '6px',
};

const descStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginBottom: '16px',
  lineHeight: 1.5,
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 0',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '24px',
};

export class NexusPreferences extends React.Component<NexusPreferencesProps, NexusPreferencesState> {
  private mounted = false;

  state: NexusPreferencesState = {
    settings: { autoIndex: true, excludedSiteIds: [] },
    sites: [],
    loading: true,
    saved: false,
  };

  componentDidMount(): void {
    this.mounted = true;
    this.fetchData();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  fetchData = async (): Promise<void> => {
    const ipc = this.props.electron.ipcRenderer;
    try {
      const [settings, sites] = await Promise.all([
        ipc.invoke(IPC_CHANNELS.GET_SETTINGS),
        ipc.invoke(IPC_CHANNELS.GET_SITES),
      ]);
      if (!this.mounted) return;
      this.setState({
        settings: settings ?? { autoIndex: true, excludedSiteIds: [] },
        sites: sites ?? [],
        loading: false,
      });
    } catch {
      if (!this.mounted) return;
      this.setState({ loading: false });
    }
  };

  handleAutoIndexToggle = (): void => {
    this.setState(
      (prev) => ({
        settings: { ...prev.settings, autoIndex: !prev.settings.autoIndex },
        saved: false,
      }),
      () => this.saveSettings(),
    );
  };

  handleSiteExclusionToggle = (siteId: string): void => {
    this.setState(
      (prev) => {
        const excluded = prev.settings.excludedSiteIds;
        const isExcluded = excluded.includes(siteId);
        return {
          settings: {
            ...prev.settings,
            excludedSiteIds: isExcluded
              ? excluded.filter((id) => id !== siteId)
              : [...excluded, siteId],
          },
          saved: false,
        };
      },
      () => this.saveSettings(),
    );
  };

  saveSettings = async (): Promise<void> => {
    try {
      await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.UPDATE_SETTINGS,
        this.state.settings,
      );
      if (this.mounted) this.setState({ saved: true });
    } catch {
      // Best-effort save
    }
  };

  render(): React.ReactNode {
    const { settings, sites, loading } = this.state;

    if (loading) {
      return React.createElement('div', {
        style: { padding: '24px', color: 'var(--nxai-card-sub, #6b7280)' },
      }, 'Loading preferences...');
    }

    return React.createElement('div', { style: { padding: '24px' } },
      // Auto-index toggle
      React.createElement('div', { style: sectionStyle },
        React.createElement('div', { style: labelStyle }, 'Auto-Index'),
        React.createElement('div', { style: descStyle },
          'When enabled, site content is automatically indexed for AI search when a site starts.',
        ),
        React.createElement('label', { style: checkboxRowStyle },
          React.createElement('input', {
            type: 'checkbox',
            checked: settings.autoIndex,
            onChange: this.handleAutoIndexToggle,
            style: { width: '16px', height: '16px', cursor: 'pointer' },
          }),
          React.createElement('span', {
            style: { fontSize: '14px', color: 'var(--nxai-card-text, #111827)' },
          }, 'Automatically index sites when started'),
        ),
      ),

      // Per-site exclusions (only when auto-index is on)
      settings.autoIndex
        ? React.createElement('div', { style: sectionStyle },
            React.createElement('div', { style: labelStyle }, 'Excluded Sites'),
            React.createElement('div', { style: descStyle },
              'Checked sites will not be auto-indexed when started. You can still manually index them.',
            ),
            sites.length === 0
              ? React.createElement('div', { style: descStyle }, 'No sites found.')
              : sites.map((site) =>
                  React.createElement('label', {
                    key: site.id,
                    style: checkboxRowStyle,
                  },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: settings.excludedSiteIds.includes(site.id),
                      onChange: () => this.handleSiteExclusionToggle(site.id),
                      style: { width: '16px', height: '16px', cursor: 'pointer' },
                    }),
                    React.createElement('span', {
                      style: { fontSize: '13px', color: 'var(--nxai-card-text, #111827)' },
                    }, site.name),
                    React.createElement('span', {
                      style: {
                        fontSize: '11px',
                        color: site.status === 'running' ? UI_COLORS.STATUS_RUNNING : 'var(--nxai-card-sub)',
                        marginLeft: '4px',
                      },
                    }, `(${site.status})`),
                  ),
                ),
          )
        : null,
    );
  }
}
