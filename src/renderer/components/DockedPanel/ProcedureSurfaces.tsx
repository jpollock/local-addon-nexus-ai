/**
 * WP-27 · the procedure surfaces in the Docked Panel — phase 1 of the ruled UX plan.
 * WP-35 · the COMPANION DENSITY, at the shipped 380px: the fold's ruled composite
 * (`docs/intelligence/from-designer/from-designer-05-companion-density-final.md`,
 * ratified whole by `for-designer-fold-response.md`).
 *
 * FOUR STATES, and which pin rules each:
 *
 *  - **Running.** The declared block, pinned to the top of the session by
 *    `PanelChat` — the procedure outranks the transcript, so it holds the top
 *    and the turns move beneath it (1a, XD-3 as geometry).
 *  - **Waiting on you.** An approval card is up, so the block yields to the
 *    card and renders as the DIGEST: every fact, a checkpoint window centred on
 *    the gate with its range stated, no inner scrollbar, the full declaration
 *    one promotion away. The block yields to the card, never the reverse
 *    (pin 1) — and the 200px floor it replaced was a fact about a sketch.
 *  - **Finished.** One row where the block was, still at the top; the record
 *    opens IN PLACE. The row is a handle, not a summary (pin 3).
 *  - **The empty run.** A plan of zero cells opens NO container (XD-21,
 *    pin 8): no block, no checkpoint list, the derived plan attached to the
 *    refusal turn instead.
 *
 * Three things render here, all of them from data `procedureView.ts` derived:
 *
 *  1. **The declared procedure**, on arm (§5b): named, versioned, marked strict,
 *     with every checkpoint listed BEFORE the run rather than confessed after it.
 *     That structure is the whole point — half-adherence becomes a visible gap in
 *     a list a human already read, instead of a sentence in a transcript.
 *  2. **The collapsing checklist** (RB-A2): an attested checkpoint folds to one
 *     line, a finished run folds to one row. The designer's budget for this band
 *     is about 540px, and eight expanded checkpoints do not fit in it.
 *  3. **The abort groups** (design inputs §2, owner's Q6): four honest groups,
 *     the counting lead line, and "Restore this site" as a LAUNCHER — never as a
 *     thing this panel does.
 *
 * WHAT THIS FILE MAY NOT DO, and each rule has a test:
 *
 *  - **Compute nothing.** Every number, every reason line, every headline arrived
 *    in an event. `procedureModel.ts` holds the copy rules; the derivations are
 *    the host's. A surface that did its own arithmetic would eventually disagree
 *    with the record, and the record is the product.
 *  - **Never tick a narrative checkpoint.** `showsTick` is the only source of a
 *    tick, and it refuses one even for an event that claims `verified: true` on a
 *    checkpoint the declaration says is narrative.
 *  - **Never render an absence as a zero.** A group the ledger cannot populate is
 *    NAMED with its reason; "0 skipped" is a claim, and nothing recorded it. Site
 *    outcomes carry no versions, so no version slot exists — a dash in one reads
 *    as "unchanged", which is a third thing again.
 *  - **Never render the canary policy as a control.** WP-26's approval card is
 *    that field's producer; offering a choice nothing records is fabricated
 *    consent. This surface does not show it at all.
 *
 * Controlled Vocabulary v1.1 governs every string: **runbook**, **marked strict**,
 * **checkpoints** (strict) / **steps** (guided), **attested** — never *verified*
 * of a checkpoint, which is the live check's word alone.
 *
 * React 16, class component, `React.createElement` — Local's renderer has no JSX
 * and no hooks.
 */
import React from 'react';
import { UI_COLORS } from '../../../common/constants';
import {
  ATTEST_WORDS,
  armedByPhrase,
  checkpointBadge,
  checkpointMark,
  checkpointWindow,
  denominatorLine,
  derivedPlanLine,
  foldsToOneLine,
  opensContainer,
  referenceLine,
  runIsFinished,
  showsTick,
  windowRangeLine,
  type CheckpointState,
  type DeclaredProcedure,
  type ProcedureAbortedEvent,
  type SiteOutcomeRow,
} from './procedureModel';

