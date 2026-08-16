/**
 * WP-08 · permissionsMirror — the host side of the policy registry.
 *
 * The load-bearing pin here is AGREEMENT WITH THE LIVE GATE: every matrix
 * cell in the snapshot must equal what isOperationAllowed answers for the
 * same (operation, environment) against the same settings. The snapshot is
 * computed BY calling isOperationAllowed, so this is a translation test,
 * not a reimplementation test — if the gate's semantics ever change, the
 * mirror follows automatically and these assertions keep holding.
 */
import * as path from 'path';
import {
  isOperationAllowed,
  getEffectiveSettings,
  DEFAULT_OPERATION_PERMISSIONS,
} from '../../mcp/utils/operation-permissions';
import { STORAGE_KEYS } from '../../../common/constants';
import { buildPermissionsSnapshot, initLawRegistry } from '../permissionsMirror';

const OPS = ['pull', 'wpcli_read', 'wpcli', 'push', 'delete'] as const;
const ENVS = ['development', 'staging', 'production'] as const;

const storageWith = (settings: Record<string, unknown>) => ({
  get: (key: string) => (key === STORAGE_KEYS.SETTINGS ? settings : undefined),
});

const REPO_LAW_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'law');

const makeLogger = () => {
  const lines = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  return {
    lines,
    info: (msg: string) => lines.info.push(msg),
    warn: (msg: string) => lines.warn.push(msg),
    error: (msg: string) => lines.error.push(msg),
  };
};

describe('buildPermissionsSnapshot', () => {
  const pinAgreementWithLiveGate = (settings: Record<string, unknown>) => {
    const storage = storageWith(settings);
    const snapshot = buildPermissionsSnapshot(storage);
    const effective = getEffectiveSettings(storage);
    for (const op of OPS) {
      for (const env of ENVS) {
        expect({ op, env, allowed: snapshot.matrix[op][env] }).toEqual({
          op,
          env,
          allowed: isOperationAllowed(op, env, effective),
        });
      }
    }
    return snapshot;
  };

  it('every matrix cell equals the live gate answer under default settings', () => {
    const snapshot = pinAgreementWithLiveGate({});
    expect(snapshot.matrix).toEqual(DEFAULT_OPERATION_PERMISSIONS);
    expect(snapshot.exceptions).toEqual([]);
  });

  it('reflects custom remoteOperationPermissions through the live gate', () => {
    const snapshot = pinAgreementWithLiveGate({
      remoteOperationPermissions: { wpcli: { production: true } },
    });
    expect(snapshot.matrix.wpcli.production).toBe(true);
  });

  it('reflects legacy wpeOperationPermissions via the live migration path', () => {
    const snapshot = pinAgreementWithLiveGate({
      wpeOperationPermissions: { push: { development: true, staging: false, production: false } },
    });
    expect(snapshot.matrix.push.staging).toBe(false);
  });

  it('reflects legacy wpeAllowedEnvironments through both migration layers', () => {
    const snapshot = pinAgreementWithLiveGate({ wpeAllowedEnvironments: ['development'] });
    expect(snapshot.matrix.wpcli.staging).toBe(false);
    expect(snapshot.matrix.wpcli.development).toBe(true);
  });

  it('normalises legacy wpeSiteExceptions to targetRef form', () => {
    const snapshot = buildPermissionsSnapshot(
      storageWith({
        wpeSiteExceptions: [
          { installName: 'goldenecomm', environment: 'production', overrides: { wpcli: true } },
        ],
      })
    );
    expect(snapshot.exceptions).toEqual([
      { targetRef: 'wpe:goldenecomm', environment: 'production', overrides: { wpcli: true } },
    ]);
  });

  it('an empty remoteSiteExceptions array does not shadow legacy exceptions the gate still honours (?.length precedence pin)', () => {
    const settings = {
      remoteSiteExceptions: [],
      wpeSiteExceptions: [
        { installName: 'goldenecomm', environment: 'production', overrides: { wpcli: true } },
      ],
    };
    const storage = storageWith(settings);

    // Prove the gate honours the legacy exception in this exact state…
    expect(
      isOperationAllowed('wpcli', 'production', getEffectiveSettings(storage), 'goldenecomm')
    ).toBe(true);
    // …so the mirror must list it.
    expect(buildPermissionsSnapshot(storage).exceptions).toEqual([
      { targetRef: 'wpe:goldenecomm', environment: 'production', overrides: { wpcli: true } },
    ]);
  });
});

