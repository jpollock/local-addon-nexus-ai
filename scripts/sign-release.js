#!/usr/bin/env node
/**
 * Sign a release tarball with the Ed25519 private key (P0-3). Run in CI after package-addon.js,
 * for each platform tarball. Reads the private key from the NEXUS_SIGNING_KEY env var (a GitHub
 * Actions secret). Writes <tarball>.sig (raw 64-byte Ed25519 signature) next to the tarball —
 * upload it to R2 alongside the .tgz, under the same v{version}/ prefix.
 *
 *     node scripts/sign-release.js dist/nexus-ai-darwin-arm64-x.y.z.tgz
 *
 * The CLI verifies this signature (src/cli/bootstrap/signing.ts) before extracting the addon; a
 * missing or invalid .sig is a hard refusal.
 */
const { sign } = require('node:crypto');
const fs = require('fs');

const tarball = process.argv[2];
if (!tarball) {
  console.error('Usage: node scripts/sign-release.js <tarball-path>');
  process.exit(1);
}
const privateKey = process.env.NEXUS_SIGNING_KEY;
if (!privateKey) {
  console.error('NEXUS_SIGNING_KEY is not set (the Ed25519 private-key PEM).');
  process.exit(1);
}
if (!fs.existsSync(tarball)) {
  console.error(`Tarball not found: ${tarball}`);
  process.exit(1);
}

const signature = sign(null, fs.readFileSync(tarball), privateKey);
fs.writeFileSync(`${tarball}.sig`, signature);
console.log(`Wrote ${tarball}.sig (${signature.length} bytes)`);