export interface ProcedureSurfacesProps {
  procedure: DeclaredProcedure | null;
  abort: ProcedureAbortedEvent | null;
  /**
   * WP-35 · an approval card is up (the fold, pin 1). The block yields to the
   * card, never the reverse: while a decision is pending the declaration
   * renders as the DIGEST. The panel owns this fact — it is the surface that
   * knows a card is on screen — and hands it down; nothing here goes looking.
   */
  approvalPending?: boolean;
  /**
   * The checkpoint the pending decision attests. The digest's window centres on
   * it. Absent ⇒ the active checkpoint stands in (`checkpointWindow`).
   */
  gateCheckpointId?: string | null;
}

interface State {
  /** A finished run folds to one row; this is the user opening it back up. */
  expanded: boolean;
  /** The digest promoted in place to the full declaration (WP-35's named interim). */
  promoted: boolean;
  /** The site whose restore launcher was pressed, and whose refusal path is showing. */
  restoreAsked: string | null;
}

const styles = {
  /**
   * The block, pinned to the top of the session (the fold's ruled composite,
   * 1a). `margin` and `padding` are WP-27's; the height bound is not
   * unconditional any more — see `bandStyle`.
   */
  band: {
    border: `1px solid var(--nxai-card-border)`,
    background: 'var(--nxai-section-bg)',
    borderRadius: 6,
    margin: '8px 10px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    fontSize: 12,
    color: 'var(--nxai-card-text)',
  },
  scroll: { maxHeight: 540, overflowY: 'auto' as const },
  head: { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'baseline', gap: 6 },
  /** The reference row. One home, one string — see `referenceLine`. */
  reference: {
    fontWeight: 600,
    color: 'var(--nxai-card-text)',
    borderLeft: `2px solid ${UI_COLORS.WPE_BRAND}`,
    paddingLeft: 8,
  },
  foldHandle: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    width: '100%',
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    textAlign: 'left' as const,
    font: 'inherit',
    color: 'var(--nxai-card-text)',
    cursor: 'pointer',
  },
  chevron: { color: 'var(--nxai-card-sub)', fontSize: 10 },
  meta: { color: 'var(--nxai-card-sub)', fontSize: 11 },
  strict: {
    color: UI_COLORS.WPE_BRAND,
    border: `1px solid ${UI_COLORS.WPE_BRAND}`,
    borderRadius: 3,
    fontSize: 10,
    padding: '0 4px',
  },
  denominator: { color: 'var(--nxai-card-sub)', fontSize: 11 },
  range: { color: 'var(--nxai-card-sub)', fontSize: 11 },
  /** The empty run: a turn's attachment, never a container. */
  planAttachment: {
    margin: '4px 0 0',
    paddingLeft: 8,
    borderLeft: `2px solid var(--nxai-card-border)`,
    color: 'var(--nxai-card-sub)',
    fontSize: 11,
    lineHeight: 1.5,
  },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 4, margin: 0, padding: 0, listStyle: 'none' },
  row: (folded: boolean) => ({
    display: 'flex',
    gap: 6,
    alignItems: 'flex-start' as const,
    padding: folded ? '1px 0' : '3px 0',
    lineHeight: 1.35,
  }),
  mark: { width: 12, flexShrink: 0, textAlign: 'center' as const },
  rowBody: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 },
  // Plain `monospace`, not a theme variable: `panel-theme.test.ts` pins every
  // `--nxai-*` the panel references to one the container actually injects, and
  // there is no mono variable. A var with a fallback would have rendered fine and
  // left a dangling reference behind it.
  cpId: { fontFamily: 'monospace', fontSize: 11 },
  /**
   * The step the run is standing on. TYPOGRAPHY, not a mark: the mark
   * vocabulary is three (WP-35, pin 9) and `active` is not one of the three, so
   * the row is emphasised rather than given a fourth glyph.
   */
  cpIdActive: { fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--nxai-card-text)' },
  sub: { color: 'var(--nxai-card-sub)', fontSize: 11 },
  badge: {
    color: 'var(--nxai-card-sub)',
    border: `1px solid var(--nxai-card-border)`,
    borderRadius: 3,
    fontSize: 10,
    padding: '0 4px',
    alignSelf: 'flex-start' as const,
  },
  section: { borderTop: `1px solid var(--nxai-card-border)`, paddingTop: 8, display: 'flex', flexDirection: 'column' as const, gap: 4 },
  sectionTitle: { fontWeight: 600, fontSize: 11 },
  headline: { fontWeight: 600 },
  absent: { color: 'var(--nxai-card-sub)', fontSize: 11, fontStyle: 'italic' as const },
  linkBtn: {
    background: 'none',
    border: `1px solid var(--nxai-card-border)`,
    borderRadius: 3,
    color: 'var(--nxai-card-text)',
    cursor: 'pointer',
    fontSize: 11,
    padding: '1px 6px',
  },
  disarm: { color: 'var(--nxai-warn-text)', fontSize: 11, lineHeight: 1.4 },
};

