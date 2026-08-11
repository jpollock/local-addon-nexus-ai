import * as React from 'react';
import { NexusSettings, RemoteSiteException, WpeSiteException } from '../../../common/types';

interface WpeInstall {
  installName: string;
  environment: string;
  primaryDomain: string;
}

interface ExternalHost {
  alias: string;
  site: string;
  environment: string;
  domain: string;
}

interface WpeAccount {
  id: string;
  name: string;
  nickname?: string;
}

export interface PermissionsSectionProps {
  permissions: Partial<NexusSettings>;
  exceptions: RemoteSiteException[];
  wpeInstalls: WpeInstall[];
  externalHosts: ExternalHost[];
  wpeAccounts: WpeAccount[];
  onSave: (updates: Partial<NexusSettings>) => void;
}

interface PermissionsSectionState {
  addingException: { operation: Operation; targetRef: string; environment: string; allowing: boolean } | null;
  searchQuery: string;
}

const OPERATION_DEFAULTS = {
  pull:       { development: true,  staging: true,  production: true  },
  wpcli_read: { development: true,  staging: true,  production: true  },
  wpcli:      { development: true,  staging: true,  production: false },
  push:       { development: true,  staging: true,  production: false },
  delete:     { development: false, staging: false, production: false },
} as const;

type Operation = keyof typeof OPERATION_DEFAULTS;
type Environment = 'development' | 'staging' | 'production';

const GRID_ROWS: Array<{ id: Operation; label: string; scope: 'wpe' | 'both' }> = [
  { id: 'pull',   label: 'Copy a site down to this Mac', scope: 'wpe' },
  { id: 'wpcli',  label: 'Install or update things', scope: 'both' },
  { id: 'push',   label: 'Push local changes up', scope: 'wpe' },
  { id: 'delete', label: 'Delete or promote an environment', scope: 'wpe' },
];

const COLUMNS: Array<{ id: Environment; label: string }> = [
  { id: 'development', label: 'Local' },
  { id: 'staging',     label: 'Staging' },
  { id: 'production',  label: 'Production' },
];

export class PermissionsSection extends React.Component<PermissionsSectionProps, PermissionsSectionState> {
  state: PermissionsSectionState = {
    addingException: null,
    searchQuery: '',
  };

  /**
   * Merge remoteSiteExceptions (preferred) with legacy wpeSiteExceptions (fallback).
   * This implements Guards #7 and #8: if remoteSiteExceptions exists, use it; otherwise
   * fall back to wpeSiteExceptions converted to the new format.
   */
  private getEffectiveExceptions(): RemoteSiteException[] {
    const { permissions, exceptions } = this.props;

    // If exceptions prop is provided and non-empty, use it (SettingsShell already merged)
    if (exceptions && exceptions.length > 0) {
      return exceptions;
    }

    // Otherwise check settings
    if (permissions.remoteSiteExceptions && permissions.remoteSiteExceptions.length > 0) {
      return permissions.remoteSiteExceptions;
    }

    // Fallback to legacy wpeSiteExceptions (Guard #7)
    if (permissions.wpeSiteExceptions && permissions.wpeSiteExceptions.length > 0) {
      return permissions.wpeSiteExceptions.map((exc: WpeSiteException) => ({
        targetRef: `wpe:${exc.installName}`,
        environment: exc.environment,
        overrides: exc.overrides,
      }));
    }

    return [];
  }

  private getPermissionValue(op: Operation, env: Environment): boolean {
    const { permissions } = this.props;
    const perms = permissions.remoteOperationPermissions ?? {};
    const custom = perms[op]?.[env];
    return custom !== undefined ? custom : OPERATION_DEFAULTS[op][env];
  }

  private handleCellClick = (op: Operation, env: Environment): void => {
    const { permissions, onSave } = this.props;
    const currentValue = this.getPermissionValue(op, env);
    const newValue = !currentValue;

    const perms = { ...(permissions.remoteOperationPermissions ?? {}) };
    perms[op] = {
      ...OPERATION_DEFAULTS[op],
      ...(perms[op] ?? {}),
      [env]: newValue,
    };

    onSave({ remoteOperationPermissions: perms });
  };

