/**
 * WP-22 · the "Currently in" strip — the chat's scope, made visible.
 *
 * The designer's IA puts a band above the composer carrying site + branch + content
 * age. This is the lean version: the site, framed as your copy, plus the affordance
 * that pins or unpins it. The band sizes to its content rather than to the designer's
 * 52px, because 52px is the height of three facts and this carries one — it grows into
 * the band when the content-age chip has a renderer-reachable source (see the packet
 * report; today nothing this side of the IPC boundary carries a content age).
 *
 * **It never blocks the composer.** Everything it renders arrives as props the
 * container already holds; there is no fetch, no await, and no state on this component
 * except whether its own list is open. A strip that made the user wait to type would
 * be worse than no strip.
 *
 * Every string comes from `stripCopy()` so the vocabulary is asserted in one place.
 */
import React from 'react';
import { UI_COLORS } from '../../../common/constants';
import { stripCopy, type SiteContextMode, type SiteContentStatus } from './siteContextModel';

export interface SiteChoice {
  id: string;
  name: string;
}

interface Props {
  mode: SiteContextMode;
  /** The site the chat is scoped to — null only in 'none'. */
  siteName: string | null;
  /** The site on screen, when a site page is open. */
  viewedSiteName: string | null;
  /** Every site the user can pin. Empty while the list is still loading. */
  sites: SiteChoice[];
  /**
   * WP-22b · what the record says about this copy's content, or null.
   *
   * Null covers both "not recording" and "not answered yet": in either case the chip
   * is absent and the band is exactly what it was before this packet. The read is
   * fire-and-forget in the container, so nothing here ever waits on it — a strip that
   * made the user wait to type would be worse than no strip.
   */
  content?: SiteContentStatus | null;
  /** Pin a site. Survives navigation until cleared. */
  onPick: (siteId: string) => void;
  /** Drop the pin and follow the screen again. */
  onClear: () => void;
}

interface State {
  open: boolean;
  query: string;
}

/** Above this many sites the list needs a filter to be usable — 118 local sites is normal. */
const SEARCH_THRESHOLD = 8;
const MAX_ROWS = 200;

