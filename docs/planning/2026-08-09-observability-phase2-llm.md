# Observability Phase 2 — LLM instrumentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every model call an agent performs visible in the run log — model, turn, token counts, cost, duration — with an opt-in full transcript for the agent you are actively debugging.

**Architecture:** Token usage does not currently exist anywhere on the agent path: `ProviderStreamEvent` has no variant carrying it and none of the six provider adapters parse it. So this plumbs usage up from the adapters through `collectStream` into `AgentAIClient`, which emits `llm.call` / `llm.error` to the `EventLog` built in Phase 1. Cost is derived from a small price table that carries the date it was accurate; a model absent from the table logs tokens and no cost rather than a guess. Transcripts are a separate sidecar file, written only for agents that opt in.

**Tech Stack:** TypeScript, Jest, the existing `EventLog` (`src/main/logging/eventLog.ts`), the existing provider adapters (`src/main/chat/providers/`).

## Global Constraints

- Line format: `HH:MM:SS.mmm LEVEL source [run=<id>] [event] [k=v…]  [message]` — message separated by **two** spaces, everything else by one. The level is **not** padded.
- Times and filenames are **local**, never UTC. See `localDay`/`timeOf` in `eventLog.ts`.
- Levels are `ERROR | WARN | INFO | DEBUG`, reusing `LogLevel` from `src/main/logging/Logger.ts`.
- Event vocabulary is closed, one word one shape. This phase adds exactly two words: `llm.call` and `llm.error`.
- Every value written passes through the existing redaction in `formatLine`. Never write a second redactor.
- **Logging must never throw.** A logging fault cannot fail a run or a model call.
- **Never fabricate a number.** A model whose price is unknown logs no `cost=`; a provider that does not report usage logs no `in=`/`out=`. An absent field is absent — it is never zero and never estimated.
- Reference implementation for per-vendor usage parsing already exists in `src/main/ai-gateway/` (`anthropic-client.ts`, `openai-client.ts`, `google-client.ts`). Read it before writing an adapter.
- Run tests with `npx jest <path>`. Do NOT run `npm rebuild better-sqlite3` — 27 unrelated suites fail from a pre-existing native ABI mismatch and are not yours.

---

### Task 1: A usage type the stream can carry

**Files:**
- Modify: `src/common/chat-types.ts` (the `ProviderStreamEvent` union, ~line 40)
- Test: `tests/unit/chat/tokenUsage.test.ts`

**Interfaces:**
- Produces: `interface TokenUsage { inputTokens?: number; outputTokens?: number }`, and `{ type: 'done'; stopReason: …; usage?: TokenUsage }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat/tokenUsage.test.ts
import type { ProviderStreamEvent, TokenUsage } from '../../../src/common/chat-types';

describe('the stream can carry token usage', () => {
  it('accepts a done event with usage', () => {
    const e: ProviderStreamEvent = {
      type: 'done', stopReason: 'end_turn', usage: { inputTokens: 1204, outputTokens: 318 },
    };
    expect(e.type === 'done' && e.usage?.inputTokens).toBe(1204);
  });

  it('accepts a done event with NO usage, because most providers do not report it', () => {
    // Ollama and the local gateway may report nothing. Absent must stay absent rather than
    // becoming a zero that reads as "this call used no tokens".
    const e: ProviderStreamEvent = { type: 'done', stopReason: 'end_turn' };
    expect(e.type === 'done' && e.usage).toBeUndefined();
  });

  it('accepts partial usage — one direction known, the other not', () => {
    const u: TokenUsage = { outputTokens: 318 };
    expect(u.inputTokens).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/chat/tokenUsage.test.ts`
Expected: FAIL — `TokenUsage` is not exported from `chat-types`.

- [ ] **Step 3: Add the type**

In `src/common/chat-types.ts`, above `ProviderStreamEvent`:

```ts
/**
 * Tokens a single model call consumed, as reported by the provider.
 *
 * Both fields are optional and must stay that way: several providers report nothing (Ollama), and
 * some report output tokens without input. A missing count is missing — never coerce it to 0,
 * which reads as "this call was free" and is a lie about a real cost.
 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}
```

and change the `done` variant:

```ts
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error'; usage?: TokenUsage }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/chat/tokenUsage.test.ts` then `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, and tsc exit 0 — adding an optional field breaks no existing `yield`.

- [ ] **Step 5: Commit**

```bash
git add src/common/chat-types.ts tests/unit/chat/tokenUsage.test.ts
git commit -m "feat(chat): the provider stream can carry token usage"
```

---

### Task 2: collectStream surfaces usage to the caller

**Files:**
- Modify: `src/main/agent-runtime/AgentAIClient.ts` (`collectStream`, ~line 31, and `StreamResult`)
- Test: `tests/unit/agent-runtime/collectStream.test.ts`

**Interfaces:**
- Consumes: `TokenUsage` (Task 1).
- Produces: `StreamResult` gains `usage?: TokenUsage`. `collectStream` is currently module-private — export it so it can be tested directly.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/collectStream.test.ts
import { collectStream } from '../../../src/main/agent-runtime/AgentAIClient';
import type { ProviderStreamEvent } from '../../../src/common/chat-types';

async function* stream(...events: ProviderStreamEvent[]) { for (const e of events) yield e; }

describe('collectStream', () => {
  it('carries usage off the done event', async () => {
    const r = await collectStream(stream(
      { type: 'token', text: 'hello' },
      { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 1204, outputTokens: 318 } },
    ));
    expect(r.content).toBe('hello');
    expect(r.usage).toEqual({ inputTokens: 1204, outputTokens: 318 });
  });

  it('leaves usage undefined when the provider reported none', async () => {
    const r = await collectStream(stream(
      { type: 'token', text: 'hi' },
      { type: 'done', stopReason: 'end_turn' },
    ));
    expect(r.usage).toBeUndefined();
  });

  it('still collects content and tool calls exactly as before', async () => {
    const r = await collectStream(stream(
      { type: 'token', text: 'a' },
      { type: 'tool_call_end', id: 't1', name: 'wp_plugin_list', arguments: { site: 'x' } },
      { type: 'token', text: 'b' },
      { type: 'done', stopReason: 'tool_use' },
    ));
    expect(r.content).toBe('ab');
    expect(r.toolCalls).toEqual([{ id: 't1', name: 'wp_plugin_list', arguments: { site: 'x' } }]);
  });

  it('still throws on a provider error event', async () => {
    await expect(collectStream(stream({ type: 'error', message: 'rate limited' })))
      .rejects.toThrow(/rate limited/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/collectStream.test.ts`
Expected: FAIL — `collectStream` is not exported.

- [ ] **Step 3: Export it and carry usage**

In `src/main/agent-runtime/AgentAIClient.ts`, change the signature and body:

```ts
/** Exported for test: the usage plumbing is worth pinning directly, not only through a client. */
export async function collectStream(gen: AsyncGenerator<ProviderStreamEvent>): Promise<StreamResult> {
  let content = '';
  const toolCalls: ToolCallRequest[] = [];
  let usage: TokenUsage | undefined;

  for await (const event of gen) {
    if (event.type === 'token') {
      content += event.text;
    } else if (event.type === 'tool_call_end') {
      toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments });
    } else if (event.type === 'done') {
      // Last one wins: a provider may emit several done-shaped events, and the final carries the
      // completed counts.
      if (event.usage) usage = event.usage;
    } else if (event.type === 'error') {
      throw new Error(`Provider error: ${event.message}`);
    }
  }

  return { content, toolCalls, usage };
}
```

Add `usage?: TokenUsage;` to the `StreamResult` interface in the same file, and import `TokenUsage` from `../../common/chat-types`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime/collectStream.test.ts tests/unit/agent-runtime/AgentAIClient.test.ts tests/unit/agent-runtime/AgentAIClient.generateObject.test.ts`
Expected: PASS — all three.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-runtime/AgentAIClient.ts tests/unit/agent-runtime/collectStream.test.ts
git commit -m "feat(agents): collectStream surfaces provider token usage"
```

---

### Task 3: The Anthropic adapter reports usage

**Files:**
- Modify: `src/main/chat/providers/anthropic.ts` (~lines 100-165)
- Test: `tests/unit/chat/anthropicUsage.test.ts`

**Interfaces:**
- Consumes: `TokenUsage` (Task 1).
- Produces: the adapter's `done` event carries `usage` when Anthropic reported it.

**Context you need:** Anthropic's SSE stream reports input tokens on `message_start` (`data.message.usage.input_tokens`) and output tokens on `message_delta` (`data.usage.output_tokens`). They arrive in *different* events, so the adapter must accumulate across the stream and attach the pair to whichever `done` it yields. `src/main/ai-gateway/anthropic-client.ts` already parses this shape — read it first.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat/anthropicUsage.test.ts
import { extractAnthropicUsage } from '../../../src/main/chat/providers/anthropic';