describe('initLawRegistry', () => {
  it('loads the shipped law/ and overlays live-derived parameters onto the ops-default gateway constraints', () => {
    const logger = makeLogger();
    const handle = initLawRegistry({ storage: storageWith({}), logger, lawDir: REPO_LAW_DIR });

    expect(handle).toBeDefined();
    expect(handle!.loadErrors).toEqual([]);
    expect(handle!.registry.documents().map((d) => d.id)).toContain('pol.ops-default');

    const prodWrites = handle!.registry.byId('c.production-writes-off');
    expect(prodWrites?.derivedFrom).toBe('wpeOperationPermissions');
    expect(prodWrites?.parameters).toEqual({ wpcli_production: false, push_production: false });
    // The authored, human-reviewed rule text is kept — not generated text.
    expect(prodWrites?.rule).toContain('never a conversation outcome');

    // Registry-only mirror record appended alongside the authored law.
    expect(handle!.registry.byId('c.permissions-mirror')?.parameters).toBeDefined();

    // Non-permission-shaped constraints stay purely authored.
    expect(handle!.registry.byId('c.backup-before-overwrite')?.derivedFrom).toBeUndefined();
    expect(handle!.registry.byId('c.maintenance-window')?.enforcement).toBe('ambient');
  });

  it('verifyMirror is clean and silent while the settings are unchanged (the v0 invariant)', () => {
    const logger = makeLogger();
    const handle = initLawRegistry({ storage: storageWith({}), logger, lawDir: REPO_LAW_DIR });

    expect(handle!.verifyMirror()).toEqual([]);
    expect(logger.lines.warn).toEqual([]);
  });

  it('verifyMirror warns with BOTH values once the settings change beneath the registry', () => {
    const logger = makeLogger();
    const settings: Record<string, unknown> = {};
    const handle = initLawRegistry({ storage: storageWith(settings), logger, lawDir: REPO_LAW_DIR });

    settings.remoteOperationPermissions = { push: { production: true } };

    const divergences = handle!.verifyMirror();
    expect(divergences.length).toBeGreaterThan(0);
    expect(divergences.map((d) => d.constraintId)).toContain('c.production-writes-off');

    const warning = logger.lines.warn.join('\n');
    expect(warning).toContain('c.production-writes-off');
    expect(warning).toContain('"push_production":false'); // what the registry holds
    expect(warning).toContain('"push_production":true'); // what the settings now say
  });

  it('a missing law directory still yields a registry carrying the derived mirror (non-fatal)', () => {
    const logger = makeLogger();
    const handle = initLawRegistry({
      storage: storageWith({}),
      logger,
      lawDir: path.join(REPO_LAW_DIR, 'does-not-exist'),
    });

    expect(handle).toBeDefined();
    expect(handle!.loadErrors.length).toBeGreaterThan(0);
    expect(handle!.registry.byId('c.permissions-mirror')).toBeDefined();
  });

  it('a throwing storage never throws out of init', () => {
    const logger = makeLogger();
    const handle = initLawRegistry({
      storage: {
        get: () => {
          throw new Error('storage exploded');
        },
      },
      logger,
      lawDir: REPO_LAW_DIR,
    });

    expect(handle).toBeUndefined();
    expect(logger.lines.error.length).toBeGreaterThan(0);
  });
});
