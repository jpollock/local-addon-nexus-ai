import * as React from 'react';

/**
 * Filter / search / paging for an agent's Sites tab, shared by every agent that has one.
 *
 * The rules come from handoff_log_sources_v3/BEHAVIOR.md §4 and are the same whatever the agent
 * is listing, so they live here rather than being reimplemented per tab:
 *
 * - Default to the rows that can actually do something. Never render the whole fleet on load —
 *   500 installs with three of them usable is a normal shape, not an edge case.
 * - Search covers **every** row regardless of the active filter. "Where is my site?" has to be
 *   answerable in one place; a site missing from a filtered search reads as absent rather than
 *   filtered out.
 * - Counts are derived on every render, never cached, so a chip can't disagree with its table.
 * - Page at 25, and put the shown count in the label so position in a long list is legible.
 */

export const PAGE = 25;
export const PAGE_MORE = 50;

export interface ScaleFilter<T> {
  id: string;
  label: string;
  match: (row: T) => boolean;
}

export interface ScaleState {
  filter: string;
  query: string;
  limit: number;
}

export interface ScaleResult<T> {
  /** Whole-account counts per filter id — unaffected by the search. */
  counts: Record<string, number>;
  matched: T[];
  visible: T[];
  searching: boolean;
  total: number;
}

export function deriveScale<T>(
  rows: T[],
  filters: ScaleFilter<T>[],
  state: ScaleState,
  nameOf: (row: T) => string,
): ScaleResult<T> {
  const q = state.query.trim().toLowerCase();

  const counts: Record<string, number> = {};
  for (const f of filters) counts[f.id] = rows.filter(f.match).length;

  const active = filters.find(f => f.id === state.filter) ?? filters[0];
  const base = q ? rows : rows.filter(active ? active.match : () => true);
  const matched = q ? base.filter(r => nameOf(r).toLowerCase().includes(q)) : base;

  return {
    counts,
    matched,
    visible: matched.slice(0, state.limit),
    searching: q.length > 0,
    total: rows.length,
  };
}

interface ControlsOpts<T> {
  filters: ScaleFilter<T>[];
  state: ScaleState;
  result: ScaleResult<T>;
  searchPlaceholder: string;
  searchLabel: string;
  onFilter: (id: string) => void;
  onQuery: (q: string) => void;
  /** Rendered at the end of the row. Callers decide when a bulk action is unambiguous. */
  bulk?: { label: string; onClick: () => void } | null;
  /** Noun for the "search isn't narrowed by this filter" line, e.g. "installs" / "sites". */
  noun: string;
}

export function renderScaleControls<T>(o: ControlsOpts<T>): React.ReactElement {
  const chip = (f: ScaleFilter<T>) => {
    const active = o.state.filter === f.id;
    return React.createElement('span', {
      key: f.id,
      role: 'tab',
      'aria-selected': active,
      onClick: () => o.onFilter(f.id),
      style: {
        fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
        whiteSpace: 'nowrap' as const,
        background: active ? 'rgba(53,208,197,0.16)' : 'transparent',
        color: active ? 'var(--ag-picker-teal)' : 'var(--ag-picker-text-dim)',
      },
    }, `${f.label} ${(o.result.counts[f.id] ?? 0).toLocaleString()}`);
  };

  // The last filter is the unfiltered one by convention ("All …"), so the explanatory line is
  // suppressed there — nothing looks narrowed when nothing is.
  const lastId = o.filters[o.filters.length - 1]?.id;

  return React.createElement('div', null,
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } },
      React.createElement('div', {
        role: 'tablist',
        style: {
          display: 'flex', gap: 4, background: 'var(--ag-picker-bg-raised)',
          border: '1px solid var(--ag-picker-border-faint)', borderRadius: 9, padding: 3, flex: 'none',
        },
      }, ...o.filters.map(chip)),
      React.createElement('input', {
        value: o.state.query,
        placeholder: o.searchPlaceholder,
        'aria-label': o.searchLabel,
        onChange: (e: any) => o.onQuery(e.target.value),
        style: {
          flex: 1, minWidth: 0, boxSizing: 'border-box' as const,
          background: 'var(--ag-picker-bg-sunken)', border: '1px solid var(--ag-picker-border-faint)',
          borderRadius: 9, padding: '9px 13px', fontSize: 12.5,
          color: 'var(--ag-picker-text-primary)', outline: 'none',
        },
      }),
      o.bulk && React.createElement('span', {
        onClick: o.bulk.onClick,
        style: { flex: 'none', fontSize: 12.5, color: 'var(--ag-picker-teal)', cursor: 'pointer' },
      }, o.bulk.label),
    ),
    o.result.searching && o.state.filter !== lastId && React.createElement('div', {
      style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)', margin: '-4px 0 12px' },
    }, `Search covers all ${o.result.total.toLocaleString()} ${o.noun} on this account, not just this filter.`),
  );
}

export function renderPager<T>(result: ScaleResult<T>, onMore: () => void): React.ReactElement | false {
  const remaining = result.matched.length - result.visible.length;
  if (remaining <= 0) return false;
  return React.createElement('div', {
    onClick: onMore,
    style: {
      padding: '13px 20px', textAlign: 'center' as const, fontSize: 12.5,
      color: 'var(--ag-picker-teal)', cursor: 'pointer', borderTop: '1px solid var(--ag-picker-border-faint)',
    },
  }, `Showing ${result.visible.length.toLocaleString()} of ${result.matched.length.toLocaleString()} · Show ${Math.min(PAGE_MORE, remaining)} more`);
}
