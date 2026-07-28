# Intelligent Web Integration — Implementation Plan

**Status:** Draft — planning (no code started)
**Branch:** `worktree-iw-integration`
**Foundation:** [`findings.md`](./findings.md) · [`journeys.md`](./journeys.md) · [`concepts.md`](./concepts.md) · [`decisions.md`](./decisions.md)

This plan turns the IW investigation into buildable phases. Each phase opens by naming the
`decisions.md` questions that gate it, states which journey it serves, and ends with an exit
criterion. Nothing here is checked off — it's a proposal for sequencing, not a status report.

---

## Context

Deliver Nexus↔Intelligent Web integration across the three journeys: connect any site to **Power**
(via the **Extend**/Hub Plugin), offer Power as an AI provider at **both layers**, index/search
**Knowledge Bases**, overlay IW status on the existing fleet view, and (via a sibling plan) deploy
Nexus agents to **Atlas**.

**Relationship to the Nexus Agent Platform (important scope boundary).**
The [Agent Platform vision](../nexus-agent-platform/vision.md) already owns agent authoring/runtime
(Spec 01) and **Atlas deploy + npm distribution (Spec 03, Publisher)**. Its risk log explicitly
calls for two things this investigation just delivered:

- *"'Intelligent Web' scope — Undefined. Needs its own discovery exercise."* → **done** (this folder).
- *"Atlas integration unknown — needs validation against actual Atlas API before Spec 03 begins."* →
  **Phase 4 here validates it and hands the result to Spec 03.**

So **this plan does NOT re-plan agent→Atlas deploy.** Journey 2's build lives in Agent Platform
Spec 03; Phase 4 below is the *IW-side contribution* to it (validate the Atlas contract, expose Power
as an SDK provider/tool category). Everything else — Power credential, provider wiring, Extend
connect, KB, fleet overlay, copyinstall — is owned here.

**Two invariants carried from `journeys.md`, enforced in every phase:**
1. Nexus **never writes** to the Power Agent Registry. Agents are a Nexus→Atlas story.
2. **Provider choice is the user's** at both layers. Power is an *option*, never a default.

---

## Architecture Reference

Real surfaces this plan touches (confirm exact symbols at implementation time):

- **Power credential (Q6).** Store the `wpe_` Full Access key in Local secret storage, alongside
  existing provider keys. Design already sketched in `docs/planning/credential-manager-design.md` /
  `credential-manager-plan.md` — reuse, don't reinvent. One account key + per-call `WPEngine-Project`
  header serves many projects.
- **Layer-1 per-site WP provider.** `src/main/mcp/modules/**/setup-ai.ts` and `switch-provider.ts`;
  `AIProvider` type (`'anthropic' | 'openai' | 'google' | 'ollama' | 'local-gateway'`). Adding Power
  = a new provider entry + bundled/installed provider plugin path.
- **Layer-2 Nexus provider.** `NexusSettings` (`aiProvider`/`aiModel`) + **`UpdateSettingsSchema` in
  `schemas.ts`** — ⚠️ `.strict()` silently strips any new field not added there (known pitfall). Plus
  the preferences UI section.
- **Power gateway client.** New client hitting `https://api.ai.wpengine.com`, OpenAI-compatible →
  closely mirrors the existing OpenAI provider path. Headers: `Authorization: Bearer <wpe_key>` +
  `WPEngine-Project`.
- **MCP tools.** New handlers under `src/main/mcp/modules/iw/*.ts`, registered in the MCP `index.ts`;
  safety tiers in `src/main/mcp/safety.ts` (`TIER_OVERRIDES` etc.).
- **CLI bridge (per tool that needs CLI parity).** Commander subcommand → GraphQL `schema.ts` type +
  mutation/query → `resolvers.ts` → `ipc-handlers.ts` → tool registry. All four are required.
- **Hub Plugin detection.** **Filesystem check in Node.js**, not WP-CLI — plugin-presence checks
  during bootstrap race WordPress init (Smart Search MU-plugin pitfall). Path:
  `wp-content/plugins/wpe-hub/`.
