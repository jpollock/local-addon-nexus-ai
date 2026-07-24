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

### Q2 — How does the Hub Plugin get onto a user's site?  ·  **Open**
- **Why it matters.** It's **not on wp.org** (`findings.md` §3). Journeys 1 & 3 depend on Nexus
  being able to install it.
- **Options.** (A) Nexus bundles the Hub Plugin zip and installs it (like the bundled provider
  plugins in `wp-plugins/`). (B) Nexus installs from the WPE Product Info Service
  (`wp-product-info.wpesvc.net/v1/plugins/wpe-hub`). (C) User installs it manually; Nexus only
  detects + drives connect.
- **Leaning.** **(B)** if PIS install is permitted for non-WPE sites; else **(A)**. (A) risks
  shipping a stale copy and version drift.
- **Blocks.** J1/J3 connect flow; licensing/redistribution check for (A).

### Q3 — Can Nexus orchestrate (host/drive) the OAuth handshake?  ·  **Open**
- **Why it matters.** The PKCE + account/project pickers are browser-bound (`findings.md` §3). How
  much of it Nexus can wrap determines how "one-click" connect feels.
- **Options.** (A) Nexus opens the WP-admin Hub settings page and polls `is_connected()` after the
  user finishes (least invasive). (B) Nexus hosts the OAuth callback itself (localhost redirect) and
  drives the flow directly. (C) Fully manual.
- **Leaning.** **(A)** for v1 — robust, no callback-hosting complexity; revisit (B) if the UX is too
  rough.
- **Blocks.** J1/J3 UX; depends on whether the OAuth client allows a localhost/redirect Nexus controls.

### Q4 — Prove `wpe_auth_account_id` ⇔ CAPI account  ·  **Open (🟡 inferred)**
- **Why it matters.** This is the bridge that lets Nexus correlate IW **projects** with the WPE
  **installs** it already tracks in graph.db — the backbone of Journey 3's fleet view.
- **Options.** (A) Match the stored UUID against `wpe_get_accounts` / CAPI for the test account. (B)
  Ask IW/CAPI team to confirm the identifier is the same namespace.
- **Leaning.** Do **(A)** — cheap to verify with existing `wpe_*` MCP tools.
- **Blocks.** J3 fleet-wide IW status overlay.

### Q5 — What's the Atlas upload contract for a Nexus agent build?  ·  **Open (🟡)**
- **Why it matters.** J2's whole payoff. We know the shape (create app → env → upload zip, Basic
  auth) but not the runtime expectations for a *Nexus agent* specifically (`findings.md` §5).
- **Options.** (A) Package the agent as a standard Atlas node app (entry point + deps). (B) A thin
  Nexus runtime shim that hosts the agent on Atlas.
- **Leaning.** Unknown — needs an end-to-end spike deploying one real agent (e.g. seo-insights).
- **Blocks.** J2 deploy; Q8.

### Q6 — Where/how does Nexus store the Power `wpe_` key?  ·  **Open**
- **Why it matters.** It's a long-lived, powerful credential (Full Access). Must follow existing
  Nexus credential hygiene.
- **Options.** (A) Same secure storage as other provider API keys (Local's secret storage). (B)
  Per-site vs global scoping — one account key, or per-project keys.
- **Leaning.** **(A)** storage; **global account key with per-project header** (the header carries
  `project_id`, so one Full Access key can serve many projects). Confirm against tiering.
- **Blocks.** D1 follow-through; any Power call from Nexus.

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

### Q9 — Who owns the per-site KB collection lifecycle — Nexus or the Hub Plugin?  ·  **Open**
- **Why it matters.** Both can create/populate collections (`findings.md` §4). If both sync the same
  site, we get duplication or drift.
- **Options.** (A) Hub Plugin owns sync; Nexus only reads/searches. (B) Nexus owns sync; Hub Plugin
  disabled for that site. (C) Explicit ownership flag per collection.
- **Leaning.** **(A)** where the Hub Plugin is already connected (don't fight the shipped
  `kb-sync`); Nexus adds value via search/agents, not by re-implementing indexing.
- **Blocks.** Any Nexus KB feature; avoids double-indexing.

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
