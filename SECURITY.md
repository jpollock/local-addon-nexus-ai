# Security Policy

Nexus AI is a Local (by WP Engine) addon that runs on a developer's machine with that developer's
privileges. It runs local HTTP servers, an MCP server and a GraphQL endpoint, spawns SSH and WP-CLI
against WordPress and WP Engine hosts, stores API keys and credentials, and runs LLM-driven agents.
We take the security of that surface seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately through GitHub's **private vulnerability reporting**: the repository's **Security**
tab → **Report a vulnerability**. Include the version (`nexus --version` or the addon's
`package.json`), your OS, and enough detail to reproduce.

We aim to acknowledge a report within a few business days and to keep you updated as we investigate
and fix. Please give us reasonable time to release a fix before any public disclosure.

## Supported versions

Security fixes are made against the latest released minor version. Older versions are not patched —
update to the latest release (`nexus update`, then reload the addon in Local).

| Version | Supported |
|---|---|
| latest minor | ✅ |
| older | ❌ (please update) |

## Security measures

A summary of the controls currently in place (not an exhaustive design document):

- **Local servers bind to `127.0.0.1` only.** The MCP server, AI gateway/event server, AI proxy,
  GraphQL endpoint and OAuth callback are loopback-only and token-authenticated.
- **Credentials are encrypted at rest** via Electron `safeStorage`; OAuth uses PKCE. Secrets are
  redacted (and freeform command surfaces withheld) from all audit and diagnostic logs.
- **Remote commands are argv-array subprocess calls, never a shell**, and SSH aliases and
  `~/.ssh/config` fields are validated to prevent option/directive injection.
- **Host keys use trust-on-first-use** with fingerprint verification; a changed host key is
  hard-refused, and approving a new key is possible only from Local's Settings UI.
- **A fail-closed permission gate** governs writes to remote (production) environments; destructive
  and privilege-granting operations require explicit human confirmation and are refused for
  autonomous agents. Permission-gate settings are changeable only from the Settings UI.
- **Auto-updates are cryptographically verified.** Release tarballs are signed with an Ed25519 key
  in CI, and the CLI refuses to install any addon whose signature is missing or invalid — see
  [`docs/release-signing.md`](docs/release-signing.md).

## Release integrity

Every published release tarball carries a detached Ed25519 signature (`<asset>.tgz.sig`). The CLI
verifies it against a public key embedded in the client before extracting or loading the addon.
Maintainers: the signing keypair, rotation, and how to cut a signed release are documented in
[`docs/release-signing.md`](docs/release-signing.md).
