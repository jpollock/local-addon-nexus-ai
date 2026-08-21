/**
 * WP-46 · THE RE-ENTRY (M6 · XD-26 §6b, §6c) — the run is where it stopped.
 *
 * Opening a waiting row PROMOTES the session it belongs to: same session id,
 * same cursor, same pending approvals. This component is where that promotion
 * lands, and it is deliberately incapable of losing any of the three — it holds
 * no copy of them. It is handed the `SessionRow` the registry folded and renders
 * that row's own fields: `id`, `gate.checkpointId`, `approvals`, `checkpoints`.
 *
 * THE MARKS COME FROM THE SHIPPED DENSITIES' OWN FUNCTIONS. `checkpointMark`,
 * `showsTick`, `ATTEST_WORDS`, `checkpointBadge`, `referenceLine` and
 * `denominatorLine` are imported from `DockedPanel/procedureModel` — the module
 * the companion and the stage render from. XD-26 says a difference between the
 * densities and this sheet would be a defect in one of them, so there is one
 * implementation and this sheet calls it. A local mark table here would be that
 * defect written on purpose, and `returnMarksIdentity.test.ts` pins the absence.
 *
 * THE MARKS COME FROM THE RECORD, NOT FROM THE CURSOR'S POSITION. `SessionRow.
 * checkpoints` is `CheckpointState[]` from `deriveCheckpointStates` — which
 * checkpoints were ATTESTED before the excursion — so a tick means attested-and-
 * provable, a reached narrative step takes the neutral dot, and the cursor takes
 * its numeral. A position cannot tell those apart, which is the whole reason the
 * query contract carries the set.
 *
 * §6c · WHEN THE ARM CANNOT BE ESTABLISHED. The platform names ITS OWN LIMIT.
 * The four strings are the designer's, extracted rather than retyped. The label
 * XD-26 forbids — the one that would name a procedure state the platform does
 * not have — appears nowhere in this tree OR IN THIS DIRECTORY'S SOURCE, and
 * `returnReEntry.test.ts` pins the absence by reading the files. It is spelled
 * out only in the test that forbids it, which is the one place it can be
 * written without being a label.
 *
 * WHAT IS ABSENT, ON PURPOSE, AND PINNED:
 *
 *  - No scrollback. The session's turns are not re-rendered here; a transcript
 *    is what the session said, not where you are needed.
 *  - No everything-since-you-left prose. Every line is a field of the row.
 *  - No second approval. A standing approval renders as standing, with the
 *    moment it was given, in its own block ABOVE the gate.
 *  - No resume button and no confirm-you-are-back. Nothing here re-arms
 *    anything; the gate card renders the gate, and acting on it is the shipped
 *    approval card's job, through the channels it already has.
 *
 * React 16, class component, `React.createElement` — no JSX, no hooks.
 */
import React from 'react';
import type { PendingApproval, SessionRow } from '../../../main/intelligence-host/sessionRegistry';
import type { CheckpointState } from '../../../main/intelligence-host/procedureView';
import {
  ATTEST_WORDS,
  checkpointBadge,
  checkpointMark,
  denominatorLine,
  referenceLine,
} from '../DockedPanel/procedureModel';
import { RETURN_COPY, SEP } from './returnCopy.generated';
import { COLOURS, DOORS } from '../../../main/intelligence-host/situationCopy.generated';
import {
  armUnestablished,
  cursorCheckpointId,
  declaredFromSession,
  standingApprovalSentence,
  standingApprovals,
} from './arrivalModel';

export interface SessionReEntryProps {
  /** The row the promotion carried. `null` is §6c's second shape. */
  session: SessionRow | null;
  /** §6c's first door — the run is intact in the record. */
  onFindInRecord?: (session: SessionRow | null) => void;
  /** §6c's offer. A NEW run, never a re-arm of this one. */
  onStartNewRun?: (session: SessionRow | null) => void;
  /**
   * WP-54 · ITEM 6 — THE WAY BACK TO NOW.
   *
   * The two doors above are §6c's, and §6c is the case where the platform
   * cannot establish the arm. An ESTABLISHED arm — the ordinary case, the one a
   * row's door lands on — had no control that returned anywhere, so "Open where
   * you are needed" led to a page of links a person could not leave. That is the
   * missing-front-door defect one screen deeper, and it is the same finding the
   * owner raised about the strip: the way back must be marked.
   *
   * Optional, because a caller that renders this sheet without a Now to return
   * to should render no door rather than a dead one.
   */
  onBackToNow?: () => void;
}

