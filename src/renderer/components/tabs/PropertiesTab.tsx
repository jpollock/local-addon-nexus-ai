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
import { KNOWLEDGE_LABELS, STATE_SENTENCES } from '../../../main/fleet/knowledgeLadder';
import type { KnowledgeRung } from '../../../main/fleet/knowledgeLadder';
import type { FleetCollapse, PropertyView, PlaceView, CheckedView } from '../../../main/fleet/fleetCollapse';
import { reasonBlame } from '../../../main/fleet/fleetCollapse';
import type { BulkJobView } from './SitesTab';

const h = React.createElement;

/**
 * Sheet 19: every interpreted filter renders as a READABLE CLAUSE — the
 * operator lives inside the value (`Not updated in: more than 30 days`),
 * because a bare `30 days` hides whether it means more or less. One chip per
 * removable clause; removing it deletes exactly that key (or that value from
 * its array).
 */
interface FilterChip { key: string; value?: string; label: string }

export function filtersToChips(filters: Record<string, unknown>): FilterChip[] {
  const chips: FilterChip[] = [];
  const push = (key: string, label: string, value?: string) => chips.push({ key, value, label });
  const f = filters as Record<string, any>;
  for (const v of f.plugins ?? []) push('plugins', `Plugins: ${v}`, v);
  for (const v of f.themes ?? []) push('themes', `Themes: ${v}`, v);
  for (const v of f.phpVersions ?? []) push('phpVersions', `PHP: ${v}`, v);
  for (const v of f.wpVersions ?? []) push('wpVersions', `WordPress: ${v}`, v);
  if (f.contentQuery) push('contentQuery', `Content: "${f.contentQuery}"`);
  if (f.searchText) push('searchText', `Name or domain: "${f.searchText}"`);
  if (f.minPluginCount != null) push('minPluginCount', `Plugins: at least ${f.minPluginCount}`);
  if (f.maxPluginCount != null) push('maxPluginCount', `Plugins: at most ${f.maxPluginCount}`);
  if (f.minPostCount != null) push('minPostCount', `Posts: at least ${f.minPostCount}`);
  if (f.maxPostCount != null) push('maxPostCount', `Posts: at most ${f.maxPostCount}`);
  if (f.minUserCount != null) push('minUserCount', `Users: at least ${f.minUserCount}`);
  if (f.maxUserCount != null) push('maxUserCount', `Users: at most ${f.maxUserCount}`);
  if (f.minAdminCount != null) push('minAdminCount', `Admins: at least ${f.minAdminCount}`);
  if (f.stalePostDays != null) push('stalePostDays', `Not updated in: more than ${f.stalePostDays} days`);
  if (f.recentPostDays != null) push('recentPostDays', `Updated in: the last ${f.recentPostDays} days`);
  if (f.phpEolOnly) push('phpEolOnly', 'PHP: end of life');
  if (f.wpVersionOlderThan) push('wpVersionOlderThan', `WordPress: older than ${f.wpVersionOlderThan}`);
  if (f.pluginVersion) push('pluginVersion', `${f.pluginVersion.slug}: older than ${f.pluginVersion.olderThan}`);
  if (f.commentsDisabled != null) push('commentsDisabled', `Comments: ${f.commentsDisabled ? 'disabled' : 'enabled'}`);
  if (f.hiddenFromSearch != null) push('hiddenFromSearch', `Search engines: ${f.hiddenFromSearch ? 'discouraged' : 'allowed'}`);
  if (f.selfRegistrationOpen != null) push('selfRegistrationOpen', `Registration: ${f.selfRegistrationOpen ? 'open' : 'closed'}`);
  if (f.staticFrontPage != null) push('staticFrontPage', `Front page: ${f.staticFrontPage ? 'static' : 'blog roll'}`);
  if (f.plainPermalinks != null) push('plainPermalinks', `Permalinks: ${f.plainPermalinks ? 'plain' : 'pretty'}`);
  if (f.wpeEnvironment) push('wpeEnvironment', `Environment: ${f.wpeEnvironment}`);
  return chips;
}

/** Remove one chip's clause from the filter set. Arrays lose one value; scalars go. */
export function removeChipFromFilters(
  filters: Record<string, unknown>,
  chip: FilterChip,
): Record<string, unknown> {
  const next: Record<string, any> = { ...filters };
  if (chip.value !== undefined && Array.isArray(next[chip.key])) {
    const arr = (next[chip.key] as string[]).filter((v) => v !== chip.value);
    if (arr.length) next[chip.key] = arr; else delete next[chip.key];
  } else {
    delete next[chip.key];
  }
  return next;
}

/** One selectable value on an axis, and what picking it does. */
interface AxisValue { label: string; picked: boolean; apply: () => void }
/**
 * One tab in the Add-a-filter panel. `facet` = enumerable from the fleet;
 * `fixed` = a closed set the product defines. Exactly one of the two.
 */
interface AxisDef {
  key: string;
  label: string;
  facet?: 'plugins' | 'themes' | 'phpVersions' | 'wpVersions';
  fixed?: AxisValue[];
}

type OriginFilter = 'all' | 'local' | 'wpe' | 'external';
type StateFilter = 'all' | 'nothing' | 'on-machine' | 'attention' | 'ceiling';

interface PropertiesTabProps {
  /** False until the first GET_FLEET_COLLAPSE response has landed. */
  loaded: boolean;
  /** The read failed — distinct from an empty fleet; never conflate them. */
  failed: boolean;
  collapse: FleetCollapse | null;
  onRetry: () => void;
  /** Door to adding a site (external host wizard in Settings). Optional. */
  onAddSite?: () => void;
  /** Sheet 18: dispatch the armed scope to the audited bulk path. */
  onBulkIndex?: (ids: string[], names: Record<string, string>, autoStart: boolean) => void;
  /** The running/finished bulk job, shared with the rest of the dashboard. */
  job?: BulkJobView | null;
  onCancelJob?: () => void;
  onDismissJob?: () => void;
  /** Door into the Now panel for the unattributed remainder. */
  onOpenNow?: () => void;
  /** Sheet 19: interpret a typed description (SITE_FINDER_AI_PARSE). */
  onInterpret?: (text: string) => Promise<
    | { kind: 'filters'; filters: Record<string, unknown> }
    | { kind: 'clarify'; question: string; facet: string | null }
    | { kind: 'error'; message: string }
  >;
  /** Sheet 19: resolve a filter set to matching site ids (SITE_FINDER_APPLY). */
  onResolveFilterIds?: (filters: Record<string, unknown>) => Promise<string[] | null>;
  /** The enumerable axes with counts (SITE_FINDER_GET_OPTIONS). */
  filterOptions?: {
    plugins: string[]; pluginCounts?: Record<string, number>;
    wpVersions: string[]; wpVersionCounts?: Record<string, number>;
    phpVersions: string[];
    themes: string[]; themeCounts?: Record<string, number>;
  } | null;
  /** The no-dead-end door: hand the unresolved text to the composer. */
  onOpenComposer?: (text: string) => void;
}

