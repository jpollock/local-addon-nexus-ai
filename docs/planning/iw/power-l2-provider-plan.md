# Power as a Layer-2 Nexus Provider (Chat) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WP Engine **Power** (`https://api.ai.wpengine.com`) as a user-selectable Layer-2 provider for Nexus's chat/assistant, authenticated with a portal `wpe_` Full Access key.

**Architecture:** Power is OpenAI-compatible, so this is a near-clone of the existing OpenAI provider — one new `PowerProvider` class registered in the provider registry, plus enum/vocabulary widening. No changes to the chat IPC path, `ChatService`, `keyVault`, or the Preferences component: the data-driven dropdown, API-key input, and model loader already handle any registered `requiresApiKey` provider.

**Tech Stack:** TypeScript, Node.js (Electron main process), Jest + ts-jest, Zod (settings schema). HTTP via the existing `src/main/chat/providers/http-utils.ts` (`streamingRequest`/`apiRequest`).

**Spec:** [`docs/planning/iw/power-l2-provider-design.md`](./power-l2-provider-design.md) (approved). Decisions: [`decisions.md`](./decisions.md) D1, D3, Q6, Q7.

## Global Constraints

Every task's requirements implicitly include this section.

- **Key-egress invariant (Q6, non-negotiable):** the `wpe_` key **never leaves the Electron main process** — read in-process via `keyVault`, sent only to `api.ai.wpengine.com` over HTTPS, **never** written to a WP DB, **never** logged, **never** sent to a local site.
- **No `WPEngine-Project` header.** Proven unnecessary for inference (probe 2026-07-24, `scripts/iw/probe-project-header-required.sh`). Its absence is a **regression guard** asserted by a test — do not add it.
- **Power is never a default (D3).** This plan only *registers* Power as one more option; it does not change any existing default or remove any option.
- **Strict schema (`src/common/schemas.ts` is `.strict()`):** any new `aiProvider` enum value must be added to `UpdateSettingsSchema.aiProvider` or it is silently rejected. New NexusSettings fields would be silently stripped — this plan adds no new fields, only one enum value.
- **Native modules:** tests run against the **system Node** better-sqlite3 binary (MODULE_VERSION 127) built by `npm install`; Local runs the **Electron** binary (42.2.0, MODULE_VERSION 146) built by `npm run rebuild`. **Never both in one context.** Do all automated tests first; run `npm run rebuild` only for the manual Local smoke test (Task 5). NO postinstall hook. better-sqlite3 pinned at 12.11.1.
- **Commit discipline:** local per-task commits are expected. **Do NOT** `npm version`, `git tag`, `git push`, or trigger any release — only the user, on an explicit "push"/"release"/"deploy"/"ship". Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Worktree stash rule:** never bare `git stash`/`git stash pop` (shared stack). Use a WIP commit, or `git stash push -u -m "<tag>"` then apply-by-SHA.
- **Fast test iteration:** use `npx jest <path>` for the targeted files below (bypasses the `pretest` rebuild; none of these files load better-sqlite3). Reserve `npm test` for the full-suite gate in Task 5.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/main/chat/providers/power.ts` | `PowerProvider implements AIProvider` — OpenAI-compatible client for Power | **Create** |
| `tests/main/power-provider.test.ts` | Unit tests for `PowerProvider` (HTTP mocked) | **Create** |
| `tests/main/get-ai-provider-power.test.ts` | `DEFAULT_MODELS.power` fallback resolution | **Create** |
| `src/common/types.ts` | `AIProvider` union — add `'power'` | Modify (~:248) |
| `src/common/schemas.ts` | `UpdateSettingsSchema.aiProvider` enum — add `'power'` | Modify (:49) |
| `src/main/chat/providers/index.ts` | Provider registry — register `PowerProvider` | Modify |
| `src/main/ai/getAIProvider.ts` | `DEFAULT_MODELS` — add `power` entry | Modify (:13-18) |
| `tests/main/chat-providers.test.ts` | Registry tests — count 4→5, assert `power` present | Modify |
| `tests/unit/common/schemas-settings.test.ts` | Schema round-trip for `aiProvider:'power'` | Modify |

**Task order & dependencies:** Task 1 → Task 2 → Task 3 (needs `PowerProvider` from Task 2) → Task 4 → Task 5 (gate). Task 4 depends on Task 1 (the union must include `'power'` for the settings cast to type-check).

---

### Task 1: Widen the provider vocabulary (`AIProvider` union + settings enum)

Add `'power'` to the two places that gate whether the value is even legal: the `AIProvider` TypeScript union (compile-time) and the `UpdateSettingsSchema.aiProvider` Zod enum (runtime, `.strict()`). The failing test is the settings round-trip — it fails today because the enum rejects `'power'`.

**Files:**
- Modify: `src/common/types.ts` (~:248)
- Modify: `src/common/schemas.ts` (:49)
- Test: `tests/unit/common/schemas-settings.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `AIProvider` union now includes `'power'`; `UpdateSettingsSchema` accepts `{ aiProvider: 'power' }`. Every later task relies on both.

