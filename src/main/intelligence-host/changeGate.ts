/**
 * Change gate — shared dedup for graph-sourced emissions (tap + backfill).
 *
 * Emits only when a value differs from the current twin fact (or from what
 * this process already emitted and hasn't folded yet). The ledger records
 * change, not repetition.
 */
import { IntelligenceCore } from './bootstrap';

const EMITTED_CACHE_MAX = 20_000;

export type ChangeGate = (entityId: string, fact: string, value: unknown) => boolean;

export function createChangeGate(core: IntelligenceCore): ChangeGate {
  /** entity|fact -> last emitted value JSON (process lifetime). */
  const emittedCache = new Map<string, string>();

  return (entityId: string, fact: string, value: unknown): boolean => {
    const key = `${entityId}|${fact}`;
    const json = JSON.stringify(value);
    if (emittedCache.get(key) === json) return false;
    const twinFact = core.twins.get(entityId, fact);
    if (twinFact && JSON.stringify(twinFact.value) === json) {
      emittedCache.set(key, json);
      return false;
    }
    if (emittedCache.size >= EMITTED_CACHE_MAX) emittedCache.clear(); // crude but bounded
    emittedCache.set(key, json);
    return true;
  };
}

/** Row timestamps are epoch ms (sometimes s); normalize to ISO, falling back to now. */
export function rowTimeToIso(epoch: unknown): string {
  const n = Number(epoch);
  if (Number.isFinite(n) && n > 1e12) return new Date(n).toISOString(); // ms
  if (Number.isFinite(n) && n > 1e9) return new Date(n * 1000).toISOString(); // s
  return new Date().toISOString();
}