const styles = {
  surface: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
  title: { fontSize: 15, fontWeight: 600, color: 'var(--nxai-card-text)', margin: 0 },
  opened: { fontSize: 11, color: 'var(--nxai-muted-text)', margin: '2px 0 0' },
  resumed: { fontSize: 11, fontStyle: 'italic' as const, color: 'var(--nxai-muted-text)', margin: '2px 0 0' },
  block: {
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 4,
    padding: '10px 12px',
  },
  blockHead: {
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    color: 'var(--nxai-muted-text)',
    marginBottom: 6,
  },
  reference: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: 'var(--nxai-muted-text)' },
  cpRow: { display: 'grid', gridTemplateColumns: '20px 1fr', gap: 8, padding: '4px 0', fontSize: 11, alignItems: 'start' as const },
  cpRowActive: { fontWeight: 600 },
  mark: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textAlign: 'center' as const },
  cpId: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10 },
  sub: { fontSize: 10, color: 'var(--nxai-muted-text)' },
  badge: { fontSize: 9, color: 'var(--nxai-muted-text)', border: '1px solid var(--nxai-card-border)', borderRadius: 3, padding: '0 4px', marginLeft: 6 },
  denominator: { fontSize: 10, color: 'var(--nxai-muted-text)', marginTop: 6, borderTop: '1px solid var(--nxai-card-border)', paddingTop: 6 },
  standing: { fontSize: 11, lineHeight: 1.6, color: 'var(--nxai-card-text)' },
  unknownLead: { fontSize: 14, fontWeight: 600, color: 'var(--nxai-card-text)', margin: 0 },
  unknownBody: { fontSize: 11, lineHeight: 1.6, color: 'var(--nxai-card-text)', margin: '8px 0 0' },
  doors: { display: 'flex', gap: 14, marginTop: 10 },
  door: {
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    fontWeight: 600,
    // WP-54 · ITEM 6 — link blue, for the same reason it is link blue on the
    // Now row: a door is a link, and brand green is the product's mark.
    color: COLOURS.link,
    cursor: 'pointer',
  },
};

export class SessionReEntry extends React.Component<SessionReEntryProps> {
  /**
   * §6c — the platform cannot establish the arm.
   *
   * Four ratified strings, in the platform's own voice. Nothing is armed, no
   * write can be made under this session, and the run is intact in the record —
   * which is what the body says and what the doors offer.
   */
  private renderUnknownArm(): React.ReactElement {
    const { session, onFindInRecord, onStartNewRun } = this.props;
    return React.createElement(
      'section',
      { style: styles.surface, 'data-surface': 'return-reentry', 'data-arm': 'unestablished' },
      React.createElement('h2', { key: 'lead', style: styles.unknownLead }, RETURN_COPY.UNKNOWN_ARM_LEAD),
      React.createElement('p', { key: 'body', style: styles.unknownBody }, RETURN_COPY.UNKNOWN_ARM_BODY),
      React.createElement(
        'div',
        { key: 'doors', style: styles.doors },
        React.createElement(
          'button',
          { key: 'record', style: styles.door, 'data-door': 'find-in-record', onClick: () => onFindInRecord && onFindInRecord(session) },
          RETURN_COPY.UNKNOWN_ARM_DOOR,
        ),
        React.createElement(
          'button',
          { key: 'new', style: styles.door, 'data-door': 'start-new-run', onClick: () => onStartNewRun && onStartNewRun(session) },
          RETURN_COPY.UNKNOWN_ARM_OFFER,
        ),
      ),
    );
  }

  /** One declared checkpoint. Mark, id, the document's attest words, evidence. */
  private renderCheckpoint(state: CheckpointState, index: number, cursorId: string | null): React.ReactElement {
    const badge = checkpointBadge(state);
    const isCursor = cursorId !== null && state.id === cursorId;
    return React.createElement(
      'div',
      {
        key: state.id,
        style: isCursor ? { ...styles.cpRow, ...styles.cpRowActive } : styles.cpRow,
        'data-checkpoint': state.id,
        'data-status': state.status,
      },
      React.createElement('span', { key: 'mark', style: styles.mark, 'data-mark': 'true' }, checkpointMark(state, index)),
      React.createElement(
        'span',
        { key: 'body' },
        React.createElement('span', { key: 'id', style: styles.cpId }, state.id),
        ...(badge ? [React.createElement('span', { key: 'badge', style: styles.badge }, badge.label)] : []),
        React.createElement('div', { key: 'attest', style: styles.sub }, ATTEST_WORDS[state.attest]),
        ...(state.evidence?.summary
          ? [React.createElement('div', { key: 'evidence', style: styles.sub }, state.evidence.summary)]
          : []),
      ),
    );
  }

