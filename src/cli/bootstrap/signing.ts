/**
 * Release-artifact signature verification (P0-3).
 *
 * The CLI is the root of trust: it is installed via npm (registry integrity), and from there it
 * must authenticate every addon tarball it downloads from R2 before extracting/loading it. A
 * valid Ed25519 signature authenticates the *bytes*, so a compromised bucket, CDN, or MITM
 * cannot substitute arbitrary code — tampered bytes fail verification.
 *
 * The private key lives only in CI (the NEXUS_SIGNING_KEY Actions secret) and signs each release
 * tarball → {asset}.sig. The public key below verifies it. Ed25519 via Node's built-in crypto,
 * zero dependencies.
 *
 * Rotation: RELEASE_PUBLIC_KEYS is an array. To rotate, add the new public key, sign future
 * releases with the new private key, and keep the old key until all old releases age out.
 */

import { verify } from 'node:crypto';

/**
 * Public halves of the release signing keys. Safe to publish — they can only verify, never sign.
 * Generated with `openssl genpkey -algorithm ed25519` (see scripts/generate-signing-key.js).
 */
export const RELEASE_PUBLIC_KEYS: string[] = [
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA5FSW4XRwX7cDJZWec9VKC5XEzLDxQDUQTQdpjMp86qk=\n-----END PUBLIC KEY-----',
];

/**
 * Verify a detached Ed25519 signature over `data` against any of `publicKeys`.
 * Never throws — a malformed signature or key returns false.
 */
export function verifyWithKeys(data: Buffer, signature: Buffer, publicKeys: string[]): boolean {
  return publicKeys.some((key) => {
    try {
      return verify(null, data, key, signature);
    } catch {
      return false;
    }
  });
}

/** Verify a downloaded release tarball against the embedded release public key(s). */
export function verifyTarballSignature(tarballBytes: Buffer, signatureBytes: Buffer): boolean {
  return verifyWithKeys(tarballBytes, signatureBytes, RELEASE_PUBLIC_KEYS);
}