/** The launcher's own copy — about THIS surface's reach, not about the record. */
const RESTORE_REFUSAL =
  'No restore runbook is loaded, so this request would be refused. Restoring a site is a ' +
  'separate, gated action taken per site, under its own runbook — this panel launches it, ' +
  'it does not perform it.';

/**
 * Why no versions. Marked as an absence with its cause, per the v6 Q6 treatment:
 * a placeholder is honest, authored prose sitting where a derivation will live is not.
 */
const VERSIONS_ABSENT =
  'Versions are not shown: no producer records what version each site moved from or to, ' +
  'so a from-to pair here would be inferred rather than observed.';

export class ProcedureSurfaces extends React.Component<ProcedureSurfacesProps, State> {
  constructor(props: ProcedureSurfacesProps) {
    super(props);
    this.state = { expanded: false, promoted: false, restoreAsked: null };
    this.toggleExpanded = this.toggleExpanded.bind(this);
    this.togglePromoted = this.togglePromoted.bind(this);
  }

  toggleExpanded() {
    this.setState((s) => ({ expanded: !s.expanded }));
  }

  togglePromoted() {
    this.setState((s) => ({ promoted: !s.promoted }));
  }

  /**
   * Whether the declaration is rendering as the digest right now (the fold,
   * pin 1). A promotion suspends it — the user asked for the whole document,
   * and the block stops yielding for as long as she is reading it.
   */
  private isDigest(procedure: DeclaredProcedure): boolean {
    return !!this.props.approvalPending && !this.state.promoted && !runIsFinished(procedure);
  }

  askRestore(entityId: string) {
    this.setState((s) => ({ restoreAsked: s.restoreAsked === entityId ? null : entityId }));
  }

  // -------------------------------------------------------------------------
  // The declared procedure
  // -------------------------------------------------------------------------

  renderDisarm(procedure: DeclaredProcedure): React.ReactNode {
    const unavailable = procedure.unavailable!;
    // §7's second open question: a disarm is a platform-integrity event, not an
    // error the user caused. It reads as a disclosure, in the stale/divergence
    // register, and it shows no rail — ceremony for a procedure that is not in
    // force would be ceremony for nothing.
    return React.createElement(
      'div',
      { style: styles.section, 'data-procedure-disarmed': procedure.capability },
      React.createElement('div', { style: styles.sectionTitle }, `${procedure.capability} is not running under a runbook`),
      React.createElement('div', { style: styles.disarm }, unavailable.reason),
      unavailable.expectedHash
        ? React.createElement(
            'div',
            { style: styles.meta },
            `pinned ${unavailable.expectedHash} · on disk ${unavailable.actualHash ?? 'unreadable'}`,
          )
        : null,
    );
  }

