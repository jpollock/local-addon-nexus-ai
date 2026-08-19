/**
 * WP-41 · the comparator, wired — IPC in, selection out, arming at the end.
 *
 * `SiteAtPlaces` draws a matrix and holds nothing; this container owns the four
 * channels and the selection state, so the surface stays a pure function of what
 * it was handed and can be rendered in a test without a main process.
 *
 * THE WALK, in the order it happens:
 *
 *   1. `COMPARATOR_FACTS`  — which comparisons this machine can draw at all,
 *                            derived from the twins rather than from a menu.
 *   2. `COMPARATOR_MATRIX` — the render for the chosen fact.
 *   3. a click               — `toggleCell`, held here as cell keys.
 *   4. `COMPARATOR_PREVIEW_SCOPE` — the split, host-side, on every change. What
 *                            the selection bar's `ScopeBlock` renders.
 *   5. `COMPARATOR_ARM_SELECTION` — the same split, recorded on the carrier.
 *                            `deriveScope`'s first production caller, one layer
 *                            down, and the only side effect on this surface.
 *
 * **Step 4 and step 5 derive through the SAME function** (`armFromSelection`
 * calls `previewScope`), so the block a user approved and the scope that arms
 * cannot be two derivations that merely agree. That is this packet's own rule
 * turned on itself.
 *
 * WHAT ARMING DOES AND DELIBERATELY DOES NOT DO. It records the request on the
 * arming queue and stops. It does not send a turn, compose a message, or put
 * words in the user's mouth — the queue is drained by whatever turn comes next,
 * which is R7's carrier and not this surface's business. A comparator that
 * auto-sent a message would be authoring the ask, and the ask is the user's.
 *
 * INTERIM: everything about how this is entered and dismissed. The ratified
 * material is the matrix, the marks, the block and the walk; the disclosure that
 * opens it, the fact picker's shape and the placement in the panel are this
 * packet's own and are named INTERIM at the gate for the designer's cycle-four
 * family to replace.
 *
 * React 16, class component, `React.createElement` — no JSX, no hooks.
 */
import React from 'react';
import { IPC_CHANNELS, UI_COLORS } from '../../../common/constants';
import { SiteAtPlaces } from './SiteAtPlaces';
import { buildSelection, toggleCell } from './comparatorModel';
import type { MatrixCell, SiteAtPlacesMatrix } from './comparatorModel';
import type { ProcedureScope } from './scopeModel';
import type { GovernDoorTarget } from '../../../main/intelligence-host/sequenceGuard';

export interface ComparableFact {
  fact: string;
  label: string;
  places: number;
}

export interface ComparatorPanelProps {
  electron: {
    ipcRenderer: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  };
  /**
   * The capability a selection would arm. The comparator does not choose it —
   * a surface picking which procedure governs an act would be authoring the
   * governance, so it is handed in.
   */
  capability: string;
  /**
   * The comparisons this machine can draw, fetched by the PANEL rather than
   * here — see `PanelChat`'s own note. Never empty: a caller with nothing to
   * compare renders no comparator at all, so this component never has to draw
   * an empty state, and the panel never grows chrome for a user it cannot serve.
   */
  facts: readonly ComparableFact[];
  onGovern?: (door: GovernDoorTarget) => void;
  /** Told when an arming is recorded, so the panel can say what happens next. */
  onArmed?: (scope: ProcedureScope) => void;
}

interface State {
  fact: string | null;
  matrix: SiteAtPlacesMatrix | null;
  selected: string[];
  scope: ProcedureScope | null;
  /** Set once an arming has been recorded for the current selection. */
  armed: boolean;
  loading: boolean;
}

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    padding: '8px 10px',
    borderTop: `1px solid var(--nxai-card-border)`,
  },
  picker: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  factBtn: (active: boolean) => ({
    background: active ? UI_COLORS.WPE_BRAND : 'transparent',
    color: active ? UI_COLORS.NEXUS_MARK : 'var(--nxai-card-sub)',
    border: `1px solid ${active ? UI_COLORS.WPE_BRAND : 'var(--nxai-card-border)'}`,
    borderRadius: 3,
    fontSize: 10,
    padding: '2px 6px',
    cursor: 'pointer',
  }),
  note: { color: 'var(--nxai-card-sub)', fontSize: 10 },
};

