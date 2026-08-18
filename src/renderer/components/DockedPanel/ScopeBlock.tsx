/**
 * WP-32 · THE SCOPE BLOCK — one component, three surfaces, one text.
 *
 * XD-15's pin is byte-identity: the block's rendered text is the same in the
 * selection bar, the companion declaration and the stage document. The way to
 * pass a byte-identity pin is not to render carefully three times — it is to
 * have one renderer, which is what this component is. `surface` chooses the
 * FRAME (how much chrome sits around the lines); it never touches the lines.
 *
 * XD-20 says the same thing from the density side: density changes rendering,
 * never facts. So there is no density prop at all. A prop is a place for two
 * surfaces to differ, and the one thing this block may not do is differ.
 *
 * COMPUTES NOTHING. Every line arrives from `scopeBlockLines`, which is the
 * renderer's pinned mirror of the seam's own function. If a count, a place set,
 * a reason or a from-line ever needs to change, it changes in
 * `procedureScope.ts` and arrives here — this file has no arithmetic and no
 * string-building of its own beyond joining what it was given.
 *
 * THE DOOR IS A LAUNCHER, NEVER AN ACTION. The barred group renders the
 * structured `governDoor` and hands it to `onGovern`; this panel does not grant
 * anything. XD-8: consent that must be recorded is made at a control, never
 * elicited in chat — and a grant made from inside the block that is refusing
 * would be exactly that.
 *
 * XD-21 · a scope that opens no run gets no run container. The block still
 * renders — the refusal is a turn WITH the derived plan attached — but the
 * caller reads `scope.opensRun` to decide whether to draw a checkpoint list
 * beside it, and this component never draws one.
 *
 * React 16, class component, `React.createElement` — Local's renderer has no JSX
 * and no hooks.
 */
import React from 'react';
import { UI_COLORS } from '../../../common/constants';
import {
  ProcedureScope,
  ScopeBlockSurface,
  scopeBlockLines,
} from './scopeModel';
import type { GovernDoorTarget } from '../../../main/intelligence-host/sequenceGuard';

export interface ScopeBlockProps {
  scope: ProcedureScope;
  /** Which frame to draw. Never changes a single character of the lines. */
  surface: ScopeBlockSurface;
  /** Launcher for the barred group's door. Absent ⇒ the door renders as text only. */
  onGovern?: (door: GovernDoorTarget) => void;
}

const styles = {
  block: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--nxai-card-text)',
  },
  bar: {
    border: `1px solid var(--nxai-card-border)`,
    background: 'var(--nxai-section-bg)',
    borderRadius: 4,
    padding: '6px 8px',
  },
  head: {
    borderLeft: `2px solid ${UI_COLORS.WPE_BRAND}`,
    paddingLeft: 8,
  },
  line: { whiteSpace: 'pre-wrap' as const },
  door: {
    alignSelf: 'flex-start' as const,
    marginTop: 4,
    background: 'transparent',
    border: `1px solid ${UI_COLORS.WPE_BRAND}`,
    color: UI_COLORS.WPE_BRAND,
    borderRadius: 3,
    fontSize: 10,
    padding: '1px 6px',
    cursor: 'pointer',
  },
};

/** The frame, and only the frame. The lines are identical under all three. */
function frameStyle(surface: ScopeBlockSurface): React.CSSProperties {
  if (surface === 'selection-bar') return { ...styles.block, ...styles.bar };
  if (surface === 'stage-head') return { ...styles.block, ...styles.head };
  return styles.block;
}

export class ScopeBlock extends React.Component<ScopeBlockProps> {
  private renderDoor(): React.ReactNode {
    const { scope, onGovern } = this.props;
    // One door per distinct grant. Today a scope is split against exactly one
    // runbook, so this is one button — written as a set anyway, because a
    // "the first barred cell's door" shortcut would silently pick a winner the
    // day a scope spans two capabilities.
    const doors = scope.barred.reduce<GovernDoorTarget[]>((acc, cell) => {
      const seen = acc.some(
        (d) => d.capability === cell.governDoor.capability && d.runbookId === cell.governDoor.runbookId
      );
      return seen ? acc : [...acc, cell.governDoor];
    }, []);

    return doors.map((door, i) =>
      React.createElement(
        'button',
        {
          key: `door${i}`,
          type: 'button',
          style: styles.door,
          disabled: !onGovern,
          'data-govern-capability': door.capability,
          'data-govern-runbook': door.runbookId,
          onClick: onGovern ? () => onGovern(door) : undefined,
        },
        `Govern ${door.capability}`
      )
    );
  }

  render(): React.ReactNode {
    const { scope, surface } = this.props;
    const lines = scopeBlockLines(scope);

    return React.createElement(
      'div',
      {
        style: frameStyle(surface),
        'data-scope-surface': surface,
        'data-scope-opens-run': String(scope.opensRun),
        'aria-label': 'Scope',
      },
      ...lines.map((line, i) =>
        React.createElement('div', { key: `l${i}`, style: styles.line }, line)
      ),
      ...(scope.barred.length ? [this.renderDoor()] : [])
    );
  }
}