  /**
   * One checkpoint row.
   *
   * `index` is the position in the DECLARED order, not in whatever slice is on
   * screen: the not-yet mark IS that number, and a windowed digest that
   * renumbered its three rows 1–3 would contradict the range line sitting
   * directly above them.
   *
   * `defer` is the companion's deferral (the fold, restatement 2, adopted with
   * the guard): explanation may fold behind the promotion, a fact may not. The
   * badge stays; the badge's REASON is explanation and goes. What comes back on
   * promotion is byte-identical to the undeferred rendering, because promotion
   * renders that rendering rather than a second wording of it.
   */
  renderCheckpoint(state: CheckpointState, index: number, defer = false): React.ReactNode {
    const folded = foldsToOneLine(state);
    const body: React.ReactNode[] = [
      React.createElement(
        'div',
        { key: 'id', style: state.status === 'active' ? styles.cpIdActive : styles.cpId },
        state.id,
      ),
    ];

    if (folded) {
      // One line: the id and what attested it. An attested checkpoint has nothing
      // left to ask of the reader.
      if (state.evidence?.summary) {
        body.push(React.createElement('div', { key: 'ev', style: styles.sub }, state.evidence.summary));
      }
    } else {
      body.push(
        React.createElement('div', { key: 'attest', style: styles.sub }, ATTEST_WORDS[state.attest]),
      );
      if (state.evidence?.summary && state.evidence.summary !== ATTEST_WORDS[state.attest]) {
        body.push(React.createElement('div', { key: 'ev', style: styles.sub }, state.evidence.summary));
      }
      // §5b: unasked-for steps are badged — and ONLY those (WP-28). The badge and
      // its reason line are one thing: `checkpointBadge` answers null for a step
      // the reviewed document did not mark, and a reason line under no badge
      // would be an explanation of a claim the surface is not making.
      const badge = checkpointBadge(state);
      if (badge) {
        body.push(React.createElement('span', { key: 'badge', style: styles.badge }, badge.label));
        if (badge.reason && !defer) {
          body.push(
            React.createElement(
              'div',
              { key: 'reason', style: styles.sub, 'data-badge-reason': state.id },
              badge.reason,
            ),
          );
        }
      }
    }

    return React.createElement(
      'li',
      {
        key: state.id,
        style: styles.row(folded),
        'data-checkpoint': state.id,
        'data-folded': folded,
        'data-ticked': showsTick(state),
        'data-status': state.status,
      },
      React.createElement('span', { style: styles.mark, 'aria-hidden': true }, checkpointMark(state, index)),
      React.createElement('div', { style: styles.rowBody }, ...body),
    );
  }

  /**
   * THE HEADER, and the runbook reference's one home (the fold, pin 4).
   *
   * When the run is finished the header IS the block: one row where the block
   * was, and the row is a handle rather than a summary — it opens the record in
   * place and carries nothing it would otherwise have to recount.
   */
  renderHeader(procedure: DeclaredProcedure, finished: boolean): React.ReactNode {
    const reference = React.createElement('span', { style: styles.reference }, referenceLine(procedure));
    const capability = React.createElement('span', { style: styles.meta }, procedure.capability);

    if (!finished) {
      return React.createElement('div', { key: 'head', style: styles.head }, reference, capability);
    }

    return React.createElement(
      'button',
      {
        key: 'head',
        type: 'button',
        style: styles.foldHandle,
        onClick: this.toggleExpanded,
        'aria-expanded': this.state.expanded,
        'data-run-folded': !this.state.expanded,
      },
      reference,
      capability,
      React.createElement('span', { style: styles.chevron, 'aria-hidden': true }, this.state.expanded ? '▾' : '▸'),
    );
  }

  /**
   * The declaration's body, undeferred: why the ceremony appeared, the honest
   * denominator, every checkpoint, and what the procedure requires her to be
   * told. This is also exactly what a promotion reveals — one rendering, so
   * folding can never become rewording.
   */
  renderFullBody(procedure: DeclaredProcedure): React.ReactNode[] {
    const children: React.ReactNode[] = [];
    const armed = armedByPhrase(procedure.armedBy);
    const denominator = denominatorLine(procedure);

    if (armed) children.push(React.createElement('div', { key: 'armed', style: styles.meta }, armed));
    if (denominator) {
      children.push(React.createElement('div', { key: 'denominator', style: styles.denominator }, denominator));
    }

    children.push(
      React.createElement(
        'ul',
        { key: 'rail', style: styles.list },
        ...procedure.checkpoints.map((c, i) => this.renderCheckpoint(c, i)),
      ),
    );

    if (procedure.communication.length > 0) {
      children.push(
        React.createElement(
          'div',
          { key: 'communication', style: styles.section, 'data-communication': procedure.runbookId ?? procedure.capability },
          React.createElement('div', { style: styles.sectionTitle }, 'the procedure requires you to be told:'),
          // Strings, never checkpoints: the platform cannot prove the model said
          // something, so nothing here is ever marked, ticked, or counted.
          ...procedure.communication.map((line, i) =>
            React.createElement('div', { key: `c${i}`, style: styles.sub }, line),
          ),
        ),
      );
    }

    return children;
  }

