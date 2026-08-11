/**
 * ChatSection — panel toggle, retention, and delete-all
 *
 * Ported from NexusPreferences Chat History section (Operations tab, lines 1801-1846).
 * Panel toggle with descriptive text; retention dropdown; delete-all with confirmation
 * following the factory reset pattern (checkbox + disabled confirm button).
 *
 * Per-site AI provider override link is specified in the design but deferred pending
 * a defined destination (which sites, how to navigate, what the link says). When that
 * is defined, add it below the delete-all section.
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
  deleteConfirmChecked: boolean;
  deleteInFlight: boolean;
  deleteError: string | null;
}

export class ChatSection extends React.Component<ChatSectionProps, ChatSectionState> {
  state: ChatSectionState = {
    deleteConfirmPending: false,
    deleteConfirmChecked: false,
    deleteInFlight: false,
    deleteError: null,
  };

  handleDockedPanelToggle = (enabled: boolean): void => {
    this.props.onSave({ dockedPanelEnabled: enabled });
  };

  handleRetentionChange = (days: 7 | 30 | 90 | null): void => {
    this.props.onSave({ chatRetentionDays: days });
  };

  handleDeleteDisclosure = (): void => {
    this.setState({ deleteConfirmPending: true, deleteConfirmChecked: false, deleteError: null });
  };

  handleDeleteConfirmCheck = (checked: boolean): void => {
    this.setState({ deleteConfirmChecked: checked });
  };

  handleDeleteConfirm = async (): Promise<void> => {
    this.setState({ deleteInFlight: true, deleteError: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT_CLEAR_ALL);
      if (!result.success) {
        this.setState({
          deleteInFlight: false,
          deleteError: result.error || 'Failed to delete chat history',
        });
        return;
      }
      this.setState({
        deleteInFlight: false,
        deleteConfirmPending: false,
        deleteConfirmChecked: false,
        deleteError: null,
      });
    } catch (err: any) {
      this.setState({
        deleteInFlight: false,
        deleteError: err.message || 'An unexpected error occurred',
      });
    }
  };

  handleCancelDelete = (): void => {
    this.setState({ deleteConfirmPending: false, deleteConfirmChecked: false, deleteError: null });
  };

  render(): React.ReactElement {
    const { settings } = this.props;
    const { deleteConfirmPending, deleteConfirmChecked, deleteInFlight, deleteError } = this.state;
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

      // Retention (shown only when panel is enabled)
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
      ) : null,

      // Delete all chat history (always shown, even when panel is disabled)
      React.createElement('div', {
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
        }, 'Deletes every conversation across all sessions, including pinned sessions. Indexed content is unaffected — only chat messages are removed. This cannot be undone.'),

        // Error banner
        deleteError ? React.createElement('div', {
          style: {
            padding: '8px 12px',
            background: 'var(--nxai-error-bg)',
            border: '1px solid var(--nxai-danger-text)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--nxai-danger-text)',
            marginBottom: 12,
          },
        }, deleteError) : null,

        // Initial disclosure button
        !deleteConfirmPending ? React.createElement('button', {
          onClick: this.handleDeleteDisclosure,
          disabled: deleteInFlight,
          style: {
            padding: '6px 12px',
            fontSize: 13,
            borderRadius: 4,
            background: 'var(--nxai-card-bg)',
            border: '1px solid var(--nxai-input-border)',
            color: 'var(--nxai-card-text)',
            cursor: deleteInFlight ? 'not-allowed' : 'pointer',
            opacity: deleteInFlight ? 0.5 : 1,
          },
        }, deleteInFlight ? 'Deleting…' : 'Delete All') : null,

        // Confirmation panel with checkbox
        deleteConfirmPending ? React.createElement('div', {
          style: {
            padding: 12,
            background: 'var(--nxai-error-bg)',
            border: '1px solid var(--nxai-danger-text)',
            borderRadius: 6,
          },
        },
          React.createElement('div', {
            style: {
              fontSize: 12,
              marginBottom: 10,
              lineHeight: 1.55,
              color: 'var(--nxai-card-text)',
            },
          },
            React.createElement('strong', { style: { color: 'var(--nxai-danger-text)' } }, 'Permanently deletes:'),
            React.createElement('ul', {
              style: {
                margin: '5px 0 5px 16px',
                color: 'var(--nxai-card-sub)',
                fontSize: 11,
              },
            },
              React.createElement('li', null, 'All chat conversations and messages'),
              React.createElement('li', null, 'All chat sessions, including pinned ones'),
            ),
          ),
          React.createElement('label', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              cursor: 'pointer',
              marginBottom: 10,
            },
          },
            React.createElement('input', {
              type: 'checkbox',
              checked: deleteConfirmChecked,
              onChange: (e: any) => this.handleDeleteConfirmCheck(e.target.checked),
            }),
            'I understand — this cannot be undone',
          ),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', {
              disabled: !deleteConfirmChecked || deleteInFlight,
              onClick: this.handleDeleteConfirm,
              style: {
                padding: '6px 14px',
                borderRadius: 5,
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: !deleteConfirmChecked || deleteInFlight ? 'not-allowed' : 'pointer',
                background: !deleteConfirmChecked ? '#444' : 'var(--nxai-danger-text)',
                color: '#fff',
                opacity: !deleteConfirmChecked ? 0.5 : 1,
                fontFamily: 'inherit',
              },
            }, deleteInFlight ? 'Deleting…' : 'Delete Everything'),
            React.createElement('button', {
              onClick: this.handleCancelDelete,
              disabled: deleteInFlight,
              style: {
                padding: '6px 14px',
                borderRadius: 5,
                border: '1px solid var(--nxai-card-border)',
                fontSize: 12,
                background: 'var(--nxai-card-bg)',
                color: 'inherit',
                cursor: deleteInFlight ? 'not-allowed' : 'pointer',
                opacity: deleteInFlight ? 0.5 : 1,
                fontFamily: 'inherit',
              },
            }, 'Cancel'),
          ),
        ) : null,
      ),
    );
  }
}
