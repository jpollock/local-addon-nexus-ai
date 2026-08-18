import React from 'react';
import { UI_COLORS } from '../../../common/constants';
import type { ProcedureApprovalContext } from '../../../common/chat-types';

/**
 * WP-26 · the approval card for a strict runbook's approval checkpoint.
 *
 * `ActionCard` asks "do this thing?". This card asks the same question inside a
 * document the user can name — and it is the ONLY producer of `canary_policy`,
 * which is why the control lives here rather than mid-run: the policy is
 * decided once, at approval (§5b), and a control offered where nothing records
 * it would be fabricating consent.
 *
 * IT COMPUTES NOTHING. Every fact rendered comes from the `procedure` block the
 * platform emitted with the approval — the runbook, its version, its
 * strictness, and the checkpoint this decision attests. A renderer deriving
 * checkpoint state of its own is exactly the failure `procedureView.ts` exists
 * to prevent: "if the UI invents its own, the transcript will claim
 * verification the platform does not have."
 *
 * Copy conforms to Controlled Vocabulary v1.1: **runbook** (named, versioned,
 * "marked strict"), **checkpoint**, **canary**. The word *verified* never
 * appears about a checkpoint — verify belongs to the live check alone.
 */

const CANARY_POLICIES = ['pause-after-canary', 'continue-if-clean'] as const;
type CanaryPolicy = (typeof CANARY_POLICIES)[number];

/**
 * The default, and the fact that it IS the default, both shown.
 *
 * `deriveCanaryPolicy` reports `declared: false` when no approval carried a
 * policy, and the surface is obliged to keep that distinction visible: the user
 * gets the safer behaviour without being told they asked for it.
 */
const DEFAULT_CANARY_POLICY: CanaryPolicy = 'pause-after-canary';

const POLICY_LABELS: Record<CanaryPolicy, string> = {
  'pause-after-canary': 'Pause after the canary and wait for me',
  'continue-if-clean': 'Continue to the rest if the canary is clean',
};

interface Props {
  title: string;
  effect: string;
  /** The card text the platform composed — recorded verbatim as the rationale. */
  warning: string;
  procedure: ProcedureApprovalContext;
  onApprove: (canaryPolicy?: CanaryPolicy) => void;
  onDeny: () => void;
}

interface State {
  canaryPolicy: CanaryPolicy;
}

const styles = {
  card: {
    border: '1px solid var(--nxai-card-border)',
    background: 'var(--nxai-section-bg)',
    borderRadius: 6,
    padding: '12px 14px',
    margin: '8px 0',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  title: { color: 'var(--nxai-card-text)', fontSize: 13, fontWeight: 600 },
  reference: {
    color: 'var(--nxai-card-sub)',
    fontSize: 11,
    lineHeight: 1.5,
    borderLeft: `2px solid ${UI_COLORS.WPE_BRAND}`,
    paddingLeft: 8,
  },
  effect: { color: 'var(--nxai-card-sub)', fontSize: 12, lineHeight: 1.4 },
  policyGroup: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginTop: 2 },
  policyHeading: { color: 'var(--nxai-card-text)', fontSize: 12, fontWeight: 600 },
  policyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'var(--nxai-card-text)',
    cursor: 'pointer',
  },
  defaultTag: { color: 'var(--nxai-card-sub)', fontSize: 11 },
  finalNote: { color: 'var(--nxai-card-sub)', fontSize: 11, lineHeight: 1.4 },
  actions: { display: 'flex', gap: 8, marginTop: 4 },
  approveBtn: {
    background: UI_COLORS.WPE_BRAND,
    border: 'none',
    borderRadius: 4,
    color: UI_COLORS.NEXUS_MARK,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 14px',
  },
  denyBtn: {
    background: 'none',
    border: '1px solid var(--nxai-card-border)',
    borderRadius: 4,
    color: 'var(--nxai-card-sub)',
    cursor: 'pointer',
    fontSize: 12,
    padding: '6px 14px',
  },
};

export class ProcedureApprovalCard extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { canaryPolicy: DEFAULT_CANARY_POLICY };
    this.approve = this.approve.bind(this);
    this.deny = this.deny.bind(this);
  }

  choosePolicy(policy: CanaryPolicy) {
    this.setState({ canaryPolicy: policy });
  }

  approve() {
    // A runbook with no canary gets no policy — not the default written down as
    // though it had been chosen. Absence is what `declared: false` reads back.
    this.props.onApprove(
      this.props.procedure.offersCanaryPolicy ? this.state.canaryPolicy : undefined,
    );
  }

  deny() {
    this.props.onDeny();
  }

  renderPolicy(): React.ReactNode {
    if (!this.props.procedure.offersCanaryPolicy) return null;
    return React.createElement(
      'div',
      { style: styles.policyGroup, role: 'radiogroup', 'aria-label': 'After the canary' },
      React.createElement('div', { style: styles.policyHeading }, 'This runbook updates one site first as a canary.'),
      ...CANARY_POLICIES.map((policy) =>
        React.createElement(
          'label',
          { key: policy, style: styles.policyRow },
          React.createElement('input', {
            type: 'radio',
            name: 'nxai-canary-policy',
            checked: this.state.canaryPolicy === policy,
            onChange: () => this.choosePolicy(policy),
          }),
          POLICY_LABELS[policy],
          policy === DEFAULT_CANARY_POLICY
            ? React.createElement('span', { style: styles.defaultTag }, '(default)')
            : null,
        ),
      ),
    );
  }

  render() {
    const { title, effect, warning, procedure } = this.props;

    return React.createElement(
      'div',
      { style: styles.card, role: 'group', 'aria-label': `Approval: ${title}` },
      React.createElement(
        'div',
        null,
        React.createElement('span', { style: { color: UI_COLORS.WPE_BRAND, fontSize: 14, marginRight: 6 } }, '⚡'),
        React.createElement('span', { style: styles.title }, title),
      ),
      // The plan reference. Named, versioned, marked strict — and the
      // checkpoint this decision attests, so the user can see which step of the
      // document they are standing on.
      React.createElement(
        'div',
        { style: styles.reference },
        `Runbook ${procedure.runbookId} v${procedure.version}, marked strict.`,
        React.createElement('br', null),
        `This approval is checkpoint ${procedure.checkpointId}.`,
      ),
      React.createElement('div', { style: styles.effect }, effect),
      React.createElement('div', { style: styles.effect }, warning),
      this.renderPolicy(),
      React.createElement(
        'div',
        { style: styles.finalNote },
        'Denying ends this runbook for this chat — it won\'t be proposed again here.',
      ),
      React.createElement(
        'div',
        { style: styles.actions },
        React.createElement(
          'button',
          { style: styles.approveBtn, onClick: this.approve, 'aria-label': 'Approve this checkpoint' },
          'Approve',
        ),
        React.createElement(
          'button',
          { style: styles.denyBtn, onClick: this.deny, 'aria-label': 'Deny this checkpoint' },
          'Deny',
        ),
      ),
    );
  }
}
