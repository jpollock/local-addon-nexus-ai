# Power as a Layer-2 Nexus Provider (Chat) — Design

- **Date:** 2026-07-24
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Phase:** IW Integration — Phase 1 ("Power as a Layer-2 Nexus provider, chat-first")
- **Related:** [`decisions.md`](./decisions.md) (D1, D3, Q6, Q7), [`concepts.md`](./concepts.md)
  (two-layer provider model), [`findings.md`](./findings.md) (access matrix)

---

## Context & Goal

WP Engine's **Power** is an OpenAI-compatible AI gateway at `https://api.ai.wpengine.com`. Nexus
already has a **Layer-2 provider system** — the set of providers Nexus uses for its *own* inference
(the chat/assistant path, and later `ctx.ai`/agents), chosen by the user in Nexus Preferences and
stored in `NexusSettings`. This is distinct from **Layer-1**, the per-site WordPress provider wired
by `setup-ai.ts`/`switch-provider.ts`.

**Goal:** add Power as a **user-selectable Layer-2 provider for chat**, so a user can point Nexus's
assistant at Power's models using their WP Engine `wpe_` Full Access key. Power is **never a default**
(decisions.md **D3**); it's one more option alongside Anthropic/OpenAI/Google/Ollama.

This is the smallest useful slice of Q7 (option **C**, phased: chat first, `ctx.ai`/agents later).

## Non-goals (out of scope for Phase 1)

- Agents / `ctx.ai` routing through Power (later phase).
- `project_id` / per-project billing attribution (see Findings + Future enhancements).
- Layer-1 (per-site WP provider) changes or gateway proxying of the `wpe_` key.
- Any Power management surface (credits/analytics/billing) — those stay on CAPI (decisions.md **D4**).

## Key findings that shaped this design

Two empirical probes (read-only, run against the live Power API with a `wpe_` Full Access key)
settled the two assumptions that would otherwise have inflated this design:

1. **A `wpe_` key cannot enumerate projects.** `scripts/iw/probe-projects-endpoint.sh` →
   `/v1/projects`, `/v1/accounts` all return 403/404 ("API keys cannot access management endpoints").
   → No native project picker is possible from a `wpe_` key.

2. **The `WPEngine-Project` header is *not required* for inference.**
   `scripts/iw/probe-project-header-required.sh` → `GET /v1/models` and `POST /v1/chat/completions`
   both return **200 with no project header at all** (and with a bogus one). The key resolves to the
   account server-side.
   → **`project_id` is dropped from Phase 1 entirely.** No setting, no config field, no header. It
   almost certainly still governs *billing attribution* (usage bills to the account's default
   project when omitted), so it returns only if/when a user needs per-project attribution — see
   Future enhancements. This overturns the residual assumption in decisions.md **Q6** (which assumed
   the header would be sent per-request); the header is simply unnecessary for our use.

Because Power is OpenAI-compatible and needs only `Authorization: Bearer <key>`, the new provider is
a near-clone of the existing OpenAI provider.

---

## Section 1 — Architecture & scope (Approach A)

**Approach A — a new standalone `PowerProvider` class** that implements the existing `AIProvider`
interface and is added to the provider registry. Chosen over:

- **B (generalize the OpenAI provider into a shared base):** refactors a working path for one new
  provider — YAGNI, and risks regressing OpenAI. Rejected.
- **C (route Power through the AI Gateway):** conflates Layer-2 (Nexus inference) with Layer-1
  (per-site gateway proxying). Wrong layer. Rejected.

The Layer-2 provider system is a registry of self-contained classes behind one `AIProvider`
interface, surfaced through a **data-driven** Preferences dropdown. Adding a provider is therefore
"one new class + register it + widen a few enums" — no changes to the chat IPC path, `ChatService`,
`keyVault`, or the Preferences component logic.

## Section 2 — Components & files touched

**1 new file:**

- `src/main/chat/providers/power.ts` — `PowerProvider implements AIProvider`, a near-clone of
  `src/main/chat/providers/openai.ts`:
  - `id='power'`, `displayName='WP Engine Power'`, `requiresApiKey=true`
  - own `POWER_BASE='https://api.ai.wpengine.com/v1'` constant (hardcoded, like `OPENAI_BASE`)
  - `Authorization: Bearer ${config.apiKey}` — **no project header**
  - `listModels()` returns **all** ids from `/v1/models` (drop OpenAI's `gpt-/o/dall-e` prefix
    filter — Power returns `provider/model` ids, e.g. `anthropic/claude-haiku-4-5`)
  - `validateKey()` → GET Power `/v1/models`; 200 = valid
  - a small curated `defaultModels` list

**4 one-line registration edits:**