export class ComparatorPanel extends React.Component<ComparatorPanelProps, State> {
  private live = true;

  constructor(props: ComparatorPanelProps) {
    super(props);
    this.state = {
      fact: null,
      matrix: null,
      selected: [],
      scope: null,
      armed: false,
      loading: false,
    };
    this.handleToggle = this.handleToggle.bind(this);
    this.handleArm = this.handleArm.bind(this);
  }

  componentDidMount(): void {
    // The first comparison is OPENED, not merely offered: J-Inspect's first key
    // step is that the shape is on screen before any prose about it, and a
    // picker with nothing drawn beneath it is a prose surface.
    if (this.props.facts.length) this.openFact(this.props.facts[0].fact);
  }

  componentWillUnmount(): void {
    this.live = false;
  }

  private invoke<T>(channel: string, ...args: unknown[]): Promise<T | null> {
    return this.props.electron.ipcRenderer
      .invoke(channel, ...args)
      .then((v) => v as T)
      .catch(() => null);
  }

  private openFact(fact: string): void {
    // A new comparison is a new selection. Carrying cells across would build a
    // scope out of two renders, and the from-line names exactly one.
    this.setState({ fact, selected: [], scope: null, armed: false });
    this.invoke<SiteAtPlacesMatrix>(IPC_CHANNELS.COMPARATOR_MATRIX, fact).then((matrix) => {
      if (this.live && matrix) this.setState({ matrix });
    });
  }

  private handleToggle(cell: MatrixCell): void {
    const selected = toggleCell(this.state.selected, cell);
    // A changed selection is an un-armed selection: the arming that was recorded
    // described the old set, and leaving the flag up would let the surface claim
    // a scope was carried that never was.
    this.setState({ selected, armed: false }, () => this.previewScope());
  }

  private previewScope(): void {
    const { matrix, selected } = this.state;
    const selection = matrix ? buildSelection(matrix, selected) : null;
    if (!selection) {
      this.setState({ scope: null });
      return;
    }
    this.invoke<{ scope?: ProcedureScope }>(IPC_CHANNELS.COMPARATOR_PREVIEW_SCOPE, {
      capability: this.props.capability,
      selection,
    }).then((outcome) => {
      if (this.live) this.setState({ scope: outcome?.scope ?? null });
    });
  }

  private handleArm(): void {
    const { matrix, selected } = this.state;
    const selection = matrix ? buildSelection(matrix, selected) : null;
    if (!selection) return;
    this.invoke<{ scope?: ProcedureScope }>(IPC_CHANNELS.COMPARATOR_ARM_SELECTION, {
      capability: this.props.capability,
      selection,
    }).then((outcome) => {
      if (!this.live || !outcome?.scope) return;
      this.setState({ scope: outcome.scope, armed: true });
      this.props.onArmed?.(outcome.scope);
    });
  }

  render(): React.ReactNode {
    const { fact, matrix, selected, scope, armed } = this.state;
    const { facts } = this.props;

    return React.createElement(
      'div',
      { style: styles.wrap },
      React.createElement(
        'div',
        { style: styles.picker },
        ...facts.map((f) =>
          React.createElement(
            'button',
            {
              key: f.fact,
              type: 'button',
              style: styles.factBtn(f.fact === fact),
              'data-comparator-fact': f.fact,
              onClick: () => this.openFact(f.fact),
            },
            `${f.label} · ${f.places}`,
          ),
        ),
      ),
      matrix
        ? React.createElement(SiteAtPlaces, {
            matrix,
            selected,
            onToggle: this.handleToggle,
            ...(scope ? { scope } : {}),
            onArm: this.handleArm,
            ...(this.props.onGovern ? { onGovern: this.props.onGovern } : {}),
          })
        : null,
      armed
        ? React.createElement(
            'div',
            { style: styles.note, 'data-comparator-armed': 'true' },
            // What happened, and what did not. The arming is on the carrier; the
            // turn is still the user's to send.
            'This selection is carried. Ask for the change, and the run will use it.',
          )
        : null,
    );
  }
}