  /**
   * THE DIGEST (the fold, pins 1 and 2; the number 200 struck at the fold
   * response §2).
   *
   * Every fact — the reference above, the provable denominator, the marks, the
   * attest words in full — and a window of the checkpoint list centred on the
   * gate WITH ITS RANGE STATED, because a window that does not declare itself
   * is a truncation pretending to be the whole. No inner scrollbar: the block
   * is sized to what the card leaves rather than scrolled inside a box that
   * fits nothing.
   */
  renderDigestBody(procedure: DeclaredProcedure): React.ReactNode[] {
    const children: React.ReactNode[] = [];
    const denominator = denominatorLine(procedure);
    if (denominator) {
      children.push(React.createElement('div', { key: 'denominator', style: styles.denominator }, denominator));
    }

    const window = checkpointWindow(procedure, this.props.gateCheckpointId);
    if (window) {
      const range = windowRangeLine(procedure, window);
      if (range) children.push(React.createElement('div', { key: 'range', style: styles.range }, range));
      children.push(
        React.createElement(
          'ul',
          { key: 'rail', style: styles.list },
          ...window.states.map((c, i) => this.renderCheckpoint(c, window.offset + i, true)),
        ),
      );
    }

    return children;
  }

  renderDeclared(procedure: DeclaredProcedure): React.ReactNode {
    if (procedure.unavailable) return this.renderDisarm(procedure);

    const finished = runIsFinished(procedure);
    const digest = this.isDigest(procedure);
    const children: React.ReactNode[] = [this.renderHeader(procedure, finished)];

    if (finished) {
      // Folded in place: one row, and the record opens beneath the same row
      // rather than anywhere else. What she read before the run is what she
      // reopens after it.
      if (this.state.expanded) children.push(...this.renderFullBody(procedure));
    } else if (digest) {
      children.push(...this.renderDigestBody(procedure));
      children.push(
        React.createElement(
          'button',
          {
            key: 'promote',
            type: 'button',
            style: styles.linkBtn,
            onClick: this.togglePromoted,
            'data-procedure-promote': procedure.runbookId ?? procedure.capability,
          },
          'Show the full declaration',
        ),
      );
    } else {
      children.push(...this.renderFullBody(procedure));
      if (this.props.approvalPending) {
        // Promoted while the decision is still pending: the way back to the
        // digest is the same handle, because a promotion you cannot leave is
        // the run-mode bar the fold refused.
        children.push(
          React.createElement(
            'button',
            {
              key: 'promote',
              type: 'button',
              style: styles.linkBtn,
              onClick: this.togglePromoted,
              'data-procedure-promote': procedure.runbookId ?? procedure.capability,
            },
            'Fold the declaration back',
          ),
        );
      }
    }

    return React.createElement('div', { 'data-procedure': procedure.capability }, ...children);
  }

  /**
   * XD-21 · the empty run. A plan of zero cells opens NO container: no block,
   * no checkpoint list. The refusal stays a turn and the derived plan attaches
   * to it verbatim, so the reason is inspectable rather than asserted.
   */
  renderPlanAttachment(procedure: DeclaredProcedure): React.ReactNode {
    const plan = derivedPlanLine(procedure);
    if (!plan) return null;
    return React.createElement(
      'div',
      { style: styles.planAttachment, 'data-procedure-plan': procedure.capability },
      plan,
    );
  }

  // -------------------------------------------------------------------------
  // The abort groups
  // -------------------------------------------------------------------------

