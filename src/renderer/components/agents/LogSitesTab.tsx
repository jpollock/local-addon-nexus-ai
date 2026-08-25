import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import {
  LogSourcesState, LogSiteRow, deriveLogSiteRows, deriveOrphans, formatRelative,
} from './logSourcesModel';
import { LogBucketModal } from './LogBucketModal';
import { deriveScale, renderScaleControls, renderPager, PAGE, PAGE_MORE, ScaleFilter } from './sitesScale';

/**
 * log-processor's Sites tab — the working surface for its log sources.
 *
 * One list, not two. The switch on each row IS `scope.siteIds`; there is no separate sources
 * table and no basket-style scope picker for this agent. handoff_log_sources_v3/DECISIONS.md §2
 * documents why: two lists answering "which sites run" produced a reconciliation state for every
 * disagreement — an amber "in scope but no log source" banner, a "3 selected · 2 will process"
 * arithmetic line, skip rows in every run result. The fix was not better reconciliation.
 *
 * Everything countable on this screen is derived by the caller from one set (see
 * logSourcesModel.runnableSiteIds) and passed in, so the tab badge, the header line and the
 * footnote here cannot drift apart.
 */

interface Props {
  electron?: any;
  state: LogSourcesState;
  loading: boolean;
  /** `scope.siteIds` as persisted for this agent. */
  scope: string[];
  cadenceLabel: string;
  onScopeChange: (siteIds: string[]) => void;
  /** Re-reads the bucket/install cache after a scan or rescan. */
  onReload: () => void;
  /**
   * Open Nexus AI → Settings → Connections, where the shared AWS credential lives.
   *
   * Unlike Google's, this credential really is dashboard state rather than agent state, so the
   * destination is a section of the app's own Settings — reachable only by asking the dashboard,
   * since neither the tab nor the section within it is a route. Optional: without it the buttons
   * name the location in prose instead of offering a click that goes nowhere.
   */
  onOpenAwsSettings?: () => void;
}

export type SitesFilter = 'logs' | 'on' | 'all';

interface State {
  modalOpen: boolean;
  rescanning: boolean;
  rescanError: string | null;
  filter: SitesFilter;
  query: string;
  /** How many rows are rendered. Reset to PAGE whenever the result set changes. */
  limit: number;
}

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/** Filter set for this agent: the rows that can run, the rows that do, and everything. */
const FILTERS: ScaleFilter<LogSiteRow>[] = [
  { id: 'logs', label: 'With logs',   match: r => r.hasLogs },
  { id: 'on',   label: 'Switched on', match: r => r.on },
  { id: 'all',  label: 'All installs', match: () => true },
];

const ENV_CHIP: Record<string, { color: string; bg: string }> = {
  production:  { color: 'var(--ag-picker-danger)',  bg: 'rgba(244,104,95,0.12)' },
  staging:     { color: 'var(--ag-picker-warning)', bg: 'rgba(242,181,68,0.12)' },
  development: { color: 'var(--ag-picker-violet)',  bg: 'rgba(123,140,255,0.13)' },
  local:       { color: 'var(--ag-picker-text-dim)', bg: 'rgba(139,146,156,0.12)' },
};

export class LogSitesTab extends React.Component<Props, State> {
  // The default is `logs`, not `all`: an account can hold 500 installs and write logs for three
  // of them, so the fleet is the exception view, not the landing view (BEHAVIOR.md §4).
  state: State = { modalOpen: false, rescanning: false, rescanError: null, filter: 'logs', query: '', limit: PAGE };

  private toggle(row: LogSiteRow): void {
    // An install with no objects cannot be switched on. This is why there is no "in scope but
    // nothing to read" warning anywhere in the design — the state is unreachable.
    if (!row.hasLogs) return;
    const next = new Set(this.props.scope);
    if (next.has(row.name)) next.delete(row.name); else next.add(row.name);
    this.props.onScopeChange(Array.from(next));
  }

