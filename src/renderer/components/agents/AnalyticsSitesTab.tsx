import * as React from 'react';
import { AnalyticsState, AnalyticsSiteRow, deriveAnalyticsRows } from './analyticsSitesModel';
import { Ga4PropertyModal } from './Ga4PropertyModal';
import { deriveScale, renderScaleControls, renderPager, PAGE, PAGE_MORE, ScaleFilter } from './sitesScale';
import { openNexusPreferences } from './openNexusPreferences';

/**
 * web-analytics' Sites tab.
 *
 * Same name and same anatomy as log-processor's, because it answers the same question: which of my
 * sites does this agent cover, and what does it need per site? The account card sits on top, one
 * row per site beneath, and the scale controls carry live counts. Google's own noun ("property")
 * stays in the column and the picker, where the user is actually reading Google's list — not in
 * the navigation of this app.
 */

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const ENV_CHIP: Record<string, { color: string; bg: string }> = {
  production:  { color: 'var(--ag-picker-danger)',  bg: 'rgba(244,104,95,0.12)' },
  staging:     { color: 'var(--ag-picker-warning)', bg: 'rgba(242,181,68,0.12)' },
  development: { color: 'var(--ag-picker-violet)',  bg: 'rgba(123,140,255,0.13)' },
  local:       { color: 'var(--ag-picker-text-dim)', bg: 'rgba(139,146,156,0.12)' },
};

const FILTERS: ScaleFilter<AnalyticsSiteRow>[] = [
  { id: 'bound',   label: 'With a property', match: r => r.bound },
  { id: 'unbound', label: 'Unbound',         match: r => !r.bound },
  { id: 'all',     label: 'All sites',       match: () => true },
];

interface Props {
  electron?: any;
  state: AnalyticsState;
  loading: boolean;
  cadenceLabel: string;
  /** The scopes the agent itself declares. Requested verbatim — never a constant kept here. */
  googleScopes?: string[];
  onReload: () => void;
}

interface State {
  filter: string;
  query: string;
  limit: number;
  /** Site name whose picker is open. */
  picking: string | null;
  granting: boolean;
  /** Why the last access request did not complete. Null while nothing has failed. */
  grantError: string | null;
  /** The failure was a build-configuration fault, refused before the browser opened. */
  grantBlocked: boolean;
}

export class AnalyticsSitesTab extends React.Component<Props, State> {
  // Defaults to the sites that can actually run, not the fleet — same reason as log-processor.
  state: State = { filter: 'bound', query: '', limit: PAGE, picking: null, granting: false, grantError: null, grantBlocked: false };

  private derive(rows: AnalyticsSiteRow[]) {
    return deriveScale(rows, FILTERS, this.state, r => r.name);
  }

  // ── account card ───────────────────────────────────────────────────────────

