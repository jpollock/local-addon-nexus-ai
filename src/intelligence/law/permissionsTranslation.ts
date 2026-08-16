/**
 * wpeOperationPermissions → derived gateway constraints (WP-08).
 *
 * Translation, NOT reimplementation. The PermissionsSnapshot arrives already
 * resolved by the live gate — the host side computes every matrix cell by
 * calling isOperationAllowed itself (src/main/intelligence-host/
 * permissionsMirror.ts), so no permission semantics exist on this side of
 * the seam. The settings remain authoritative in v0: nothing here, and
 * nothing reading the registry, participates in an allow/deny decision.
 *
 * comparePermissionMirror is the tripwire the acceptance criteria demand:
 * registry-vs-live divergence should be impossible in v0 (the registry is
 * generated from the same snapshot it is compared against), so any
 * divergence it reports is evidence of a mirror bug or of settings changing
 * after the mirror was built — either way, worth a warning naming both values.
 */
import { ConstraintRegistry } from './registry';
import { Constraint } from './types';

export type RemoteOperation = 'pull' | 'wpcli_read' | 'wpcli' | 'push' | 'delete';
export type RemoteEnv = 'development' | 'staging' | 'production';

export const WRITE_OPERATIONS: readonly RemoteOperation[] = ['wpcli', 'push', 'delete'];
export const PERMISSIONS_SETTINGS_SOURCE = 'wpeOperationPermissions';
/** docId stamped on derived constraints — names the settings surface, not a law file. */
export const PERMISSIONS_DOC_ID = 'settings.wpeOperationPermissions';

export interface PermissionsSnapshotException {
  targetRef: string;
  environment: string;
  overrides: Partial<Record<RemoteOperation, boolean>>;
}

/** The live gate's answers, resolved: matrix[op][env] === isOperationAllowed(op, env, settings). */
export interface PermissionsSnapshot {
  matrix: Record<RemoteOperation, Record<RemoteEnv, boolean>>;
  exceptions: PermissionsSnapshotException[];
}

export interface MirrorDivergence {
  constraintId: string;
  registryValue: unknown;
  liveValue: unknown;
}

const derivedConstraint = (
  id: string,
  rule: string,
  parameters: Record<string, unknown>
): Constraint => ({
  id,
  rule,
  enforcement: 'gateway',
  origin: 'expertise',
  docId: PERMISSIONS_DOC_ID,
  docVersion: 'live',
  scope: 'tenant',
  derivedFrom: PERMISSIONS_SETTINGS_SOURCE,
  parameters,
});

export function derivePermissionConstraints(snapshot: PermissionsSnapshot): Constraint[] {
  const { matrix, exceptions } = snapshot;
  return [
    derivedConstraint(
      'c.write-default-deny',
      'Write operations against any environment are denied unless a capability grant allows them.',
      {
        write_operations: [...WRITE_OPERATIONS],
        matrix: {
          wpcli: { ...matrix.wpcli },
          push: { ...matrix.push },
          delete: { ...matrix.delete },
        },
      }
    ),
    derivedConstraint(
      'c.production-writes-off',
      'Production writes (push, WP-CLI write, CAPI write) are off by default; enabling is a settings/grant change, never a conversation outcome.',
      {
        wpcli_production: matrix.wpcli.production,
        push_production: matrix.push.production,
      }
    ),
    derivedConstraint(
      'c.delete-promote-opt-in',
      'Delete and promote are disabled for ALL environments unless explicitly opted in; they are gated by operation type, not by environment.',
      { delete: { ...matrix.delete } }
    ),
    derivedConstraint(
      'c.permissions-mirror',
      'Complete mirror of the live remote operation permissions (resolved matrix and site exceptions), recorded for audit and assembly — never consulted for enforcement.',
      {
        matrix: Object.fromEntries(
          (Object.keys(matrix) as RemoteOperation[]).map((op) => [op, { ...matrix[op] }])
        ),
        exceptions: exceptions.map((e) => ({ ...e, overrides: { ...e.overrides } })),
      }
    ),
  ];
}

export function comparePermissionMirror(
  registry: ConstraintRegistry,
  live: PermissionsSnapshot
): MirrorDivergence[] {
  const divergences: MirrorDivergence[] = [];
  for (const expected of derivePermissionConstraints(live)) {
    const held = registry.byId(expected.id);
    const registryValue = held?.derivedFrom === PERMISSIONS_SETTINGS_SOURCE ? held.parameters : undefined;
    if (JSON.stringify(registryValue) !== JSON.stringify(expected.parameters)) {
      divergences.push({
        constraintId: expected.id,
        registryValue,
        liveValue: expected.parameters,
      });
    }
  }
  return divergences;
}