  /** Switch on every install that has logs. Offered only where "all" is unambiguous — see below. */
  private switchAllOn(rows: LogSiteRow[]): void {
    const next = new Set(this.props.scope);
    for (const r of rows) if (r.hasLogs) next.add(r.name);
    this.props.onScopeChange(Array.from(next));
  }

  /**
   * Everything the table and its controls render, derived in one place from `allRows`.
   *
   * Search deliberately ignores the active filter and covers every install on the account
   * (BEHAVIOR.md §4, README.md §5, TEST-PLAN). "Where is my site?" has to be answerable once,
   * not once per filter — a site absent from a filtered search reads as missing rather than
   * filtered out. The counts on the chips stay whole-account and live either way.
   */
  private derive(allRows: LogSiteRow[]) {
    const scale = deriveScale(allRows, FILTERS, this.state, r => r.name);
    const offWithLogs = scale.counts.logs - scale.counts.on;
    return {
      ...scale,
      offWithLogs,
      // Bulk is offered only where "all" cannot be misread: the With logs view, nothing filtered
      // out by a search, and something actually left to switch on.
      showBulk: this.state.filter === 'logs' && !scale.searching && offWithLogs > 0,
    };
  }

  private rescan = async (): Promise<void> => {
    const ipc = this.props.electron?.ipcRenderer;
    if (!ipc) return;
    this.setState({ rescanning: true, rescanError: null });
    const result = await ipc.invoke(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'log-processor',
      toolName: 'rescan_log_bucket',
      args: { format: 'json' },
    }).catch((e: Error) => ({ content: [{ type: 'text', text: e.message }], isError: true }));

