/**
 * Properties view — the fleet collapse (plan 2026-08-24, Phase 2).
 *
 * Row = web property; places nest under it. The ratified contract, drawn:
 * single-place rows are FLAT (no caret — 74% of real rows), "Where" is an
 * origin partition whose counts sum, state filters compose with it, search
 * never hides a hit (out-of-filter matches render labelled), the `nothing`
 * rung leads the header with the view's only warning-coloured slot, ceilings
 * are stated per place, the roll-up is the labelled set-minimum, and
 * collision pairs stay separate.
 *
 * Property names are UNTRUSTED TEXT (a real portal Site is named
 * `<script>alert()</script>`) — everything renders through createElement,
 * which escapes; no markup path may be added here.
 *
 * Sits beside SitesTab as a view toggle, not a replacement — enrich, don't
 * replace; SitesTab is retired by a packet, not a side effect.
 */
import * as React from 'react';
import { KNOWLEDGE_LABELS } from '../../../main/fleet/knowledgeLadder';
import type { FleetCollapse, PropertyView, PlaceView, CheckedView } from '../../../main/fleet/fleetCollapse';

type OriginFilter = 'all' | 'local' | 'wpe' | 'external';
type StateFilter = 'all' | 'nothing' | 'copy' | 'attention';

interface PropertiesTabProps {
  /** False until the first GET_FLEET_COLLAPSE response has landed. */
  loaded: boolean;
  /** The read failed — distinct from an empty fleet; never conflate them. */
  failed: boolean;
  collapse: FleetCollapse | null;
  onRetry: () => void;
}

interface PropertiesTabState {
  origin: OriginFilter;
  state: StateFilter;
  query: string;
  /** Property keys the user has expanded. */
  open: Record<string, boolean>;
}

const ORIGIN_LABELS: Array<{ key: OriginFilter; label: string }> = [
  { key: 'all', label: 'Everywhere' },
  { key: 'local', label: 'This Mac' },
  { key: 'wpe', label: 'WP Engine' },
  { key: 'external', label: 'External' },
];

const STATE_LABELS: Array<{ key: StateFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'nothing', label: 'Never looked inside' },
  { key: 'copy', label: 'Has a copy here' },
];

const h = React.createElement;

function ageOf(c: CheckedView): string {
  if (c.state === 'never' || !c.finishedAt) return 'never checked';
  const hrs = (Date.now() - Date.parse(c.finishedAt)) / 3600_000;
  const a = !Number.isFinite(hrs) ? '?' : hrs < 1 ? `${Math.max(0, Math.round(hrs * 60))}m ago` : hrs < 48 ? `${Math.round(hrs)}h ago` : `${Math.round(hrs / 24)}d ago`;
  return a;
}

function checkedText(c: CheckedView, labelOldest: boolean): string {
  if (c.state === 'fail') return `failed ${ageOf(c)} — ${c.reason ?? 'no reason recorded'}`;
  if (c.state === 'never' || !c.finishedAt) return 'never checked';
  const prefix = labelOldest ? 'oldest ' : '';
  return `${prefix}${ageOf(c)}`;
}

function matchesState(p: PropertyView, state: StateFilter): boolean {
  if (state === 'nothing') return p.rungs.includes('nothing');
  if (state === 'copy') return p.hasCopy || p.origin === 'local';
  if (state === 'attention')
    return p.oldest.state === 'fail' || p.collision || p.rungs.includes('nothing') || p.places.some((pl) => pl.ceiling !== null);
  return true;
}

export class PropertiesTab extends React.Component<PropertiesTabProps, PropertiesTabState> {
  constructor(props: PropertiesTabProps) {
    super(props);
    this.state = { origin: 'all', state: 'all', query: '', open: {} };
  }

  private toggleOpen = (key: string): void => {
    this.setState((s) => ({ open: { ...s.open, [key]: !s.open[key] } }));
  };