  private renderAccountCard(rows: AnalyticsSiteRow[]) {
    const { google } = this.props.state;
    const bound = rows.filter(r => r.bound).length;
    // Distinct properties in use — two sites can legitimately share one, so this is not `bound`.
    const distinct = new Set(rows.filter(r => r.binding).map(r => r.binding!.property)).size;

    return React.createElement('div', {
      style: {
        background: 'var(--ag-picker-bg-surface)', border: '1px solid var(--ag-picker-border)',
        borderRadius: 12, padding: '18px 22px', marginBottom: 18,
      },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', {
            style: { fontSize: 10.5, letterSpacing: '0.5px', textTransform: 'uppercase' as const, color: 'var(--ag-picker-text-muted)' },
          }, 'Google account'),
          React.createElement('div', {
            style: { fontFamily: MONO, fontSize: 13, marginTop: 6, color: 'var(--ag-picker-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
          }, google.label ?? 'connected'),
          React.createElement('div', {
            style: { fontSize: 11.5, color: 'var(--ag-picker-text-dim)', marginTop: 5 },
          }, [
            'Analytics read-only',
            `${bound} of ${rows.length} site${rows.length === 1 ? '' : 's'} bound`,
            `${distinct} propert${distinct === 1 ? 'y' : 'ies'} in use`,
          ].join(' · ')),
        ),
        React.createElement('button', {
          onClick: () => openNexusPreferences(),
          style: {
            flex: 'none', background: 'var(--ag-picker-bg-raised)', border: '1px solid var(--ag-picker-border)',
            color: 'var(--ag-picker-text-secondary)', fontWeight: 500, fontSize: 12.5,
            padding: '8px 15px', borderRadius: 8, cursor: 'pointer',
          },
        }, 'Manage account'),
      ),
    );
  }

  // ── rows ───────────────────────────────────────────────────────────────────

  private renderRow(row: AnalyticsSiteRow) {
    const chip = ENV_CHIP[row.environment] ?? ENV_CHIP.local;
    const stateLabel = row.bound ? `runs ${this.props.cadenceLabel}` : 'no property bound';

    return React.createElement('div', {
      key: row.name,
      style: {
        display: 'flex', gap: 14, alignItems: 'center', padding: '14px 18px',
        borderBottom: '1px solid var(--ag-picker-border-faint)',
        background: row.bound ? 'rgba(53,208,197,0.04)' : 'transparent',
      },
    },
      React.createElement('div', { style: { width: 46, flex: 'none' } },
        React.createElement('span', {
          'aria-label': row.bound ? `${row.name} is bound and runs` : `${row.name} has no property bound`,
          style: {
            display: 'block', width: 34, height: 20, borderRadius: 10, position: 'relative' as const,
            background: row.bound ? 'var(--ag-picker-success)' : 'var(--ag-picker-border)',
            opacity: row.bound ? 1 : 0.45,
          },
        },
          React.createElement('span', {
            style: {
              position: 'absolute' as const, top: 3, left: row.bound ? 17 : 3, width: 14, height: 14,
              borderRadius: '50%', background: row.bound ? '#fff' : 'var(--ag-picker-text-muted)',
            },
          }),
        ),
      ),
      React.createElement('div', { style: { width: 190, flex: 'none', minWidth: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', {
            style: { fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: 'var(--ag-picker-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
          }, row.name),
          React.createElement('span', {
            style: { fontSize: 9.5, fontWeight: 700, letterSpacing: '0.4px', color: chip.color, background: chip.bg, padding: '2px 7px', borderRadius: 4, flex: 'none' },
          }, row.environment.toUpperCase()),
        ),
        React.createElement('div', {
          style: { fontSize: 11, marginTop: 4, color: row.bound ? 'var(--ag-picker-teal)' : 'var(--ag-picker-text-muted)' },
        }, stateLabel),
      ),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        row.binding
          ? React.createElement('div', null,
              React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)' } },
                // A binding written before the agent stored the label has only the id. Showing the
                // id is honest; inventing a name would not be.
                row.binding.displayName ?? 'Bound property'),
              React.createElement('div', {
                style: { fontFamily: MONO, fontSize: 11, color: 'var(--ag-picker-text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
              }, row.binding.property),
            )
          : React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-picker-text-muted)' } }, 'None bound'),
      ),
      React.createElement('div', { style: { width: 132, flex: 'none' } },
        React.createElement('span', {
          onClick: () => this.setState({ picking: row.name }),
          style: { fontSize: 12.5, color: 'var(--ag-picker-teal)', cursor: 'pointer' },
        }, row.bound ? 'Change' : 'Choose a property →'),
      ),
    );
  }

  private renderEmptyResult(d: ReturnType<AnalyticsSitesTab['derive']>) {
    const copy = d.searching
      ? {
          title: `No site matches “${this.state.query.trim()}”`,
          sub: `Searching all ${d.total.toLocaleString()} sites on this account.`,
        }
      : this.state.filter === 'bound'
        ? { title: 'No sites have a property bound yet', sub: 'Pick a site from All sites and bind the GA4 property that belongs to it.' }
        : this.state.filter === 'unbound'
          ? { title: 'Every site has a property bound', sub: 'Nothing left to set up.' }
          : { title: 'No sites found', sub: 'Add a site in Local, or connect a WP Engine account.' };

    return React.createElement('div', { style: { padding: '30px 20px', textAlign: 'center' as const } },
      React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-picker-text-secondary)' } }, copy.title),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-picker-text-muted)', marginTop: 6 } }, copy.sub),
    );
  }

  private renderTable(rows: AnalyticsSiteRow[]) {
    const d = this.derive(rows);
    const headCell = (width: number | null, label: string) => React.createElement('div', {
      key: label,
      style: width ? { width, flex: 'none' } : { flex: 1 },
    }, label);

    return React.createElement('div', null,
      React.createElement('div', { style: { marginBottom: 14 } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-picker-text-primary)' } }, 'Sites'),
        React.createElement('div', {
          style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', marginTop: 5, lineHeight: 1.5, maxWidth: 620 },
        }, 'Bind a GA4 property to a site to include it in every run. A site with no property is skipped.'),
      ),

      renderScaleControls({
        filters: FILTERS,
        state: this.state,
        result: d,
        noun: 'sites',
        searchPlaceholder: 'Search sites…',
        searchLabel: 'Search sites',
        onFilter: (id) => this.setState({ filter: id, limit: PAGE }),
        onQuery: (query) => this.setState({ query, limit: PAGE }),
        // No bulk action here, deliberately: "bind all" has no unambiguous meaning when every
        // site needs a different property chosen for it.
        bulk: null,
      }),

      React.createElement('div', {
        style: {
          background: 'var(--ag-picker-bg-surface)', border: '1px solid var(--ag-picker-border)',
          borderRadius: 12, overflow: 'hidden',
        },
      },
        React.createElement('div', {
          style: {
            display: 'flex', gap: 14, padding: '11px 18px 9px', fontSize: 10.5,
            letterSpacing: '0.5px', textTransform: 'uppercase' as const,
            color: 'var(--ag-picker-text-muted)', borderBottom: '1px solid var(--ag-picker-border-faint)',
          },
        },
          headCell(46, 'Runs'), headCell(190, 'Site'), headCell(null, 'GA4 property'), headCell(132, ''),
        ),
        d.visible.length === 0 ? this.renderEmptyResult(d) : d.visible.map(r => this.renderRow(r)),
        renderPager(d, () => this.setState({ limit: this.state.limit + PAGE_MORE })),
      ),

      React.createElement('div', {
        style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)', marginTop: 12, lineHeight: 1.6 },
      },
        `${d.counts.bound.toLocaleString()} of ${d.total.toLocaleString()} site${d.total === 1 ? '' : 's'} ` +
        'on this account have a GA4 property bound · ' +
        (d.counts.bound === 0 ? 'none run' : `${d.counts.bound} run${d.counts.bound === 1 ? 's' : ''} ${this.props.cadenceLabel}`) +
        '. Binding a property changes nothing in Google Analytics — it only tells this agent where to read.',
      ),
    );
  }

  /** Ask the agent's own credential flow for access. Same call its tools make when they hit a
   * missing grant, so the user gets Google's consent screen for exactly this agent's scopes. */
  private requestAccess = async (): Promise<void> => {
    const ipc = this.props.electron?.ipcRenderer;
    if (!ipc) return;
    this.setState({ granting: true, grantError: null });
    const result = await ipc.invoke('nexus-ai:credential:connect', {
      provider: 'google',
      agentId: 'web-analytics',
      siteId: '',
      scopes: this.props.googleScopes ?? [],
    }).catch((e: Error) => ({ ok: false, reason: 'error', message: e?.message }));

    // A consent the user completed that then failed has to say so. Reporting nothing leaves them
    // on the screen they started from, having done everything right, with no way to tell whether
    // the app is still working or has quietly given up.
    const message = result?.ok
      ? null
      : result?.reason === 'cancelled'
        ? null
        : result?.reason === 'state_mismatch'
          ? 'The browser sent back a response this app didn\'t start. Close any other Local windows and try again.'
          : (result?.message ?? 'Google sign-in did not complete.');

    // A build-configuration fault is not the user's to retry — refused before the browser opened,
    // so nothing was spent and "you can try again" would be false.
    const preflight = !result?.ok && typeof result?.message === 'string'
      && result.message.startsWith('No OAuth client');

    this.setState({ granting: false, grantError: message, grantBlocked: preflight });
    this.props.onReload();
  };

  private renderEmpty() {
    const { google } = this.props.state;
    const revoked = google.status === 'revoked';

    // Three distinct situations, and they need three different sentences. Saying "not connected"
    // to someone looking at their own connected account is simply false, and "connect Google" is
    // advice they have already followed.
    const copy = revoked
      ? {
          title: 'Google access was revoked',
          body: 'Reconnect to keep reporting. Your bindings are kept — nothing needs setting up again.',
          action: 'Reconnect Google account',
        }
      : google.accountExists
        ? {
            title: 'This agent can\'t use your Google account yet',
            body: `${google.label ?? 'Your Google account'} is connected, but each agent is granted access separately — `
              + 'so one agent can never quietly use what another was authorised for. Granting takes one click and asks '
              + 'only for Analytics read access.',
            action: 'Grant access to web-analytics',
          }
        : {
            title: 'No Google account connected',
            body: 'Google Analytics is read with your own account, read-only. Connect once, then bind a property to '
              + 'each site you want reported on.',
            action: 'Connect Google account',
          };

    return React.createElement('div', {
      style: {
        background: 'var(--ag-picker-bg-surface)', border: '1px solid var(--ag-picker-border)',
        borderRadius: 12, padding: '38px 24px 42px', textAlign: 'center' as const,
      },
    },
      React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-picker-text-primary)' } }, copy.title),
      React.createElement('div', {
        style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', margin: '8px auto 0', maxWidth: 470, lineHeight: 1.55 },
      }, copy.body),
      // Exactly one live action. The bind flow is absent, not disabled — it cannot work yet.
      React.createElement('div', { style: { marginTop: 20 } },
        React.createElement('button', {
          onClick: () => { void this.requestAccess(); },
          disabled: this.state.granting,
          style: {
            background: 'var(--ag-picker-teal)', color: 'var(--ag-picker-on-teal)', border: 'none',
            fontWeight: 600, fontSize: 13, padding: '9px 18px', borderRadius: 8, cursor: 'pointer',
          },
        }, this.state.granting ? 'Waiting for Google…' : copy.action),
      ),
      this.state.grantError && React.createElement('div', {
        style: {
          margin: '18px auto 0', maxWidth: 470, padding: '12px 14px', borderRadius: 9,
          background: 'rgba(244,104,95,0.07)', border: '1px solid rgba(244,104,95,0.32)',
          textAlign: 'left' as const,
        },
      },
        React.createElement('div', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--ag-picker-danger)' } },
          this.state.grantBlocked ? 'Google sign-in isn\'t configured in this build' : 'Sign-in did not complete'),
        React.createElement('div', {
          style: { fontSize: 12, color: 'var(--ag-picker-text-secondary)', marginTop: 4, lineHeight: 1.5 },
        }, this.state.grantBlocked
          ? 'Nothing was sent to Google. This needs fixing in the app, not by retrying.'
          : 'Nothing has been changed. You can try again.'),
        React.createElement('div', {
          style: {
            marginTop: 9, padding: '7px 10px', borderRadius: 7, fontFamily: MONO, fontSize: 11,
            color: 'var(--ag-picker-text-dim)', background: 'var(--ag-picker-bg-sunken)',
            border: '1px solid var(--ag-picker-border-faint)', wordBreak: 'break-word' as const,
          },
        }, this.state.grantError),
      ),
      React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)', marginTop: 14 } },
        google.accountExists
          ? 'Manage the account itself in Preferences → Nexus AI → Connected accounts.'
          : 'The connection lives in Preferences → Nexus AI and is shared with every agent.'),
    );
  }

  render() {
    const { state, loading } = this.props;
    const rows = deriveAnalyticsRows(state);
    const showSkeleton = loading && !state.google.connected && !state.google.accountExists && rows.length === 0;

    return React.createElement('div', null,
      showSkeleton
        ? React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-picker-text-muted)', padding: '8px 0' } }, 'Loading sites…')
        : null,
      showSkeleton
        ? null
        : state.google.connected
          ? React.createElement('div', null, this.renderAccountCard(rows), this.renderTable(rows))
          : this.renderEmpty(),

      this.state.picking && React.createElement(Ga4PropertyModal, {
        electron: this.props.electron,
        siteName: this.state.picking,
        current: state.bindings[this.state.picking],
        onClose: () => this.setState({ picking: null }),
        onBound: this.props.onReload,
      }),
    );
  }
}
