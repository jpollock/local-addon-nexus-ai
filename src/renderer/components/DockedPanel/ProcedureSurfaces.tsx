/**
 * WP-27 · the procedure surfaces in the Docked Panel — phase 1 of the ruled UX plan.
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
  denominatorLine,
  foldsToOneLine,
  runIsFinished,
  showsTick,
  stepNoun,
  type CheckpointState,
  type DeclaredProcedure,
  type ProcedureAbortedEvent,
  type SiteOutcomeRow,
} from './procedureModel';

export interface ProcedureSurfacesProps {
  procedure: DeclaredProcedure | null;
  abort: ProcedureAbortedEvent | null;
}

interface State {
  /** A finished run folds to one row; this is the user opening it back up. */
  expanded: boolean;
  /** The site whose restore launcher was pressed, and whose refusal path is showing. */
  restoreAsked: string | null;
}

const styles = {
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
    maxHeight: 540,
    overflowY: 'auto' as const,
  },
  head: { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'baseline', gap: 6 },
  runbookId: { fontWeight: 600, color: 'var(--nxai-card-text)' },
  meta: { color: 'var(--nxai-card-sub)', fontSize: 11 },
  strict: {
    color: UI_COLORS.WPE_BRAND,
    border: `1px solid ${UI_COLORS.WPE_BRAND}`,
    borderRadius: 3,
    fontSize: 10,
    padding: '0 4px',
  },
  denominator: { color: 'var(--nxai-card-sub)', fontSize: 11 },
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
    this.state = { expanded: false, restoreAsked: null };
    this.toggleExpanded = this.toggleExpanded.bind(this);
  }

  toggleExpanded() {
    this.setState((s) => ({ expanded: !s.expanded }));
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

  renderCheckpoint(state: CheckpointState): React.ReactNode {
    const folded = foldsToOneLine(state);
    const body: React.ReactNode[] = [
      React.createElement(
        'div',
        { key: 'id', style: styles.cpId },
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
        if (badge.reason) {
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
      },
      React.createElement('span', { style: styles.mark, 'aria-hidden': true }, checkpointMark(state)),
      React.createElement('div', { style: styles.rowBody }, ...body),
    );
  }

  renderDeclared(procedure: DeclaredProcedure): React.ReactNode {
    if (procedure.unavailable) return this.renderDisarm(procedure);

    const finished = runIsFinished(procedure);
    const showRail = !finished || this.state.expanded;
    const noun = stepNoun(procedure.strictness);
    const armed = armedByPhrase(procedure.armedBy);
    const denominator = denominatorLine(procedure);

    const head = React.createElement(
      'div',
      { style: styles.head },
      React.createElement('span', { style: styles.runbookId }, procedure.runbookId ?? procedure.capability),
      procedure.version ? React.createElement('span', { style: styles.meta }, `v${procedure.version}`) : null,
      procedure.strictness === 'strict'
        ? React.createElement('span', { style: styles.strict }, 'marked strict')
        : null,
      React.createElement('span', { style: styles.meta }, procedure.capability),
    );

    const children: React.ReactNode[] = [head];
    if (armed) children.push(React.createElement('div', { key: 'armed', style: styles.meta }, armed));
    if (denominator) {
      children.push(React.createElement('div', { key: 'denominator', style: styles.denominator }, denominator));
    }

    if (showRail) {
      children.push(
        React.createElement(
          'ul',
          { key: 'rail', style: styles.list },
          ...procedure.checkpoints.map((c) => this.renderCheckpoint(c)),
        ),
      );
    }

    if (finished) {
      children.push(
        React.createElement(
          'button',
          { key: 'toggle', style: styles.linkBtn, onClick: this.toggleExpanded },
          this.state.expanded
            ? `Hide the ${noun}s`
            : `Show all ${procedure.checkpoints.length} ${noun}s`,
        ),
      );
    }

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

    return React.createElement('div', { 'data-procedure': procedure.capability }, ...children);
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

  render() {
    const { procedure, abort } = this.props;
    // Nothing armed ⇒ nothing rendered, and the panel is exactly what it was.
    if (!procedure && !abort) return null;

    return React.createElement(
      'section',
      { style: styles.band, 'aria-label': 'Procedure' },
      procedure ? this.renderDeclared(procedure) : null,
      abort ? this.renderAbort(abort) : null,
    );
  }
}
