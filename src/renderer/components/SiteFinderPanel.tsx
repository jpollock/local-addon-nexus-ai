/**
 * Site Finder Panel Component (Sprint 4+)
 *
 * Advanced site search with multiple filter criteria.
 * Features:
 * - Text search (name/domain)
 * - Plugin filter (has specific plugin installed)
 * - Theme filter (has specific theme installed)
 * - PHP version filter
 * - WP version filter
 * - Apply/Clear buttons
 *
 * Class-based -- Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';

interface SiteFinderPanelProps {
  electron: any;
  onFilterApply?: (siteIds: string[]) => void;
}

interface SiteFinderPanelState {
  searchText: string;
  selectedPlugins: string[];
  selectedThemes: string[];
  selectedPhpVersions: string[];
  selectedWpVersions: string[];
  availablePlugins: string[];
  availableThemes: string[];
  availablePhpVersions: string[];
  availableWpVersions: string[];
  loading: boolean;
  applying: boolean;
  resultsCount: number | null;
}

// -- Styles --

const containerStyle: React.CSSProperties = {
  borderRadius: '10px',
  padding: '20px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  marginBottom: '16px',
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '16px',
  alignItems: 'start',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  color: 'var(--nxai-card-label, #6b7280)',
  marginBottom: '8px',
  gridColumn: '1 / -1',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--nxai-card-sub, #6b7280)',
  marginBottom: '12px',
  fontStyle: 'italic',
  gridColumn: '1 / -1',
};

const formGroupStyle: React.CSSProperties = {
  marginBottom: '14px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--nxai-card-text)',
  marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  fontSize: '13px',
  color: 'var(--nxai-card-text)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  fontSize: '13px',
  color: 'var(--nxai-card-text)',
  backgroundColor: 'var(--nxai-card-bg, #fff)',
  outline: 'none',
  boxSizing: 'border-box',
  cursor: 'pointer',
  minHeight: '80px',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  gridColumn: '1 / -1',
  marginTop: '8px',
};

const applyButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 16px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: '#3b82f6',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const clearButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 16px',
  borderRadius: '6px',
  border: '1px solid var(--nxai-card-border, #e5e7eb)',
  backgroundColor: 'transparent',
  color: 'var(--nxai-card-text)',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const resultsStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  backgroundColor: '#3b82f610',
  border: '1px solid #3b82f640',
  color: '#3b82f6',
  fontSize: '12px',
  fontWeight: 600,
  textAlign: 'center',
  gridColumn: '1 / -1',
};

const loadingStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '20px',
  color: 'var(--nxai-card-sub, #6b7280)',
  fontSize: '13px',
};

/**
 * SiteFinderPanel Component
 */
export class SiteFinderPanel extends React.Component<SiteFinderPanelProps, SiteFinderPanelState> {
  private _mounted = false;

  state: SiteFinderPanelState = {
    searchText: '',
    selectedPlugins: [],
    selectedThemes: [],
    selectedPhpVersions: [],
    selectedWpVersions: [],
    availablePlugins: [],
    availableThemes: [],
    availablePhpVersions: [],
    availableWpVersions: [],
    loading: true,
    applying: false,
    resultsCount: null,
  };

  componentDidMount(): void {
    this._mounted = true;
    this.fetchFilterOptions();
  }

  componentWillUnmount(): void {
    this._mounted = false;
  }

  fetchFilterOptions = async (): Promise<void> => {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SITE_FINDER_GET_OPTIONS,
      );

      if (!this._mounted) return;