- **WPE env guard.** `wpeAllowedEnvironments` blocks SSH/WP-CLI on excluded envs (production by
  default) — see `src/main/mcp/utils/environment-filter.ts`. Connect/index flows that shell into a
  WPE install must account for this; CAPI + push/pull are unaffected.
- **Agent→Atlas (Phase 4).** Owned by `docs/planning/nexus-agent-platform/spec-01-sdk-runtime.md`
  (contract) and Spec 03 (publisher). Atlas API: `js.wpengineapi.com`, Basic auth.

---

## Phase 0 — De-risk: resolve the blocking unknowns (spikes)

**Do this first.** Cheap, time-boxed spikes that convert `decisions.md` Open questions into decisions.
No production code. Order = cheapest/highest-leverage first.

- [ ] **Q4 — prove `wpe_auth_account_id` ⇔ CAPI account.** Read the option off a connected test site
  (`myloop`/`t2`), match against `wpe_get_accounts`. *Exit:* confirmed same namespace, or documented
  divergence. (Cheapest; unblocks the Journey 3 fleet overlay.)
- [ ] **Q2 — Hub Plugin distribution.** Determine whether Nexus may install `wpe-hub` on an
  **external** site via the Product Info Service (`wp-product-info.wpesvc.net/v1/plugins/wpe-hub`),
  or must bundle it, or must leave it manual. Check redistribution licensing for the bundle option.
  *Exit:* a chosen install mechanism for Phase 2.
- [ ] **Q3 — OAuth orchestration.** Prototype the low-risk path: Nexus opens the WP-admin Hub connect
  page, user completes PKCE in browser, Nexus polls `is_connected()` / reads `wpe_auth_*`. *Exit:*
  confirmed we can detect connection completion without hosting the callback (or decide to host it).
- [ ] **Q5 — Atlas contract (feeds Agent Platform Spec 03).** Manually deploy one real Nexus agent
  (e.g. `seo-insights`) end-to-end: create app → env → upload zip. *Exit:* documented entry point,
  runtime, and env/secret handling → handed to Spec 03.
- [ ] **Q6 — credential storage decision.** Confirm reuse of the credential-manager design for the
  `wpe_` key; global-key + per-project-header model. *Exit:* storage location + scoping decided.
- [ ] **Q8 — agent secrets across Local→Atlas.** Determine whether Atlas supports env/secret
  injection at deploy time (preferred) vs. runtime fetch. *Exit:* a secrets approach for Spec 03.

**Deferred (not on critical path):** Q1 (`mint_browser_session`/`wpbs_`) — revisit only if/when we
embed browser-side chat. Q7 (Layer-2 scope) and Q9 (KB ownership) are decided inline in Phases 1 & 3.

**Phase 0 exit:** every "Open" question in `decisions.md` that gates Phases 1–4 is moved to
Decided/Leaning, with the answer written back into `decisions.md`.

---

## Phase 1 — Power as a Nexus (Layer-2) provider

**Serves:** Journey 3 (explicit ask), available to all. **Gated on:** Q6, Q7 (decided inline).
**Why first:** lowest risk, no Hub Plugin dependency, immediate value, and mechanically close to the
existing OpenAI provider path (Power is OpenAI-compatible). Builds entirely on verified facts.

**Q7 decision (inline):** phased scope — **chat/assistant first**, then agent `ctx.ai`. Start narrow.

- [ ] Store the `wpe_` Full Access key in Local secret storage (per Q6 decision).
- [ ] Add a Power gateway client (base `api.ai.wpengine.com`, OpenAI-compatible, project header).
- [ ] Register **Power** as a selectable Layer-2 provider in `NexusSettings` — **and add the field to
  `UpdateSettingsSchema` in `schemas.ts`** (⚠️ `.strict()` will strip it otherwise).
- [ ] Populate model list dynamically from `GET /v1/models` (34 models, `provider/model` format).
- [ ] Preferences UI: Power option + project selector + key entry/validation.
- [ ] Wire Power into the Nexus **chat/assistant** inference path.
- [ ] Unit tests: client, model-list mapping, settings round-trip (guard the `.strict()` pitfall).

