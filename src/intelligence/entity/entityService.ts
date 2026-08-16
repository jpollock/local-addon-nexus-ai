/**
 * Entity service v0 (architecture doc §5, migration step 3) — DRAFT, unwired.
 *
 * The identity spine: stable entity ids, external handles as aliases with
 * confidence + established_by, and typed links (site —has_environment→ env).
 *
 * Continuity with step 1/2: `ensure()` ADOPTS the deterministic provisional
 * ids already used by the producers (same derivation), so every event and
 * twin fact emitted so far keys to the entities this service registers —
 * no history rewrite, exactly as the provisional-id module promised.
 *
 * v0 scope: ensure/resolve/alias/link/environmentsOf + pairing PROPOSALS
 * (domain/name heuristics that return candidates with evidence — they never
 * link silently; confirmation upgrades them). Not wired into the host yet:
 * review the model before anything writes through it.
 */
import { Ledger } from '../ledger/ledger';
import { createHash } from 'crypto';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function derive26(namespace: string, value: string): string {
  const digest = createHash('sha256').update(`${namespace}:${value}`).digest();
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < digest.length && out.length < 26; i++) {
    acc = (acc << 8) | digest[i];
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      bits -= 5;
      out += B32[(acc >> bits) & 31];
    }
  }
  return out;
}

export type EstablishedBy =
  | 'user_link'
  | 'host_connection'
  | 'pull_lineage'
  | 'domain_match'
  | 'name_heuristic'
  | 'derivation';

export interface AliasRecord {
  entityId: string;
  namespace: string;
  value: string;
  confidence: number;
  establishedBy: EstablishedBy;
}

export interface ResolveCandidate {
  entityId: string;
  type: string;
  matchedAlias: AliasRecord;
}

export interface PairingProposal {
  siteAName: string;
  siteBName: string;
  entityA: string;
  entityB: string;
  evidence: 'domain_match' | 'name_heuristic';
  confidence: number;
  detail: string;
}

export class EntityService {
  constructor(private ledger: Ledger) {}