- [ ] **Step 1: Write the failing test**

Add this `it(...)` block inside the existing `describe('UpdateSettingsSchema — known fields are accepted', ...)` block in `tests/unit/common/schemas-settings.test.ts` (e.g. immediately after the `accepts wpeAllowedEnvironments (legacy migration field)` test, before the block's closing `});`):

```typescript
  it('accepts aiProvider "power" with a slashed model id (IW Phase 1)', () => {
    const result = validateInput(UpdateSettingsSchema, {
      aiProvider: 'power',
      aiModel: 'anthropic/claude-haiku-4-5',
    });
    expect(result.aiProvider).toBe('power');
    // The slash in a Power `provider/model` id must survive strict-mode parsing.
    expect(result.aiModel).toBe('anthropic/claude-haiku-4-5');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/common/schemas-settings.test.ts -t "power"`
Expected: FAIL — `validateInput` throws `/Validation failed/` because `'power'` is not yet a member of the `aiProvider` enum (`.strict()` rejects the invalid enum value).

- [ ] **Step 3: Add `'power'` to the settings enum**

In `src/common/schemas.ts`, line 49 — add `'power'` to the enum:

```typescript
  aiProvider: z.enum(['anthropic', 'openai', 'ollama', 'google', 'local-gateway', 'power']).optional(),
```

- [ ] **Step 4: Add `'power'` to the `AIProvider` union**

In `src/common/types.ts` (~:248), widen the union:

```typescript
export type AIProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'local-gateway' | 'power';
```

- [ ] **Step 5: Run the test to verify it passes, and typecheck the union**

Run: `npx jest tests/unit/common/schemas-settings.test.ts -t "power"`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors (the union widening keeps every `AIProvider` consumer consistent; nothing else changed).

- [ ] **Step 6: Commit**

```bash
git add src/common/types.ts src/common/schemas.ts tests/unit/common/schemas-settings.test.ts
git commit -m "feat(iw): add 'power' to AIProvider union and settings enum

Widen the provider vocabulary so Nexus can select WP Engine Power as a
Layer-2 chat provider. Round-trip test guards the strict-mode pitfall and
the slashed provider/model id.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Create the `PowerProvider` class

A near-clone of `src/main/chat/providers/openai.ts`. Differences, all driven by the spec: `POWER_BASE`, `id`/`displayName`, error-message prefix, **no** `WPEngine-Project` header (Bearer only), and `listModels()` returns **all** ids from `/v1/models` **unfiltered** (Power returns `provider/model` ids across vendors, so OpenAI's `gpt-/o/dall-e` prefix filter would drop everything).

**Files:**
- Create: `src/main/chat/providers/power.ts`
- Test: `tests/main/power-provider.test.ts`

**Interfaces:**
- Consumes: `AIProvider`, `ChatProviderConfig`, `ProviderToolDefinition` from `./types`; `ChatMessage`, `ProviderStreamEvent` from `../../../common/chat-types`; `streamingRequest`, `apiRequest` from `./http-utils`.
- Produces: `export class PowerProvider implements AIProvider` with `id = 'power'`, `displayName = 'WP Engine Power'`, `requiresApiKey = true`, `defaultModels: string[]`, and the three `AIProvider` methods (`streamChat`, `listModels`, `validateKey`). Task 3 imports and registers this class.

- [ ] **Step 1: Write the failing test**

Create `tests/main/power-provider.test.ts`:

```typescript
import { PowerProvider } from '../../src/main/chat/providers/power';
import * as httpUtils from '../../src/main/chat/providers/http-utils';

// Mock the HTTP layer — CI has no wpe_ key, so no live Power calls.
jest.mock('../../src/main/chat/providers/http-utils');

const mockApiRequest = httpUtils.apiRequest as jest.MockedFunction<typeof httpUtils.apiRequest>;
const mockStreamingRequest = httpUtils.streamingRequest as jest.MockedFunction<typeof httpUtils.streamingRequest>;

describe('PowerProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('has correct static properties', () => {
    const p = new PowerProvider();
    expect(p.id).toBe('power');
    expect(p.displayName).toBe('WP Engine Power');
    expect(p.requiresApiKey).toBe(true);
    expect(p.defaultModels.length).toBeGreaterThan(0);
  });

  test('listModels returns ALL provider/model ids unfiltered (no gpt- prefix filter)', async () => {
    mockApiRequest.mockResolvedValue(JSON.stringify({
      object: 'list',
      data: [
        { id: 'anthropic/claude-haiku-4-5' },
        { id: 'google/gemini-2.5-flash' },
        { id: 'openai/gpt-4o' },
        { id: 'gemma/gemma-3-27b' },
      ],
    }));
    const p = new PowerProvider();
    const models = await p.listModels({ model: '', apiKey: 'wpe_test' });

    expect(models).toContain('anthropic/claude-haiku-4-5');
    expect(models).toContain('google/gemini-2.5-flash');
    expect(models).toContain('openai/gpt-4o');
    expect(models).toContain('gemma/gemma-3-27b'); // non-gpt prefix survives => filter dropped
    expect(models.length).toBe(4);

    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.ai.wpengine.com/v1/models',
      headers: { Authorization: 'Bearer wpe_test' },
    }));
  });

  test('listModels falls back to defaultModels when the request fails', async () => {
    mockApiRequest.mockRejectedValue(new Error('HTTP 500: boom'));
    const p = new PowerProvider();
    const models = await p.listModels({ model: '', apiKey: 'wpe_test' });
    expect(models).toEqual(p.defaultModels);
  });

  test('validateKey returns null for a valid key (200)', async () => {
    mockApiRequest.mockResolvedValue('{"object":"list","data":[]}');
    const p = new PowerProvider();
    expect(await p.validateKey('wpe_good')).toBeNull();
    expect(mockApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.ai.wpengine.com/v1/models',
      headers: { Authorization: 'Bearer wpe_good' },
    }));
  });

  test('validateKey returns an error message for an invalid key (401)', async () => {
    mockApiRequest.mockRejectedValue(new Error('HTTP 401: {"error":{"message":"invalid key"}}'));
    const p = new PowerProvider();
    const result = await p.validateKey('wpe_bad');
    expect(result).toMatch(/Invalid API key/);
  });

  test('streamChat POSTs to Power with Bearer auth and NO WPEngine-Project header', async () => {
    mockStreamingRequest.mockImplementation(async function* () {
      yield JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] });
      yield JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    });

    const p = new PowerProvider();
    const signal = new AbortController().signal;
    const events: any[] = [];
    for await (const e of p.streamChat(
      [{ role: 'user', content: 'hi' }] as any,
      [],
      { model: 'anthropic/claude-haiku-4-5', apiKey: 'wpe_test' },
      signal,
    )) {
      events.push(e);
    }

    // Request shape
    const callArg = mockStreamingRequest.mock.calls[0][0];
    expect(callArg.url).toBe('https://api.ai.wpengine.com/v1/chat/completions');
    expect(callArg.headers).toEqual({ Authorization: 'Bearer wpe_test' });
    expect(callArg.headers).not.toHaveProperty('WPEngine-Project'); // regression guard

    // Streamed events
    expect(events.some((e) => e.type === 'token' && e.text === 'Hello')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  test('streamChat surfaces provider errors as an error event', async () => {
    mockStreamingRequest.mockImplementation(async function* () {
      throw new Error('HTTP 429: {"error":{"message":"rate limited"}}');
    });

    const p = new PowerProvider();
    const signal = new AbortController().signal;
    const events: any[] = [];
    for await (const e of p.streamChat(
      [{ role: 'user', content: 'hi' }] as any,
      [],
      { model: 'x', apiKey: 'k' },
      signal,
    )) {
      events.push(e);
    }

    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err.message).toMatch(/429/);
    expect(err.message).toMatch(/^Power error:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/main/power-provider.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/chat/providers/power'` (the file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/main/chat/providers/power.ts`:

```typescript
import type { ChatMessage, ProviderStreamEvent } from '../../../common/chat-types';
import type { AIProvider, ChatProviderConfig, ProviderToolDefinition } from './types';
import { streamingRequest, apiRequest } from './http-utils';

// WP Engine Power — OpenAI-compatible AI gateway. Layer-2 (Nexus's own
// inference) provider. Auth is a portal `wpe_` Full Access key via
// `Authorization: Bearer`. The `WPEngine-Project` header is intentionally
// NOT sent: probe 2026-07-24 proved inference works without it (the key
// resolves to the account server-side). The key never leaves this process.
// See docs/planning/iw/power-l2-provider-design.md.
const POWER_BASE = 'https://api.ai.wpengine.com/v1';

export class PowerProvider implements AIProvider {
  readonly id = 'power';
  readonly displayName = 'WP Engine Power';
  readonly requiresApiKey = true;
  // Fallback only — the live list comes from listModels() -> GET /v1/models.
  // Power returns `provider/model` ids (note the slash).
  readonly defaultModels = [
    'anthropic/claude-haiku-4-5',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'google/gemini-2.5-flash',
  ];

  async *streamChat(
    messages: ChatMessage[],
    tools: ProviderToolDefinition[],
    config: ChatProviderConfig,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent> {
    const baseUrl = config.baseUrl || POWER_BASE;

    // Power is OpenAI-compatible — identical message/tool shapes.
    const powerMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId ?? '',
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const powerTools = tools.length > 0 ? tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })) : undefined;

    const body = JSON.stringify({
      model: config.model,
      messages: powerMessages,
      stream: true,
      ...(powerTools ? { tools: powerTools } : {}),
    });

    try {
      const stream = streamingRequest({
        url: `${baseUrl}/chat/completions`,
        // Bearer only — no WPEngine-Project header (see file header note).
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body,
        signal,
      });

      // Track in-progress tool calls by index
      const activeToolCalls = new Map<number, { id: string; name: string; argsBuf: string }>();

      for await (const line of stream) {
        if (signal.aborted) break;

        let data: any;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }

        const delta = data.choices?.[0]?.delta;
        const finishReason = data.choices?.[0]?.finish_reason;

        if (delta?.content) {
          yield { type: 'token', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;

            if (tc.id) {
              // New tool call
              activeToolCalls.set(idx, { id: tc.id, name: tc.function?.name ?? '', argsBuf: '' });
              yield { type: 'tool_call_start', id: tc.id, name: tc.function?.name ?? '' };
            }

            if (tc.function?.arguments) {
              const active = activeToolCalls.get(idx);
              if (active) {
                active.argsBuf += tc.function.arguments;
                yield { type: 'tool_call_args_delta', id: active.id, argsDelta: tc.function.arguments };
              }
            }
          }
        }

        if (finishReason) {
          // Finalize any pending tool calls
          for (const [, tc] of activeToolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.argsBuf);
            } catch { /* empty args */ }
            yield { type: 'tool_call_end', id: tc.id, name: tc.name, arguments: args };
          }
          activeToolCalls.clear();

          const stopReason = finishReason === 'tool_calls' ? 'tool_use'
            : finishReason === 'length' ? 'max_tokens'
            : 'end_turn';
          yield { type: 'done', stopReason };
          return;
        }
      }

      yield { type: 'done', stopReason: 'end_turn' };
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      yield { type: 'error', message: `Power error: ${(err as Error).message}` };
    }
  }

  async listModels(config: ChatProviderConfig): Promise<string[]> {
    const baseUrl = config.baseUrl || POWER_BASE;
    try {
      const response = await apiRequest({
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      const data = JSON.parse(response);
      // NO prefix filter — Power returns `provider/model` ids across vendors.
      const models = (data.data ?? [])
        .map((m: any) => m.id as string)
        .filter((id: string) => typeof id === 'string' && id.length > 0)
        .sort();
      return models.length > 0 ? models : this.defaultModels;
    } catch {
      return this.defaultModels;
    }
  }

  async validateKey(apiKey: string): Promise<string | null> {
    try {
      await apiRequest({
        url: `${POWER_BASE}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return null;
    } catch (err) {
      return `Invalid API key: ${(err as Error).message}`;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/main/power-provider.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/providers/power.ts tests/main/power-provider.test.ts
git commit -m "feat(iw): add PowerProvider (OpenAI-compatible Layer-2 chat provider)

Near-clone of the OpenAI provider targeting api.ai.wpengine.com. Bearer
auth only, no WPEngine-Project header (proven unnecessary for inference);
listModels returns all provider/model ids unfiltered. HTTP-mocked tests
cover models/validate/stream/error paths and guard against the project
header regressing back in.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Register `PowerProvider` in the provider registry

Add `PowerProvider` to `initializeProviders()`. Do **not** add it to the `listProviders()` filter (that filter only hides `local-gateway`) — Power is user-selectable and must appear in the Preferences dropdown.

**Files:**
- Modify: `src/main/chat/providers/index.ts`
- Test: `tests/main/chat-providers.test.ts`

**Interfaces:**
- Consumes: `PowerProvider` from `./power` (Task 2).
- Produces: `getProvider('power')` returns the instance; `listProviders()` includes `{ id: 'power', displayName: 'WP Engine Power', requiresApiKey: true }`.

- [ ] **Step 1: Update the failing tests**

In `tests/main/chat-providers.test.ts`:

1a. Add the import after line 5 (`import { LocalGatewayProvider } ...`):

```typescript
import { PowerProvider } from '../../src/main/chat/providers/power';
```

1b. Replace the count test (lines 17-20):

```typescript
  test('initializes five user-facing providers (local-gateway excluded from list)', () => {
    const providers = listProviders();
    expect(providers.length).toBe(5);
  });
```

1c. In the `can retrieve each provider by id` test, add after the `google` assertion (line 26):

```typescript
    expect(getProvider('power')).not.toBeNull();
```

1d. In the `lists correct metadata for each provider` test, add after the `google` assertion (line 41):

```typescript
    expect(byId['power'].requiresApiKey).toBe(true);
```

1e. Add `PowerProvider` to the contract array (lines 158-164):

```typescript
  const providers = [
    new OllamaProvider(),
    new OpenAIProvider(),
    new AnthropicProvider(),
    new GoogleProvider(),
    new LocalGatewayProvider(),
    new PowerProvider(),
  ];
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/main/chat-providers.test.ts`
Expected: FAIL — `listProviders().length` is 4 (not 5) and `byId['power']` is `undefined` (Power is not yet registered).

- [ ] **Step 3: Register the provider**

In `src/main/chat/providers/index.ts`, add the import alongside the other provider imports:

```typescript
import { PowerProvider } from './power';
```

Then add `new PowerProvider()` to the `all` array in `initializeProviders()`:

```typescript
  const all: AIProvider[] = [
    new OllamaProvider(),
    new AnthropicProvider(),
    new OpenAIProvider(),
    new GoogleProvider(),
    new LocalGatewayProvider(),
    new PowerProvider(),
  ];
```

Leave `listProviders()` and its `.filter((p) => p.id !== 'local-gateway')` unchanged — Power must NOT be filtered out.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/main/chat-providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/providers/index.ts tests/main/chat-providers.test.ts
git commit -m "feat(iw): register PowerProvider in the provider registry

Power is user-selectable, so it is added to initializeProviders() and
(unlike local-gateway) left in listProviders() so it appears in the
Preferences dropdown. Registry tests updated: 4 -> 5 user-facing providers.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Add a `DEFAULT_MODELS` entry for Power

Defensive: keeps the centralized provider resolver (`getAIProvider`, used by the future agent path) from falling back to `llama3.2` when `aiProvider='power'` but no model is set. Uses a confirmed-valid Power id.

**Files:**
- Modify: `src/main/ai/getAIProvider.ts` (:13-18)
- Test: `tests/main/get-ai-provider-power.test.ts`

**Interfaces:**
- Consumes: `getAIProvider(storage, settings)` from `../../src/main/ai/getAIProvider`, returning `ResolvedAIProvider { provider; model; apiKey; useLocalGateway; isAvailable }`; `getApiKey` from `../security/KeyVault` (mocked in the test); `AIProvider` union includes `'power'` (Task 1).
- Produces: `DEFAULT_MODELS.power = 'anthropic/claude-haiku-4-5'`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/get-ai-provider-power.test.ts`:

```typescript
import { getAIProvider } from '../../src/main/ai/getAIProvider';
import type { NexusSettings } from '../../src/common/types';

// getAIProvider reads the decrypted key via KeyVault — mock it so no
// OS keychain / Electron safeStorage is touched under Jest.
jest.mock('../../src/main/security/KeyVault', () => ({
  getApiKey: jest.fn(() => 'wpe_test'),
}));

describe('getAIProvider — Power default model', () => {
  it('falls back to the Power default model when aiModel is unset', () => {
    const settings = { aiProvider: 'power' } as unknown as NexusSettings;
    const resolved = getAIProvider({} as any, settings);

    expect(resolved.provider).toBe('power');
    expect(resolved.model).toBe('anthropic/claude-haiku-4-5');
    expect(resolved.isAvailable).toBe(true); // key present via mocked KeyVault
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/main/get-ai-provider-power.test.ts`
Expected: FAIL — `resolved.model` is `'llama3.2'` (the final fallback) because `DEFAULT_MODELS` has no `power` key.

- [ ] **Step 3: Add the `power` default**

In `src/main/ai/getAIProvider.ts`, extend `DEFAULT_MODELS` (:13-18):

```typescript
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai:    'gpt-4o-mini',
  google:    'gemini-1.5-flash',
  ollama:    'llama3.2',
  power:     'anthropic/claude-haiku-4-5',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/main/get-ai-provider-power.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/getAIProvider.ts tests/main/get-ai-provider-power.test.ts
git commit -m "feat(iw): add Power default model to getAIProvider resolver

Keeps the centralized resolver (future agent path) from falling back to
llama3.2 when aiProvider='power' and no model is set. Uses a confirmed
Power provider/model id.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full verification & manual smoke test (gate)

No source changes unless the gates surface a fix. Confirm the whole thing type-checks, the full suite is green under the system-Node binary, and chat actually streams from Power in Local.

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the three affected suites together**

Run: `npx jest tests/main/power-provider.test.ts tests/main/chat-providers.test.ts tests/main/get-ai-provider-power.test.ts tests/unit/common/schemas-settings.test.ts`
Expected: all PASS.

- [ ] **Step 3: Run the full unit suite (system-Node binary)**

If the better-sqlite3 binary is currently built for Electron (from a prior `npm run rebuild`), the full suite will throw `NODE_MODULE_VERSION` — run `npm install` first to restore the system-Node binary (MODULE_VERSION 127), then:

Run: `npm test`
Expected: no NEW failures introduced by this work. (Per project notes, ~5 pre-existing suite failures are unrelated native-module issues; the LanceDB `CustomGC` open-handle warning after a clean run is expected.)

- [ ] **Step 4: Commit any fix the gates surfaced** (skip if Steps 1-3 were clean)

```bash
git add -A
git commit -m "fix(iw): resolve verification findings for Power provider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual smoke test in Local** (Electron binary — do this AFTER all automated tests)

```bash
npm run build
npm run rebuild   # switches better-sqlite3 to the Electron binary; tests won't run until the next `npm install`
```

Then, in Local (restart + reload the addon):
1. Open Nexus Preferences → provider dropdown → confirm **"WP Engine Power"** is listed.
2. Select it, paste a `wpe_` Full Access key → confirm the key validates (no "invalid key" error).
3. Open the model picker → confirm `provider/model` ids load (e.g. `anthropic/claude-haiku-4-5`) and one can be selected.
4. Send a chat message → confirm a streaming reply renders.
5. Sanity-check the key-egress invariant: the `wpe_` key must not appear in any WP DB or log — it is only sent to `api.ai.wpengine.com`.

Expected: streaming reply from the selected Power model; no errors; key never written outside the Electron KeyVault.

---

## Self-Review

Run against the spec (`power-l2-provider-design.md`) with fresh eyes.

**1. Spec coverage:**
- §2 "1 new file `power.ts`" → Task 2. ✅
- §2 four registration edits: types union → Task 1; schema enum → Task 1; registry (register, not filtered) → Task 3; `DEFAULT_MODELS` → Task 4. ✅
- §2 "Config seam: none / Preferences UI: no new code" → no task creates either (data-driven dropdown reused). ✅
- §3 data flow (validateKey on save, `provider/model` ids, Bearer, streaming) → covered by `power.ts` + Task 2 tests. ✅
- §3 security invariant (key never leaves Electron) → Global Constraints + Task 5 Step 5 check; enforced structurally by reusing the existing `keyVault` path (no new storage/egress in any task). ✅
- §4 testing: `chat-providers.test.ts` 4→5 + present/not-filtered → Task 3; new `power-provider.test.ts` (listModels unfiltered, validateKey 200/401, streamChat URL+Bearer+**no** project header, error path) → Task 2; schema round-trip with slashed id → Task 1. ✅
- §4 manual verification (`npm run rebuild` → select Power, key, model, message) → Task 5 Step 5. ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code; every run step shows an exact command and expected result. ✅

**3. Type consistency:** `PowerProvider` implements the `AIProvider` interface (`streamChat`/`listModels`/`validateKey`) exactly as the OpenAI template does; `ChatProviderConfig` used as `{ model, apiKey, baseUrl? }`; `ResolvedAIProvider` fields (`provider`/`model`/`isAvailable`) match `getAIProvider.ts`; enum value `'power'` and union member `'power'` are identical strings; default model id `'anthropic/claude-haiku-4-5'` is used identically in `defaultModels`, `DEFAULT_MODELS.power`, and the Task 1/Task 4 test assertions. ✅

---

## Execution Handoff

See the message accompanying this plan for the two execution options.