    const text = result?.content?.[0]?.text;
    let message: string | null = null;
    if (result?.isError) {
      try { message = JSON.parse(text)?.message ?? text; } catch { message = text ?? 'Rescan failed.'; }
    }
    this.setState({ rescanning: false, rescanError: message });
    this.props.onReload();
  };

  // ── bucket card ────────────────────────────────────────────────────────────

  private renderBucketCard(rows: LogSiteRow[]) {
    const { state } = this.props;
    const bucket = state.bucket!;
    const orphans = deriveOrphans(state);
    const totalObjects = state.installs.reduce((s, i) => s + i.objectCount, 0);
    const mine = rows.filter(r => r.hasLogs).length;
    const scanned = formatRelative(bucket.lastScannedAt);

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
          }, 'Log bucket'),
          React.createElement('div', {
            style: { fontFamily: MONO, fontSize: 13, marginTop: 6, color: 'var(--ag-picker-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
          }, `s3://${bucket.bucket}/${bucket.prefix}`),
          React.createElement('div', {
            style: { fontSize: 11.5, color: 'var(--ag-picker-text-dim)', marginTop: 5 },
          }, [
            bucket.region,
            `${totalObjects.toLocaleString()} apache-style object${totalObjects === 1 ? '' : 's'}`,
            `${mine} of your installs`,
            scanned ? `scanned ${scanned}` : 'never scanned',
          ].join(' · ')),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 10, flex: 'none' } },
          React.createElement('button', {
            onClick: () => { void this.rescan(); },
            disabled: this.state.rescanning,
            style: {
              background: 'var(--ag-picker-bg-raised)', border: '1px solid var(--ag-picker-border-strong)',
              color: 'var(--ag-picker-text-primary)', fontWeight: 500, fontSize: 12.5,
              padding: '8px 15px', borderRadius: 8,
              cursor: this.state.rescanning ? 'wait' : 'pointer', opacity: this.state.rescanning ? 0.6 : 1,
            },
          }, this.state.rescanning ? 'Rescanning…' : 'Rescan'),
          React.createElement('button', {
            onClick: () => this.setState({ modalOpen: true }),
            style: {
              background: 'var(--ag-picker-bg-raised)', border: '1px solid var(--ag-picker-border)',
              color: 'var(--ag-picker-text-secondary)', fontWeight: 500, fontSize: 12.5,
              padding: '8px 15px', borderRadius: 8, cursor: 'pointer',
            },
          }, 'Change'),
        ),
      ),

      this.state.rescanError && React.createElement('div', {
        style: {
          marginTop: 14, padding: '12px 14px', borderRadius: 9, fontSize: 12,
          color: 'var(--ag-picker-danger)', background: 'rgba(244,104,95,0.07)',
          border: '1px solid rgba(244,104,95,0.3)', lineHeight: 1.55,
        },
      }, `Rescan failed: ${this.state.rescanError}`),

      // Grey, not amber: an install in the bucket that is not on this account explains an
      // object-count gap. There is nothing to fix, so it must not read as a warning.
      orphans.length > 0 && React.createElement('div', {
        style: {
          display: 'flex', gap: 11, alignItems: 'flex-start', marginTop: 14, padding: '12px 14px',
          background: 'var(--ag-picker-bg-sunken)', border: '1px solid var(--ag-picker-border-faint)', borderRadius: 9,
        },
      },
        React.createElement('span', {
          style: { flex: 'none', width: 7, height: 7, borderRadius: '50%', background: 'var(--ag-picker-text-muted)', marginTop: 5 },
        }),
        React.createElement('div', { style: { flex: 1, fontSize: 12, color: 'var(--ag-picker-text-dim)', lineHeight: 1.55 } },
          orphans.length === 1
            ? `The bucket also holds logs for ${orphans[0].site} (${orphans[0].objectCount.toLocaleString()} objects), which is not an install on this WP Engine account. They are ignored.`
            : `${orphans.length} installs in the bucket are not on this WP Engine account. Their logs are ignored.`,
        ),
      ),
    );
  }

  // ── install table ──────────────────────────────────────────────────────────

  private renderRow(row: LogSiteRow) {
    const chip = ENV_CHIP[row.environment] ?? ENV_CHIP.production;
    const stateLabel = row.on ? `runs ${this.props.cadenceLabel}` : row.hasLogs ? 'switched off' : 'nothing to process';
    const synced = formatRelative(row.lastSyncedAt);
    const syncLabel = !row.hasLogs ? '—' : synced ? `Last synced ${synced}` : 'Never synced';

    return React.createElement('div', {
      key: row.name,
      style: {
        display: 'flex', gap: 14, alignItems: 'center', padding: '14px 20px',
        borderBottom: '1px solid var(--ag-picker-border-faint)',
        background: row.on ? 'rgba(53,208,197,0.04)' : 'transparent',
      },
    },
      React.createElement('div', { style: { width: 46, flex: 'none' } },
        React.createElement('div', {
          role: 'switch',
          'aria-checked': row.on,
          'aria-label': `Include ${row.name} in every run`,
          'aria-disabled': !row.hasLogs,
          onClick: () => this.toggle(row),
          style: {
            width: 34, height: 20, borderRadius: 10, position: 'relative' as const,
            cursor: row.hasLogs ? 'pointer' : 'not-allowed',
            background: row.on ? 'var(--ag-picker-success)' : 'var(--ag-picker-border)',
            opacity: row.hasLogs ? 1 : 0.45,
          },
        },
          React.createElement('span', {
            style: {
              position: 'absolute' as const, top: 3, left: row.on ? 17 : 3, width: 14, height: 14,
              borderRadius: '50%', background: row.on ? '#fff' : 'var(--ag-picker-text-muted)',
              transition: 'left .15s ease',
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
          style: { fontSize: 11, marginTop: 4, color: row.on ? 'var(--ag-picker-teal)' : 'var(--ag-picker-text-muted)' },
        }, stateLabel),
      ),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        row.hasLogs
          ? React.createElement('div', null,
              React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)' } },
                `${row.objectCount.toLocaleString()} object${row.objectCount === 1 ? '' : 's'}` +
                (row.newestObjectAt ? ` · to ${row.newestObjectAt}` : '')),
              row.sampleKey && React.createElement('div', {
                style: { fontFamily: MONO, fontSize: 11, color: 'var(--ag-picker-text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
              }, row.sampleKey),
            )
          : React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-picker-text-muted)' } }, 'None in this bucket'),
      ),
      React.createElement('div', { style: { width: 132, flex: 'none' } },
        React.createElement('div', {
          style: { fontSize: 12.5, color: row.on ? 'var(--ag-picker-text-primary)' : 'var(--ag-picker-text-muted)' },
        }, syncLabel),
      ),
    );
  }

  private renderControls(d: ReturnType<LogSitesTab['derive']>, allRows: LogSiteRow[]) {
    return renderScaleControls({
      filters: FILTERS,
      state: this.state,
      result: d,
      noun: 'installs',
      searchPlaceholder: 'Search installs…',
      searchLabel: 'Search installs',
      onFilter: (id) => this.setState({ filter: id as SitesFilter, limit: PAGE }),
      onQuery: (query) => this.setState({ query, limit: PAGE }),
      bulk: d.showBulk
        ? { label: `Switch all ${d.counts.logs.toLocaleString()} on`, onClick: () => this.switchAllOn(allRows) }
        : null,
    });
  }

  private renderEmptyResult(d: ReturnType<LogSitesTab['derive']>) {
    const copy = d.searching
      ? {
          title: `No install matches “${this.state.query.trim()}”`,
          sub: `Searching all ${d.counts.all.toLocaleString()} installs on this account.`,
        }
      : this.state.filter === 'on'
        ? { title: 'Nothing switched on yet', sub: 'Switch on an install from the With logs view.' }
        : this.state.filter === 'logs'
          ? {
              title: 'No installs have logs in this bucket',
              sub: 'Rescan if you expect some, or check the prefix on the bucket card above.',
            }
          : { title: 'No WP Engine installs found', sub: 'Connect a WP Engine account to see installs here.' };

    return React.createElement('div', { style: { padding: '30px 20px', textAlign: 'center' as const } },
      React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-picker-text-secondary)' } }, copy.title),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-picker-text-muted)', marginTop: 6 } }, copy.sub),
    );
  }

  private renderTable(allRows: LogSiteRow[]) {
    const d = this.derive(allRows);
    const headCell = (width: number | null, label: string) => React.createElement('div', {
      key: label,
      style: width ? { width, flex: 'none' } : { flex: 1 },
    }, label);

    return React.createElement('div', null,
      React.createElement('div', { style: { marginBottom: 14 } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-picker-text-primary)' } }, 'Sites'),
        React.createElement('div', {
          style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', marginTop: 5, lineHeight: 1.5, maxWidth: 600 },
        }, 'Switch an install on to include it in every run. Only installs with logs in this bucket can be switched on.'),
      ),

      this.renderControls(d, allRows),

      React.createElement('div', {
        style: {
          background: 'var(--ag-picker-bg-surface)', border: '1px solid var(--ag-picker-border)',
          borderRadius: 12, overflow: 'hidden',
        },
      },
        React.createElement('div', {
          style: {
            display: 'flex', gap: 14, padding: '11px 20px 9px', fontSize: 10.5,
            letterSpacing: '0.5px', textTransform: 'uppercase' as const,
            color: 'var(--ag-picker-text-muted)', borderBottom: '1px solid var(--ag-picker-border-faint)',
          },
        },
          headCell(46, 'Runs'), headCell(190, 'Install'), headCell(null, 'Apache-style logs'), headCell(132, 'Last sync'),
        ),

        d.visible.length === 0
          ? this.renderEmptyResult(d)
          : d.visible.map(r => this.renderRow(r)),

        renderPager(d, () => this.setState({ limit: this.state.limit + PAGE_MORE })),
      ),

      React.createElement('div', {
        style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)', marginTop: 12, lineHeight: 1.6 },
      },
        `${d.counts.logs.toLocaleString()} of ${d.counts.all.toLocaleString()} install${d.counts.all === 1 ? '' : 's'} ` +
        'on this account have logs in this bucket · ' +
        (d.counts.on === 0 ? 'none run' : `${d.counts.on} run${d.counts.on === 1 ? 's' : ''} ${this.props.cadenceLabel}`) +
        '. Only apache-style objects are read; access logs in the same folder are ignored. ' +
        'Switching one off stops future runs — it never deletes what has already been processed.',
      ),
    );
  }

  // ── empty states ───────────────────────────────────────────────────────────

  private renderEmpty() {
    const connected = this.props.state.aws.connected;
    return React.createElement('div', {
      style: {
        background: 'var(--ag-picker-bg-surface)', border: '1px solid var(--ag-picker-border)',
        borderRadius: 12, padding: '38px 24px 42px', textAlign: 'center' as const,
      },
    },
      React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-picker-text-primary)' } },
        'No log bucket connected'),
      React.createElement('div', {
        style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', margin: '8px auto 0', maxWidth: 470, lineHeight: 1.55 },
      }, 'WP Engine writes every install\'s access logs into one bucket. Point this agent at it once — your installs are matched by name automatically.'),

      // Exactly one live action. When AWS is not connected the bucket button is ABSENT, not
      // disabled beside an enabled twin — a disabled button next to an enabled one loses by
      // visual weight and dead-ends the user (DECISIONS.md, principles).
      //
      // The same rule now decides whether there is a button at all: the not-connected action can
      // only be offered if something upstream can open Settings for us. It used to call
      // `openNexusPreferences()`, which navigated to the route already on screen — a live-looking
      // button that dead-ended exactly like the disabled twin this design rejected. The footnote
      // below names the location in prose either way, so nothing is lost when it is absent.
      (connected || this.props.onOpenAwsSettings) && React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 } },
        React.createElement('button', {
          onClick: () => { if (connected) this.setState({ modalOpen: true }); else this.props.onOpenAwsSettings!(); },
          style: {
            background: 'var(--ag-picker-teal)', color: 'var(--ag-picker-on-teal)', border: 'none',
            fontWeight: 600, fontSize: 13, padding: '9px 18px', borderRadius: 8, cursor: 'pointer',
          },
        }, connected ? 'Connect a bucket' : 'Connect AWS account'),
      ),
      React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)', marginTop: 14 } },
        connected
          ? 'For WP Engine this is usually one bucket per account, with a wpe_logs/ prefix.'
          : 'The AWS credential lives in Nexus AI → Settings → Connections and is shared with every agent.',
      ),
    );
  }

  render() {
    const { state, loading } = this.props;
    const rows = deriveLogSiteRows(state, this.props.scope);

    // The skeleton is for the FIRST load only, and it must never replace the whole subtree.
    //
    // Returning early on `loading` unmounted the modal on every refresh — including the refresh
    // the modal itself triggers on a successful connect. React tore the modal down mid-flow and
    // rebuilt it from its constructor, so the scan result flashed past and the user was handed
    // back an empty form over a now-populated table. A reload is new data for content that is
    // already on screen; it is not a reason to destroy what the user is interacting with.
    const showSkeleton = loading && !state.bucket && state.installs.length === 0;

    return React.createElement('div', null,
      showSkeleton
        ? React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-picker-text-muted)', padding: '8px 0' } }, 'Loading log sources…')
        : null,
      showSkeleton ? null : this.renderBody(rows),

      this.state.modalOpen && React.createElement(LogBucketModal, {
        electron: this.props.electron,
        aws: state.aws,
        fleet: state.fleet,
        initial: state.bucket
          ? { bucket: state.bucket.bucket, region: state.bucket.region, prefix: state.bucket.prefix }
          : undefined,
        onClose: () => this.setState({ modalOpen: false }),
        onConnected: this.props.onReload,
        // Its credential errors end where this tab's own do — one route out, passed through.
        onOpenAwsSettings: this.props.onOpenAwsSettings,
      }),
    );
  }

  private renderBody(rows: LogSiteRow[]) {
    return this.props.state.bucket
      ? React.createElement('div', null, this.renderBucketCard(rows), this.renderTable(rows))
      : this.renderEmpty();
  }
}
