# External Host Defects (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 real defects found in an external code review (`/Users/jeremy.pollock/Downloads/2026-08-08-external-host-onboarding-and-fixes.md`, Part A), the most severe of which silently breaks content indexing for every real multi-site external host, and two production security gaps (unrestricted agent tool access, an unaudited/ungated production WP-CLI+delete path).

**Architecture:** Nine independent-ish fixes across the external-host transport layer, the agent tool-safety pipeline, and documentation. None of this touches the External Host Onboarding UI (a separate, later plan) — this plan only fixes what's broken in the code that UI would otherwise build on top of.

**Tech Stack:** TypeScript, Jest, existing MCP tool registry / safety-tier / audit infrastructure.

## Global Constraints

- **F2 (locked in):** the A1 fix uses a hash-suffix for vector-table-id collision avoidance, not a cross-row uniqueness assertion.
- **F3 (locked in):** SentinelExecutor's WP-CLI and file-delete paths route through `resolveTransport`/`isOperationAllowed`, closing the bypass rather than documenting it.
- **F4 (locked in):** backfill explicit `TIER_OVERRIDES` entries for read-only tools currently defaulting to Tier 2, rather than restating the "read-only is not audited" rule to match current behavior.
- **Do not change `externalSiteId`** (`src/main/external/externalSiteStore.ts`) — the `ssh:<alias>/<site>` form is the real id used everywhere except the vector store's table-name boundary, and per the review's decision 0.2 it stays.
- **`probeExternalHost`'s bypass of `withPolicy`/`isOperationAllowed` stays as-is in this plan** — it is justified because its command set is closed and read-only. This plan does not touch it; a future change that adds a mutating or caller-influenced command to it would need to route it through the gate too, but that is out of scope here.
- Re-verify the test baseline before each task's final commit. As of the start of this plan (after rebuilding `better-sqlite3` for the system-Node ABI — **run `npm rebuild better-sqlite3` first if you see widespread native-module `NODE_MODULE_VERSION` errors across unrelated test suites; this means the binary is currently built for Electron, not system Node**): `Test Suites: 12 failed, 309 passed, 321 total`, all 12 pre-existing and unrelated. Do not let any task's change widen this baseline.
- **This plan does not touch the External Host Onboarding UI** (Parts B/C of the source review document) — that is a separate, later plan.

---

### Task 1: A1 (P0) — Fix external content indexing for every multi-site host

**Files:**
- Modify: `src/main/vector-store/vectorSiteId.ts`
- Test: `tests/unit/vector-store/vectorSiteId.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `vectorSiteId(siteId: string): string` — same signature, corrected behavior. Every existing caller (`ExternalContentIndexService.ts:111`, and any other consumer of this function) is unaffected by signature — only the translated value changes for ids containing `/`.

**Context:** `externalSiteId(alias, site)` (`src/main/external/externalSiteStore.ts:23-25`) returns `ssh:${alias}/${site}` — this is the real id used everywhere (graph `content` table, `IndexRegistry`, audit) and must not change (see Global Constraints). `vectorSiteId` is supposed to translate this into something `SqliteVecStore`'s table-name validator (`^[a-zA-Z0-9_-]+$`, `src/main/vector-store/SqliteVecStore.ts:27-32`) accepts, but today only replaces `:`, leaving the `/` — every multi-site external host's table name fails validation, the error is swallowed by a blanket `catch` in `ExternalContentIndexService.ts:121` (after all the expensive extraction/embedding work has already run and is discarded), and every such host is permanently stuck at `state: 'error'`, `documentCount: 0`.

A naive "replace every invalid character with `_`" fix creates a NEW collision risk: `ssh:a/b-c` and `ssh:a-b/c` both sanitize to `ssh_a_b_c`. Per F2, resolve this with a short stable hash suffix, not a uniqueness check.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `tests/unit/vector-store/vectorSiteId.test.ts`:

```ts
import { vectorSiteId } from '../../../src/main/vector-store/vectorSiteId';

