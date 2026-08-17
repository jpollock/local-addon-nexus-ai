/**
 * WP-08 · The host side of the policy registry: build a PermissionsSnapshot
 * from the live settings and stand up the ConstraintRegistry.
 *
 * TRANSLATION, NOT REIMPLEMENTATION. Every matrix cell is computed by
 * calling isOperationAllowed itself — the one function that IS the gate —
 * against getEffectiveSettings, the same resolution enforcement points use.
 * No permission semantics are restated here, so the mirror cannot drift
 * from the gate on resolution order, defaults, or environment matching.
 * The settings remain authoritative in v0: nothing reads this registry to
 * decide an allow/deny (the M4 eval family pins that enforcement surface).
 *
 * The one deliberate duplication: WHICH exception list is live copies the
 * gate's `?.length` precedence (remoteSiteExceptions unless empty, else
 * legacy wpeSiteExceptions) — two lines, pinned by a test that first proves
 * the gate honours the legacy list in that exact state.
 *
 * Non-fatal by construction: a failure here logs and degrades; it can never
 * break settings, enforcement, or startup.
 */
import {
  ConstraintRegistry,
  derivePermissionConstraints,
  comparePermissionMirror,
  loadLawDirectory,
  LawLoadError,
  MirrorDivergence,
  PermissionsSnapshot,
  PermissionsSnapshotException,
  RemoteEnv,
  RemoteOperation,
  RunbookLoadError,
  RunbookRegistry,
} from '../../intelligence';
import * as path from 'path';
import {
  getEffectiveSettings,
  isOperationAllowed,
} from '../mcp/utils/operation-permissions';

const OPERATIONS: readonly RemoteOperation[] = ['pull', 'wpcli_read', 'wpcli', 'push', 'delete'];
const ENVIRONMENTS: readonly RemoteEnv[] = ['development', 'staging', 'production'];

interface MinimalStorage {
  get(key: string): unknown;
}

interface MinimalLogger {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export function buildPermissionsSnapshot(storage: MinimalStorage): PermissionsSnapshot {
  const effective = getEffectiveSettings(storage);

  const matrix = Object.fromEntries(
    OPERATIONS.map((op) => [
      op,
      Object.fromEntries(
        ENVIRONMENTS.map((env) => [env, isOperationAllowed(op, env, effective)])
      ),
    ])
  ) as PermissionsSnapshot['matrix'];

  // The gate's own precedence: remoteSiteExceptions unless EMPTY, then the
  // legacy list (already normalised to targetRef form by getEffectiveSettings
  // when only the legacy key exists; normalised here for the both-keys edge).
  const rawExceptions = effective.remoteSiteExceptions?.length
    ? effective.remoteSiteExceptions
    : (effective.wpeSiteExceptions ?? []);
  const exceptions: PermissionsSnapshotException[] = rawExceptions.map((e: any) => ({
    targetRef: e.targetRef ?? `wpe:${e.installName}`,
    environment: e.environment,
    overrides: { ...e.overrides },
  }));

  return { matrix, exceptions };
}

export interface LawRegistryHandle {
  registry: ConstraintRegistry;
  /** Documents the loader rejected (path + reason); empty when the shipped law/ is intact. */
  loadErrors: LawLoadError[];
  /**
   * WP-20a: the procedure index, over the same documents. 20b (grants/arming)
   * and 20c (delivery) read it from here rather than re-loading the law
   * directory — one read, one set of refusals, one place a grant's pin comes
   * from.
   */
  runbooks: RunbookRegistry;
  /**
   * Runbooks that loaded as documents but were refused as procedures — over the
   * strict ceiling, or a contract that could not be honoured. Deliberately NOT
   * merged into `loadErrors`: the loader accepted these files, and a refusal is
   * not a corrupt-law-file report. Two entries are EXPECTED on the shipped set
   * today (`rb.incident-response`, `rb.staging-promotion` are over the 8 KB
   * ceiling and are split in WP-20c).
   */
  runbookErrors: RunbookLoadError[];
  /**
   * The v0 tripwire: rebuild a fresh snapshot from the settings and compare
   * it with what the registry mirrored at build time. Divergence should be
   * impossible in v0 — any hit is a mirror bug or settings changing beneath
   * a stale registry, and is logged as a warning naming both values.
   */
  verifyMirror(): MirrorDivergence[];
}

export function initLawRegistry(options: {
  storage: MinimalStorage;
  logger: MinimalLogger;
  /** Defaults to the addon's shipped law/ directory. */
  lawDir?: string;
  /**
   * WP-17: hand the failure REASON back to the caller so it can be persisted.
   * Logging it here and returning bare `undefined` left the health surface
   * able to say the mirror was missing but never why.
   */
  onFailure?: (message: string) => void;
}): LawRegistryHandle | undefined {
  const { storage, logger } = options;
  const warn = (msg: string) => (logger.warn ? logger.warn(msg) : logger.error(msg));
  try {
    // src/main/intelligence-host → package root is three levels up, and the
    // compiled lib/main/intelligence-host sits at the same depth.
    const lawDir = options.lawDir ?? path.resolve(__dirname, '..', '..', '..', 'law');
    const { documents, errors } = loadLawDirectory(lawDir);
    for (const err of errors) {
      logger.info(`[Intelligence] law loader rejected ${err.path || lawDir}: ${err.reason}`);
    }

    const snapshot = buildPermissionsSnapshot(storage);
    const registry = ConstraintRegistry.build({
      documents,
      derived: derivePermissionConstraints(snapshot),
    });
    logger.info(
      `[Intelligence] law registry loaded: ${registry.documents().length} document(s), ` +
        `${registry.constraints().length} constraint(s), permissions mirrored from live settings`
    );

    // WP-20a: the procedure index over the same documents. A refused runbook is
    // logged with its reason — a granted capability whose procedure did not load
    // is exactly the state §6(a) obliges the platform to disclose rather than
    // improvise past, and it must not be inferable only from a plausible-looking
    // loaded count.
    const runbooks = RunbookRegistry.build({ documents });
    const runbookErrors = runbooks.errors();
    for (const err of runbookErrors) {
      // The ID first, because that is what a grant names and therefore what
      // someone asking "why is this capability unavailable" greps for; the path
      // follows, because that is what they then have to open.
      logger.info(
        `[Intelligence] runbook refused ${err.runbookId ?? '(unidentified)'} ` +
          `[${err.path}] (${err.code}): ${err.reason}`
      );
    }
    logger.info(
      `[Intelligence] runbook registry: ${runbooks.runbooks().length} runbook(s) loaded, ` +
        `${runbookErrors.length} refused`
    );

    const verifyMirror = (): MirrorDivergence[] => {
      try {
        const divergences = comparePermissionMirror(registry, buildPermissionsSnapshot(storage));
        for (const d of divergences) {
          warn(
            `[Intelligence] policy registry diverged from live settings on ${d.constraintId}: ` +
              `registry=${JSON.stringify(d.registryValue)} live=${JSON.stringify(d.liveValue)}`
          );
        }
        return divergences;
      } catch (err) {
        logger.error(`[Intelligence] mirror verification failed: ${(err as Error).message}`);
        return [];
      }
    };

    return { registry, loadErrors: errors, runbooks, runbookErrors, verifyMirror };
  } catch (err) {
    const message = (err as Error).message;
    logger.error(`[Intelligence] law registry init failed: ${message}`);
    try {
      options.onFailure?.(message);
    } catch {
      /* a reporting hook must never widen the failure it reports */
    }
    return undefined;
  }
}
