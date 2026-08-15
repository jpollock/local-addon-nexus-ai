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

/** Deterministic environment entity id for a Local site id. */
export function provisionalEnvironmentId(localSiteId: string): string {
  return `ent_env_${derive26('local.site_id', localSiteId)}`;
}

/** Deterministic site (logical) entity id for a Local site id — same until pairing exists. */
export function provisionalSiteId(localSiteId: string): string {
  return `ent_site_${derive26('local.site_id.logical', localSiteId)}`;
}
