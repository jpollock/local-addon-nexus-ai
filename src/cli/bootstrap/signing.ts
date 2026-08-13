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
import * as fs from 'node:fs';

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

/**
 * Fail-closed gate: throw unless `tarPath` carries a valid detached signature at `sigPath`.
 * A missing signature file is a hard refusal (otherwise an attacker just omits the .sig), and so
 * is an invalid signature. Call this after downloading the tarball and BEFORE extracting it.
 * `publicKeys` is injectable for testing; production callers use the embedded release keys.
 */
export function assertSignedTarball(
  tarPath: string,
  sigPath: string,
  publicKeys: string[] = RELEASE_PUBLIC_KEYS,
): void {
  if (!fs.existsSync(sigPath)) {
    throw new Error('Release signature file is missing — refusing to install an unverified addon.');
  }
  if (!verifyWithKeys(fs.readFileSync(tarPath), fs.readFileSync(sigPath), publicKeys)) {
    throw new Error('Release signature is invalid — refusing to install a tampered addon.');
  }
}
