# Intelligent Web Integration — Decisions & Open Questions

An ADR-lite log. Two sections: **decisions already settled** by the investigation, and **open
questions** that must be answered before or during planning. Evidence lives in
[`findings.md`](./findings.md); terms in [`concepts.md`](./concepts.md); the arcs they serve in
[`journeys.md`](./journeys.md).

Each entry: **Question · Why it matters · Options · Status/Leaning · Blocks.**
Status ∈ {**Decided**, **Leaning**, **Open**}.

---

## Part A — Decisions settled by the investigation

### D1 — Authenticate to Power with a portal `wpe_` Full Access key  ·  **Decided**
- **Why.** It's the only durable credential that reaches the full Nexus-relevant surface (inference,
  Agent read, Sessions, KB) — proven in `findings.md` §2.
- **Options considered.** (A) `wpe_` key. (B) Hub-minted EdDSA JWT.
- **Decision.** **(A).** The JWT works but **expires in 60 seconds** — impractical for a Node.js
  service; it would require a WP round-trip per request. Rejected.
- **Blocks.** → Q6 (where the key is stored).

### D2 — Nexus agents deploy to Atlas, never to Power's Agent Registry  ·  **Decided**
- **Why.** Confirmed product direction: creating Managed Agents is not a Nexus capability. Nexus
  agents are a Local-authoring → Atlas-runtime story (`findings.md` §4–§5, `journeys.md` J2).
- **Options considered.** (A) Register Nexus agents in Power's Registry. (B) Deploy to Atlas.
- **Decision.** **(B).** Nexus may *read* the Registry for context; it does not write to it.
- **Blocks.** → Q5, Q8 (Atlas contract + secrets).

### D3 — Provider choice stays the user's, at both layers; Power is never a default  ·  **Decided**
- **Why.** Standing guidance: "for local sites we want user choice — Power, Local, or other. Don't
  assume Power." Applies to Layer 1 (per-site WP provider) and Layer 2 (Nexus provider) alike
  (`concepts.md` → two-layer model).
- **Decision.** IW work **adds** Power as a selectable option at each layer. It never sets Power as a
  default or removes existing options.
- **Blocks.** → Q7 (scope of Power as a Layer-2 provider).

### D4 — Account-management data stays on CAPI/portal  ·  **Decided**
- **Why.** Power's management endpoints (`/v1/credits`, `/v1/analytics`) return **403** for `wpe_`
  keys and "insufficient scope" for JWTs (`findings.md` §1–§2). There is no key-based path to
  credits/analytics/billing.
- **Decision.** Any credits/usage/billing surface in Nexus reads from **CAPI/portal**, not Power.
- **Blocks.** — (uses existing WPE CAPI tooling).

---

## Part B — Open questions

### Q1 — What are `mint_browser_session` / `wpbs_` tokens for?  ·  **Open**
- **Why it matters.** Likely the auth mechanism for browser-side chat/Playground. If Nexus ever
  surfaces an embedded chat, this is probably how. Currently a black box (`findings.md` §4).
- **Options.** (A) Reverse it from Hub Plugin JS. (B) Ask the IW team. (C) Defer — not on the
  critical path for connect/index/deploy.
- **Leaning.** **(C) defer**, capture when we touch chat embedding.
- **Blocks.** Any embedded-chat feature.

### Q2 — How does the Hub Plugin get onto a user's site?  ·  **Decided (✅ PIS probed 2026-07-24)**
- **Why it matters.** It's **not on wp.org** (`findings.md` §3). Journeys 1 & 3 depend on Nexus
  being able to install it.
- **Options.** (A) Nexus bundles the Hub Plugin zip and installs it (like the bundled provider
  plugins in `wp-plugins/`). (B) Nexus installs from the WPE Product Info Service
  (`wp-product-info.wpesvc.net/v1/plugins/wpe-hub`). (C) User installs it manually; Nexus only
  detects + drives connect.
- **Decision.** **(B) — install from PIS on demand.** The PIS endpoint returns a standard WP-update
  JSON with `download_link`/`package` → a **pre-signed S3 zip** (`wpe-hub-0.14.0.zip`) needing **no
  license key or auth** to fetch; it answered our **unauthenticated** request, so it's reachable for
  **external (non-WPE) sites** too. Two facts kill (A): the signed URL is short-lived (a bundled copy
  would drift from the live version), and the plugin is now under the **WP Engine EULA** (GPLv2 dropped
  in v0.3.0) — redistributing a proprietary zip inside Nexus is a licensing question (B) sidesteps,
  since the user's site pulls it straight from WPE's own channel. Keep **(C)** as the manual fallback
  if PIS is ever unreachable.
