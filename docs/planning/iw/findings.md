# Intelligent Web Integration — Findings

**Status:** investigation complete (July 2026). This is the empirical record backing the IW
planning effort — what we *verified against the live API and the real Hub Plugin*, not what we
assume. The plan (`plan.md`) should cite this file rather than re-deriving anything here.

**Legend**

- ✅ **Verified** — reproduced this session against `api.ai.wpengine.com` or the installed Hub Plugin.
- 🟡 **Inferred** — strongly implied by code/console but not directly proven.
- ❓ **Unknown** — flagged for follow-up; tracked in [`decisions.md`](./decisions.md).

Reproduce anything below with the scripts in [`scripts/iw/`](../../../scripts/iw/) (see §6).

---

## TL;DR

1. There are **two credential paths** to the same Power gateway (`api.ai.wpengine.com`). The
   portal **`wpe_` API key is the one Nexus should use.** The Hub Plugin's self-minted JWT works
   but **expires in 60 seconds** — a non-starter for a Node.js service. ✅
2. A **Full Access `wpe_` key reaches everything Nexus cares about** — inference, content tooling,
   the **Agent Registry, Sessions, and Knowledge Bases** — **except** account-management endpoints
   (`/v1/credits`, `/v1/analytics` → `403`). Those stay on CAPI/portal. ✅
3. The Hub Plugin connects **any** WordPress site (including non-WPE-hosted local sites) to Power
   via a **browser PKCE + DCR OAuth flow**. The browser step is unavoidable; everything before and
   after it is automatable. ✅
4. **Nexus does not create Agent Registry ("Managed") agents** — that isn't a shipped capability we
   build on. Nexus agents are authored in Local and **deploy to WPE Atlas** (node hosting). The
   Agent Registry is a *sibling* product surfaced through Extend, not a Nexus write target.

---

## 1. Two credential paths to the Power gateway

Both paths hit the same base URL and use the same two headers:

```
Base:    https://api.ai.wpengine.com
Headers: Authorization: Bearer <credential>
         WPEngine-Project: <project_id>       # e.g. proj_cE8Ib44IuegI3rH5l1MbBy (t2 test project)
```

### Path A — Portal `wpe_` API key  ✅  **← the path Nexus should take**

- Issued from the WP Engine portal. Long-lived, revocable, scoped by tier (see below).
- Reaches the full inference + Agent/Session/KB surface (§2, §4).
- **Cannot** reach management endpoints: `GET /v1/credits` and `GET /v1/analytics` both return
  `403 "API keys cannot access management endpoints"`. ✅
- **Key tiers** (from the portal issuance UI): **Full Access**, **Read Only**, and **Restricted**
  (sub-scopes: Chat, Image, Speech, Transcribe). ✅ Nexus needs **Full Access** for Agent/KB writes.

### Path B — Hub Plugin JWT  ✅ verified, ❌ rejected for Nexus

- An **EdDSA JWT** the Hub Plugin **self-mints** on demand from its stored Ed25519 keypair.
- Obtainable from a connected site via `wpe_auth_get_token()` (project via `wpe_auth_get_project_id()`).
- Covers the **same API surface** as the `wpe_` key. ✅
- **Expires 60 seconds after minting.** ✅ (confirmed twice). This makes it impractical to hand to a
  long-running Node.js process — you'd re-mint per request through a WP round-trip. **Rejected.**
- Its `403` on management endpoints is worded differently — `"insufficient scope: requires
  urn:wpengine:accounts:rw"` — i.e. the *token* lacks the scope, vs. the key path where *API keys as
  a class* are barred. Same practical outcome. ✅

> **Decision:** Nexus authenticates to Power with a portal **`wpe_` Full Access key**, stored in
> Nexus credential storage. The JWT bridge is abandoned. See [`decisions.md`](./decisions.md).

---

## 2. Power API — access matrix (Full Access `wpe_` key)

Results from `scripts/iw/test-power-api-key.sh` this session:

| Category | Endpoint | Result |
|---|---|---|
| Inference / meta | `GET /v1/models` | ✅ `200` (34 models available) |
| Management | `GET /v1/credits` | ⛔ `403` management endpoint |
| Management | `GET /v1/analytics` | ⛔ `403` management endpoint |
| Content tooling | `POST /v1/content/summarize` | ✅ `200` |
| Content tooling | `POST /v1/content/suggest-taxonomy` | ✅ `200` |
| Content tooling | `POST /v1/images/alt-text` | ✅ `200` |
| Agent Registry | `GET /v1/agents` | ✅ `200` |
| Agent Registry | `POST /v1/agents` (create) | ✅ `201` (then `409` on re-run — name taken, proves create) |
| Sessions | `GET /v1/sessions` | ✅ `200` |
| Knowledge Base | `GET /v1/kb/collections` | ✅ `200` |
| Knowledge Base | `POST /v1/kb/collections` | ✅ `201` (then `409` on re-run) |

