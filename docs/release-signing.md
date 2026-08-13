# Release signing (maintainer runbook)

How Nexus AI signs its release artifacts and how the CLI verifies them. This closes the
unsigned-auto-update RCE (P0-3): the CLI downloads addon tarballs from a public R2 bucket, so
without verification a compromised bucket, CDN, or a TLS-terminating MITM could ship arbitrary
code that auto-executes on a user's machine.

## Model

- The **CLI is the root of trust.** It is installed via npm (registry integrity), and from there
  it authenticates every addon tarball it downloads before extracting or loading it.
- Signatures are **detached Ed25519** (Node's built-in `crypto`, zero dependencies). A signature
  authenticates the *bytes*, so it doesn't matter where the tarball came from — tampered bytes fail.
- The **private key lives only in CI** (the `NEXUS_SIGNING_KEY` GitHub Actions secret) and signs
  each release tarball → `<asset>.tgz.sig`. The **public key is embedded in the client** and only
  verifies. A missing or invalid signature is a **hard refusal** — fail-closed.

## Where the pieces live

| Piece | File |
|---|---|
| Public key(s) + verification | `src/cli/bootstrap/signing.ts` (`RELEASE_PUBLIC_KEYS`, `verifyTarballSignature`, `assertSignedTarball`) |
| Enforcement (verify before extract) | `src/cli/bootstrap/addon.ts`, `src/cli/bootstrap/downloader.ts` (`downloadSignature`) |
| Keypair generation | `scripts/generate-signing-key.js` |
| Signing (run in CI) | `scripts/sign-release.js` |
| CI wiring | `.github/workflows/package.yml` (`Sign tarballs` step + `.sig` upload) |
| Tests | `tests/cli/bootstrap/signing.test.ts` |

## One-time setup (already done)

Kept here for reference / rotation.

1. **Generate the keypair** (locally, once):
   ```bash
   openssl genpkey -algorithm ed25519 -out nexus-release-signing.key   # PRIVATE — never commit
   openssl pkey -in nexus-release-signing.key -pubout -out nexus-release-signing.pub
   # or: node scripts/generate-signing-key.js
   ```
   Both key files are gitignored. The private key is mode 0600.

2. **Store the private key as the CI secret**, then get it off disk:
   ```bash
   gh secret set NEXUS_SIGNING_KEY < nexus-release-signing.key
   ```
   Keep one **offline backup** of `nexus-release-signing.key` (password manager / encrypted drive),
   then delete the working-copy file.

3. **Embed the public key** in `RELEASE_PUBLIC_KEYS` in `src/cli/bootstrap/signing.ts` (paste the
   contents of `nexus-release-signing.pub`). The public key is safe to commit.

## Cutting a signed release

1. Tag a release: `git tag vX.Y.Z && git push origin vX.Y.Z` (only when you intend to release).
2. `package.yml` runs: **Build → Package → Sign tarballs → Upload to R2**. The `Sign tarballs` step
   **fails the release if `NEXUS_SIGNING_KEY` is unset**, so an unsigned release cannot ship.
3. Confirm the `Sign tarballs` step ran green in the Actions log, and that both `<asset>.tgz` and
   `<asset>.tgz.sig` were uploaded to `s3://nexus-ai-releases/nexus-ai/vX.Y.Z/`.
4. Smoke-test: install/update on a client and confirm it logs `Signature verified.` and succeeds.

> **Transition note:** the verifying CLI refuses any tarball on R2 that predates signing (no
> `.sig`). That is intended fail-closed behavior — always cut a fresh **signed** release rather than
> pointing users at older unsigned builds.

## Verifying a download by hand

```bash
# openssl
openssl pkeyutl -verify -pubin -inkey nexus-release-signing.pub \
  -rawin -in <asset>.tgz -sigfile <asset>.tgz.sig

# node (uses the key embedded in the CLI)
node -e "require('ts-node/register'); const {verifyTarballSignature}=require('./src/cli/bootstrap/signing'); const fs=require('fs'); console.log(verifyTarballSignature(fs.readFileSync(process.argv[1]), fs.readFileSync(process.argv[2])))" <asset>.tgz <asset>.tgz.sig
```

## Rotating the key

`RELEASE_PUBLIC_KEYS` is an **array** so rotation never breaks in-flight releases.

1. Generate a new keypair (`node scripts/generate-signing-key.js`).
2. **Add** the new public key to `RELEASE_PUBLIC_KEYS` (keep the old one for now).
3. Update the CI secret: `gh secret set NEXUS_SIGNING_KEY < nexus-release-signing.key`.
4. Ship a CLI release built with the updated array, then start signing with the new private key.
5. Once every release signed by the old key has aged out, remove the old public key.

## If the private key leaks or is lost

- **Leaked:** treat every release signed with it as untrusted. Rotate immediately (above), and ship
  a CLI that no longer trusts the old public key.
- **Lost (no backup):** you can't sign against the current public key anymore. Rotate — generate a
  new keypair, add its public key, and cut a CLI release before the next addon release.

## Troubleshooting

- **CLI: "Release signature file is missing"** — the `.sig` wasn't uploaded (or the release predates
  signing). Re-run the release or cut a fresh signed one.
- **CLI: "Release signature is invalid"** — the tarball doesn't match the signature (tampering, a
  truncated upload, or a key mismatch). Confirm the public key in `signing.ts` matches the private
  key used by CI (`NEXUS_SIGNING_KEY`).
- **CI: "NEXUS_SIGNING_KEY secret is not set"** — add the secret (`gh secret set …`). The release is
  deliberately blocked until it is present.
