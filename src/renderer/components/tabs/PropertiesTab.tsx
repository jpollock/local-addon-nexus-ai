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
import { reasonBlame } from '../../../main/fleet/fleetCollapse';

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
  /** Drill-in: null = the fleet list. */
  view: null | { screen: 'property'; key: string } | { screen: 'place'; key: string; rowId: string };
}

const ORIGIN_LABELS: Array<{ key: OriginFilter; label: string }> = [
  { key: 'all', label: 'Everywhere' },
  { key: 'local', label: 'Your machine' },
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
  if (c.state === 'fail') {
    const detail = c.reason ?? 'no reason recorded';
    // A storage fault of OURS must not read as the site failing (finding 3).
    return reasonBlame(c.reason) === 'nexus'
      ? `record failed ${ageOf(c)} — a Nexus storage error, not the site: ${detail}`
      : `failed ${ageOf(c)} — ${detail}`;
  }
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
    this.state = { origin: 'all', state: 'all', query: '', open: {}, view: null };
  }

  /**
   * The place screen's procedures — named with what would run, barred ones
   * visible with the reason. READ-ONLY in this phase: doors are descriptions,
   * not buttons; no new execution path exists here.
   */
  private proceduresFor(p: PropertyView, pl: PlaceView): Array<{ label: string; rb: string | null; note: string; barred: boolean }> {
    if (pl.kind === 'copy' || pl.kind === 'local') {
      return [
        { label: 'Open in Local', rb: null, note: 'Your machine — Local’s own tools apply, ungated.', barred: false },
        { label: 'Index content here', rb: 'rb.local-index 1.0.0', note: 'Starts the site if it is stopped, indexes, stops it again.', barred: false },
      ];
    }
    if (pl.source === 'external') {
      return [
        { label: 'Refresh what Nexus knows', rb: 'rb.host-refresh 1.0.0', note: 'Reads over SSH. Never writes to your server.', barred: false },
        { label: 'Index content here', rb: 'rb.host-index 1.0.0', note: 'Read-only; raises this place to Searchable.', barred: false },
      ];
    }
    const procs: Array<{ label: string; rb: string | null; note: string; barred: boolean }> = [
      { label: 'Re-check this place', rb: 'rb.wpe-sync 1.0.0', note: 'Refreshes every fact on this screen with a new age.', barred: false },
    ];
    if (pl.ceiling) {
      procs.push({ label: 'Index content here', rb: 'rb.wpe-index 1.0.0', barred: true,
        note: `${pl.ceiling}. Not retryable from Nexus.` });
    } else {
      procs.push({ label: 'Index content here', rb: 'rb.wpe-index 1.0.0', note: 'Reads over SSH; raises this place to Searchable.', barred: false });
      procs.push({ label: 'Pull a copy from here', rb: 'rb.wpe-pull 1.0.0',
        note: 'Reads only. Your machine changes; this place does not — and the pull records the lineage link.', barred: false });
    }
    if (pl.kind === 'production') {
      procs.push({ label: 'Update plugins here', rb: 'rb.bulk-plugin-update 1.2.0', barred: true,
        note: 'Declared for staging and development. Production needs its own grant — Settings → WP Engine Access.' });
    }
    return procs;
  }

  private renderPropertyScreen(p: PropertyView): React.ReactNode {
    return h('div', { style: { padding: '0 12px' } },
      h('a', {
        style: { cursor: 'pointer', fontSize: 12, color: 'var(--nxai-accent)' },
        onClick: () => this.setState({ view: null }),
      }, '← All sites'),
      h('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--nxai-card-text)', margin: '8px 0 2px' } }, p.name),
      h('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 } },
        `${p.places.length} ${p.places.length === 1 ? 'place' : 'places'}${p.accountName ? ` · ${p.accountName}` : ''}`),
      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 } },
        // The agency rule: where a copy exists it anchors the screen — first,
        // accented — and the environments read as context around it.
        ...[...p.places].sort((a, b) => (a.kind === 'copy' ? -1 : 0) - (b.kind === 'copy' ? -1 : 0)).map((pl) =>
          h('div', {
            key: pl.rowId,
            onClick: () => this.setState({ view: { screen: 'place', key: p.key, rowId: pl.rowId } }),
            style: {
              cursor: 'pointer', minWidth: 200, padding: '10px 14px', borderRadius: 8,
              border: pl.kind === 'copy' ? '2px solid var(--nxai-accent)' : '1px solid var(--nxai-card-border)',
              background: 'var(--nxai-card-bg)',
            },
          },
            h('div', { style: { fontWeight: 600, fontSize: 13, color: 'var(--nxai-card-text)' } },
              pl.kind === 'copy' ? 'your copy' : pl.kind),
            h('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', margin: '2px 0 6px' } },
              pl.domain ?? pl.name),
            h('div', { style: { fontSize: 11, color: pl.checked.state === 'fail' ? 'var(--nxai-danger-text)' : 'var(--nxai-card-sub)' } },
              `${KNOWLEDGE_LABELS[pl.knowledge]} · ${checkedText(pl.checked, false)}`),
          ),
        ),
      ),
      h('div', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--nxai-card-sub)', textTransform: 'uppercase' as const, marginBottom: 6 } }, 'Lineage'),
      h('div', { style: { maxWidth: 560, fontSize: 13, color: 'var(--nxai-card-text)' } },
        ...p.lineage.map((line, i) => h('p', { key: i, style: { margin: '0 0 6px' } }, line)),
      ),
      h('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', marginTop: 12 } },
        'Activity is read per place — open one.'),
    );
  }

  private renderPlaceScreen(p: PropertyView, pl: PlaceView): React.ReactNode {
    const fact = (label: string, value: React.ReactNode) =>
      h('div', { key: label, style: { display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--nxai-card-border)', fontSize: 13 } },
        h('span', { style: { minWidth: 110, color: 'var(--nxai-card-sub)' } }, label),
        h('span', { style: { color: 'var(--nxai-card-text)' } }, value),
      );
    const absent = (why: string) => h('span', { style: { color: 'var(--nxai-card-sub)' } }, `— ${why}`);

    return h('div', { style: { padding: '0 12px', maxWidth: 1160 } },
      h('a', {
        style: { cursor: 'pointer', fontSize: 12, color: 'var(--nxai-accent)' },
        onClick: () => this.setState({ view: { screen: 'property', key: p.key } }),
      }, `← ${p.name}`),
      h('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--nxai-card-text)', margin: '8px 0 2px' } },
        `${p.name} — ${pl.kind}`),
      h('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 4 } }, pl.domain ?? pl.name),
      h('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 14 } },
        'Read at a distance, through gates. Nothing on this screen edits anything.'),

      h('div', { style: { display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-start' } },
        h('div', { style: { flex: '1 1 380px', maxWidth: 620 } },
      h('div', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--nxai-card-sub)', textTransform: 'uppercase' as const, margin: '10px 0 4px' } }, 'What Nexus knows'),
      fact('WordPress', pl.wpVersion ?? absent('not collected for this place')),
      fact('PHP', pl.phpVersion ?? absent('unknown — never a guessed version')),
      fact('Plugins', pl.pluginCount !== null ? `${pl.pluginCount} recorded` : absent(pl.ceiling ?? 'not collected for this place')),
      fact('Content', pl.docCount !== null ? `${pl.docCount} documents indexed` : absent(pl.ceiling ?? 'not indexed')),
      fact('Metadata checked', h('span', { style: pl.checkedL2.state === 'fail' ? { color: 'var(--nxai-danger-text)' } : undefined }, checkedText(pl.checkedL2, false))),
      fact('Content checked', h('span', { style: pl.checkedL3.state === 'fail' ? { color: 'var(--nxai-danger-text)' } : undefined }, checkedText(pl.checkedL3, false))),

      h('div', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--nxai-card-sub)', textTransform: 'uppercase' as const, margin: '16px 0 4px' } }, 'How deeply'),
      h('div', { style: { fontSize: 13, color: 'var(--nxai-card-text)' } },
        h('strong', null, KNOWLEDGE_LABELS[pl.knowledge]),
        pl.ceiling
          ? ` — and it cannot go deeper from here. ${pl.ceiling}. A property of the account, not a failure to retry.`
          : pl.knowledge === 'searchable'
            ? ' — Nexus has indexed the content here; it can answer about pages and posts, not just versions.'
            : pl.knowledge === 'nothing'
              ? ' — this place has never been scanned. One sync fills the table above.'
              : ' — versions and configuration, not content. Indexing raises this place to Searchable.',
      ),
        ),
        h('div', { style: { flex: '1 1 320px', maxWidth: 480 } },
      h('div', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--nxai-card-sub)', textTransform: 'uppercase' as const, margin: '16px 0 4px' } }, 'What can be done from here'),
      ...this.proceduresFor(p, pl).map((proc) =>
        h('div', {
          key: proc.label,
          style: {
            padding: '8px 12px', marginBottom: 6, borderRadius: 6, fontSize: 13,
            border: `1px ${proc.barred ? 'dashed' : 'solid'} var(--nxai-card-border)`,
            background: 'var(--nxai-card-bg)',
          },
        },
          h('div', { style: { fontWeight: 600, color: proc.barred ? 'var(--nxai-card-sub)' : 'var(--nxai-card-text)' } },
            proc.barred ? `${proc.label} — barred` : proc.label,
            proc.rb
              ? h('span', { style: { fontFamily: 'monospace', fontWeight: 400, fontSize: 11, color: 'var(--nxai-card-sub)', marginLeft: 8 } }, proc.rb)
              : null),
          h('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)' } }, proc.note),
        ),
      ),
        ),
      ),
    );
  }

  private toggleOpen = (key: string): void => {
    this.setState((s) => ({ open: { ...s.open, [key]: !s.open[key] } }));
  };

  private renderPlace(p: PropertyView, pl: PlaceView): React.ReactNode {
    return h('div', {
      key: pl.rowId,
      onClick: () => this.setState({ view: { screen: 'place', key: p.key, rowId: pl.rowId } }),
      style: { display: 'flex', gap: 12, alignItems: 'baseline', padding: '4px 0 4px 26px', fontSize: 12, color: 'var(--nxai-card-sub)', cursor: 'pointer' },
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
      style: { display: 'flex', gap: 12, alignItems: 'baseline' },
    },
      h('span', {
        style: { width: 14, color: 'var(--nxai-card-sub)', fontSize: 11, cursor: multi ? 'pointer' : 'default' },
        onClick: multi ? () => this.toggleOpen(p.key) : undefined,
      }, multi ? (open ? '▾' : '▸') : ''),
      // The name is the door: a multi-place property opens its screen; a
      // single-place row goes straight to its one place (the mock's rule).
      h('span', {
        style: { fontWeight: 600, color: 'var(--nxai-card-text)', cursor: 'pointer' },
        onClick: () =>
          this.setState({
            view: multi
              ? { screen: 'property', key: p.key }
              : { screen: 'place', key: p.key, rowId: p.places[0].rowId },
          }),
      }, p.name),
      h('span', { style: { fontSize: 12, color: 'var(--nxai-card-sub)' } },
        p.places.length === 1
          ? `${p.places[0].kind} · ${p.places[0].source === 'local' ? 'your machine' : p.places[0].source === 'wpe' ? 'WP Engine' : 'your server'}`
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
      multi && open ? p.places.map((pl) => this.renderPlace(p, pl)) : null,
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

    // Drill-ins: a stale key (fleet refreshed underneath) falls back to the
    // list rather than rendering a ghost.
    if (this.state.view) {
      const prop = collapse.properties.find((pp) => pp.key === (this.state.view as { key: string }).key);
      if (prop && this.state.view.screen === 'property') return this.renderPropertyScreen(prop);
      if (prop && this.state.view.screen === 'place') {
        const pl = prop.places.find((x) => x.rowId === (this.state.view as { rowId: string }).rowId);
        if (pl) return this.renderPlaceScreen(prop, pl);
      }
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
    // The order MEANS something and the footer states it (finding 7): rows
    // whose latest check failed first, then places never looked inside, then
    // A–Z — so the top of a 296-row list is the part that needs a person.
    const rank = (p: PropertyView): number =>
      p.oldest.state === 'fail' ? 0 : p.rungs.includes('nothing') ? 1 : 2;
    inView.sort((a, b) => rank(a.p) - rank(b.p) || a.p.name.localeCompare(b.p.name));

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
        `${header.byOrigin.local} only on your machine, ${header.byOrigin.wpe} WP Engine, ${header.byOrigin.external} external · ` +
        `${header.onThisMachine} live on this machine`,
      ),
      header.neverLookedInside > 0
        ? h('div', {
            style: { margin: '0 12px 10px', padding: '8px 12px', fontSize: 13, border: '1px solid var(--nxai-danger-text)', borderRadius: 6, color: 'var(--nxai-card-text)' },
          },
            h('strong', null, String(header.neverLookedInside)),
            ' places Nexus has never looked inside. ',
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
          placeholder: 'Search every property',
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
        `${inView.length} of ${header.total} properties shown · failures first, then never looked inside, then A–Z · one scroll, no pagination`),
    );
  }
}
