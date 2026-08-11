import * as React from 'react';
import type { ScopeSite, ScopeSiteEnv, ScopeSitePlatform } from './fetchScopeSites';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlatformFilter = 'all' | ScopeSitePlatform;

export interface SitePickerProps {
  sites: ScopeSite[];
  /** Controlled — the parent owns the selection so both placements can read/derive from it
   * (Settings needs "Save N sites", Run Now needs a diff against the schedule scope). This is
   * the basket's contents: the only thing filtering/search ever narrows is what's LISTED on the
   * left, never what's selected — see `design_handoff_site_picker` v2, "the biggest failure mode
   * of the shipped UI". */
  selection: Set<string>;
  onChange: (next: Set<string>) => void;
  /** When false, production rows are locked: non-interactive, add box shows an em-dash, and
   * locked sites are excluded from every quick-add shortcut. */
  allowsProduction: boolean;
}

interface SitePickerState {
  query: string;
  platformFilter: PlatformFilter;
}

const ENV_ORDER: ScopeSiteEnv[] = ['production', 'staging', 'development', 'local'];

const ENV_LABEL: Record<ScopeSiteEnv, string> = {
  production: 'Production', staging: 'Staging', development: 'Development', local: 'Local',
};

const ENV_BADGE: Record<ScopeSiteEnv, { fg: string; bg: string; dot: string }> = {
  production:  { fg: 'var(--ag-picker-danger)', bg: 'rgba(255,107,122,0.14)', dot: 'var(--ag-picker-danger-dot)' },
  staging:     { fg: 'var(--ag-picker-warning)', bg: 'rgba(240,181,46,0.13)',  dot: 'var(--ag-picker-warning)' },
  development: { fg: 'var(--ag-picker-info)', bg: 'rgba(124,182,255,0.13)', dot: 'var(--ag-picker-info)' },
  local:       { fg: 'var(--ag-picker-violet)', bg: 'rgba(183,155,255,0.13)', dot: 'var(--ag-picker-violet)' },
};

const PLATFORM_ORDER: ScopeSitePlatform[] = ['WP Engine', 'Local', 'External'];

const MAX_VISIBLE_ROWS = 60;

/** Shared by AgentRunModal and AgentWorkspaceSettings to drive the production-escalation footer
 * (row badges and basket grouping live inside SitePicker; the footer note/button color are the
 * parent's job because they differ by placement — see Site Picker v2.dc.html §"Production
 * warning"). */
export function selectedProductionCount(sites: ScopeSite[], selection: Set<string>): number {
  const bySite = new Map(sites.map(s => [s.id, s]));
  let count = 0;
  for (const id of selection) if (bySite.get(id)?.environment === 'production') count++;
  return count;
}

/** "N live production sites will be scanned/modified" — the verb comes from the agent's declared
 * effect, never hardcoded (an earlier draft said "will be write to live sites" for every agent,
 * which was false for read-only agents like security-sentinel). */
export function productionWarningVerb(effect: 'readonly' | 'writes'): string {
  return effect === 'readonly' ? 'scanned' : 'modified';
}

function matchesName(site: ScopeSite, q: string): boolean {
  return site.name.toLowerCase().includes(q);
}
function matchesId(site: ScopeSite, q: string): boolean {
  return site.id.toLowerCase().includes(q);
}

export class SitePicker extends React.Component<SitePickerProps, SitePickerState> {
  state: SitePickerState = { query: '', platformFilter: 'all' };

  private isLocked = (site: ScopeSite): boolean => !this.props.allowsProduction && site.environment === 'production';

  /** Left-list rows: search + platform only. Never touches the basket. */
  private getVisible(): ScopeSite[] {
    const { sites } = this.props;
    const { query, platformFilter } = this.state;
    const q = query.trim().toLowerCase();
    return sites.filter(s => {
      if (q && !matchesName(s, q) && !matchesId(s, q)) return false;
      if (platformFilter !== 'all' && s.platform !== platformFilter) return false;
      return true;
    });
  }

  private getSelectable(sites: ScopeSite[]): ScopeSite[] {
    return sites.filter(s => !this.isLocked(s));
  }

  private toggleSite(site: ScopeSite): void {
    if (this.isLocked(site)) return;
    const next = new Set(this.props.selection);
    next.has(site.id) ? next.delete(site.id) : next.add(site.id);
    this.props.onChange(next);
  }

  private removeSite = (id: string): void => {
    const next = new Set(this.props.selection);
    next.delete(id);
    this.props.onChange(next);
  };

