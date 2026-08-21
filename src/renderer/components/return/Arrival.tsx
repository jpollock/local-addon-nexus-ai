/**
 * WP-49 · THE NOW SCREEN (XD-27) — the addon's front door, and the one list.
 *
 * WP-46 built this as the ARRIVAL: two columns of one verdict (XD-26 §6a), the
 * morning read to you before you ask anything. XD-27 collapsed Home, Inbox and
 * Runs into it. What changed is the shape around the rows, not the rows:
 *
 *  - **Two columns became a list and a section.** The verdict heads the rows
 *    that need you; `Nothing needed of you` sits below as its own section — "a
 *    section, not a footnote" (position 11 §3) — holding everything the fold
 *    filed as changed, which is exactly the set that needs nobody. XD-27's
 *    rider about in-flight runs joining it is MEASURED AND ESCALATED rather
 *    than built: see `arrivalModel.ts`'s rider-1 block for the three findings
 *    and `needsNothingOfYou.test.ts` for the pins that will fail the day the
 *    contract can express it.
 *  - **The Inbox's cards are rows here now**, carrying their own *Approve* and
 *    *Not now* in place. A row that can be ANSWERED here gets buttons; a row
 *    that needs the session gets one door and no buttons, so deciding and going
 *    somewhere look different before you click. `renderSituation` and
 *    `renderInboxRow` are two functions for exactly that reason: the difference
 *    is structural, not a style.
 *  - **A finished run is not here at all.** It belongs to the record, which
 *    already exists, and a second rendering of it on this screen would be the
 *    two-homes defect the collapse removed.
 *
 * The file keeps its name because the eval harness, four suites and the surface
 * probe all address it, and a rename is churn no reader would see.
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
import type {
  ReservedRow, RowDoor, Situation, SituationDeferral, TriageView,
} from '../../../main/intelligence-host/sessionRegistry';
import { ageLabel, fillSituationSentence } from '../../../main/intelligence-host/sessionRegistry';
import {
  COLOURS, DEFERRED, RESERVED, SITUATION_TEMPLATES,
} from '../../../main/intelligence-host/situationCopy.generated';
import type { InboxItem } from '../../../main/inbox/types';
import { RETURN_COPY, SEP } from './returnCopy.generated';
import { NOW_COPY } from '../DockedPanel/openingCopy.generated';
import { Button } from '../designSystem';
import {
  accountingLine,
  arrivalCounts,
  awayHeadline,
  driftLine,
  gateLine,
  metaLine,
  needsLine,
  nowGroups,
  nowRows,
  nowVerdict,
  reservedDetail,
  rowIsDeferred,
  stripeColour,
  wakeLabel,
  type NowGroup,
  type NowRow,
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

/**
 * WP-49 · what the Inbox brought with it when it collapsed onto this screen.
 *
 * ABSENT IS A REAL STATE and it is not the same as empty: a surface driven
 * without this prop (the eval harness, most unit tests) renders the situation
 * rows alone, which is what it did before the collapse. `failed` is likewise not
 * `items: []` — "Nothing needs you when we simply could not look is the worst
 * thing this surface can say", and that ordering is preserved verbatim from the
 * tab this replaces.
 */
export interface NowInbox {
  loaded: boolean;
  failed: boolean;
  /** The open items. Every one of them is a row that needs a person. */
  items: InboxItem[];
  /** The true total behind `items`, which is one page. */
  total: number;
  /** Agent ids currently auto-paused, from GET_INBOX. */
  pausedSources: string[];
  /** Decided items, for Reopen. They need nobody, so they sit below. */
  recentlyDecided: InboxItem[];
}

