#!/usr/bin/env node
/**
 * Generate an Ed25519 release signing keypair (P0-3). Run ONCE locally, or to rotate.
 *
 * The PRIVATE key must NEVER be committed (it is gitignored). Store it as the NEXUS_SIGNING_KEY
 * GitHub Actions secret and keep an offline backup:
 *     gh secret set NEXUS_SIGNING_KEY < nexus-release-signing.key
 * The PUBLIC key goes into RELEASE_PUBLIC_KEYS in src/cli/bootstrap/signing.ts.
 */
const { generateKeyPairSync } = require('node:crypto');
const fs = require('fs');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
fs.writeFileSync('nexus-release-signing.key', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync('nexus-release-signing.pub', publicKey.export({ type: 'spki', format: 'pem' }));

console.log('Wrote nexus-release-signing.key (PRIVATE — never commit) and nexus-release-signing.pub');
console.log('\nPublic key — paste into RELEASE_PUBLIC_KEYS in src/cli/bootstrap/signing.ts:\n');
console.log(fs.readFileSync('nexus-release-signing.pub', 'utf8'));