  /** Quick-add chips are additive — they never replace the basket, only add to it. */
  private addMany = (sites: ScopeSite[]): void => {
    const next = new Set(this.props.selection);
    for (const s of this.getSelectable(sites)) next.add(s.id);
    this.props.onChange(next);
  };

  private addAllWpEngine = (): void => this.addMany(this.props.sites.filter(s => s.platform === 'WP Engine'));
  private addAllNonProd = (): void => this.addMany(this.props.sites.filter(s => s.environment !== 'production'));
  private addEverything = (): void => this.addMany(this.props.sites);

  private clearAll = (): void => this.props.onChange(new Set());

  private removeGroup = (env: ScopeSiteEnv): void => {
    const idsInEnv = new Set(this.props.sites.filter(s => s.environment === env).map(s => s.id));
    const next = new Set([...this.props.selection].filter(id => !idsInEnv.has(id)));
    this.props.onChange(next);
  };

  // ─── Left panel ───────────────────────────────────────────────────────────

  private renderSearchAndTabs() {
    const { sites } = this.props;
    const { query, platformFilter } = this.state;

    const counts: Record<PlatformFilter, number> = {
      all: sites.length, 'WP Engine': 0, Local: 0, External: 0,
    } as Record<PlatformFilter, number>;
    for (const s of sites) counts[s.platform] = (counts[s.platform] ?? 0) + 1;

    const tab = (value: PlatformFilter, label: string) => {
      const active = platformFilter === value;
      return React.createElement('button', {
        key: value,
        onClick: () => this.setState({ platformFilter: value }),
        style: {
          fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
          color: active ? 'var(--ag-picker-bg-page)' : 'var(--ag-picker-text-dim)',
          background: active ? 'var(--ag-picker-teal)' : 'transparent',
          border: `1px solid ${active ? 'var(--ag-picker-teal)' : 'var(--ag-picker-control-border)'}`,
        },
      }, `${label} ${counts[value] ?? 0}`);
    };

    return React.createElement('div', { style: { padding: '13px 15px 11px', borderBottom: '1px solid var(--ag-picker-border-subtle)' } },
      React.createElement('input', {
        value: query,
        placeholder: 'Search sites…',
        onChange: (e: any) => this.setState({ query: e.target.value }),
        style: {
          width: '100%', boxSizing: 'border-box', background: 'var(--ag-picker-bg-page)', border: '1px solid var(--ag-picker-control-border)',
          borderRadius: 9, padding: '9px 13px', color: 'var(--ag-picker-text-primary)', fontSize: 14,
        },
      }),
      React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' } },
        tab('all', 'All'),
        // A platform with zero sites is a dead end — selecting it can only ever show "No sites
        // match" — so its tab is omitted rather than rendered disabled or left to wrap the row.
        ...PLATFORM_ORDER.filter(p => (counts[p] ?? 0) > 0).map(p => tab(p, p)),
      ),
    );
  }

  private renderRow(site: ScopeSite, matchedById: boolean) {
    const locked = this.isLocked(site);
    const inScope = this.props.selection.has(site.id);
    const badge = ENV_BADGE[site.environment];

    return React.createElement('div', {
      key: site.id,
      title: site.id,
      onClick: () => this.toggleSite(site),
      style: {
        padding: '8px 15px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid var(--ag-picker-border-faint)', cursor: locked ? 'not-allowed' : 'pointer',
        opacity: locked ? 0.45 : inScope ? 0.4 : 1,
      },
    },
      React.createElement('div', {
        style: {
          width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${locked ? 'var(--ag-picker-addbox-border)' : inScope ? 'var(--ag-picker-teal)' : 'var(--ag-picker-addbox-border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          fontSize: 11, lineHeight: 1, color: locked ? 'var(--ag-picker-text-faint)' : inScope ? 'var(--ag-picker-teal)' : 'var(--ag-picker-text-faint)',
        },
      }, locked ? '—' : inScope ? '✓' : '+'),
      React.createElement('span', {
        style: { fontSize: 14, fontWeight: 600, color: locked ? 'var(--ag-picker-text-faint)' : 'var(--ag-picker-text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: matchedById ? '0 1 auto' : 1, minWidth: 0 },
      }, site.name),
      matchedById && React.createElement('span', {
        style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ag-picker-text-faintest)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }, site.id),
      React.createElement('span', { style: { fontSize: 11, color: 'var(--ag-picker-text-faint)', flexShrink: 0 } }, site.platform),
      React.createElement('span', {
        style: {
          fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', padding: '2px 6px', borderRadius: 4,
          color: badge.fg, background: badge.bg, flexShrink: 0,
        },
      }, ENV_LABEL[site.environment].toUpperCase()),
    );
  }

  private renderList(visible: ScopeSite[]) {
    const q = this.state.query.trim().toLowerCase();
    const shown = visible.slice(0, MAX_VISIBLE_ROWS);

    if (visible.length === 0) {
      return React.createElement('div', { style: { padding: '24px 15px', color: 'var(--ag-picker-text-dim)', fontSize: 13 } }, 'No sites match');
    }

    const tail = visible.length > MAX_VISIBLE_ROWS
      ? `Showing ${MAX_VISIBLE_ROWS} of ${visible.length} — keep typing to narrow.`
      : 'End of results.';

    return React.createElement('div', { style: { flex: '1 1 auto', overflowY: 'auto' } },
      ...shown.map(site => this.renderRow(site, !!q && !matchesName(site, q) && matchesId(site, q))),
      React.createElement('div', { key: 'tail', style: { padding: '9px 15px', fontSize: 12, color: 'var(--ag-picker-text-faintest)' } }, tail),
    );
  }

  // ─── Right panel — the basket ───────────────────────────────────────────────

  private renderQuickAdd() {
    const chip = (label: string, onClick: () => void) =>
      React.createElement('button', {
        key: label,
        onClick,
        style: {
          fontSize: 12, fontWeight: 600, padding: '5px 9px', borderRadius: 7, cursor: 'pointer',
          color: 'var(--ag-picker-text-dim)', background: 'transparent', border: '1px dashed var(--ag-picker-dashed-border)',
        },
      }, label);

    return React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' } },
      chip('+ All WP Engine', this.addAllWpEngine),
      chip('+ All non-prod', this.addAllNonProd),
      chip('+ Everything', this.addEverything),
    );
  }

  private renderBasketHeader() {
    const { selection } = this.props;
    return React.createElement('div', { style: { padding: '13px 15px 11px', borderBottom: '1px solid var(--ag-picker-border-subtle)' } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: 'var(--ag-picker-text-strong)' } },
          'In scope ', React.createElement('span', { style: { color: 'var(--ag-picker-teal)' } }, String(selection.size))),
        selection.size > 0 && React.createElement('button', {
          onClick: this.clearAll,
          style: { fontSize: 12, color: 'var(--ag-picker-text-dimmer)', background: 'transparent', border: 'none', cursor: 'pointer' },
        }, 'Clear'),
      ),
      this.renderQuickAdd(),
    );
  }

  private renderBasketGroup(env: ScopeSiteEnv, sites: ScopeSite[]) {
    if (sites.length === 0) return null;
    const isProd = env === 'production';
    const dotColor = ENV_BADGE[env].dot;
    const shown = sites.slice(0, 5);
    const extra = sites.length - shown.length;

    return React.createElement('div', { key: env },
      React.createElement('div', {
        style: {
          padding: '8px 15px', borderBottom: '1px solid var(--ag-picker-border-faint)', display: 'flex', alignItems: 'center', gap: 7,
          background: isProd ? 'rgba(255,107,122,0.1)' : 'transparent',
        },
      },
        React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 } }),
        React.createElement('span', {
          style: {
            fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', flex: 1,
            color: isProd ? 'var(--ag-picker-danger)' : 'var(--ag-picker-text-faint-alt)',
          },
        }, ENV_LABEL[env]),
        React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: isProd ? 'var(--ag-picker-danger)' : 'var(--ag-picker-text-faint-alt)' } }, sites.length),
        React.createElement('button', {
          onClick: () => this.removeGroup(env),
          title: `Remove all ${ENV_LABEL[env].toLowerCase()} sites`,
          style: { fontSize: 14, color: 'var(--ag-picker-disabled-text)', background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1 },
        }, '×'),
      ),
      ...shown.map(site => React.createElement('div', {
        key: site.id,
        style: { padding: '5px 15px 5px 29px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      },
        React.createElement('span', { style: { fontSize: 13, color: 'var(--ag-picker-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: 0 } }, site.name),
        React.createElement('button', {
          onClick: () => this.removeSite(site.id),
          style: { fontSize: 14, color: 'var(--ag-picker-disabled-text)', background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1, flexShrink: 0 },
        }, '×'),
      )),
      extra > 0 && React.createElement('div', { style: { padding: '3px 15px 6px 29px', fontSize: 11, color: 'var(--ag-picker-text-faintest)' } }, `+ ${extra} more`),
    );
  }

  /**
   * IDs in `selection` that don't resolve against `sites` — e.g. a site disconnected, renamed,
   * or removed from the account since it was added to scope; for log-processor specifically, a
   * scope saved before the id convention there became "site name" can carry an id from the old
   * scheme. These used to be silently dropped from the basket while still counting toward
   * `selection.size`, so "In scope 3" could disagree with what the visible groups summed to and
   * "Save 3 sites" would silently re-save the same phantom entry forever. Rendering them
   * explicitly is what makes them fixable instead of an invisible discrepancy.
   */
  private renderUnresolvedGroup(ids: string[]) {
    if (ids.length === 0) return null;
    return React.createElement('div', { key: '__unresolved' },
      React.createElement('div', {
        style: { padding: '8px 15px', borderBottom: '1px solid var(--ag-picker-border-faint)', display: 'flex', alignItems: 'center', gap: 7 },
      },
        React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: 'var(--ag-picker-warning)', flexShrink: 0 } }),
        React.createElement('span', {
          style: { fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', flex: 1, color: 'var(--ag-picker-warning)' },
        }, 'NOT FOUND'),
        React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--ag-picker-warning)' } }, ids.length),
      ),
      ...ids.map(id => React.createElement('div', {
        key: id,
        title: 'No longer available — was this site disconnected, renamed, or removed?',
        style: { padding: '5px 15px 5px 29px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      },
        React.createElement('span', {
          style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--ag-picker-text-faint-alt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: 0 },
        }, id),
        React.createElement('button', {
          onClick: () => this.removeSite(id),
          title: 'Remove',
          style: { fontSize: 14, color: 'var(--ag-picker-disabled-text)', background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1, flexShrink: 0 },
        }, '×'),
      )),
    );
  }

  private renderBasketContents() {
    const { sites, selection } = this.props;
    if (selection.size === 0) {
      return React.createElement('div', { style: { padding: '15px', fontSize: 12, lineHeight: 1.5, color: 'var(--ag-picker-text-faintest)' } },
        'Nothing selected yet. Add sites from the left, or use a shortcut above.');
    }
    const bySite = new Map(sites.map(s => [s.id, s]));
    const grouped: Record<ScopeSiteEnv, ScopeSite[]> = { production: [], staging: [], development: [], local: [] };
    const unresolved: string[] = [];
    for (const id of selection) {
      const site = bySite.get(id);
      if (site) grouped[site.environment].push(site);
      else unresolved.push(id);
    }
    return React.createElement('div', { style: { flex: '1 1 auto', overflowY: 'auto' } },
      ...ENV_ORDER.map(env => this.renderBasketGroup(env, grouped[env])),
      this.renderUnresolvedGroup(unresolved),
    );
  }

  private renderPolicyBanner() {
    if (this.props.allowsProduction) return null;
    const prodCount = this.props.sites.filter(s => s.environment === 'production').length;
    if (prodCount === 0) return null;
    return React.createElement('div', {
      style: {
        background: 'rgba(255,107,122,0.07)', border: '1px solid rgba(255,107,122,0.26)', borderRadius: 11,
        padding: '11px 14px', marginBottom: 12, fontSize: 14, color: 'var(--ag-picker-danger-locked-text)',
      },
    }, `${prodCount} production site${prodCount === 1 ? '' : 's'} cannot be selected by this agent.`);
  }

  render() {
    const visible = this.getVisible();
    return React.createElement('div', null,
      this.renderPolicyBanner(),
      React.createElement('div', {
        style: { border: '1px solid var(--ag-picker-border-strong)', borderRadius: 12, background: 'var(--ag-picker-bg-surface)', overflow: 'hidden', height: 400, display: 'flex' },
      },
        React.createElement('div', { style: { flex: '1 1 0', minWidth: 0, borderRight: '1px solid var(--ag-picker-border-subtle)', display: 'flex', flexDirection: 'column' } },
          this.renderSearchAndTabs(),
          this.renderList(visible),
        ),
        React.createElement('div', { style: { flex: '0 0 276px', background: 'var(--ag-picker-bg-sunken)', display: 'flex', flexDirection: 'column' } },
          this.renderBasketHeader(),
          this.renderBasketContents(),
        ),
      ),
    );
  }
}