**Exit:** a user can select Power as Nexus's provider in preferences and use it for chat, with their
own `wpe_` key; provider choice remains theirs (Power is not defaulted).

---

## Phase 2 — Connect a site to Power (Extend / Hub Plugin)

**Serves:** Journey 1 (and the per-install connect in Journey 3). **Gated on:** Q2, Q3 (from Phase 0).

- [ ] Detect Hub Plugin presence via **filesystem check** (`wp-content/plugins/wpe-hub/`), not WP-CLI.
- [ ] Install/activate the Hub Plugin per the Q2 decision (PIS vs bundle vs guided-manual).
- [ ] Surface a "Connect to WP Engine AI" action; open the Hub connect flow per the Q3 decision.
- [ ] Poll `is_connected()` / read `wpe_auth_client_id`, `wpe_auth_project_id`, `wpe_auth_account_id`.
- [ ] Persist the site→project binding in Nexus (keyed to the site; correlate to install via Q4).
- [ ] Show connection status (connected? project? account?) in the site's Nexus panel.
- [ ] Handle the OpenSSL-missing case gracefully (Hub activation `wp_die`s without it).
- [ ] Respect `wpeAllowedEnvironments` for any WP-CLI touch on WPE installs.

**Exit:** from Nexus, a previously-unconnected site (including an **external** one) ends up connected
to a Power project, with status visible in Nexus. Verified against `myloop`/`t2`.

---

## Phase 3 — Per-site Power provider (Layer 1) + KB + fleet overlay

**Serves:** Journeys 1 & 3. **Gated on:** Q4 (overlay), Q9 (decided inline).

**Q9 decision (inline):** where the Hub Plugin is connected, **it owns KB sync** (its shipped
`kb-sync` does batched/resumable indexing). Nexus **reads and searches**; it does not re-implement
indexing. Nexus-owned sync is reconsidered only for sites without the Hub Plugin.

- [ ] Add **Power** as a Layer-1 per-site WP provider option in `setup-ai.ts` / `switch-provider.ts`
  (user choice — **not** assumed even on WPE sites).
- [ ] KB read: list collections (`GET /v1/kb/collections`), fetch, and **search**
  (`POST /v1/kb/collections/{id}/search`) via MCP tools under `src/main/mcp/modules/iw/`.
- [ ] Fleet overlay: for each install Nexus already tracks, show IW connection status + project + KB
  presence (uses the Q4 account↔install correlation).
- [ ] CLI parity for the read/search tools (schema → resolver → ipc-handler → registry).
- [ ] Tests: KB client (list/fetch/search), fleet-overlay correlation.

**Exit:** a WPE customer sees IW status across their fleet in Nexus; can pick Power per-site; can
search a site's KB collection from Nexus.

---

## Phase 4 — Agents → Atlas (IW-side inputs to Agent Platform Spec 03)

**Serves:** Journey 2 (the furthest-out journey). **Gated on:** Q5, Q8. **Ownership:** the agent
build/deploy *mechanism* is [Agent Platform](../nexus-agent-platform/vision.md) Spec 01–03; this
phase produces the **IW-specific inputs** Spec 03 needs and stops there.

**The seam — mechanism vs. IW-specificity.** Agent Platform owns *how any agent is built, run, and
shipped* (generic: the `defineAgent` contract, the runtime, packaging, the Atlas/npm publisher). IW
owns *everything Power/WPE-specific* an agent or Nexus touches. Phase 4 sits exactly on that line:

