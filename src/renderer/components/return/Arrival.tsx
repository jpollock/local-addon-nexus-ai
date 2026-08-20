/**
 * WP-46 · THE ARRIVAL (M6 · XD-26 §6a) — two columns of one verdict, and the
 * morning read to you before you ask anything.
 *
 * COMPUTES NO VERDICT. Every tier, every rule that placed a row, every gate's
 * checkpoint id and position, every place set and every part summary arrives
 * from `sessionRegistry`'s fold over `RETURN_TRIAGE`. The only numbers this
 * component makes are the three counts of the rows it is about to draw, and the
 * only sentences are the designer's, generated with those numbers substituted
 * in (`arrivalModel.ts`). A second place that decides what is urgent is a second
 * place that can disagree with the record.
 *
 * WHAT THE STRUCTURE PINS, because these are absences with teeth:
 *
 *  - **No interaction and no question asked.** The render takes no input. There
 *    is one control on the surface and it is the waiting row's door, which
 *    promotes a session that already exists; there is no filter, no sort
 *    control, no dismiss, and no confirm-you-are-back.
 *  - **No badge on the changed column.** The badge is `needsYou` and it lives on
 *    the waiting column and on the rail. Nothing in `changed` needs anyone, so
 *    nothing in it escalates (XD-23; XD-26's absence list).
 *  - **The reserved row is ONE row, and it cannot scroll away.** It is rendered
 *    outside the columns, sticky, from `ReservedRow` — which is one row whatever
 *    the counts say, by the contract's own shape. Twelve dark producers are one
 *    row saying twelve.
 *  - **No drift rows.** T5 leaves the list; the panel says where the facts went.
 *  - **Nothing in the changed column is composed on demand.** The provenance
 *    line beneath it is the designer's ratified sentence and it is true because
 *    the fold reads a record written when the run finished.
 *
 * React 16, class component, `React.createElement` — Local's renderer has no JSX
 * and no hooks.
 */
import React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import type { ReservedRow, Situation, TriageView } from '../../../main/intelligence-host/sessionRegistry';
import { ageLabel } from '../../../main/intelligence-host/sessionRegistry';
import { RETURN_COPY, SEP } from './returnCopy.generated';
import {
  accountingLine,
  arrivalCounts,
  awayHeadline,
  driftLine,
  gateLine,
  metaLine,
  needsLine,
  promotableSessionId,
  reservedDetail,
} from './arrivalModel';

/**
 * WHERE THE ABSENCE IS MEASURED, and why it is here rather than in the fold.
 *
 * "You were away 12 hours" is a fact about when THIS PERSON last looked at THIS
 * SURFACE. The ledger has no channel for it and should not grow one — it is not
 * an observation about the fleet. So the surface stamps its own last-open and
 * reads the previous stamp before overwriting it, which is why the headline
 * shows the real gap rather than zero.
 */
export const LAST_ARRIVAL_KEY = 'nexus-ai:return:last-arrival';

export interface ArrivalProps {
  electron: any;
  /** Promote the session a row belongs to. The arrival's only act. */
  onPromote?: (sessionId: string) => void;
  /** Test seam. Production reads `window.localStorage`. */
  store?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Test seam for the absence arithmetic. */
  now?: Date;
}

export interface ArrivalState {
  triage: TriageView | null;
  loading: boolean;
  error: string | null;
  /** Milliseconds since this surface was last opened, or null on a first open. */
  awayMs: number | null;
}

