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

export interface PermissionsSectionProps {
  permissions: Partial<NexusSettings>;
  exceptions: RemoteSiteException[];
  wpeInstalls: WpeInstall[];
  externalHosts: ExternalHost[];
  onSave: (updates: Partial<NexusSettings>) => void;
}

interface PermissionsSectionState {
  addingException: { targetRef: string; environment: string; allowing: boolean } | null;
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

const GRID_ROWS: Array<{ id: Operation; label: string }> = [
  { id: 'pull',   label: 'Copy a site down to this Mac' },
  { id: 'wpcli',  label: 'Install or update things' },
  { id: 'push',   label: 'Push local changes up' },
  { id: 'delete', label: 'Delete or promote an environment' },
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

  private handleAddException = (targetRef: string, environment: string, allowing: boolean, op: Operation): void => {
    const { permissions, onSave } = this.props;
    const current = this.getEffectiveExceptions();

    // Find or create the exception
    const existing = current.find(
      (exc) => exc.targetRef === targetRef && exc.environment === environment,
    );

    let updated: RemoteSiteException[];
    if (existing) {
      updated = current.map((exc) =>
        exc.targetRef === targetRef && exc.environment === environment
          ? { ...exc, overrides: { ...exc.overrides, [op]: allowing } }
          : exc,
      );
    } else {
      updated = [
        ...current,
        { targetRef, environment, overrides: { [op]: allowing } },
      ];
    }

    onSave({ remoteSiteExceptions: updated });
    this.setState({ addingException: null, searchQuery: '' });
  };

  render(): React.ReactNode {
    const { wpeInstalls, externalHosts } = this.props;
    const { addingException, searchQuery } = this.state;
    const exceptions = this.getEffectiveExceptions();

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

      // 4×3 Grid
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
            },
          }, row.label),
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

      // Add exception UI (simplified for now — full picker to be added)
      addingException ? React.createElement('div', {
        style: {
          padding: 12,
          background: 'var(--nxai-card-bg, #ffffff)',
          border: '1px solid var(--nxai-card-border, #e5e7eb)',
          borderRadius: 6,
        },
      }, 'Exception picker UI (to be implemented)') : null,
    );
  }
}