  private renderPlace(pl: PlaceView): React.ReactNode {
    return h('div', {
      key: pl.rowId,
      style: { display: 'flex', gap: 12, alignItems: 'baseline', padding: '4px 0 4px 26px', fontSize: 12, color: 'var(--nxai-card-sub)' },
    },
      h('span', { style: { minWidth: 90, color: 'var(--nxai-card-text)' } }, pl.kind),
      h('span', { style: { minWidth: 170 } }, pl.name),
      h('span', { style: { minWidth: 90 } }, KNOWLEDGE_LABELS[pl.knowledge]),
      h('span', {
        style: pl.checked.state === 'fail' ? { color: 'var(--nxai-danger-text)' } : undefined,
      }, checkedText(pl.checked, false)),
      pl.ceiling
        ? h('span', { style: { color: 'var(--nxai-card-sub)' } }, `⛔ ${pl.ceiling}`)
        : null,
    );
  }

  private renderProperty(p: PropertyView, outsideFilter: boolean): React.ReactNode {
    const multi = p.places.length > 1;
    const open = !!this.state.open[p.key];
    const flags: string[] = [];
    if (p.collision) flags.push('shares a name with a property of another origin — kept separate');
    if (p.nameSource === 'install') flags.push('unnamed in the WP Engine portal — showing install names');
    if (outsideFilter) flags.push('outside the current filter — shown because it matches your search');

    const headline = h('div', {
      style: { display: 'flex', gap: 12, alignItems: 'baseline', cursor: multi ? 'pointer' : 'default' },
      onClick: multi ? () => this.toggleOpen(p.key) : undefined,
    },
      h('span', { style: { width: 14, color: 'var(--nxai-card-sub)', fontSize: 11 } }, multi ? (open ? '▾' : '▸') : ''),
      h('span', { style: { fontWeight: 600, color: 'var(--nxai-card-text)' } }, p.name),
      h('span', { style: { fontSize: 12, color: 'var(--nxai-card-sub)' } },
        p.places.length === 1
          ? `${p.places[0].kind} · ${p.places[0].source === 'local' ? 'this Mac' : p.places[0].source === 'wpe' ? 'WP Engine' : 'your server'}`
          : `${p.places.length} places${p.hasCopy ? ' incl. your copy' : ''}`,
      ),
      h('span', { style: { fontSize: 12, color: 'var(--nxai-card-sub)' } },
        p.rungs.map((r) => KNOWLEDGE_LABELS[r]).join(' / ')),
      h('span', {
        style: {
          fontSize: 12,
          color: p.oldest.state === 'fail' ? 'var(--nxai-danger-text)' : 'var(--nxai-card-sub)',
        },
      }, checkedText(p.oldest, multi && p.oldest.state !== 'fail' && p.oldest.state !== 'never')),
      p.accountName ? h('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub)' } }, p.accountName) : null,
    );

    return h('div', {
      key: p.key,
      style: { padding: '8px 12px', borderBottom: '1px solid var(--nxai-card-border)' },
    },
      headline,
      flags.length
        ? h('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', paddingLeft: 26 } }, flags.join(' · '))
        : null,
      multi && open ? p.places.map((pl) => this.renderPlace(pl)) : null,
      !multi && p.places[0].ceiling
        ? h('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', paddingLeft: 26 } }, `⛔ ${p.places[0].ceiling}`)
        : null,
    );
  }

  render(): React.ReactNode {
    const { loaded, failed, collapse, onRetry } = this.props;
    if (failed) {
      return h('div', { style: { padding: 24, color: 'var(--nxai-card-text)' } },
        h('div', null, 'The fleet could not be read. This is a read failure, not an empty fleet.'),
        h('button', { onClick: onRetry, style: { marginTop: 8 } }, 'Retry'),
      );
    }
    if (!loaded || !collapse) {
      return h('div', { style: { padding: 24, color: 'var(--nxai-card-sub)' } }, 'Reading the fleet…');
    }

    const { header } = collapse;
    const { origin, state, query } = this.state;
    const q = query.trim().toLowerCase();

    const inView: Array<{ p: PropertyView; outside: boolean }> = [];
    for (const p of collapse.properties) {
      const matchesQ =
        !q || p.name.toLowerCase().includes(q) || p.places.some((pl) => pl.name.toLowerCase().includes(q));
      if (!matchesQ) continue;
      const inFilter = (origin === 'all' || p.origin === origin) && matchesState(p, state);
      // Search never hides a hit: filters hide only when not searching.
      if (!inFilter && !q) continue;
      inView.push({ p, outside: !inFilter });
    }

    const chip = (active: boolean): React.CSSProperties => ({
      padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
      border: '1px solid var(--nxai-card-border)',
      background: active ? 'var(--nxai-accent)' : 'var(--nxai-card-bg)',
      color: active ? 'var(--nxai-accent-text)' : 'var(--nxai-card-text)',
    });

    return h('div', null,
      // Header: every figure from the same derived header block.
      h('div', { style: { padding: '4px 12px 10px', color: 'var(--nxai-card-sub)', fontSize: 13 } },
        `${header.total} properties · ${header.placesTotal} places · ` +
        `${header.byOrigin.local} on this Mac only, ${header.byOrigin.wpe} WP Engine, ${header.byOrigin.external} external · ` +
        `${header.onThisMachine} live on this machine`,
      ),
      header.neverLookedInside > 0
        ? h('div', {
            style: { margin: '0 12px 10px', padding: '8px 12px', fontSize: 13, border: '1px solid var(--nxai-danger-text)', borderRadius: 6, color: 'var(--nxai-card-text)' },
          },
            h('strong', null, String(header.neverLookedInside)),
            ' places Nexus has never looked inside — the most actionable number on this screen. ',
            h('a', {
              style: { cursor: 'pointer', color: 'var(--nxai-accent)' },
              onClick: () => this.setState({ state: 'nothing', origin: 'all' }),
            }, 'Show them'),
          )
        : null,
      // Where (origin partition) + state chips + search.
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '0 12px 10px' } },
        ...ORIGIN_LABELS.map((o) =>
          h('span', {
            key: `o-${o.key}`, style: chip(origin === o.key),
            onClick: () => this.setState({ origin: o.key }),
          }, o.key === 'all' ? `${o.label} ${header.total}` : `${o.label} ${header.byOrigin[o.key as 'local' | 'wpe' | 'external']}`),
        ),
        h('span', { style: { width: 10 } }),
        ...STATE_LABELS.map((s) =>
          h('span', {
            key: `s-${s.key}`, style: chip(state === s.key),
            onClick: () => this.setState({ state: s.key }),
          }, s.label),
        ),
        h('input', {
          placeholder: 'Search every property — filters never hide a search hit',
          value: query,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ query: e.target.value }),
          style: {
            marginLeft: 'auto', minWidth: 220, fontSize: 12, padding: '5px 10px',
            border: '1px solid var(--nxai-card-border)', borderRadius: 6,
            background: 'var(--nxai-card-bg)', color: 'var(--nxai-card-text)',
          },
        }),
      ),
      h('div', { style: { border: '1px solid var(--nxai-card-border)', borderRadius: 8, margin: '0 12px' } },
        inView.length === 0
          ? h('div', { style: { padding: 16, color: 'var(--nxai-card-sub)', fontSize: 13 } },
              q
                ? 'Nothing matches. The search covered every property, so if it is not here, Nexus has no row for it.'
                : 'Nothing in this view.')
          : inView.map(({ p, outside }) => this.renderProperty(p, outside)),
      ),
      h('div', { style: { padding: '8px 12px', color: 'var(--nxai-card-sub)', fontSize: 12 } },
        `${inView.length} of ${header.total} properties shown · no pagination — the list is one scroll`),
    );
  }
}
