/**
 * ChatSection — panel toggle, retention, and per-site overrides
 *
 * Ported from NexusPreferences Chat History section (Operations tab, lines 1802-1846).
 * Panel toggle with descriptive text; retention dropdown with sentence that tracks the choice.
 */
import * as React from 'react';
import type { NexusSettings } from '../../../common/types';

interface ChatSectionProps {
  settings: NexusSettings;
  onSave: (patch: Partial<NexusSettings>) => void;
  electron: any;
}

export class ChatSection extends React.Component<ChatSectionProps> {
  handleDockedPanelToggle = (enabled: boolean): void => {
    this.props.onSave({ dockedPanelEnabled: enabled });
  };

  handleRetentionChange = (days: 7 | 30 | 90 | null): void => {
    this.props.onSave({ chatRetentionDays: days });
  };

  renderRetentionSentence(days: number | null | undefined): string {
    if (days === null) {
      return 'Chat messages are kept forever.';
    }
    if (days === undefined) {
      return `Chat messages older than 30 days are automatically deleted.`;
    }
    return `Chat messages older than ${days} days are automatically deleted.`;
  }

  render(): React.ReactElement {
    const { settings } = this.props;
    const panelEnabled = settings.dockedPanelEnabled !== false;
    const retentionDays = settings.chatRetentionDays !== undefined ? settings.chatRetentionDays : 30;

    return React.createElement('div', null,
      // Panel toggle
      React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 12,
        },
      },
        React.createElement('label', {
          style: {
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
          },
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: panelEnabled,
            onChange: (e: any) => {
              this.handleDockedPanelToggle(e.target.checked);
            },
            style: { marginRight: 10, width: 16, height: 16 },
          }),
          React.createElement('span', {
            style: {
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--nxai-card-text)',
            },
          }, 'Enable AI Chat Panel'),
        ),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
            marginLeft: 26,
            marginTop: 6,
            lineHeight: 1.4,
          },
        }, 'Show the AI chat panel bubble in the bottom-right corner of every screen in Local.'),
      ),

      // Retention controls (shown only when panel is enabled)
      panelEnabled ? React.createElement('div', {
        style: {
          padding: 16,
          background: 'var(--nxai-card-bg)',
          border: '1px solid var(--nxai-card-border)',
          borderRadius: 6,
          marginBottom: 12,
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 12,
          },
        }, 'Chat History'),

        // Retention dropdown
        React.createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 12,
          },
        },
          React.createElement('label', {
            style: {
              fontSize: 13,
              color: 'var(--nxai-card-sub)',
            },
          }, 'Keep chat history for'),
          React.createElement('select', {
            value: String(retentionDays === null ? 'null' : retentionDays),
            onChange: (e: any) => {
              const raw = e.target.value;
              const val = raw === 'null' ? null : Number(raw) as 7 | 30 | 90;
              this.handleRetentionChange(val);
            },
            style: {
              padding: '6px 10px',
              fontSize: 13,
              background: 'var(--nxai-input-bg)',
              border: '1px solid var(--nxai-input-border)',
              borderRadius: 4,
              color: 'var(--nxai-card-text)',
            },
          },
            React.createElement('option', { value: '7' }, '7 days'),
            React.createElement('option', { value: '30' }, '30 days'),
            React.createElement('option', { value: '90' }, '90 days'),
            React.createElement('option', { value: 'null' }, 'Forever'),
          ),
        ),

        // Retention sentence
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
            lineHeight: 1.4,
          },
        }, this.renderRetentionSentence(retentionDays)),
      ) : null,
    );
  }
}
