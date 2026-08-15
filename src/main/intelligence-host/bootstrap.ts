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
  TwinStore,
  catchUp,
  createStateTwinFold,
  Fold,
  ulid,
} from '../../intelligence';
import { draftFromWpEvent } from './wpEventProducer';

export type WpEventTap = (
  siteId: string,
  eventType: string,
  payload: Record<string, unknown>
) => void;

export interface IntelligenceCore {
  ledger: Ledger;
  emitter: Emitter;
  twins: TwinStore;
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
  error: (msg: string, ...args: unknown[]) => void;
}

const SATELLITE_ID_KEY = 'intelligence_satellite_id';
const FOLD_DEBOUNCE_MS = 500;

export function initIntelligenceCore(options: {
  storage: MinimalStorage;
  logger: MinimalLogger;
  dataDir: string;
}): IntelligenceCore | undefined {
  const { storage, logger, dataDir } = options;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const ledger = new Ledger(path.join(dataDir, 'ledger.db'));

    // ADR-14: satellite = machine identity; stable across restarts.
    let satelliteId = storage.get(SATELLITE_ID_KEY) as string | null;
    if (!satelliteId) {
      satelliteId = `sat_${ulid()}`;
      storage.set(SATELLITE_ID_KEY, satelliteId);
    }

    const emitter = createEmitter({
      ledger,
      clock: { now: () => new Date() },
      identity: {
        // v1 session identity: the OS user, until real session auth exists
        // (architecture doc §11 watch item 4).
        actor: () => ({ id: `act_${sanitize(os.userInfo().username)}`, kind: 'human' }),
        via: () => satelliteId as string,
        tenant: () => 'local', // ADR-11: single-tenant until the hub exists
      },
    });

    // Drift observations are themselves events — the fold reports, the ledger remembers.
    const stateFold: Fold = createStateTwinFold((drift) => {
      emitter.emit({
        observed_at: drift.observedAt,
        topic: 'state.drift.detected',
        // v2 (WP-03 finding): carries previous_observed_at, so drift readers
        // can report how long the sides diverged, not just what changed.
        schema: 'drift.detected/2',
        entity: { environment: drift.entityId },
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

    let foldTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleFolds = () => {
      if (foldTimer) return;
      foldTimer = setTimeout(() => {
        foldTimer = undefined;
        try {
          catchUp(ledger, stateFold);
        } catch (err) {
          logger.error('[Intelligence] fold error:', (err as Error).message);
        }
      }, FOLD_DEBOUNCE_MS);
    };

    const tap: WpEventTap = (siteId, eventType, payload) => {
      try {
        const draft = draftFromWpEvent(siteId, eventType, payload ?? {}, new Date());
        if (!draft) return;
        emitter.emit(draft);
        scheduleFolds();
      } catch (err) {
        // Never let the intelligence tap break the event pipeline.
        logger.error('[Intelligence] tap error:', (err as Error).message);
      }
    };

    logger.info(`[Intelligence] core ready (ledger: ${path.join(dataDir, 'ledger.db')}, via: ${satelliteId})`);
    return {
      ledger,
      emitter,
      twins: new TwinStore(ledger),
      tap,
      scheduleFolds,
      close: () => {
        if (foldTimer) clearTimeout(foldTimer);
        try {
          catchUp(ledger, stateFold); // final drain
        } catch {
          /* best effort */
        }
        ledger.close();
      },
    };
  } catch (err) {
    logger.error('[Intelligence] init failed (non-fatal):', (err as Error).message);
    return undefined;
  }
}

function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'unknown';
}