  renderOutcomeRow(row: SiteOutcomeRow): React.ReactNode {
    // The entity id, as stamped. Rendering a NAME is the caller's job and this
    // surface has no name source; a guessed name on an abort report is worse than
    // an opaque id.
    const restorable = !!row.backupEventId && row.result === 'updated';
    return React.createElement(
      'li',
      { key: row.entityId, style: styles.row(true), 'data-site-outcome': row.entityId },
      React.createElement('div', { style: styles.rowBody },
        React.createElement('div', { style: styles.cpId }, row.entityId),
        React.createElement(
          'div',
          { style: styles.sub },
          [row.result, row.observedAt, row.backupEventId ? `backup ${row.backupEventId}` : null]
            .filter(Boolean)
            .join(' · '),
        ),
        restorable
          ? React.createElement(
              'button',
              {
                style: styles.linkBtn,
                'data-restore': row.entityId,
                onClick: () => this.askRestore(row.entityId),
              },
              'Restore this site',
            )
          : null,
        restorable && this.state.restoreAsked === row.entityId
          ? React.createElement('div', { style: styles.absent, 'data-restore-refusal': row.entityId }, RESTORE_REFUSAL)
          : null,
      ),
    );
  }

  renderGroup(
    group: 'done' | 'failed' | 'skipped' | 'untouched',
    title: string,
    rows: SiteOutcomeRow[],
    unavailableReason: string | undefined,
  ): React.ReactNode {
    // A group the ledger cannot populate is NAMED with its reason. Rendering it
    // as an empty list would say "nothing was skipped", which is a claim nothing
    // recorded — and it is the difference this whole panel exists to keep.
    return React.createElement(
      'div',
      { key: group, style: styles.section, 'data-abort-group': group },
      React.createElement('div', { style: styles.sectionTitle }, title),
      unavailableReason
        ? React.createElement('div', { style: styles.absent }, unavailableReason)
        : React.createElement('ul', { style: styles.list }, ...rows.map((r) => this.renderOutcomeRow(r))),
    );
  }

  renderAbort(abort: ProcedureAbortedEvent): React.ReactNode {
    const groups = abort.groups;
    const reasonFor = (g: 'skipped' | 'untouched') =>
      groups.unavailable.find((u) => u.group === g)?.reason;

    return React.createElement(
      'div',
      { style: styles.section, 'data-abort': abort.abortId },
      // The lead line is derived from the counts by the platform and rendered
      // verbatim. A second count authored beside it is how two numbers on one
      // screen start disagreeing.
      React.createElement('div', { style: styles.headline }, groups.headline),
      React.createElement('div', { style: styles.sub }, `stopped at ${abort.checkpointId} — ${abort.reason}`),
      this.renderGroup('done', 'Done, standing', groups.done, undefined),
      this.renderGroup('failed', 'Where it stopped', groups.failed, undefined),
      this.renderGroup('skipped', 'Skipped', groups.skipped, reasonFor('skipped')),
      this.renderGroup('untouched', 'Untouched', groups.untouched, reasonFor('untouched')),
      React.createElement('div', { style: styles.absent }, VERSIONS_ABSENT),
      React.createElement('div', { style: styles.sub }, abort.restore.note),
    );
  }

  /**
   * The height bound, and the one state that does not take it.
   *
   * WP-27's band scrolls at 540px. The digest must not: "every fact, a stated
   * window centred on the gate, NO INNER SCROLLBAR" is the rule that replaced
   * the 200px floor, and a scrollbar is how a block that cannot fit pretends it
   * did. Everywhere else the bound is unchanged.
   */
  private bandStyle(procedure: DeclaredProcedure | null): React.CSSProperties {
    if (procedure && this.isDigest(procedure)) return styles.band;
    return { ...styles.band, ...styles.scroll };
  }

  render() {
    const { procedure, abort } = this.props;
    // Nothing armed ⇒ nothing rendered, and the panel is exactly what it was.
    if (!procedure && !abort) return null;

    // XD-21 — no consequence, no rank, no container. Before the section, because
    // the section IS the container.
    if (procedure && !abort && !opensContainer(procedure)) return this.renderPlanAttachment(procedure);

    return React.createElement(
      'section',
      { style: this.bandStyle(procedure), 'aria-label': 'Procedure' },
      procedure ? this.renderDeclared(procedure) : null,
      abort ? this.renderAbort(abort) : null,
    );
  }
}
