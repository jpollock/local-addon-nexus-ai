/**
 * WP-38 · the corroboration render — `from-designer-07-corroboration-render.md`
 * drawn in the Docked Panel.
 *
 * THE THREE STATES, and the pin that rules each:
 *
 *  - **cited-and-resolves — quiet.** A trailing Chip in `neutral/subtle`
 *    carrying the record's id. A door, never a footnote, never a superscript
 *    (ruling §2: "a claim's source belongs at the end of the claim and nowhere
 *    else").
 *  - **cited-but-unresolvable — the loudest thing on the surface.**
 *    `error/strong`, because "a claim pointing at a record nobody supplied is
 *    worse than a claim pointing at nothing: it looks like evidence."
 *  - **uncited-factual-claim — loud here.** `warning/subtle`, rendered because
 *    the MODEL declared it with `[[cite:none]]`. Nothing on this surface decides
 *    that a sentence is a factual claim; WP-34's gate ruled that the forgotten-
 *    bare case belongs to the eval, never to the render.
 *
 * WHAT THIS FILE MAY NOT DO, and each has a test:
 *
 *  - **No confidence.** No number, no percentage, no traffic light. The states
 *    are three, and each names what is true about the citation.
 *  - **No footnote list.** "A bibliography moves the evidence away from the
 *    sentence that needs it." Doors sit where the claim is.
 *  - **No record contents.** The peek is identity, trust label and the door. "A
 *    copy is a second place a fact can be wrong."
 *  - **No NLP, no classifier, no reclassification.** The segments arrive from
 *    the shared join's offsets; this file searches no text for anything.
 *  - **No refusal, no retroactive linking.** An uncited reply renders. An old
 *    reply is never re-linked by matching text — the one thing that would make
 *    every link untrustworthy.
 *
 * DESIGN SYSTEM (the sheet's own note). The marker is the bound system's `Chip`
 * at `size=xs`; the three faces map one to one onto ADR-24's states. No colour
 * is authored here — every value is an existing `--nxai-*` theme token, which is
 * ruling §1's "keep the system's Chip in the system's face" in the only form
 * this renderer has one.
 *
 * React 16, class component, `React.createElement` — Local's renderer has no JSX
 * and no hooks.
 */
import React from 'react';
import {
  chipFor,
  citationRender,
  peekTime,
  recordPeek,
  unresolvedPanel,
  LEDGER_SEARCH_DOOR_LABEL,
  type ChipFace,
  type CitationRender,
  type CitationResolution,
  type CitationSegment,
  type CitationTurn,
  type RecordPeek,
} from './citationModel';

/** The sheet's own words for the third state, carried as the chip's title. */
export const NO_RECORD_TITLE = 'a fact with nothing offered for it';

interface Props {
  turn: CitationTurn;
  /**
   * The panel's markdown renderer, INJECTED rather than imported.
   *
   * `PanelChat` owns it (and owns the raw-HTML suppression that goes with it),
   * and importing it back from here would be a cycle. Injection also lets the
   * pins drive this surface without pulling `marked` into a unit test.
   */
  renderMarkdown: (markdown: string) => string;
  /** The record door. Absent when nothing can open a record — see below. */
  onOpenRecord?: (peek: RecordPeek) => void;
  /** The ledger-search door for an unresolvable id. Absent for the same reason. */
  onSearchLedger?: (id: string) => void;
}

interface State {
  /** Which chip's panel is open, by segment index. One at a time. */
  openIndex: number | null;
}