describe('extractAnthropicUsage', () => {
  it('reads input tokens off message_start', () => {
    expect(extractAnthropicUsage('message_start', { message: { usage: { input_tokens: 1204 } } }))
      .toEqual({ inputTokens: 1204 });
  });

  it('reads output tokens off message_delta', () => {
    expect(extractAnthropicUsage('message_delta', { usage: { output_tokens: 318 } }))
      .toEqual({ outputTokens: 318 });
  });

  it('returns undefined for an event that carries no usage', () => {
    expect(extractAnthropicUsage('content_block_delta', { delta: { text: 'hi' } })).toBeUndefined();
    expect(extractAnthropicUsage('message_delta', { delta: { stop_reason: 'end_turn' } })).toBeUndefined();
  });

  it('ignores a non-numeric count rather than passing it through', () => {
    // A string here would reach the log as `in=NaN` or `in=lots`. Absent is the honest answer.
    expect(extractAnthropicUsage('message_start', { message: { usage: { input_tokens: 'many' } } }))
      .toBeUndefined();
  });

  it('survives a malformed payload', () => {
    expect(extractAnthropicUsage('message_start', undefined)).toBeUndefined();
    expect(extractAnthropicUsage('message_start', null)).toBeUndefined();
    expect(extractAnthropicUsage('message_start', {})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/chat/anthropicUsage.test.ts`
Expected: FAIL — `extractAnthropicUsage` is not exported.

- [ ] **Step 3: Add the extractor and accumulate across the stream**

In `src/main/chat/providers/anthropic.ts`, add near the top:

```ts
/**
 * Token usage from one Anthropic SSE event, or undefined if it carries none.
 *
 * Anthropic splits the pair across two events — input on `message_start`, output on
 * `message_delta` — so the caller accumulates. Exported for test: this parsing is the only thing
 * standing between a real cost figure and a fabricated one.
 */
export function extractAnthropicUsage(eventType: string, data: any): TokenUsage | undefined {
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (eventType === 'message_start') {
    const inputTokens = num(data?.message?.usage?.input_tokens);
    return inputTokens === undefined ? undefined : { inputTokens };
  }
  if (eventType === 'message_delta') {
    const outputTokens = num(data?.usage?.output_tokens);
    return outputTokens === undefined ? undefined : { outputTokens };
  }
  return undefined;
}
```

Import `TokenUsage` from `../../../common/chat-types`. Then inside the stream loop, declare `let usage: TokenUsage | undefined;` alongside the other accumulators, and immediately after `data` is parsed for each event:

```ts
        const eventUsage = extractAnthropicUsage(eventType, data);
        if (eventUsage) usage = { ...usage, ...eventUsage };
```

Finally attach it to **every** `yield { type: 'done', … }` in the file (there are four):

```ts
            yield { type: 'done', stopReason: mapped, usage };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/chat/anthropicUsage.test.ts` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/providers/anthropic.ts tests/unit/chat/anthropicUsage.test.ts
git commit -m "feat(chat): anthropic adapter reports token usage"
```

---

### Task 4: The OpenAI and Google adapters report usage

**Files:**
- Modify: `src/main/chat/providers/openai.ts`, `src/main/chat/providers/google.ts`
- Test: `tests/unit/chat/providerUsage.test.ts`

**Interfaces:**
- Produces: `extractOpenAiUsage(chunk: any): TokenUsage | undefined`, `extractGoogleUsage(chunk: any): TokenUsage | undefined`.

**Context you need:** OpenAI reports usage only when the request sets `stream_options: { include_usage: true }`, and then on a final chunk as `usage.prompt_tokens` / `usage.completion_tokens`. Google reports `usageMetadata.promptTokenCount` / `usageMetadata.candidatesTokenCount` on its chunks. Both shapes are already parsed in `src/main/ai-gateway/openai-client.ts` and `google-client.ts` — read those first. **You must also add `stream_options` to the OpenAI request body**, or usage never arrives and every OpenAI call logs no tokens forever.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat/providerUsage.test.ts
import { extractOpenAiUsage } from '../../../src/main/chat/providers/openai';
import { extractGoogleUsage } from '../../../src/main/chat/providers/google';

describe('extractOpenAiUsage', () => {
  it('reads the final usage chunk', () => {
    expect(extractOpenAiUsage({ usage: { prompt_tokens: 1204, completion_tokens: 318 } }))
      .toEqual({ inputTokens: 1204, outputTokens: 318 });
  });
  it('is undefined for an ordinary content chunk', () => {
    expect(extractOpenAiUsage({ choices: [{ delta: { content: 'hi' } }] })).toBeUndefined();
  });
  it('survives malformed input', () => {
    expect(extractOpenAiUsage(undefined)).toBeUndefined();
    expect(extractOpenAiUsage({ usage: { prompt_tokens: 'x' } })).toBeUndefined();
  });
});

describe('extractGoogleUsage', () => {
  it('reads usageMetadata', () => {
    expect(extractGoogleUsage({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 210 } }))
      .toEqual({ inputTokens: 900, outputTokens: 210 });
  });
  it('is undefined without usageMetadata', () => {
    expect(extractGoogleUsage({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] })).toBeUndefined();
  });
  it('survives malformed input', () => {
    expect(extractGoogleUsage(null)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/chat/providerUsage.test.ts`
Expected: FAIL — neither function is exported.

- [ ] **Step 3: Add both extractors, wire them, and ask OpenAI for usage**

In `src/main/chat/providers/openai.ts`:

```ts
const finiteNumber = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** OpenAI reports usage on a final chunk, and only when the request asked for it. */
export function extractOpenAiUsage(chunk: any): TokenUsage | undefined {
  const inputTokens = finiteNumber(chunk?.usage?.prompt_tokens);
  const outputTokens = finiteNumber(chunk?.usage?.completion_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}
```

In the same file, add `stream_options: { include_usage: true }` to the request body alongside `stream: true`. Accumulate `usage` in the stream loop exactly as Task 3 does, and attach it to every `done` yield.

In `src/main/chat/providers/google.ts`:

```ts
const finiteNumber = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Google reports cumulative counts on its chunks as usageMetadata. */
export function extractGoogleUsage(chunk: any): TokenUsage | undefined {
  const inputTokens = finiteNumber(chunk?.usageMetadata?.promptTokenCount);
  const outputTokens = finiteNumber(chunk?.usageMetadata?.candidatesTokenCount);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}
```

Accumulate and attach to `done` the same way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/chat/providerUsage.test.ts tests/unit/chat` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/providers/openai.ts src/main/chat/providers/google.ts tests/unit/chat/providerUsage.test.ts
git commit -m "feat(chat): openai and google adapters report token usage"
```

---

### Task 5: The three remaining adapters state plainly that they report nothing

**Files:**
- Modify: `src/main/chat/providers/ollama.ts`, `src/main/chat/providers/local-gateway.ts`, `src/main/chat/providers/power.ts`
- Test: `tests/unit/chat/providerUsageCoverage.test.ts`

**Interfaces:**
- Produces: nothing new. This task exists so the gap is documented rather than discovered later as a suspected bug.

**Context you need:** Ollama's `/api/chat` stream reports `prompt_eval_count` and `eval_count` on its final object — wire it if present. The local gateway and Power adapters proxy other services and may not surface usage at all; if a shape is not clearly documented in the code you can see, **do not guess** — leave usage absent and say so in a comment. An absent `in=` is honest; an invented one corrupts every cost figure downstream.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat/providerUsageCoverage.test.ts
import * as fs from 'fs';
import * as path from 'path';

const PROVIDERS = ['ollama', 'local-gateway', 'power'];
const dir = path.join(__dirname, '../../../src/main/chat/providers');

describe('every provider states its usage-reporting position', () => {
  // A provider that silently reports nothing is indistinguishable from one that is broken. Each
  // of these must say, in a comment, either that it parses usage or why it cannot — so the next
  // person to wonder "why is cost missing for Ollama?" finds the answer in the file.
  for (const p of PROVIDERS) {
    it(`${p} mentions token usage explicitly`, () => {
      const src = fs.readFileSync(path.join(dir, `${p}.ts`), 'utf-8');
      expect(src.toLowerCase()).toMatch(/token usage|usage is not|no usage/);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/chat/providerUsageCoverage.test.ts`
Expected: FAIL — none of the three mentions usage.

- [ ] **Step 3: Wire Ollama, document the other two**

In `src/main/chat/providers/ollama.ts`, add near the stream loop:

```ts
// Token usage: Ollama reports prompt_eval_count / eval_count on the final stream object.
const finiteNumber = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export function extractOllamaUsage(chunk: any): TokenUsage | undefined {
  const inputTokens = finiteNumber(chunk?.prompt_eval_count);
  const outputTokens = finiteNumber(chunk?.eval_count);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}
```

Accumulate and attach to `done` as in Task 3.

In `local-gateway.ts` and `power.ts`, add a comment above the stream loop stating the position, for example:

```ts
// Token usage is not reported on this path: this adapter proxies another service and the
// upstream response body is not surfaced here. `llm.call` will therefore carry no in=/out=/cost=
// for this provider — deliberately absent rather than estimated, because an invented token count
// silently corrupts every cost figure derived from it.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/chat` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/providers/ollama.ts src/main/chat/providers/local-gateway.ts src/main/chat/providers/power.ts tests/unit/chat/providerUsageCoverage.test.ts
git commit -m "feat(chat): ollama reports usage; gateway and power state why they cannot"
```

---

### Task 6: A price table that admits its own age

**Files:**
- Create: `src/main/logging/modelPricing.ts`
- Test: `tests/unit/logging/modelPricing.test.ts`

**Interfaces:**
- Consumes: `TokenUsage` (Task 1).
- Produces: `estimateCostUsd(model: string, usage: TokenUsage | undefined): number | undefined`, `PRICES_AS_OF: string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/logging/modelPricing.test.ts
import { estimateCostUsd, PRICES_AS_OF } from '../../../src/main/logging/modelPricing';

describe('estimateCostUsd', () => {
  it('prices a known model from its token counts', () => {
    const cost = estimateCostUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBeGreaterThan(0);
  });

  it('returns undefined for a model it does not know, rather than guessing', () => {
    // A wrong cost is worse than no cost: it is indistinguishable from a right one, and it is the
    // number a user would budget against.
    expect(estimateCostUsd('some-model-shipped-next-year', { inputTokens: 1000, outputTokens: 100 }))
      .toBeUndefined();
  });

  it('returns undefined when usage is absent', () => {
    expect(estimateCostUsd('claude-opus-5', undefined)).toBeUndefined();
    expect(estimateCostUsd('claude-opus-5', {})).toBeUndefined();
  });

  it('prices a half-known call on the half it knows', () => {
    // Output tokens alone still cost money; refusing to price them loses real spend.
    expect(estimateCostUsd('claude-opus-5', { outputTokens: 1000 })).toBeGreaterThan(0);
  });

  it('matches models regardless of a version suffix', () => {
    // Providers append dates and revisions: claude-opus-5-20260501 is still claude-opus-5.
    const exact = estimateCostUsd('claude-opus-5', { inputTokens: 1000 });
    expect(estimateCostUsd('claude-opus-5-20260501', { inputTokens: 1000 })).toBe(exact);
  });

  it('carries the date the prices were accurate', () => {
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/logging/modelPricing.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the table**

```ts
// src/main/logging/modelPricing.ts
import type { TokenUsage } from '../../common/chat-types';

/**
 * The date these prices were checked. Vendors change them; a cost figure without a date is a
 * claim nobody can audit. Print this in the docs and in the Logging preferences panel so a stale
 * table is visible rather than silently believed.
 */
export const PRICES_AS_OF = '2026-08-09';

/** USD per million tokens, keyed by model family prefix. */
const PRICES: ReadonlyArray<{ prefix: string; inPerM: number; outPerM: number }> = [
  { prefix: 'claude-opus-5',   inPerM: 15,   outPerM: 75 },
  { prefix: 'claude-sonnet-5', inPerM: 3,    outPerM: 15 },
  { prefix: 'claude-haiku-4-5', inPerM: 0.8, outPerM: 4 },
  { prefix: 'gpt-4o-mini',     inPerM: 0.15, outPerM: 0.6 },
  { prefix: 'gpt-4o',          inPerM: 2.5,  outPerM: 10 },
  { prefix: 'gemini-2.5-pro',  inPerM: 1.25, outPerM: 10 },
  { prefix: 'gemini-2.5-flash', inPerM: 0.3, outPerM: 2.5 },
];

/**
 * What this call cost, or undefined when that cannot be known.
 *
 * Undefined has two causes and both must stay undefined: the model is not in the table, or the
 * provider reported no usage. Returning 0 for either would put a free call in the log next to a
 * real one and make any total silently wrong.
 */
export function estimateCostUsd(model: string, usage: TokenUsage | undefined): number | undefined {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) return undefined;
  // Longest prefix wins, so gpt-4o-mini is not priced as gpt-4o.
  const row = [...PRICES].sort((a, b) => b.prefix.length - a.prefix.length)
    .find(p => model.startsWith(p.prefix));
  if (!row) return undefined;
  const cost = ((usage.inputTokens ?? 0) / 1_000_000) * row.inPerM
             + ((usage.outputTokens ?? 0) / 1_000_000) * row.outPerM;
  return Number(cost.toFixed(6));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/logging/modelPricing.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/logging/modelPricing.ts tests/unit/logging/modelPricing.test.ts
git commit -m "feat(logging): per-model price table carrying its as-of date"
```

---

### Task 7: AgentAIClient emits llm.call and llm.error

**Files:**
- Modify: `src/main/agent-runtime/AgentAIClient.ts`, `src/main/agent-runtime/buildAgentContext.ts` (~line 60, where the client is constructed)
- Test: `tests/unit/agent-runtime/llmEvents.test.ts`

**Interfaces:**
- Consumes: `EventLog`, `estimateCostUsd`, `collectStream`.
- Produces: `AgentAIClient` accepts a 6th constructor argument `events?: { eventLog?: EventLog; runId?: string; agentName: string }` — the same `ToolEventContext` shape `NexusToolProvider` already takes (`src/main/agent-runtime/NexusToolProvider.ts`). Import and reuse that type; do not define a second one.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/agent-runtime/llmEvents.test.ts
import { AgentAIClient } from '../../../src/main/agent-runtime/AgentAIClient';
import type { ProviderStreamEvent } from '../../../src/common/chat-types';

function fakeLog() {
  const lines: any[] = [];
  return { lines, log: { write: (e: any) => lines.push(e) } as any };
}

/** A provider that answers once with the given events. */
function fakeProvider(...events: ProviderStreamEvent[]) {
  return { async *streamChat() { for (const e of events) yield e; } } as any;
}

const toolProvider = { getProviderToolDefinitions: () => [], invoke: async () => ({}) } as any;
const config = { apiKey: '', model: 'claude-opus-5' } as any;

describe('llm.call', () => {
  it('records model, turn, tokens, cost and duration', async () => {
    const { lines, log } = fakeLog();
    const client = new AgentAIClient(
      fakeProvider({ type: 'token', text: 'done' },
                   { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 1204, outputTokens: 318 } }),
      config, toolProvider, undefined, undefined,
      { eventLog: log, runId: 'r_test', agentName: 'security-sentinel' },
    );
    await client.run('hello');

    const calls = lines.filter(l => l.event === 'llm.call');
    expect(calls).toHaveLength(1);
    expect(calls[0].runId).toBe('r_test');
    expect(calls[0].fields).toMatchObject({
      model: 'claude-opus-5', turn: 1, in: 1204, out: 318,
    });
    expect(calls[0].fields.cost).toBeGreaterThan(0);
    expect(String(calls[0].fields.dur)).toMatch(/^\d+ms$/);
  });

  it('omits in/out/cost when the provider reported no usage', async () => {
    // Ollama and the gateway report nothing. Absent is honest; 0 would read as a free call.
    const { lines, log } = fakeLog();
    const client = new AgentAIClient(
      fakeProvider({ type: 'token', text: 'x' }, { type: 'done', stopReason: 'end_turn' }),
      config, toolProvider, undefined, undefined,
      { eventLog: log, runId: 'r_test', agentName: 'a' },
    );
    await client.run('hello');

    const f = lines.find(l => l.event === 'llm.call').fields;
    expect(f.in).toBeUndefined();
    expect(f.out).toBeUndefined();
    expect(f.cost).toBeUndefined();
    expect(f.model).toBe('claude-opus-5');
  });

  it('numbers each turn of a multi-turn loop', async () => {
    const { lines, log } = fakeLog();
    let call = 0;
    const provider = {
      async *streamChat() {
        call++;
        if (call === 1) {
          yield { type: 'tool_call_end', id: 't1', name: 'wp_plugin_list', arguments: {} };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'token', text: 'finished' };
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
    } as any;
    const client = new AgentAIClient(provider, config, toolProvider, undefined, undefined,
      { eventLog: log, runId: 'r_test', agentName: 'a' });
    await client.run('hello');

    expect(lines.filter(l => l.event === 'llm.call').map(l => l.fields.turn)).toEqual([1, 2]);
  });

  it('records llm.error at WARN when the provider fails, and rethrows', async () => {
    const { lines, log } = fakeLog();
    const client = new AgentAIClient(
      fakeProvider({ type: 'error', message: 'rate limited' }),
      config, toolProvider, undefined, undefined,
      { eventLog: log, runId: 'r_test', agentName: 'a' },
    );
    await expect(client.run('hello')).rejects.toThrow(/rate limited/);

    const errors = lines.filter(l => l.event === 'llm.error');
    expect(errors).toHaveLength(1);
    expect(errors[0].level).toBe('WARN');
    expect(errors[0].message).toMatch(/rate limited/);
    expect(lines.filter(l => l.event === 'llm.call')).toHaveLength(0);
  });

  it('runs unchanged with no event log at all', async () => {
    const client = new AgentAIClient(
      fakeProvider({ type: 'token', text: 'ok' }, { type: 'done', stopReason: 'end_turn' }),
      config, toolProvider,
    );
    await expect(client.run('hello')).resolves.toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/agent-runtime/llmEvents.test.ts`
Expected: FAIL — the constructor takes no 6th argument and nothing is written.

- [ ] **Step 3: Emit around each provider call**

In `src/main/agent-runtime/AgentAIClient.ts`, accept and store the context:

```ts
  private events?: ToolEventContext;

  constructor(
    provider: AIProvider, config: ChatProviderConfig, toolProvider: NexusToolProvider,
    directProvider?: AIProvider, directConfig?: ChatProviderConfig, events?: ToolEventContext,
  ) {
    // …existing assignments…
    this.events = events;
  }

  /**
   * One model call, recorded. The runtime does this rather than the agent, because an agent
   * cannot forget to log a call it never mentions — the same reason tool.call is emitted here
   * and not in agent code. Never throws: a logging fault must not fail a model call.
   */
  private emitLlmCall(model: string, turn: number, startedAt: number, usage?: TokenUsage): void {
    const ctx = this.events;
    if (!ctx?.eventLog) return;
    try {
      ctx.eventLog.write({
        level: 'INFO', source: ctx.agentName, sourceKind: 'agent', runId: ctx.runId,
        event: 'llm.call',
        fields: {
          model, turn,
          in: usage?.inputTokens, out: usage?.outputTokens,
          cost: estimateCostUsd(model, usage),
          dur: `${Date.now() - startedAt}ms`,
        },
      } as any);
    } catch { /* never fail a model call for a log line */ }
  }

  private emitLlmError(model: string, turn: number, startedAt: number, message: string): void {
    const ctx = this.events;
    if (!ctx?.eventLog) return;
    try {
      ctx.eventLog.write({
        level: 'WARN', source: ctx.agentName, sourceKind: 'agent', runId: ctx.runId,
        event: 'llm.error',
        fields: { model, turn, dur: `${Date.now() - startedAt}ms` },
        message,
      } as any);
    } catch { /* never fail a model call for a log line */ }
  }
```

Wrap each of the three `collectStream(...)` call sites. In `run()`:

```ts
      const startedAt = Date.now();
      let response;
      try {
        response = await collectStream(this.provider.streamChat(messages, tools, config, signal));
      } catch (err: unknown) {
        this.emitLlmError(config.model, turn + 1, startedAt, err instanceof Error ? err.message : String(err));
        throw err;
      }
      this.emitLlmCall(config.model, turn + 1, startedAt, response.usage);
```

Apply the same shape to both `collectStream` calls in `generateObject`, using `forcedConfig.model` / `this.config.model` respectively. Import `TokenUsage`, `estimateCostUsd`, and `ToolEventContext`.

In `src/main/agent-runtime/buildAgentContext.ts`, pass the context when constructing the client — the same object already built for `NexusToolProvider`:

```ts
  const aiEvents = { eventLog, runId, agentName };
```

and add `aiEvents` as the 6th argument to the `new AgentAIClient(...)` call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/agent-runtime/llmEvents.test.ts tests/unit/agent-runtime/AgentAIClient.test.ts tests/unit/agent-runtime/AgentAIClient.generateObject.test.ts tests/unit/agent-runtime/buildAgentContext.eventlog.test.ts`
Expected: PASS — all four suites.

- [ ] **Step 5: Verify each test fails when its line is removed**

Delete the `emitLlmCall` call in `run()`, run the suite, confirm the first three tests fail; restore. Delete `emitLlmError`, confirm the fourth fails; restore. Report what you saw.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-runtime/AgentAIClient.ts src/main/agent-runtime/buildAgentContext.ts tests/unit/agent-runtime/llmEvents.test.ts
git commit -m "feat(agents): record every model call with tokens, cost and duration"
```

---

### Task 8: Opt-in transcripts

**Files:**
- Create: `src/main/logging/transcript.ts`
- Modify: `src/main/agent-runtime/AgentAIClient.ts`, `src/main/agent-runtime/buildAgentContext.ts`, `src/renderer/components/agents/AgentStore.ts` (the `AgentSettings` interface)
- Test: `tests/unit/logging/transcript.test.ts`

**Interfaces:**
- Consumes: `EventLog`'s log root.
- Produces: `class TranscriptWriter { constructor(opts: { root: string; runId: string; now?: () => Date }); append(entry: TranscriptEntry): void; path(): string }` and `interface TranscriptEntry { turn: number; role: 'prompt' | 'response'; model: string; content: string }`. `AgentSettings` gains `transcripts?: boolean`.

**Context you need:** Transcripts are **off by default** and enabled per agent, because a prompt carries site content and whatever an agent pasted into it. They live at `<logRoot>/transcripts/<runId>.jsonl`, mode 0600, one JSON object per line. Retention (3 days) is Phase 3's job — do not build it here.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/logging/transcript.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TranscriptWriter } from '../../../src/main/logging/transcript';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-transcript-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('TranscriptWriter', () => {
  it('writes one JSON object per line under transcripts/', () => {
    const w = new TranscriptWriter({ root, runId: 'r_abc' });
    w.append({ turn: 1, role: 'prompt', model: 'claude-opus-5', content: 'scan acfprod' });
    w.append({ turn: 1, role: 'response', model: 'claude-opus-5', content: 'I will start by…' });

    const file = path.join(root, 'transcripts', 'r_abc.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ turn: 1, role: 'prompt', content: 'scan acfprod' });
    expect(JSON.parse(lines[1]).role).toBe('response');
  });

  it('is 0600 — a transcript is the most sensitive thing this system writes', () => {
    const w = new TranscriptWriter({ root, runId: 'r_abc' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'x' });
    const mode = fs.statSync(path.join(root, 'transcripts', 'r_abc.jsonl')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('keeps a newline out of the record so one entry stays one line', () => {
    const w = new TranscriptWriter({ root, runId: 'r_abc' });
    w.append({ turn: 1, role: 'prompt', model: 'm', content: 'line one\nline two' });
    const raw = fs.readFileSync(path.join(root, 'transcripts', 'r_abc.jsonl'), 'utf-8');
    expect(raw.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(raw).content).toBe('line one\nline two');
  });

  it('never throws when the directory cannot be written', () => {
    const w = new TranscriptWriter({ root: '/proc/nonexistent-nexus', runId: 'r_abc' });
    expect(() => w.append({ turn: 1, role: 'prompt', model: 'm', content: 'x' })).not.toThrow();
  });

  it('reports its own path so a log line can point at it', () => {
    const w = new TranscriptWriter({ root, runId: 'r_abc' });
    expect(w.path().endsWith(path.join('transcripts', 'r_abc.jsonl'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/logging/transcript.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the writer**

```ts
// src/main/logging/transcript.ts
import * as fs from 'fs';
import * as path from 'path';

export interface TranscriptEntry {
  turn: number;
  role: 'prompt' | 'response';
  model: string;
  content: string;
}

export interface TranscriptOptions {
  /** The log root — transcripts live in a `transcripts/` directory beneath it. */
  root: string;
  runId: string;
}

/**
 * The full prompt and response of each model turn, for the one agent you are debugging.
 *
 * Off by default and enabled per agent, because this is the most sensitive thing the logging
 * system writes: a prompt carries site content, findings, and whatever the agent put in it.
 * 0600, one JSON object per line, named by run id so a `llm.call` line can point at it.
 */
export class TranscriptWriter {
  private readonly file: string;

  constructor(opts: TranscriptOptions) {
    this.file = path.join(opts.root, 'transcripts', `${opts.runId}.jsonl`);
  }

  path(): string { return this.file; }

  /** Never throws — a transcript is a debugging aid, not a reason to fail a run. */
  append(entry: TranscriptEntry): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      // JSON.stringify escapes the newlines inside content, so one entry stays one line.
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      try { fs.chmodSync(this.file, 0o600); } catch { /* best effort on a pre-existing file */ }
    } catch { /* a transcript that cannot be written must not fail the run */ }
  }
}
```

- [ ] **Step 4: Wire it, gated on the per-agent setting**

Add to `AgentSettings` in `src/renderer/components/agents/AgentStore.ts`:

```ts
  /**
   * Write the full prompt and response of every model call to a transcript sidecar. Off by
   * default: prompts carry site content, so this is opt-in for the agent you are debugging.
   */
  transcripts?: boolean;
```

In `AgentAIClient`, accept the writer and record both halves of each turn:

```ts
  private transcript?: TranscriptWriter;

  // …in run(), around the provider call:
      this.transcript?.append({
        turn: turn + 1, role: 'prompt', model: config.model,
        content: messages.map(m => `${m.role}: ${m.content ?? ''}`).join('\n'),
      });
      // …collectStream…
      this.transcript?.append({
        turn: turn + 1, role: 'response', model: config.model, content: response.content,
      });
```

and point the log line at the file, so a reader knows a transcript exists without listing the
directory:

```ts
          transcript: this.transcript?.path(),
```

added to the `emitLlmCall` fields (absent when there is no writer, per the never-fabricate rule).

In `buildAgentContext.ts`, construct the writer only when the agent opted in:

```ts
  // Off unless this agent asked for it: a transcript is the most sensitive artefact this system
  // writes, and "on for everything" would put every site's content on disk permanently.
  const transcript = agentSettings?.transcripts && runId
    ? new TranscriptWriter({ root: nexusLogRoot, runId })
    : undefined;
```

and pass it as the 7th `AgentAIClient` argument.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/logging tests/unit/agent-runtime` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS for every suite except the 4 known sqlite ABI failures.

- [ ] **Step 6: Commit**

```bash
git add src/main/logging/transcript.ts src/main/agent-runtime/AgentAIClient.ts src/main/agent-runtime/buildAgentContext.ts src/renderer/components/agents/AgentStore.ts tests/unit/logging/transcript.test.ts
git commit -m "feat(logging): opt-in per-agent transcripts of model calls"
```

---

## Done when

A manual `nexus agent run security-sentinel` produces, in `~/Library/Application Support/Local/nexus-ai/logs/nexus-$(date +%F).log`:

```
grep llm.call nexus-*.log     # model, turn, in=, out=, cost=, dur= for every model call
grep llm.error nexus-*.log    # provider failures, with the reason
```

and with `transcripts` enabled for that agent, `logs/transcripts/<runId>.jsonl` exists at 0600 with one JSON object per turn.