- `src/common/types.ts` (~:248) — add `'power'` to the `AIProvider` union
- `src/common/schemas.ts` (~:49) — add `'power'` to the `UpdateSettingsSchema.aiProvider` enum
  (⚠️ the schema is `.strict()` — the value must be in the enum or it's rejected)
- `src/main/chat/providers/index.ts` — add `PowerProvider` to `initializeProviders()`; **not**
  filtered from `listProviders()` (unlike `local-gateway`), because Power is user-selectable
- `src/main/ai/getAIProvider.ts` (~:13) — add a `power` entry to `DEFAULT_MODELS` (defensive; keeps
  the later agent path from falling back to `llama3.2`)

**Config seam: none.** `ChatProviderConfig`, `ChatService`, and the whole IPC/`keyVault` chat path
are unchanged — they already pass `apiKey`+`model`, which is all Power needs.

**Preferences UI: no new code.** Power appears in the existing data-driven provider dropdown once
registered; the API-key input already handles any `requiresApiKey` provider; models load via the
existing `GET_MODELS`→`listModels()`.

## Section 3 — Runtime behavior: data flow, errors, security

**Chat data flow (identical to the OpenAI path except base URL + no model filter):**

1. User picks "WP Engine Power" in Preferences → `NexusSettings.aiProvider='power'`.
2. User pastes the `wpe_` key → `SAVE_API_KEY` IPC → `keyVault.setKey('power', …)` (Electron
   safeStorage, OS-keychain, encrypted at rest, main process only).
3. User picks a model → `GET_MODELS` → `getProvider('power').listModels()` → GET Power `/v1/models`
   (Bearer) → returns `provider/model` ids → saved to `NexusSettings.aiModel`.
4. Chat send → `src/main/chat/chat-ipc-handlers.ts` `keyVault.getKey('power')` → `ChatService` →
   `getProvider('power')` → config `{apiKey, model}` → `streamChat()` → POST Power
   `/v1/chat/completions` (OpenAI-compatible, streaming, `Authorization: Bearer`) →
   `ProviderStreamEvent`s to the renderer.

**Validation & errors:**

- `validateKey()` on save = GET Power `/v1/models`; 200 → valid, else surface "invalid key" (reuses
  the existing key-validation UX).
- Runtime errors return the OpenAI `{"error":{…}}` shape (observed in the probes) — 401 (bad key),
  403 (key not Full Access / wrong scope), 429 (rate/credit limit), 5xx. The existing OpenAI error
  handling in `src/main/chat/providers/http-utils.ts`/`streamChat` already parses that shape; no new
  error code.
- Model ids contain a slash (`anthropic/claude-haiku-4-5`). It's just a string, but a test asserts
  it round-trips through model-select + settings persistence intact.

**Security:**

- **Invariant (decisions.md Q6):** the `wpe_` key never leaves the Electron main process — read
  in-process via `keyVault`, sent only to `api.ai.wpengine.com` over HTTPS, never written to a WP
  DB, never logged, never sent to a local site.
- Same encryption-at-rest as existing cloud keys — no new storage surface, no new egress target
  beyond Power's host.

## Section 4 — Testing

**Unit tests (HTTP mocked — CI has no `wpe_` key, so no live Power calls), following the existing
provider-test patterns:**

1. `tests/main/chat-providers.test.ts` — provider count `4 → 5`; assert `'power'` is present in
   `listProviders()` and **not** filtered out (contrast `local-gateway`); `getProvider('power')`
   returns a provider with `id='power'`, `requiresApiKey=true`.
2. new `tests/main/power-provider.test.ts` — mirror the OpenAI provider test:
   - `listModels()` — mock the real Power `/v1/models` shape
     (`{"object":"list","data":[{"id":"anthropic/…",…}]}`); assert it returns **all** ids
     unfiltered, including non-`gpt` prefixes (proves the prefix filter was dropped).
   - `validateKey()` — 200 → valid, 401 → invalid.
   - `streamChat()` — mock a streaming OpenAI-compatible response; assert the request hits
     `api.ai.wpengine.com/v1/chat/completions`, carries `Authorization: Bearer <key>`, and carries
     **no** `WPEngine-Project` header (regression guard for the header finding); assert the yielded
     `ProviderStreamEvent`s.
   - error path — mock a `{"error":{…}}` 429 body → surfaces via the existing OpenAI error handling.
3. schema round-trip — `UpdateSettingsSchema.parse({aiProvider:'power', aiModel:'anthropic/claude-haiku-4-5'})`
   succeeds and preserves the slashed model id (guards both the strict-mode pitfall and the slash).

**Manual verification (one pass, since chat is user-facing):** `npm run rebuild` → load in Local →
select Power, paste key, pick a model, send a message, confirm a streaming reply.

Net effort: 1 modified test file + 1 new test file + 1 small schema assertion.

---

## Decisions referenced

- **D1** — authenticate to Power with a `wpe_` Full Access key (the durable credential).
- **D3** — provider choice is the user's at both layers; Power is never a default.
- **Q6** — one global `wpe_` key in the Electron KeyVault (API-key path); key never leaves the main
  process. *Amended:* the `WPEngine-Project` header is not sent (proven unnecessary for inference).
- **Q7** — scope of Power as a Layer-2 provider = option **C** (phased: chat first). This design is
  the "chat first" slice.

## Future enhancements (deferred, not Phase 1)

- **`ctx.ai` / agents through Power** — extend the same provider to the agent-runtime inference path
  (`src/main/agent-runtime/buildAgentContext.ts`).
- **`project_id` / billing attribution** — if a user needs Nexus usage attributed to a specific
  Power project, add an optional `powerProjectId` setting + `WPEngine-Project` header. Since a
  `wpe_` key can't enumerate projects, this would be a manual paste, ideally seeded later by reading
  `wpe_auth_get_project_id()` from a Hub-connected site once connect (Q3) lands.
