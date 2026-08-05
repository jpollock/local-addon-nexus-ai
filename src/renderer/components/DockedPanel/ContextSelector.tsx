import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import type { SiteSource } from '../../../common/types';

interface SiteOption {
  id: string;
  name: string;
  source: SiteSource;
  environment?: string;
}

interface Props {
  electron: any;
  selectedSiteIds: string[];
  onChange: (ids: string[]) => void;
}

interface State {
  open: boolean;
  sites: SiteOption[];
  assembling: boolean;
}

const styles = {
  root: { position: 'relative' as const, display: 'inline-block' },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#10262b',
    border: '1px solid #22697a',
    borderRadius: 12,
    color: '#5fd2e5',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    userSelect: 'none' as const,
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    marginTop: 4,
    background: '#23272f',
    border: '1px solid #2c313a',
    borderRadius: 6,
    minWidth: 220,
    zIndex: 10000,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    padding: '6px 0',
  },
  section: {
    padding: '4px 12px',
    color: '#868d98',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 12px',
    cursor: 'pointer',
    color: '#e4e7ec',
    fontSize: 12,
  },
  badge: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 4,
    background: '#2c313a',
    color: '#868d98',
    textTransform: 'uppercase' as const,
  },
};

export class ContextSelector extends React.Component<Props, State> {
  private dropdownRef = React.createRef<HTMLDivElement>();

  constructor(props: Props) {
    super(props);
    this.state = { open: false, sites: [], assembling: false };
    this.toggleOpen = this.toggleOpen.bind(this);
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    this.toggleSite = this.toggleSite.bind(this);
    this.toggleAll = this.toggleAll.bind(this);
  }

  componentDidMount() {
    this.loadSites();
    document.addEventListener('mousedown', this.handleOutsideClick);
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleOutsideClick);
  }

  async loadSites() {
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_SITES);
      // result is a flat array of local site objects
      const sites: SiteOption[] = (Array.isArray(result) ? result : []).map((s: any) => ({
        id: s.id,
        name: s.name,
        source: s.isWpe ? ('wpe' as const) : ('local' as const),
        environment: s.wpeEnvironment,
      }));
      this.setState({ sites });
    } catch {
      /* ignore */
    }

    try {
      const externalHosts = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS);
      if (Array.isArray(externalHosts) && externalHosts.length > 0) {
        const externalOptions: SiteOption[] = externalHosts.map((h: { alias: string; environment: string; domain: string }) => ({
          id: `ssh:${h.alias}`,
          name: h.alias,
          source: 'external' as const,
          environment: h.environment,
        }));
        this.setState((prev) => ({ sites: [...prev.sites, ...externalOptions] }));
      }
    } catch {
      // External hosts are optional context — failing to fetch them must not
      // block the local/WPE site list from working.
    }
  }

  handleOutsideClick(e: MouseEvent) {
    if (this.dropdownRef.current && !this.dropdownRef.current.contains(e.target as Node)) {
      this.setState({ open: false });
    }
  }

  toggleOpen() {
    this.setState((s) => ({ open: !s.open }));
  }

  toggleSite(id: string) {
    const { selectedSiteIds, onChange } = this.props;
    const next = selectedSiteIds.includes(id)
      ? selectedSiteIds.filter((s) => s !== id)
      : [...selectedSiteIds, id];
    if (next.length === 0) return; // prevent empty selection
    onChange(next);
  }

  toggleAll() {
    const { selectedSiteIds, onChange } = this.props;
    const { sites } = this.state;
    if (selectedSiteIds.length === sites.length) {
      // Keep at least one
      if (sites.length > 0) onChange([sites[0].id]);
    } else {
      onChange(sites.map((s) => s.id));
    }
  }

  render() {
    const { selectedSiteIds } = this.props;
    const { open, sites } = this.state;
    const localSites = sites.filter((s) => s.source === 'local');
    const remoteSites = sites.filter((s) => s.source === 'wpe');
    const externalSites = sites.filter((s) => s.source === 'external');
    const allSelected = sites.length > 0 && selectedSiteIds.length === sites.length;
    const label = allSelected
      ? `All sites · ${localSites.length} local · ${remoteSites.length} remote · ${externalSites.length} external`
      : `${selectedSiteIds.length} site${selectedSiteIds.length !== 1 ? 's' : ''}`;

    return React.createElement(
      'div',
      { style: styles.root, ref: this.dropdownRef },
      React.createElement('div', { style: styles.pill, onClick: this.toggleOpen }, label, ' ▾'),
      open
        ? React.createElement(
            'div',
            { style: styles.dropdown },
            // All sites toggle
            React.createElement(
              'div',
              { style: styles.row, onClick: this.toggleAll },
              React.createElement('input', { type: 'checkbox', checked: allSelected, readOnly: true }),
              'All sites',
            ),
            localSites.length > 0
              ? React.createElement('div', { style: styles.section }, 'Local')
              : null,
            ...localSites.map((site) =>
              React.createElement(
                'div',
                { key: site.id, style: styles.row, onClick: () => this.toggleSite(site.id) },
                React.createElement('input', { type: 'checkbox', checked: selectedSiteIds.includes(site.id), readOnly: true }),
                site.name,
              )
            ),
            remoteSites.length > 0
              ? React.createElement('div', { style: styles.section }, 'Remote')
              : null,
            ...remoteSites.map((site) =>
              React.createElement(
                'div',
                { key: site.id, style: styles.row, onClick: () => this.toggleSite(site.id) },
                React.createElement('input', { type: 'checkbox', checked: selectedSiteIds.includes(site.id), readOnly: true }),
                site.name,
                site.environment
                  ? React.createElement('span', { style: styles.badge }, site.environment)
                  : null,
              )
            ),
            externalSites.length > 0
              ? React.createElement('div', { style: styles.section }, 'External')
              : null,
            ...externalSites.map((site) =>
              React.createElement(
                'div',
                { key: site.id, style: styles.row, onClick: () => this.toggleSite(site.id) },
                React.createElement('input', { type: 'checkbox', checked: selectedSiteIds.includes(site.id), readOnly: true }),
                site.name,
                site.environment
                  ? React.createElement('span', { style: styles.badge }, site.environment)
                  : null,
              )
            ),
          )
        : null,
    );
  }
}