export interface ArrivalProps {
  electron: any;
  /** Promote the session a row belongs to. */
  onPromote?: (sessionId: string) => void;
  /**
   * WP-49 · the Inbox, collapsed onto the rows. Optional: the surface renders
   * its situation rows with or without it.
   */
  inbox?: NowInbox;
  /**
   * WP-54 · ITEM 5 — THE ROW'S DOOR TO THE SITE A FINDING IS ABOUT.
   *
   * An incident's ask is "contain it", which is a procedure launch requiring
   * consent — not a one-click approve. The row therefore leads to where that
   * decision is made, carrying the site with it (WP-44's rule: a door that names
   * a destination without carrying its target delivers the person to the top of
   * the destination instead of to the thing).
   */
  onOpenSite?: (siteName: string) => void;
  /** The agent an Inbox row was raised by, and where it is answered. */
  onOpenAgent?: (agentId: string) => void;
  /** Reverse a DECISION, never a live change. */
  onReopen?: (id: number) => void;
  /** Clear an agent's auto-pause so it may run automatically again. */
  onResumeAgent?: (agentId: string) => void;
  /**
   * WP-55 · ITEM 5 — END A STANDING DEFERRAL EARLY.
   *
   * One of the three ratified ways a deferral ends (the wake fires, the user
   * ends it, the situation is answered), and the only one that is a control.
   * It carries the DEFERRAL EVENT ID rather than the situation id, because
   * ending is recorded as a superseding event that names the one it supersedes —
   * `DeferralEndRecord.supersedes`, which is how the record stays append-only.
   *
   * OPTIONAL, and an absent handler renders the control anyway: a deferral the
   * user cannot end is the furniture problem this affordance exists to prevent,
   * so a host that mounts this surface without wiring the handler must see a
   * dead control and fix it, rather than see a row that quietly cannot be
   * un-quieted. That is the opposite of `renderDoor`'s rule and the asymmetry is
   * deliberate: a missing door costs a journey, a missing end-deferral costs a
   * row its way back into the badge.
   */
  onEndDeferral?: (deferralEventId: string) => void;
  /** Re-read the inbox after a failed read. */
  onRetryInbox?: () => void;
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
  /**
   * WP-55 · ITEM 3 — WHICH ROWS HAVE THEIR PARTS OPEN, by situation id.
   *
   * CLOSED BY DEFAULT, and opening IN PLACE rather than through the door,
   * because someone checking whether a verdict is true should not have to leave
   * the list to do it. Keyed by id and not by index: the list re-ranks on every
   * poll, and an index would open a different row's parts the moment anything
   * moved.
   *
   * **A COALESCED ROW STOPS EXISTING WHEN ITS MEMBERS LEAVE, and no surface may
   * persist its id** — so this is component state and is deliberately NOT
   * written to `props.store` beside `awayMs`. An open/closed flag surviving a
   * restart would be a surface remembering a row the record no longer holds.
   */
  openParts: Record<string, boolean>;
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
  // WP-49 · ONE LIST, then a section. The two-column grid is gone with the two
  // columns: the verdict heads the rows that need you, and everything that
  // needs nobody is below, where a reader arrives at it after the decisions
  // rather than beside them.
  columns: { display: 'flex', flexDirection: 'column' as const, gap: 18 },
  sectionGap: { marginTop: 10 },
  banner: {
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 4,
    padding: '10px 12px',
    marginBottom: 8,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center' as const,
    fontSize: 11,
    color: 'var(--nxai-muted-text)',
  },
  answers: { display: 'flex', gap: 8, marginTop: 8 },
  truncated: { fontSize: 10, color: 'var(--nxai-muted-text)', marginBottom: 8 },
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
  /**
   * WP-54 · ITEM 3 — THE SEVERITY STRIPE, ratified and never built.
   *
   * Three pixels on the left edge, from `stripeColour`. It is not decoration:
   * it is the only thing that would have made the tier drift this packet fixes
   * VISIBLE at a glance — four Tier-1 findings rendering below a Tier-2 backup
   * step is obvious with a stripe and invisible without one.
   *
   * The width and the position are here; the COLOUR is not, and never will be:
   * the colour is a function of the tier alone, so the mapping cannot drift into
   * a severity scale by being edited in a stylesheet.
   */
  stripeWidth: 3,
  /**
   * WP-52 · ITEM 3 — UPRIGHT. The designer, on the live build: "italics is a
   * treatment nothing ratified, and a lowercase fragment reads like an apology
   * for the row." The lowercase half is fixed at the source (the line now reads
   * the template's own `rule` — `Tier 2 · the world is untouched`, tier named);
   * the italic half was this rule, and it is gone.
   */
  rule: {
    fontSize: 10,
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
    // WP-54 · ITEM 6 — LINK BLUE, NOT BRAND GREEN. A door is a link and reads
    // as one; brand green is the product's own mark, not a destination. Read
    // from the ratified palette so the value lives in one place.
    color: COLOURS.link,
    cursor: 'pointer',
  },
  /**
   * WP-55 · ITEM 4 — THE GROUP CAPTION. NOT A CARD, and the absences are the
   * design.
   *
   * No border, no fill, no stripe, no door. That is the entire visual difference
   * between grouping and coalescing and it must read without the words: a
   * coalesced set is ONE BORDERED OBJECT, a grouped set is SEVERAL under a
   * remark. Anything added here that a row also has erases the distinction.
   */
  groupCaption: { fontSize: 11, color: 'var(--nxai-card-text)', marginTop: 6 },
  groupLimit: { fontSize: 10, color: 'var(--nxai-muted-text)', marginTop: 2 },
  /**
   * WP-55 · ITEM 3 — A PART IS A LINE, and a line is not a row.
   *
   * No stripe, no chip, no ask, no gate. It carries its own sentence, its own
   * age and its own door, indented under the verdict it is evidence for.
   */
  partLine: { fontSize: 11, color: 'var(--nxai-card-text)', marginTop: 6, paddingLeft: 10 },
  partAge: { fontSize: 10, color: 'var(--nxai-muted-text)', marginLeft: 6 },
  /** The disclosure and the deferral's own control — links, like every door. */
  inlineControl: {
    background: 'none', border: 'none', padding: 0, font: 'inherit',
    fontSize: 11, color: COLOURS.link, cursor: 'pointer', marginTop: 6,
  },
  partDoor: {
    background: 'none', border: 'none', padding: 0, font: 'inherit',
    fontSize: 10, color: COLOURS.link, cursor: 'pointer', marginLeft: 6,
  },
  /**
   * WP-55 · ITEM 5 — THE DEFERRED ROW. DIMMED, and dimmed is ALL.
   *
   * Cycle two, ratified: it keeps its tier, keeps its place, and lowers
   * escalation only. There is deliberately no rule here that could move it, hide
   * it or restripe it — leaving the list is a dismissal by another name, and the
   * opacity is the whole of what a deferral is allowed to change about how a row
   * looks.
   */
  deferredOpacity: 0.55,
  deferredLine: { fontSize: 10, color: 'var(--nxai-muted-text)', marginTop: 4 },
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
    this.state = { triage: null, loading: true, error: null, awayMs: null, openParts: {} };
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
   * ONE ROW OF THE NOW LIST — a situation, an Inbox item, or the same thing
   * seen from both stores.
   *
   * WP-54 · ITEM 1 COLLAPSED TWO FUNCTIONS INTO THIS ONE, and the collapse is
   * the fix rather than a tidy-up. `renderSituation` and `renderInboxRow` were
   * two functions because position 11 §3 made a structural distinction —
   * *"rows answerable here get buttons; rows needing the session get one door
   * and no buttons"* — and the surface enforced it by having two shapes. **That
   * rule was withdrawn** (item 5): a gate without its declaration is consent
   * without context, which is the failure XD-8 exists to prevent, so no row is
   * answered in place any more. With the buttons gone the two shapes had no
   * difference left to carry, and keeping them apart is what let the same
   * finding render twice.
   *
   * WP-52's rule still holds inside it: a ratified card's TEMPLATE owns the
   * headline, the ask and the meta, and the derived card is supplemented with
   * its parts and its gate because it has no ask of its own.
   */
  private renderRow(row: NowRow, now: Date): React.ReactElement {
    const { situation, item } = row;
    const ratified = situation !== null && situation.headlineTemplate !== null;
    const stripe = stripeColour(row.tier);
    // WP-55 · ITEM 5 — THE ONE PREDICATE, read and never re-derived. The badge,
    // the verdict and the accounting line all ask this question, and a fourth
    // copy here is how they would start disagreeing.
    const deferred = rowIsDeferred(row);

    return React.createElement(
      'div',
      {
        key: row.key,
        style: {
          ...styles.row,
          // TIER AND PLACE UNCHANGED. The stripe is the tier's and a deferral
          // does not touch it — a quieted row is still a tier-1 row.
          ...(stripe ? { borderLeft: `${styles.stripeWidth}px solid ${stripe}` } : {}),
          ...(deferred ? { opacity: styles.deferredOpacity } : {}),
        },
        ...(situation ? { 'data-situation': situation.id, 'data-tier': situation.tier } : {}),
        ...(item ? { 'data-inbox-row': String(item.id) } : {}),
        // The stripe's own colour, exposed so a pin can read the ENCODING
        // rather than a computed style string.
        ...(stripe ? { 'data-stripe': stripe } : {}),
        ...(deferred ? { 'data-deferred': 'true' } : {}),
      },

      // XD-23: every row shows the rule that placed it — and WP-52 ratified
      // WHICH rule. WP-54 item 2 made the tier in it the tier the row was sorted
      // by, filled into the ratified line's own `{tier}` slot in the host.
      //
      // WP-55 · ITEM 5 — WHILE A DEFERRAL STANDS, THE DEFERRAL'S RULE LINE
      // REPLACES THE CLASS'S. `DEFERRED.rule` carries the same `{tier}` slot for
      // the same reason the class's does: the tier a card shows is the tier it
      // was sorted by, and a deferral changes neither. What it changes is the
      // REASON half — "deferred by you — tier and place unchanged" — which is
      // the row telling the reader why it is quiet without leaving the list.
      ...(situation
        ? [React.createElement(
            'div',
            { key: 'rule', style: styles.rule, 'data-rule': deferred ? 'deferred' : (ratified ? 'template' : 'derived') },
            deferred
              ? fillSituationSentence(DEFERRED.rule, { tier: situation.tier })
              : situation.rule,
          )]
        : []),

      // ONE WORD, when the class has one. A row whose chip is empty renders no
      // badge at all rather than an empty pill. WP-54 item 12 cut `Waiting` at
      // the fixture — the designer's own template error, withdrawn by them:
      // chip-presence was telling the user which of OUR code paths ran.
      ...(situation?.chip
        ? [React.createElement('div', { key: 'chip', style: styles.chip, 'data-chip': situation.chip }, situation.chip)]
        : []),

      // The verdict. A situation's is composed once in the host; an Inbox-only
      // row's is the ITEM'S OWN title, which is the record the fold does not
      // hold — never a sentence composed about it here.
      React.createElement(
        'div',
        {
          key: 'headline',
          style: styles.statement,
          'data-headline': situation ? (situation.headlineTemplate ?? 'derived') : 'inbox',
        },
        situation ? situation.headline : (item as InboxItem).title,
      ),

      ...(situation?.ask
        ? [React.createElement('div', { key: 'ask', style: styles.ask, 'data-ask': 'true' }, situation.ask)]
        : []),
      ...(!situation && item?.detail
        ? [React.createElement('div', { key: 'detail', style: styles.ask }, item.detail)]
        : []),

      // The situation's own parts, in the record's words — on a DERIVED card
      // only. WP-50's comparison stays: on a derived run row the headline IS
      // `runSummary(row)` and so is `parts[0].summary`.
      ...(situation && !ratified
        ? situation.parts
            .filter((part) => part.summary !== situation.headline)
            .map((part, i) =>
              React.createElement(
                'div',
                { key: `part-${i}`, style: styles.meta, 'data-part': part.kind },
                part.summary,
              ),
            )
        : []),

      // WP-55 · ITEM 3 — THE PARTS, AS LINES, BEHIND A DISCLOSURE.
      ...(situation ? this.renderParts(situation, now) : []),

      // J-Return's WHERE — the gate, by checkpoint id, with its position. On a
      // RATIFIED card the ask already carries it; on a derived card these are
      // the only place it appears.
      ...(situation && !ratified && situation.gate
        ? [
            React.createElement('div', { key: 'gate', style: styles.gate, 'data-gate': situation.gate.checkpointId }, gateLine(situation.gate)),
            React.createElement('div', { key: 'needs', style: styles.meta }, needsLine(situation.gate)),
          ]
        : []),

      React.createElement(
        'div',
        { key: 'meta', style: styles.meta },
        situation
          ? metaLine(situation, now)
          : [(item as InboxItem).scopeLabel, (item as InboxItem).source].filter(Boolean).join(SEP),
      ),

      // The Inbox item's own affordance, ON the row it duplicates. This is the
      // whole of "contributes its affordance to that row": the evidence a card
      // carried behind a disclosure is a fact about the finding, and it survived
      // the collapse because the row it belongs to is now the only row.
      ...(item?.evidence
        ? [React.createElement(
            'details',
            { key: 'evidence', style: { marginTop: 6 }, 'data-evidence': String(item.id) },
            React.createElement('summary', { style: styles.meta }, 'Evidence'),
            React.createElement('pre', { style: { ...styles.meta, whiteSpace: 'pre-wrap' as const } }, item.evidence),
          )]
        : []),

      ...(row.door ? [this.renderDoor(row.key, row.door)] : []),

      // WP-55 · ITEM 5 — THE DEFERRAL'S OWN LINES, BENEATH THE DOOR.
      //
      // The reason in the user's own words, the wake condition, and the way to
      // end it early. They are beneath the door rather than above the verdict
      // because the row's verdict has not changed: it is still the same finding
      // at the same tier, and the deferral is a note about how loudly it is
      // being said.
      ...(deferred && situation?.deferral ? this.renderDeferral(situation.deferral, now) : []),
    );
  }