interface PropertiesTabState {
  origin: OriginFilter;
  state: StateFilter;
  query: string;
  /** Property keys the user has expanded. */
  open: Record<string, boolean>;
  /** Drill-in: null = the fleet list. */
  view: null | { screen: 'property'; key: string } | { screen: 'place'; key: string; rowId: string };
  sortBy: SortBy;
  /** Sheet 18: the filter-as-selector is ARMED — checkboxes appear, scope recomputes live. */
  armed: boolean;
  armedAt: number | null;
  /** Refinement: place rowIds the user removed from the armed scope. */
  removed: Record<string, boolean>;
  /** The decline door: read stopped sites are skipped instead of started. */
  declineStart: boolean;
  /** Sheet 19: the interpreted filter set, its chips, and the resolved id set. */
  interp: { filters: Record<string, unknown>; ids: string[] | null } | null;
  interpreting: boolean;
  /** Board F: the interpreter's question, with the facet whose menu opens beneath it. */
  clarify: { question: string; facet: string | null; forText: string } | null;
  /** The Add-a-filter menu: which axis's values are open, if any. */
  menuAxis: string | null;
  menuOpen: boolean;
  /** Round-9: an axis with more than five values searches within itself. */
  menuFilter: string;
  /**
   * Round-9: Depth is an axis the panel offers, and the `nothing` rung already
   * has a control (the state segment) — so this holds the OTHER three only,
   * and the two are kept mutually exclusive wherever either is set.
   */
  rung: KnowledgeRung | null;
}

const ORIGIN_LABELS: Array<{ key: OriginFilter; label: string }> = [
  { key: 'all', label: 'Everywhere' },
  { key: 'local', label: 'Your machine' },
  { key: 'wpe', label: 'WP Engine' },
  { key: 'external', label: 'External' },
];

const STATE_LABELS: Array<{ key: StateFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs you' },
  { key: 'nothing', label: STATE_SENTENCES.neverLookedInside },
  { key: 'on-machine', label: 'On your machine' },
  { key: 'ceiling', label: 'At its ceiling' },
];

type SortBy = 'consequence' | 'name' | 'checked';
const SORT_LABELS: Record<SortBy, string> = {
  consequence: 'failures · never looked inside · A–Z',
  name: 'A–Z',
  checked: 'oldest check first',
};

/**
 * ONE column geometry — head row, group rows and place rows all use exactly
 * this, with no per-row horizontal padding (round-6 break 3: an extra 12px
 * inside the wrapper shifted every child track). Place rows indent inside
 * the Site cell only. Widths are the sheet's: Site 300 / Where 290 /
 * Knows 160 / Checked flex.
 */
const GRID = '22px 300px 290px 160px minmax(150px, 1fr) 110px';
const gridRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'flex-start' };
const ellipsis: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, color: 'var(--nxai-card-sub)' };

/** Phase 3: count + tier dot. A backed zero is a quiet dash; null renders nothing. */
function needsYouCell(v: { count: number; tier: number } | null | undefined): React.ReactNode {
  if (v == null) return h('span', null, '');
  if (v.count === 0) return h('span', { style: { color: 'var(--nxai-card-sub)' } }, '—');
  return h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--nxai-card-text)' } },
    h('span', {
      style: {
        display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6,
        background: v.tier >= 3 ? 'var(--nxai-danger-text)' : 'var(--nxai-warn)',
      },
    }),
    String(v.count));
}

/**
 * The failure detail, WITHOUT the short form the Checked cell already
 * carries (round-6 break 2): only the blame clause and the transport's own
 * words live here.
 */
function failDetail(c: CheckedView): string {
  const detail = c.reason ?? 'no reason recorded';
  return reasonBlame(c.reason) === 'nexus'
    ? `a Nexus storage error, not the site: ${detail}`
    : detail;
}


function ageOf(c: CheckedView): string {
  if (c.state === 'never' || !c.finishedAt) return 'not yet checked';
  const hrs = (Date.now() - Date.parse(c.finishedAt)) / 3600_000;
  const a = !Number.isFinite(hrs) ? '?' : hrs < 1 ? `${Math.max(0, Math.round(hrs * 60))}m ago` : hrs < 48 ? `${Math.round(hrs)}h ago` : `${Math.round(hrs / 24)}d ago`;
  return a;
}

function checkedText(c: CheckedView, labelOldest: boolean, short = false): string {
  if (c.state === 'fail') {
    const detail = c.reason ?? 'no reason recorded';
    // A storage fault of OURS must not read as the site failing (finding 3).
    if (short) return reasonBlame(c.reason) === 'nexus' ? `record failed ${ageOf(c)}` : `failed ${ageOf(c)}`;
    return reasonBlame(c.reason) === 'nexus'
      ? `record failed ${ageOf(c)} — a Nexus storage error, not the site: ${detail}`
      : `failed ${ageOf(c)} — ${detail}`;
  }
  if (c.state === 'never' || !c.finishedAt) return 'not yet checked';
  const prefix = labelOldest ? 'oldest ' : '';
  return `${prefix}${ageOf(c)}`;
}

function matchesState(p: PropertyView, state: StateFilter): boolean {
  if (state === 'ceiling') return p.places.some((pl) => pl.ceiling !== null);
  if (state === 'nothing') return p.rungs.includes('nothing');
  if (state === 'on-machine') return p.hasCopy || p.origin === 'local';
  if (state === 'attention')
    return p.oldest.state === 'fail' || p.collision || p.rungs.includes('nothing') || p.places.some((pl) => pl.ceiling !== null);
  return true;
}

