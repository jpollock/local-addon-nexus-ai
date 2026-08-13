# Third-Party Licenses

Nexus AI (this add-on) is licensed under the **MIT License** (see `LICENSE`).
It depends on and redistributes the third-party components listed below, each
under its own license. This file documents those components and their licenses.

Last reconciled: 2026-08-13.

---

## Bundled WordPress plugins (redistributed in `lib/wp-plugins/`)

The add-on ships several WordPress plugins that it installs into managed sites.
**Three of them are licensed GPL-2.0-or-later.** MIT is compatible with the GPL,
and these plugins are aggregated and redistributed as separate works (they run in
WordPress/PHP, not linked into the add-on's Electron/Node code) — so bundling them
does not change the add-on's own MIT license. Their GPL source is available in the
add-on's own repository under `wp-plugins/`.

| Plugin | License | Notes |
|--------|---------|-------|
| `ai` | GPL-2.0-or-later | WordPress AI plugin — a **copy of the WordPress.org plugin** (third-party, not authored here). Source: `wp-plugins/ai/`. **Candidate to stop redistributing** by installing from wp.org on demand — see roadmap item T-UNBUNDLE-AI. |
| `ai-provider-for-local-gateway` | GPL-2.0-or-later | Local gateway AI provider. Source: `wp-plugins/ai-provider-for-local-gateway/`. |
| `ai-provider-for-ollama` | GPL-2.0-or-later | Ollama AI provider. Source: `wp-plugins/ai-provider-for-ollama/`. |
| `nexus-ai-connector` | MIT | Nexus AI connector MU-plugin. Source: `wp-plugins/nexus-ai-connector/`. |

> **Note (ACF PRO):** Advanced Custom Fields PRO is a paid WP Engine product and is
> **not** redistributed by this package — it is excluded from all distributed artifacts
> and guarded against at publish time. See `scripts/create-entry-points.js` and
> `scripts/prepublish-guard.js`.

---

## Runtime dependencies (direct)

| Package | License | URL |
|---------|---------|-----|
| apache-arrow | Apache-2.0 | https://github.com/apache/arrow |
| better-sqlite3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| commander | MIT | https://github.com/tj/commander.js |
| graphql | MIT | https://github.com/graphql/graphql-js |
| graphql-tag | MIT | https://github.com/apollographql/graphql-tag |
| lodash | MIT | https://github.com/lodash/lodash |
| marked | MIT | https://github.com/markedjs/marked |
| mysql2 | MIT | https://github.com/sidorares/node-mysql2 |
| node-cron | ISC | https://github.com/node-cron/node-cron |
| onnxruntime-node | MIT | https://github.com/microsoft/onnxruntime |
| p-limit | MIT | https://github.com/sindresorhus/p-limit |
| p-queue | MIT | https://github.com/sindresorhus/p-queue |
| react-window | MIT | https://github.com/bvaughn/react-window |
| sqlite-vec | MIT OR Apache-2.0 | https://github.com/asg017/sqlite-vec |
| ssh-config | MIT | https://github.com/cyjake/ssh-config |
| tar | ISC | https://github.com/isaacs/node-tar |
| ts-node | MIT | https://github.com/TypeStrong/ts-node |
| zod | MIT | https://github.com/colinhacks/zod |
| zod-to-json-schema | ISC | https://github.com/StefanTerdell/zod-to-json-schema |

License identifiers above were read from each package's own `package.json`.

---

## Bundled / downloaded models

| Model | License | How it ships | URL |
|-------|---------|--------------|-----|
| bge-small-en-v1.5 | MIT | Currently tracked in git under `models/` (non-default embedding model). | https://huggingface.co/BAAI/bge-small-en-v1.5 |
| all-MiniLM-L6-v2 (quantized ONNX) | Apache-2.0 | Downloaded at build time and verified against a pinned sha256 (`scripts/download-model.js`). | https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 |

---

## Development dependencies

Development-only tooling (TypeScript, Jest, ts-jest, ESLint, `@types/*`, etc.) is
not redistributed. It is predominantly MIT / Apache-2.0 / ISC licensed; see each
package's own `package.json` for the authoritative identifier.

---

## Full license texts

- **MIT License** — https://opensource.org/license/mit
- **Apache License 2.0** — https://www.apache.org/licenses/LICENSE-2.0
- **ISC License** — https://opensource.org/license/isc-license-txt
- **GNU General Public License, version 2 (or later)** — https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