  /**
   * WP-55 · ITEM 3 — A PART IS A LINE INSIDE THE CARD.
   *
   * *"No stripe, no chip, no ask, no gate — its own sentence, its own age, its
   * own door. Closed by default, opening IN PLACE rather than through the door,
   * because someone checking whether a verdict is true should not have to leave
   * the list to do it."*
   *
   * A RATIFIED CARD ONLY, and only one with something to disclose. The derived
   * path above already prints its parts unconditionally — that is a card with no
   * ask, supplemented by its record — and a row with a single part has nothing
   * to open: the disclosure would be a control that reveals the sentence
   * directly above it.
   *
   * THE COUNT IS STATED ONCE. The class's headline names the rest and its
   * disclosure names the whole; neither is a chip, and the row carries none.
   */
  private renderParts(situation: Situation, now: Date): React.ReactElement[] {
    const template = SITUATION_TEMPLATES.find((t) => t.id === situation.headlineTemplate);
    if (!template || template.disclosure === '' || situation.parts.length < 2) return [];
    // `?? {}` BECAUSE SIX EXTERNAL DRIVERS REPLACE THIS STATE WHOLESALE — five
    // test harnesses and the eval's `checks.ts` all assign `instance.state = {…}`
    // rather than patching it, so a state object without this key is a shape
    // this component genuinely receives. The constructor always sets it; a
    // driver that does not is answered with CLOSED, which is the default anyway.
    // A renderer that threw here would take the whole panel down over a
    // disclosure, and this seam is non-fatal by construction.
    const open = (this.state.openParts ?? {})[situation.id] === true;

    return [
      React.createElement(
        'button',
        {
          key: 'parts-toggle',
          type: 'button',
          style: styles.inlineControl,
          'data-parts-toggle': situation.id,
          'data-parts-open': String(open),
          onClick: () => this.toggleParts(situation.id),
        },
        open
          ? template.disclosureOpen
          : fillSituationSentence(template.disclosure, { memberCount: situation.parts.length }),
      ),
      ...(open
        ? situation.parts.map((part, i) =>
            React.createElement(
              'div',
              { key: `line-${i}`, style: styles.partLine, 'data-part-line': part.eventId ?? String(i) },
              // ITS OWN SENTENCE — the record's words for this member, never a
              // sentence composed about it here.
              React.createElement('span', { key: 'text' }, part.summary),
              // ITS OWN AGE. Absent where the record has no time for the part,
              // which is a state the synthetic run part is in — withheld rather
              // than filled with the row's age, which would be a claim about the
              // part that the row made.
              ...(part.observedAt
                ? [React.createElement(
                    'span',
                    { key: 'age', style: styles.partAge, 'data-part-age': part.observedAt },
                    ageLabel(part.observedAt, now),
                  )]
                : []),
              // ITS OWN DOOR. The row's destination, named for the row — a part
              // of a coalesced situation sits on the situation's own target by
              // construction (the class only fires when there is exactly one),
              // so this is where the part is answered too. A row with no door
              // gives its parts none rather than inventing one.
              ...(situation.door
                ? [React.createElement(
                    'button',
                    {
                      key: 'door',
                      type: 'button',
                      style: styles.partDoor,
                      'data-part-door': situation.door.target,
                      onClick: () => this.walkThrough(situation.door as RowDoor),
                    },
                    situation.door.label,
                  )]
                : []),
            ),
          )
        : []),
    ];
  }