export class PropertiesTab extends React.Component<PropertiesTabProps, PropertiesTabState> {
  constructor(props: PropertiesTabProps) {
    super(props);
    this.state = { origin: 'all', state: 'all', query: '', open: {}, view: null, sortBy: 'consequence', armed: false, armedAt: null, removed: {}, declineStart: false, interp: null, interpreting: false, clarify: null, menuAxis: null, menuOpen: false, menuFilter: '', rung: null };
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
    const copies = p.places.filter((pl) => pl.kind === 'copy');
    const copy = copies[0];
    const environments = p.places.filter((pl) => pl.kind !== 'copy');
    const sectionHead = (label: string): React.ReactNode =>
      h('div', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--nxai-card-sub)', textTransform: 'uppercase' as const, margin: '14px 0 6px' } }, label);
    const envRow = (pl: PlaceView): React.ReactNode =>
      h('div', {
        key: pl.rowId,
        onClick: () => this.setState({ view: { screen: 'place', key: p.key, rowId: pl.rowId } }),
        style: { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--nxai-card-border)', cursor: 'pointer', fontSize: 13 },
      },
        h('span', { style: { minWidth: 110, color: 'var(--nxai-card-text)', fontWeight: 600 } }, pl.kind),
        h('span', { style: { ...mono, minWidth: 200 } }, pl.address ?? ''),
        h('span', { style: { fontSize: 12, color: 'var(--nxai-card-sub)' } }, KNOWLEDGE_LABELS[pl.knowledge]),
        h('span', { style: { fontSize: 12, color: pl.checked.state === 'fail' ? 'var(--nxai-danger-text)' : 'var(--nxai-card-sub)' } },
          checkedText(pl.checked, false)),
      );

    return h('div', { style: { padding: '0 12px', maxWidth: 720 } },
      h('a', {
        style: { cursor: 'pointer', fontSize: 12, color: 'var(--nxai-accent)' },
        onClick: () => this.setState({ view: null }),
      }, '← All sites'),
      h('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--nxai-card-text)', margin: '8px 0 2px' } }, p.name),
      h('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', marginBottom: 12 } },
        `${p.places.length} ${p.places.length === 1 ? 'place' : 'places'}${p.accountName ? ` · ${p.accountName}` : ''}`),

      // The agency rule: a copy anchors — ONE CARD PER COPY, each carrying
      // its own lineage legs. Two copies were pooling their sentences into
      // one card while the second vanished as a place (the sentinel-sandbox
      // screenshot defect).
      ...copies.map((c) =>
        h('div', {
          key: c.rowId,
          onClick: () => this.setState({ view: { screen: 'place', key: p.key, rowId: c.rowId } }),
          style: {
            cursor: 'pointer', padding: '12px 16px', borderRadius: 8, marginBottom: 8,
            border: '2px solid var(--nxai-accent)', background: 'var(--nxai-card-bg)',
          },
        },
          h('div', { style: { fontWeight: 700, fontSize: 14, color: 'var(--nxai-card-text)' } },
            'your copy',
            h('span', { style: { fontWeight: 400, color: 'var(--nxai-card-sub)', marginLeft: 8 } }, c.name)),
          c.address ? h('div', { style: { ...mono, margin: '2px 0 8px' } }, c.address) : null,
          h('div', { style: { marginBottom: 8, fontSize: 12, color: 'var(--nxai-card-sub)' } },
            `${KNOWLEDGE_LABELS[c.knowledge]} · ${checkedText(c.checked, false)}`),
          ...(c.lineage ?? []).map((line, i) =>
            h('p', { key: i, style: { margin: '0 0 4px', fontSize: 13, color: 'var(--nxai-card-text)' } }, line)),
        ),
      ),

      copy ? sectionHead('Environments') : null,
      copy ? h('div', null, ...environments.map(envRow)) : null,

      // No copy: the places as peer cards, and the lineage block (stated
      // absence is the common case) beneath them.
      !copy
        ? h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 } },
            ...environments.map((pl) =>
              h('div', {
                key: pl.rowId,
                onClick: () => this.setState({ view: { screen: 'place', key: p.key, rowId: pl.rowId } }),
                style: {
                  cursor: 'pointer', minWidth: 200, padding: '10px 14px', borderRadius: 8,
                  border: '1px solid var(--nxai-card-border)', background: 'var(--nxai-card-bg)',
                },
              },
                h('div', { style: { fontWeight: 600, fontSize: 13, color: 'var(--nxai-card-text)' } }, pl.kind),
                h('div', { style: { ...mono, margin: '2px 0 6px' } }, pl.address ?? pl.name),
                h('div', { style: { fontSize: 11, color: pl.checked.state === 'fail' ? 'var(--nxai-danger-text)' : 'var(--nxai-card-sub)' } },
                  `${KNOWLEDGE_LABELS[pl.knowledge]} · ${checkedText(pl.checked, false)}`),
              ),
            ),
          )
        : null,
      sectionHead('Lineage'),
      h('div', { style: { maxWidth: 560, fontSize: 13, color: 'var(--nxai-card-text)' } },
        ...p.lineage.map((line, i) => h('p', { key: i, style: { margin: '0 0 6px' } }, line))),

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

  /** Sheet 19: Enter interprets; the query becomes controls or a question. */
  private submitQuery = async (): Promise<void> => {
    const text = this.state.query.trim();
    if (!text || !this.props.onInterpret) return;
    this.setState({ interpreting: true, clarify: null });
    const result = await this.props.onInterpret(text).catch(
      (e): { kind: 'error'; message: string } => ({ kind: 'error', message: String(e) }),
    );
    if (result.kind === 'clarify') {
      // Board F: the question, with the named facet's menu open beneath it.
      this.setState({ interpreting: false, clarify: { question: result.question, facet: result.facet, forText: text }, menuOpen: false });
      return;
    }
    if (result.kind === 'error') {
      this.setState({ interpreting: false, clarify: { question: result.message, facet: null, forText: text } });
      return;
    }
    await this.applyFilters(result.filters, { clearQuery: true });
  };

  /**
   * One control per axis: `source` presses the origin segment and never mints
   * a chip beside it. Everything else becomes chips + a resolved id set.
   */
  private applyFilters = async (
    rawFilters: Record<string, unknown>,
    opts: { clearQuery?: boolean } = {},
  ): Promise<void> => {
    const filters: Record<string, any> = { ...rawFilters };
    if (filters.source === 'local' || filters.source === 'wpe') {
      this.setState({ origin: filters.source as OriginFilter });
      delete filters.source;
    }
    if (Object.keys(filters).length === 0) {
      if (opts.clearQuery) this.setState({ interpreting: false, interp: null, query: '' });
      else this.setState({ interpreting: false, interp: null });
      return;
    }
    const ids = this.props.onResolveFilterIds
      ? await this.props.onResolveFilterIds(filters).catch(() => null)
      : null;
    const next = {
      interpreting: false as const,
      interp: { filters, ids },
      clarify: null,
      menuOpen: false,
      menuAxis: null as PropertiesTabState['menuAxis'],
    };
    if (opts.clearQuery) this.setState({ ...next, query: '' });
    else this.setState(next);
  };

  private removeChip = (chip: { key: string; value?: string; label: string }): void => {
    if (!this.state.interp) return;
    const next = removeChipFromFilters(this.state.interp.filters, chip);
    if (Object.keys(next).length === 0) {
      this.setState({ interp: null });
    } else {
      void this.applyFilters(next);
    }
  };

  /** The clarification's pick, and the Add-a-filter menu's pick: one path. */
  private pickFacetValue = (axis: 'plugins' | 'themes' | 'phpVersions' | 'wpVersions', value: string): void => {
    const cur = (this.state.interp?.filters ?? {}) as Record<string, any>;
    const arr = new Set<string>([...(cur[axis] ?? []), value]);
    void this.applyFilters({ ...cur, [axis]: [...arr] });
  };

  private scopeCheckbox(placeIds: string[], stop = true): React.ReactNode {
    const inScope = placeIds.filter((id) => !this.state.removed[id]);
    const mixed = inScope.length > 0 && inScope.length < placeIds.length;
    return h('input', {
      type: 'checkbox',
      checked: inScope.length === placeIds.length,
      ref: (el: HTMLInputElement | null) => { if (el) el.indeterminate = mixed; },
      onClick: (e: React.MouseEvent) => { if (stop) e.stopPropagation(); },
      onChange: () => {
        const removed = { ...this.state.removed };
        const allIn = inScope.length === placeIds.length;
        for (const id of placeIds) removed[id] = allIn; // all in → remove all; else restore all
        this.setState({ removed });
      },
      style: { marginRight: 6 },
    });
  }

  /**
   * Sheet 18, boards A–D in one region under the toolbar: the offer, the
   * armed declaration with its transport-shaped groups, the running job, and
   * the finished verdict — every count from ONE derivation over the scope.
   */
  private renderBulkBar(
    inView: Array<{ p: PropertyView }>,
    fromLabel: string,
  ): React.ReactNode {
    const { job } = this.props;
    const notice: React.CSSProperties = {
      margin: '0 12px 10px', padding: '10px 14px', fontSize: 13, borderRadius: 6,
      border: '1px solid var(--nxai-card-border)', background: 'var(--nxai-section-bg)',
      color: 'var(--nxai-card-text)',
    };
    const btn = (primary: boolean): React.CSSProperties => ({
      padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
      border: `1px solid ${primary ? 'var(--nxai-action)' : 'var(--nxai-card-border)'}`,
      background: primary ? 'var(--nxai-action)' : 'var(--nxai-card-bg)',
      color: primary ? 'var(--nxai-action-text)' : 'var(--nxai-card-text)',
      marginRight: 8,
    });

    // Board C / D: the job owns the region while it exists.
    if (job) {
      if (job.phase === 'starting' || job.phase === 'running') {
        return h('div', { style: notice },
          h('strong', null, 'Indexing'),
          ` — ${job.completed} of ${job.total} places · ${job.failed} failed so far. `,
          this.props.onCancelJob
            ? h('span', { style: btn(false), onClick: this.props.onCancelJob }, 'Stop')
            : null,
        );
      }
      // Finished (done or error): the verdict is derived from the outcomes it sits above.
      return h('div', { style: notice },
        h('strong', null, job.phase === 'error' ? 'Indexing could not start' : 'Indexing finished'),
        job.phase === 'error'
          ? ` — ${job.error ?? 'no reason recorded'}. `
          : ` — read ${job.total - job.failed} of ${job.total} places · ${job.failed} failed. `,
        this.props.onDismissJob
          ? h('span', { style: btn(false), onClick: this.props.onDismissJob }, 'Dismiss')
          : null,
      );
    }

    if (!this.props.onBulkIndex || inView.length === 0) return null;

    // Round-9: the offer belongs to a NARROWED view. On the unfiltered list
    // "Read them" would mean the whole fleet, which is not a scope anyone
    // chose — the filter is the selector, so with no filter there is no
    // selection. Once armed it stays up, so clearing a filter mid-decision
    // does not yank the declaration out from under the user.
    const isNarrowed =
      this.state.origin !== 'all' ||
      this.state.state !== 'all' ||
      this.state.rung !== null ||
      this.state.interp !== null ||
      this.state.query.trim() !== '';
    if (!isNarrowed && !this.state.armed) return null;

    // ONE derivation for every figure below (the no-count-stated-twice rule).
    const allPlaces = inView.flatMap(({ p }) => p.places.map((pl) => ({ p, pl })));
    const scope = allPlaces.filter(({ pl }) => !this.state.removed[pl.rowId]);
    const removedCount = allPlaces.length - scope.length;
    const apiOnly = scope.filter(({ pl }) => pl.ceiling !== null);
    const stopped = scope.filter(({ pl }) => pl.source === 'local' && pl.status !== null && pl.status !== 'running');
    const full = scope.length - apiOnly.length - stopped.length;
    const mins = Math.max(1, Math.ceil((scope.length * 25) / 3 / 60));

    // Board A: the offer — both units, from the view that produced the set.
    if (!this.state.armed) {
      return h('div', { style: { ...notice, display: 'flex', alignItems: 'center', gap: 10 } },
        h('span', null,
          `Index what Nexus knows — ${allPlaces.length} place${allPlaces.length === 1 ? '' : 's'} ` +
          `(${inView.length} propert${inView.length === 1 ? 'y' : 'ies'}) from ${fromLabel}.`),
        h('span', {
          style: { ...btn(true), marginLeft: 'auto', marginRight: 0 },
          onClick: () => this.setState({ armed: true, armedAt: Date.now(), removed: {}, declineStart: false }),
        }, 'Read them'),
      );
    }

    // Board B: armed — the declaration, its groups, and the stop.
    const when = this.state.armedAt
      ? new Date(this.state.armedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const line = (text: string): React.ReactNode =>
      h('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', margin: '2px 0' } }, text);
    return h('div', { style: notice },
      h('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Index — a read, not a write'),
      line(`from ${fromLabel}, ${when}` + (removedCount > 0 ? ` — minus ${removedCount} you removed` : '')),
      line(`${full} place${full === 1 ? '' : 's'} read fully over SSH`),
      apiOnly.length > 0
        ? line(`${apiOnly.length} stop at the API facts — their account has no SSH gateway`)
        : null,
      stopped.length > 0
        ? h('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub)', margin: '2px 0' } },
            this.state.declineStart
              ? `${stopped.length} stopped site${stopped.length === 1 ? '' : 's'} will be skipped — you declined the start. `
              : `${stopped.length} stopped site${stopped.length === 1 ? '' : 's'} will be STARTED to read them, then stopped again. `,
            h('a', {
              style: { cursor: 'pointer', color: 'var(--nxai-accent)' },
              onClick: () => this.setState({ declineStart: !this.state.declineStart }),
            }, this.state.declineStart ? 'Start them after all' : 'Don’t start them'))
        : null,
      h('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', margin: '6px 0' } },
        'Steps: read API facts → read SSH facts → index content. No approval, no backup — nothing here writes to a site.'),
      line(`${scope.length} places · about ${mins} min at three at a time · you can stop it while it runs`),
      h('div', { style: { marginTop: 8 } },
        h('span', {
          style: btn(true),
          onClick: () => {
            const ids = scope.map(({ pl }) => pl.rowId);
            const names: Record<string, string> = {};
            for (const { pl } of scope) names[pl.rowId] = pl.name;
            this.props.onBulkIndex!(ids, names, !this.state.declineStart); // dispatched as the combined 'index' op
            this.setState({ armed: false, removed: {} });
          },
        }, 'Start indexing'),
        h('span', { style: btn(false), onClick: () => this.setState({ armed: false, removed: {} }) }, 'Cancel'),
      ),
    );
  }

  /** A small self-contained X — the design system's Close shape, no emoji. */
  private closeGlyph(onClick: () => void): React.ReactNode {
    return h('svg', {
      width: 11, height: 11, viewBox: '0 0 11 11', onClick,
      style: { cursor: 'pointer', marginLeft: 6, flexShrink: 0 },
    },
      h('line', { x1: 2, y1: 2, x2: 9, y2: 9, stroke: 'var(--nxai-card-sub)', strokeWidth: 1.5 }),
      h('line', { x1: 9, y1: 2, x2: 2, y2: 9, stroke: 'var(--nxai-card-sub)', strokeWidth: 1.5 }),
    );
  }

  /**
   * Round-9: the panel offers every axis this view can actually filter on —
   * thirteen, not four.
   *
   * Four are ENUMERABLE: their values are whatever the fleet happens to hold,
   * so they come from `filterOptions` and carry counts where counts exist. The
   * rest are FIXED: their values are a closed set the product defines, so they
   * are written here rather than derived from data (a boolean axis whose value
   * list came from the fleet would silently lose `false` the day nothing in the
   * fleet was false).
   *
   * `source` and `depth` APPLY THROUGH THE CONTROLS THAT ALREADY OWN THEM —
   * the origin segment and the state segment / rung — instead of minting a
   * second chip beside them. That is the same one-control-per-axis rule
   * `applyFilters` follows for `source` when the interpreter returns it.
   */
  private axes(): AxisDef[] {
    const f = (this.state.interp?.filters ?? {}) as Record<string, any>;
    const bool = (key: string, yes: string, no: string): AxisValue[] => [
      { label: yes, picked: f[key] === true, apply: () => void this.applyFilters({ ...f, [key]: true }) },
      { label: no, picked: f[key] === false, apply: () => void this.applyFilters({ ...f, [key]: false }) },
    ];
    const RUNGS: KnowledgeRung[] = ['nothing', 'basic', 'detailed', 'searchable'];
    return [
      { key: 'plugins', label: 'Plugins', facet: 'plugins' },
      { key: 'themes', label: 'Themes', facet: 'themes' },
      { key: 'phpVersions', label: 'PHP', facet: 'phpVersions' },
      { key: 'wpVersions', label: 'WordPress', facet: 'wpVersions' },
      {
        key: 'depth', label: 'Depth',
        fixed: RUNGS.map((r) => ({
          label: KNOWLEDGE_LABELS[r],
          picked: r === 'nothing' ? this.state.state === 'nothing' : this.state.rung === r,
          // `nothing` already has a segment; the other three get the rung.
          // Setting either clears the other, so exactly one is ever lit.
          apply: () => (r === 'nothing'
            ? this.setState({ state: 'nothing', rung: null, menuOpen: false })
            : this.setState({ rung: r, state: this.state.state === 'nothing' ? 'all' : this.state.state, menuOpen: false })),
        })),
      },
      {
        key: 'source', label: 'Where it lives',
        fixed: ORIGIN_LABELS.filter((o) => o.key !== 'all').map((o) => ({
          label: o.label,
          picked: this.state.origin === o.key,
          apply: () => this.setState({ origin: o.key, menuOpen: false }),
        })),
      },
      {
        key: 'wpeEnvironment', label: 'Environment',
        fixed: ['production', 'staging', 'development'].map((v) => ({
          label: v,
          picked: f.wpeEnvironment === v,
          apply: () => void this.applyFilters({ ...f, wpeEnvironment: v }),
        })),
      },
      {
        key: 'phpEolOnly', label: 'PHP end of life',
        // One value, not two: "not past end of life" is not a thing anyone
        // asks for, and the interpreter has no filter for it.
        fixed: [{
          label: 'Past end of life',
          picked: f.phpEolOnly === true,
          apply: () => void this.applyFilters({ ...f, phpEolOnly: true }),
        }],
      },
      { key: 'commentsDisabled', label: 'Comments', fixed: bool('commentsDisabled', 'Disabled', 'Enabled') },
      { key: 'hiddenFromSearch', label: 'Search engines', fixed: bool('hiddenFromSearch', 'Discouraged', 'Allowed') },
      { key: 'selfRegistrationOpen', label: 'Registration', fixed: bool('selfRegistrationOpen', 'Open', 'Closed') },
      { key: 'staticFrontPage', label: 'Front page', fixed: bool('staticFrontPage', 'Static page', 'Blog roll') },
      { key: 'plainPermalinks', label: 'Permalinks', fixed: bool('plainPermalinks', 'Plain', 'Pretty') },
    ];
  }

  /** The values behind one axis tab, whichever kind it is. */
  private axisValues(a: AxisDef): Array<AxisValue & { count: number | null }> {
    if (!a.facet) return (a.fixed ?? []).map((v) => ({ ...v, count: null }));
    const picked = ((this.state.interp?.filters as any)?.[a.facet] ?? []) as string[];
    return this.facetValues(a.facet).map((v) => ({
      label: v.value,
      count: v.count,
      picked: picked.indexOf(v.value) !== -1,
      apply: () => this.pickFacetValue(a.facet!, v.value),
    }));
  }

  /**
   * Round-9: opening the panel must land on VALUES, not on the sentence
   * saying what the panel cannot do. Default to the first axis that has any.
   */
  private openMenu = (): void => {
    const first = this.axes().find((a) => this.axisValues(a).length > 0);
    this.setState({ menuOpen: true, menuAxis: first ? first.key : null, menuFilter: '' });
  };

  private facetValues(axis: 'plugins' | 'themes' | 'phpVersions' | 'wpVersions'): Array<{ value: string; count: number | null }> {
    const o = this.props.filterOptions;
    if (!o) return [];
    const counts: Record<string, number> | undefined =
      axis === 'plugins' ? o.pluginCounts
        : axis === 'wpVersions' ? o.wpVersionCounts
        : axis === 'themes' ? o.themeCounts
        : undefined;
    const vals = (o[axis] ?? []).map((v) => ({ value: v, count: counts?.[v] ?? null }));
    // Round-9: where a count exists it IS the order. Version order put twelve
    // one-property versions above `7.0.4 269` — a list sorted by a key nobody
    // is choosing on, which hides its own answer in the tail. An axis with no
    // counts keeps the order it was given; there is nothing to rank it by.
    if (!counts) return vals;
    return vals.slice().sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.value.localeCompare(b.value));
  }

  /**
   * Sheet 19, boards B–F in one region: interpreted chips (removable
   * clauses), the clarification (the question with the named facet's menu
   * open beneath it — no new mechanism), the Add-a-filter menu, and the
   * searched composition with its stated zeros. Renders nothing when none
   * of it applies.
   */
  private renderInterpretation(inView: Array<{ p: PropertyView }>): React.ReactNode {
    const { interp, clarify, menuOpen, menuAxis, interpreting } = this.state;
    const chipStyle: React.CSSProperties = {
      display: 'inline-flex', alignItems: 'center', padding: '3px 8px 3px 10px',
      borderRadius: 6, fontSize: 12, border: '1px solid var(--nxai-card-border)',
      background: 'var(--nxai-card-bg)', color: 'var(--nxai-card-text)', marginRight: 6,
    };
    const AXES = this.axes();
    const CAP = 40;
    const sub: React.CSSProperties = { fontSize: 11, color: 'var(--nxai-card-sub)' };

    /**
     * One axis's values. Round-9: the panel STATES ITS TOTAL (a chip cloud
     * with no total does not say whether you are looking at all of it), and
     * above five values it SEARCHES WITHIN ITSELF rather than making the
     * reader scan 812 plugins. The cap is stated, never silent.
     */
    const valuePanel = (a: AxisDef): React.ReactNode => {
      const all = this.axisValues(a);
      const needle = this.state.menuFilter.trim().toLowerCase();
      const shown = needle ? all.filter((v) => v.label.toLowerCase().includes(needle)) : all;
      const capped = shown.slice(0, CAP);
      return h('div', { key: `panel-${a.key}` },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, ...sub } },
          h('span', null, `${a.label} · ${all.length} value${all.length === 1 ? '' : 's'}`),
          all.length > 5
            ? h('input', {
                value: this.state.menuFilter,
                placeholder: `Search ${a.label.toLowerCase()}`,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ menuFilter: e.target.value }),
                style: {
                  fontSize: 11, padding: '3px 8px', minWidth: 160,
                  border: '1px solid var(--nxai-input-border)', borderRadius: 6,
                  background: 'var(--nxai-input-bg)', color: 'var(--nxai-card-text)',
                },
              })
            : null,
          needle ? h('span', null, `${shown.length} match${shown.length === 1 ? '' : 'es'}`) : null,
        ),
        capped.length === 0
          ? h('div', { style: { ...sub, marginTop: 6 } },
              needle ? `No ${a.label.toLowerCase()} value matches “${this.state.menuFilter.trim()}”.` : 'No values on this axis.')
          : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } },
              ...capped.map((v) =>
                h('span', {
                  key: v.label,
                  onClick: v.apply,
                  style: {
                    ...chipStyle, cursor: 'pointer', marginRight: 0,
                    color: v.picked ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
                    fontWeight: v.picked ? 700 : 400,
                    borderColor: v.picked ? 'var(--nxai-action)' : 'var(--nxai-card-border)',
                  },
                }, v.label,
                  v.count !== null ? h('span', { style: { marginLeft: 5, fontSize: 11 } }, String(v.count)) : null),
              ),
            ),
        shown.length > capped.length
          ? h('div', { style: { ...sub, marginTop: 6 } },
              `showing the first ${capped.length} of ${shown.length} — search above to narrow`)
          : null,
      );
    };

    const parts: React.ReactNode[] = [];

    if (interpreting) {
      parts.push(h('div', { key: 'busy', style: { padding: '0 12px 8px', fontSize: 12, color: 'var(--nxai-card-sub)' } }, 'Reading your description…'));
    }

    // Board F: a question is not a filter — nothing has been narrowed — so
    // it renders as the question with the named facet's menu beneath it.
    if (clarify) {
      parts.push(h('div', {
        key: 'clarify',
        style: { margin: '0 12px 10px', padding: '8px 12px', fontSize: 13, borderRadius: 6, border: '1px solid var(--nxai-card-border)', background: 'var(--nxai-section-bg)', color: 'var(--nxai-card-text)', position: 'relative' as const },
      },
        h('span', null, clarify.question, ' '),
        clarify.facet === null && this.props.onOpenComposer
          ? h('a', {
              style: { cursor: 'pointer', color: 'var(--nxai-accent)' },
              onClick: () => this.props.onOpenComposer!(clarify.forText),
            }, 'Ask this in chat')
          : null,
        h('span', { style: { position: 'absolute' as const, right: 10, top: 10 } },
          this.closeGlyph(() => this.setState({ clarify: null }))),
        clarify.facet && AXES.some((a) => a.key === clarify.facet)
          ? valuePanel(AXES.find((a) => a.key === clarify.facet)!)
          : null,
      ));
    }

    const chips = interp ? filtersToChips(interp.filters) : [];
    if (chips.length > 0 || this.state.rung || this.props.filterOptions) {
      parts.push(h('div', { key: 'chips', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, padding: '0 12px 8px' } },
        // The Depth pick is a clause like any other, so it is removable like
        // any other. `nothing` is not here — its control is the state segment.
        this.state.rung
          ? h('span', { key: 'rung', style: chipStyle },
              `Depth: ${KNOWLEDGE_LABELS[this.state.rung]}`,
              this.closeGlyph(() => this.setState({ rung: null })))
          : null,
        ...chips.map((c) =>
          h('span', { key: `${c.key}:${c.value ?? ''}`, style: chipStyle },
            c.label, this.closeGlyph(() => this.removeChip(c)))),
        this.props.filterOptions
          ? h('span', {
              style: { fontSize: 12, color: 'var(--nxai-accent)', cursor: 'pointer', fontWeight: 600 },
              onClick: () => (menuOpen ? this.setState({ menuOpen: false }) : this.openMenu()),
            }, '+ Add a filter')
          : null,
        interp && interp.ids === null
          ? h('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub)' } },
              'The filter could not be resolved — the list is unchanged.')
          : null,
      ));
    }
    if (menuOpen && this.props.filterOptions) {
      parts.push(h('div', {
        key: 'menu',
        style: { margin: '0 12px 10px', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--nxai-card-border)', background: 'var(--nxai-card-bg)' },
      },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 } },
          ...AXES.map((a) =>
            h('span', {
              key: a.key,
              // Switching axis clears the within-axis search: it belongs to
              // the axis you are looking at, not to the panel.
              onClick: () => this.setState({ menuAxis: a.key, menuFilter: '' }),
              style: { fontSize: 12, cursor: 'pointer', fontWeight: menuAxis === a.key ? 700 : 400, color: menuAxis === a.key ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)' },
            }, a.label)),
          h('span', { style: { marginLeft: 'auto' } }, this.closeGlyph(() => this.setState({ menuOpen: false, menuAxis: null, menuFilter: '' }))),
        ),
        menuAxis && AXES.some((a) => a.key === menuAxis)
          ? valuePanel(AXES.find((a) => a.key === menuAxis)!)
          : null,
        // Round-9: what the panel cannot do is a FOOTNOTE, not the thing it
        // opens on. The panel opens on the first axis that has values.
        h('div', { style: { ...sub, marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--nxai-card-border)' } },
          'Thresholds, dates and content have no fixed values — describe those in the field above.'),
      ));
    }

    // The searched composition — a different sentence from the count, its
    // zeros stated, rendered only when something was actually filtered.
    if (interp && interp.ids) {
      const by = { local: 0, wpe: 0, external: 0 };
      for (const { p } of inView) by[p.origin]++;
      const phrase = (n: number, word: string) => (n === 0 ? `none ${word}` : `${n} ${word}`);
      parts.push(h('div', { key: 'comp', style: { padding: '0 12px 8px', fontSize: 11, color: 'var(--nxai-card-sub)' } },
        `matched: ${phrase(by.local, 'on your machine')} · ${phrase(by.wpe, 'WP Engine')} · ${phrase(by.external, 'external')}`));
    }

    return parts.length ? h(React.Fragment, null, ...parts) : null;
  }

  private renderPlace(p: PropertyView, pl: PlaceView): React.ReactNode {
    const row = h('div', {
      key: pl.rowId,
      onClick: () => this.setState({ view: { screen: 'place', key: p.key, rowId: pl.rowId } }),
      style: { ...gridRow, padding: '4px 0', fontSize: 12, color: 'var(--nxai-card-sub)', cursor: 'pointer' },
    },
      h('span', null, ''),
      // The indent lives INSIDE the Site cell — the tracks never move.
      h('span', { style: { ...ellipsis, paddingLeft: 14, color: 'var(--nxai-card-text)' } },
        this.state.armed ? this.scopeCheckbox([pl.rowId]) : null,
        pl.kind === 'copy' ? 'your copy' : pl.kind,
        h('span', { style: { color: 'var(--nxai-card-sub)', marginLeft: 8 } }, pl.name)),
      h('span', null,
        h('div', { style: { ...mono, ...ellipsis } }, pl.address ?? '—')),
      h('span', null, KNOWLEDGE_LABELS[pl.knowledge]),
      pl.knowledge === 'nothing'
        ? h('span', null, '') // the rung already says it — one sentence per state
        : h('span', {
            style: pl.checked.state === 'fail' ? { color: 'var(--nxai-danger-text)' } : undefined,
          }, checkedText(pl.checked, false, true)),
      needsYouCell(pl.needsYou),
    );
    // The detail is a SUB-ROW beneath the grid, inset to the Site cell — it
    // never crosses a track, and it never repeats the cell's short form.
    const detail = pl.checked.state === 'fail' && pl.checked.reason
      ? h('div', {
          key: `${pl.rowId}-detail`,
          style: { paddingLeft: 34, fontSize: 12, color: 'var(--nxai-danger-text)' },
        }, failDetail(pl.checked))
      : null;
    return h(React.Fragment, { key: pl.rowId }, row, detail);
  }

  private renderProperty(p: PropertyView, outsideFilter: boolean): React.ReactNode {
    const multi = p.places.length > 1;
    const open = !!this.state.open[p.key];
    const flags: string[] = [];
    if (p.collision) flags.push('shares a name with a property of another origin — kept separate');
    if (p.nameSource === 'install') flags.push('unnamed in the WP Engine portal — showing install names');
    if (outsideFilter) flags.push('outside the current filter — shown because it matches your search');

    const sourceWord = (pl: PlaceView): string =>
      pl.source === 'local' ? 'your machine' : pl.source === 'wpe' ? 'WP Engine' : 'your server';
    // The set, not a count of it: the distinct hosts, in place order.
    const hostSet = [...new Set(p.places.map(sourceWord))].join(' · ');

    const headline = h('div', { style: gridRow },
      h('span', {
        style: { color: 'var(--nxai-card-sub)', fontSize: 11, cursor: multi ? 'pointer' : 'default' },
        onClick: multi ? () => this.toggleOpen(p.key) : undefined,
      }, multi ? (open ? '▾' : '▸') : ''),
      h('span', { style: { ...ellipsis, fontWeight: 600, color: 'var(--nxai-card-text)' } },
        this.state.armed ? this.scopeCheckbox(p.places.map((pl) => pl.rowId)) : null,
        h('span', {
          style: { cursor: 'pointer' },
          onClick: () =>
            this.setState({
              view: multi
                ? { screen: 'property', key: p.key }
                : { screen: 'place', key: p.key, rowId: p.places[0].rowId },
            }),
          title: p.name,
        }, p.name)),
      // Where it lives: address stacked over host (the sheet's shape). A
      // group shows the HOST SET — a set may be rendered, a count hides it.
      h('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub)' } },
        p.places.length === 1
          ? h(React.Fragment, null,
              h('div', { style: { ...mono, ...ellipsis } }, p.places[0].address ?? ''),
              h('div', null, p.places[0].kind === 'local' ? 'your machine' : `${p.places[0].kind === 'copy' ? 'your copy' : p.places[0].kind} · ${sourceWord(p.places[0])}`))
          : h(React.Fragment, null,
              h('div', null, hostSet),
              h('div', null, `${p.places.length} places${p.hasCopy ? ' incl. your copy' : ''}`))),
      h('span', { style: { fontSize: 12, color: 'var(--nxai-card-sub)' } },
        p.rungs.map((r) => KNOWLEDGE_LABELS[r]).join(' / ')),
      p.rungs.includes('nothing') && p.oldest.state === 'never'
        ? h('span', null, '')
        : h('span', {
            style: {
              fontSize: 12,
              color: p.oldest.state === 'fail' ? 'var(--nxai-danger-text)' : 'var(--nxai-card-sub)',
            },
          }, checkedText(p.oldest, multi && p.oldest.state !== 'fail' && p.oldest.state !== 'never', true)),
      needsYouCell(p.needsYou),
    );

    return h('div', {
      key: p.key,
      style: { padding: '6px 12px', borderBottom: '1px solid var(--nxai-card-border)' },
    },
      headline,
      // The full failure sentence renders ONCE: here when the group is
      // closed, on the failing place's sub-row when it is open.
      !(multi && open) && p.oldest.state === 'fail' && p.oldest.reason
        ? h('div', { style: { paddingLeft: 34, fontSize: 12, color: 'var(--nxai-danger-text)' } },
            failDetail(p.oldest))
        : null,
      flags.length
        ? h('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub)', paddingLeft: 34 } }, flags.join(' · '))
        : null,
      multi && open ? p.places.map((pl) => this.renderPlace(p, pl)) : null,
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

    if (this.state.view) {
      const prop = collapse.properties.find((pp) => pp.key === (this.state.view as { key: string }).key);
      if (prop && this.state.view.screen === 'property') return this.renderPropertyScreen(prop);
      if (prop && this.state.view.screen === 'place') {
        const pl = prop.places.find((x) => x.rowId === (this.state.view as { rowId: string }).rowId);
        if (pl) return this.renderPlaceScreen(prop, pl);
      }
    }

    const { header } = collapse;
    const { origin, state, query, sortBy, rung } = this.state;
    const q = query.trim().toLowerCase();

    const inView: Array<{ p: PropertyView; outside: boolean }> = [];
    for (const p of collapse.properties) {
      const matchesQ =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.places.some((pl) => pl.name.toLowerCase().includes(q) || (pl.address ?? '').toLowerCase().includes(q));
      if (!matchesQ) continue;
      const ids = this.state.interp?.ids;
      const inInterp = !ids || p.places.some((pl) => ids.includes(pl.rowId));
      const inFilter =
        inInterp &&
        (origin === 'all' || p.origin === origin) &&
        matchesState(p, state) &&
        (rung === null || p.rungs.includes(rung));
      if (!inFilter && !q) continue;
      inView.push({ p, outside: !inFilter });
    }
    const rank = (p: PropertyView): number =>
      p.oldest.state === 'fail' || (p.needsYou?.count ?? 0) > 0 ? 0 : p.rungs.includes('nothing') ? 1 : 2;
    const checkedKey = (p: PropertyView): string => p.oldest.finishedAt ?? '';
    // The from-line resolves to the filter that produced the set (sheet 18).
    const fromParts: string[] = [];
    if (origin !== 'all') fromParts.push(ORIGIN_LABELS.find((o) => o.key === origin)!.label);
    if (state !== 'all') fromParts.push(`“${STATE_LABELS.find((sl) => sl.key === state)!.label}”`);
    if (rung) fromParts.push(`“${KNOWLEDGE_LABELS[rung]}”`);
    if (q) fromParts.push(`search “${query.trim()}”`);
    const fromLabel = fromParts.length ? `your ${fromParts.join(' · ')} view` : 'the full list';
    inView.sort((a, b) => {
      if (sortBy === 'name') return a.p.name.localeCompare(b.p.name);
      if (sortBy === 'checked') return checkedKey(a.p).localeCompare(checkedKey(b.p)) || a.p.name.localeCompare(b.p.name);
      return rank(a.p) - rank(b.p) || a.p.name.localeCompare(b.p.name);
    });

    // SegmentedControl: the recessed ground is what makes the white active
    // item read as selected (round-6 break 5).
    const segTrack: React.CSSProperties = {
      display: 'inline-flex', gap: 1, padding: 2, borderRadius: 8,
      background: 'var(--nxai-track-bg)',
    };
    const segItem = (active: boolean): React.CSSProperties => ({
      padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
      background: active ? 'var(--nxai-card-bg)' : 'transparent',
      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.15)' : 'none',
      color: active ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
      fontWeight: active ? 600 : 400,
    });
    // Button size=sm: 6px radius, primary is ACTION blue — selection is not brand.
    const stateBtn = (active: boolean): React.CSSProperties => ({
      padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
      border: `1px solid ${active ? 'var(--nxai-action)' : 'var(--nxai-card-border)'}`,
      background: active ? 'var(--nxai-action)' : 'var(--nxai-card-bg)',
      color: active ? 'var(--nxai-action-text)' : 'var(--nxai-card-text)',
    });
    const notice: React.CSSProperties = {
      margin: '0 12px 10px', padding: '8px 12px', fontSize: 13, borderRadius: 6,
      border: '1px solid var(--nxai-card-border)', borderLeft: '3px solid var(--nxai-card-sub)',
      background: 'var(--nxai-section-bg)', color: 'var(--nxai-card-text)',
    };
    const headCell = (label: string, by: SortBy | null): React.ReactNode =>
      h('span', {
        key: label,
        onClick: by ? () => this.setState({ sortBy: by }) : undefined,
        title: by ? 'Sort by this column' : undefined,
        style: {
          fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' as const,
          color: by && sortBy === by ? 'var(--nxai-card-text)' : 'var(--nxai-card-sub)',
          cursor: by ? 'pointer' : 'default',
          borderBottom: by ? (sortBy === by ? '2px solid var(--nxai-action)' : '1px dotted var(--nxai-card-sub)') : 'none',
          paddingBottom: 1, width: 'fit-content',
        },
      }, label);

    return h('div', null,
      // The screen has a name, and the one action that adds to it.
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12, padding: '2px 12px 2px' } },
        h('div', { style: { fontSize: 17, fontWeight: 700, color: 'var(--nxai-card-text)' } }, 'Your sites'),
        this.props.onAddSite
          ? h('span', {
              onClick: this.props.onAddSite,
              style: { marginLeft: 'auto', fontSize: 12, cursor: 'pointer', color: 'var(--nxai-accent)', fontWeight: 600 },
            }, 'Add a site')
          : null,
      ),
      h('div', { style: { padding: '0 12px 2px', color: 'var(--nxai-card-sub)', fontSize: 13 } },
        `${header.total} properties · ${header.placesTotal} places · ${header.onThisMachine} live on your machine`),
      header.needsYou
        ? h('div', { style: { padding: '0 12px 10px', color: 'var(--nxai-card-sub)', fontSize: 11 } },
            `${header.needsYou.situations} situation${header.needsYou.situations === 1 ? '' : 's'} need${header.needsYou.situations === 1 ? 's' : ''} you` +
            (header.needsYou.unattributed > 0
              ? ` · ${header.needsYou.unattributed} not tied to a site`
              : ''),
            header.needsYou.unattributed > 0 && this.props.onOpenNow
              ? h('a', {
                  style: { cursor: 'pointer', color: 'var(--nxai-accent)', marginLeft: 6 },
                  onClick: this.props.onOpenNow,
                }, 'Open Now')
              : null)
        : h('div', { style: { padding: '0 12px 10px', color: 'var(--nxai-card-sub)', fontSize: 11 } },
            'Per-site “needs you” counts arrive when situations can be tied to a site; until then the list order carries it.'),
      ...header.ceilings.map((v) =>
        h('div', { key: `ceil-${v.accountId}`, style: notice },
          v.statement, ' ',
          h('a', {
            style: { cursor: 'pointer', color: 'var(--nxai-accent)' },
            onClick: () => this.setState({ state: 'ceiling', origin: 'all', query: '' }),
          }, 'Show them'),
        ),
      ),
      header.neverLookedInside > 0
        ? h('div', { style: notice },
            h('strong', null, String(header.neverLookedInside)),
            ` places Nexus has ${STATE_SENTENCES.neverLookedInside.toLowerCase()}. `,
            h('a', {
              style: { cursor: 'pointer', color: 'var(--nxai-accent)' },
              onClick: () => this.setState({ state: 'nothing', origin: 'all' }),
            }, 'Show them'),
          )
        : null,
      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '0 12px 10px' } },
        h('span', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub)' } }, 'Where'),
        h('span', { style: segTrack },
          ...ORIGIN_LABELS.map((o) =>
            h('span', {
              key: `o-${o.key}`, style: segItem(origin === o.key),
              onClick: () => this.setState({ origin: o.key }),
            }, o.key === 'all' ? `${o.label} ${header.total}` : `${o.label} ${header.byOrigin[o.key as 'local' | 'wpe' | 'external']}`),
          ),
        ),
        // Round-9: no partition equation. The four segment counts already
        // stand next to each other; spelling out `25 + 267 + 3 = 295` beside
        // them is the same arithmetic a second time, and it read as a fifth
        // figure rather than as the property of the four.
        ...STATE_LABELS.map((sl) =>
          h('span', {
            key: `s-${sl.key}`, style: stateBtn(state === sl.key),
            onClick: () => this.setState({ state: sl.key }),
          }, sl.label),
        ),
        h('span', {
          style: { fontSize: 11, color: 'var(--nxai-card-sub)', marginLeft: 'auto', cursor: 'pointer' },
          onClick: () => this.setState({ sortBy: 'consequence' }),
          title: 'Click a column head to change; click here to restore the default order',
        }, `Sort: ${SORT_LABELS[sortBy]}`),
        h('span', { style: { position: 'relative' as const } },
          h('svg', {
            width: 12, height: 12, viewBox: '0 0 24 24',
            style: { position: 'absolute' as const, left: 8, top: 7, opacity: 0.5 },
          },
            h('circle', { cx: 10, cy: 10, r: 7, fill: 'none', stroke: 'var(--nxai-card-sub)', strokeWidth: 2 }),
            h('line', { x1: 15.5, y1: 15.5, x2: 21, y2: 21, stroke: 'var(--nxai-card-sub)', strokeWidth: 2 }),
          ),
          h('input', {
            placeholder: 'Name, domain, or a description',
            value: query,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => this.setState({ query: e.target.value }),
            // Sheet 19: Enter hands the text to the interpreter; keystrokes
            // keep the instant name/domain narrowing.
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') void this.submitQuery(); },
            disabled: this.state.interpreting,
            style: {
              minWidth: 220, fontSize: 12, padding: '5px 10px 5px 26px',
              border: '1px solid var(--nxai-input-border)', borderRadius: 6,
              background: 'var(--nxai-input-bg)', color: 'var(--nxai-card-text)',
            },
          }),
        ),
      ),
      this.renderInterpretation(inView),
      this.renderBulkBar(inView, fromLabel),
      h('div', { style: { border: '1px solid var(--nxai-card-border)', borderRadius: 8, margin: '0 12px' } },
        h('div', { style: { ...gridRow, padding: '8px 12px', borderBottom: '1px solid var(--nxai-card-border)' } },
          h('span', null, ''),
          headCell('Site', 'name'),
          headCell('Where it lives', null),
          headCell('What Nexus knows', null),
          headCell('Checked', 'checked'),
          headCell('Needs you', null),
        ),
        inView.length === 0
          ? h('div', { style: { padding: 16, color: 'var(--nxai-card-sub)', fontSize: 13 } },
              q
                ? 'Nothing matches. The search covered every property, so if it is not here, Nexus has no row for it.'
                : 'Nothing in this view.')
          : inView.map(({ p, outside }, i) => {
              const divider =
                sortBy === 'consequence' && i > 0 && rank(inView[i - 1].p) < 2 && rank(p) === 2
                  ? h('div', {
                      key: `div-${p.key}`,
                      style: { padding: '4px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub)', background: 'var(--nxai-section-bg)', borderBottom: '1px solid var(--nxai-card-border)' },
                    }, 'Everything else · A–Z')
                  : sortBy === 'consequence' && i === 0 && rank(p) < 2
                    ? h('div', {
                        key: `div-needs-${p.key}`,
                        style: { padding: '4px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub)', background: 'var(--nxai-section-bg)', borderBottom: '1px solid var(--nxai-card-border)' },
                      }, 'Needs you first')
                    : null;
              return h(React.Fragment, { key: `frag-${p.key}` }, divider, this.renderProperty(p, outside));
            }),
      ),
      h('div', { style: { padding: '8px 12px', color: 'var(--nxai-card-sub)', fontSize: 12 } },
        `${inView.length} of ${header.total} properties shown · one scroll, no pagination`),
    );
  }
}