const styles = {
  surface: { display: 'flex', flexDirection: 'column' as const, gap: 14 },
  headline: { fontSize: 18, fontWeight: 600, color: 'var(--nxai-card-text)', margin: 0 },
  accounting: { fontSize: 12, color: 'var(--nxai-muted-text)', margin: '4px 0 0' },
  reserved: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 2,
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 4,
    padding: '10px 12px',
    background: 'var(--nxai-section-bg)',
  },
  reservedRule: {
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    color: 'var(--nxai-muted-text)',
  },
  reservedHeadline: { fontSize: 13, fontWeight: 600, color: 'var(--nxai-card-text)', margin: '2px 0' },
  reservedDetail: { fontSize: 11, color: 'var(--nxai-muted-text)' },
  columns: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' as const },
  columnHead: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 8,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    color: 'var(--nxai-muted-text)',
    borderBottom: '1px solid var(--nxai-card-border)',
    paddingBottom: 6,
    marginBottom: 8,
  },
  badge: {
    display: 'inline-block',
    minWidth: 18,
    borderRadius: 9,
    padding: '0 6px',
    fontSize: 10,
    fontWeight: 700,
    textAlign: 'center' as const,
    color: '#fff',
    background: '#c0392b',
  },
  row: {
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 4,
    padding: '10px 12px',
    marginBottom: 8,
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--nxai-card-text)',
  },
  rule: {
    fontSize: 10,
    fontStyle: 'italic' as const,
    color: 'var(--nxai-muted-text)',
    marginBottom: 4,
  },
  statement: { fontSize: 12, fontWeight: 600, marginBottom: 4 },
  /**
   * WP-48 · the row chip. ONE WORD — Waiting, Mid-change, Stuck.
   *
   * The padding and radius are the reason the rule exists rather than a taste:
   * a pill sized for one word renders a sentence as a lozenge with 6px of
   * padding against a 10px radius, which reads as a broken badge instead of as
   * prose. The phrases the chips used to carry are on the meta line now, as
   * text, where a sentence belongs.
   */
  chip: {
    display: 'inline-block',
    borderRadius: 10,
    padding: '1px 8px',
    marginBottom: 4,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.3,
    color: 'var(--nxai-muted-text)',
    border: '1px solid var(--nxai-card-border)',
  },
  ask: { fontSize: 11, marginBottom: 4, color: 'var(--nxai-card-text)' },
  verdict: { fontSize: 12, color: 'var(--nxai-card-text)', margin: '4px 0 0' },
  gate: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, marginBottom: 2 },
  meta: { fontSize: 10, color: 'var(--nxai-muted-text)' },
  door: {
    marginTop: 8,
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    fontWeight: 600,
    color: '#51bb7b',
    cursor: 'pointer',
  },
  filed: { fontSize: 10, color: 'var(--nxai-muted-text)', marginTop: 6, lineHeight: 1.6 },
  drift: { fontSize: 11, color: 'var(--nxai-muted-text)', lineHeight: 1.6, marginTop: 4 },
  empty: { fontSize: 11, color: 'var(--nxai-muted-text)' },
};

/**
 * Whole hours between two instants, as the rows render age.
 *
 * WP-48 · THE IMPLEMENTATION MOVED TO THE HOST and this is a re-export of it.
 * The headline now carries an age too (`{age}` in the ratified templates), and
 * it is composed in `sessionRegistry`; a second copy here would let the row's
 * own sentence disagree with the meta line directly beneath it about how old
 * the same situation is. One derivation, imported, is how that is kept true
 * rather than promised — the same move `declaredFromSession` makes for the
 * marks discipline.
 */
export { ageLabel } from '../../../main/intelligence-host/sessionRegistry';

export class Arrival extends React.Component<ArrivalProps, ArrivalState> {
  constructor(props: ArrivalProps) {
    super(props);
    this.state = { triage: null, loading: true, error: null, awayMs: null };
  }

  componentDidMount(): void {
    this.readAbsence();
    this.load();
  }

  /**
   * Read the previous stamp, THEN write the new one.
   *
   * In that order, always: stamping first would make every arrival report an
   * absence of zero, which is the surface lying about the one thing its
   * headline is about.
   */
  private readAbsence(): void {
    const store = this.props.store ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    const now = this.props.now ?? new Date();
    if (!store) return;
    let awayMs: number | null = null;
    try {
      const previous = store.getItem(LAST_ARRIVAL_KEY);
      const at = previous ? Date.parse(previous) : NaN;
      if (Number.isFinite(at)) awayMs = now.getTime() - at;
      store.setItem(LAST_ARRIVAL_KEY, now.toISOString());
    } catch {
      /* a storage that refuses is an unknown absence, never a zero one */
    }
    this.setState({ awayMs });
  }