**Models** are returned dynamically from `/v1/models` in the form `provider/model-name`. The gateway
allow-lists four provider prefixes: **`anthropic/`, `google/`, `openai/`, `gemma/`** (from the Hub
Plugin's `class-wpe-ai-connector-model-directory.php`, `ALLOWED_PROVIDERS`). ✅

The gateway is **OpenAI-compatible** — `/v1/chat/completions` etc. behave like the OpenAI API with
multi-provider routing by prefix.

---

## 3. Hub Plugin connection flow (PKCE + DCR)

The **WP Engine Hub plugin** (`wpe-hub`, v0.14.0; brand name **"Extend"**) is the carrier that binds
a WordPress site to Power. Installed and exercised on the local `myloop` and `t2` sites. ✅

**Facts about the plugin** (verified from source under `wp-content/plugins/wpe-hub/`):

- Singleton `WpeHubPlugin`; delegates auth to `WpeAuthCore`. Requires the **OpenSSL** PHP extension
  (activation `wp_die`s without it). ✅
- Bundled modules: **AI Connector, AI Playground, Knowledge Bases, AI Chatbot, Agents.** ✅
- `is_connected()` ⇔ `wpe_auth_registered` option set **and** `wpe_auth_client_id` present. ✅
- Settings page slug `wpe-hub-settings`. ✅
- **Not distributed on WordPress.org.** Self-updates via the WP Engine Product Info Service:
  `https://wp-product-info.wpesvc.net/v1/plugins/wpe-hub`. ✅ → open question for Nexus install path.

**Endpoints in play:**

- Gateway: `https://api.ai.wpengine.com` (`WpeAuthCore::gateway_url`). ✅
- OAuth (public): `https://api.prd.sdp.wpesvc.net/oauth/public` (`oauth_ext_base_url`). ✅

**The connection sequence** (from `class-wpe-auth-core-register.php`; the browser step observed live
on `t2` — the callback lands on `.../oauth/public/callback?code=...`): ✅

1. **User clicks "Connect"** → browser opens the PKCE authorize URL at `oauth/public`. User picks a
   WP Engine **account** and authorizes scope.
2. Plugin **exchanges the PKCE `code` for a bootstrap token.**
3. Plugin **generates an Ed25519 keypair**, stored **encrypted in `wp_options`.**
4. **DCR** (Dynamic Client Registration) → mints a **`client_id`.**
5. Plugin **`POST /sites`** (`register_site_with_catalog`) with the chosen **`project_id`**;
   `finalize_with_project()` commits the registration.

**What this means for Nexus:** the **browser OAuth handshake is unavoidable** (PKCE + account
picker + project picker). But steps 2–5 are plugin-internal and deterministic, and the *before*
(install/activate the plugin) and *after* (read `client_id`/`project_id`/token via `wpe_auth_*`) are
fully scriptable from Nexus. See journey framing in [`journeys.md`](./journeys.md).

**Account linkage** 🟡: the `wpe_auth_account_id` stored in `wp_options`
(`b97e432b-…575099` on the test site) matches the **Billing Account** shown in the Power Console and
is almost certainly the **CAPI account id** — meaning a site's Power project can be tied back to the
customer's WPE account. Not yet proven end-to-end against CAPI.

**Non-WPE sites work** ✅: the local sites register fine and appear in the Power Console with
**Platform: External**, active. This is what makes **Journey 1** (non-WPE customer) viable.

---

## 4. Agent Registry / Sessions / Knowledge Bases — live endpoints

These are **live on `api.ai.wpengine.com`** and reachable with the `wpe_` key (proven in §2). Paths
below are taken from the Hub Plugin's vendored clients — the authoritative source of the contract.

### Agents — `vendor/wpengine/agents/src/RestClient.php` ✅

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/agents` | create — requires `name` + `model` + `project_id` |
| `GET` | `/v1/agents` | list (filter `?project_id=`) |
| `GET` | `/v1/agents/{id}` | fetch |
| `PATCH` | `/v1/agents/{id}` | update — omitted keys preserve stored values |
| `DELETE` | `/v1/agents/{id}` | delete |

`AgentManager` is the facade: `create/get/list/update/delete/delete_all`. It tags agents with a
`created_by` metadata field, and **folds "grounding" into `tools[]` as `knowledge_base` entries** —
i.e. an agent references a KB collection as a tool. ✅

### Sessions — same client ✅

| Method | Path |
|---|---|
| `POST` | `/v1/sessions` |
| `GET` | `/v1/sessions` |
| `POST` | `/v1/sessions/{id}/events` |
| `GET` | `/v1/sessions/{id}/events` |
| `DELETE` | `/v1/sessions/{id}` |

There is also a **`mint_browser_session`** call that returns a **`wpbs_`-prefixed token** ❓ — its
exact request/response and intended use (browser-side chat auth?) are **not yet understood.** Tracked.

### Knowledge Bases — `vendor/wpengine/kb-sync/src/RestClient.php` ✅

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/kb/collections` | create |
| `GET` | `/v1/kb/collections` | list (project-scoped) |
| `GET` | `/v1/kb/collections/{id}` | fetch |
| `DELETE` | `/v1/kb/collections/{id}` | delete (truncate) |
| `POST` | `/v1/kb/collections/{id}/documents` | single upsert |
| `POST` | `/v1/kb/collections/{id}/documents/bulk` | bulk (**100-doc cap**) |
| `DELETE` | `/v1/kb/collections/{id}/documents/{doc_id}` | delete one |
| `POST` | `/v1/kb/collections/{id}/search` | semantic search |
| `GET` | `/v1/sites/{client_id}` | site record |

`SyncEngine` does **batched, resumable** WP→KB sync — `BATCH_SIZE=100`, `INDEX_BATCH_SIZE=30`,
full sync + incremental single-post upsert on publish. This is the reference implementation for
"index a WordPress site into a Power KB collection." ✅

> **Product boundary (important):** the Agent Registry is real and callable, but **creating Managed
> Agents is not a Nexus feature.** Nexus agents target **Atlas** (§5), not this registry. Nexus may
> *read* the registry for context; it does not author agents there. Confirmed product direction.

---

## 5. Atlas (Headless Platform) & copyinstall

**Atlas / Headless Platform** — the deploy target for **Nexus-authored agents** (Journey 2). ✅ (API
shape from `developers.wpengine.com/docs/headless-platform`, not yet exercised end-to-end 🟡)

- API host `js.wpengineapi.com`; **Basic auth.**
- Flow: **create app → create environment → upload build (zip).**
- This is the "publish an agent to our node hosting" path. The Nexus Agent SDK already scaffolds a
  runnable agent (with `README.md`) via `nexus agent create`; the missing piece is a **build +
  upload** step targeting an Atlas environment.

**copyinstall** — `api.wpengineapi.com/v1/install_copy`. ✅ (documented; not exercised 🟡)

- Copies a WPE install, with **`db_tables`** support for **surgical table extraction.**
- Relevant because it can **replace the "clone a site locally to scan it" pattern** for WPE-hosted
  sites — pull just the tables an agent needs instead of a full local clone.

---

## 6. Reproducing these findings

All three probes live in [`scripts/iw/`](../../../scripts/iw/):

| Script | What it proves | Invocation |
|---|---|---|
| `test-power-api-key.sh` | `wpe_` key access matrix (§2) | `API_KEY=wpe_xxx ./scripts/iw/test-power-api-key.sh` |
| `test-jwt-bridge.mjs` | JWT covers same surface; decodes expiry (§1B) | `JWT="eyJ…" PROJECT_ID=proj_xxx node scripts/iw/test-jwt-bridge.mjs` |
| `cleanup-power-test-objects.mjs` | deletes throwaway agents/collections the probes create | `API_KEY=wpe_xxx node scripts/iw/cleanup-power-test-objects.mjs` |

> ⚠️ `test-power-api-key.sh` and `test-jwt-bridge.mjs` **create real objects** in the target Power
> project (`nexus-test-agent`, `nexus-jwt-bridge-test`, `nexus-test-collection`). Run the cleanup
> script afterward. Get a JWT for the bridge test via Nexus MCP `wp_eval` on a connected site:
> `echo wpe_auth_get_token()`.

---

## 7. Known unknowns (→ tracked in `decisions.md`)

- ❓ **`mint_browser_session` / `wpbs_` tokens** — request shape and purpose.
- ❓ **Hub Plugin distribution to Nexus users** — not on wp.org; bundle it, or install via PIS?
- ❓ **Can Nexus orchestrate the OAuth handshake** (host the callback / drive the browser), or must
  the user complete it in the WP admin as today?
- 🟡 **`wpe_auth_account_id` ⇔ CAPI account** — prove the link end-to-end.
- 🟡 **Atlas upload contract** for a Nexus agent build (entry point, runtime, env/secrets).
