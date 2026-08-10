import React from 'react';
import { UI_COLORS } from '../../../common/constants';

interface Props {
  title: string;
  effect: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface State {
  understood: boolean;
}

const styles = {
  card: {
    border: `1px solid var(--nxai-card-border)`,
    background: '#132a30',
    borderRadius: 6,
    padding: '12px 14px',
    margin: '8px 0',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  icon: {
    color: UI_COLORS.WPE_BRAND,
    fontSize: 14,
    marginRight: 6,
  },
  title: {
    color: 'var(--nxai-card-text)',
    fontSize: 13,
    fontWeight: 600,
  },
  effect: {
    color: 'var(--nxai-card-sub)',
    fontSize: 12,
    lineHeight: 1.4,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'var(--nxai-card-text)',
    cursor: 'pointer',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  confirmBtn: (disabled: boolean) => ({
    background: disabled ? 'var(--nxai-card-sub)' : UI_COLORS.WPE_BRAND,
    border: 'none',
    borderRadius: 4,
    color: disabled ? UI_COLORS.ON_BRAND_DISABLED : UI_COLORS.NEXUS_MARK,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 14px',
  }),
  cancelBtn: {
    background: 'none',
    border: `1px solid var(--nxai-card-border)`,
    borderRadius: 4,
    color: 'var(--nxai-card-sub)',
    cursor: 'pointer',
    fontSize: 12,
    padding: '6px 14px',
  },
};

export class ActionCard extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { understood: false };
    this.toggleUnderstood = this.toggleUnderstood.bind(this);
  }

  toggleUnderstood() {
    this.setState((s) => ({ understood: !s.understood }));
  }

  render() {
    const { title, effect, destructive = false, onConfirm, onCancel } = this.props;
    const { understood } = this.state;
    const confirmDisabled = destructive && !understood;

    return React.createElement(
      'div',
      { style: styles.card, role: 'group', 'aria-label': `Action: ${title}` },
      React.createElement(
        'div',
        null,
        React.createElement('span', { style: styles.icon }, '⚡'),
        React.createElement('span', { style: styles.title }, title),
      ),
      React.createElement('div', { style: styles.effect }, effect),
      destructive
        ? React.createElement(
            'label',
            { style: styles.checkRow },
            React.createElement('input', {
              type: 'checkbox',
              checked: understood,
              onChange: this.toggleUnderstood,
            }),
            'I understand this action cannot be undone',
          )
        : null,
      React.createElement(
        'div',
        { style: styles.actions },
        React.createElement(
          'button',
          {
            style: styles.confirmBtn(confirmDisabled),
            disabled: confirmDisabled,
            onClick: confirmDisabled ? undefined : onConfirm,
            'aria-label': 'Confirm action',
          },
          'Confirm',
        ),
        React.createElement(
          'button',
          { style: styles.cancelBtn, onClick: onCancel },
          'Not now',
        ),
      ),
    );
  }
}