describe('vectorSiteId', () => {
  it('replaces colons with underscores', () => {
    expect(vectorSiteId('ssh:hostinger-test')).toBe('ssh_hostinger-test');
  });

  it('leaves an id with no invalid character unchanged', () => {
    expect(vectorSiteId('wpe-abc123')).toBe('wpe-abc123');
    expect(vectorSiteId('mmWgjXGRS')).toBe('mmWgjXGRS');
  });

  it('translates a multi-site external id (alias/site) into a valid table name', () => {
    const translated = vectorSiteId('ssh:hostinger-test/site-a');
    expect(/^[a-zA-Z0-9_-]+$/.test(translated)).toBe(true);
  });

  it('the translated id satisfies the real validation regex for every case above', () => {
    for (const id of ['ssh:my-host_1', 'ssh:hostinger-test/site-a', 'ssh:dotted.alias/site', 'wpe-abc123']) {
      expect(/^[a-zA-Z0-9_-]+$/.test(vectorSiteId(id))).toBe(true);
    }
  });

  it('does not collide two different ids that share the same character-class-replaced prefix', () => {
    const a = vectorSiteId('ssh:a/b-c');
    const b = vectorSiteId('ssh:a-b/c');
    expect(a).not.toBe(b);
  });

  it('is deterministic — the same id always translates to the same value', () => {
    expect(vectorSiteId('ssh:hostinger-test/site-a')).toBe(vectorSiteId('ssh:hostinger-test/site-a'));
  });

  it('handles multiple invalid characters (defensive — real ids should not have more than one slash)', () => {
    const translated = vectorSiteId('ssh:a/b/c');
    expect(/^[a-zA-Z0-9_-]+$/.test(translated)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/vector-store/vectorSiteId.test.ts -v`
Expected: FAIL — the multi-site and collision tests fail because the current implementation only strips `:`, leaving `/` in the output (fails the regex test) and produces identical output for the two different ids in the collision test.

- [ ] **Step 3: Implement**

Replace the full contents of `src/main/vector-store/vectorSiteId.ts`:

```ts
import * as crypto from 'crypto';

/**
 * sqlite-vec table names can't contain anything outside `^[a-zA-Z0-9_-]+$`
 * (SqliteVecStore.validateSiteId). Real site ids can contain `:` (every id,
 * `wpe:<alias>` style prefixes) and `/` (external multi-site ids,
 * `ssh:<alias>/<site>` — see externalSiteStore.ts's externalSiteId, which
 * must NOT change; it is the real id everywhere except this boundary).
 *
 * A character-class replace alone creates real collisions: `ssh:a/b-c` and
 * `ssh:a-b/c` both sanitize to `ssh_a_b_c`. A short stable hash of the
 * ORIGINAL id is appended so two different ids can never produce the same
 * table name, without needing a cross-row uniqueness check at write time.
 *
 * Local and WPE ids (`mmWgjXGRS`, `wpe-<uuid>`) already satisfy the regex, so
 * for them `sanitized === id` and the hash-suffixed form is still applied —
 * this is safe (just a longer, still-valid table name) and keeps the function
 * uniform rather than branching on "did this id need sanitizing".
 */
export function vectorSiteId(siteId: string): string {
  const sanitized = siteId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = crypto.createHash('sha256').update(siteId).digest('hex').slice(0, 8);
  return `${sanitized}_${hash}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/vector-store/vectorSiteId.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Fix the stale docstring and consuming tests**

`ExternalContentIndexService.test.ts` (`tests/unit/events/ExternalContentIndexService.test.ts`) currently exercises only `'ssh:myhost'` (single-segment) ids per the review's finding. Read that file, find every use of a bare `'ssh:myhost'`-style id, and add at least one test case using a real two-segment id (`'ssh:myhost/mysite'`) asserting the content-indexing path completes without throwing (i.e., `vectorStore.upsert` is called with a value that would pass `SqliteVecStore`'s real validation regex — you can assert this directly: `expect(/^[a-zA-Z0-9_-]+$/.test(upsertMock.mock.calls[0][0])).toBe(true)`, using whatever mock/spy pattern that test file already uses for `vectorStore.upsert`).

Also add, in the same test run, a direct assertion that `SqliteVecStore` itself accepts whatever `vectorSiteId` emits — the review calls this out as "the missing link that let this ship". If `tests/unit/vector-store/sqlite-vec-store.test.ts` exists and already constructs a real or mocked `SqliteVecStore`, add one test there:

```ts
import { vectorSiteId } from '../../../src/main/vector-store/vectorSiteId';

it('accepts every id vectorSiteId can produce, including a multi-site external id', async () => {
  // Use this file's existing store setup/fixture pattern — read the surrounding
  // tests in this file first to match it exactly (in-memory db path, etc.).
  const siteId = vectorSiteId('ssh:hostinger-test/site-a');
  await expect(store.upsert(siteId, [])).resolves.not.toThrow();
});
```

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/vector-store tests/unit/events/ExternalContentIndexService.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/vector-store/vectorSiteId.ts tests/unit/vector-store/vectorSiteId.test.ts tests/unit/events/ExternalContentIndexService.test.ts tests/unit/vector-store/sqlite-vec-store.test.ts
git commit -m "fix(vector-store): translate every invalid vector-table-id character, not just ':'

externalSiteId's ssh:<alias>/<site> ids contain '/', which SqliteVecStore's
table-name validator rejects -- every multi-site external host has been
permanently stuck at state:'error' after running the full extraction and
embedding pipeline, since the throw is swallowed by a blanket catch. A
character-class replace alone collides ssh:a/b-c with ssh:a-b/c, so a short
stable hash of the original id is appended (F2)."
```

---

### Task 2: A2 (P1) — `tools: []` must deny all tools, not grant unrestricted access

**Files:**
- Modify: `src/main/agent-runtime/buildAgentContext.ts`
- Modify: `src/main/agent-runtime/NexusToolProvider.ts`
- Test: `tests/unit/agent-runtime/buildAgentContext.test.ts` (extend, or create if it doesn't exist — check first)
- Test: `tests/unit/agent-runtime/NexusToolProvider.test.ts` (extend, or create if it doesn't exist — check first)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature changes — `NexusToolProvider`'s constructor and `allowedTools` field keep their current types; only the semantics of an empty array change.

**Context:** `src/main/agent-sdk/types.ts:119` documents `tools?: string[]` as "undefined/empty = no tool access", but `buildAgentContext.ts:47` does `agent.tools?.length ? agent.tools : undefined` — an empty array (`length === 0`) becomes `undefined`, and `NexusToolProvider`'s constructor (`:20`) does `this.allowedTools = tools !== undefined ? new Set(tools) : undefined`, so `undefined` allowedTools means unrestricted (its `filter`/`call` guard at `:31` and `:41` both short-circuit to "allow" when `allowedTools` is falsy). An agent author writing `tools: []` intending to lock an agent down instead opens it to every tool.

Same file, second real gap: `NexusToolProvider`'s `wp_eval` sandbox scoping (`:47-52`) only restricts the target site when `this.allowedTools` is truthy **and** `this.sandboxSiteIds.size > 0` — an agent that never calls `registerSandbox()` (so `sandboxSiteIds` stays empty) can `wp_eval` any site with no restriction at all, even if `allowedTools` correctly lists `wp_eval` as its only permitted tool.

- [ ] **Step 1: Read the current test files first**

Run: `find tests -iname "*buildAgentContext*" -o -iname "*NexusToolProvider*"`

Read whatever exists to match existing fixture/mock patterns before writing new tests below — do not guess at the shape of `agent`/`services` fixtures already established in these files.

- [ ] **Step 2: Write the failing tests**

Add to `tests/unit/agent-runtime/buildAgentContext.test.ts` (or create it, following the pattern of whatever sibling test file in that directory already constructs a minimal `AgentDefinition`):

```ts
it('agent.tools: [] produces a tools list that denies every tool (not unrestricted access)', () => {
  const agent = { /* ...minimal required fields from this file's existing fixture pattern... */ tools: [] };
  const context = buildAgentContext(agent /* , ...whatever other args this function takes */);
  // The exact assertion depends on buildAgentContext's return shape -- read it
  // first. It must NOT be `undefined` (which NexusToolProvider treats as
  // unrestricted); it must be an empty array or otherwise produce a
  // NexusToolProvider that denies every tool call.
});
```

Add to `tests/unit/agent-runtime/NexusToolProvider.test.ts` (or create it):

```ts
import { NexusToolProvider } from '../../../src/main/agent-runtime/NexusToolProvider';

describe('NexusToolProvider — empty allowedTools denies everything', () => {
  it('an empty tools array denies every tool call', async () => {
    const provider = new NexusToolProvider([] /* , ...other constructor args per current signature */);
    // Read the constructor signature and call()/list() methods first to match
    // the exact call shape. The assertion: calling ANY tool name must be
    // refused, and listing tools must return an empty list.
  });

  it('undefined tools (agent never declares) remains unrestricted, unchanged', async () => {
    const provider = new NexusToolProvider(undefined /* , ... */);
    // Must still allow tools -- this is the existing, correct behavior for an
    // agent that never declares a tools list at all, and must not regress.
  });
});

describe('NexusToolProvider — wp_eval sandbox scoping', () => {
  it('refuses wp_eval against any site when allowedTools is set but registerSandbox was never called', async () => {
    const provider = new NexusToolProvider(['wp_eval'] /* , ... */);
    // Do NOT call registerSandbox(). Calling wp_eval against ANY site must be
    // refused now -- today it is allowed against any site because the guard
    // only activates when sandboxSiteIds.size > 0.
  });
});
```

- [ ] **Step 3: Run and verify they fail**

Run: `npx jest tests/unit/agent-runtime/buildAgentContext.test.ts tests/unit/agent-runtime/NexusToolProvider.test.ts -v`
Expected: FAIL on the new empty-array and no-sandbox-registered cases.

- [ ] **Step 4: Implement the `buildAgentContext.ts` fix**

In `src/main/agent-runtime/buildAgentContext.ts`, change line 47 from:

```ts
    agent.tools?.length ? agent.tools : undefined,
```

to:

```ts
    // undefined (agent never declares a tools list) stays unrestricted --
    // that is existing, correct behavior. An EMPTY array means the author
    // explicitly locked this agent down and must deny every tool, not fall
    // through to the undefined/unrestricted case. Do not collapse `[]` to
    // `undefined` here.
    agent.tools,
```

(Read the surrounding lines first — this is the argument being passed into whatever constructs the `NexusToolProvider` for this agent; confirm the parameter position/name is otherwise unchanged.)

- [ ] **Step 5: Implement the `NexusToolProvider.ts` fixes**

Read `src/main/agent-runtime/NexusToolProvider.ts` fully first. Two changes:

1. The `wp_eval` sandbox guard at line 47 currently reads (approximately):

```ts
    if (name === 'wp_eval' && this.allowedTools && this.sandboxSiteIds.size > 0) {
```

Change the condition so an agent with a restricted tool list (`allowedTools` set) but an empty sandbox always refuses `wp_eval`, rather than only refusing when a sandbox has actually been registered:

```ts
    if (name === 'wp_eval' && this.allowedTools) {
      // No sandbox registered means no site is authorized for wp_eval at all --
      // this must refuse, not fall through to "any site is fine" the way an
      // empty sandboxSiteIds set used to.
      if (this.sandboxSiteIds.size === 0) {
        return { content: [{ type: 'text', text: 'wp_eval refused: no sandbox site registered for this agent' }], isError: true };
      }
      const targetSite = /* ...whatever this file's existing logic uses to extract the target site from args... */;
      if (targetSite && !this.sandboxSiteIds.has(targetSite)) {
        // ...existing refusal logic below this point is unchanged...
      }
    }
```

(Copy the exact existing variable names/logic for extracting `targetSite` from the current code — do not invent a different extraction method.)

2. Confirm `new Set(tools)` on an empty array (`tools = []`) already produces an empty `Set`, which the existing `if (this.allowedTools && !this.allowedTools.has(name))` guard at line 41 already correctly refuses (a truthy-but-empty `Set` still passes `this.allowedTools &&`, and `.has(name)` is false for anything) — this part should already work correctly once Step 4's fix stops collapsing `[]` to `undefined` before it ever reaches this constructor. No code change needed here beyond confirming it via the test in Step 2.

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/agent-runtime/buildAgentContext.test.ts tests/unit/agent-runtime/NexusToolProvider.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent-runtime/buildAgentContext.ts src/main/agent-runtime/NexusToolProvider.ts tests/unit/agent-runtime/buildAgentContext.test.ts tests/unit/agent-runtime/NexusToolProvider.test.ts
git commit -m "fix(agents): tools: [] denies every tool instead of granting unrestricted access

buildAgentContext collapsed an empty tools array to undefined, and
NexusToolProvider treats undefined as unrestricted -- an agent author
writing tools: [] to lock an agent down got the opposite. Also closes a
related gap: wp_eval was allowed against any site when allowedTools was
set but registerSandbox() was never called, since the guard only
activated once a sandbox actually existed."
```

---

### Task 3: A3 (P1) — Route SentinelExecutor through the permission gate

**Files:**
- Modify: `src/main/sentinel/SentinelExecutor.ts`
- Modify: `src/main/ipc-handlers.ts` (fix the stale comment at ~line 5248 referencing a removed method)
- Test: `tests/unit/sentinel/sentinel-executor.test.ts` (already exists per the review — extend it)

**Interfaces:**
- Consumes: `resolveTransport` (`src/main/transport/resolve.ts`), `isOperationAllowed` (`src/main/mcp/utils/operation-permissions.ts`) — both already used elsewhere in this codebase for exactly this purpose.
- Produces: `executeSentinelCommands`'s exported signature is unchanged (`installName: string, commands: string[], localServices: LocalServicesBridge`) — the gate is applied internally, not by changing the function's contract with its caller.

**Context:** `executeSentinelCommands` (`src/main/sentinel/SentinelExecutor.ts`) calls `new WpeSshTransport(installName).deleteRemoteFile(nasPath)` (line 42) for `rm` commands and `localServices.remoteWpCliRun(installName, args)` (line 56) for everything else — both bypass `resolveTransport`, `withPolicy(REMOTE_POLICY)`, and `isOperationAllowed` entirely, so LLM-composed WP-CLI and raw file deletion reach production WP Engine installs with zero policy check (a production install with `wpcli`/`delete` refused would still execute these). Per F3, this is fixed by routing through the gate, not documenting the bypass.

Read `src/main/transport/resolve.ts`'s `resolveTransport` function fully before starting — it is the existing, single place a target is resolved and a remote command policy applied (per this codebase's own architectural rule). Your job is to make `SentinelExecutor` a new, correctly-gated caller of it, not to duplicate its logic.

- [ ] **Step 1: Read the existing test file and `resolveTransport`'s call shape**

Run: `cat tests/unit/sentinel/sentinel-executor.test.ts` and `cat src/main/transport/resolve.ts` in full before writing anything — `resolveTransport` takes `(args: Record<string, unknown>, services: NexusServices, operation: string)` and returns either a `SiteTransport` or an `McpToolResult` error shape (`if ('content' in target) return target`). `executeSentinelCommands` currently receives `installName` and `localServices: LocalServicesBridge`, not the full `NexusServices` object `resolveTransport` needs — you will need to widen what's passed to this function. Check every caller of `executeSentinelCommands` (`grep -rn "executeSentinelCommands" src/main`) to see what's available at each call site before deciding how to thread `NexusServices` (or the specific pieces of it `resolveTransport` needs) through.

- [ ] **Step 2: Write the failing tests**

Add to `tests/unit/sentinel/sentinel-executor.test.ts`, following whatever mocking pattern the existing tests in that file already use for `localServices`/`WpeSshTransport`:

```ts
it('refuses a wp-cli command on production when wpcli is not permitted', async () => {
  // Set up services/settings such that isOperationAllowed('wpcli', 'production', ...)
  // returns false for this install -- match this file's existing fixture pattern
  // for constructing that permission state.
  const result = await executeSentinelCommands('some-production-install', ['wp option get siteurl'], /* localServices */, /* whatever additional arg this task adds for the gate */);
  expect(result.success).toBe(false);
  expect(result.steps[0].ok).toBe(false);
  expect(result.steps[0].error).toMatch(/blocked|not permitted/i);
});

it('refuses an rm command on production when delete is not permitted', async () => {
  const result = await executeSentinelCommands('some-production-install', ['rm -f wp-content/mu-plugins/bad.php'], /* ... */);
  expect(result.success).toBe(false);
  expect(result.steps[0].ok).toBe(false);
});

it('still executes when the operation is permitted (no regression on the happy path)', async () => {
  // Existing happy-path tests in this file should still pass unmodified --
  // this test just confirms the gate does not block a genuinely-allowed case.
});
```

- [ ] **Step 3: Run and verify the new tests fail**

Run: `npx jest tests/unit/sentinel/sentinel-executor.test.ts -v`
Expected: FAIL — today nothing blocks these commands regardless of permission settings.

- [ ] **Step 4: Implement**

The exact shape of this change depends on what you find in Step 1 (specifically, how `NexusServices` or its relevant pieces reach `executeSentinelCommands`'s call site today). The core change, regardless of threading details: before executing either branch (the `rm` branch or the WP-CLI branch), call `isOperationAllowed` with the correct operation name (`'delete'` for the `rm` branch, `'wpcli'` for the WP-CLI branch) and the install's resolved environment, and refuse with a clear `ok: false` step (matching this function's existing `ExecuteStep` shape) if it returns false — mirroring exactly how `resolveTransport` in `resolve.ts` already gates WP Engine targets today (read that function's existing gate block and match its style, including its audit-friendly error message shape). Do not invent a new gating mechanism; call the same `isOperationAllowed` function with the same argument shape `resolveTransport` already uses for WP Engine installs.

- [ ] **Step 5: Fix the stale comment**

In `src/main/ipc-handlers.ts`, find the comment near line 5248 referencing `SentinelExecutor.remoteSshRaw` (a method that no longer exists) and correct or remove it to describe the current `executeSentinelCommands` function accurately.

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/sentinel/sentinel-executor.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors. Also run `npx jest tests/unit/ipc -v` if the ipc-handlers.ts comment edit is anywhere near existing test coverage, to confirm nothing else broke.

- [ ] **Step 7: Commit**

```bash
git add src/main/sentinel/SentinelExecutor.ts src/main/ipc-handlers.ts tests/unit/sentinel/sentinel-executor.test.ts
git commit -m "fix(sentinel): route WP-CLI and file-delete remediation through the permission gate

executeSentinelCommands bypassed resolveTransport/isOperationAllowed
entirely -- LLM-composed WP-CLI and raw rm -f against production WP
Engine installs reached the server with no policy check, unlike every
other remote-command path in this codebase (F3)."
```

---

### Task 4: A4 (P2) — Tier-3 confirmation becomes impossible to bypass by adding a caller

**Files:**
- Modify: `src/main/mcp/safety.ts`
- Modify: `src/main/mcp/tool-registry.ts`
- Modify: `src/main/mcp/mcp-safety-wrapper.ts`
- Modify: `src/main/ai-proxy/AiProxyServer.ts` (widen the `accessMethod` union, per the related finding)
- Modify: `src/main/agent-runtime/NexusToolProvider.ts` (widen the `accessMethod` union, per the related finding)
- Test: `tests/unit/mcp/tool-registry.test.ts` (extend)
- Test: `tests/unit/mcp/mcp-safety-wrapper.test.ts` (extend, if it exists — check first)

**Interfaces:**
- Consumes: `ConfirmationManager` (already in `safety.ts`).
- Produces: `ToolRegistry.call()`'s signature gains one new optional parameter:
  `call(name: string, args: Record<string, unknown>, services: NexusServices, accessMethod?: 'mcp' | 'cli' | 'agent', requireConfirmation: boolean = true): Promise<McpToolResult>`
  — every existing caller that omits the new 5th argument keeps today's behavior for Tier 1/2 tools and GAINS the tier-3 gate it was previously missing (this is the fix). `ToolRegistry` gains a public field `confirmationManager: ConfirmationManager`.

**Context:** `ToolRegistry.call()` (`src/main/mcp/tool-registry.ts:134-`) executes every tool handler directly with **no tier-3 confirmation check at all** — that logic exists only in `McpSafetyWrapper.callWithSafety` (`mcp-safety-wrapper.ts:32-99`) and is duplicated again in `McpServer.dispatch`'s agent-tool branch (`McpServer.ts:~322-348`), both using the SAME `ConfirmationManager` instance today via `this.safetyWrapper.confirmationManager`. Three callers of `ToolRegistry.call()` never go through either of those wrappers: the 7 live GraphQL resolvers that call `registry.call(...)` directly, `NexusToolProvider` (`:58`), and `AiProxyServer` (`:682`, only partially mitigated by filtering the tool list, which does not gate execution). A tier-3 tool invoked through any of these three paths executes with **no confirmation token check whatsoever**.

Moving the gate into `call()` itself, rather than a wrapper, means no future caller can reintroduce this gap by forgetting to route through `McpSafetyWrapper`.

Read `src/main/mcp/safety.ts`'s `ConfirmationManager` class and `src/main/mcp/mcp-safety-wrapper.ts`'s current `callWithSafety` implementation (lines 32-99) and `src/main/mcp/McpServer.ts`'s agent-tool dispatch branch (~lines 315-355) fully before starting — both contain the exact confirmation-token generate/validate logic you are relocating.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/mcp/tool-registry.test.ts` (read the file first to match its existing fixture pattern for constructing a `ToolRegistry` with a registered Tier-3 tool — if none exists yet, register one inline in the new tests using `TIER_OVERRIDES` or a mocked `getToolSafety`):

```ts
describe('ToolRegistry.call() — tier-3 confirmation gate', () => {
  it('a tier-3 tool called with no confirmation token returns a requiresConfirmation response, not the tool result', async () => {
    // Register or mock a tool whose getToolSafety(...).tier === 3.
    const result = await registry.call('some_tier3_tool', {}, services);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.requiresConfirmation).toBe(true);
    expect(parsed.confirmationToken).toBeTruthy();
    // The underlying handler must NOT have run.
  });

  it('a tier-3 tool called with a valid confirmation token executes normally', async () => {
    const first = await registry.call('some_tier3_tool', {}, services);
    const { confirmationToken } = JSON.parse(first.content[0].text as string);
    const second = await registry.call('some_tier3_tool', { _confirmationToken: confirmationToken }, services);
    expect(second.isError).toBeFalsy();
    // The underlying handler DID run this time.
  });

  it('requireConfirmation: false skips the gate for a caller that already pre-confirmed', async () => {
    const result = await registry.call('some_tier3_tool', {}, services, 'cli', false);
    // Executes immediately, no confirmation JSON returned.
    expect(result.isError).toBeFalsy();
  });

  it('a tier-1 or tier-2 tool is completely unaffected by the new parameter', async () => {
    const result = await registry.call('some_tier1_tool', {}, services);
    // Executes immediately as today -- no confirmation dance at all.
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/mcp/tool-registry.test.ts -v`
Expected: FAIL — `call()` currently executes every tool immediately regardless of tier.

- [ ] **Step 3: Extract the confirmation-gate logic into a reusable function in `safety.ts`**

In `src/main/mcp/safety.ts`, add (near the `ConfirmationManager` class):

```ts
export interface ConfirmationGateResult {
  /** True if the gate returned a "please confirm" response and the caller must stop here. */
  blocked: boolean;
  /** Set only when blocked is true. */
  response?: McpToolResult;
  /** Set only when blocked is false and a token was consumed — args with _confirmationToken stripped. */
  cleanedArgs?: Record<string, unknown>;
}
```

(Add the `McpToolResult` import from `./types` at the top of the file if not already present.)

```ts
/**
 * Tier-3 confirmation gate, extracted so it can be enforced from a single
 * place (ToolRegistry.call()) instead of duplicated per dispatch surface —
 * see A4 in the 2026-08-08 external-host-onboarding-and-fixes review for why
 * duplication let three callers skip it entirely.
 */
export function checkTierThreeConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  tier: SafetyTier,
  confirmationMessage: string | undefined,
  preChecks: string[] | undefined,
  confirmations: ConfirmationManager,
): ConfirmationGateResult {
  if (tier !== 3) {
    return { blocked: false, cleanedArgs: args };
  }

  const token = args._confirmationToken as string | undefined;

  if (!token) {
    const confirmationToken = confirmations.generate(toolName, args);
    return {
      blocked: true,
      response: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            requiresConfirmation: true,
            tier: 3,
            action: confirmationMessage,
            warning: 'This action may not be reversible.',
            howToConfirm: `To proceed, call ${toolName} again with the same arguments plus _confirmationToken set to the value below.`,
            preChecks,
            confirmationToken,
          }, null, 2),
        }],
      },
    };
  }

  const validationParams = { ...args };
  delete validationParams._confirmationToken;
  const validationError = confirmations.validate(token, toolName, validationParams);
  if (validationError) {
    return {
      blocked: true,
      response: { content: [{ type: 'text', text: validationError }], isError: true },
    };
  }

  return { blocked: false, cleanedArgs: validationParams };
}
```

- [ ] **Step 4: Wire the gate into `ToolRegistry.call()`**

In `src/main/mcp/tool-registry.ts`:

1. Import `ConfirmationManager, checkTierThreeConfirmation` from `./safety` (alongside the existing `getToolSafety` import).
2. Add a public field to the class: `readonly confirmationManager = new ConfirmationManager();`
3. Change the `call()` signature to:
   ```ts
   async call(
     name: string,
     args: Record<string, unknown>,
     services: NexusServices,
     accessMethod?: 'mcp' | 'cli' | 'agent',
     requireConfirmation: boolean = true,
   ): Promise<McpToolResult> {
   ```
4. Immediately after the existing `isAvailable` check (before the `// Execute handler directly` comment), insert:
   ```ts
       const safety = getToolSafety(name);
       let handlerArgs = args;
       if (requireConfirmation) {
         const gate = checkTierThreeConfirmation(name, args, safety.tier, safety.confirmationMessage, safety.preChecks, this.confirmationManager);
         if (gate.blocked) return gate.response!;
         handlerArgs = gate.cleanedArgs!;
       }
   ```
5. Change `const result = await handler.execute(args, services);` to `const result = await handler.execute(handlerArgs, services);` — the confirmation-stripped args must reach the handler, not the raw args (which may still carry `_confirmationToken`).
6. The two existing `getToolSafety(name).tier` calls further down (in the audit-log blocks) can stay as-is, or reuse the `safety` variable from step 4 — either is fine, but prefer reusing `safety.tier` to avoid calling `getToolSafety` three times per invocation.

- [ ] **Step 5: Simplify `McpSafetyWrapper.callWithSafety`**

In `src/main/mcp/mcp-safety-wrapper.ts`:

1. Remove the `private confirmations = new ConfirmationManager();` field.
2. Change the `confirmationManager` getter (near the bottom of the file, referenced by `McpServer.dispatch`) to return `this.registry.confirmationManager` instead of `this.confirmations` — this keeps `McpServer.ts`'s existing `this.safetyWrapper.confirmationManager` reference working unchanged, now backed by the SAME instance `ToolRegistry.call()` uses internally (critical: a token generated by one code path must validate against the other).
3. Remove the entire tier-3 gate block (lines ~42-77, the `if (safety.tier === 3) { ... }` block) from `callWithSafety` — this logic now lives inside `registry.call()`.
4. Remove the `// Strip confirmation token before calling tool` block (the `handlerArgs` construction just above the `this.registry.call(...)` line) — stripping now happens inside `call()`.
5. Change the call to `this.registry.call(name, handlerArgs, services, 'mcp')` to `this.registry.call(name, args, services, 'mcp')` — pass the ORIGINAL args (with `_confirmationToken` still present, if any), since `call()` now needs to see it to validate.
6. The audit-log block after the call currently branches on `safety.tier === 3 ? true : null` for the `confirmed` field. Since `callWithSafety` no longer knows locally whether a confirmation just happened, detect it from the result instead: check whether `result.content[0]?.text` parses as JSON with `requiresConfirmation: true` (matching the exact shape `checkTierThreeConfirmation` returns) — if so, log `result: 'confirmation_required'` as before and return early without further processing; otherwise proceed with the existing success/error audit branches, still passing `safety.tier === 3 ? true : null` for `confirmed` (this part of the audit semantics is unchanged, only how you detect "was this actually the confirmation-required response" changes).

- [ ] **Step 6: Wire `McpServer.dispatch`'s agent-tool branch through the shared gate**

In `src/main/mcp/McpServer.ts`, the agent-tool dispatch branch (~lines 315-355) duplicates the same tier-3 logic using `this.safetyWrapper.confirmationManager` directly (not through `ToolRegistry.call()`, since agent tools dispatch to `AgentDispatcher`, not the tool registry). This duplication is a SEPARATE dispatch path from MCP builtin tools and is not required to change for this task — leave it as-is, but verify (read the surrounding code) that it still uses `this.safetyWrapper.confirmationManager`, which after Step 5 now resolves to `this.registry.confirmationManager` — confirm this via a passing test rather than assuming; add one if none exists:

```ts
it('agent-tool confirmation tokens and builtin-tool confirmation tokens share one ConfirmationManager', () => {
  // Whatever this test file's existing pattern is for constructing an McpServer
  // with both a ToolRegistry and a McpSafetyWrapper -- assert
  // mcpServer's safetyWrapper.confirmationManager === registry.confirmationManager (===, not just structurally similar).
});
```

- [ ] **Step 7: Widen the `accessMethod` union**

In `src/main/agent-runtime/NexusToolProvider.ts` (the call site the review found passing `'agent' as any`), and in `src/main/ai-proxy/AiProxyServer.ts` (the call site omitting the argument), pass `'agent'` as a properly-typed value now that `ToolRegistry.call()`'s `accessMethod` parameter accepts `'mcp' | 'cli' | 'agent'` (Step 4). Remove the `as any` cast in `NexusToolProvider.ts`. In `AiProxyServer.ts`, add the now-required-to-be-meaningful `accessMethod` argument (`'agent'` or `'mcp'` — read the surrounding code to determine which is accurate for that call site) so its audit rows stop logging `_accessMethod: 'unknown'`.

- [ ] **Step 8: Run tests**

Run: `npx jest tests/unit/mcp -v && npx tsc --noEmit`
Expected: PASS, no type errors. Also run the full suite once (`npx jest 2>&1 | tail -8`) to confirm nothing elsewhere regressed — this task touches a widely-shared dispatch path.

- [ ] **Step 9: Commit**

```bash
git add src/main/mcp/safety.ts src/main/mcp/tool-registry.ts src/main/mcp/mcp-safety-wrapper.ts src/main/mcp/McpServer.ts src/main/ai-proxy/AiProxyServer.ts src/main/agent-runtime/NexusToolProvider.ts tests/unit/mcp/tool-registry.test.ts tests/unit/mcp/mcp-safety-wrapper.test.ts
git commit -m "fix(mcp): move tier-3 confirmation into ToolRegistry.call() itself

GraphQL resolvers (7 live sites), NexusToolProvider and AiProxyServer all
called registry.call() directly, bypassing McpSafetyWrapper entirely --
a tier-3 tool invoked through any of them executed with zero confirmation
check. The gate now lives in call() itself, with an explicit
requireConfirmation opt-out for a future caller that legitimately
pre-confirms elsewhere, so it cannot be silently skipped by adding a
caller again."
```

---

### Task 5: A5 (P2) — Audit and queue the two unwrapped host resolvers

**Files:**
- Modify: `src/main/graphql/resolvers.ts`
- Test: `tests/unit/graphql/host-refresh.test.ts`
- Test: `tests/unit/graphql/host-index.test.ts`

**Interfaces:**
- Consumes: `auditDirectOperation` (`src/main/audit/auditDirectOperation.ts`), `withQueue` (already used by every sibling resolver in this file).
- Produces: no signature changes to `nexusHostRefresh`/`nexusHostIndex` — same GraphQL contract, now audited and queued like every other SSH-spawning resolver.

**Context:** `nexusHostRefresh` (`resolvers.ts:5678`) and `nexusHostIndex` (`resolvers.ts:5725`) open SSH sessions to third-party production hosts but, unlike their siblings `nexusHostProbe` and `nexusHostAdd` (and unlike every other SSH-spawning resolver in this file), call neither `auditDirectOperation` nor wrap their body in `withQueue`.

- [ ] **Step 1: Read the sibling resolvers first**

Read `nexusHostProbe` and `nexusHostAdd` in full (`resolvers.ts`, search for `nexusHostProbe:` and `nexusHostAdd:`) to see the exact `withQueue(async () => { ... })` wrapping pattern and the exact `auditDirectOperation(services, {...})` call shape (operation name, target, parameters, outcome) already established in this file — match them exactly, don't invent a new shape.

- [ ] **Step 2: Write the failing tests**

Add to `tests/unit/graphql/host-refresh.test.ts` and `tests/unit/graphql/host-index.test.ts` (read each file first to match its existing mock/fixture pattern for `services`):

```ts
it('audits the operation on both success and failure', async () => {
  const auditMock = jest.fn();
  const c = ctx({ /* ...services override adding auditDirectOperation: auditMock, or however this file's ctx() helper wires services in... */ });
  await createResolvers(c.context).Mutation.nexusHostRefresh(null, { alias: 'some-alias' });
  expect(auditMock).toHaveBeenCalled();
});

it('serializes concurrent calls through the same queue every other host resolver uses', async () => {
  // If this file's sibling tests (host-add, host-probe) already have a pattern
  // for asserting withQueue serialization, mirror it here. If not, this
  // assertion can be satisfied by confirming withQueue is imported and called
  // -- read how nexusHostProbe's own test (if any) verifies this.
});
```

- [ ] **Step 3: Run and verify they fail**

Run: `npx jest tests/unit/graphql/host-refresh.test.ts tests/unit/graphql/host-index.test.ts -v`
Expected: FAIL — `auditMock` is never called today.

- [ ] **Step 4: Implement**

Wrap both `nexusHostRefresh`'s and `nexusHostIndex`'s resolver bodies in `withQueue(async () => { ... })` (matching `nexusHostProbe`'s exact wrapping), and add `auditDirectOperation(services, {...})` calls on both the success and failure paths (matching `nexusHostAdd`'s exact call shape — operation name should be `'external.host.refresh'` / `'external.host.index'` respectively, per this codebase's `<surface>.<resource>.<action>` naming convention documented in CLAUDE.md's Logging & Audit section).

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/graphql/host-refresh.test.ts tests/unit/graphql/host-index.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/graphql/resolvers.ts tests/unit/graphql/host-refresh.test.ts tests/unit/graphql/host-index.test.ts
git commit -m "fix(graphql): audit and queue nexusHostRefresh/nexusHostIndex

Both open SSH sessions to third-party production hosts but, unlike
every sibling SSH-spawning resolver in this file, called neither
auditDirectOperation nor withQueue."
```

---

### Task 6: A6+A7 (P3) — Remove the two dead REST-channel reservations

**Files:**
- Modify: `src/main/transport/types.ts`
- Modify: `src/main/transport/ExternalSshTransport.ts`
- Modify: `src/main/transport/LocalTransport.ts`
- Modify: `src/main/transport/WpeSshTransport.ts`
- Modify: `src/main/transport/policy.ts`
- Test: `tests/unit/transport/conformance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TransportKind` narrows to `'local' | 'wpe-ssh' | 'external-ssh'`. `SiteTransport` interface loses its `supports(cap: Capability): boolean` member entirely. Every later task/plan that touches a `SiteTransport` implementation must not reference `supports`/`Capability` — there are none left to reference.

**Context:** Per decision 0.1 in the review ("Nexus is an SSH tool — REST-based management is a separate product"), two things were reserved for a REST-channel spec that is now cancelled: the `'external-rest'` member of `TransportKind` (`transport/types.ts:4`, zero consumers — nothing switches on `TransportKind` at all), and the entire `Capability` union plus every transport's `supports()` method (`transport/types.ts:11-18`, seven tokens, zero real consumers — all three transports implement `supports(_cap) { return true; }` with an unused parameter; the only callers are `policy.ts:74`'s pass-through and a conformance test asserting the return is a boolean).

- [ ] **Step 1: Confirm zero real consumers before deleting**

Run: `grep -rn "external-rest" src/ tests/` and `grep -rn "Capability\b" src/ tests/` — read every hit. Per the review, you should find: `external-rest` only in the `TransportKind` type definition itself; `Capability` only in the type definition, the three `supports()` implementations, `policy.ts`'s pass-through, and a conformance test. If you find any OTHER real consumer (something that actually branches on a `TransportKind` value or calls `.supports(...)` with a real decision depending on the result), STOP and report it — this task assumes there are none, per the review's own verification.

- [ ] **Step 2: Write the failing test (removal, not addition — this test should fail on the CURRENT code)**

Add to `tests/unit/transport/conformance.test.ts`:

```ts
it('SiteTransport has no supports() method — Capability plumbing was removed as dead code', () => {
  const transport = /* however this file's existing fixtures construct one, e.g. new LocalTransport(...) */;
  expect((transport as any).supports).toBeUndefined();
});
```

- [ ] **Step 3: Run and verify it fails**

Run: `npx jest tests/unit/transport/conformance.test.ts -v -t "no supports"`
Expected: FAIL — `supports` currently exists.

- [ ] **Step 4: Implement**

In `src/main/transport/types.ts`:
1. Narrow `TransportKind` to `'local' | 'wpe-ssh' | 'external-ssh'` (remove `'external-rest'`).
2. Delete the entire `Capability` type/union (lines ~11-18).
3. Remove `supports(cap: Capability): boolean;` from the `SiteTransport` interface.

In each of `ExternalSshTransport.ts`, `LocalTransport.ts`, `WpeSshTransport.ts`: delete the `supports(_cap: Capability): boolean { return true; }` method entirely, and remove the now-unused `Capability` import if present.

In `policy.ts`: remove the `supports: (cap) => transport.supports(cap),` pass-through line (~line 74) and whatever surrounding object/interface it belonged to that referenced `Capability` — read the surrounding context first to confirm you're not leaving an empty/malformed object literal.

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/transport -v && npx tsc --noEmit`
Expected: PASS, no type errors — a compile error here would mean a real consumer was missed in Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/types.ts src/main/transport/ExternalSshTransport.ts src/main/transport/LocalTransport.ts src/main/transport/WpeSshTransport.ts src/main/transport/policy.ts tests/unit/transport/conformance.test.ts
git commit -m "chore(transport): remove external-rest TransportKind and the Capability/supports() plumbing

Both were pre-payment for a REST-channel spec that is now cancelled
(decision 0.1: Nexus is an SSH tool). Zero real consumers of either --
verified via full-tree grep before deleting."
```

---

### Task 7: A8 (P3) — `formatTarget` has no external branch

**Files:**
- Modify: `src/common/target.ts`
- Test: `tests/unit/common/target.test.ts` (extend, or find the actual existing test file for this module — check first)

**Interfaces:**
- Consumes: `ParsedTarget` (already defined in this file).
- Produces: `formatTarget(parsed: ParsedTarget): string` — same signature, now handles all three `parsed.type` values instead of two.

**Context:** `formatTarget` (`common/target.ts:140-143`) unconditionally emits `wpe:${account}/${installName}@${environment}` for anything that isn't `'local'` — formatting a parsed `'external'` target produces `wpe:undefined/undefined@production`, silently wrong rather than an error.

- [ ] **Step 1: Find the existing test file**

Run: `grep -rln "formatTarget" tests/` — read whatever exists to match its fixture pattern before adding to it.

- [ ] **Step 2: Write the failing test**

```ts
it('formats an external SSH target correctly', () => {
  const parsed = parseTarget('ssh:my-alias/my-site@production');
  expect(formatTarget(parsed)).toBe('ssh:my-alias/my-site@production');
});
```

(Use whatever this file's existing tests use to construct a `ParsedTarget` — either via `parseTarget` as shown, or by constructing the object literal directly if that's the established pattern in this file.)

- [ ] **Step 3: Run and verify it fails**

Run: `npx jest tests/unit/common/target.test.ts -v -t "external"`
Expected: FAIL — produces `wpe:undefined/undefined@production`.

- [ ] **Step 4: Implement**

In `src/common/target.ts`, change `formatTarget`:

```ts
export function formatTarget(parsed: ParsedTarget): string {
  if (parsed.type === 'local') return `${parsed.siteName}@local`;
  if (parsed.type === 'external') return `ssh:${parsed.alias}/${parsed.site}@${parsed.environment}`;
  return `wpe:${parsed.account}/${parsed.installName}@${parsed.environment}`;
}
```

(Confirm `ParsedTarget`'s external variant's exact field names — `alias`, `site`, `environment` — by reading the type definition above this function; use whatever the real field names are if they differ from this guess.)

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/common/target.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/common/target.ts tests/unit/common/target.test.ts
git commit -m "fix(common): formatTarget handles external SSH targets

Previously fell through to the WPE branch unconditionally, producing
wpe:undefined/undefined@production for any external target."
```

---

### Task 8: F4 — Backfill Tier-1 audit overrides for read-only tools

**Files:**
- Modify: `src/main/mcp/safety.ts`
- Test: `tests/unit/mcp/safety.test.ts` (extend, or find the actual existing test file — check first)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature changes — `TIER_OVERRIDES` gains entries; `getToolSafety`'s behavior for those tool names changes from "defaults to 2" to "explicitly 1".

**Context:** `getToolSafety` (`safety.ts:225-`) defaults any tool absent from `TIER_OVERRIDES` to Tier 2, which means every genuinely read-only tool missing an entry writes a durable audit line on every call — inconsistent with this codebase's stated rule ("read-only paths are not audited"). Per F4, backfill explicit Tier-1 entries rather than restating the rule.

- [ ] **Step 1: Enumerate every registered tool and its current tier**

Run this exact command from the repo root to produce the working list (every tool definition's `name:` field, matched against `TIER_OVERRIDES`):

```bash
grep -rhoE "name: '[a-z_0-9]+'" src/main/mcp/modules --include="*.ts" | sed -E "s/name: '([a-z_0-9]+)'/\1/" | sort -u > /tmp/all-tool-names.txt
grep -oE "^\s*[a-z_0-9]+: [123]," src/main/mcp/safety.ts | sed -E 's/^\s*([a-z_0-9]+):.*/\1/' | sort -u > /tmp/tiered-tool-names.txt
comm -23 /tmp/all-tool-names.txt /tmp/tiered-tool-names.txt
```

This lists every registered tool name with no `TIER_OVERRIDES` entry (defaulting to Tier 2 today). For each name in that list, open the tool's actual definition file (`grep -rn "name: '<toolname>'" src/main/mcp/modules`) and read its `execute` function.

- [ ] **Step 2: Classify each one**

A tool is Tier 1 (read-only) if its `execute` function performs **no** write of any kind: no `wp_cli` mutating subcommand (`update`, `install`, `activate`, `delete`, `set`, `create`, `clean`, `reindex`), no database write, no file write, no external API mutation (WPE CAPI POST/PUT/DELETE), no state mutation via `registryStorage.set`/`graphService.upsertX`. If it only reads and returns data (queries, searches, summaries, health checks, list/get/describe operations), it is Tier 1. If you find ANY tool whose classification is genuinely ambiguous (e.g., it writes to an in-memory cache but nothing durable, or it triggers a side effect like a re-index scan without changing user data), leave it un-backfilled (still defaulting to Tier 2) and note it in your task report rather than guessing — do not mark anything Tier 1 you are not certain performs no write.

- [ ] **Step 3: Write the failing test**

Pick 3-5 of the clearest, most obviously read-only names you found in Step 1 (the review names `fleet_overview`, `search_site_content`, `get_metrics`, and "all seven `iw_*`" tools as examples already confirmed read-only — verify each still exists under that exact name before using it) and add:

```ts
import { getToolSafety, TIER_OVERRIDES } from '../../../src/main/mcp/safety';

describe('Tier-1 backfill for read-only tools', () => {
  it.each(['fleet_overview', 'search_site_content', 'get_metrics'])(
    '%s is explicitly Tier 1, not defaulting to Tier 2',
    (name) => {
      expect(TIER_OVERRIDES[name]).toBe(1);
      expect(getToolSafety(name).tier).toBe(1);
    },
  );
});
```

- [ ] **Step 4: Run and verify it fails**

Run: `npx jest tests/unit/mcp/safety.test.ts -v`
Expected: FAIL for whichever of the sample names currently have no `TIER_OVERRIDES` entry.

- [ ] **Step 5: Implement**

Add every tool name you classified as genuinely read-only in Step 2 to `TIER_OVERRIDES` in `src/main/mcp/safety.ts` with the value `1`, following the exact existing formatting style already in that object (see the `// Tier 1 — Read` section near the top of the file for the established pattern) — group your additions under that same comment or a new `// Tier 1 — Read (backfilled, F4)` comment if the existing section is far from where you're editing.

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/mcp/safety.test.ts -v && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/mcp/safety.ts tests/unit/mcp/safety.test.ts
git commit -m "fix(mcp): backfill Tier-1 overrides for read-only tools defaulting to Tier 2

getToolSafety defaults any tool absent from TIER_OVERRIDES to Tier 2,
so genuinely read-only tools (fleet/search/health/describe/list
operations) were writing durable audit lines on every call --
inconsistent with the documented 'read-only paths are not audited'
rule (F4)."
```

---

### Task 9: A9 — Documentation corrections

**Files:**
- Modify: `CLAUDE.md`
- No test file — this task is documentation-only.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks — this is the final task.

**Context:** Nine verified doc-drift items from the review, listed below. Verify each against the current tree yourself before editing (line numbers may have shifted since the review) — do not copy them in blind.

- [ ] **Step 1: Fix the false L3 claim**

Find the line in CLAUDE.md's "External SSH Hosts" section claiming external hosts now content-index successfully ("stale now that a host has been indexed at least once"). Per A1 (Task 1 of this plan, now fixed), this claim was false before this plan and should now note: content indexing was broken for every multi-site external host until this plan's Task 1 fix (silent vector-table-id collision with `/` in the id); a single-site host with no `/` in its id was unaffected. Rewrite the section to state this accurately rather than the previous unconditional "it works" claim.

- [ ] **Step 2: Fix the dead `schema.sql` claim**

Find any reference in CLAUDE.md instructing a reader to consult `schema.sql` for the graph database schema. Verify: run `grep -rn "schema.sql" src/` — if it has zero importers, correct the doc to say the live schema is `src/main/events/GraphService.ts` (the `CREATE TABLE` statements plus its migration blocks) and that `schema.sql` is not the source of truth.

- [ ] **Step 3: Fix the scheduler count and location**

Find CLAUDE.md's list of settings-driven schedulers wired into `onSettingsUpdated`. Verify the current count and location: run `grep -n "const onSettingsUpdated = " src/main/index.ts` to confirm the current line number (this plan's earlier merge-conflict resolution moved this — re-verify, do not trust the review's `:523-594` line numbers or CLAUDE.md's stale `~660` reference without checking). Confirm via reading that function's body how many distinct schedulers it restarts/stops (the review counted six: opportunistic/local-content, halted-site, WPE refresh, WPE content-index, external refresh, external content-index — verify this count against the current function body, since Task 1-8 of this plan didn't touch it but earlier unrelated work might have added or removed one). Correct CLAUDE.md's count and line reference to match what you actually find.

- [ ] **Step 4: Fix the renderer-UI-row claim**

Find CLAUDE.md's claim that `externalRefreshAutoEnabled` has no renderer UI row. Verify: `grep -n "externalRefreshAutoEnabled" src/renderer/components/SettingsTab.tsx`. If a UI row exists (the review says it does), correct CLAUDE.md to say only `externalContentIndexAutoEnabled` is genuinely CLI-only (verify this one has zero renderer references the same way). Also fix the same stale claim if it's echoed in a source comment near `src/main/index.ts`'s scheduler-wiring code (the review points at `:517-518` — re-verify the line number).

- [ ] **Step 5: Fix or remove the `upsertExternalProfile` `source` parameter doc comment**

Read `src/main/external/externalSiteStore.ts`'s `upsertExternalProfile` function and its `source` parameter. Verify whether `source` is read anywhere in the function body (`grep -n "source" src/main/external/externalSiteStore.ts`). If it's genuinely inert (never read), either delete the parameter (and update every call site — `grep -rn "upsertExternalProfile(" src/main`) or reimplement the registration-vs-sighting protection it claims to provide. If you choose to delete it, this becomes a small code change in addition to the doc fix — do that here rather than leaving a misleading doc comment describing dead behavior. Whichever you choose, correct CLAUDE.md's corresponding claim (if any references this mechanism) to match.

- [ ] **Step 6: Fix the PHP-version-fabrication scope claim**

Find CLAUDE.md's note about the `'8.0'` PHP-version fabrication defect. Verify whether it's still scoped to only `nexusFleetHealth`, or whether (per the review) `fleet-health-summary.ts` and `ipc-handlers.ts` have the same defect: `grep -rn "'8.0'" src/main`. Update CLAUDE.md to accurately list every location, or note it is out of scope for this plan to fix all instances (this task is documentation-only — do not fix the underlying `'8.0'` fabrication itself here unless it is trivially a one-line change per the pattern CLAUDE.md already documents as the correct fix for the `nexusFleetHealth` instance).

- [ ] **Step 7: Fix the dead-resolvers claim**

Verify: `grep -rln "resolvers/sites.ts\|resolvers/twin.ts\|resolvers/wpe.ts" src/main/graphql/resolvers.ts src/main/index.ts` — if these three files have zero production importers (only referenced from test files), and CLAUDE.md doesn't already say so accurately, correct it. Confirm `resolvers/wp-cli.ts` is the one exception (it IS referenced) and that CLAUDE.md's characterization of the "equivalence inventory" count (7 live vs 3 dead of 10 total `registry.call` sites) is accurate.

- [ ] **Step 8: Fix the `wp health` GraphQL-fallback claim**

Verify: `grep -n "wp_health\|wp health" src/main/mcp/modules -r` and cross-reference with `docs/*wp-cli-surface-matrix*` if that file exists. If `wp health` is genuinely MCP-only with no GraphQL fallback (contradicting the matrix doc), correct whichever of the two documents is wrong to match the code. Also verify the "exits 0 on error" defect the review says is already fixed — confirm and note that in whichever doc references it.

- [ ] **Step 9: Fix the two remaining small line-number/naming corrections**

Verify `getToolSafety`'s tier-fallback line number in `safety.ts` (the review says `:226`, not `:223` as CLAUDE.md may claim) and correct it. Verify the two `TIER_OVERRIDES` keys the review says name tools that don't exist (`wpe_configure_offload_settings`, `wpe_copy_install`) — run `grep -rn "wpe_configure_offload_settings\|wpe_copy_install" src/main/mcp/modules` to confirm zero tool definitions use either name, and either remove the two dead `TIER_OVERRIDES` entries (a small code change, do it here) or correct CLAUDE.md if they turn out to still be live.

- [ ] **Step 10: Commit**

```bash
git add CLAUDE.md src/main/mcp/safety.ts src/main/external/externalSiteStore.ts
git commit -m "docs: correct nine verified drift items in CLAUDE.md

Includes the most misleading line in the file (external content
indexing claimed working when it never had for a multi-site host,
per A1), a dead schema.sql reference, stale scheduler count/line
references, and several smaller line-number and naming corrections."
```