const styles = {
  tally: {
    fontSize: 11,
    color: 'var(--nxai-card-sub)',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  notice: {
    fontSize: 11,
    color: 'var(--nxai-card-sub)',
    fontStyle: 'italic' as const,
    marginBottom: 6,
    paddingLeft: 8,
    borderLeft: '2px solid var(--nxai-card-border)',
    lineHeight: 1.45,
  },
  chipBase: {
    display: 'inline',
    fontSize: 10,
    lineHeight: 1.4,
    padding: '1px 5px',
    borderRadius: 3,
    marginLeft: 4,
    verticalAlign: 'baseline' as const,
    whiteSpace: 'nowrap' as const,
  },
  panel: {
    marginTop: 8,
    padding: 8,
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 4,
    background: 'var(--nxai-section-bg)',
    fontSize: 11,
    lineHeight: 1.45,
    color: 'var(--nxai-card-text)',
  },
  panelId: { fontFamily: 'monospace', fontSize: 11, fontWeight: 700 },
  panelMeta: { color: 'var(--nxai-card-sub)', marginTop: 2 },
  /**
   * WP-43 · the machine summary reads as prose, so it takes the panel's own
   * text colour rather than the muted metadata colour the identifiers use. No
   * new token: `--nxai-card-text` is what the panel already sets.
   */
  panelSummary: { color: 'var(--nxai-card-text)', marginTop: 4 },
  panelNote: {
    color: 'var(--nxai-card-sub)',
    marginTop: 6,
    paddingTop: 6,
    borderTop: '1px solid var(--nxai-card-border)',
    fontStyle: 'italic' as const,
  },
  door: {
    marginTop: 6,
    background: 'transparent',
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 3,
    color: 'var(--nxai-card-text)',
    fontSize: 11,
    padding: '3px 8px',
    cursor: 'pointer',
  },
  unresolvedPanel: {
    marginTop: 8,
    padding: 8,
    border: '1px solid var(--nxai-error-border)',
    borderRadius: 4,
    background: 'var(--nxai-error-bg)',
    color: 'var(--nxai-error-text)',
    fontSize: 11,
    lineHeight: 1.45,
  },
};

/**
 * The three faces, as tokens.
 *
 * `error/strong` is the only filled one — strong is what "the loudest thing on
 * the surface" means in a face vocabulary, and the two subtle faces stay
 * ring-and-text so a resolving citation reads as quiet.
 */
const FACE_STYLE: Record<ChipFace, React.CSSProperties> = {
  'neutral-subtle': {
    color: 'var(--nxai-card-sub)',
    border: '1px solid var(--nxai-card-border)',
    background: 'transparent',
  },
  'error-strong': {
    color: 'var(--nxai-error-text)',
    border: '1px solid var(--nxai-error-border)',
    background: 'var(--nxai-error-bg)',
    fontWeight: 600,
  },
  'warning-subtle': {
    color: 'var(--nxai-warn-text)',
    border: '1px solid var(--nxai-amber-border)',
    background: 'transparent',
  },
};

export class CitationSpans extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { openIndex: null };
  }

  private toggle(index: number): void {
    this.setState((s) => ({ openIndex: s.openIndex === index ? null : index }));
  }

  /** A run of the model's prose, rendered by the panel's own markdown pipeline. */
  private renderText(text: string, key: string): React.ReactNode {
    return React.createElement('span', {
      key,
      className: 'nexus-md nexus-cite-run',
      dangerouslySetInnerHTML: { __html: this.props.renderMarkdown(text) },
    });
  }

  /**
   * The trailing door.
   *
   * A `span` with a button role rather than a `<button>`: it sits INSIDE the
   * flow of a sentence, and a block-level control there breaks the line the
   * citation is supposed to end.
   */
  private renderChip(resolution: CitationResolution, index: number): React.ReactNode {
    const chip = chipFor(resolution);
    const interactive = resolution.state !== 'uncited-factual-claim';
    const open = this.state.openIndex === index;
    return React.createElement(
      'span',
      {
        key: `chip-${index}`,
        'data-citation-state': chip.state,
        'data-citation-face': chip.face,
        role: interactive ? 'button' : undefined,
        tabIndex: interactive ? 0 : undefined,
        'aria-expanded': interactive ? open : undefined,
        title: resolution.state === 'uncited-factual-claim' ? NO_RECORD_TITLE : undefined,
        style: {
          ...styles.chipBase,
          ...FACE_STYLE[chip.face],
          cursor: interactive ? 'pointer' : 'default',
        },
        onClick: interactive ? () => this.toggle(index) : undefined,
      },
      chip.label
    );
  }

  /**
   * Identity, time, the machine summary, trust label, and the door — the peek,
   * and nothing more.
   *
   * WP-43 closes the two lines WP-38 disclosed as owed. Both are CARRIED from
   * the supply through the widened join, and each renders only when it was
   * actually supplied: an absent time draws no time row, an absent summary
   * draws no summary row. The alternative — a placeholder, a dash, "unknown" —
   * is a word standing in for a fact, and this is the one surface whose entire
   * subject is the difference between the two.
   *
   * The summary is a bounded line about what the event was ABOUT, not the
   * record's contents. "A citation is a route, not a copy" survives it: the
   * route now names where it goes, which is what the sheet asked for.
   */
  private renderPeek(resolution: Extract<CitationResolution, { state: 'cited-and-resolves' }>): React.ReactNode {
    const peek = recordPeek(resolution.record);
    const time = peekTime(peek);
    const { onOpenRecord } = this.props;
    return React.createElement(
      'div',
      { style: styles.panel, 'data-citation-panel': 'record-peek' },
      React.createElement('div', { style: styles.panelId }, peek.id),
      peek.topic ? React.createElement('div', { style: styles.panelMeta }, peek.topic) : null,
      time
        ? React.createElement('div', { style: styles.panelMeta, 'data-peek-field': 'time' }, time)
        : null,
      peek.summary
        ? React.createElement('div', { style: styles.panelSummary, 'data-peek-field': 'summary' }, peek.summary)
        : null,
      React.createElement('div', { style: styles.panelMeta }, peek.supplySentence),
      React.createElement('div', { style: styles.panelNote }, peek.note),
      // A door that opens nothing is worse than no door. It renders only when a
      // caller can actually open the record — the launcher discipline WP-27 used
      // for "Restore this site".
      onOpenRecord
        ? React.createElement(
            'button',
            { style: styles.door, onClick: () => onOpenRecord(peek) },
            peek.doorLabel
          )
        : null
    );
  }

  /** The loudest panel on the surface. It states the limit and does not guess. */
  private renderUnresolved(
    resolution: Extract<CitationResolution, { state: 'cited-but-unresolvable' }>
  ): React.ReactNode {
    const panel = unresolvedPanel(resolution);
    const { onSearchLedger } = this.props;
    const searchId = panel.searchId;
    return React.createElement(
      'div',
      { style: styles.unresolvedPanel, 'data-citation-panel': 'unresolved' },
      React.createElement('div', null, panel.sentence),
      searchId && onSearchLedger
        ? React.createElement(
            'button',
            { style: styles.door, onClick: () => onSearchLedger(searchId) },
            LEDGER_SEARCH_DOOR_LABEL
          )
        : null
    );
  }

  private renderOpenPanel(segments: readonly CitationSegment[]): React.ReactNode {
    const { openIndex } = this.state;
    if (openIndex === null) return null;
    const segment = segments[openIndex];
    if (!segment || segment.kind !== 'citation') return null;
    const resolution = segment.resolution;
    if (resolution.state === 'cited-and-resolves') return this.renderPeek(resolution);
    if (resolution.state === 'cited-but-unresolvable') return this.renderUnresolved(resolution);
    return null;
  }

  render(): React.ReactNode {
    const render: CitationRender = citationRender(this.props.turn);

    if (render.kind === 'plain') {
      return React.createElement('div', {
        className: 'nexus-md',
        'data-citation-render': render.reason,
        dangerouslySetInnerHTML: { __html: this.props.renderMarkdown(render.text) },
      });
    }

    if (render.kind === 'predates-convention') {
      return React.createElement(
        'div',
        { 'data-citation-render': 'predates-convention' },
        React.createElement('div', { style: styles.notice }, render.notice),
        React.createElement('div', {
          className: 'nexus-md',
          dangerouslySetInnerHTML: { __html: this.props.renderMarkdown(render.text) },
        })
      );
    }

    const { segments, tally } = render;
    return React.createElement(
      'div',
      { 'data-citation-render': 'corroborated' },
      // Derived from the spans it counts, never computed beside them. Absent
      // when there are no spans: a "0 · 0 · 0" strip over an ordinary answer is
      // a container for an empty run.
      tally ? React.createElement('div', { style: styles.tally }, tally) : null,
      React.createElement(
        'div',
        { className: 'nexus-cite-body' },
        ...segments.map((segment, i) =>
          segment.kind === 'text'
            ? this.renderText(segment.text, `text-${i}`)
            : this.renderChip(segment.resolution, i)
        )
      ),
      this.renderOpenPanel(segments)
    );
  }
}