  private toggleParts(situationId: string): void {
    this.setState({
      openParts: { ...this.state.openParts, [situationId]: !this.state.openParts[situationId] },
    });
  }

  /**
   * WP-55 · ITEM 5 — THE DEFERRAL, ON THE ROW.
   *
   * Reason and wake condition, in the ratified words, plus the way to end it
   * early. Three lines at most and none of them a card.
   *
   * **THE SURFACE DOES NOT OFFER A WAKE CONDITION THE PLATFORM CANNOT FIRE**
   * (ruled at WP-56's gate). This RENDERS whatever the record holds and offers
   * nothing — the picker is a different surface — but the same rule decides what
   * it says about an unconditioned deferral: `wakeSource` on the snapshot names
   * the missing `wakeFired` port honestly, so an unconditioned deferral is
   * described as never waking rather than as waiting for something.
   */
  private renderDeferral(deferral: SituationDeferral, now: Date): React.ReactElement[] {
    return [
      React.createElement(
        'div',
        { key: 'deferred-reason', style: styles.deferredLine, 'data-deferral': deferral.eventId },
        fillSituationSentence(DEFERRED.recorded, {
          deferredAge: ageLabel(deferral.deferredAt, now),
          reason: deferral.reason,
        }),
      ),
      React.createElement(
        'div',
        { key: 'deferred-wake', style: styles.deferredLine, 'data-deferral-wake': deferral.wake ? 'set' : 'none' },
        fillSituationSentence(DEFERRED.wake, { wakeLabel: wakeLabel(deferral.wake) }),
      ),
      React.createElement(
        'button',
        {
          key: 'deferred-end',
          type: 'button',
          style: styles.inlineControl,
          'data-deferral-end': deferral.eventId,
          onClick: () => this.props.onEndDeferral?.(deferral.eventId),
        },
        DEFERRED.endDoor,
      ),
    ];
  }