  private handleRemoveException = (targetRef: string, environment: string): void => {
    const { permissions, onSave } = this.props;
    const current = this.getEffectiveExceptions();

    const updated = current.filter(
      (exc) => !(exc.targetRef === targetRef && exc.environment === environment),
    );

    // Guards #9 and #10: If we're removing the last legacy exception, also clear wpeSiteExceptions
    const isLegacy = permissions.wpeSiteExceptions && permissions.wpeSiteExceptions.length > 0
      && (!permissions.remoteSiteExceptions || permissions.remoteSiteExceptions.length === 0);

    if (isLegacy && updated.length === 0) {
      // Guard #9: removing the last legacy exception
      onSave({
        remoteSiteExceptions: [],
        wpeSiteExceptions: [],
      });
    } else if (isLegacy) {
      // Guard #10: removing one of multiple legacy exceptions
      onSave({
        remoteSiteExceptions: updated,
      });
    } else {
      // Normal case: just update remoteSiteExceptions
      onSave({
        remoteSiteExceptions: updated,
      });
    }
  };

  private handleSaveException = (): void => {
    const { addingException } = this.state;
    if (!addingException || !addingException.targetRef) return;

    const { permissions, onSave } = this.props;
    const current = this.getEffectiveExceptions();
    const { operation, targetRef, environment, allowing } = addingException;

    // Find or create the exception
    const existing = current.find(
      (exc) => exc.targetRef === targetRef && exc.environment === environment,
    );

    let updated: RemoteSiteException[];
    if (existing) {
      updated = current.map((exc) =>
        exc.targetRef === targetRef && exc.environment === environment
          ? { ...exc, overrides: { ...exc.overrides, [operation]: allowing } }
          : exc,
      );
    } else {
      updated = [
        ...current,
        { targetRef, environment, overrides: { [operation]: allowing } },
      ];
    }

    onSave({ remoteSiteExceptions: updated });
    this.setState({ addingException: null, searchQuery: '' });
  };

  private handleAccountScopeToggle = (accountId: string, included: boolean): void => {
    const { permissions, onSave, wpeAccounts } = this.props;
    const allIds = wpeAccounts.map((a) => a.id);
    const current: string[] = permissions.wpeAccountFilter ?? allIds;
    const updated = included
      ? [...new Set([...current, accountId])]
      : current.filter((id) => id !== accountId);

    onSave({ wpeAccountFilter: updated });
  };