  /**
   * Ensure an entity exists for an external handle; returns its id.
   * For the namespaces the producers already derive from, the id is the SAME
   * deterministic id — adoption, not migration.
   */
  ensure(type: string, namespace: string, value: string): string {
    const db = this.ledger.raw();
    const existing = db
      .prepare(`SELECT entity_id FROM entity_aliases WHERE namespace = ? AND value = ?`)
      .get(namespace, value) as { entity_id: string } | undefined;
    if (existing) return existing.entity_id;

    // Deterministic id — matches provisionalEntity derivation for the
    // namespaces producers use ('local.site_id', 'local.site_id.logical').
    const id = `ent_${type}_${derive26(namespace, value)}`;
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO entities (id, type, created_at) VALUES (?, ?, ?)`).run(
        id,
        type,
        now
      );
      db.prepare(
        `INSERT OR IGNORE INTO entity_aliases
           (entity_id, namespace, value, confidence, established_by, created_at)
         VALUES (?, ?, ?, 1.0, 'derivation', ?)`
      ).run(id, namespace, value, now);
    });
    tx();
    return id;
  }

  /**
   * `at` is the freshness carrier (the mirror passes site_links.verified_at);
   * omitted means "asserted now". A user_link is authoritative: a non-user
   * write never overwrites one — same invariant as Track-1's SiteLinkResolver.
   */
  addAlias(
    entityId: string,
    namespace: string,
    value: string,
    confidence: number,
    establishedBy: EstablishedBy,
    at?: string
  ): void {
    this.ledger
      .raw()
      .prepare(
        `INSERT INTO entity_aliases (entity_id, namespace, value, confidence, established_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace, value) DO UPDATE SET
           entity_id = excluded.entity_id,
           confidence = excluded.confidence,
           established_by = excluded.established_by,
           created_at = excluded.created_at
         WHERE entity_aliases.established_by != 'user_link' OR excluded.established_by = 'user_link'`
      )
      .run(entityId, namespace, value, confidence, establishedBy, at ?? new Date().toISOString());
  }

  /**
   * Resolve a raw handle to candidates, ranked by confidence — ambiguity
   * returns multiple candidates WITH their evidence (the honest-disambiguation
   * contract the eval suite demands).
   */
  resolve(value: string, namespace?: string): ResolveCandidate[] {
    const db = this.ledger.raw();
    const rows = (
      namespace
        ? db
            .prepare(
              `SELECT a.*, e.type FROM entity_aliases a JOIN entities e ON e.id = a.entity_id
               WHERE a.namespace = ? AND a.value = ?`
            )
            .all(namespace, value)
        : db
            .prepare(
              `SELECT a.*, e.type FROM entity_aliases a JOIN entities e ON e.id = a.entity_id
               WHERE a.value = ? ORDER BY a.confidence DESC`
            )
            .all(value)
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      entityId: String(r.entity_id),
      type: String(r.type),
      matchedAlias: {
        entityId: String(r.entity_id),
        namespace: String(r.namespace),
        value: String(r.value),
        confidence: Number(r.confidence),
        establishedBy: String(r.established_by) as EstablishedBy,
      },
    }));
  }

  /** Same freshness + user_link precedence contract as `addAlias`. */
  link(
    fromEntity: string,
    toEntity: string,
    kind: string,
    confidence: number,
    establishedBy: EstablishedBy,
    at?: string
  ): void {
    this.ledger
      .raw()
      .prepare(
        `INSERT INTO entity_links (from_entity, to_entity, kind, confidence, established_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(from_entity, to_entity, kind) DO UPDATE SET
           confidence = excluded.confidence,
           established_by = excluded.established_by,
           created_at = excluded.created_at
         WHERE entity_links.established_by != 'user_link' OR excluded.established_by = 'user_link'`
      )
      .run(fromEntity, toEntity, kind, confidence, establishedBy, at ?? new Date().toISOString());
  }

  environmentsOf(siteEntity: string): Array<{ entityId: string; confidence: number; establishedBy: string }> {
    const rows = this.ledger
      .raw()
      .prepare(
        `SELECT to_entity, confidence, established_by FROM entity_links
         WHERE from_entity = ? AND kind = 'has_environment' ORDER BY confidence DESC`
      )
      .all(siteEntity) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      entityId: String(r.to_entity),
      confidence: Number(r.confidence),
      establishedBy: String(r.established_by),
    }));
  }

  /**
   * Pairing proposals from twin site.core facts: environments sharing a
   * domain (strong) or highly similar names (weak). Returns evidence-carrying
   * candidates for a confirmation queue — NEVER links automatically.
   *
   * `unresolvedOnly` (WP-07, reconciliation note §4): scope proposals to
   * pairs involving the given entity ids — the caller passes the env entities
   * of Track-1's unresolved-sites report, so the service fills gaps rather
   * than competing with `site_links` on already-resolved sites. An empty
   * array means "nothing is unresolved", so nothing is proposed.
   */
  proposePairings(unresolvedOnly?: readonly string[]): PairingProposal[] {
    if (unresolvedOnly && unresolvedOnly.length === 0) return [];
    const scope = unresolvedOnly ? new Set(unresolvedOnly) : null;
    const db = this.ledger.raw();
    const rows = db
      .prepare(`SELECT entity_id, value FROM twin_facts WHERE fact = 'site.core'`)
      .all() as Array<{ entity_id: string; value: string }>;
    const sites = rows.map((r) => ({
      entityId: r.entity_id,
      ...(JSON.parse(r.value) as { name?: string; domain?: string }),
    }));

    const proposals: PairingProposal[] = [];
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const a = sites[i];
        const b = sites[j];
        if (scope && !scope.has(a.entityId) && !scope.has(b.entityId)) continue;
        if (a.domain && b.domain && normalizeDomain(a.domain) === normalizeDomain(b.domain)) {
          proposals.push({
            siteAName: a.name ?? a.entityId,
            siteBName: b.name ?? b.entityId,
            entityA: a.entityId,
            entityB: b.entityId,
            evidence: 'domain_match',
            confidence: 0.9,
            detail: `both resolve to ${normalizeDomain(a.domain)}`,
          });
        } else if (a.name && b.name && namesLookPaired(a.name, b.name)) {
          proposals.push({
            siteAName: a.name,
            siteBName: b.name,
            entityA: a.entityId,
            entityB: b.entityId,
            evidence: 'name_heuristic',
            confidence: 0.5,
            detail: `names differ only by an environment-style suffix`,
          });
        }
      }
    }
    return proposals.sort((x, y) => y.confidence - x.confidence);
  }
}

function normalizeDomain(d: string): string {
  return d.toLowerCase().replace(/^www\./, '').replace(/\.local$/, '').replace(/\/$/, '');
}

const ENV_SUFFIXES = /(-|_)?(stg|staging|dev|development|prod|production|local|copy|backup|old|v\d+)$/i;

function namesLookPaired(a: string, b: string): boolean {
  const strip = (s: string) => s.toLowerCase().replace(ENV_SUFFIXES, '');
  const sa = strip(a);
  const sb = strip(b);
  return sa.length >= 4 && sa === sb && a.toLowerCase() !== b.toLowerCase();
}