  /**
   * WP-54 · ITEM 6 — THE DOOR, NAMING WHERE IT GOES, IN LINK BLUE.
   *
   * Three destinations and each is a different act, which is why `kind` travels
   * with the label: a session PROMOTES (same session id, same cursor, same
   * pending approvals), a site is where a containment decision is made with its
   * declaration in front of it, and an agent is where an agent's own failure is
   * answered. A door whose handler is absent renders as nothing rather than as a
   * control that does nothing — a dead door is worse than no door.
   *
   * LINK BLUE, NOT BRAND GREEN (`#51bb7b`): a door is a link and reads as one.
   * Brand green is the product's own mark, not a destination, and the colour is
   * read from the ratified palette rather than typed here.
   */
  /**
   * WP-55 · ITEM 4 — XD-28. GROUPING IS A CAPTION; COALESCING IS A CARD.
   *
   * *"A shared field is a fact; a shared cause is a verdict. Where the record
   * does not link the members, they stay separate rows under a label, and the
   * label states the limit."*
   *
   * **THE LABEL IS NOT A CARD: no border, no fill, no stripe, no door.** That is
   * the entire visual difference and it has to read without the words —
   * coalescing produces ONE BORDERED OBJECT, grouping produces SEVERAL under a
   * caption. Anything given to this caption that a row also has erases the
   * distinction the design is made of.
   *
   * A group of one is not a group and `nowGroups` never builds one, so an
   * ungrouped row renders exactly as it did before this item: a bare row, no
   * wrapper, no caption.
   */
  private renderGroup(group: NowGroup, index: number, now: Date): React.ReactElement {
    if (!group.caption) return this.renderRow(group.rows[0], now);
    return React.createElement(
      'div',
      { key: `group-${index}` },
      React.createElement(
        'div',
        { key: 'caption', style: styles.groupCaption, 'data-group-caption': String(group.rows.length) },
        group.caption.label,
      ),
      // THE LIMIT, STATED. The caption says how many and this says what the
      // platform does NOT know about them — that the record does not link
      // these, so they are listed separately. Without it a caption over four
      // rows reads as a claim that they are related, which is the verdict the
      // record has not made.
      React.createElement(
        'div',
        { key: 'limit', style: styles.groupLimit, 'data-group-limit': 'true' },
        group.caption.limit,
      ),
      ...group.rows.map((row) => this.renderRow(row, now)),
    );
  }