const styles = {
  band: {
    display: 'flex',
    // Top-aligned, not centred: the affordance stays beside the FIRST line when the copy
    // wraps, instead of drifting to the middle of a three-line band.
    alignItems: 'flex-start' as const,
    gap: 8,
    padding: '7px 14px',
    borderTop: '1px solid var(--nxai-card-border)',
    background: 'var(--nxai-section-bg)',
    flexShrink: 0,
    position: 'relative' as const,
  },
  dot: (active: boolean) => ({
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
    marginTop: 5,
    background: active ? UI_COLORS.WPE_BRAND : 'var(--nxai-card-sub)',
    opacity: active ? 1 : 0.5,
  }),
  lines: { flex: 1, minWidth: 0 },
  // Both lines WRAP rather than ellipsize. At the docked panel's 380px, ellipsis cut
  // "No site selected — answers will be fleet-…" and "it stays on alpine-outfitters u…":
  // in each case the clause that was truncated is the one carrying the meaning. A band
  // that grows a line is cheaper than a disclosure that is unreadable.
  primary: {
    fontSize: 12,
    lineHeight: 1.35,
    color: 'var(--nxai-card-text)',
    overflowWrap: 'anywhere' as const,
  },
  secondary: {
    fontSize: 10,
    lineHeight: 1.35,
    color: 'var(--nxai-card-sub)',
    marginTop: 2,
    overflowWrap: 'anywhere' as const,
  },
  // The chip is one fact, so it is one pill — sized to its text, wrapping with the
  // band rather than clipping, for the same reason the two lines wrap: the clause
  // that would be cut ("11 days ago") is the one carrying the meaning.
  chip: {
    display: 'inline-block',
    marginTop: 3,
    padding: '1px 6px',
    borderRadius: 3,
    border: '1px solid var(--nxai-card-border)',
    fontSize: 10,
    lineHeight: 1.35,
    color: 'var(--nxai-card-sub)',
    overflowWrap: 'anywhere' as const,
  },
  action: {
    background: 'none',
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 4,
    color: 'var(--nxai-card-sub)',
    cursor: 'pointer',
    fontSize: 11,
    padding: '2px 8px',
    flexShrink: 0,
  },
  popover: {
    position: 'absolute' as const,
    bottom: '100%',
    right: 10,
    left: 10,
    marginBottom: 4,
    background: 'var(--nxai-card-bg)',
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 6,
    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    zIndex: 10,
    maxHeight: 240,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  search: {
    background: 'var(--nxai-input-bg)',
    border: 'none',
    borderBottom: '1px solid var(--nxai-card-border)',
    color: 'var(--nxai-card-text)',
    fontSize: 12,
    padding: '7px 10px',
    outline: 'none',
    fontFamily: 'inherit',
  },
  list: { overflowY: 'auto' as const, flex: 1 },
  row: {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    background: 'none',
    border: 'none',
    color: 'var(--nxai-card-text)',
    cursor: 'pointer',
    fontSize: 12,
    padding: '6px 10px',
    fontFamily: 'inherit',
  },
  empty: { padding: '10px', fontSize: 11, color: 'var(--nxai-card-sub)' },
};

export class SiteContextStrip extends React.Component<Props, State> {
  state: State = { open: false, query: '' };

  private toggle = (): void => {
    // Reopening on a stale filter hides sites the user expects to see, so the query
    // resets with the list rather than persisting invisibly.
    this.setState((s) => ({ open: !s.open, query: '' }));
  };

  private handleAction = (): void => {
    if (this.props.mode === 'override') {
      this.props.onClear();
      return;
    }
    this.toggle();
  };

  private pick(siteId: string): void {
    this.setState({ open: false, query: '' });
    this.props.onPick(siteId);
  }

  /** The rows to show. Filtering narrows what is listed and nothing else. */
  visibleSites(): SiteChoice[] {
    const q = this.state.query.trim().toLowerCase();
    const matched = q
      ? this.props.sites.filter((s) => s.name.toLowerCase().indexOf(q) !== -1)
      : this.props.sites;
    return matched.slice(0, MAX_ROWS);
  }

  private renderPopover(): React.ReactNode {
    if (!this.state.open) return null;
    const visible = this.visibleSites();

    return React.createElement(
      'div',
      { style: styles.popover, role: 'dialog', 'aria-label': 'Choose a site' },
      this.props.sites.length > SEARCH_THRESHOLD
        ? React.createElement('input', {
            style: styles.search,
            value: this.state.query,
            placeholder: 'Find a site…',
            'aria-label': 'Find a site',
            autoFocus: true,
            onChange: (e: any) => this.setState({ query: e.target.value }),
          })
        : null,
      React.createElement(
        'div',
        { style: styles.list },
        visible.length === 0
          ? React.createElement(
              'div',
              { style: styles.empty },
              this.props.sites.length === 0 ? 'No sites yet.' : 'No site matches that.',
            )
          : visible.map((s) =>
              React.createElement(
                'button',
                {
                  key: s.id,
                  style: styles.row,
                  onClick: () => this.pick(s.id),
                },
                s.name,
              ),
            ),
      ),
    );
  }

  render() {
    const { mode, siteName, viewedSiteName, content } = this.props;
    const copy = stripCopy({ mode, siteName, viewedSiteName, content });

    return React.createElement(
      'div',
      { style: styles.band, 'data-nexus-site-strip': mode },
      React.createElement('span', { style: styles.dot(mode !== 'none') }),
      React.createElement(
        'div',
        { style: styles.lines },
        React.createElement('div', { style: styles.primary, title: copy.primary }, copy.primary),
        copy.chip
          ? React.createElement(
              'div',
              { style: styles.chip, title: copy.chip, 'data-nexus-content-age': true },
              copy.chip,
            )
          : null,
        copy.secondary
          ? React.createElement('div', { style: styles.secondary, title: copy.secondary }, copy.secondary)
          : null,
      ),
      React.createElement(
        'button',
        {
          style: styles.action,
          onClick: this.handleAction,
          'aria-label': copy.actionLabel,
        },
        copy.actionLabel,
      ),
      this.renderPopover(),
    );
  }
}
