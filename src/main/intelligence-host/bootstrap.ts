/**
 * Intelligence core bootstrap — the host side of the ADR-16 seam.
 *
 * Implements HostPorts with real addon facilities and returns a tap function
 * for HttpEventInterface.onEvent. EVERYTHING here is non-fatal by
 * construction: if the ledger cannot initialize, the tap is undefined and the
 * existing event pipeline is completely unaffected.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  Ledger,
  createEmitter,
  Emitter,
  EntityService,
  TwinStore,
  catchUp,
  createStateTwinFold,
  createPipelineStatusFold,
  Fold,
  IdentityPort,
  ulid,
} from '../../intelligence';
import { draftFromWpEvent } from './wpEventProducer';
import { initLawRegistry, LawRegistryHandle } from './permissionsMirror';
import { syncCapabilityGrants } from './capabilityGrants';

export type WpEventTap = (
  siteId: string,
  eventType: string,
  payload: Record<string, unknown>
) => void;

export interface IntelligenceCore {
  ledger: Ledger;
  emitter: Emitter;
  twins: TwinStore;
  /**
   * The folds this core actually catches up (WP-17). Exported so the health
   * surface measures fold lag against what is WIRED rather than against a
   * hand-maintained list — a fold added here is monitored the same day, and a
   * fold that is registered but never drained is exactly the class of silent
   * failure this packet exists to make visible.
   */
  folds: Fold[];
  /**
   * Identity spine (WP-07). OPTIONAL by construction: an entity-service
   * failure must never take the core down, so consumers fall back to the
   * provisional-id derivation (which mints the identical ids) when absent.
   */
  entities?: EntityService;
  /**
   * Policy registry v0 (WP-08). OPTIONAL by construction like the entity
   * service: it OBSERVES the live wpeOperationPermissions (translation, not
   * enforcement — no allow/deny reads it in v0), so its absence costs only
   * the mirror, never the gate.
   */
  law?: LawRegistryHandle;
  /**
   * The session identity (ADR-14). Exposed at WP-19 because the gateway
   * producer is the first consumer of `actor()` — every event before it was
   * emitted by a named system actor, so only `via()` was ever read. OPTIONAL
   * so a test double built from a partial core keeps working.
   */
  identity?: IdentityPort;
  tap: WpEventTap;
  /** Debounced fold catch-up — producers call this after emitting. */
  scheduleFolds: () => void;
  close: () => void;
}

interface MinimalStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