  private renderDoor(key: string, door: RowDoor): React.ReactElement {
    return React.createElement(
      'button',
      {
        key: 'door',
        style: styles.door,
        'data-door': door.target,
        'data-door-kind': door.kind,
        onClick: () => this.walkThrough(door),
      },
      door.label,
    );
  }

  private walkThrough(door: RowDoor): void {
    if (door.kind === 'session') this.props.onPromote?.(door.target);
    if (door.kind === 'site') this.props.onOpenSite?.(door.target);
    if (door.kind === 'agent') this.props.onOpenAgent?.(door.target);
  }

  /**
   * The reserved slot. ONE row, always rendered, sticky so it cannot be scrolled
   * away — §4a tear 3, built rather than written down.
   *
   * WP-54 · ITEM 11 renamed it and quieted it, and changed NOTHING else. The
   * heading was "Reserved · the record's own health" — our noun for a thing the
   * user recognises as *is the platform watching my sites*. XD-23's guarantee is
   * a SEAT, not a panel: it is still exactly one row, it still cannot grow (the
   * contract has no field that could hold a second), and it is still sticky.
   * When the news is good it says one quiet line and stops.
   */
  private renderReserved(reserved: ReservedRow): React.ReactElement {
    return React.createElement(
      'div',
      { style: styles.reserved, 'data-reserved': 'true' },
      React.createElement('div', { key: 'rule', style: styles.reservedRule }, RESERVED.head),
      React.createElement('div', { key: 'head', style: styles.reservedHeadline }, reserved.headline),
      // The detail is every dark producer folded into this one row. Absent when
      // there are none — a quiet row is one line, not one line and an empty one.
      ...(reservedDetail(reserved)
        ? [React.createElement('div', { key: 'detail', style: styles.reservedDetail }, reservedDetail(reserved))]
        : []),
    );
  }