| Concern | Owner |
|---|---|
| `defineAgent` contract, triggers, `ctx` API, runtime, sandboxing, state | Agent Platform **Spec 01** |
| Build / package toolchain | Agent Platform **Spec 02** |
| Atlas deploy mechanism (app/env/upload), npm publish, **deploy UI** | Agent Platform **Spec 03** |
| The *slot* by which an agent selects a provider | Agent Platform **Spec 01** (contract) |
| Validated **Atlas contract facts** (entry point, runtime, env/secrets) | **IW Phase 4 → Spec 03** |
| **Secrets model** for a deployed agent | **IW Phase 4 → Spec 03** |
| **Power provider module** (client, auth, model list) | **IW** (Phase 1, reused) |
| Connect-to-Power, KB read/search, fleet overlay, copyinstall | **IW** (Phases 2, 3, 5) |

**What crosses the seam — three artifacts, all flowing IW → Spec 03, nothing coming back:**

- [ ] **Atlas deploy contract** (from the Q5 spike): create app → env → upload zip; documented entry
  point + runtime expectations for a Nexus agent bundle.
- [ ] **Secrets model** (from the Q8 spike): how a deployed agent receives credentials — Atlas env
  secrets at deploy time (preferred) vs. runtime fetch; **no secrets baked into the build**.
- [ ] **Power provider module**: the Phase 1 client, packaged so a *self-contained* Atlas runtime can
  call Power with **no Local dependency** (the vision's hard constraint). IW supplies the
  implementation; Spec 01 defines the provider *slot* it plugs into.
- [ ] Confirm the vision's "Intelligent Web customer" segment matches `journeys.md`; refine if not.

**Phase 4 builds no deploy UI and no runtime** — those are Spec 03. It ends when Spec 03 has what it
needs to start.

**Timing reality.** Journey 2 end-to-end (author locally → run on Atlas) needs Spec 01 (in progress)
+ Spec 02 + Spec 03 (both not started), so it is the **last** journey to actually ship. IW's
contribution here is independent of that timeline and can be done early: **IW unblocks Journey 2;
Agent Platform delivers it.** This plan does not promise Journey 2 delivery.

**Open decision (→ `decisions.md` Q10):** if the Agent Platform stack stalls, does IW build a
minimal standalone Atlas deploy for a single agent (Publisher-lite), or does Journey 2 wait?
*Leaning: wait — don't fork the runtime.*

**Exit:** Spec 03 has a validated Atlas contract, a secrets model, and a Power provider module —
enough to start the Publisher build.

---

## Phase 5 — copyinstall + polish

**Serves:** Journey 3. **Gated on:** nothing new (uses existing WPE CAPI auth).

- [ ] Wrap `POST /v1/install_copy` with `db_tables` surgical extraction as an MCP tool.
- [ ] Offer copyinstall as the data-pull path for agent-driven analysis of WPE sites (vs. full local
  clone).
- [ ] Fleet IW dashboard polish: connection, project, KB, and (read-only) Agent Registry presence per
  install.
- [ ] Docs: user-facing "Connect to WP Engine AI" + "Use Power in Nexus" guides.

**Exit:** WPE-hosted analysis can pull only needed tables; the IW dashboard is complete.

---

## Sequencing rationale

```
Phase 0 (spikes)  ──► resolves Q2–Q6, Q8
        │
        ├─► Phase 1  Power as Nexus provider (L2)      ← buildable now, no Hub dep, fastest value
        │
        ├─► Phase 2  Connect site to Power (Extend)    ← needs Q2+Q3
        │        │
        │        └─► Phase 3  L1 provider + KB + overlay ← needs Phase 2 + Q4
        │
        └─► Phase 4  Atlas contract → Spec 03           ← needs Q5+Q8; hands off, doesn't build UI
                 │
                 └─► Phase 5  copyinstall + polish
```

Phase 1 ships value with **zero** dependency on the risky unknowns; Phases 2–3 form the Extend
connect→use spine; Phase 4 is a hand-off, not a build; Phase 5 is optimization. Each phase's first
task is to confirm its gating `decisions.md` questions are resolved.

---

## Open items to settle before starting Phase 1

- [ ] Confirm this phasing and the Agent-Platform hand-off boundary with the user.
- [ ] Confirm Q6/Q7 inline decisions (credential storage; L2 scope = chat-first).
- [ ] Run the Phase 0 spikes and write results back into `decisions.md`.
