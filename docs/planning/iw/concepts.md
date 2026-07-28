# Intelligent Web Integration — Concepts & Mental Model

A shared vocabulary so the plan and its reviewers don't talk past each other. Several of these terms
collide (two "gateways," two kinds of "agent," three kinds of "id") — this doc is the tiebreaker.
Empirical backing is in [`findings.md`](./findings.md); the user arcs are in [`journeys.md`](./journeys.md).

---

## The one-paragraph model

**Intelligent Web (IW)** is WP Engine's AI platform. It has two faces: **Power** — the runtime (an
OpenAI-compatible AI gateway plus Agent Registry, Sessions, and Knowledge Bases at
`api.ai.wpengine.com`) — and **Extend** — the customer-facing distribution, delivered as WordPress
features by the **Hub Plugin**. **Nexus** (this addon, in **Local**) is neither; it's the authoring
and operations cockpit on the developer's machine. Nexus's integration is to (a) *connect* sites to
Power via the Hub Plugin, (b) *offer* Power as an AI provider at two levels, and (c) *deploy*
Nexus-authored agents to **Atlas** (WPE's node platform) — never to Power's Agent Registry.

```
   ┌────────────────────────────── Developer's machine ──────────────────────────────┐
   │  LOCAL  ──►  NEXUS AI (this addon)                                                │
   │              • authoring cockpit: sites, agents (Agent SDK), chat, ctx.ai         │
   │              • Local Gateway (localhost AI proxy for WP sites)                    │
   └───────────────┬─────────────────────────────────────────────┬────────────────────┘
                   │ connect sites / provide AI                    │ deploy agents
                   ▼                                               ▼
   ┌──────────── WP ENGINE INTELLIGENT WEB ────────────┐   ┌──────── WPE ATLAS ────────┐
   │  POWER (runtime)            EXTEND (distribution)  │   │  Headless / node hosting  │
   │  api.ai.wpengine.com        = Hub Plugin features  │   │  js.wpengineapi.com       │
   │  • /v1/chat/completions      • AI Connector        │   │  create app → env → zip   │
   │  • Agent Registry            • AI Playground       │   │  ◄── Nexus agents land here│
   │  • Sessions                  • Knowledge Bases      │   └───────────────────────────┘
   │  • Knowledge Bases           • AI Chatbot           │
   │  • content tooling           • Agents (registry UI) │
   └────────────────────────────────────────────────────┘
```

---

## Glossary

### Intelligent Web (IW)
The umbrella brand for WP Engine's AI platform. Splits into **Power** (runtime) and **Extend**
(distribution). When someone says "IW" loosely, ask which face they mean.

### Power
The **runtime**. An **OpenAI-compatible** gateway at `https://api.ai.wpengine.com` that routes to
multiple model providers by prefix (`anthropic/`, `google/`, `openai/`, `gemma/`) and also hosts the
Agent Registry, Sessions, Knowledge Bases, and content-tooling endpoints. Auth = `Authorization:
Bearer <cred>` + `WPEngine-Project: <project_id>`. See the full access matrix in `findings.md` §2.

### Extend
The **customer-facing product** — the AI features a WordPress user actually sees. Extend is *delivered
by* the Hub Plugin. "Extend" ≈ "the WP-facing features that Power powers."

### Hub Plugin (`wpe-hub`, brand "Extend")
The **carrier**. A WordPress plugin that connects *any* WP site — WPE-hosted or **external** — to
Power via a browser **PKCE + DCR** OAuth flow, then exposes AI Connector / Playground / Knowledge
Bases / Chatbot / Agents. Requires OpenSSL. **Not on wp.org** (self-updates via the WPE Product Info
Service). It's the thing Nexus installs and drives in Journeys 1 & 3. Contract details: `findings.md` §3–§4.

### Agent Registry ("Managed Agents")
Power's own agent system — `POST /v1/agents`, tools include `knowledge_base` grounding, driven by
`sessions`. It is **real and callable** with a `wpe_` key, but **Nexus does not create agents here.**
This is a *sibling* product surfaced through Extend's "Agents" module, not a Nexus write target. At
most Nexus *reads* it for context.

### Nexus agents
Agents authored in Local with the **Nexus Agent SDK** (`defineAgent()`, `AgentContext`,
`cron()/on()/stream()/webhook()`, `ctx.tools/ai/state/db/credentials`). They run locally today.
Their production destination is **Atlas**, not the Power Agent Registry. Examples in-repo:
security-sentinel, log-processor, seo-insights.

### Atlas (Headless Platform)
WPE's **node hosting**. `js.wpengineapi.com`, Basic auth, flow = create app → create environment →
upload build (zip). This is where **Nexus agents deploy** (Journey 2). Distinct from Power entirely.

> **The agent-triangle, said plainly:** *Agent Registry* = Power's managed agents (not ours).
> *Nexus agents* = what we author in Local. *Atlas* = where our agents run in production. Nexus
> agents flow to **Atlas**, never to the Registry.

### Knowledge Base (KB) / Collection
Power's vector store. A **collection** holds **documents**; supports upsert, bulk (100-doc cap),
delete, and semantic `search`. The Hub Plugin's `kb-sync` does batched, resumable WP→KB indexing —
the reference for "index a site into Power." Nexus can create/populate collections with a `wpe_` key.

### Session
A Power conversation/interaction context (`/v1/sessions`, `.../events`). Used by Agent Registry
agents and chat surfaces. Note the unexplained **`mint_browser_session` → `wpbs_` token** (❓
`findings.md` §4, tracked in `decisions.md`).

### copyinstall
WPE install-copy API (`api.wpengineapi.com/v1/install_copy`) with **`db_tables`** surgical table
extraction. Candidate to replace "clone a whole site locally to scan it" — pull only the tables an
agent needs. Relevant to Journey 3.

---

## The two AI-provider layers (most common confusion)

There are **two independent places** a provider gets chosen. Keep them straight:

| | **Layer 1 — per-site WP provider** | **Layer 2 — Nexus provider** |
|---|---|---|
| Whose inference | The **WordPress site's** own AI features | **Nexus's** own features (chat, ctx.ai, agents) |
| Set via | `wp_setup_ai` / `nexus_switch_provider` (per site) | Nexus **preferences** (global to the addon) |
| Options | Power, Local Gateway, Anthropic, OpenAI, Google, Ollama | today: Anthropic/OpenAI/Google/Ollama/Local Gateway |
| IW change | Power becomes *one option* | **add Power as an option** (Journey 3 ask) |
| Rule | **User chooses. Do NOT assume Power.** | **User chooses. Do NOT assume Power.** |

Both layers are opt-in per the standing product guidance: *"for local sites we want user choice —
Power, Local, or other providers. Don't assume Power."* IW work **adds** Power as a choice at each
layer; it never makes Power a default.

---

## The two "gateways" (do not confuse)

| | **Local Gateway** | **Power gateway** |
|---|---|---|
| Where | `localhost` (in Local, on the dev machine) | `api.ai.wpengine.com` (WPE cloud) |
| What | Nexus's own AI proxy for WP sites; routes to the configured provider | WP Engine's OpenAI-compatible IW runtime |
| Auth | Local gateway token (`NEXUS_AI_AUTH_TOKEN`) | `wpe_` key **or** Hub JWT + `WPEngine-Project` |
| Scope | dev-only, this machine | production, multi-tenant |

> ⚠️ Separately, note the *existing* two-server confusion inside Nexus itself (the real webhook
> gateway on ~13000 vs. the Ollama proxy `AiProxyServer` on ~13100) — that's an internal Nexus
> matter documented in project memory, **orthogonal** to the Local-vs-Power distinction above. Three
> distinct "gateway" things exist; don't collapse them.

---

## The three ids

| id | Looks like | Scope | Where Nexus gets it |
|---|---|---|---|
| **`project_id`** | `proj_cE8Ib44IuegI3rH5l1MbBy` | A Power **project** (the `WPEngine-Project` header) | Hub Plugin `wpe_auth_get_project_id()`; portal |
| **`client_id`** | opaque | The **registered site** (minted by DCR at connect) | Hub Plugin `wpe_auth_client_id` option |
| **`account_id`** | `b97e432b-…575099` (UUID) | The WPE **billing account** (≈ CAPI account) 🟡 | Hub Plugin `wpe_auth_account_id`; CAPI |

Every Power inference/Agent/KB call is **project-scoped** (`project_id`). A **site** maps to a
`client_id` within that project. The `account_id` ties the project back to the **customer's WPE
account** — the (still-to-prove 🟡) bridge that lets Nexus correlate IW projects with the installs it
already tracks in graph.db.

---

## Credentials, in one place

- **`wpe_` API key** (portal) — long-lived, tiered (**Full Access** / Read Only / Restricted
  {Chat,Image,Speech,Transcribe}). **Nexus uses Full Access.** Reaches everything except account
  management (`/v1/credits`, `/v1/analytics` → 403).
- **Hub JWT** (EdDSA, self-minted) — same API surface, **60-second expiry**. Rejected for Nexus.
- **CAPI / portal** — the only path to account-management data (credits, analytics, billing).

See `findings.md` §1–§2 for the evidence and `decisions.md` for storage decisions.