  /**
   * A DECIDED Inbox item, in the section for things that need nobody.
   *
   * It carries ONE control and it is not a gate: Reopen reverses a DECISION,
   * never a live change, so it is genuinely answerable where it stands. Item 5
   * removed Approve / Not now from every row in the list above; this is not one
   * of those rows, and the distinction is the whole of the ruling — a gate needs
   * its declaration, and undoing a filing does not.
   */
  private renderDecidedRow(item: InboxItem): React.ReactElement {
    const { onReopen } = this.props;
    return React.createElement(
      'div',
      { key: `inbox-${item.id}`, style: styles.row, 'data-inbox-row': String(item.id), 'data-inbox-kind': item.kind },
      React.createElement('div', { key: 'title', style: styles.statement }, item.title),
      React.createElement(
        'div',
        { key: 'meta', style: styles.meta },
        [item.scopeLabel, item.source].filter(Boolean).join(SEP),
      ),
      // WP-54 · ITEM 8 — the design system's Button, not a hand-styled one.
      React.createElement(
        Button,
        { key: 'reopen', 'data-answer': 'reopen', onClick: () => onReopen && onReopen(item.id) },
        'Reopen',
      ),
    );
  }

  /**
   * One paused agent, and the only control that clears the pause.
   *
   * Read from `pausedSources` DIRECTLY, never derived from the rows on screen:
   * an agent pauses precisely when it keeps failing, the user may well have
   * dismissed its failure item, and nothing else clears `_autoPausedAt`. That
   * reasoning is inherited whole from the tab this replaces, along with its
   * second half — `items` is one page, so a paused agent past the first page
   * would be missed by any derivation from them.
   */
  private renderPausedBanner(agentId: string): React.ReactElement {
    const { onResumeAgent } = this.props;
    return React.createElement(
      'div',
      { key: `paused-${agentId}`, style: styles.banner, 'data-paused': agentId },
      React.createElement('span', { key: 'text' }, `${agentId} paused after repeated failures`),
      React.createElement(
        Button,
        { key: 'resume', onClick: () => onResumeAgent && onResumeAgent(agentId) },
        'Try again',
      ),
    );
  }

  /**
   * The Inbox's chrome — what is NOT a row of the list.
   *
   * ORDER MATTERS AND IS INHERITED: a failed read must never fall through to
   * silence. Before the collapse the tab said so with its own screen; here it
   * says so with one row inside the list, because the list has other rows in it
   * and a whole-screen failure would hide them.
   *
   * WP-54 · ITEM 1 — THE ITEMS THEMSELVES ARE NO LONGER RENDERED HERE. They are
   * rows of `nowRows`, deduplicated against the situations, and this returns
   * only the read failure, the paused-agent banners and the truncation notice.
   * Rendering both was the defect: four findings, twice, under a badge of seven.
   */
  private renderInboxChrome(): React.ReactElement[] {
    const inbox = this.props.inbox;
    if (!inbox) return [];
    if (inbox.failed) {
      return [React.createElement(
        'div',
        { key: 'inbox-failed', style: styles.row, 'data-inbox-failed': 'true' },
        React.createElement('div', { key: 'text', style: styles.statement }, "Couldn't read the inbox."),
        ...(this.props.onRetryInbox
          ? [React.createElement(Button, { key: 'retry', onClick: this.props.onRetryInbox }, 'Try again')]
          : []),
      )];
    }
    if (!inbox.loaded) return [];
    return [
      ...inbox.pausedSources.map((agentId) => this.renderPausedBanner(agentId)),
      ...(inbox.items.length < inbox.total
        ? [React.createElement('div', { key: 'inbox-truncated', style: styles.truncated }, `Showing ${inbox.items.length} of ${inbox.total}`)]
        : []),
    ];
  }

