/**
 * Twin facts — read side. A twin is a cache by construction: rebuildable from
 * the ledger, every fact stamped with when it was last true and how it was
 * sourced. Freshness SLOs live in config, and the answer to "may I act on
 * this cached fact?" is computed, never vibes (architecture doc §4.3, §6.3).
 */
import { Ledger } from '../ledger/ledger';
import { TrustClass } from '../envelope/types';

export interface TwinFact {
  entityId: string;
  fact: string;
  value: unknown;
  observedAt: string;
  sourceTrust: TrustClass;
  eventId: string; // provenance pointer
}

export interface Freshness {
  ageSeconds: number;
  sloSeconds: number;
  fresh: boolean;
}

/** Strawman defaults from the architecture doc — tune in review. */
export const DEFAULT_FRESHNESS_SLOS: Array<{ pattern: RegExp; sloSeconds: number }> = [
  { pattern: /^plugin:/, sloSeconds: 8 * 3600 },
  { pattern: /^wp\.version$/, sloSeconds: 24 * 3600 },
  { pattern: /^php\.version$/, sloSeconds: 24 * 3600 },
  { pattern: /^ssl\./, sloSeconds: 24 * 3600 },
  { pattern: /^health\./, sloSeconds: 3600 },
];
const FALLBACK_SLO_SECONDS = 4 * 3600;

export function sloFor(fact: string, slos = DEFAULT_FRESHNESS_SLOS): number {
  return slos.find((s) => s.pattern.test(fact))?.sloSeconds ?? FALLBACK_SLO_SECONDS;
}

export class TwinStore {
  constructor(private ledger: Ledger) {}

  get(entityId: string, fact: string): TwinFact | undefined {
    const row = this.ledger
      .raw()
      .prepare(`SELECT * FROM twin_facts WHERE entity_id = ? AND fact = ?`)
      .get(entityId, fact) as Record<string, string> | undefined;
    return row ? rowToFact(row) : undefined;
  }

  forEntity(entityId: string): TwinFact[] {
    const rows = this.ledger
      .raw()
      .prepare(`SELECT * FROM twin_facts WHERE entity_id = ? ORDER BY fact`)
      .all(entityId) as Record<string, string>[];
    return rows.map(rowToFact);
  }

  /**
   * Fleet-wide: every entity holding this exact fact. The phase-B read
   * primitive — "which environments run plugin X?" is byFact('plugin:x').
   */
  byFact(fact: string): TwinFact[] {
    const rows = this.ledger
      .raw()
      .prepare(`SELECT * FROM twin_facts WHERE fact = ? ORDER BY entity_id`)
      .all(fact) as Record<string, string>[];
    return rows.map(rowToFact);
  }

  /** Fleet-wide by fact prefix — e.g. search('plugin:') for all plugin facts. */
  search(factPrefix: string): TwinFact[] {
    const rows = this.ledger
      .raw()
      .prepare(`SELECT * FROM twin_facts WHERE fact LIKE ? ORDER BY entity_id, fact`)
      .all(`${factPrefix}%`) as Record<string, string>[];
    return rows.map(rowToFact);
  }

  freshness(factRecord: TwinFact, now: Date = new Date()): Freshness {
    const ageSeconds = Math.max(
      0,
      Math.floor((now.getTime() - Date.parse(factRecord.observedAt)) / 1000)
    );
    const sloSeconds = sloFor(factRecord.fact);
    return { ageSeconds, sloSeconds, fresh: ageSeconds <= sloSeconds };
  }
}

function rowToFact(row: Record<string, string>): TwinFact {
  return {
    entityId: row.entity_id,
    fact: row.fact,
    value: JSON.parse(row.value),
    observedAt: row.observed_at,
    sourceTrust: row.source_trust as TrustClass,
    eventId: row.event_id,
  };
}