interface MinimalLogger {
  info: (msg: string) => void;
  /** Optional: the mirror-divergence tripwire prefers warn, falls back to error. */
  warn?: (msg: string) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

const SATELLITE_ID_KEY = 'intelligence_satellite_id';
const FOLD_DEBOUNCE_MS = 500;

/**
 * WP-17 · Init outcomes are PERSISTED, not just logged.
 *
 * The M1 ABI incident ran for hours with green tests, a working app and a dark
 * ledger: init had failed, said so once in a log nobody was reading, and left
 * no trace any later session could find. A boot that fails must be visible
 * from the boot that succeeds — so the last failure (with its stage and
 * reason) and the last success are written here and read back by the health
 * surface.
 *
 * Owned by this module, per the storage-marker rule in CLAUDE.md; every other
 * reader goes through `getIntelligenceInitState()`. This is the ONLY write in
 * the whole health feature — the health surface itself is strictly read-only.
 */
const INIT_STATE_KEY = 'intelligence_init_state';

export type InitStage = 'core' | 'entity-service' | 'law-registry';

export interface IntelligenceInitFailure {
  /** ISO timestamp of the failure. */
  at: string;
  stage: InitStage;
  message: string;
}

export interface IntelligenceInitState {
  /** The LAST recorded failure, from ANY boot. Never cleared by a later success —
   *  that persistence is the whole point; the reader renders it with its age. */
  last_failure?: IntelligenceInitFailure;
  /** ISO timestamp of the last boot that completed core init. */
  last_success_at?: string;
}

/** In-process mirror of the persisted state, so readers need no storage handle. */
let initState: IntelligenceInitState = {};

/**
 * What the last boots recorded. Populated at the top of `initIntelligenceCore`
 * from storage, so a failure written by a PREVIOUS process is readable from
 * this one. Empty when init has never been attempted in this process.
 */
export function getIntelligenceInitState(): IntelligenceInitState {
  return initState;
}

function loadInitState(storage: MinimalStorage): IntelligenceInitState {
  try {
    const raw = storage.get(INIT_STATE_KEY);
    return raw && typeof raw === 'object' ? (raw as IntelligenceInitState) : {};
  } catch {
    return {}; // a storage read must never be the thing that breaks startup
  }
}

function writeInitState(storage: MinimalStorage, next: IntelligenceInitState): void {
  initState = next;
  try {
    storage.set(INIT_STATE_KEY, next);
  } catch {
    /* best effort: the in-process mirror still carries it for this session */
  }
}

function recordInitFailure(
  storage: MinimalStorage,
  stage: InitStage,
  err: unknown,
  now: Date
): void {
  writeInitState(storage, {
    ...initState,
    last_failure: { at: now.toISOString(), stage, message: String((err as Error)?.message ?? err) },
  });
}

export function initIntelligenceCore(options: {
  storage: MinimalStorage;
  logger: MinimalLogger;
  dataDir: string;
}): IntelligenceCore | undefined {
  const { storage, logger, dataDir } = options;
  // Read FIRST: a failure recorded by an earlier process must be visible from
  // this one, whether or not this one succeeds.
  initState = loadInitState(storage);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const ledger = new Ledger(path.join(dataDir, 'ledger.db'));

    // ADR-14: satellite = machine identity; stable across restarts.
    let satelliteId = storage.get(SATELLITE_ID_KEY) as string | null;
    if (!satelliteId) {
      satelliteId = `sat_${ulid()}`;
      storage.set(SATELLITE_ID_KEY, satelliteId);
    }

    const identity: IdentityPort = {
      // v1 session identity: the OS user, until real session auth exists
      // (architecture doc §11 watch item 4).
      actor: () => ({ id: `act_${sanitize(os.userInfo().username)}`, kind: 'human' }),
      via: () => satelliteId as string,
      tenant: () => 'local', // ADR-11: single-tenant until the hub exists
    };

    const emitter = createEmitter({
      ledger,
      clock: { now: () => new Date() },
      identity,
    });

    // Declared here, assigned below (WP-21b): the drift emitter closes over it
    // to traverse the Site role, and the fold only ever runs from
    // `scheduleFolds`, long after the assignment — but the declaration must
    // precede the closure or that read is a temporal-dead-zone throw.
    let entities: EntityService | undefined;

    /**
     * The logical Site this environment belongs to — TRAVERSED, never derived
     * (WP-21b, audit A9's stamping discipline).
     *
     * `drift.entityId` is whichever role the observed event carried, and every
     * shipped `state.*` producer stamps `environment`, so this is an
     * environment id in practice. Deriving a Site from it is not an option:
     * for a MIRRORED site the mirror keyed the Site by `wpe.site_id`, so a
     * derivation would mint a second Site beside the real one and split the
     * history the role exists to join (same reasoning as `syncProducer`'s
     * `resolveSite`). No edge means no role — omitted, per WP-16 doctrine,
     * because an absent role is honest and a guessed one is a claim.
     */
    const siteRoleFor = (entityId: string): string | undefined => {
      try {
        return entities?.siteOf(entityId);
      } catch {
        /* a faulty entity service must never break a producer */
        return undefined;
      }
    };

    // Drift observations are themselves events — the fold reports, the ledger remembers.
    const stateFold: Fold = createStateTwinFold((drift) => {
      const site = siteRoleFor(drift.entityId);
      emitter.emit({
        observed_at: drift.observedAt,
        topic: 'state.drift.detected',
        // v2 (WP-03 finding): carries previous_observed_at, so drift readers
        // can report how long the sides diverged, not just what changed.
        //
        // Still v2 after WP-21b: the added `site` role is NOT a payload schema
        // change. `EntityRefs` is `Record<string, string>` and the envelope
        // validator's `entity` field is an open `z.record` — the entity block
        // is extensible by construction, and the payload below is untouched.
        schema: 'drift.detected/2',
        entity: { environment: drift.entityId, ...(site ? { site } : {}) },
        actor: { id: 'act_fold_state_twin', kind: 'system' },
        source: { class: 'platform', system: 'fold:state-twin', trust: 'derived' },
        causation: drift.causeEventId,
        payload: {
          fact: drift.fact,
          previous: drift.previous as Record<string, unknown> | null,
          observed: drift.observed as Record<string, unknown> | null,
          previous_observed_at: drift.previousObservedAt,
        },
      });
    });

    // Pipeline observability (plan 2026-08-23): task.run.completed
    // (pipeline.run/1) -> pipeline:<layer> facts. No dependencies — it neither
    // emits nor resolves entities — so it sits beside stateFold rather than
    // closing over anything.
    const pipelineFold: Fold = createPipelineStatusFold();
    const allFolds: Fold[] = [stateFold, pipelineFold];

    let foldTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleFolds = () => {
      if (foldTimer) return;
      foldTimer = setTimeout(() => {
        foldTimer = undefined;
        try {
          for (const fold of allFolds) catchUp(ledger, fold);
        } catch (err) {
          // Interpolated, not varargs: Local's JSON logger drops extra
          // arguments, which turned these lines into "[Intelligence] fold
          // error:" with the reason missing (found during the M1 live smoke).
          logger.error(`[Intelligence] fold error: ${(err as Error).message}`);
        }
      }, FOLD_DEBOUNCE_MS);
    };

    // WP-07: the identity spine rides the same ledger (migrations v2 created
    // its tables). Wrapped separately from the core's own try/catch so a
    // faulty entity service degrades to provisional-id derivation instead of
    // disabling the whole ledger. (Declared above the drift emitter, which
    // closes over it — WP-21b.)
    try {
      entities = new EntityService(ledger);
    } catch (err) {
      logger.error(`[Intelligence] entity service init failed (non-fatal): ${(err as Error).message}`);
      recordInitFailure(storage, 'entity-service', err, new Date());
    }

    // WP-08: policy registry v0 — mirrors wpeOperationPermissions, enforces
    // nothing. initLawRegistry carries its own try/catch and returns
    // undefined on failure, so no extra wrapping is needed here — but the
    // REASON only reached the log, so WP-17 has it hand the message back.
    const law = initLawRegistry({
      storage,
      logger,
      onFailure: (message) => recordInitFailure(storage, 'law-registry', new Error(message), new Date()),
    });

    const tap: WpEventTap = (siteId, eventType, payload) => {
      try {
        const draft = draftFromWpEvent(siteId, eventType, payload ?? {}, new Date(), entities);
        if (!draft) return;
        emitter.emit(draft);
        scheduleFolds();
      } catch (err) {
        // Never let the intelligence tap break the event pipeline.
        logger.error(`[Intelligence] tap error: ${(err as Error).message}`);
      }
    };

    logger.info(`[Intelligence] core ready (ledger: ${path.join(dataDir, 'ledger.db')}, via: ${satelliteId})`);
    // Success is recorded too: without it, a persisted failure has no anchor —
    // the reader could not say whether it predates the running session.
    writeInitState(storage, { ...initState, last_success_at: new Date().toISOString() });
    const core: IntelligenceCore = {
      ledger,
      emitter,
      twins: new TwinStore(ledger),
      folds: allFolds,
      entities,
      law,
      identity,
      tap,
      scheduleFolds,
      close: () => {
        if (foldTimer) clearTimeout(foldTimer);
        try {
          for (const fold of allFolds) catchUp(ledger, fold); // final drain
        } catch {
          /* best effort */
        }
        ledger.close();
      },
    };

    // WP-20b: the shipped capability grants, derived from the law registry above
    // — every strict runbook it SERVES gets a grant, and `control.grant.issued`
    // records the ones that changed. Placed here rather than in `index.ts`
    // because it is a function of the law registry, which is already built here
    // (the same reasoning that kept `initLawRegistry` out of index.ts at WP-20a).
    // Non-fatal by its own construction: it returns an empty set on any fault.
    syncCapabilityGrants({ core, storage, logger });

    return core;
  } catch (err) {
    logger.error(`[Intelligence] init failed (non-fatal): ${(err as Error).message}`);
    // The M1 lesson: a log line is not a record. Persist the reason so the
    // health surface can name it — including from a later, successful boot.
    recordInitFailure(storage, 'core', err, new Date());
    return undefined;
  }
}

function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'unknown';
}