  private load(): void {
    this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.RETURN_TRIAGE)
      .then((triage: TriageView) => this.setState({ triage, loading: false, error: null }))
      .catch((e: Error) => this.setState({ loading: false, error: String(e?.message ?? e) }));
  }

  private promote = (sessionId: string) => () => {
    if (this.props.onPromote) this.props.onPromote(sessionId);
  };

  /**
   * One waiting or changed row. The gate and the door appear on waiting only.
   *
   * WP-48 · THE VERDICT IS READ, NOT COMPOSED. `headline`, `ask`, `chip`,
   * `state` and `meta` all arrive from the host's one composer, so this
   * component holds no template, no substitution and no branch on which
   * sentence a row deserves — the property the ratified placement argument
   * buys. What remains here is layout: which field goes on which line, and the
   * system's own rule that a BADGE CARRIES ONE WORD while every phrase, the
   * parts chip and the status line included, is text on the meta line.
   */
  private renderSituation(situation: Situation, now: Date): React.ReactElement {
    const sessionId = promotableSessionId(situation);

    return React.createElement(
      'div',
      { key: situation.id, style: styles.row, 'data-situation': situation.id, 'data-tier': situation.tier },
      // XD-23: every row shows the rule that placed it. Derived, never authored.
      // This stays `tierReason` rather than the template's own `rule` field: the
      // reason names the EVIDENCE that placed the row ("a write has landed in
      // scope — 2 target(s) … (evt_…)"), where the template's rule restates the
      // tier. Trading derived evidence for an authored tier label would be the
      // regression XD-23 exists to prevent, so the ratified `rule` is carried in
      // the generated module and deliberately not rendered here.
      React.createElement('div', { key: 'rule', style: styles.rule }, situation.tierReason),
      // ONE WORD, when the class has one. A row whose chip is empty renders no
      // badge at all rather than an empty pill.
      ...(situation.chip
        ? [React.createElement('div', { key: 'chip', style: styles.chip, 'data-chip': situation.chip }, situation.chip)]
        : []),
      // The verdict, composed once in the host and rendered verbatim.
      React.createElement(
        'div',
        { key: 'headline', style: styles.statement, 'data-headline': situation.headlineTemplate ?? 'derived' },
        situation.headline,
      ),
      ...(situation.ask
        ? [React.createElement('div', { key: 'ask', style: styles.ask, 'data-ask': 'true' }, situation.ask)]
        : []),
      // The situation's own parts, in the record's words. Never composed prose.
      // They stay BENEATH the verdict rather than replacing it: tear 2's rule is
      // that a correct list of parts is not a verdict about the whole, and the
      // row now says both.
      ...situation.parts.map((part, i) =>
        React.createElement(
          'div',
          { key: `part-${i}`, style: styles.meta, 'data-part': part.kind },
          part.summary,
        ),
      ),
      // J-Return's WHERE — the gate, by checkpoint id, with its position.
      ...(situation.gate
        ? [
            React.createElement('div', { key: 'gate', style: styles.gate, 'data-gate': situation.gate.checkpointId }, gateLine(situation.gate)),
            React.createElement('div', { key: 'needs', style: styles.meta }, needsLine(situation.gate)),
          ]
        : []),
      React.createElement('div', { key: 'meta', style: styles.meta }, metaLine(situation, now)),
      ...(situation.column === 'waiting' && sessionId
        ? [
            React.createElement(
              'button',
              { key: 'door', style: styles.door, 'data-door': sessionId, onClick: this.promote(sessionId) },
              RETURN_COPY.ROW_DOOR,
            ),
          ]
        : []),
    );
  }

  /**
   * The reserved slot. ONE row, always rendered, sticky so it cannot be scrolled
   * away — §4a tear 3, built rather than written down.
   */
  private renderReserved(reserved: ReservedRow): React.ReactElement {
    return React.createElement(
      'div',
      { style: styles.reserved, 'data-reserved': 'true' },
      React.createElement('div', { key: 'rule', style: styles.reservedRule }, RETURN_COPY.RESERVED_HEAD),
      React.createElement('div', { key: 'head', style: styles.reservedHeadline }, reserved.headline),
      React.createElement('div', { key: 'detail', style: styles.reservedDetail }, reservedDetail(reserved)),
    );
  }

  render(): React.ReactElement | null {
    const { triage, loading, error, awayMs } = this.state;
    const now = this.props.now ?? new Date();

    if (loading) return React.createElement('div', { style: styles.empty }, '');
    if (error || !triage) {
      return React.createElement('div', { style: styles.empty, 'data-arrival-error': 'true' }, error ?? '');
    }

    const counts = arrivalCounts(triage);

    return React.createElement(
      'section',
      { style: styles.surface, 'data-surface': 'return-arrival' },

      // The headline is about the USER's absence; the accounting line is the
      // same three counts the columns are about to render, in one breath.
      React.createElement(
        'header',
        { key: 'header' },
        React.createElement('h2', { style: styles.headline, 'data-away': 'true' }, awayHeadline(awayMs)),
        React.createElement('p', { style: styles.accounting, 'data-accounting': 'true' }, accountingLine(counts)),
        // WP-48 · the list verdict — the sentence no single row can say, and the
        // most useful one this data produces: "nothing is half-done, so nothing
        // is expensive to stop." Composed in the host from the very rows below
        // it, so it cannot contradict them. Empty when nothing is waiting.
        ...(triage.verdict
          ? [React.createElement('p', { style: styles.verdict, 'data-verdict': 'true' }, triage.verdict)]
          : []),
      ),

      React.createElement('div', { key: 'reserved' }, this.renderReserved(triage.reserved)),

      React.createElement(
        'div',
        { key: 'columns', style: styles.columns },

        React.createElement(
          'div',
          { key: 'waiting', 'data-column': 'waiting' },
          React.createElement(
            'div',
            { style: styles.columnHead },
            React.createElement('span', { key: 'label' }, RETURN_COPY.WAITING_HEAD),
            // The badge is the waiting count and it lives HERE and on the rail.
            ...(counts.needsYou > 0
              ? [React.createElement('span', { key: 'badge', style: styles.badge, 'data-badge': 'needsYou' }, String(counts.needsYou))]
              : []),
          ),
          ...triage.waiting.map((s) => this.renderSituation(s, now)),
        ),

        React.createElement(
          'div',
          { key: 'changed', 'data-column': 'changed' },
          // NO BADGE. Nothing here needs the user, so nothing here escalates.
          React.createElement('div', { style: styles.columnHead }, RETURN_COPY.CHANGED_HEAD),
          ...triage.changed.map((s) => this.renderSituation(s, now)),
          React.createElement('p', { key: 'filed', style: styles.filed, 'data-filed': 'true' }, RETURN_COPY.FILED_BEFORE_YOU_ARRIVED),
        ),
      ),

      // T5 leaves the list. This line is where it went — no drift rows anywhere.
      React.createElement('p', { key: 'drift', style: styles.drift, 'data-drift': 'true' }, driftLine(this.driftCount())),
    );
  }

  /**
   * The count of facts past their freshness window — `null`, and honestly so.
   *
   * WP-30's contract carries no channel for it: `ReservedRow.staleCount` counts
   * PRODUCERS reporting late, a different question, and the golden fixture pins
   * it at 0 for a morning that has 41 stale facts in it. Rendering `staleCount`
   * here would put a producer-liveness number under a fact-freshness sentence.
   * Raised at the gate as an escalation rather than closed by a guess.
   */
  private driftCount(): number | null {
    return null;
  }
}