  render(): React.ReactNode {
    const { wpeInstalls, externalHosts, wpeAccounts, permissions } = this.props;
    const { addingException, searchQuery } = this.state;
    const exceptions = this.getEffectiveExceptions();

    // Account scope calculation
    const accountFilter = permissions.wpeAccountFilter;
    const allAccountIds = wpeAccounts.map((a) => a.id);
    const includedIds: string[] = accountFilter ?? allAccountIds;
    const allIncluded = !accountFilter || includedIds.length === allAccountIds.length;

    return React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 24,
      },
    },
      // Heading and explanation
      React.createElement('div', {},
        React.createElement('h3', {
          style: {
            fontSize: 15,
            fontWeight: 600,
            margin: '0 0 8px 0',
            color: 'var(--nxai-card-text, #111827)',
          },
        }, 'What agents may do'),
        React.createElement('p', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub, #6b7280)',
            margin: 0,
          },
        }, 'Reading a site is always allowed. The grid below controls writing.'),
      ),

      // Account scope filter
      wpeAccounts.length > 0 ? React.createElement('div', {},
        React.createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            marginBottom: 8,
          },
        },
          React.createElement('span', {
            style: {
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.08em',
              color: 'var(--nxai-card-sub, #6b7280)',
            },
          }, 'Account scope'),
          React.createElement('span', {
            style: {
              fontSize: 11,
              color: 'var(--nxai-card-sub, #6b7280)',
            },
          }, '— click to include / exclude accounts from the permissions below'),
        ),
        React.createElement('div', {
          style: {
            display: 'flex',
            flexWrap: 'wrap' as const,
            gap: 6,
            padding: '10px 12px',
            background: 'var(--nxai-card-bg, #ffffff)',
            border: '1px solid var(--nxai-card-border, #e5e7eb)',
            borderRadius: 6,
            maxHeight: 110,
            overflowY: 'auto' as const,
          },
        },
          ...wpeAccounts.map((a) => {
            const on = allIncluded || includedIds.includes(a.id);
            return React.createElement('span', {
              key: a.id,
              title: `Click to ${on ? 'exclude' : 'include'} ${a.nickname ?? a.name}`,
              onClick: () => this.handleAccountScopeToggle(a.id, !on),
              style: {
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                userSelect: 'none' as const,
                background: on ? 'rgba(81,187,123,0.12)' : 'rgba(128,128,128,0.06)',
                color: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)',
                border: on ? '1px solid rgba(81,187,123,0.3)' : '1px dashed var(--nxai-card-border, #e5e7eb)',
                opacity: on ? 1 : 0.6,
              },
            },
              React.createElement('span', { style: { fontSize: 9 } }, on ? '✓' : '✗'),
              a.nickname ?? a.name ?? a.id,
            );
          }),
        ),
      ) : null,

      // 4×3 Grid
      React.createElement('div', {},
        React.createElement('h4', {
          style: {
            fontSize: 13,
            fontWeight: 600,
            margin: '0 0 8px 0',
            color: 'var(--nxai-card-text, #111827)',
          },
        }, 'Operation Permissions'),
        React.createElement('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: '1fr auto auto auto',
            gap: 1,
            background: 'var(--nxai-card-border, #e5e7eb)',
            border: '1px solid var(--nxai-card-border, #e5e7eb)',
            borderRadius: 6,
            overflow: 'hidden',
          },
        },
          // Header row
          React.createElement('div', {
            style: {
              background: 'var(--nxai-section-bg, #f9fafb)',
              padding: '8px 12px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--nxai-card-sub, #6b7280)',
            },
          }),
          ...COLUMNS.map((col) =>
            React.createElement('div', {
              key: col.id,
              style: {
                background: 'var(--nxai-section-bg, #f9fafb)',
                padding: '8px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--nxai-card-sub, #6b7280)',
                textAlign: 'center' as const,
              },
            }, col.label),
          ),
          // Data rows
          ...GRID_ROWS.flatMap((row) => [
            React.createElement('div', {
              key: `${row.id}-label`,
              style: {
                background: 'var(--nxai-card-bg, #ffffff)',
                padding: '12px',
                fontSize: 13,
                color: 'var(--nxai-card-text, #111827)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              },
            },
              React.createElement('span', {}, row.label),
              React.createElement('span', {
                style: {
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  padding: '2px 6px',
                  borderRadius: 3,
                  textTransform: 'uppercase' as const,
                  background: row.scope === 'wpe' ? 'rgba(224,164,88,0.14)' : 'rgba(90,169,230,0.16)',
                  color: row.scope === 'wpe' ? '#e0a458' : '#5aa9e6',
                },
              }, row.scope === 'wpe' ? 'WPE only' : 'WPE + SSH'),
            ),
            ...COLUMNS.map((col) => {
              const allowed = this.getPermissionValue(row.id, col.id);
              const isProduction = col.id === 'production';
              const isRisky = isProduction && ['push', 'delete'].includes(row.id);

              return React.createElement('button', {
                key: `${row.id}-${col.id}`,
                onClick: () => this.handleCellClick(row.id, col.id),
                style: {
                  background: 'var(--nxai-card-bg, #ffffff)',
                  border: 'none',
                  padding: '12px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: allowed
                    ? (isRisky ? '#d97706' : '#51BB7B')
                    : '#f87171',
                  cursor: 'pointer',
                  textAlign: 'center' as const,
                  fontFamily: 'inherit',
                },
              }, allowed ? 'Allowed' : 'Blocked');
            }),
          ]),
        ),
      ),

      // Exceptions section
      exceptions.length > 0 ? React.createElement('div', {},
        React.createElement('h4', {
          style: {
            fontSize: 13,
            fontWeight: 600,
            margin: '0 0 8px 0',
            color: 'var(--nxai-card-text, #111827)',
          },
        }, 'Site exceptions'),
        React.createElement('div', {
          style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 6,
          },
        },
          ...exceptions.map((exc) =>
            React.createElement('div', {
              key: `${exc.targetRef}-${exc.environment}`,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'var(--nxai-card-bg, #ffffff)',
                border: '1px solid var(--nxai-card-border, #e5e7eb)',
                borderRadius: 6,
                fontSize: 12,
              },
            },
              React.createElement('span', {
                style: { fontWeight: 500, flex: 1 },
              }, exc.targetRef),
              React.createElement('span', {
                style: {
                  fontSize: 10,
                  color: 'var(--nxai-card-sub, #6b7280)',
                  background: 'var(--nxai-section-bg, #f9fafb)',
                  padding: '2px 6px',
                  borderRadius: 4,
                },
              }, exc.environment),
              ...Object.entries(exc.overrides).map(([op, val]) =>
                React.createElement('span', {
                  key: op,
                  style: {
                    fontSize: 10,
                    fontWeight: 700,
                    color: val ? '#51BB7B' : '#f87171',
                  },
                }, `${op}: ${val ? 'allow' : 'block'}`),
              ),
              React.createElement('span', {
                onClick: (e: React.MouseEvent) => {
                  e.stopPropagation();
                  this.handleRemoveException(exc.targetRef, exc.environment);
                },
                style: {
                  color: 'var(--nxai-status-neutral, #9ca3af)',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: '0 4px',
                  lineHeight: 1,
                },
              }, '×'),
            ),
          ),
        ),
      ) : null,

      // Add exception button (always visible)
      React.createElement('div', {},
        !addingException ? React.createElement('button', {
          onClick: () => this.setState({
            addingException: {
              operation: 'wpcli',
              targetRef: '',
              environment: 'production',
              allowing: false,
            },
          }),
          style: {
            background: 'none',
            border: 'none',
            fontSize: 12,
            color: 'var(--nxai-accent, #0a8189)',
            cursor: 'pointer',
            padding: '4px 0',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          },
        }, '+ Add site exception') : null,

        // Exception picker
        addingException ? React.createElement('div', {
          style: {
            background: 'var(--nxai-card-bg, #ffffff)',
            border: '1px solid rgba(59,130,246,0.4)',
            borderRadius: 6,
            padding: '12px',
          },
        },
          React.createElement('input', {
            type: 'text',
            placeholder: 'Search installs and SSH hosts…',
            value: searchQuery,
            autoFocus: true,
            onChange: (e: any) => this.setState({ searchQuery: e.target.value }),
            style: {
              width: '100%',
              fontSize: 12,
              padding: '8px 10px',
              background: 'var(--nxai-code-bg, #f3f4f6)',
              border: '1px solid var(--nxai-card-border, #e5e7eb)',
              borderRadius: 4,
              color: 'var(--nxai-card-text, #111827)',
              fontFamily: 'inherit',
              marginBottom: 8,
            },
          }),
          React.createElement('div', {
            style: {
              maxHeight: 180,
              overflowY: 'auto' as const,
              display: 'flex',
              flexDirection: 'column' as const,
              gap: 2,
              marginBottom: 10,
            },
          },
            (() => {
              const q = searchQuery.toLowerCase();
              const wpeMatches = wpeInstalls.filter(
                (i) => !q || i.installName.toLowerCase().includes(q) || i.primaryDomain.toLowerCase().includes(q),
              ).slice(0, 30);
              const externalMatches = externalHosts.filter(
                (h) => !q || h.alias.toLowerCase().includes(q) || h.site.toLowerCase().includes(q) || h.domain.toLowerCase().includes(q),
              ).slice(0, 30);

              const renderPick = (targetRef: string, label: string, environment: string, kind: 'wpe' | 'ssh') => {
                const isSelected = addingException?.targetRef === targetRef;
                const envColor = environment === 'production' ? '#f87171' : environment === 'staging' ? '#fbbf24' : '#51BB7B';
                return React.createElement('div', {
                  key: targetRef,
                  onClick: () => this.setState((prev) => ({
                    addingException: prev.addingException ? { ...prev.addingException, targetRef, environment } : null,
                  })),
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(59,130,246,0.15)' : 'transparent',
                    border: isSelected ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                  },
                },
                  React.createElement('div', {
                    style: {
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: envColor,
                      flexShrink: 0,
                    },
                  }),
                  React.createElement('span', {
                    style: { flex: 1, fontSize: 12, fontWeight: 500 },
                  }, label),
                  React.createElement('span', {
                    style: {
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      padding: '2px 5px',
                      borderRadius: 3,
                      textTransform: 'uppercase' as const,
                      background: kind === 'wpe' ? 'rgba(224,164,88,0.14)' : 'rgba(90,169,230,0.16)',
                      color: kind === 'wpe' ? '#e0a458' : '#5aa9e6',
                    },
                  }, kind),
                  React.createElement('span', {
                    style: {
                      fontSize: 10,
                      color: 'var(--nxai-card-sub, #6b7280)',
                    },
                  }, environment),
                  isSelected ? React.createElement('span', {
                    style: { fontSize: 10, color: '#3b82f6' },
                  }, '✓') : null,
                );
              };

              const groupLabel = (text: string) => React.createElement('div', {
                key: `grp-${text}`,
                style: {
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase' as const,
                  color: 'var(--nxai-card-sub, #6b7280)',
                  padding: '8px 4px 4px',
                  fontWeight: 600,
                },
              }, text);

              if (wpeMatches.length === 0 && externalMatches.length === 0) {
                return [React.createElement('div', {
                  key: 'empty',
                  style: {
                    fontSize: 11,
                    color: 'var(--nxai-status-neutral, #9ca3af)',
                    padding: '8px 4px',
                    fontStyle: 'italic' as const,
                  },
                }, 'No installs or hosts found')];
              }

              const out: React.ReactNode[] = [];
              if (wpeMatches.length > 0) {
                out.push(groupLabel('WP Engine installs'));
                out.push(...wpeMatches.map((i) => renderPick(`wpe:${i.installName}`, i.installName, i.environment, 'wpe')));
              }
              if (externalMatches.length > 0) {
                out.push(groupLabel('External SSH hosts'));
                out.push(...externalMatches.map((h) => renderPick(`ssh:${h.alias}/${h.site}`, `${h.alias}/${h.site}`, h.environment, 'ssh')));
              }
              return out;
            })(),
          ),
          React.createElement('div', {
            style: {
              borderTop: '1px solid var(--nxai-card-border, #e5e7eb)',
              paddingTop: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            },
          },
            addingException.targetRef
              ? React.createElement('span', {
                  style: { fontSize: 11, flex: 1 },
                },
                  React.createElement('strong', {}, addingException.targetRef),
                  ' · ',
                  React.createElement('span', {
                    style: { color: 'var(--nxai-card-sub, #6b7280)' },
                  }, addingException.environment),
                )
              : React.createElement('span', {
                  style: {
                    fontSize: 11,
                    color: 'var(--nxai-status-neutral, #9ca3af)',
                    flex: 1,
                    fontStyle: 'italic' as const,
                  },
                }, 'Select an install or host above'),
            React.createElement('label', {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                cursor: 'pointer',
              },
            },
              React.createElement('input', {
                type: 'checkbox',
                checked: addingException.allowing,
                onChange: (e: any) => {
                  const v = e.target.checked;
                  this.setState((prev) => ({
                    addingException: prev.addingException ? { ...prev.addingException, allowing: v } : null,
                  }));
                },
              }),
              React.createElement('span', {
                style: {
                  color: addingException.allowing ? '#51BB7B' : '#f87171',
                  fontWeight: 600,
                },
              }, addingException.allowing ? 'Allow' : 'Block'),
            ),
            React.createElement('button', {
              disabled: !addingException.targetRef,
              onClick: () => this.handleSaveException(),
              style: {
                fontSize: 11,
                padding: '6px 12px',
                background: addingException.targetRef ? '#3b82f6' : 'var(--nxai-status-neutral, #9ca3af)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: addingException.targetRef ? 'pointer' : 'not-allowed',
                opacity: addingException.targetRef ? 1 : 0.5,
                fontFamily: 'inherit',
                fontWeight: 600,
              },
            }, 'Save'),
            React.createElement('button', {
              onClick: () => this.setState({ addingException: null, searchQuery: '' }),
              style: {
                fontSize: 11,
                padding: '6px 12px',
                background: 'none',
                border: '1px solid var(--nxai-card-border, #e5e7eb)',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--nxai-card-sub, #6b7280)',
                fontFamily: 'inherit',
              },
            }, 'Cancel'),
          ),
        ) : null,
      ),
    );
  }
}