      if (result.success) {
        this.setState({
          availablePlugins: result.plugins || [],
          availableThemes: result.themes || [],
          availablePhpVersions: result.phpVersions || [],
          availableWpVersions: result.wpVersions || [],
          loading: false,
        });
      } else {
        this.setState({ loading: false });
      }
    } catch {
      if (!this._mounted) return;
      this.setState({ loading: false });
    }
  };

  handleApply = async (): Promise<void> => {
    if (this.state.applying) return;

    this.setState({ applying: true });

    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SITE_FINDER_APPLY,
        {
          searchText: this.state.searchText,
          plugins: this.state.selectedPlugins,
          themes: this.state.selectedThemes,
          phpVersions: this.state.selectedPhpVersions,
          wpVersions: this.state.selectedWpVersions,
        },
      );

      if (!this._mounted) return;

      this.setState({
        applying: false,
        resultsCount: result.success ? (result.siteIds?.length || 0) : null,
      });

      if (result.success && this.props.onFilterApply) {
        this.props.onFilterApply(result.siteIds || []);
      }
    } catch {
      if (!this._mounted) return;
      this.setState({ applying: false });
    }
  };

  handleClear = (): void => {
    this.setState({
      searchText: '',
      selectedPlugins: [],
      selectedThemes: [],
      selectedPhpVersions: [],
      selectedWpVersions: [],
      resultsCount: null,
    });

    if (this.props.onFilterApply) {
      this.props.onFilterApply([]);
    }
  };

  render(): React.ReactNode {
    const { loading, applying, resultsCount } = this.state;

    if (loading) {
      return React.createElement(
        'div',
        { style: containerStyle },
        React.createElement('div', { style: titleStyle }, 'Site Finder'),
        React.createElement('div', { style: loadingStyle }, 'Loading filter options...'),
      );
    }

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement('div', { style: titleStyle }, 'Site Finder'),
      React.createElement('div', { style: subtitleStyle }, 'Theme filter requires running sites'),

      // Search text
      React.createElement(
        'div',
        { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'Name or Domain'),
        React.createElement('input', {
          style: inputStyle,
          type: 'text',
          placeholder: 'Search by name or domain...',
          value: this.state.searchText,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            this.setState({ searchText: e.target.value }),
        }),
      ),

      // Plugin filter
      React.createElement(
        'div',
        { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'Has Plugin (hold Cmd/Ctrl for multiple)'),
        React.createElement(
          'select',
          {
            style: selectStyle,
            multiple: true,
            value: this.state.selectedPlugins,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
              this.setState({ selectedPlugins: selected });
            },
          },
          this.state.availablePlugins.map(plugin =>
            React.createElement('option', { key: plugin, value: plugin }, plugin),
          ),
        ),
      ),

      // Theme filter
      React.createElement(
        'div',
        { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'Has Theme (hold Cmd/Ctrl for multiple)'),
        React.createElement(
          'select',
          {
            style: selectStyle,
            multiple: true,
            value: this.state.selectedThemes,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
              this.setState({ selectedThemes: selected });
            },
          },
          this.state.availableThemes.map(theme =>
            React.createElement('option', { key: theme, value: theme }, theme),
          ),
        ),
      ),

      // PHP version filter
      React.createElement(
        'div',
        { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'PHP Version (hold Cmd/Ctrl for multiple)'),
        React.createElement(
          'select',
          {
            style: selectStyle,
            multiple: true,
            value: this.state.selectedPhpVersions,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
              this.setState({ selectedPhpVersions: selected });
            },
          },
          this.state.availablePhpVersions.map(version =>
            React.createElement('option', { key: version, value: version }, version),
          ),
        ),
      ),

      // WP version filter
      React.createElement(
        'div',
        { style: formGroupStyle },
        React.createElement('label', { style: labelStyle }, 'WordPress Version (hold Cmd/Ctrl for multiple)'),
        React.createElement(
          'select',
          {
            style: selectStyle,
            multiple: true,
            value: this.state.selectedWpVersions,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
              this.setState({ selectedWpVersions: selected });
            },
          },
          this.state.availableWpVersions.map(version =>
            React.createElement('option', { key: version, value: version }, version),
          ),
        ),
      ),

      // Buttons
      React.createElement(
        'div',
        { style: buttonRowStyle },
        React.createElement(
          'button',
          {
            style: { ...applyButtonStyle, opacity: applying ? 0.6 : 1 },
            onClick: this.handleApply,
            disabled: applying,
          },
          applying ? 'Applying...' : 'Apply Filters',
        ),
        React.createElement(
          'button',
          {
            style: clearButtonStyle,
            onClick: this.handleClear,
          },
          'Clear',
        ),
      ),

      // Results count
      resultsCount !== null
        ? React.createElement(
            'div',
            { style: resultsStyle },
            `Found ${resultsCount} site${resultsCount === 1 ? '' : 's'}`,
          )
        : null,
    );
  }
}
