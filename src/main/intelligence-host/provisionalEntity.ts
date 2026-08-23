/**
 * Provisional entity ids — step-1 stopgap until the entity service (migration
 * step 3) exists.
 *
 * The envelope requires ent_<type>_<ULID-charset> ids, but there is no entity
 * graph yet. We derive a DETERMINISTIC id from the Local site id, so the same
 * site always maps to the same entity id and step-3's linking pass can adopt
 * these ids (or alias them) without rewriting history.
 *
 * established_by: 'derivation' — these are aliases-in-waiting, not identities.
 */
import { createHash } from 'crypto';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, matches ULID charset

/** 26 chars of Crockford base32 derived from sha256(namespace:value). */
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

/**
 * Deterministic entity id for any (type, namespace, value) — the same pair
 * `ensure()` hashes, so registry-up and registry-down produce identical ids.
 * Exported for producers whose namespace has no dedicated helper below
 * (pipelineRunProducer's `graph.site_row` was the first).
 */
export function provisionalEntityId(type: string, namespace: string, value: string): string {
  return `ent_${type}_${derive26(namespace, value)}`;
}

/** Deterministic environment entity id for a Local site id. */
export function provisionalEnvironmentId(localSiteId: string): string {
  return `ent_env_${derive26('local.site_id', localSiteId)}`;
}

/** Deterministic site (logical) entity id for a Local site id — same until pairing exists. */
export function provisionalSiteId(localSiteId: string): string {
  return `ent_site_${derive26('local.site_id.logical', localSiteId)}`;
}

/** The one method producers need — avoids importing the whole service type. */
interface EntityEnsurer {
  ensure(type: string, namespace: string, value: string): string;
}

/**
 * WP-07: producers register entities through `ensure()` when the entity
 * service is up, and fall back to the pure derivation when it is not (init
 * failure is non-fatal by design). The ids are identical by construction —
 * `ensure()` derives from the same (namespace, value) — which is what lets
 * producers adopt the service with zero id changes anywhere.
 */
export function environmentEntityId(entities: EntityEnsurer | undefined, siteId: string): string {
  try {
    if (entities) return entities.ensure('env', 'local.site_id', siteId);
  } catch {
    /* a faulty entity service must never break a producer */
  }
  return provisionalEnvironmentId(siteId);
}

/** Site-entity counterpart of `environmentEntityId` — same contract. */
export function siteEntityId(entities: EntityEnsurer | undefined, siteId: string): string {
  try {
    if (entities) return entities.ensure('site', 'local.site_id.logical', siteId);
  } catch {
    /* a faulty entity service must never break a producer */
  }
  return provisionalSiteId(siteId);
}