  render(): React.ReactElement | null {
    const { triage, loading, error, awayMs } = this.state;
    const now = this.props.now ?? new Date();

    if (loading) return React.createElement('div', { style: styles.empty }, '');
    if (error || !triage) {
      return React.createElement('div', { style: styles.empty, 'data-arrival-error': 'true' }, error ?? '');
    }

    const inbox = this.props.inbox;
    // WP-54 · ITEM 1 — ONE LIST, BUILT ONCE, AND EVERY NUMBER ON THIS SCREEN
    // COMES OUT OF IT. `arrivalCounts` calls `nowRows` too, so the badge on the
    // rail counts these rows and not a different population.
    const rows = nowRows(triage, inbox);
    const counts = arrivalCounts(triage, inbox);
    const away = awayHeadline(awayMs);
    const accounting = accountingLine(counts);
    const verdict = nowVerdict(triage, inbox);
    const quiet = [
      ...(triage.working ?? []),
    ];
    const decided = inbox && inbox.loaded && !inbox.failed ? inbox.recentlyDecided : [];
    const nothingNeeded = quiet.length + triage.changed.length + decided.length;

    return React.createElement(
      'section',
      { style: styles.surface, 'data-surface': 'now' },

      React.createElement(
        'header',
        { key: 'header' },
        // WP-54 · ITEM 9 — the away line renders only when there IS an absence
        // to report. Under an hour it is not news, and "You were away 0 hours"
        // was ruled against once and shipped anyway.
        ...(away
          ? [React.createElement('h2', { key: 'away', style: styles.headline, 'data-away': 'true' }, away)]
          : []),
        // WP-54 · ITEM 9 — and the accounting line renders only when it has a
        // clause. It no longer restates the verdict's own count, and it never
        // enumerates a zero, so on a quiet morning there is no element here at
        // all rather than an element saying nothing.
        ...(accounting
          ? [React.createElement('p', { key: 'accounting', style: styles.accounting, 'data-accounting': 'true' }, accounting)]
          : []),
        // The list verdict — the sentence no single row can say, and the most
        // useful one this data produces. Composed by the HOST'S own composer
        // over the rows below it (see `nowVerdict`), so the sentence and the
        // list count the same things. Empty when nothing is waiting.
        ...(verdict
          ? [React.createElement('p', { key: 'verdict', style: styles.verdict, 'data-verdict': 'true' }, verdict)]
          : []),
      ),

      React.createElement('div', { key: 'reserved' }, this.renderReserved(triage.reserved)),

      React.createElement(
        'div',
        { key: 'lists', style: styles.columns },

        React.createElement(
          'div',
          { key: 'needs-you', 'data-now-list': 'needs-you' },
          // NO BADGE HERE. WP-54 item 9: the count was on this badge, in the
          // accounting line and in the verdict — three renderings of one number.
          // The verdict is the one that says something; the ambient badge on the
          // rail is the instrument (XD-23) and it counts these very rows.
          React.createElement(
            'div',
            { style: styles.columnHead },
            React.createElement('span', { key: 'label' }, RETURN_COPY.WAITING_HEAD),
          ),
          ...this.renderInboxChrome(),
          // WP-55 · ITEM 4 — THE ONE LIST, WITH CAPTIONS OVER THE ROWS THE
          // RECORD DOES NOT LINK. `nowGroups` is a partition of `rows` and
          // never a filter: every row it was given is drawn exactly once, so
          // the badge, the verdict and the columns still count the same set.
          ...nowGroups(rows).map((group, i) => this.renderGroup(group, i, now)),
        ),

        // WP-54 · ITEM 13 — THE SECTION DOES NOT RENDER WHEN IT IS EMPTY.
        //
        // "NOTHING NEEDED OF YOU" was rendering as a heading over two sentences
        // of our own doctrine — *"Filed before you arrived — the record was
        // written when the run finished, not when you opened this. Nothing here
        // is composed on demand."* That sentence exists to reassure an ARCHITECT
        // that nothing is composed on demand; to a user it is a section with no
        // contents and a lecture. Both sentences are deleted, and the section
        // renders only when it holds something.
        ...(nothingNeeded > 0
          ? [React.createElement(
              'div',
              { key: 'nothing-needed', style: styles.sectionGap, 'data-now-list': 'nothing-needed' },
              React.createElement('div', { style: styles.columnHead }, NOW_COPY.NOTHING_NEEDED_HEAD),
              ...quiet.map((w) =>
                React.createElement(
                  'div',
                  { key: `working-${w.sessionId}`, style: styles.row, 'data-working': w.sessionId },
                  React.createElement('div', { style: styles.statement }, w.line),
                  this.renderDoor(w.sessionId, { label: RETURN_COPY.ROW_DOOR, kind: 'session', target: w.sessionId }),
                ),
              ),
              ...triage.changed.map((s) =>
                this.renderRow({ key: s.id, situation: s, item: null, tier: s.tier, door: s.door }, now),
              ),
              ...decided.map((item) => this.renderDecidedRow(item)),
            )]
          : []),
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
