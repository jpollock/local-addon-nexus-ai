/**
 * ChatSection — panel toggle, retention, and delete-all
 *
 * Ported from NexusPreferences Chat History section (Operations tab, lines 1802-1846).
 * Panel toggle with descriptive text; retention dropdown; delete-all with confirmation.
 *
 * Per-site AI provider override link is specified in the design but deferred pending
 * a defined destination (which sites, how to navigate, what the link says). When that
 * is defined, add it below the delete-all button.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import type { NexusSettings } from '../../../common/types';

interface ChatSectionProps {
  settings: NexusSettings;
  onSave: (patch: Partial<NexusSettings>) => void;
  electron: any;
}

interface ChatSectionState {
  deleteConfirmPending: boolean;
}

export class ChatSection extends React.Component<ChatSectionProps, ChatSectionState> {
  state: ChatSectionState = {
    deleteConfirmPending: false,
  };

  handleDockedPanelToggle = (enabled: boolean): void => {
    this.props.onSave({ dockedPanelEnabled: enabled });
  };

  handleRetentionChange = (days: 7 | 30 | 90 | null): void => {
    this.props.onSave({ chatRetentionDays: days });
  };

  handleDeleteAll = async (): Promise<void> => {
    if (!this.state.deleteConfirmPending) {
      this.setState({ deleteConfirmPending: true });
      return;
    }

    // Confirmed — delete all chat history
    await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_CLEAR_ALL);
    this.setState({ deleteConfirmPending: false });
  };

  handleCancelDelete = (): void => {
    this.setState({ deleteConfirmPending: false });
  };

  render(): React.ReactElement {
    const { settings } = this.props;
    const { deleteConfirmPending } = this.state;
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

      // Retention and delete-all (shown only when panel is enabled)
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
            marginBottom: 16,
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

        // Delete all chat history
        React.createElement('div', {
          style: {
            padding: 12,
            background: deleteConfirmPending ? 'var(--nxai-error-bg)' : 'transparent',
            border: deleteConfirmPending ? '1px solid var(--nxai-danger-text)' : 'none',
            borderRadius: 6,
          },
        },
          React.createElement('div', {
            style: {
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--nxai-card-text)',
              marginBottom: 6,
            },
          }, 'Delete All Chat History'),
          React.createElement('div', {
            style: {
              fontSize: 12,
              color: 'var(--nxai-card-sub)',
              lineHeight: 1.4,
              marginBottom: 12,
            },
          }, 'Deletes every conversation across all sessions. Indexed content is unaffected — only chat messages are removed. This cannot be undone.'),
          React.createElement('div', {
            style: {
              display: 'flex',
              gap: 8,
            },
          },
            React.createElement('button', {
              onClick: this.handleDeleteAll,
              style: {
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 4,
                background: deleteConfirmPending ? 'var(--nxai-error-bg)' : 'var(--nxai-card-bg)',
                border: '1px solid var(--nxai-input-border)',
                color: deleteConfirmPending ? 'var(--nxai-danger-text)' : 'var(--nxai-card-text)',
                cursor: 'pointer',
                fontWeight: deleteConfirmPending ? 600 : 400,
              },
            }, deleteConfirmPending ? 'Confirm Delete' : 'Delete All'),
            deleteConfirmPending ? React.createElement('button', {
              onClick: this.handleCancelDelete,
              style: {
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 4,
                background: 'var(--nxai-card-bg)',
                border: '1px solid var(--nxai-input-border)',
                color: 'var(--nxai-card-text)',
                cursor: 'pointer',
              },
            }, 'Cancel') : null,
          ),
        ),
      ) : null,
    );
  }
}
