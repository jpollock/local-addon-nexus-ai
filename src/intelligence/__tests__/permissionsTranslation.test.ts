/**
 * WP-08 · Translation of live wpeOperationPermissions into derived gateway
 * constraints. Translation, NOT reimplementation: the snapshot arrives
 * already resolved by the live gate (host side runs isOperationAllowed);
 * this module only mirrors it into constraint form and can detect when the
 * registry no longer matches a fresh snapshot.
 */
import { ConstraintRegistry } from '../law/registry';
import {
  comparePermissionMirror,
  derivePermissionConstraints,
  PermissionsSnapshot,
} from '../law/permissionsTranslation';

/** The shipped defaults of DEFAULT_OPERATION_PERMISSIONS, as a snapshot. */
const defaultSnapshot = (): PermissionsSnapshot => ({
  matrix: {
    pull:       { development: true,  staging: true,  production: true },
    wpcli_read: { development: true,  staging: true,  production: true },
    wpcli:      { development: true,  staging: true,  production: false },
    push:       { development: true,  staging: true,  production: false },
    delete:     { development: false, staging: false, production: false },
  },
  exceptions: [],
});

describe('derivePermissionConstraints', () => {
  it('derives the ops-default gateway constraints plus a full mirror record, all marked derivedFrom wpeOperationPermissions', () => {
    const constraints = derivePermissionConstraints(defaultSnapshot());

    expect(constraints.map((c) => c.id).sort()).toEqual([
      'c.delete-promote-opt-in',
      'c.permissions-mirror',
      'c.production-writes-off',
      'c.write-default-deny',
    ]);
    for (const c of constraints) {
      expect(c.enforcement).toBe('gateway');
      expect(c.derivedFrom).toBe('wpeOperationPermissions');
      expect(c.parameters).toBeDefined();
    }
  });

  it('mirrors the default matrix faithfully into each constraint slice', () => {
    const byId = new Map(derivePermissionConstraints(defaultSnapshot()).map((c) => [c.id, c]));

    expect(byId.get('c.production-writes-off')?.parameters).toEqual({
      wpcli_production: false,
      push_production: false,
    });
    expect(byId.get('c.delete-promote-opt-in')?.parameters).toEqual({
      delete: { development: false, staging: false, production: false },
    });
    expect(byId.get('c.write-default-deny')?.parameters).toEqual({
      write_operations: ['wpcli', 'push', 'delete'],
      matrix: {
        wpcli: { development: true, staging: true, production: false },
        push: { development: true, staging: true, production: false },
        delete: { development: false, staging: false, production: false },
      },
    });
    expect(byId.get('c.permissions-mirror')?.parameters).toEqual({
      matrix: defaultSnapshot().matrix,
      exceptions: [],
    });
  });

  it('mirrors a non-default live setting faithfully — the registry records what IS, not what the spec wishes', () => {
    const snapshot = defaultSnapshot();
    snapshot.matrix.wpcli.production = true; // user granted production WP-CLI writes

    const byId = new Map(derivePermissionConstraints(snapshot).map((c) => [c.id, c]));

    expect(byId.get('c.production-writes-off')?.parameters).toEqual({
      wpcli_production: true,
      push_production: false,
    });
    expect((byId.get('c.permissions-mirror')?.parameters as any).matrix.wpcli.production).toBe(true);
  });

  it('mirrors site exceptions into the mirror record', () => {
    const snapshot = defaultSnapshot();
    snapshot.exceptions = [
      { targetRef: 'wpe:goldenecomm', environment: 'production', overrides: { wpcli: true } },
    ];

    const byId = new Map(derivePermissionConstraints(snapshot).map((c) => [c.id, c]));

    expect((byId.get('c.permissions-mirror')?.parameters as any).exceptions).toEqual(
      snapshot.exceptions
    );
  });
});

describe('comparePermissionMirror', () => {
  const registryFor = (snapshot: PermissionsSnapshot) =>
    ConstraintRegistry.build({ documents: [], derived: derivePermissionConstraints(snapshot) });

  it('reports no divergence when the registry matches a fresh snapshot (the v0 invariant)', () => {
    const reg = registryFor(defaultSnapshot());

    expect(comparePermissionMirror(reg, defaultSnapshot())).toEqual([]);
  });

  it('reports a divergence carrying BOTH values when the live settings changed after the mirror was built', () => {
    const reg = registryFor(defaultSnapshot());
    const live = defaultSnapshot();
    live.matrix.push.production = true;

    const divergences = comparePermissionMirror(reg, live);

    expect(divergences.length).toBeGreaterThan(0);
    const mirror = divergences.find((d) => d.constraintId === 'c.permissions-mirror');
    expect(mirror).toBeDefined();
    expect((mirror?.registryValue as any).matrix.push.production).toBe(false);
    expect((mirror?.liveValue as any).matrix.push.production).toBe(true);
  });

  it('reports a divergence when the registry is missing a derived constraint entirely', () => {
    const reg = ConstraintRegistry.build({ documents: [], derived: [] });

    const divergences = comparePermissionMirror(reg, defaultSnapshot());

    expect(divergences.map((d) => d.constraintId).sort()).toEqual([
      'c.delete-promote-opt-in',
      'c.permissions-mirror',
      'c.production-writes-off',
      'c.write-default-deny',
    ]);
    expect(divergences[0].registryValue).toBeUndefined();
  });
});