  /**
   * The standing approval, as its own block ABOVE the gate.
   *
   * The sentence is written from `PendingApproval` alone — checkpoint id and the
   * moment the human decided. That is XD-26's second contract requirement, and
   * it is why the contract carries a SET rather than a boolean.
   */
  private renderStanding(approvals: PendingApproval[]): React.ReactElement | null {
    if (approvals.length === 0) return null;
    return React.createElement(
      'div',
      { key: 'standing', style: styles.block, 'data-standing': 'true' },
      React.createElement('div', { key: 'head', style: styles.blockHead }, RETURN_COPY.REENTRY_STANDING_HEAD),
      ...approvals.map((a) =>
        React.createElement(
          'div',
          { key: a.checkpointId, style: styles.standing, 'data-standing-checkpoint': a.checkpointId },
          React.createElement('div', { key: 'id', style: styles.cpId }, `${a.checkpointId}${SEP}${a.decidedAt ?? ''}`),
          React.createElement('div', { key: 'sentence' }, standingApprovalSentence(a) ?? ''),
        ),
      ),
    );
  }

  /** The gate card, at the cursor, with the document's own attest words. */
  private renderGate(row: SessionRow, cursorId: string | null): React.ReactElement | null {
    if (!row.gate || cursorId === null) return null;
    const state = (row.checkpoints ?? []).find((c) => c.id === cursorId);
    return React.createElement(
      'div',
      { key: 'gate', style: styles.block, 'data-gate': cursorId },
      React.createElement('div', { key: 'head', style: styles.blockHead }, RETURN_COPY.REENTRY_GATE_HEAD),
      React.createElement('div', { key: 'id', style: styles.cpId }, cursorId),
      ...(state
        ? [React.createElement('div', { key: 'attest', style: styles.sub, 'data-attest': state.attest }, ATTEST_WORDS[state.attest])]
        : []),
      ...(state?.evidence?.summary
        ? [React.createElement('div', { key: 'evidence', style: styles.sub }, state.evidence.summary)]
        : []),
    );
  }

  render(): React.ReactElement {
    const row = this.props.session;
    if (armUnestablished(row)) return this.renderUnknownArm();

    // `armUnestablished` returns true for null, so the row is non-null here.
    const session = row as SessionRow;
    const declared = declaredFromSession(session);
    const cursorId = cursorCheckpointId(session);

    return React.createElement(
      'section',
      { style: styles.surface, 'data-surface': 'return-reentry', 'data-session': session.id, 'data-arm': 'established' },

      // WP-54 item 6: the way back, first, where a way back belongs.
      ...(this.props.onBackToNow
        ? [React.createElement(
            'button',
            { key: 'back', style: styles.door, 'data-door': 'back-to-now', onClick: this.props.onBackToNow },
            DOORS.backToNow,
          )]
        : []),

      React.createElement(
        'header',
        { key: 'header' },
        React.createElement('h2', { style: styles.title }, session.runbookId ?? session.capability),
        React.createElement('p', { style: styles.opened }, `${RETURN_COPY.OPENED_PREFIX}${session.startedAt}`),
        React.createElement('p', { style: styles.resumed, 'data-resumed': 'true' }, RETURN_COPY.RESUMED),
      ),

      React.createElement(
        'div',
        { key: 'declared', style: styles.block, 'data-declared': 'true' },
        React.createElement('div', { key: 'reference', style: styles.reference }, referenceLine(declared)),
        ...declared.checkpoints.map((c, i) => this.renderCheckpoint(c, i, cursorId)),
        ...(denominatorLine(declared)
          ? [React.createElement('div', { key: 'denominator', style: styles.denominator, 'data-denominator': 'true' }, denominatorLine(declared) as string)]
          : []),
      ),

      this.renderStanding(standingApprovals(session)),
      this.renderGate(session, cursorId),
    );
  }
}