- **Residual.** Confirm the EULA permits install-on-behalf (almost certainly fine — WPE's own product,
  onto the user's own site) and that Nexus fetches metadata → zip → install in one pass (signed-URL TTL).
- **Blocks.** — (unblocks J1/J3 connect flow).

### Q3 — Can Nexus orchestrate (host/drive) the OAuth handshake?  ·  **Decided (✅ proven 2026-07-25)**
- **Why it matters.** The PKCE + account/project pickers are browser-bound (`findings.md` §3). How
  much of it Nexus can wrap determines how "one-click" connect feels.
- **Options.** (A) Nexus opens the WP-admin Hub settings page and polls `is_connected()` after the
  user finishes (least invasive). (B) Nexus hosts the OAuth callback itself (localhost redirect) and
  drives the flow directly. (C) Fully manual.
- **Decision.** **(A) — confirmed viable, no callback hosting needed.** The Hub Plugin's
  `callback_url()` returns the settings page URL itself (`admin.php?page=wpe-hub-settings`). oauth-ext
  redirects the browser back to WP-admin after consent; the `handle_oauth_callback()` admin_init hook
  on that page processes the `?code=…&state=…` params and writes the connection state. Nexus never
  touches the OAuth callback.
- **Nexus connect flow (v1):**
  1. `shell.openExternal(siteUrl + '/wp-admin/admin.php?page=wpe-hub-settings')` — opens Hub settings
     in the user's default browser.
  2. Poll `wp_eval get_option('wpe_auth_registered') && get_option('wpe_auth_client_id')` every 2–3 s.
  3. When both are truthy, read `wpe_auth_project_id` (immediate) and `wpe_auth_account_id` (lazy —
     written on first token use; may need a follow-up poll).
- **Key option names written at registration:** `wpe_auth_registered` (bool), `wpe_auth_client_id`,
  `wpe_auth_project_id`. Written lazily: `wpe_auth_account_id` (from JWT claims, first token fetch).
- **Copy detection:** `wpe_auth_copy_detected` is non-empty when the site was cloned and credentials
  were cleared. Nexus must surface this as a "reconnect needed" state rather than treating the site as
  connected.
- **Admin page slug:** `wpe-hub-settings`. Full URL: `{siteUrl}/wp-admin/admin.php?page=wpe-hub-settings`.
  On Local sites this resolves to `http://localhost:{port}/wp-admin/…`.
- **Blocks.** — (unblocks J1/J3 connect flow; Phase 2 can now start).

### Q4 — Prove `wpe_auth_account_id` ⇔ CAPI account  ·  **Decided (✅ proven 2026-07-24)**
- **Why it matters.** This is the bridge that lets Nexus correlate IW **projects** with the WPE
  **installs** it already tracks in graph.db — the backbone of Journey 3's fleet view.
- **Options.** (A) Match the stored UUID against `wpe_get_accounts` / CAPI for the test account. (B)
  Ask IW/CAPI team to confirm the identifier is the same namespace.
- **Decision.** **(A) — proven.** `wpe_auth_account_id` = `b97e432b-c10a-4f0a-9ce7-55cedd575099`
  (identical on `myloop` and `t2`) is byte-identical to CAPI account **`w7579`** from
  `wpe_get_accounts`. `wpe_auth_account_id` *is* a CAPI account id; no translation needed. Corollary:
  `project_id`/`account_id` are project-scoped (shared across a project's sites), `client_id` is
  per-site — confirming the three-id model in `concepts.md`. Evidence in `findings.md` §3.
- **Unblocks.** J3 fleet-wide IW status overlay (correlate connected sites → account → tracked installs).

### Q5 — What's the Atlas upload contract for a Nexus agent build?  ·  **Open (🟡)**
- **Why it matters.** J2's whole payoff. We know the shape (create app → env → upload zip, Basic
  auth) but not the runtime expectations for a *Nexus agent* specifically (`findings.md` §5).
- **Options.** (A) Package the agent as a standard Atlas node app (entry point + deps). (B) A thin
  Nexus runtime shim that hosts the agent on Atlas.
- **Leaning.** Unknown — needs an end-to-end spike deploying one real agent (e.g. seo-insights).
- **Blocks.** J2 deploy; Q8.

### Q6 — Where/how does Nexus store the Power `wpe_` key?  ·  **Decided (✅ confirmed vs repo 2026-07-24)**
- **Why it matters.** It's a long-lived, powerful credential (Full Access). Must follow existing
  Nexus credential hygiene.
- **Options.** (A) Same secure storage as other provider API keys (Local's secret storage). (B)
  Per-site vs global scoping — one account key, or per-project keys.
- **Decision.** **(A) storage + one global account key.** Store in the **Electron KeyVault**
  (OS-keychain-encrypted at rest) — the same `AI_PROVIDER_KEYS` path Anthropic/OpenAI/Google keys use
  (`docs/architecture/credential-architecture.md`). It's a static key → use the **API-key** path
  (`CredentialManager.setApiKey` / `getSecretForAgent`, `ApiKeyConnectionStore`), not the OAuth path.
  **One Full-Access `wpe_` key, stored globally**; `project_id` is supplied per-request via the
  `WPEngine-Project` header — empirically fine because **Q4** showed the account key spans every
  project under the account. No per-site key storage.
- **Invariant (carry into Phases 1/3).** The `wpe_` key **never leaves the Electron process**, exactly
  like today's cloud keys. Layer-2 (Nexus inference) reads it in-process; Layer-1 (per-site WP
  provider) **proxies through the Local Gateway** so the WP DB only ever holds the localhost token,
  never the `wpe_` key. For agents on Atlas the key is a **deploy-time Atlas env secret** (→ Q8),
  never bundled into the build.
- **Blocks.** — (unblocks any Power call from Nexus; D1 follow-through).

### Q7 — What's the scope of "Power as a Nexus (Layer-2) provider"?  ·  **Open**
- **Why it matters.** Journey 3's explicit ask. "Add Power as a provider" could mean chat only, or
  everything Nexus infers (chat + ctx.ai + agent inference).
- **Options.** (A) Chat/assistant only. (B) All Nexus inference incl. agents' `ctx.ai`. (C) Phased:
  chat first, agents later.
- **Leaning.** **(C)**. Power is OpenAI-compatible, so wiring it as a provider is mechanically close
  to the existing OpenAI path; start with chat, extend to `ctx.ai`.
- **Blocks.** Preferences UI scope; provider-abstraction changes.

### Q8 — How do agent secrets/credentials cross the Local→Atlas boundary?  ·  **Open**
- **Why it matters.** A Nexus agent uses `ctx.credentials` locally; on Atlas those must come from
  somewhere safe. Naively bundling secrets into the upload zip is unacceptable.
- **Options.** (A) Atlas environment variables/secrets set at deploy time. (B) Agent fetches from a
  Nexus-hosted secret endpoint at runtime. (C) Power-issued scoped creds.
- **Leaning.** **(A)** if Atlas supports env secrets; avoid baking secrets into the build.
- **Blocks.** J2 production readiness.

### Q11 — Can Nexus use existing WPE credentials to automate Hub registration?  ·  **Decided (✅ proven 2026-07-26)**
- **Why it matters.** If the CAPI JWT or `wpe_` key could act as an Initial Access Token for Hub's DCR endpoint, Nexus could register a WP site to Power programmatically — eliminating the browser OAuth step entirely.
- **Options.** (A) Open registration (no auth). (B) CAPI JWT as Bearer IAT. (C) `wpe_` Full Access key as Bearer IAT. (D) Browser PKCE flow (current approach).
- **Decision.** **(D) — browser PKCE is mandatory.** Proven by probing `https://api.prd.sdp.wpesvc.net/oauth/public/register`:
  - Open (no auth): **403 RBAC: access denied** — registration is not public.
  - CAPI JWT Bearer: **401 invalid_token** — CAPI tokens (`api.wpengineapi.com`) are not trusted by the Power auth server (`api.prd.sdp.wpesvc.net`). The two systems are separate OAuth ecosystems.
  - `wpe_` Full Access key: **rejected as non-JWT** — it's a plain string, not a JWT.
  - The PKCE browser flow is a deliberate security boundary; user consent is required to tie a specific WP installation to a WP Engine account.
- **Implication.** The Hub browser flow cannot be bypassed. Nexus's role is to automate everything around it: install Hub Plugin, open the right URL, poll for completion, complete WP AI setup — the user clicks once in the browser, Nexus does the rest.
- **Blocks.** — (closes the question; confirms the Q3 Option A approach is the right and only path)

### Q9 — Who owns the per-site KB collection lifecycle — Nexus or the Hub Plugin?  ·  **Open**
- **Why it matters.** Both can create/populate collections (`findings.md` §4). If both sync the same
  site, we get duplication or drift.
- **Options.** (A) Hub Plugin owns sync; Nexus only reads/searches. (B) Nexus owns sync; Hub Plugin
  disabled for that site. (C) Explicit ownership flag per collection.
- **Leaning.** **(A)** where the Hub Plugin is already connected (don't fight the shipped
  `kb-sync`); Nexus adds value via search/agents, not by re-implementing indexing.
- **Blocks.** Any Nexus KB feature; avoids double-indexing.

### Q5 — What's the Atlas upload contract for a Nexus agent build?  ·  **Decided (✅ proven 2026-07-27)**
- **Why it matters.** J2's whole payoff — defines what Spec 03 (Publisher) must produce.
- **Spike:** Deployed `nexus-hello-agent` (minimal Node.js HTTP server) to Atlas via zip upload. Live at `htfqiga1ef8zmnpi7ip352h4c.js.wpenginepowered.com`. Account `w7579`, env `45f6f177-ef59-a5e0-1885-08a733921e46`.
- **Confirmed runtime contract:**
  - **API auth:** HTTP Basic (`ATLAS_API_USER:ATLAS_API_PASSWORD`, from WPE portal → Users → API Access)
  - **Three-step deploy:** `POST /v1/.../apps` → `POST /v1/.../environments` → `POST /fu/v1/.../environments/{id}:upload` (multipart)
  - **Zip structure:** Files inside a named folder at zip root (e.g. `nexus-hello-agent/index.js`)
  - **Node.js version:** Reads from `package.json engines.node` or `.nvmrc`. Defaults to latest (v24) with `>=18`. Recommend pinning to `"node": "20"` → installs v20.20.2 LTS.
  - **npm:** v10.8.2 (default for Node 20)
  - **Build step:** `npm run build` — **REQUIRED**. Missing build script = deploy fails. Use `"build": "echo 'no build step'"` for pure runtime apps.
  - **Start command:** `npm start` → executes `package.json scripts.start` → e.g. `node index.js`
  - **PORT:** Atlas injects `process.env.PORT = "8080"`. App **must** listen on `process.env.PORT`.
  - **NODE_ENV:** Not set by default — inject via `shellVariables` if needed.
  - **URL pattern:** `{hash}.js.wpenginepowered.com` (hash-based, not `{app-name}`)
  - **`wpEnvironment`:** Required field — must be a real WP install name in the account (e.g. `jppsandbox`). Empty/fake values rejected. **Expected to become optional in future Atlas versions.**
  - **Env vars / secrets:** Set via `shellVariables: [{key, value}]` in create-env body, or via portal after first deploy. Never baked into the zip. (Confirms Q8 Option A.)
  - **App-already-exists handling:** API returns HTTP 400 `APP_ALREADY_EXISTS` (not 409) on create-app — handle both for re-deploys.
  - **package-lock.json:** Recommended (Atlas warns without it) but not required.
- **Blocks.** → Q8 confirmed (env secrets at deploy time). Handed to Agent Platform Spec 03.

### Q10 — If the Agent Platform stalls, does IW build a minimal Atlas deploy?  ·  **Open**
- **Why it matters.** Journey 2's agent→Atlas delivery is owned by
  [Agent Platform](../nexus-agent-platform/vision.md) Spec 03, which itself depends on Spec 01
  (in progress) + Spec 02 (not started). If that stack slips, J2 has no delivery path even though
  IW Phase 4 has produced everything Spec 03 needs.
- **Options.** (A) Wait — J2 ships when the Agent Platform ships; IW never forks the runtime.
  (B) IW builds a **Publisher-lite**: a minimal, standalone "deploy this one agent to Atlas" using
  the Phase 4 contract, no SDK/Builder dependency, retired when Spec 03 lands.
- **Leaning.** **(A) wait.** Forking the runtime creates two things that both claim to deploy agents —
  exactly the overlap the hand-off exists to avoid. Revisit only if J2 becomes independently urgent.
- **Blocks.** Nothing now — this is a contingency. Phase 4's deliverables (contract, secrets model,
  Power provider module) are identical either way.

---

## Cross-references

- Every **Decided** entry (D1–D4) is evidenced in `findings.md`.
- Every **Open** question maps to a journey it unblocks (`journeys.md`).
- The plan (`plan.md`, not yet written) should open each phase by resolving the specific Q's that
  gate it — e.g. J1 connect phase gates on **Q2 + Q3**; J2 deploy phase gates on **Q5 + Q8**.
